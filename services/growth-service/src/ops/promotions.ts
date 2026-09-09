/**
 * The promotion budget ledger for a campaign version (CLAUDE.md #29).
 *
 * Budget is *reserved* when a promise is made to a user (a quote or a
 * checkout), *consumed* when the user qualifies, and *released* when the promise
 * expires. Impressions reserve nothing. Exhaustion is a recorded timestamp, not
 * a computed guess, and it is what a rider sees as "used up".
 *
 * Reserve/consume/release/reverse move a single `campaign_budgets` row through
 * `reserved_minor / consumed_minor / reversed_minor`. Every move takes a
 * `SELECT … FOR UPDATE` lock on that row first, so concurrent reservations for
 * the same campaign are serialised and can never oversell the budget or a
 * per-user cap — the check and the write are one atomic step (the guard tested
 * by "concurrent promotion reservations respect caps").
 *
 * Each move follows the promotionReservation machine
 * (reserved → consumed | released, consumed → reversed) through
 * `assertTransition`, and writes its outbox event in the same transaction.
 */
import {
  assertTransition,
  ContractError,
  money,
  scopedIdempotencyKey,
  type Money,
} from "@ubi/contracts";

import { auditedTransaction, type OutboxInput } from "./audit";
import { isUniqueViolation } from "./errors";
import { actorTypeFor } from "./roles";
import { deterministicId } from "../lib/ids";

import type { AuditedTx, AuditRecord } from "./audit";
import type { GrowthDeps } from "./context";
import type { BenefitFunding, BenefitBeneficiary } from "./ledger-port";
import type { Actor, JsonRecord } from "./types";

const MACHINE = "promotionReservation" as const;

export const ADJUSTMENT_TYPES = [
  "fare_discount",
  "fee_waiver",
  "credit",
  "referral_reward",
  "driver_rebate",
  "window_waiver",
] as const;
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

export type ReserveDenyReason =
  | "budget_exhausted"
  | "cap_reached"
  | "scope"
  | "expired"
  | "min_spend_not_met";

export interface ReservationView {
  readonly id: string;
  readonly campaignVersionId: string;
  readonly userId: string;
  readonly adjustmentType: string;
  readonly amount: Money;
  readonly state: string;
  readonly reasonCode: string | null;
  readonly expiresAt: string | null;
}

export type ReserveResult =
  | { readonly reserved: true; readonly reservation: ReservationView; readonly replayed: boolean }
  | { readonly reserved: false; readonly reasonCode: ReserveDenyReason };

interface BudgetLockRow {
  reserved_minor: bigint;
  consumed_minor: bigint;
  reversed_minor: bigint;
  budget_limit_minor: bigint;
  exhausted_at: Date | null;
}

/** Locks the version's budget row and returns its committed totals and limit. */
async function lockBudget(
  tx: AuditedTx,
  campaignVersionId: string,
): Promise<BudgetLockRow> {
  const rows = await tx.$queryRaw<BudgetLockRow[]>`
    SELECT b.reserved_minor, b.consumed_minor, b.reversed_minor,
           v.budget_limit_minor, b.exhausted_at
    FROM campaign_budgets b
    JOIN campaign_versions v ON v.id = b.campaign_version_id
    WHERE b.campaign_version_id = ${campaignVersionId}
    FOR UPDATE OF b`;
  const row = rows[0];
  if (row === undefined) {
    throw new ContractError("not_found", "no budget for that campaign version", {
      campaignVersionId,
    });
  }
  return row;
}

