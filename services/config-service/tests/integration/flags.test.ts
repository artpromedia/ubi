/**
 * Deny-by-default flag evaluation and the audited change path.
 */
import { FLAG_KEYS, isEnabled } from "@ubi/contracts";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "@/app";
import { prisma } from "@/lib/prisma";
import { LAGOS_CITY } from "@/seed/lagos";
import {
  adminHeaders,
  closeConnections,
  resetAll,
  resetCache,
  seedLagosForTest,
} from "@tests/helpers/db";

const app = buildApp();

async function flagsFor(
  query: string,
  headers: Record<string, string> = {},
): Promise<Record<string, boolean>> {
  const response = await app.request(`/v1/flags${query}`, { headers });
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, boolean>;
}

describe("feature flags", () => {
  beforeEach(async () => {
    await resetAll();
    await seedLagosForTest();
  });

  afterAll(async () => {
    await closeConnections();
  });

  it("denies by default: only flags with a rule or a default are on", async () => {
    const flags = await flagsFor(`?cityId=${LAGOS_CITY.id}`);

    // Seeded rules for the Lagos launch.
    expect(flags["move"]).toBe(true);
    expect(flags["ride_request"]).toBe(true);
    // Registered, no rule, default_on false.
    expect(flags["bites"]).toBe(false);
    expect(flags["send"]).toBe(false);
    expect(flags["travel"]).toBe(false);
    expect(flags["stays"]).toBe(false);
    // Nothing is on that has neither a rule nor a default.
    const on = Object.entries(flags)
      .filter(([, value]) => value)
      .map(([key]) => key);
    expect(on.sort()).toEqual(["driver_online", "move", "ride_request"]);
  });

  it("returns false for an unknown flag", async () => {
    const flags = await flagsFor(`?cityId=${LAGOS_CITY.id}`);
    expect(flags["definitely_not_a_flag"]).toBeUndefined();
    // Read through the contract helper, an absent key is off.
    expect(isEnabled(flags as never, "definitely_not_a_flag" as never)).toBe(
      false,
    );
  });

  it("falls back to the flag default when the city has no rule", async () => {
    await prisma.featureFlag.update({
      where: { key: "tips" },
      data: { defaultOn: true },
    });
    await prisma.flagRule.deleteMany({ where: { flagKey: "tips" } });

    const flags = await flagsFor(`?cityId=${LAGOS_CITY.id}`);
    expect(flags["tips"]).toBe(true);
  });

  it("prefers a city rule over a global rule and a global rule over the default", async () => {
    await prisma.featureFlag.update({
      where: { key: "stays" },
      data: { defaultOn: true },
    });
    await prisma.flagRule.create({
      data: {
        id: "flr_global_stays",
        flagKey: "stays",
        cityId: null,
        enabled: false,
      },
    });
    await prisma.city.create({
      data: {
        id: "ABV",
        name: "Abuja",
        country: "NG",
        timezone: "Africa/Lagos",
        active: true,
      },
    });

    // Global rule beats the default.
    expect((await flagsFor("?cityId=ABV"))["stays"]).toBe(false);

    await prisma.flagRule.create({
      data: {
        id: "flr_abv_stays",
        flagKey: "stays",
        cityId: "ABV",
        enabled: true,
      },
    });
    // Written straight to the table, so it bypasses the invalidation the service
    // performs on a real flag change; drop the warm snapshot by hand.
    await resetCache();
    // The city rule beats the global rule.
    expect((await flagsFor("?cityId=ABV"))["stays"]).toBe(true);
  });

  it("applies a segment only to the users it names", async () => {
    await prisma.flagRule.create({
      data: {
        id: "flr_los_bites_pilot",
        flagKey: "bites",
        cityId: LAGOS_CITY.id,
        enabled: true,
        segment: { userIds: ["usr_pilot"] },
      },
    });

    const pilot = await flagsFor(`?cityId=${LAGOS_CITY.id}`, {
      "x-user-id": "usr_pilot",
    });
    const other = await flagsFor(`?cityId=${LAGOS_CITY.id}`, {
      "x-user-id": "usr_other",
    });
    const anonymous = await flagsFor(`?cityId=${LAGOS_CITY.id}`);

    expect(pilot["bites"]).toBe(true);
    expect(other["bites"]).toBe(false);
    expect(anonymous["bites"]).toBe(false);
  });

  it("evaluates the authenticated user, never a user id supplied by the caller", async () => {
    await prisma.flagRule.create({
      data: {
        id: "flr_los_send_pilot",
        flagKey: "send",
        cityId: LAGOS_CITY.id,
        enabled: true,
        segment: { userIds: ["usr_pilot"] },
      },
    });

    const response = await app.request(
      `/v1/flags?cityId=${LAGOS_CITY.id}&userId=usr_pilot`,
      {
        headers: { "x-user-id": "usr_impostor" },
      },
    );
    expect(response.status).toBe(403);

    // An unauthenticated caller's userId is ignored rather than trusted.
    const anonymous = await flagsFor(
      `?cityId=${LAGOS_CITY.id}&userId=usr_pilot`,
    );
    expect(anonymous["send"]).toBe(false);
  });

  it("reports every known flag key so a client never has to guess", async () => {
    const flags = await flagsFor(`?cityId=${LAGOS_CITY.id}`);
    for (const key of FLAG_KEYS) {
      expect(typeof flags[key]).toBe("boolean");
    }
  });

  it("writes the rule, the audit row and the outbox row in one transaction and busts the cache", async () => {
    // Warm the cache with the pre-change answer.
    expect((await flagsFor(`?cityId=${LAGOS_CITY.id}`))["bites"]).toBe(false);

    const response = await app.request("/v1/flags/bites", {
      method: "PUT",
      headers: adminHeaders("usr_ops", "flag-bites-001"),
      body: JSON.stringify({
        cityId: LAGOS_CITY.id,
        enabled: true,
        reason: "lagos bites launch",
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      from: boolean;
      to: boolean;
      replayed: boolean;
    };
    expect(body).toMatchObject({ from: false, to: true, replayed: false });

    const rule = await prisma.flagRule.findFirstOrThrow({
      where: { flagKey: "bites", cityId: LAGOS_CITY.id },
    });
    expect(rule.enabled).toBe(true);
    expect(rule.updatedBy).toBe("usr_ops");

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "flag.changed",
        subjectId: `flag:bites:${LAGOS_CITY.id}`,
      },
    });
    expect(audit.actorId).toBe("usr_ops");
    expect(audit.before).toEqual({ enabled: false });
    expect(audit.after).toEqual({ enabled: true });

    const outbox = await prisma.outboxEvent.findFirstOrThrow({
      where: { name: "flag.changed" },
    });
    expect(outbox.payload).toEqual({
      key: "bites",
      cityId: LAGOS_CITY.id,
      from: false,
      to: true,
      by: "usr_ops",
    });
    expect(outbox.toVersion).toBe(1);

    // The warmed cache must not survive the change.
    expect((await flagsFor(`?cityId=${LAGOS_CITY.id}`))["bites"]).toBe(true);
  });

  it("replays a flag change under the same idempotency key without a second event", async () => {
    const body = JSON.stringify({
      cityId: LAGOS_CITY.id,
      enabled: true,
      reason: "lagos bites launch",
    });
    const first = await app.request("/v1/flags/bites", {
      method: "PUT",
      headers: adminHeaders("usr_ops", "flag-bites-002"),
      body,
    });
    const second = await app.request("/v1/flags/bites", {
      method: "PUT",
      headers: adminHeaders("usr_ops", "flag-bites-002"),
      body,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(((await second.json()) as { replayed: boolean }).replayed).toBe(
      true,
    );
    expect(
      await prisma.outboxEvent.count({ where: { name: "flag.changed" } }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { action: "flag.changed" } }),
    ).toBe(1);
  });

  it("refuses to create a rule for a flag nobody registered", async () => {
    const response = await app.request("/v1/flags/ghost_vertical", {
      method: "PUT",
      headers: adminHeaders("usr_ops", "flag-ghost-001"),
      body: JSON.stringify({
        cityId: LAGOS_CITY.id,
        enabled: true,
        reason: "should not work",
      }),
    });
    expect(response.status).toBe(404);
    expect(
      await prisma.flagRule.count({ where: { flagKey: "ghost_vertical" } }),
    ).toBe(0);
  });

  it("requires an admin role to change a flag", async () => {
    const response = await app.request("/v1/flags/bites", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-user-id": "usr_rider",
        "x-user-role": "rider",
        "idempotency-key": "flag-rider-001",
      },
      body: JSON.stringify({
        cityId: LAGOS_CITY.id,
        enabled: true,
        reason: "let me in",
      }),
    });
    expect(response.status).toBe(403);
    expect(
      await prisma.outboxEvent.count({ where: { name: "flag.changed" } }),
    ).toBe(0);
  });

  it("evaluates a city with no rules at all as everything off", async () => {
    await prisma.city.create({
      data: {
        id: "KAN",
        name: "Kano",
        country: "NG",
        timezone: "Africa/Lagos",
        active: false,
      },
    });
    const flags = await flagsFor("?cityId=KAN");
    expect(Object.values(flags).some((value) => value)).toBe(false);
  });
});
