/**
 * Fleet remittance settlement is MOUNTED in the real service (A05):
 * `/v1/finance/fleet` through src/index.ts's app, with the credential
 * production uses — the gateway-signed identity context with role `admin` —
 * and fleet-service's contract B served over real HTTP by the double.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { money } from "@ubi/contracts";

import { startApp, type AppHarness } from "./app-harness";
import {
  closeTestDb,
  driverWallet,
  FLEET_KEY,
  fleetCity,
  FleetServiceDouble,
  item,
  testDb,
  uid,
  weekOf,
} from "./fixtures";
import { addDays } from "../../src/fleet/model";
import { lastCompletedWeekStart } from "../../src/fleet/sweep";
import { balanceOf } from "../../src/ledger/balances";

import type { SeededCity } from "../ledger/helpers";

const IDENTITY_SECRET = "fleet-app-test-signed-identity-secret-00001";
const db = testDb();
const double = new FleetServiceDouble();
let harness: AppHarness;
// Real time: the app's clock is the wall clock.
const WEEK = lastCompletedWeekStart(new Date(), "Africa/Lagos");
const EARLIER = addDays(WEEK, -7);

beforeAll(async () => {
  const baseUrl = await double.start();
  harness = await startApp({
    UBI_IDENTITY_SECRET: IDENTITY_SECRET,
    INTERNAL_SERVICE_KEY: "fleet-app-test-internal-service-key",
    FLEET_SERVICE_URL: baseUrl,
    FLEET_PAYMENT_SERVICE_KEY: FLEET_KEY,
  });
});

afterAll(async () => {
  await harness.close();
  await double.stop();
  await closeTestDb();
});

/** One ops person: run keys are scoped to the signed-in actor. */
const OPS_USER = uid("ops");

async function admin(extra: Record<string, string> = {}, userId = OPS_USER) {
  return {
    "x-ubi-identity": await harness.identity(userId, "admin"),
    ...extra,
  };
}

async function run(
  headers: Record<string, string>,
  body: { cityId: string; weekStart: string },
) {
  const reply = await harness.send(
    "POST",
    "/v1/finance/fleet/settlements/run",
    headers,
    body,
  );
  return reply;
}