function reservationView(row: {
  id: string;
  campaignVersionId: string;
  userId: string;
  adjustmentType: string;
  amountMinor: bigint;
  currency: string;
  state: string;
  reasonCode: string | null;
  expiresAt: Date | null;
}): ReservationView {
  return {
    id: row.id,
    campaignVersionId: row.campaignVersionId,
    userId: row.userId,
    adjustmentType: row.adjustmentType,
    amount: money(Number(row.amountMinor), row.currency),
    state: row.state,
    reasonCode: row.reasonCode,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Stacking — the server decides which benefits combine (CLAUDE.md #26)
// ---------------------------------------------------------------------------

export interface StackCandidate {
  readonly campaignVersionId: string;
  readonly type: AdjustmentType;
  readonly priority: number;
  /** The adjustment types this benefit is willing to stack with. */
  readonly stacksWith: readonly string[];
}

export interface StackResolution {
  readonly applied: readonly StackCandidate[];
  readonly dropped: readonly {
    readonly candidate: StackCandidate;
    readonly reasonCode: "scope";
  }[];
}

/**
 * Resolves which candidate benefits stack for one promise. Higher priority wins;
 * a lower-priority benefit is applied only if it and every already-applied
 * benefit each name the other's type in `stacksWith` (stacking is mutual). This
 * runs server-side; the client only ever renders the result (CLAUDE.md #26).
 */
export function resolveStacking(
  candidates: readonly StackCandidate[],
): StackResolution {
  const ordered = [...candidates].sort((a, b) => b.priority - a.priority);
  const applied: StackCandidate[] = [];
  const dropped: { candidate: StackCandidate; reasonCode: "scope" }[] = [];
  for (const candidate of ordered) {
    const stacksWithAll = applied.every(
      (a) =>
        a.stacksWith.includes(candidate.type) &&
        candidate.stacksWith.includes(a.type),
    );
    if (stacksWithAll) {
      applied.push(candidate);
    } else {
      dropped.push({ candidate, reasonCode: "scope" });
    }
  }
  return { applied, dropped };
}

// ---------------------------------------------------------------------------
// Reserve
// ---------------------------------------------------------------------------

export interface ReserveInput {
  readonly actor: Actor;
  readonly cityId: string | null;
  readonly campaignVersionId: string;
  readonly userId: string;
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly adjustmentType: AdjustmentType;
  readonly amount: Money;
  readonly expiresAt: Date | null;
  readonly idempotencyKey: string;
  readonly correlationId: string | null;
}

export async function reserve(
  deps: GrowthDeps,
  input: ReserveInput,
): Promise<ReserveResult> {
  if (input.amount.amountMinor <= 0) {
    throw new ContractError("validation_failed", "a reservation must be a positive amount");
  }
  const scoped = scopedIdempotencyKey(
    "growth.promotion.reserve",
    input.userId,
    input.idempotencyKey,
  );
  const reservationId = deterministicId("prm", scoped);

  const existing = await deps.db.promotionReservation.findUnique({
    where: { id: reservationId },
  });
  if (existing !== null) {
    return { reserved: true, reservation: reservationView(existing), replayed: true };
  }

  const version = await deps.db.campaignVersion.findUnique({
    where: { id: input.campaignVersionId },
    include: { campaign: true },
  });
  if (version === null) {
    throw new ContractError("not_found", "no such campaign version", {
      campaignVersionId: input.campaignVersionId,
    });
  }
  if (input.amount.currency !== version.currency) {
    throw new ContractError("validation_failed", "reservation currency must match the campaign version");
  }
  // A promise is only made while the campaign is live and inside its window. An
  // `exhausted` campaign is still let through to the budget check so the denial
  // it earns is the honest `budget_exhausted`, not a vague `scope`.
  const now = deps.now();
  if (version.campaign.state !== "active" && version.campaign.state !== "exhausted") {
    return { reserved: false, reasonCode: "scope" };
  }
  if (now.getTime() < version.windowStart.getTime() || now.getTime() >= version.windowEnd.getTime()) {
    return { reserved: false, reasonCode: "scope" };
  }

  const caps = version.caps as { perUser?: number } | null;
  const perUserCap = caps?.perUser ?? null;
  const amountMinor = BigInt(input.amount.amountMinor);

  try {
    return await auditedTransaction(deps.db, async (tx) => {
      const budget = await lockBudget(tx, input.campaignVersionId);

      // Per-user cap (serialised behind the same budget lock).
      if (perUserCap !== null) {
        const held = await tx.promotionReservation.count({
          where: {
            userId: input.userId,
            campaignVersionId: input.campaignVersionId,
            state: { in: ["reserved", "consumed"] },
          },
        });
        if (held >= perUserCap) {
          return denyOutcome(input, "cap_reached");
        }
      }

      const committed = budget.reserved_minor + budget.consumed_minor;
      const remaining = budget.budget_limit_minor - committed;
      if (amountMinor > remaining) {
        // The budget cannot serve this promise: record exhaustion once.
        const events: OutboxInput[] = [];
        if (budget.exhausted_at === null) {
          await tx.campaignBudget.update({
            where: { campaignVersionId: input.campaignVersionId },
            data: { exhaustedAt: now },
          });
          events.push(exhaustionEvent(input, now));
          await exhaustCampaign(tx, version.campaignId, input, now, events);
        }
        return { ...denyOutcome(input, "budget_exhausted"), events };
      }

      const created = await tx.promotionReservation.create({
        data: {
          id: reservationId,
          campaignVersionId: input.campaignVersionId,
          userId: input.userId,
          subjectKind: input.subjectKind,
          subjectId: input.subjectId,
          adjustmentType: input.adjustmentType,
          amountMinor,
          currency: input.amount.currency,
          state: "reserved",
          idempotencyKey: scoped,
          expiresAt: input.expiresAt,
        },
      });
      await tx.campaignBudget.update({
        where: { campaignVersionId: input.campaignVersionId },
        data: { reservedMinor: budget.reserved_minor + amountMinor },
      });

      const events: OutboxInput[] = [
        {
          name: "promotion.reserved",
          aggregateType: "promotion",
          aggregateId: reservationId,
          fromVersion: null,
          toVersion: 0,
          actor: input.actor,
          actorType: actorTypeFor(input.actor.role),
          cityId: input.cityId,
          idempotencyKey: `promotion.reserved:${reservationId}`,
          correlationId: input.correlationId,
          occurredAt: now,
          payload: {
            campaignVersionId: input.campaignVersionId,
            reservationId,
            userId: input.userId,
            amountMinor: input.amount.amountMinor,
            adjustmentType: input.adjustmentType,
            expiresAt: input.expiresAt?.toISOString() ?? null,
          },
        },
      ];
      // Reserving the last of the budget exhausts it.
      if (committed + amountMinor >= budget.budget_limit_minor && budget.exhausted_at === null) {
        await tx.campaignBudget.update({
          where: { campaignVersionId: input.campaignVersionId },
          data: { exhaustedAt: now },
        });
        events.push(exhaustionEvent(input, now));
        await exhaustCampaign(tx, version.campaignId, input, now, events);
      }

      return {
        result: { reserved: true, reservation: reservationView(created), replayed: false },
        audit: {
          actor: input.actor,
          action: "growth.promotion.reserved",
          subjectType: "promotion_reservation",
          subjectId: reservationId,
          reason: "budget reserved on a promise to a user",
          before: null,
          after: {
            campaignVersionId: input.campaignVersionId,
            amountMinor: input.amount.amountMinor,
            adjustmentType: input.adjustmentType,
          },
          correlationId: input.correlationId,
        },
        events,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const replay = await deps.db.promotionReservation.findUnique({
        where: { id: reservationId },
      });
      if (replay !== null) {
        return { reserved: true, reservation: reservationView(replay), replayed: true };
      }
    }
    throw error;
  }
}

function denyOutcome(
  input: ReserveInput,
  reasonCode: ReserveDenyReason,
): {
  result: ReserveResult;
  audit: AuditRecord;
  events?: OutboxInput[];
} {
  return {
    result: { reserved: false, reasonCode },
    audit: {
      actor: input.actor,
      action: "growth.promotion.reserve_denied",
      subjectType: "campaign_version",
      subjectId: input.campaignVersionId,
      reason: reasonCode,
      before: null,
      after: { userId: input.userId, reasonCode, amountMinor: input.amount.amountMinor },
      correlationId: input.correlationId,
    },
  };
}

function exhaustionEvent(input: ReserveInput, now: Date): OutboxInput {
  return {
    name: "promotion.exhausted",
    aggregateType: "campaign_version",
    aggregateId: input.campaignVersionId,
    fromVersion: null,
    toVersion: 0,
    actor: input.actor,
    actorType: actorTypeFor(input.actor.role),
    cityId: input.cityId,
    idempotencyKey: `promotion.exhausted:${input.campaignVersionId}`,
    correlationId: input.correlationId,
    occurredAt: now,
    payload: { campaignVersionId: input.campaignVersionId, at: now.toISOString() },
  };
}

/** When a live campaign runs out of budget it transitions active → exhausted. */
async function exhaustCampaign(
  tx: AuditedTx,
  campaignId: string,
  input: ReserveInput,
  now: Date,
  events: OutboxInput[],
): Promise<void> {
  const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
  if (campaign === null || campaign.state !== "active") {
    return;
  }
  assertTransition("campaign", "active", "exhausted");
  await tx.campaign.update({
    where: { id: campaignId },
    data: { state: "exhausted", stateAt: now, stateBy: input.actor.id },
  });
  events.push({
    name: "campaign.version.exhausted",
    aggregateType: "campaign",
    aggregateId: campaignId,
    fromVersion: null,
    toVersion: 0,
    actor: input.actor,
    actorType: actorTypeFor(input.actor.role),
    cityId: input.cityId,
    idempotencyKey: `campaign.version.exhausted:${campaignId}:${now.getTime()}`,
    correlationId: input.correlationId,
    occurredAt: now,
    payload: { campaignId, at: now.toISOString() },
  });
}

// ---------------------------------------------------------------------------
// Consume — the promise was qualified
// ---------------------------------------------------------------------------

export interface ConsumeInput {
  readonly actor: Actor;
  readonly cityId: string | null;
  readonly reservationId: string;
  readonly correlationId: string | null;
  /**
   * When a benefit funds a contracted party (e.g. marketing tops the driver up
   * so a rider discount never shrinks the driver's earnings — CLAUDE.md #26),
   * the money movement is posted here as a SEPARATE journal entry through the
   * ledger port. Omitted for benefits that settle at payment time.
   */
  readonly benefitPosting?: {
    readonly funding: BenefitFunding;
    readonly beneficiary: BenefitBeneficiary;
  };
  /** For a `credit` grant: where the promo credit can be spent, and its cap. */
  readonly credit?: {
    readonly perRideCap: Money | null;
    readonly scope: string;
    readonly expiresAt: Date;
  };
}

export async function consume(
  deps: GrowthDeps,
  input: ConsumeInput,
): Promise<ReservationView> {
  const reservation = await deps.db.promotionReservation.findUnique({
    where: { id: input.reservationId },
  });
  if (reservation === null) {
    throw new ContractError("not_found", "no such reservation", {
      reservationId: input.reservationId,
    });
  }
  if (reservation.state === "consumed") {
    return reservationView(reservation); // idempotent replay
  }
  assertTransition(MACHINE, reservation.state, "consumed");

  const amount = money(Number(reservation.amountMinor), reservation.currency);
  const now = deps.now();

  // The money posting happens before the transaction and is itself idempotent
  // on the reservation id, so a retry lands on the same entry (CLAUDE.md #4).
  let ledgerLineId: string | null = null;
  if (input.benefitPosting !== undefined) {
    const posted = await deps.ledger.postBenefit({
      reservationId: reservation.id,
      campaignVersionId: reservation.campaignVersionId,
      adjustmentType: reservation.adjustmentType,
      amount,
      funding: input.benefitPosting.funding,
      beneficiary: input.benefitPosting.beneficiary,
      cityId: input.cityId,
      reason: `benefit ${reservation.adjustmentType} consumed`,
      idempotencyKey: `benefit:${reservation.id}`,
      actor: input.actor,
    });
    ledgerLineId = posted.ledgerLineId;
  }

  return auditedTransaction(deps.db, async (tx) => {
    const budget = await lockBudget(tx, reservation.campaignVersionId);
    const amountMinor = reservation.amountMinor;
    const updated = await tx.promotionReservation.update({
      where: { id: reservation.id },
      data: { state: "consumed" },
    });
    await tx.campaignBudget.update({
      where: { campaignVersionId: reservation.campaignVersionId },
      data: {
        reservedMinor: budget.reserved_minor - amountMinor,
        consumedMinor: budget.consumed_minor + amountMinor,
      },
    });

    if (reservation.adjustmentType === "credit" && input.credit !== undefined) {
      await tx.userCredit.create({
        data: {
          id: deterministicId("ucr", `credit:${reservation.id}`),
          userId: reservation.userId,
          amountMinor,
          currency: reservation.currency,
          perRideCapMinor:
            input.credit.perRideCap === null
              ? null
              : BigInt(input.credit.perRideCap.amountMinor),
          scope: input.credit.scope,
          expiresAt: input.credit.expiresAt,
          sourceReservationId: reservation.id,
        },
      });
    }

    const payload: JsonRecord = {
      campaignVersionId: reservation.campaignVersionId,
      reservationId: reservation.id,
      userId: reservation.userId,
      amountMinor: Number(reservation.amountMinor),
      adjustmentType: reservation.adjustmentType,
      ledgerLineId,
    };
    const event: OutboxInput = {
      name: "promotion.consumed",
      aggregateType: "promotion",
      aggregateId: reservation.id,
      fromVersion: 0,
      toVersion: 1,
      actor: input.actor,
      actorType: actorTypeFor(input.actor.role),
      cityId: input.cityId,
      idempotencyKey: `promotion.consumed:${reservation.id}`,
      correlationId: input.correlationId,
      occurredAt: now,
      payload,
    };

    return {
      result: reservationView(updated),
      audit: {
        actor: input.actor,
        action: "growth.promotion.consumed",
        subjectType: "promotion_reservation",
        subjectId: reservation.id,
        reason: "promise qualified",
        before: { state: reservation.state },
        after: { state: "consumed", ledgerLineId },
        correlationId: input.correlationId,
      },
      events: [event],
    };
  });
}

// ---------------------------------------------------------------------------
// Release — the promise expired unused
// ---------------------------------------------------------------------------

export async function release(
  deps: GrowthDeps,
  input: {
    actor: Actor;
    cityId: string | null;
    reservationId: string;
    reasonCode?: string;
    correlationId: string | null;
  },
): Promise<ReservationView> {
  const reservation = await deps.db.promotionReservation.findUnique({
    where: { id: input.reservationId },
  });
  if (reservation === null) {
    throw new ContractError("not_found", "no such reservation", {
      reservationId: input.reservationId,
    });
  }
  if (reservation.state === "released") {
    return reservationView(reservation);
  }
  assertTransition(MACHINE, reservation.state, "released");
  const now = deps.now();

  return auditedTransaction(deps.db, async (tx) => {
    const budget = await lockBudget(tx, reservation.campaignVersionId);
    const updated = await tx.promotionReservation.update({
      where: { id: reservation.id },
      data: { state: "released", reasonCode: input.reasonCode ?? "expired" },
    });
    await tx.campaignBudget.update({
      where: { campaignVersionId: reservation.campaignVersionId },
      data: { reservedMinor: budget.reserved_minor - reservation.amountMinor },
    });
    const event: OutboxInput = {
      name: "promotion.released",
      aggregateType: "promotion",
      aggregateId: reservation.id,
      fromVersion: 0,
      toVersion: 1,
      actor: input.actor,
      actorType: actorTypeFor(input.actor.role),
      cityId: input.cityId,
      idempotencyKey: `promotion.released:${reservation.id}`,
      correlationId: input.correlationId,
      occurredAt: now,
      payload: {
        campaignVersionId: reservation.campaignVersionId,
        reservationId: reservation.id,
        amountMinor: Number(reservation.amountMinor),
      },
    };
    return {
      result: reservationView(updated),
      audit: {
        actor: input.actor,
        action: "growth.promotion.released",
        subjectType: "promotion_reservation",
        subjectId: reservation.id,
        reason: input.reasonCode ?? "expired",
        before: { state: reservation.state },
        after: { state: "released" },
        correlationId: input.correlationId,
      },
      events: [event],
    };
  });
}

// ---------------------------------------------------------------------------
// Reverse — a compensating entry, citing the terms version (CLAUDE.md #28)
// ---------------------------------------------------------------------------

export async function reverse(
  deps: GrowthDeps,
  input: {
    actor: Actor;
    cityId: string | null;
    reservationId: string;
    reasonCode: string;
    termsRef: string;
    correlationId: string | null;
  },
): Promise<ReservationView> {
  const reservation = await deps.db.promotionReservation.findUnique({
    where: { id: input.reservationId },
  });
  if (reservation === null) {
    throw new ContractError("not_found", "no such reservation", {
      reservationId: input.reservationId,
    });
  }
  if (reservation.state === "reversed") {
    return reservationView(reservation);
  }
  assertTransition(MACHINE, reservation.state, "reversed");
  const now = deps.now();

  return auditedTransaction(deps.db, async (tx) => {
    const budget = await lockBudget(tx, reservation.campaignVersionId);
    const updated = await tx.promotionReservation.update({
      where: { id: reservation.id },
      data: {
        state: "reversed",
        reasonCode: input.reasonCode,
        termsRef: input.termsRef,
      },
    });
    // Reversal is a compensating entry: consumed drops, reversed rises by the
    // same amount, so the two remain reconcilable against each other.
    await tx.campaignBudget.update({
      where: { campaignVersionId: reservation.campaignVersionId },
      data: {
        consumedMinor: budget.consumed_minor - reservation.amountMinor,
        reversedMinor: budget.reversed_minor + reservation.amountMinor,
      },
    });
    const event: OutboxInput = {
      name: "promotion.reversed",
      aggregateType: "promotion",
      aggregateId: reservation.id,
      fromVersion: 1,
      toVersion: 2,
      actor: input.actor,
      actorType: actorTypeFor(input.actor.role),
      cityId: input.cityId,
      idempotencyKey: `promotion.reversed:${reservation.id}`,
      correlationId: input.correlationId,
      occurredAt: now,
      payload: {
        adjustmentId: reservation.id,
        reasonCode: input.reasonCode,
        termsRef: input.termsRef,
        amountMinor: Number(reservation.amountMinor),
      },
    };
    return {
      result: reservationView(updated),
      audit: {
        actor: input.actor,
        action: "growth.promotion.reversed",
        subjectType: "promotion_reservation",
        subjectId: reservation.id,
        reason: input.reasonCode,
        before: { state: reservation.state },
        after: { state: "reversed", termsRef: input.termsRef },
        correlationId: input.correlationId,
      },
      events: [event],
    };
  });
}
