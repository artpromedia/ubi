/**
 * The client is exercised against a real HTTP server and a real Redis; only the
 * clock is injected, so caching, revalidation and failure behaviour are the ones
 * that will run in production.
 */
import { createHash } from "node:crypto";

import { ContractError, DENY_ALL } from "@ubi/contracts";
import Redis from "ioredis";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONFIG_INVALIDATION_CHANNEL, createConfigClient } from "../src/index";
import { requireFlag } from "../src/index";
import { cityConfigFixture } from "./fixtures";
import {
  type TestServer,
  closedPortUrl,
  json,
  startServer,
} from "./helpers/server";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

function etagFor(value: unknown): string {
  return `"${createHash("sha256").update(JSON.stringify(value)).digest("base64url")}"`;
}

class Clock {
  private millis = 1_700_000_000_000;
  now = (): number => this.millis;
  advanceSeconds(seconds: number): void {
    this.millis += seconds * 1_000;
  }
}

describe("getCityConfig", () => {
  let server: TestServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("fetches, caches in-process, and does not call the service again inside the TTL", async () => {
    const config = cityConfigFixture();
    server = await startServer((_req, res) => {
      json(res, 200, config, { etag: etagFor(config) });
    });
    const client = createConfigClient({
      baseUrl: server.url,
      ttlSec: 60,
      now: new Clock().now,
    });

    expect(await client.getCityConfig("LOS")).toEqual(config);
    expect(await client.getCityConfig("LOS")).toEqual(config);
    expect(server.requests).toHaveLength(1);
  });

  it("revalidates with If-None-Match once the entry goes stale and accepts 304", async () => {
    const config = cityConfigFixture();
    const etag = etagFor(config);
    const clock = new Clock();
    server = await startServer((req, res) => {
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, { etag });
        res.end();
        return;
      }
      json(res, 200, config, { etag });
    });
    const client = createConfigClient({
      baseUrl: server.url,
      ttlSec: 60,
      now: clock.now,
    });

    await client.getCityConfig("LOS");
    clock.advanceSeconds(61);
    expect(await client.getCityConfig("LOS")).toEqual(config);

    expect(server.requests).toHaveLength(2);
    expect(server.requests[1]?.headers["if-none-match"]).toBe(etag);
  });

  it("picks up a newly activated version when the ETag changes", async () => {
    const first = cityConfigFixture();
    const second = cityConfigFixture({ version: 2, quoteTtlSec: 420 });
    const clock = new Clock();
    let current = first;
    server = await startServer((_req, res) => {
      json(res, 200, current, { etag: etagFor(current) });
    });
    const client = createConfigClient({
      baseUrl: server.url,
      ttlSec: 60,
      now: clock.now,
    });

    expect((await client.getCityConfig("LOS")).version).toBe(1);
    current = second;
    clock.advanceSeconds(61);
    const updated = await client.getCityConfig("LOS");
    expect(updated.version).toBe(2);
    expect(updated.quoteTtlSec).toBe(420);
  });

  it("rejects with config_unavailable when the service is unreachable", async () => {
    const client = createConfigClient({
      baseUrl: await closedPortUrl(),
      timeoutMs: 500,
    });
    await expect(client.getCityConfig("LOS")).rejects.toMatchObject({
      code: "config_unavailable",
      status: 503,
    });
  });

  it("rejects with config_unavailable on a 500", async () => {
    server = await startServer((_req, res) => {
      json(res, 500, { code: "internal_error", message: "boom" });
    });
    const client = createConfigClient({ baseUrl: server.url });
    await expect(client.getCityConfig("LOS")).rejects.toMatchObject({
      code: "config_unavailable",
    });
  });

  it("rejects with config_unavailable when the body is not a city config", async () => {
    server = await startServer((_req, res) => {
      json(res, 200, { currency: "NGN" });
    });
    const client = createConfigClient({ baseUrl: server.url });
    await expect(client.getCityConfig("LOS")).rejects.toMatchObject({
      code: "config_unavailable",
    });
  });

  it("rejects with config_unavailable when the service times out", async () => {
    server = await startServer(() => {
      // Never responds.
    });
    const client = createConfigClient({ baseUrl: server.url, timeoutMs: 100 });
    await expect(client.getCityConfig("LOS")).rejects.toMatchObject({
      code: "config_unavailable",
    });
  });

  it("reports a definitive 404 as itself, and still refuses to invent a config", async () => {
    server = await startServer((_req, res) => {
      json(res, 404, {
        code: "city_unsupported",
        message: "city is not configured",
      });
    });
    const client = createConfigClient({ baseUrl: server.url });
    const error = await client
      .getCityConfig("ZZZ")
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ContractError);
    expect((error as ContractError).code).toBe("city_unsupported");
    expect((error as ContractError).status).toBe(404);
  });

  it("never serves a stale cached config it could not revalidate", async () => {
    const config = cityConfigFixture();
    const clock = new Clock();
    let healthy = true;
    server = await startServer((_req, res) => {
      if (!healthy) {
        json(res, 503, { code: "service_unavailable", message: "down" });
        return;
      }
      json(res, 200, config, { etag: etagFor(config) });
    });
    const client = createConfigClient({
      baseUrl: server.url,
      ttlSec: 60,
      now: clock.now,
    });

    await client.getCityConfig("LOS");
    healthy = false;
    clock.advanceSeconds(61);

    await expect(client.getCityConfig("LOS")).rejects.toMatchObject({
      code: "config_unavailable",
    });
  });

  it("collapses concurrent misses into a single request", async () => {
    const config = cityConfigFixture();
    server = await startServer((_req, res) => {
      setTimeout(() => {
        json(res, 200, config, { etag: etagFor(config) });
      }, 25);
    });
    const client = createConfigClient({ baseUrl: server.url });

    const results = await Promise.all([
      client.getCityConfig("LOS"),
      client.getCityConfig("LOS"),
      client.getCityConfig("LOS"),
    ]);
    expect(results.every((result) => result.version === 1)).toBe(true);
    expect(server.requests).toHaveLength(1);
  });
});

