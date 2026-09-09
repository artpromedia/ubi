/**
 * A rider discount must never reduce contracted driver earnings (CLAUDE.md #26).
 *
 * When a rider pays a discounted fare, marketing funds the difference so the
 * driver is still made whole. This test proves the money movements a rider
 * discount produces are only ever POSITIVE driver lines — and that a driver
 * rebate on the same trip is likewise a positive, separate line — so no rider
 * discount ever posts a negative line against a driver.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { money } from "@ubi/contracts";

import {
  closeTestDb,
  FakeLedger,
  makeDeps,
  seedCampaign,
  seedIncentiveRule,
  testDb,
  uid,
} from "./helpers";
import { consume, reserve } from "../src/ops/promotions";
import { postRebate } from "../src/ops/incentives";

import type { GrowthDeps } from "../src/ops/context";
import type { GrowthDb } from "../src/ops/types";

const ACTOR = { id: "sys_discount", role: "growth_admin" };

describe("rider discount never posts a negative driver line", () => {
  let db: GrowthDb;

  beforeAll(() => {
    db = testDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("funds the driver via marketing (positive line) and rebates separately", async () => {
    const ledger = new FakeLedger(db);
    const deps: GrowthDeps = makeDeps(db, { ledger });

    const driverId = uid("driver");
    const tripId = uid("trip");

    // A rider fare_discount funded by marketing.
    const discount = await seedCampaign(db, {
      benefitType: "fare_discount",
      budgetLimitMinor: 1_000_000,
      currency: "NGN",
      funding: { party: "ubi_marketing" },
    });
    const reserved = await reserve(deps, {
      actor: ACTOR,
      cityId: null,
      campaignVersionId: discount.versionId,
      userId: uid("rider"),
      subjectKind: "ride",
      subjectId: tripId,
      adjustmentType: "fare_discount",
      amount: money(30_000, "NGN"),
      expiresAt: null,
      idempotencyKey: `disc:${tripId}`,
      correlationId: null,
    });
    expect(reserved.reserved).toBe(true);
    if (!reserved.reserved) return;

    // Consuming the discount tops the driver up by the discounted amount, funded
    // by marketing — a positive driver line, never a deduction.
    await consume(deps, {
      actor: ACTOR,
      cityId: null,
      reservationId: reserved.reservation.id,
      correlationId: null,
      benefitPosting: {
        funding: "ubi_marketing",
        beneficiary: { account: "driver_payout", walletId: null, ref: driverId },
      },
    });

    // A separate driver rebate on the same trip, computed on the CONTRACTED fare
    // (unaffected by what the rider actually paid).
    const rule = await seedIncentiveRule(db, {
      kind: "percentage_points",
      baseBps: 2000,
      reductionBps: 500,
    });
    const rebate = await postRebate(deps, {
      actor: ACTOR,
      cityId: null,
      ruleId: rule.ruleId,
      driverId,
      tripId,
      trip: { fareMinor: 100_000, currency: "NGN", paymentMethod: "wallet" },
      correlationId: null,
    });
    expect(rebate.posted).toBe(true);
    if (rebate.posted) {
      // Rebate is 5% of the full ₦1,000 fare = ₦50, not of a discounted amount.
      expect(rebate.posting.amount.amountMinor).toBe(5_000);
    }

    // The invariant, scoped to THIS trip's own lines (the shared test DB also
    // holds legitimate disclosed reversal lines from other trips): no line the
    // rider discount or this rebate produced against a driver account is
    // negative.
    const driverLines = await db.journalLine.findMany({
      where: {
        account: { startsWith: "driver_" },
        counterpartRef: {
          in: [`reservation:${reserved.reservation.id}`, `trip:${tripId}:rebate`],
        },
      },
    });
    expect(driverLines.length).toBe(2);
    for (const line of driverLines) {
      expect(Number(line.amountMinor)).toBeGreaterThanOrEqual(0);
    }

    // And the discount specifically produced a positive driver_payout line.
    const marketingBenefit = ledger.benefits.at(-1);
    expect(marketingBenefit?.funding).toBe("ubi_marketing");
    expect(marketingBenefit?.beneficiary.account).toBe("driver_payout");
  });
});
