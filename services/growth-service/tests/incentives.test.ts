/**
 * Driver commission incentives (CLAUDE.md #27): rounding, percentage-points vs
 * percent-of-commission, exclusions, cash netting, caps at the boundary, the
 * fleet-split-is-after invariant, reversal, and window boundaries — each a
 * SEPARATE ledger line that never edits the base commission.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeTestDb,
  FakeLedger,
  makeDeps,
  seedIncentiveRule,
  testDb,
  uid,
} from "./helpers";
import {
  computeRebate,
  postRebate,
  postWindowWaiver,
  reverseRebate,
  type RuleRow,
  type TripBreakdown,
} from "../src/ops/incentives";

import type { GrowthDeps } from "../src/ops/context";
import type { GrowthDb } from "../src/ops/types";

const ACTOR = { id: "sys_incentives", role: "growth_admin" };

function ruleRow(overrides: Partial<RuleRow>): RuleRow {
  return {
    id: "r",
    campaignVersionId: "v",
    kind: "percentage_points",
    baseBps: 2000,
    reductionBps: 500,
    appliesTo: "fare_only",
    exclusions: ["tips", "tolls", "taxes"],
    eligibleTripCap: null,
    moneyCapMinor: null,
    zones: [],
    startsAt: null,
    endsAt: null,
    cashSettlement: "nets_against_owed",
    fleetInteraction: "after_rebate",
    rounding: "kobo_per_trip",
    ...overrides,
  };
}

describe("rebate arithmetic (pure)", () => {
  it("rounds one kobo per trip, half away from zero", () => {
    const rule = ruleRow({ kind: "percentage_points", reductionBps: 500 });
    // 3,333 * 5% = 166.65 → 167
    const trip: TripBreakdown = { fareMinor: 3_333, currency: "NGN", paymentMethod: "wallet" };
    expect(computeRebate(rule, trip).amountMinor).toBe(167);
  });

  it("distinguishes percentage_points from percent_of_commission", () => {
    const trip: TripBreakdown = {
      fareMinor: 10_000,
      baseCommissionMinor: 2_000,
      currency: "NGN",
      paymentMethod: "wallet",
    };
    // points: reduce rate by 5% of the fare = 500
    const points = computeRebate(
      ruleRow({ kind: "percentage_points", reductionBps: 500 }),
      trip,
    );
    expect(points.amountMinor).toBe(500);
    expect(points.effectiveBps).toBe(1_500);
    // percent of commission: 10% of the 2,000 commission = 200
    const pct = computeRebate(
      ruleRow({ kind: "percent_of_commission", reductionBps: 1_000 }),
      trip,
    );
    expect(pct.amountMinor).toBe(200);
  });

  it("excludes tips, tolls and taxes from the commissionable base by default", () => {
    const trip: TripBreakdown = {
      fareMinor: 10_000,
      tipsMinor: 2_000,
      tollsMinor: 1_000,
      taxesMinor: 500,
      currency: "NGN",
      paymentMethod: "wallet",
    };
    const excluded = computeRebate(
      ruleRow({ kind: "percentage_points", reductionBps: 500, exclusions: ["tips", "tolls", "taxes"] }),
      trip,
    );
    expect(excluded.amountMinor).toBe(500); // 10,000 base only

    const included = computeRebate(
      ruleRow({ kind: "percentage_points", reductionBps: 500, exclusions: [] }),
      trip,
    );
    expect(included.amountMinor).toBe(675); // 13,500 base
  });

  it("does not let a fleet split change the rebate (split is applied after)", () => {
    const rule = ruleRow({ kind: "percentage_points", reductionBps: 500 });
    const base: TripBreakdown = { fareMinor: 10_000, currency: "NGN", paymentMethod: "wallet" };
    const withSplit: TripBreakdown = { ...base, fleetSplitBps: 6_000 };
    expect(computeRebate(rule, base).amountMinor).toBe(
      computeRebate(rule, withSplit).amountMinor,
    );
  });
});

describe("posting driver incentives", () => {
  let db: GrowthDb;

  beforeAll(() => {
    db = testDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("posts a rebate as a separate positive driver line; cash nets against owed", async () => {
    const ledger = new FakeLedger(db);
    const deps: GrowthDeps = makeDeps(db, { ledger });
    const rule = await seedIncentiveRule(db, {
      kind: "percentage_points",
      baseBps: 2000,
      reductionBps: 500,
    });
    const driverId = uid("driver");
    const walletTripId = uid("trip");
    const cashTripId = uid("trip");

    // Wallet trip: paid out to the driver's wallet.
    const walletTrip = await postRebate(deps, {
      actor: ACTOR,
      cityId: null,
      ruleId: rule.ruleId,
      driverId,
      tripId: walletTripId,
      trip: { fareMinor: 10_000, currency: "NGN", paymentMethod: "wallet" },
      correlationId: null,
    });
    expect(walletTrip.posted).toBe(true);
    if (!walletTrip.posted) return;
    expect(walletTrip.posting.amount.amountMinor).toBe(500);
    expect(ledger.incentives.at(-1)?.settlement).toBe("driver_wallet");

    // Cash trip: netted against what the driver owes UBI.
    const cashTrip = await postRebate(deps, {
      actor: ACTOR,
      cityId: null,
      ruleId: rule.ruleId,
      driverId,
      tripId: cashTripId,
      trip: { fareMinor: 10_000, currency: "NGN", paymentMethod: "cash" },
      correlationId: null,
    });
    expect(cashTrip.posted).toBe(true);
    expect(ledger.incentives.at(-1)?.settlement).toBe("driver_owed");

    // Every driver line these two trips posted is a credit, never negative
    // (scoped to this test's trips; the shared DB also holds disclosed reversal
    // lines from other trips).
    const driverLines = await db.journalLine.findMany({
      where: {
        account: { in: ["driver_payout", "driver_owed"] },
        counterpartRef: {
          in: [`trip:${walletTripId}:rebate`, `trip:${cashTripId}:rebate`],
        },
      },
    });
    expect(driverLines).toHaveLength(2);
    expect(driverLines.map((l) => l.account).sort()).toEqual([
      "driver_owed",
      "driver_payout",
    ]);
    for (const line of driverLines) {
      expect(Number(line.amountMinor)).toBeGreaterThan(0);
    }
  });

  it("caps at the money boundary and stops once the cap is used up", async () => {
    const ledger = new FakeLedger(db);
    const deps: GrowthDeps = makeDeps(db, { ledger });
    const rule = await seedIncentiveRule(db, {
      kind: "percentage_points",
      baseBps: 2000,
      reductionBps: 500,
      moneyCapMinor: 700,
    });
    const driverId = uid("driver");
    const t1 = await postRebate(deps, {
      actor: ACTOR,
      cityId: null,
      ruleId: rule.ruleId,
      driverId,
      tripId: uid("trip"),
      trip: { fareMinor: 10_000, currency: "NGN", paymentMethod: "wallet" },
      correlationId: null,
    });
    const t2 = await postRebate(deps, {
      actor: ACTOR,
      cityId: null,
      ruleId: rule.ruleId,
      driverId,
      tripId: uid("trip"),
      trip: { fareMinor: 10_000, currency: "NGN", paymentMethod: "wallet" },
      correlationId: null,
    });
    const t3 = await postRebate(deps, {
      actor: ACTOR,
      cityId: null,
      ruleId: rule.ruleId,
      driverId,
      tripId: uid("trip"),
      trip: { fareMinor: 10_000, currency: "NGN", paymentMethod: "wallet" },
      correlationId: null,
    });
    expect(t1.posted && t1.posting.amount.amountMinor).toBe(500);
    expect(t2.posted && t2.posting.amount.amountMinor).toBe(200); // capped at boundary
    expect(t3.posted).toBe(false); // cap used up
  });

  it("replays the same trip's rebate instead of posting twice", async () => {
    const ledger = new FakeLedger(db);
    const deps: GrowthDeps = makeDeps(db, { ledger });
    const rule = await seedIncentiveRule(db, {});
    const driverId = uid("driver");
    const tripId = uid("trip");
    const a = await postRebate(deps, {
      actor: ACTOR,
      cityId: null,
      ruleId: rule.ruleId,
      driverId,
      tripId,
      trip: { fareMinor: 10_000, currency: "NGN", paymentMethod: "wallet" },
      correlationId: null,
    });
    const b = await postRebate(deps, {
      actor: ACTOR,
      cityId: null,
      ruleId: rule.ruleId,
      driverId,
      tripId,
      trip: { fareMinor: 10_000, currency: "NGN", paymentMethod: "wallet" },
      correlationId: null,
    });
    expect(a.posted && b.posted).toBe(true);
    if (a.posted && b.posted) {
      expect(b.replayed).toBe(true);
      expect(b.posting.id).toBe(a.posting.id);
    }
    const count = await db.driverIncentivePosting.count({
      where: { tripId, kind: "rebate" },
    });
    expect(count).toBe(1);
  });

  it("reverses a rebate with a separate, disclosed reversal line", async () => {
    const ledger = new FakeLedger(db);
    const deps: GrowthDeps = makeDeps(db, { ledger });
    const rule = await seedIncentiveRule(db, {});
    const driverId = uid("driver");
    const tripId = uid("trip");
    await postRebate(deps, {
      actor: ACTOR,
      cityId: null,
      ruleId: rule.ruleId,
      driverId,
      tripId,
      trip: { fareMinor: 10_000, currency: "NGN", paymentMethod: "wallet" },
      correlationId: null,
    });
    const reversed = await reverseRebate(deps, {
      actor: ACTOR,
      cityId: null,
      tripId,
      reasonCode: "trip_refunded",
      correlationId: null,
    });
    expect(reversed.posted).toBe(true);
    const reversal = await db.driverIncentivePosting.findUnique({
      where: { tripId_kind: { tripId, kind: "rebate_reversal" } },
    });
    expect(reversal).not.toBeNull();
    // The reversal line takes the rebate back (negative driver line).
    const line = await db.journalLine.findUnique({
      where: { id: reversal!.ledgerLineId },
    });
    expect(Number(line?.amountMinor)).toBeLessThan(0);
  });

  it("applies a commission-free window only to trips started inside it", async () => {
    const ledger = new FakeLedger(db);
    const deps: GrowthDeps = makeDeps(db, { ledger });
    const start = new Date("2026-01-01T06:00:00Z");
    const end = new Date("2026-01-01T09:00:00Z");
    const rule = await seedIncentiveRule(db, {
      kind: "window",
      startsAt: start,
      endsAt: end,
    });
    const driverId = uid("driver");

    const inside = await postWindowWaiver(deps, {
      actor: ACTOR,
      cityId: null,
      ruleId: rule.ruleId,
      driverId,
      tripId: uid("trip"),
      trip: {
        fareMinor: 10_000,
        baseCommissionMinor: 2_000,
        currency: "NGN",
        paymentMethod: "wallet",
        startedAt: new Date("2026-01-01T07:00:00Z"),
      },
      correlationId: null,
    });
    expect(inside.posted).toBe(true);
    if (inside.posted) {
      expect(inside.posting.amount.amountMinor).toBe(2_000); // full commission waived
    }

    const outside = await postWindowWaiver(deps, {
      actor: ACTOR,
      cityId: null,
      ruleId: rule.ruleId,
      driverId,
      tripId: uid("trip"),
      trip: {
        fareMinor: 10_000,
        baseCommissionMinor: 2_000,
        currency: "NGN",
        paymentMethod: "wallet",
        startedAt: new Date("2026-01-01T10:00:00Z"),
      },
      correlationId: null,
    });
    expect(outside.posted).toBe(false);
    if (!outside.posted) {
      expect(outside.reasonCode).toBe("outside_window");
    }
  });
});