describe("getFlags", () => {
  let server: TestServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("returns the evaluated map and caches it for the TTL", async () => {
    server = await startServer((_req, res) => {
      json(res, 200, { move: true, bites: false });
    });
    const client = createConfigClient({
      baseUrl: server.url,
      ttlSec: 60,
      now: new Clock().now,
    });

    const flags = await client.getFlags({ cityId: "LOS", userId: "usr_1" });
    expect(flags).toEqual({ move: true, bites: false });
    await client.getFlags({ cityId: "LOS", userId: "usr_1" });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.url).toContain("cityId=LOS");
    expect(server.requests[0]?.url).toContain("userId=usr_1");
  });

  it("denies everything when the service is unreachable", async () => {
    const client = createConfigClient({
      baseUrl: await closedPortUrl(),
      timeoutMs: 500,
    });
    expect(await client.getFlags({ cityId: "LOS" })).toEqual(DENY_ALL);
  });

  it("denies everything on a 500", async () => {
    server = await startServer((_req, res) => {
      json(res, 500, { code: "internal_error", message: "boom" });
    });
    const client = createConfigClient({ baseUrl: server.url });
    expect(await client.getFlags({ cityId: "LOS" })).toEqual(DENY_ALL);
  });

  it("denies everything when the body is not a flag map", async () => {
    server = await startServer((_req, res) => {
      json(res, 200, { move: "yes" });
    });
    const client = createConfigClient({ baseUrl: server.url });
    expect(await client.getFlags({ cityId: "LOS" })).toEqual(DENY_ALL);
  });

  it("denies everything when the service times out", async () => {
    server = await startServer(() => {
      // Never responds.
    });
    const client = createConfigClient({ baseUrl: server.url, timeoutMs: 100 });
    expect(await client.getFlags({ cityId: "LOS" })).toEqual(DENY_ALL);
  });

  it("does not cache a denied result, so recovery is immediate", async () => {
    let healthy = false;
    server = await startServer((_req, res) => {
      if (!healthy) {
        json(res, 503, { code: "service_unavailable", message: "down" });
        return;
      }
      json(res, 200, { move: true });
    });
    const client = createConfigClient({
      baseUrl: server.url,
      ttlSec: 60,
      now: new Clock().now,
    });

    expect(await client.getFlags({ cityId: "LOS" })).toEqual(DENY_ALL);
    healthy = true;
    expect(await client.getFlags({ cityId: "LOS" })).toEqual({ move: true });
  });

  it("forwards the service key when evaluating on behalf of a user", async () => {
    server = await startServer((_req, res) => {
      json(res, 200, { move: true });
    });
    const client = createConfigClient({
      baseUrl: server.url,
      serviceKey: "internal-key",
    });
    await client.getFlags({ cityId: "LOS", userId: "usr_1" });
    expect(server.requests[0]?.headers["x-service-key"]).toBe("internal-key");
    expect(server.requests[0]?.headers["x-user-id"]).toBe("usr_1");
  });
});