describe("fleet settlement through the real app", () => {
  let city: SeededCity;
  const it1 = item({ amountMinor: 700_000, shift: 40, planned: 10 });
  const it2 = item({ type: "percent_of_net", percent: 15 });

  beforeAll(async () => {
    city = await fleetCity(db);
    await driverWallet(db, city, it1.driverId, 1_000_000);
    await driverWallet(db, city, it2.driverId, 100_000);
    double.setWeek(city.cityId, weekOf(WEEK, [it1, it2]));
    double.setWeek(city.cityId, weekOf(EARLIER, []));
  });

  it("is UBI ops only: unsigned 401, a forged context 401, another role 403", async () => {
    const body = { cityId: city.cityId, weekStart: WEEK };
    const unsigned = await run({ "idempotency-key": uid("k") }, body);
    expect(unsigned.status).toBe(401);
    // The plain mirrors are never enough, and the recon router's header-role
    // guard does not stand in for the signed context here.
    const mirrors = await run(
      {
        "idempotency-key": uid("k"),
        "x-user-id": "ops",
        "x-user-role": "ADMIN",
      },
      body,
    );
    expect(mirrors.status).toBe(401);
    const forged = await run(
      {
        "x-ubi-identity": await harness.identity(
          "ops",
          "admin",
          "not-the-identity-secret-at-all-000000",
        ),
        "idempotency-key": uid("k"),
      },
      body,
    );
    expect(forged.status).toBe(401);
    for (const role of ["driver", "rider", "merchant"]) {
      const refused = await run(
        {
          "x-ubi-identity": await harness.identity(uid("u"), role),
          "idempotency-key": uid("k"),
        },
        body,
      );
      expect(refused.status).toBe(403);
    }
    // A service key is not an ops identity either.
    const service = await run(
      {
        "x-service-key": "fleet-app-test-internal-service-key",
        "idempotency-key": uid("k"),
      },
      body,
    );
    expect(service.status).toBe(401);
    expect(double.requests.some((r) => r.cityId === city.cityId)).toBe(false);
  });

  it("requires an Idempotency-Key and a Monday", async () => {
    const noKey = await run(await admin(), {
      cityId: city.cityId,
      weekStart: WEEK,
    });
    expect(noKey.status).toBe(422);
    const tuesday = await run(await admin({ "idempotency-key": uid("k") }), {
      cityId: city.cityId,
      weekStart: addDays(WEEK, 1),
    });
    expect(tuesday.status).toBe(422);
  });

  it("settles the week once, replays the key verbatim, and refuses the key for another week", async () => {
    const key = uid("run");
    const first = await run(await admin({ "idempotency-key": key }), {
      cityId: city.cityId,
      weekStart: WEEK,
    });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      cityId: city.cityId,
      weekStart: WEEK,
      weekEnd: addDays(WEEK, 6),
      zone: "Africa/Lagos",
      replayed: false,
      totals: { items: 2, settled: 2, refused: 0 },
    });
    const items = first.body.items as Array<{
      status: string;
      remittance: { dueMinor: number; collectedMinor: number; fleetId: string };
    }>;
    // 700 000 × 30/40 = 525 000; percent_of_net on no earnings = 0.
    expect(items.map((row) => row.remittance.dueMinor)).toEqual([525_000, 0]);
    const fleetWallet = await db.wallet.findFirstOrThrow({
      where: { ownerType: "fleet", ownerId: it1.fleetId },
    });
    expect(await balanceOf(db, fleetWallet.id, "NGN")).toEqual(
      money(525_000, "NGN"),
    );

    const replay = await run(await admin({ "idempotency-key": key }), {
      cityId: city.cityId,
      weekStart: WEEK,
    });
    expect(replay.status).toBe(200);
    expect({ ...replay.body, replayed: false }).toEqual(first.body);

    const reused = await run(await admin({ "idempotency-key": key }), {
      cityId: city.cityId,
      weekStart: EARLIER,
    });
    expect(reused.status).toBe(409);
    expect(reused.body.code).toBe("idempotency_key_reuse");

    // The same client key from ANOTHER ops person is their own request.
    const colleague = await run(
      await admin({ "idempotency-key": key }, uid("ops")),
      { cityId: city.cityId, weekStart: EARLIER },
    );
    expect(colleague.status).toBe(201);
    expect(colleague.body.totals).toMatchObject({ items: 0 });

    // A fresh key re-runs the week: every item is already settled — replayed.
    const again = await run(await admin({ "idempotency-key": uid("run") }), {
      cityId: city.cityId,
      weekStart: WEEK,
    });
    expect(again.status).toBe(201);
    expect(again.body.totals).toMatchObject({ settled: 0, replayed: 2 });
    expect(await balanceOf(db, fleetWallet.id, "NGN")).toEqual(
      money(525_000, "NGN"),
    );
  });

  it("reads the week's records and a pair's derived carry-forward", async () => {
    const week = await harness.send(
      "GET",
      `/v1/finance/fleet/settlements/${city.cityId}/${WEEK}`,
      await admin(),
    );
    expect(week.status).toBe(200);
    expect(
      (week.body.settlements as Array<{ assignmentId: string }>)
        .map((row) => row.assignmentId)
        .sort(),
    ).toEqual([it1.assignmentId, it2.assignmentId].sort());
    const carry = await harness.send(
      "GET",
      `/v1/finance/fleet/carry-forward/${it1.fleetId}/${it1.driverId}?currency=NGN`,
      await admin(),
    );
    expect(carry.status).toBe(200);
    expect(carry.body).toMatchObject({
      outstanding: { amountMinor: 0, currency: "NGN" },
      origins: [],
    });
    const noCurrency = await harness.send(
      "GET",
      `/v1/finance/fleet/carry-forward/${it1.fleetId}/${it1.driverId}`,
      await admin(),
    );
    expect(noCurrency.status).toBe(422);
  });

  it("is deny-by-default: a city with the fleet flag off answers 404 and asks fleet-service nothing", async () => {
    const off = await fleetCity(db, { fleet: false });
    const refused = await run(await admin({ "idempotency-key": uid("k") }), {
      cityId: off.cityId,
      weekStart: WEEK,
    });
    expect(refused.status).toBe(404);
    expect(refused.body.code).toBe("feature_disabled");
    expect(double.requests.some((r) => r.cityId === off.cityId)).toBe(false);
  });

  it("fails closed when fleet-service's key is not configured: 503, nothing settled", async () => {
    const other = await fleetCity(db);
    const pending = item({ amountMinor: 100_000 });
    await driverWallet(db, other, pending.driverId, 1_000_000);
    double.setWeek(other.cityId, weekOf(WEEK, [pending]));
    const saved = process.env.FLEET_PAYMENT_SERVICE_KEY;
    process.env.FLEET_PAYMENT_SERVICE_KEY = "too-short";
    try {
      const refused = await run(await admin({ "idempotency-key": uid("k") }), {
        cityId: other.cityId,
        weekStart: WEEK,
      });
      expect(refused.status).toBe(503);
      expect(refused.body.code).toBe("service_unavailable");
    } finally {
      process.env.FLEET_PAYMENT_SERVICE_KEY = saved;
    }
    expect(
      await db.outboxEvent.count({
        where: { aggregateId: pending.assignmentId },
      }),
    ).toBe(0);
    // With the key back, the same week settles.
    const settled = await run(await admin({ "idempotency-key": uid("k") }), {
      cityId: other.cityId,
      weekStart: WEEK,
    });
    expect(settled.status).toBe(201);
    expect(settled.body.totals).toMatchObject({ settled: 1 });
  });
});
