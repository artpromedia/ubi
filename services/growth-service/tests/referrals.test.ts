/**
 * Referrals (CLAUDE.md #28): server-verified qualification and reward, abuse
 * signals routed to HUMAN review (never auto-denied), reversal as a compensating
 * entry, and attribution that tells organic from unknown.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeTestDb,
  makeDeps,
  seedCampaign,
  testDb,
  uid,
} from "./helpers";
import {
  claimAttribution,
  decideReview,
  qualifyReferral,
  referralCodeFor,
  reverseReferral,
  share,
} from "../src/ops/referrals";

import type { GrowthDeps } from "../src/ops/context";
import type { GrowthDb } from "../src/ops/types";

const REVIEWER = { id: "reviewer_1", role: "growth_admin" };

async function seedReferralProgram(db: GrowthDb): Promise<string> {
  const seeded = await seedCampaign(db, {
    benefitType: "referral",
    budgetLimitMinor: 10_000_000,
    currency: "NGN",
    value: {
      reward: { amountMinor: 200_000, currency: "NGN" },
      refereeBenefit: { amountMinor: 100_000, currency: "NGN" },
      monthlyCap: 10,
      qualifyingEvent: "first completed and paid ride",
    },
  });
  return seeded.versionId;
}

describe("attribution claim", () => {
  let db: GrowthDb;
  let deps: GrowthDeps;

  beforeAll(() => {
    db = testDb();
    deps = makeDeps(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("records organic when nothing was presented", async () => {
    const result = await claimAttribution(deps, {
      actor: { id: uid("rider"), role: "rider" },
      cityId: null,
      source: "manual",
      correlationId: null,
    });
    expect(result).toEqual({ attributed: false, kind: "organic" });
  });

  it("records unknown when a code matched nothing", async () => {
    const result = await claimAttribution(deps, {
      actor: { id: uid("rider"), role: "rider" },
      cityId: null,
      code: "NOPE1234",
      source: "deferred_link",
      correlationId: null,
    });
    expect(result).toEqual({ attributed: false, kind: "unknown" });
  });

  it("attributes a real referral code back to the referrer", async () => {
    await seedReferralProgram(db);
    const referrer = { id: uid("rider"), role: "rider" };
    const { code } = await share(deps, referrer);
    expect(code).toBe(referralCodeFor(referrer.id));

    const referee = { id: uid("rider"), role: "rider" };
    const result = await claimAttribution(deps, {
      actor: referee,
      cityId: null,
      code,
      source: "deferred_link",
      correlationId: null,
    });
    expect(result).toEqual({ attributed: true, kind: "referral" });

    const referral = await db.referral.findFirst({
      where: { refereeId: referee.id },
    });
    expect(referral?.stage).toBe("installed");
  });

  it("is first-touch immutable", async () => {
    const rider = { id: uid("rider"), role: "rider" };
    const first = await claimAttribution(deps, {
      actor: rider,
      cityId: null,
      source: "manual",
      correlationId: null,
    });
    const second = await claimAttribution(deps, {
      actor: rider,
      cityId: null,
      code: "LATE1234",
      source: "manual",
      correlationId: null,
    });
    expect(second.kind).toBe(first.kind); // still organic
  });
});

describe("qualification and reward", () => {
  let db: GrowthDb;
  let deps: GrowthDeps;

  beforeAll(() => {
    db = testDb();
    deps = makeDeps(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function installedReferral(): Promise<string> {
    await seedReferralProgram(db);
    const referrer = { id: uid("rider"), role: "rider" };
    const { code } = await share(deps, referrer);
    const referee = { id: uid("rider"), role: "rider" };
    await claimAttribution(deps, {
      actor: referee,
      cityId: null,
      code,
      source: "deferred_link",
      correlationId: null,
    });
    const referral = await db.referral.findFirst({
      where: { refereeId: referee.id },
    });
    return referral!.id;
  }

  it("rewards a clean referral and reverses it citing the terms version", async () => {
    const referralId = await installedReferral();
    const result = await qualifyReferral(deps, {
      actor: { id: "system", role: "growth_admin" },
      cityId: null,
      referralId,
      qualifyingRideId: uid("ride"),
      correlationId: null,
    });
    expect(result.outcome).toBe("rewarded");

    const rewarded = await db.referral.findUnique({ where: { id: referralId } });
    expect(rewarded?.stage).toBe("rewarded");
    const rewardReservation = await db.promotionReservation.findFirst({
      where: { subjectId: referralId, adjustmentType: "referral_reward" },
    });
    expect(rewardReservation?.state).toBe("consumed");

    await reverseReferral(deps, {
      actor: REVIEWER,
      cityId: null,
      referralId,
      reasonCode: "referee_refunded",
      termsRef: "referral-terms-v2#3",
      correlationId: null,
    });
    const reversed = await db.referral.findUnique({ where: { id: referralId } });
    expect(reversed?.stage).toBe("reversed");
    const reservationAfter = await db.promotionReservation.findFirst({
      where: { subjectId: referralId, adjustmentType: "referral_reward" },
    });
    expect(reservationAfter?.state).toBe("reversed");
    expect(reservationAfter?.termsRef).toBe("referral-terms-v2#3");
  });

  it("routes shared-device signals to human review and never auto-denies", async () => {
    const referralId = await installedReferral();
    const result = await qualifyReferral(deps, {
      actor: { id: "system", role: "growth_admin" },
      cityId: null,
      referralId,
      qualifyingRideId: uid("ride"),
      signals: [
        { rule: "shared_device", severity: "high", text: "same device fingerprint" },
      ],
      correlationId: null,
    });
    expect(result.outcome).toBe("in_review");

    const held = await db.referral.findUnique({ where: { id: referralId } });
    expect(held?.stage).toBe("in_review"); // held, not denied

    if (result.outcome !== "in_review") return;
    // A human qualifies it — the reward flows only then.
    const decision = await decideReview(deps, {
      actor: REVIEWER,
      cityId: null,
      caseId: result.caseId,
      decision: "qualify",
      reasonCode: "household_sharing_ok",
      correlationId: null,
    });
    expect(decision.stage).toBe("rewarded");
    const rewarded = await db.referral.findUnique({ where: { id: referralId } });
    expect(rewarded?.stage).toBe("rewarded");
  });

  it("lets a human deny a reviewed referral (deny is a decision, not an auto-action)", async () => {
    const referralId = await installedReferral();
    const result = await qualifyReferral(deps, {
      actor: { id: "system", role: "growth_admin" },
      cityId: null,
      referralId,
      qualifyingRideId: uid("ride"),
      signals: [{ rule: "shared_payment", severity: "high", text: "same card" }],
      correlationId: null,
    });
    if (result.outcome !== "in_review") throw new Error("expected review");
    const decision = await decideReview(deps, {
      actor: REVIEWER,
      cityId: null,
      caseId: result.caseId,
      decision: "deny",
      reasonCode: "confirmed_self_referral",
      correlationId: null,
    });
    expect(decision.stage).toBe("expired");
    const noReward = await db.promotionReservation.findFirst({
      where: { subjectId: referralId, adjustmentType: "referral_reward" },
    });
    expect(noReward).toBeNull();
  });
});
