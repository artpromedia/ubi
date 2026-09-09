/**
 * The promotion budget ledger: atomic reserve against caps, budget exhaustion,
 * the reservation state machine, and stacking resolution (CLAUDE.md #29, #26).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { money } from "@ubi/contracts";

import {
  closeTestDb,
  idemKey,
  makeDeps,
  seedCampaign,
  testDb,
  uid,
} from "./helpers";
import {
  consume,
  release,
  reserve,
  resolveStacking,
  reverse,
} from "../src/ops/promotions";

import type { GrowthDeps } from "../src/ops/context";
import type { GrowthDb } from "../src/ops/types";

const ACTOR = { id: "sys_promotions", role: "growth_admin" };

describe("promotion budget", () => {
  let db: GrowthDb;
  let deps: GrowthDeps;

  beforeAll(() => {
    db = testDb();
    deps = makeDeps(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("serialises concurrent reservations so the budget is never oversold", async () => {
    // Budget covers exactly five ₦1,000 promises.
    const seeded = await seedCampaign(db, {
      budgetLimitMinor: 5_000,
      currency: "NGN",
    });

    const attempts = await Promise.all(
      Array.from({ length: 12 }, () =>
        reserve(deps, {
          actor: ACTOR,
          cityId: null,
          campaignVersionId: seeded.versionId,
          userId: uid("rider"),
          subjectKind: "quote",
          subjectId: uid("q"),
          adjustmentType: "fare_discount",
          amount: money(1_000, "NGN"),
          expiresAt: null,
          idempotencyKey: idemKey("res"),
          correlationId: null,
        }),
      ),
    );

    const granted = attempts.filter((a) => a.reserved).length;
    expect(granted).toBe(5);

    const budget = await db.campaignBudget.findUnique({
      where: { campaignVersionId: seeded.versionId },
    });
    expect(Number(budget?.reservedMinor)).toBe(5_000);
    expect(budget?.exhaustedAt).not.toBeNull();
  });

  it("denies once the budget is exhausted and records the timestamp", async () => {
    const seeded = await seedCampaign(db, {
      budgetLimitMinor: 2_000,
      currency: "NGN",
    });
    const first = await reserve(deps, {
      actor: ACTOR,
      cityId: null,
      campaignVersionId: seeded.versionId,
      userId: uid("rider"),
      subjectKind: "quote",
      subjectId: uid("q"),
      adjustmentType: "fare_discount",
      amount: money(2_000, "NGN"),
      expiresAt: null,
      idempotencyKey: idemKey("res"),
      correlationId: null,
    });
    expect(first.reserved).toBe(true);

    const second = await reserve(deps, {
      actor: ACTOR,
      cityId: null,
      campaignVersionId: seeded.versionId,
      userId: uid("rider"),
      subjectKind: "quote",
      subjectId: uid("q"),
      adjustmentType: "fare_discount",
      amount: money(1, "NGN"),
      expiresAt: null,
      idempotencyKey: idemKey("res"),
      correlationId: null,
    });
    expect(second.reserved).toBe(false);
    if (!second.reserved) {
      expect(second.reasonCode).toBe("budget_exhausted");
    }
    const exhausted = await db.outboxEvent.findFirst({
      where: { name: "promotion.exhausted", aggregateId: seeded.versionId },
    });
    expect(exhausted).not.toBeNull();
  });

  it("enforces the per-user cap", async () => {
    const seeded = await seedCampaign(db, {
      budgetLimitMinor: 1_000_000,
      caps: { perUser: 1 },
    });
    const rider = uid("rider");
    const one = await reserve(deps, {
      actor: ACTOR,
      cityId: null,
      campaignVersionId: seeded.versionId,
      userId: rider,
      subjectKind: "quote",
      subjectId: uid("q"),
      adjustmentType: "credit",
      amount: money(500, "NGN"),
      expiresAt: null,
      idempotencyKey: idemKey("res"),
      correlationId: null,
    });
    expect(one.reserved).toBe(true);
    const two = await reserve(deps, {
      actor: ACTOR,
      cityId: null,
      campaignVersionId: seeded.versionId,
      userId: rider,
      subjectKind: "quote",
      subjectId: uid("q"),
      adjustmentType: "credit",
      amount: money(500, "NGN"),
      expiresAt: null,
      idempotencyKey: idemKey("res"),
      correlationId: null,
    });
    expect(two.reserved).toBe(false);
    if (!two.reserved) {
      expect(two.reasonCode).toBe("cap_reached");
    }
  });

  it("replays a reservation on the same idempotency key", async () => {
    const seeded = await seedCampaign(db, { budgetLimitMinor: 10_000 });
    const rider = uid("rider");
    const key = idemKey("res");
    const a = await reserve(deps, {
      actor: ACTOR,
      cityId: null,
      campaignVersionId: seeded.versionId,
      userId: rider,
      subjectKind: "quote",
      subjectId: uid("q"),
      adjustmentType: "fare_discount",
      amount: money(1_000, "NGN"),
      expiresAt: null,
      idempotencyKey: key,
      correlationId: null,
    });
    const b = await reserve(deps, {
      actor: ACTOR,
      cityId: null,
      campaignVersionId: seeded.versionId,
      userId: rider,
      subjectKind: "quote",
      subjectId: uid("q"),
      adjustmentType: "fare_discount",
      amount: money(1_000, "NGN"),
      expiresAt: null,
      idempotencyKey: key,
      correlationId: null,
    });
    expect(a.reserved && b.reserved).toBe(true);
    if (a.reserved && b.reserved) {
      expect(b.reservation.id).toBe(a.reservation.id);
      expect(b.replayed).toBe(true);
    }
    const budget = await db.campaignBudget.findUnique({
      where: { campaignVersionId: seeded.versionId },
    });
    expect(Number(budget?.reservedMinor)).toBe(1_000); // not 2,000
  });

  it("walks reserved → consumed and moves budget from reserved to consumed", async () => {
    const seeded = await seedCampaign(db, { budgetLimitMinor: 10_000 });
    const res = await reserve(deps, {
      actor: ACTOR,
      cityId: null,
      campaignVersionId: seeded.versionId,
      userId: uid("rider"),
      subjectKind: "quote",
      subjectId: uid("q"),
      adjustmentType: "fare_discount",
      amount: money(1_500, "NGN"),
      expiresAt: null,
      idempotencyKey: idemKey("res"),
      correlationId: null,
    });
    expect(res.reserved).toBe(true);
    if (!res.reserved) return;
    await consume(deps, {
      actor: ACTOR,
      cityId: null,
      reservationId: res.reservation.id,
      correlationId: null,
    });
    const budget = await db.campaignBudget.findUnique({
      where: { campaignVersionId: seeded.versionId },
    });
    expect(Number(budget?.reservedMinor)).toBe(0);
    expect(Number(budget?.consumedMinor)).toBe(1_500);
  });

  it("refuses an illegal transition (consume after release)", async () => {
    const seeded = await seedCampaign(db, { budgetLimitMinor: 10_000 });
    const res = await reserve(deps, {
      actor: ACTOR,
      cityId: null,
      campaignVersionId: seeded.versionId,
      userId: uid("rider"),
      subjectKind: "quote",
      subjectId: uid("q"),
      adjustmentType: "fare_discount",
      amount: money(1_000, "NGN"),
      expiresAt: null,
      idempotencyKey: idemKey("res"),
      correlationId: null,
    });
    if (!res.reserved) throw new Error("expected reservation");
    await release(deps, {
      actor: ACTOR,
      cityId: null,
      reservationId: res.reservation.id,
      correlationId: null,
    });
    await expect(
      consume(deps, {
        actor: ACTOR,
        cityId: null,
        reservationId: res.reservation.id,
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "illegal_transition" });
  });

  it("reverses a consumed reservation as a compensating entry citing terms", async () => {
    const seeded = await seedCampaign(db, { budgetLimitMinor: 10_000 });
    const res = await reserve(deps, {
      actor: ACTOR,
      cityId: null,
      campaignVersionId: seeded.versionId,
      userId: uid("rider"),
      subjectKind: "quote",
      subjectId: uid("q"),
      adjustmentType: "referral_reward",
      amount: money(2_000, "NGN"),
      expiresAt: null,
      idempotencyKey: idemKey("res"),
      correlationId: null,
    });
    if (!res.reserved) throw new Error("expected reservation");
    await consume(deps, {
      actor: ACTOR,
      cityId: null,
      reservationId: res.reservation.id,
      correlationId: null,
    });
    const reversed = await reverse(deps, {
      actor: ACTOR,
      cityId: null,
      reservationId: res.reservation.id,
      reasonCode: "refunded_trip",
      termsRef: "promotions-terms-v3#4.2",
      correlationId: null,
    });
    expect(reversed.state).toBe("reversed");
    const budget = await db.campaignBudget.findUnique({
      where: { campaignVersionId: seeded.versionId },
    });
    expect(Number(budget?.consumedMinor)).toBe(0);
    expect(Number(budget?.reversedMinor)).toBe(2_000);
    const event = await db.outboxEvent.findFirst({
      where: { name: "promotion.reversed", aggregateId: res.reservation.id },
    });
    expect((event?.payload as { termsRef?: string })?.termsRef).toBe(
      "promotions-terms-v3#4.2",
    );
  });

  it("resolves stacking: higher priority wins, non-mutual benefits are dropped", () => {
    const discount = {
      campaignVersionId: "v1",
      type: "fare_discount" as const,
      priority: 10,
      stacksWith: ["fee_waiver"],
    };
    const waiver = {
      campaignVersionId: "v2",
      type: "fee_waiver" as const,
      priority: 5,
      stacksWith: ["fare_discount"],
    };
    const credit = {
      campaignVersionId: "v3",
      type: "credit" as const,
      priority: 1,
      stacksWith: [],
    };
    const resolution = resolveStacking([credit, discount, waiver]);
    expect(resolution.applied.map((c) => c.campaignVersionId)).toEqual([
      "v1",
      "v2",
    ]);
    expect(resolution.dropped.map((d) => d.candidate.campaignVersionId)).toEqual(
      ["v3"],
    );
  });
});
