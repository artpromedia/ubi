/**
 * Referrals (CLAUDE.md #28; contracts/openapi/promotions.yaml + growth-ops.yaml).
 *
 * A referral is only rewarded from server-verified events — a referee's first
 * paid ride, or a referred driver's KYC approval plus milestone trips. The
 * reward itself is a promotion reservation that is consumed on qualification and
 * reversed by a compensating entry (citing the terms version) if it later turns
 * out not to have qualified. Two rules are load-bearing:
 *
 *  - Shared-device / shared-payment signals route a referral to HUMAN review;
 *    they never auto-deny. Household sharing is legitimate until a person
 *    decides otherwise (CLAUDE.md #28).
 *  - A reversal is a compensating entry, never an undisclosed negative balance.
 *
 * The referral state machine is invited → installed → qualifying →
 * (rewarded | in_review | expired), rewarded ⇄ reversed.
 */
import { createHash } from "node:crypto";

import {
  assertTransition,
  ContractError,
  money,
  scopedIdempotencyKey,
  type Money,
} from "@ubi/contracts";

import { auditedTransaction, type OutboxInput } from "./audit";
import { isUniqueViolation } from "./errors";
import { toJson } from "./json";
import { consume, reserve, reverse } from "./promotions";
import { actorTypeFor, assertPermission } from "./roles";
import { deterministicId } from "../lib/ids";

import type { GrowthDeps } from "./context";
import type { Actor, JsonRecord, JsonValue } from "./types";

const MACHINE = "referral" as const;

const REFERRAL_URL_BASE =
  process.env.REFERRAL_URL_BASE ?? "https://ubi.africa/r";

export function referralCodeFor(userId: string): string {
  const digest = createHash("sha256").update(`referral:${userId}`).digest("hex");
  return `R${digest.slice(0, 8).toUpperCase()}`;
}

interface ReferralProgramVersion {
  id: string;
  currency: string;
  value: unknown;
  windowEnd: Date;
}

/** The single active referral programme, if one is live. */
async function activeProgram(
  deps: GrowthDeps,
): Promise<ReferralProgramVersion | null> {
  const version = await deps.db.campaignVersion.findFirst({
    where: {
      campaign: { benefitType: "referral", state: "active" },
    },
    orderBy: { version: "desc" },
    select: { id: true, currency: true, value: true, windowEnd: true },
  });
  return version;
}

function rewardOf(version: ReferralProgramVersion): Money {
  const value = version.value as { reward?: { amountMinor?: number; currency?: string } } | null;
  const amountMinor = value?.reward?.amountMinor ?? 0;
  const currency = value?.reward?.currency ?? version.currency;
  return money(amountMinor, currency);
}

function refereeBenefitOf(version: ReferralProgramVersion): Money {
  const value = version.value as {
    refereeBenefit?: { amountMinor?: number; currency?: string };
  } | null;
  return money(
    value?.refereeBenefit?.amountMinor ?? 0,
    value?.refereeBenefit?.currency ?? version.currency,
  );
}

function monthlyCapOf(version: ReferralProgramVersion): number | null {
  const value = version.value as { monthlyCap?: number } | null;
  return value?.monthlyCap ?? null;
}

// ---------------------------------------------------------------------------
// Rider-facing reads
// ---------------------------------------------------------------------------

export interface ReferralProgramView {
  readonly code: string;
  readonly url: string;
  readonly reward: Money;
  readonly refereeBenefit: Money;
  readonly qualifyingEvent: string;
  readonly monthlyCap: number | null;
  readonly earnedTotal: Money;
  readonly referrals: readonly JsonRecord[];
}