describe("requireFlag", () => {
  it("throws feature_disabled with a 404 status when the flag is off", () => {
    const error = (() => {
      try {
        requireFlag({ bites: false }, "bites");
        return undefined;
      } catch (err) {
        return err;
      }
    })();
    expect(error).toBeInstanceOf(ContractError);
    expect((error as ContractError).code).toBe("feature_disabled");
    expect((error as ContractError).status).toBe(404);
  });

  it("throws when the flag is missing entirely", () => {
    expect(() => {
      requireFlag({}, "travel");
    }).toThrow(ContractError);
    expect(() => {
      requireFlag(undefined, "travel");
    }).toThrow(ContractError);
  });

  it("passes when the flag is on", () => {
    expect(() => {
      requireFlag({ bites: true }, "bites");
    }).not.toThrow();
  });

  it("denies every flag in DENY_ALL", () => {
    for (const key of Object.keys(DENY_ALL) as Array<keyof typeof DENY_ALL>) {
      expect(() => {
        requireFlag(DENY_ALL, key);
      }).toThrow(ContractError);
    }
  });
});

describe("shared redis cache and invalidation", () => {
  let server: TestServer | undefined;
  let redis: Redis;

  beforeEach(async () => {
    redis = new Redis(REDIS_URL);
    const keys = await redis.keys("ubi:config-client:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;
    await redis.quit();
  });

  it("lets a second process reuse the config another one fetched", async () => {
    const config = cityConfigFixture();
    server = await startServer((_req, res) => {
      json(res, 200, config, { etag: etagFor(config) });
    });

    const first = createConfigClient({
      baseUrl: server.url,
      cache: redis,
      ttlSec: 60,
    });
    const second = createConfigClient({
      baseUrl: server.url,
      cache: redis,
      ttlSec: 60,
    });

    expect(await first.getCityConfig("LOS")).toEqual(config);
    expect(await second.getCityConfig("LOS")).toEqual(config);
    expect(server.requests).toHaveLength(1);
  });

  it("drops the cached config when the service publishes an invalidation", async () => {
    const first = cityConfigFixture();
    const second = cityConfigFixture({ version: 2 });
    let current = first;
    server = await startServer((_req, res) => {
      json(res, 200, current, { etag: etagFor(current) });
    });

    const client = createConfigClient({
      baseUrl: server.url,
      cache: redis,
      ttlSec: 60,
    });
    const subscriber = redis.duplicate();
    await client.watchInvalidations(subscriber);

    expect((await client.getCityConfig("LOS")).version).toBe(1);

    current = second;
    const publisher = redis.duplicate();
    await publisher.publish(
      CONFIG_INVALIDATION_CHANNEL,
      JSON.stringify({
        kind: "config",
        scopeId: "LOS",
        at: new Date().toISOString(),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect((await client.getCityConfig("LOS")).version).toBe(2);

    await subscriber.quit();
    await publisher.quit();
  });

  it("drops cached flags for a city when a flag change is published", async () => {
    let current: Record<string, boolean> = { move: true, bites: false };
    server = await startServer((_req, res) => {
      json(res, 200, current);
    });

    const client = createConfigClient({
      baseUrl: server.url,
      cache: redis,
      ttlSec: 60,
    });
    const subscriber = redis.duplicate();
    await client.watchInvalidations(subscriber);

    expect(await client.getFlags({ cityId: "LOS", userId: "usr_1" })).toEqual(
      current,
    );

    current = { move: true, bites: true };
    const publisher = redis.duplicate();
    await publisher.publish(
      CONFIG_INVALIDATION_CHANNEL,
      JSON.stringify({
        kind: "flags",
        scopeId: "LOS",
        at: new Date().toISOString(),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(await client.getFlags({ cityId: "LOS", userId: "usr_1" })).toEqual({
      move: true,
      bites: true,
    });

    await subscriber.quit();
    await publisher.quit();
  });
});
