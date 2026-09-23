/**
 * The business reserve top-up and the driver payout are MOUNTED in the real
 * service: `/v1/finance/business/reserve-top-up`, `/commit` (which now pays
 * the driver) and `/payouts` through src/index.ts's app, with ride-service's
 * credential — the internal service key. The budget is funded and the
 * driver's commission captured through the domain operations (the organization
 * top-up rail and the award engine are other suites' subjects); every call
 * under test goes through the app.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { commissionMinorFor, money } from "@ubi/contracts";

import {
  actorOf,
  closeTestDb,
  depsAt,
  key,
  seedOrganization,
  testDb,
  uid,
  type OrgCast,
} from "./fixtures";
import {
  BusinessOpResultSchema,
  BusinessReservationStatusSchema,
} from "../../../../packages/contracts/src/business-travel";
import { allocateBudget, topUpOrganization } from "../../src/business/budgets";
import { periodOf } from "../../src/business/ops";
import { balanceOf } from "../../src/ledger/balances";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import { captureHold, reserveHold } from "../../src/ledger/mp-holds";
import { ensureWallet } from "../../src/ledger/wallets";
import { startApp, type AppHarness } from "../fleet/app-harness";
import { fundWallet, seedUser } from "../ledger/helpers";

const INTERNAL_KEY = "business-payout-app-test-internal-service-key";
const db = testDb();
let harness: AppHarness;

beforeAll(async () => {
  harness = await startApp({
    INTERNAL_SERVICE_KEY: INTERNAL_KEY,
    UBI_IDENTITY_SECRET: "business-payout-app-test-identity-secret-0001",
  });
});

afterAll(async () => {
  await harness.close();
  await closeTestDb();
});

function service(extra: Record<string, string> = {}): Record<string, string> {
  return { "x-service-key": INTERNAL_KEY, ...extra };
}

describe("ride-service's business calls through the real app", () => {
  let cast: OrgCast;
  const awardId = uid("award");
  let driverId = "";
  let driverWalletId = "";

  beforeAll(async () => {
    cast = await seedOrganization(db);
    const deps = depsAt(db, new Date());
    await topUpOrganization(
      deps,
      actorOf(cast.owner),
      cast.orgId,
      { methodId: "card", amountMinor: 1_000_000 },
      key(),
    );
    await allocateBudget(
      deps,
      actorOf(cast.owner),
      cast.orgId,
      {
        costCentreId: cast.costCentreId,
        period: periodOf(new Date(), cast.city.timezone),
        amountMinor: 1_000_000,
      },
      key(),
    );
    const driver = await seedUser(db, "Driver");
    driverId = driver.id;
    const config = await createCityConfigProvider(db).load(cast.city.cityId);
    const wallet = await db.$transaction(async (tx) => {
      const ensured = await ensureWallet(tx, "user", driver.id, config.city);
      return ensured;
    });
    driverWalletId = wallet.id;
    await fundWallet(db, wallet.id, "NGN", 200_000);
  });

  it("refuses the internal routes without the service key", async () => {
    for (const [method, path, body] of [
      ["POST", "/v1/finance/business/reserve-top-up", {}],
      ["POST", "/v1/finance/business/payouts", {}],
      ["GET", `/v1/finance/business/payouts/${awardId}`, undefined],
    ] as const) {
      const refused = await harness.send(method, path, {}, body);
      expect(refused.status).toBe(403);
    }
  });

  it("reserves, tops up under the budget, commits the new total and pays the driver", async () => {
    const reserved = await harness.send(
      "POST",
      "/v1/finance/business/reserve",
      service({
        "idempotency-key": `business:${awardId}:reserve`,
        "x-city-id": cast.city.cityId,
      }),
      {
        bookingRef: awardId,
        organizationId: cast.orgId,
        bookerId: cast.booker.id,
        travellerId: cast.traveller.id,
        service: "ride",
        vehicleClass: "go",
        amountMinor: 600_000,
        currency: "NGN",
      },
    );
    expect(reserved.status).toBe(201);

    // The award engine's ONE capture of the driver's 10% at selection.
    const deps = depsAt(db, new Date());
    const hold = await reserveHold(
      deps,
      {
        driverId,
        bidRef: uid("bid"),
        requestRef: uid("req"),
        amountMinor: commissionMinorFor(600_000),
        baseMinor: 600_000,
        currency: "NGN",
        policyVersion: 1,
        cityId: cast.city.cityId,
      },
      key(),
    );
    await captureHold(
      deps,
      hold.hold.reservationId,
      { awardId, expectedAmountMinor: money(60_000, "NGN") },
      key(),
    );

    // An approved amendment raised the fare by 200 000: top up first.
    const topUp = {
      bookingRef: awardId,
      amountMinor: 200_000,
      currency: "NGN",
      reason: "fare_increase",
      reasonRef: "amd_1",
    };
    const noKey = await harness.send(
      "POST",
      "/v1/finance/business/reserve-top-up",
      service(),
      topUp,
    );
    expect(noKey.status).toBe(422);
    const idem = `business:${awardId}:topup:amd_1`;
    const raised = await harness.send(
      "POST",
      "/v1/finance/business/reserve-top-up",
      service({ "idempotency-key": idem }),
      topUp,
    );
    expect(raised.status).toBe(201);
    const parsed = BusinessOpResultSchema.parse(raised.body);
    expect(parsed.reservation.reserved.amountMinor).toBe(800_000);
    const replay = await harness.send(
      "POST",
      "/v1/finance/business/reserve-top-up",
      service({ "idempotency-key": idem }),
      topUp,
    );
    expect(replay.status).toBe(200);
    expect(replay.body.ref).toBe(raised.body.ref);
    // 200 000 left in the budget: a further 300 000 is refused, not credited.
    const refused = await harness.send(
      "POST",
      "/v1/finance/business/reserve-top-up",
      service({ "idempotency-key": `business:${awardId}:topup:wait_1` }),
      {
        ...topUp,
        amountMinor: 300_000,
        reason: "paid_waiting",
        reasonRef: "wait_1",
      },
    );
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      code: "insufficient_spendable",
      details: { reason: "budget_insufficient" },
    });

    const status = await harness.send(
      "GET",
      `/v1/finance/business/reservations/${awardId}`,
      service(),
    );
    expect(status.status).toBe(200);
    expect(
      BusinessReservationStatusSchema.parse(status.body).ops.map((op) => op.op),
    ).toEqual(["reserve", "reserve"]);

    const committed = await harness.send(
      "POST",
      "/v1/finance/business/commit",
      service({ "idempotency-key": `business:${awardId}:commit` }),
      { bookingRef: awardId, actualMinor: 800_000, currency: "NGN" },
    );
    expect(committed.status).toBe(201);

    const payout = await harness.send(
      "GET",
      `/v1/finance/business/payouts/${awardId}`,
      service(),
    );
    expect(payout.status).toBe(200);
    expect(payout.body).toMatchObject({
      state: "paid",
      driverId,
      amount: { amountMinor: 800_000, currency: "NGN" },
      commissionCaptured: { amountMinor: 60_000, currency: "NGN" },
      driverNet: { amountMinor: 740_000, currency: "NGN" },
    });
    // 200 000 − 60 000 at selection + 800 000 now.
    expect(await balanceOf(db, driverWalletId, "NGN")).toEqual(
      money(940_000, "NGN"),
    );

    const retry = await harness.send(
      "POST",
      "/v1/finance/business/payouts",
      service({ "idempotency-key": `business:${awardId}:payout` }),
      { bookingRef: awardId },
    );
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ state: "paid", replayed: true });
    expect(await balanceOf(db, driverWalletId, "NGN")).toEqual(
      money(940_000, "NGN"),
    );
  });
});