export async function getProgram(
  deps: GrowthDeps,
  actor: Actor,
): Promise<ReferralProgramView> {
  assertPermission(actor.role, "referrals.self");
  const program = await activeProgram(deps);
  const code = referralCodeFor(actor.id);
  const url = `${REFERRAL_URL_BASE}/${code}`;
  const currency = program?.currency ?? "NGN";

  const referrals = await deps.db.referral.findMany({
    where: { referrerId: actor.id, refereeId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // Earned total is derived from consumed referral_reward reservations, never
  // stored (CLAUDE.md #4).
  const rewarded = await deps.db.promotionReservation.findMany({
    where: {
      userId: actor.id,
      adjustmentType: "referral_reward",
      subjectKind: "referral",
      state: "consumed",
    },
  });
  const earnedMinor = rewarded.reduce((sum, r) => sum + Number(r.amountMinor), 0);

  return {
    code,
    url,
    reward: program === null ? money(0, currency) : rewardOf(program),
    refereeBenefit:
      program === null ? money(0, currency) : refereeBenefitOf(program),
    qualifyingEvent:
      (program?.value as { qualifyingEvent?: string } | null)?.qualifyingEvent ??
      "first completed and paid ride",
    monthlyCap: program === null ? null : monthlyCapOf(program),
    earnedTotal: money(earnedMinor, currency),
    referrals: referrals.map((r) => ({
      id: r.id,
      stage: r.stage,
      initials: r.refereeId === null ? null : maskInitials(r.refereeId),
      deadline: r.deadline?.toISOString().slice(0, 10) ?? null,
    })),
  };
}

/** Two opaque letters so the referrer recognises a row without seeing the referee. */
function maskInitials(id: string): string {
  const digest = createHash("sha256").update(id).digest("hex");
  const a = (digest.charCodeAt(0) % 26) + 65;
  const b = (digest.charCodeAt(1) % 26) + 65;
  return String.fromCharCode(a, b);
}

export async function getReferral(
  deps: GrowthDeps,
  actor: Actor,
  id: string,
): Promise<JsonRecord> {
  assertPermission(actor.role, "referrals.self");
  const row = await deps.db.referral.findUnique({ where: { id } });
  if (row === null || row.referrerId !== actor.id) {
    throw new ContractError("not_found", "no such referral", { id });
  }
  return {
    id: row.id,
    stage: row.stage,
    initials: row.refereeId === null ? null : maskInitials(row.refereeId),
    deadline: row.deadline?.toISOString().slice(0, 10) ?? null,
  };
}

export async function share(
  deps: GrowthDeps,
  actor: Actor,
): Promise<{ code: string; url: string }> {
  assertPermission(actor.role, "referrals.self");
  const code = referralCodeFor(actor.id);
  const url = `${REFERRAL_URL_BASE}/${code}`;

  // If a programme is live, plant a template referral so a claimant can be
  // resolved back to this referrer by code. Nothing is created without one.
  const program = await activeProgram(deps);
  if (program !== null) {
    const templateId = deterministicId("ref", `template:${program.id}:${actor.id}`);
    const existing = await deps.db.referral.findUnique({ where: { id: templateId } });
    if (existing === null) {
      await deps.db.referral.create({
        data: {
          id: templateId,
          programVersionId: program.id,
          referrerId: actor.id,
          refereeId: null,
          code,
          stage: "invited",
        },
      });
    }
  }
  return { code, url };
}

// ---------------------------------------------------------------------------
// Attribution claim (first app open / web handoff)
// ---------------------------------------------------------------------------

export type AttributionKind = "referral" | "campaign" | "unknown" | "organic";

export interface ClaimInput {
  readonly actor: Actor;
  readonly cityId: string | null;
  readonly code?: string;
  readonly token?: string;
  readonly campaign?: string;
  readonly source: string;
  readonly correlationId: string | null;
}

export async function claimAttribution(
  deps: GrowthDeps,
  input: ClaimInput,
): Promise<{ attributed: boolean; kind: AttributionKind }> {
  assertPermission(input.actor.role, "referrals.self");

  // Attribution is first-touch: once claimed it is immutable (unique user_id).
  const already = await deps.db.attributionClaim.findUnique({
    where: { userId: input.actor.id },
  });
  if (already !== null) {
    return {
      attributed: already.kind === "referral" || already.kind === "campaign",
      kind: already.kind as AttributionKind,
    };
  }

  let kind: AttributionKind = "organic";
  let referrerId: string | null = null;
  let programVersionId: string | null = null;

  if (input.code !== undefined && input.code.length > 0) {
    const template = await deps.db.referral.findFirst({
      where: { code: input.code },
      orderBy: { createdAt: "asc" },
    });
    if (template !== null && template.referrerId !== input.actor.id) {
      kind = "referral";
      referrerId = template.referrerId;
      programVersionId = template.programVersionId;
    } else {
      kind = "unknown";
    }
  } else if (input.campaign !== undefined && input.campaign.length > 0) {
    const campaign = await deps.db.campaign.findFirst({
      where: { id: input.campaign, state: { in: ["active", "scheduled"] } },
    });
    kind = campaign === null ? "unknown" : "campaign";
  } else if (input.token !== undefined && input.token.length > 0) {
    kind = "unknown";
  }

  const now = deps.now();
  const claimId = deterministicId("attr", `attr:${input.actor.id}`);

  try {
    await auditedTransaction(deps.db, async (tx) => {
      await tx.attributionClaim.create({
        data: {
          id: claimId,
          userId: input.actor.id,
          source: input.source,
          code: input.code ?? null,
          campaign: input.campaign ?? null,
          token: input.token ?? null,
          kind,
        },
      });

      const events: OutboxInput[] = [
        {
          name: "attribution.claimed",
          aggregateType: "user",
          aggregateId: input.actor.id,
          fromVersion: null,
          toVersion: 0,
          actor: input.actor,
          actorType: actorTypeFor(input.actor.role),
          cityId: input.cityId,
          idempotencyKey: `attribution.claimed:${input.actor.id}`,
          correlationId: input.correlationId,
          occurredAt: now,
          payload: {
            userId: input.actor.id,
            source: input.source,
            campaign: input.campaign ?? null,
            kind,
            unknown: kind === "unknown",
          },
        },
      ];

      if (kind === "referral" && referrerId !== null && programVersionId !== null) {
        const referralId = deterministicId(
          "ref",
          `claim:${programVersionId}:${referrerId}:${input.actor.id}`,
        );
        await tx.referral.create({
          data: {
            id: referralId,
            programVersionId,
            referrerId,
            refereeId: input.actor.id,
            code: input.code ?? referralCodeFor(referrerId),
            stage: "invited",
          },
        });
        assertTransition(MACHINE, "invited", "installed");
        await tx.referral.update({
          where: { id: referralId },
          data: { stage: "installed", stageAt: now },
        });
        events.push({
          name: "referral.created",
          aggregateType: "referral",
          aggregateId: referralId,
          fromVersion: null,
          toVersion: 0,
          actor: input.actor,
          actorType: actorTypeFor(input.actor.role),
          cityId: input.cityId,
          idempotencyKey: `referral.created:${referralId}`,
          correlationId: input.correlationId,
          occurredAt: now,
          payload: { referralId, stage: "invited" },
        });
        events.push({
          name: "referral.installed",
          aggregateType: "referral",
          aggregateId: referralId,
          fromVersion: 0,
          toVersion: 1,
          actor: input.actor,
          actorType: actorTypeFor(input.actor.role),
          cityId: input.cityId,
          idempotencyKey: `referral.installed:${referralId}`,
          correlationId: input.correlationId,
          occurredAt: now,
          payload: { referralId, stage: "installed" },
        });
      }

      return {
        result: null,
        audit: {
          actor: input.actor,
          action: "growth.attribution.claimed",
          subjectType: "user",
          subjectId: input.actor.id,
          reason: `attribution ${kind}`,
          before: null,
          after: { kind, source: input.source },
          correlationId: input.correlationId,
        },
        events,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await deps.db.attributionClaim.findUnique({
        where: { userId: input.actor.id },
      });
      if (existing !== null) {
        return {
          attributed: existing.kind === "referral" || existing.kind === "campaign",
          kind: existing.kind as AttributionKind,
        };
      }
    }
    throw error;
  }

  return {
    attributed: kind === "referral" || kind === "campaign",
    kind,
  };
}

// ---------------------------------------------------------------------------
// Qualification (server-verified) and reward
// ---------------------------------------------------------------------------

export interface AbuseSignal {
  readonly rule: string;
  readonly severity: "info" | "warn" | "high";
  readonly text: string;
}

export interface QualifyInput {
  readonly actor: Actor;
  readonly cityId: string | null;
  readonly referralId: string;
  /** The server-verified event that could qualify this referral. */
  readonly qualifyingRideId: string;
  readonly signals?: readonly AbuseSignal[];
  readonly correlationId: string | null;
}

export type QualifyResult =
  | { readonly outcome: "rewarded"; readonly rewardReservationId: string }
  | { readonly outcome: "in_review"; readonly caseId: string }
  | { readonly outcome: "reward_pending"; readonly reasonCode: string };

/**
 * Verifies a referral against a paid-ride event. Abuse signals never deny — a
 * high-severity signal opens a review case and holds the reward for a human
 * (CLAUDE.md #28). Everything else rewards the referrer through a promotion
 * reservation that is reserved and consumed against the programme budget.
 */
export async function qualifyReferral(
  deps: GrowthDeps,
  input: QualifyInput,
): Promise<QualifyResult> {
  const referral = await deps.db.referral.findUnique({
    where: { id: input.referralId },
  });
  if (referral === null) {
    throw new ContractError("not_found", "no such referral", {
      referralId: input.referralId,
    });
  }
  const now = deps.now();

  // Move installed → qualifying so qualification always happens from that state.
  if (referral.stage === "installed") {
    assertTransition(MACHINE, "installed", "qualifying");
    await auditedTransaction(deps.db, async (tx) => {
      await tx.referral.update({
        where: { id: referral.id },
        data: { stage: "qualifying", stageAt: now, qualifyingRideId: input.qualifyingRideId },
      });
      return {
        result: null,
        audit: {
          actor: input.actor,
          action: "growth.referral.qualifying",
          subjectType: "referral",
          subjectId: referral.id,
          reason: "referee produced a candidate qualifying event",
          before: { stage: referral.stage },
          after: { stage: "qualifying" },
          correlationId: input.correlationId,
        },
      };
    });
    referral.stage = "qualifying";
  }
  if (referral.stage !== "qualifying") {
    throw new ContractError("conflict", "referral is not awaiting qualification", {
      stage: referral.stage,
    });
  }

  const highSignals = (input.signals ?? []).filter((s) => s.severity === "high");
  if (highSignals.length > 0) {
    // Human review — never an auto-deny.
    const caseId = deterministicId("rvc", `review:${referral.id}`);
    await auditedTransaction(deps.db, async (tx) => {
      assertTransition(MACHINE, "qualifying", "in_review");
      await tx.referralReviewCase.create({
        data: {
          id: caseId,
          referralId: referral.id,
          signals: toJson(input.signals ?? []),
          openedAt: now,
        },
      });
      await tx.referral.update({
        where: { id: referral.id },
        data: { stage: "in_review", stageAt: now },
      });
      return {
        result: null,
        audit: {
          actor: input.actor,
          action: "growth.referral.review_requested",
          subjectType: "referral",
          subjectId: referral.id,
          reason: "abuse signals require human review",
          before: { stage: "qualifying" },
          after: { stage: "in_review", signalCount: (input.signals ?? []).length },
          correlationId: input.correlationId,
        },
        events: [
          {
            name: "referral.review_requested",
            aggregateType: "referral",
            aggregateId: referral.id,
            fromVersion: 2,
            toVersion: 3,
            actor: input.actor,
            actorType: actorTypeFor(input.actor.role),
            cityId: input.cityId,
            idempotencyKey: `referral.review_requested:${referral.id}`,
            correlationId: input.correlationId,
            occurredAt: now,
            payload: { referralId: referral.id, caseId },
          },
        ],
      };
    });
    return { outcome: "in_review", caseId };
  }

  return rewardReferral(deps, {
    actor: input.actor,
    cityId: input.cityId,
    referralId: referral.id,
    referrerId: referral.referrerId,
    programVersionId: referral.programVersionId,
    fromStage: "qualifying",
    correlationId: input.correlationId,
  });
}

/**
 * Rewards the referrer: reserve then consume a referral_reward promotion, then
 * move the referral to `rewarded`. If the programme budget cannot cover the
 * reward, the referral stays put with a reason rather than paying from nowhere.
 */
async function rewardReferral(
  deps: GrowthDeps,
  input: {
    actor: Actor;
    cityId: string | null;
    referralId: string;
    referrerId: string;
    programVersionId: string;
    fromStage: string;
    correlationId: string | null;
  },
): Promise<QualifyResult> {
  const program = await deps.db.campaignVersion.findUnique({
    where: { id: input.programVersionId },
    select: { id: true, currency: true, value: true, windowEnd: true },
  });
  if (program === null) {
    throw new ContractError("not_found", "referral programme version is gone");
  }
  const reward = rewardOf(program);
  if (reward.amountMinor <= 0) {
    throw new ContractError("validation_failed", "referral programme has no reward configured");
  }
  const now = deps.now();

  // Monthly cap on referral rewards (from the programme value).
  const cap = monthlyCapOf(program);
  if (cap !== null) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const rewardedThisMonth = await deps.db.promotionReservation.count({
      where: {
        userId: input.referrerId,
        adjustmentType: "referral_reward",
        subjectKind: "referral",
        state: "consumed",
        createdAt: { gte: monthStart },
      },
    });
    if (rewardedThisMonth >= cap) {
      return { outcome: "reward_pending", reasonCode: "monthly_cap_reached" };
    }
  }

  const reserved = await reserve(deps, {
    actor: input.actor,
    cityId: input.cityId,
    campaignVersionId: input.programVersionId,
    userId: input.referrerId,
    subjectKind: "referral",
    subjectId: input.referralId,
    adjustmentType: "referral_reward",
    amount: reward,
    expiresAt: program.windowEnd,
    idempotencyKey: scopedIdempotencyKey("referral.reward", input.referralId, input.referralId),
    correlationId: input.correlationId,
  });
  if (!reserved.reserved) {
    return { outcome: "reward_pending", reasonCode: reserved.reasonCode };
  }

  await consume(deps, {
    actor: input.actor,
    cityId: input.cityId,
    reservationId: reserved.reservation.id,
    correlationId: input.correlationId,
  });

  const rewardEvents: OutboxInput[] = [
    {
      name: "referral.qualified",
      aggregateType: "referral",
      aggregateId: input.referralId,
      fromVersion: 2,
      toVersion: 3,
      actor: input.actor,
      actorType: actorTypeFor(input.actor.role),
      cityId: input.cityId,
      idempotencyKey: `referral.qualified:${input.referralId}`,
      correlationId: input.correlationId,
      occurredAt: now,
      payload: { referralId: input.referralId },
    },
    {
      name: "referral.rewarded",
      aggregateType: "referral",
      aggregateId: input.referralId,
      fromVersion: 3,
      toVersion: 4,
      actor: input.actor,
      actorType: actorTypeFor(input.actor.role),
      cityId: input.cityId,
      idempotencyKey: `referral.rewarded:${input.referralId}`,
      correlationId: input.correlationId,
      occurredAt: now,
      payload: {
        referralId: input.referralId,
        reservationId: reserved.reservation.id,
        amountMinor: reward.amountMinor,
      },
    },
  ];
  await auditedTransaction(deps.db, async (tx) => {
    assertTransition(MACHINE, input.fromStage, "rewarded");
    await tx.referral.update({
      where: { id: input.referralId },
      data: { stage: "rewarded", stageAt: now },
    });
    return {
      result: null,
      audit: {
        actor: input.actor,
        action: "growth.referral.rewarded",
        subjectType: "referral",
        subjectId: input.referralId,
        reason: "referral qualified and reward consumed",
        before: { stage: input.fromStage },
        after: { stage: "rewarded", reservationId: reserved.reservation.id },
        correlationId: input.correlationId,
      },
      events: rewardEvents,
    };
  });

  return { outcome: "rewarded", rewardReservationId: reserved.reservation.id };
}

// ---------------------------------------------------------------------------
// Reversal — compensating entry citing the terms version (CLAUDE.md #28)
// ---------------------------------------------------------------------------

export async function reverseReferral(
  deps: GrowthDeps,
  input: {
    actor: Actor;
    cityId: string | null;
    referralId: string;
    reasonCode: string;
    termsRef: string;
    correlationId: string | null;
  },
): Promise<void> {
  const referral = await deps.db.referral.findUnique({
    where: { id: input.referralId },
  });
  if (referral === null) {
    throw new ContractError("not_found", "no such referral", {
      referralId: input.referralId,
    });
  }
  assertTransition(MACHINE, referral.stage, "reversed");

  const rewardReservation = await deps.db.promotionReservation.findFirst({
    where: {
      subjectKind: "referral",
      subjectId: input.referralId,
      adjustmentType: "referral_reward",
      state: "consumed",
    },
  });
  if (rewardReservation !== null) {
    // The compensating entry against the programme budget, citing the terms.
    await reverse(deps, {
      actor: input.actor,
      cityId: input.cityId,
      reservationId: rewardReservation.id,
      reasonCode: input.reasonCode,
      termsRef: input.termsRef,
      correlationId: input.correlationId,
    });
  }

  const now = deps.now();
  await auditedTransaction(deps.db, async (tx) => {
    await tx.referral.update({
      where: { id: input.referralId },
      data: { stage: "reversed", stageAt: now },
    });
    return {
      result: null,
      audit: {
        actor: input.actor,
        action: "growth.referral.reversed",
        subjectType: "referral",
        subjectId: input.referralId,
        reason: input.reasonCode,
        before: { stage: referral.stage },
        after: { stage: "reversed", termsRef: input.termsRef },
        correlationId: input.correlationId,
      },
      events: [
        {
          name: "referral.reversed",
          aggregateType: "referral",
          aggregateId: input.referralId,
          fromVersion: 4,
          toVersion: 5,
          actor: input.actor,
          actorType: actorTypeFor(input.actor.role),
          cityId: input.cityId,
          idempotencyKey: `referral.reversed:${input.referralId}:${now.getTime()}`,
          correlationId: input.correlationId,
          occurredAt: now,
          payload: {
            referralId: input.referralId,
            reasonCode: input.reasonCode,
            termsRef: input.termsRef,
          },
        },
      ],
    };
  });
}

// ---------------------------------------------------------------------------
// Admin review queue + decision
// ---------------------------------------------------------------------------

export interface ReviewCaseView {
  readonly id: string;
  readonly referral: string;
  readonly kind: string;
  readonly qualifyingEvent: string;
  readonly signals: readonly JsonRecord[];
  readonly waitingHours: number;
  readonly heldReward: Money;
}

export async function listReviewQueue(
  deps: GrowthDeps,
  actor: Actor,
): Promise<readonly ReviewCaseView[]> {
  assertPermission(actor.role, "referral.review.read");
  const cases = await deps.db.referralReviewCase.findMany({
    where: { decision: null },
    orderBy: { openedAt: "asc" },
    take: 200,
    include: { referral: { include: { programVersion: true } } },
  });
  const now = deps.now();
  return cases.map((c) => {
    const program = c.referral.programVersion;
    const reward = rewardOf({
      id: program.id,
      currency: program.currency,
      value: program.value,
      windowEnd: program.windowEnd,
    });
    return {
      id: c.id,
      referral: c.referralId,
      kind: c.referral.refereeId === null ? "rider" : "rider",
      qualifyingEvent: program.qualificationEvent,
      signals: (c.signals as JsonValue[] as JsonRecord[]) ?? [],
      waitingHours: (now.getTime() - c.openedAt.getTime()) / 3_600_000,
      heldReward: reward,
    };
  });
}

export async function decideReview(
  deps: GrowthDeps,
  input: {
    actor: Actor;
    cityId: string | null;
    caseId: string;
    decision: "qualify" | "hold" | "deny";
    reasonCode: string;
    holdHours?: number;
    correlationId: string | null;
  },
): Promise<{ decision: string; stage: string }> {
  assertPermission(input.actor.role, "referral.review.decide");
  const reviewCase = await deps.db.referralReviewCase.findUnique({
    where: { id: input.caseId },
    include: { referral: true },
  });
  if (reviewCase === null) {
    throw new ContractError("not_found", "no such review case", {
      caseId: input.caseId,
    });
  }
  if (reviewCase.decision !== null) {
    throw new ContractError("conflict", "this case is already decided", {
      caseId: input.caseId,
    });
  }
  const referral = reviewCase.referral;
  const now = deps.now();

  // Record the decision on the case first (who decided, with a reason).
  await auditedTransaction(deps.db, async (tx) => {
    await tx.referralReviewCase.update({
      where: { id: input.caseId },
      data: {
        decision: input.decision,
        reasonCode: input.reasonCode,
        decidedBy: input.actor.id,
        decidedAt: now,
        slaHours:
          input.decision === "hold"
            ? reviewCase.slaHours + (input.holdHours ?? 24)
            : reviewCase.slaHours,
      },
    });
    return {
      result: null,
      audit: {
        actor: input.actor,
        action: "growth.referral.review_decided",
        subjectType: "referral_review_case",
        subjectId: input.caseId,
        reason: input.reasonCode,
        before: { decision: null },
        after: { decision: input.decision },
        correlationId: input.correlationId,
      },
      events: [
        {
          name: "referral.review.decided",
          aggregateType: "referral",
          aggregateId: referral.id,
          fromVersion: 3,
          toVersion: 3,
          actor: input.actor,
          actorType: actorTypeFor(input.actor.role),
          cityId: input.cityId,
          idempotencyKey: `referral.review.decided:${input.caseId}`,
          correlationId: input.correlationId,
          occurredAt: now,
          payload: {
            caseId: input.caseId,
            referralId: referral.id,
            decision: input.decision,
            reasonCode: input.reasonCode,
          },
        },
      ],
    };
  });

  if (input.decision === "qualify") {
    const result = await rewardReferral(deps, {
      actor: input.actor,
      cityId: input.cityId,
      referralId: referral.id,
      referrerId: referral.referrerId,
      programVersionId: referral.programVersionId,
      fromStage: "in_review",
      correlationId: input.correlationId,
    });
    return { decision: input.decision, stage: result.outcome === "rewarded" ? "rewarded" : referral.stage };
  }

  if (input.decision === "deny") {
    await auditedTransaction(deps.db, async (tx) => {
      assertTransition(MACHINE, "in_review", "expired");
      await tx.referral.update({
        where: { id: referral.id },
        data: { stage: "expired", stageAt: now },
      });
      return {
        result: null,
        audit: {
          actor: input.actor,
          action: "growth.referral.denied",
          subjectType: "referral",
          subjectId: referral.id,
          reason: input.reasonCode,
          before: { stage: "in_review" },
          after: { stage: "expired" },
          correlationId: input.correlationId,
        },
        events: [
          {
            name: "referral.expired",
            aggregateType: "referral",
            aggregateId: referral.id,
            fromVersion: 3,
            toVersion: 4,
            actor: input.actor,
            actorType: actorTypeFor(input.actor.role),
            cityId: input.cityId,
            idempotencyKey: `referral.expired:${referral.id}`,
            correlationId: input.correlationId,
            occurredAt: now,
            payload: { referralId: referral.id, reasonCode: input.reasonCode },
          },
        ],
      };
    });
    return { decision: input.decision, stage: "expired" };
  }

  // hold: the referral stays in review; the SLA was extended above.
  return { decision: input.decision, stage: "in_review" };
}
