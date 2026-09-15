/**
 * City rows and the launch change: the list endpoint, the status endpoint,
 * the launch-pair guard against a real database, and the seed's idempotency.
 */
import type { CitySummary } from "@ubi/contracts";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "@/app";
import { prisma } from "@/lib/prisma";
import { seedLagos } from "@/seed/lagos";
import {
  SEED_ENV,
  adminHeaders,
  closeConnections,
  resetAll,
  seedLaunchCitiesForTest,
} from "@tests/helpers/db";

const app = buildApp();

async function cities(): Promise<CitySummary[]> {
  const response = await app.request("/v1/config/cities");
  expect(response.status).toBe(200);
  return (await response.json()) as CitySummary[];
}

async function changeStatus(
  body: Record<string, unknown>,
  idempotencyKey: string,
  actor = "usr_ops",
): Promise<Response> {
  return app.request("/v1/config/cities/status", {
    method: "POST",
    headers: adminHeaders(actor, idempotencyKey),
    body: JSON.stringify(body),
  });
}

const LAUNCH_FLAGS = [
  "move",
  "ride_request",
  "driver_online",
  "bites",
  "send",
  "flights_booking",
  "stays_booking",
].map((key) => ({ key, enabled: true }));

describe("cities", () => {
  beforeEach(async () => {
    await resetAll();
    await seedLaunchCitiesForTest();
  });

  afterAll(async () => {
    await closeConnections();
  });

  it("lists every row with its launch status, launch cities first", async () => {
    const rows = await cities();
    expect(rows).toHaveLength(10);
    expect(rows.slice(0, 2).map((c) => c.id)).toEqual(["ABV", "LOS"]);
    expect(rows.slice(0, 2).every((c) => c.status === "launching")).toBe(true);
    expect(rows.slice(0, 2).every((c) => c.active === false)).toBe(true);
    expect(rows.slice(2).every((c) => c.status === "planned")).toBe(true);
    const abuja = rows.find((c) => c.id === "ABV");
    expect(abuja).toMatchObject({
      name: "Abuja",
      country: "NG",
      region: "FCT",
      timezone: "Africa/Lagos",
      launchGroup: "ng-launch-2026",
    });
  });

  it("seeds Abuja with an activated provisional config and no flags on", async () => {
    const version = await prisma.cityConfigVersion.findFirstOrThrow({
      where: { cityId: "ABV" },
    });
    expect(version.activatedAt).not.toBeNull();
    const flags = await app.request("/v1/flags?cityId=ABV");
    const map = (await flags.json()) as Record<string, boolean>;
    expect(Object.values(map).some((on) => on)).toBe(false);
  });

  it("refuses to activate one launch city without the other and writes nothing", async () => {
    const response = await changeStatus(
      { cityIds: ["LOS"], status: "active", reason: "lagos only" },
      "launch-001",
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { code: string; details: unknown };
    expect(body.code).toBe("launch_pair_incomplete");
    expect(body.details).toEqual({
      launchGroup: "ng-launch-2026",
      activating: ["LOS"],
      missing: ["ABV"],
    });
    const lagos = await prisma.city.findUniqueOrThrow({ where: { id: "LOS" } });
    expect(lagos.status).toBe("launching");
    expect(lagos.active).toBe(false);
    expect(
      await prisma.outboxEvent.count({
        where: { name: "city.status_changed" },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({ where: { action: "city.status_changed" } }),
    ).toBe(0);
  });

  it("activates both launch cities and their flags in one change, audited and published", async () => {
    // Warm the flag cache for Abuja with the pre-launch answer.
    expect(
      (
        (await (await app.request("/v1/flags?cityId=ABV")).json()) as Record<
          string,
          boolean
        >
      )["bites"],
    ).toBe(false);

    const response = await changeStatus(
      {
        cityIds: ["LOS", "ABV"],
        status: "active",
        flags: LAUNCH_FLAGS,
        reason: "launch day",
      },
      "launch-002",
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      cities: { cityId: string; from: string; to: string }[];
      flags: { key: string; cityId: string; to: boolean }[];
      replayed: boolean;
    };
    expect(body.replayed).toBe(false);
    expect(body.cities).toEqual([
      { cityId: "LOS", from: "launching", to: "active" },
      { cityId: "ABV", from: "launching", to: "active" },
    ]);
    expect(body.flags).toHaveLength(LAUNCH_FLAGS.length * 2);

    const rows = await cities();
    expect(
      rows
        .filter((c) => c.status === "active")
        .map((c) => c.id)
        .sort(),
    ).toEqual(["ABV", "LOS"]);
    expect(
      rows.filter((c) => c.status === "active").every((c) => c.active),
    ).toBe(true);

    const abujaFlags = (await (
      await app.request("/v1/flags?cityId=ABV")
    ).json()) as Record<string, boolean>;
    for (const { key } of LAUNCH_FLAGS) expect(abujaFlags[key]).toBe(true);
    expect(abujaFlags["ai_assistant"]).toBe(false);

    expect(
      await prisma.outboxEvent.count({
        where: { name: "city.status_changed" },
      }),
    ).toBe(2);
    expect(
      await prisma.outboxEvent.count({ where: { name: "flag.changed" } }),
    ).toBe(LAUNCH_FLAGS.length * 2);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "city.status_changed", subjectId: "city:ABV" },
    });
    expect(audit.before).toEqual({ status: "launching" });
    expect(audit.after).toEqual({
      status: "active",
      launchGroup: "ng-launch-2026",
    });

    // Replay under the same key: the original answer, no second event.
    const replay = await changeStatus(
      {
        cityIds: ["LOS", "ABV"],
        status: "active",
        flags: LAUNCH_FLAGS,
        reason: "launch day",
      },
      "launch-002",
    );
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { replayed: boolean }).replayed).toBe(
      true,
    );
    expect(
      await prisma.outboxEvent.count({
        where: { name: "city.status_changed" },
      }),
    ).toBe(2);
  });

  it("lets one launch city be paused after launch", async () => {
    await changeStatus(
      { cityIds: ["LOS", "ABV"], status: "active", reason: "launch day" },
      "launch-003",
    );
    const response = await changeStatus(
      { cityIds: ["LOS"], status: "paused", reason: "incident" },
      "pause-los-001",
    );
    expect(response.status).toBe(200);
    const rows = await cities();
    expect(rows.find((c) => c.id === "LOS")?.status).toBe("paused");
    expect(rows.find((c) => c.id === "LOS")?.active).toBe(false);
    expect(rows.find((c) => c.id === "ABV")?.status).toBe("active");
  });

  it("rejects unknown cities, unknown flags and non-admins", async () => {
    const unknownCity = await changeStatus(
      { cityIds: ["KAN"], status: "launching", reason: "no such row" },
      "bad-city-001",
    );
    expect(unknownCity.status).toBe(404);
    expect(((await unknownCity.json()) as { code: string }).code).toBe(
      "city_unsupported",
    );

    const unknownFlag = await changeStatus(
      {
        cityIds: ["LOS", "ABV"],
        status: "active",
        flags: [{ key: "ghost_vertical", enabled: true }],
        reason: "bad flag",
      },
      "bad-flag-002",
    );
    expect(unknownFlag.status).toBe(404);

    const rider = await app.request("/v1/config/cities/status", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": "usr_rider",
        "x-user-role": "rider",
        "idempotency-key": "bad-role-003",
      },
      body: JSON.stringify({
        cityIds: ["LOS", "ABV"],
        status: "active",
        reason: "let me in",
      }),
    });
    expect(rider.status).toBe(403);
    expect(
      await prisma.outboxEvent.count({
        where: { name: "city.status_changed" },
      }),
    ).toBe(0);
  });

  it("re-running the seed never pulls an activated city back to launching", async () => {
    await changeStatus(
      { cityIds: ["LOS", "ABV"], status: "active", reason: "launch day" },
      "launch-004",
    );
    await seedLagos(SEED_ENV);
    const lagos = await prisma.city.findUniqueOrThrow({ where: { id: "LOS" } });
    expect(lagos.status).toBe("active");
    expect(lagos.active).toBe(true);
  });
});
