/**
 * Conditional GET and the cache invariant: a read that misses the cache after an
 * activation can never answer with the version that was active before it.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "@/app";
import { ConfigCache } from "@/lib/cache";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { LAGOS_CITY } from "@/seed/lagos";
import {
  adminHeaders,
  closeConnections,
  resetAll,
  seedLagosForTest,
} from "@tests/helpers/db";

const app = buildApp();

async function activateChange(
  patch: Record<string, unknown>,
  salt: string,
): Promise<number> {
  const created = (await (
    await app.request("/v1/config/change-requests", {
      method: "POST",
      headers: adminHeaders("usr_author", `cr-change-${salt}`),
      body: JSON.stringify({
        cityId: LAGOS_CITY.id,
        patch,
        reason: `change ${salt}`,
      }),
    })
  ).json()) as { id: string };
  await app.request(`/v1/config/change-requests/${created.id}/approve`, {
    method: "POST",
    headers: adminHeaders("usr_one", `ap1-change-${salt}`),
  });
  const response = await app.request(
    `/v1/config/change-requests/${created.id}/approve`,
    {
      method: "POST",
      headers: adminHeaders("usr_two", `ap2-change-${salt}`),
    },
  );
  const body = (await response.json()) as {
    version: number;
    activated: boolean;
  };
  expect(body.activated).toBe(true);
  return body.version;
}

describe("city config ETag and cache", () => {
  beforeEach(async () => {
    await resetAll();
    await seedLagosForTest();
  });

  afterAll(async () => {
    await closeConnections();
  });

  it("serves a strong ETag and answers 304 when it still matches", async () => {
    const first = await app.request(`/v1/config/cities/${LAGOS_CITY.id}`);
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    expect(etag?.startsWith("W/")).toBe(false);
    expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/);

    const second = await app.request(`/v1/config/cities/${LAGOS_CITY.id}`, {
      headers: { "if-none-match": etag ?? "" },
    });
    expect(second.status).toBe(304);
    expect(second.headers.get("etag")).toBe(etag);
    expect(await second.text()).toBe("");
  });

  it("is stable across reads of the same version", async () => {
    const first = await app.request(`/v1/config/cities/${LAGOS_CITY.id}`);
    const second = await app.request(`/v1/config/cities/${LAGOS_CITY.id}`);
    expect(second.headers.get("etag")).toBe(first.headers.get("etag"));
  });

  it("issues a new ETag after an activation and stops answering 304 for the old one", async () => {
    const before = await app.request(`/v1/config/cities/${LAGOS_CITY.id}`);
    const oldEtag = before.headers.get("etag") ?? "";

    const version = await activateChange({ offerTtlSec: 15 }, "etag");
    expect(version).toBe(2);

    const revalidate = await app.request(`/v1/config/cities/${LAGOS_CITY.id}`, {
      headers: { "if-none-match": oldEtag },
    });
    expect(revalidate.status).toBe(200);
    const newEtag = revalidate.headers.get("etag");
    expect(newEtag).not.toBe(oldEtag);
    const config = (await revalidate.json()) as {
      version: number;
      offerTtlSec: number;
    };
    expect(config.version).toBe(2);
    expect(config.offerTtlSec).toBe(15);

    const conditional = await app.request(
      `/v1/config/cities/${LAGOS_CITY.id}`,
      {
        headers: { "if-none-match": newEtag ?? "" },
      },
    );
    expect(conditional.status).toBe(304);
  });

  it("never serves the previous version from cache after an activation", async () => {
    // Warm the cache, then activate, then read again immediately.
    const warm = await app.request(`/v1/config/cities/${LAGOS_CITY.id}`);
    expect(((await warm.json()) as { version: number }).version).toBe(1);

    await activateChange({ quoteTtlSec: 420 }, "cache");

    const after = await app.request(`/v1/config/cities/${LAGOS_CITY.id}`);
    const config = (await after.json()) as {
      version: number;
      quoteTtlSec: number;
    };
    expect(config.version).toBe(2);
    expect(config.quoteTtlSec).toBe(420);
  });

  it("drops a cache fill that lost a race with an invalidation", async () => {
    const cache = new ConfigCache(redis, 60);
    const scope = { kind: "config" as const, scopeId: "RACE" };

    // A read whose database load is overtaken by an activation: the value it
    // computed is already stale by the time it would be cached.
    const stale = await cache.read<string>(
      scope,
      async () => {
        await cache.invalidate(scope, {
          kind: "config",
          scopeId: "RACE",
          version: 2,
        });
        return "version-1";
      },
      (raw) => (typeof raw === "string" ? raw : undefined),
    );
    expect(stale).toBe("version-1");

    // The next reader must not be handed the stale value from Redis.
    const fresh = await cache.read<string>(
      scope,
      async () => "version-2",
      (raw) => (typeof raw === "string" ? raw : undefined),
    );
    expect(fresh).toBe("version-2");

    // And that one is cached, so the invariant costs nothing in the steady state.
    const cached = await cache.read<string>(
      scope,
      async () => {
        throw new Error("should have been served from cache");
      },
      (raw) => (typeof raw === "string" ? raw : undefined),
    );
    expect(cached).toBe("version-2");
  });

  it("publishes an invalidation message when a version is activated", async () => {
    const subscriber = redis.duplicate();
    const received: Array<Record<string, unknown>> = [];
    await subscriber.subscribe("ubi.config.invalidate");
    subscriber.on("message", (_channel: string, message: string) => {
      received.push(JSON.parse(message) as Record<string, unknown>);
    });

    try {
      await activateChange({ arrivedGeofenceMeters: 150 }, "pubsub");
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(
        received.some(
          (message) =>
            message["kind"] === "config" &&
            message["scopeId"] === LAGOS_CITY.id &&
            message["version"] === 2,
        ),
      ).toBe(true);
    } finally {
      await subscriber.quit();
    }
  });

  it("keeps answering from Postgres when the cached entry is unreadable", async () => {
    await redis.set(
      `ubi:config:${LAGOS_CITY.id}:entry`,
      JSON.stringify({ nonsense: true }),
    );
    const response = await app.request(`/v1/config/cities/${LAGOS_CITY.id}`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { version: number }).version).toBe(1);
  });

  it("serves exactly what the database holds for the active version", async () => {
    const stored = await prisma.cityConfigVersion.findFirstOrThrow({
      where: { cityId: LAGOS_CITY.id, version: 1 },
    });
    const response = await app.request(`/v1/config/cities/${LAGOS_CITY.id}`);
    expect(await response.json()).toEqual(stored.config);
  });
});
