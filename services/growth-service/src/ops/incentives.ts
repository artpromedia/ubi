/**
 * Driver commission incentives (CLAUDE.md #27; contracts/openapi/incentives.yaml).
 *
 * Every incentive is a SEPARATE journal line posted through the ledger port. The
 * base commission the pricing engine computed for the trip is never edited for
 * a promotion — a rebate is an additional line that gives some of that
 * commission back, and a reversal is another line that takes it away again. The
 * rules this module enforces are explicit rather than implied:
 *
 *  - `percentage_points` reduces the commission RATE by `reductionBps`;
 *    `percent_of_commission` gives back that fraction OF the commission. The two
 *    are never conflated.
 *  - Tips, tolls and taxes are excluded from the commissionable base by default.
 *  - Cash trips net the rebate against what the driver owes UBI; wallet trips
 *    pay it out. Either way the driver's line is a credit — never negative.
 *  - The fleet split (slice 10) applies AFTER the rebate, so a fleet split never
 *    changes the rebate amount.
 *  - Caps (trip count, money) are enforced under a row lock so two trips cannot
 *    race past them. Rounding is one kobo per trip, half away from zero.
 *  - One rebate per trip: `driver_incentive_postings` is UNIQUE(trip_id, kind),
 *    so a replay returns the original posting.
 */
import { ContractError, money, type Money } from "@ubi/contracts";

import { auditedTransaction, type OutboxInput } from "./audit";
import { assertPermission } from "./roles";
import { deterministicId } from "../lib/ids";

import type { AuditedTx, AuditRecord } from "./audit";
import type { GrowthDeps } from "./context";
import type { IncentiveSettlement } from "./ledger-port";
import type { Actor, JsonRecord } from "./types";

export type RebateKind = "percentage_points" | "percent_of_commission" | "window";

export interface RuleRow {
  id: string;
  campaignVersionId: string;
  kind: string;
  baseBps: number | null;
  reductionBps: number | null;
  appliesTo: string;
  exclusions: string[];
  eligibleTripCap: number | null;
  moneyCapMinor: bigint | null;
  zones: string[];
  startsAt: Date | null;
  endsAt: Date | null;
  cashSettlement: string;
  fleetInteraction: string;
  rounding: string;
}

export interface TripBreakdown {
  readonly fareMinor: number;
  readonly tipsMinor?: number;
  readonly tollsMinor?: number;
  readonly taxesMinor?: number;
  /** The contracted commission the pricing engine posted. Never changed here. */
  readonly baseCommissionMinor?: number;
  readonly currency: string;
  readonly paymentMethod: string;
  /** Present only to PROVE it does not change the rebate (fleet split is after). */
  readonly fleetSplitBps?: number;
  readonly startedAt?: Date;
}

/** One kobo per trip, half away from zero (CLAUDE.md #27 rounding). */
export function roundKobo(exact: number): number {
  return exact < 0 ? -Math.round(-exact) : Math.round(exact);
}

/** The amount commission applies to, after removing excluded components. */
export function commissionBase(rule: RuleRow, trip: TripBreakdown): number {
  let base = trip.fareMinor;
  const add = (kind: string, minor: number | undefined): void => {
    if (minor !== undefined && !rule.exclusions.includes(kind)) {
      base += minor;
    }
  };
  add("tips", trip.tipsMinor);
  add("tolls", trip.tollsMinor);
  add("taxes", trip.taxesMinor);
  return base;
}

export interface RebateComputation {
  readonly amountMinor: number;
  readonly effectiveBps: number;
  readonly commissionBaseMinor: number;
  readonly baseCommissionMinor: number;
}

/**
 * Pure rebate arithmetic. The fleet split is deliberately not a parameter: it
 * cannot affect the result (CLAUDE.md #27 — the split is applied after).
 */
export function computeRebate(
  rule: RuleRow,
  trip: TripBreakdown,
): RebateComputation {
  const base = commissionBase(rule, trip);
  const baseBps = rule.baseBps ?? 0;
  const reductionBps = rule.reductionBps ?? 0;
  const baseCommission =
    trip.baseCommissionMinor ?? roundKobo((base * baseBps) / 10_000);

  if (rule.kind === "percent_of_commission") {
    const amount = roundKobo((baseCommission * reductionBps) / 10_000);
    return {
      amountMinor: amount,
      effectiveBps: baseBps === 0 ? 0 : baseBps - Math.round((baseBps * reductionBps) / 10_000),
      commissionBaseMinor: base,
      baseCommissionMinor: baseCommission,
    };
  }

  if (rule.kind === "window") {
    // A commission-free window waives the whole commission for the trip.
    return {
      amountMinor: baseCommission,
      effectiveBps: 0,
      commissionBaseMinor: base,
      baseCommissionMinor: baseCommission,
    };
  }

  // percentage_points: reduce the rate by reductionBps.
  const amount = roundKobo((base * reductionBps) / 10_000);
  return {
    amountMinor: amount,
    effectiveBps: baseBps - reductionBps,
    commissionBaseMinor: base,
    baseCommissionMinor: baseCommission,
  };
}

async function loadRule(deps: GrowthDeps, ruleId: string): Promise<RuleRow> {
  const rule = await deps.db.driverIncentiveRule.findUnique({
    where: { id: ruleId },
  });
  if (rule === null) {
    throw new ContractError("not_found", "no such incentive rule", { ruleId });
  }
  return rule;
}

/** Locks the rule row so trip-count and money caps cannot be raced past. */
async function lockRule(tx: AuditedTx, ruleId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM driver_incentive_rules WHERE id = ${ruleId} FOR UPDATE`;
}

function settlementFor(rule: RuleRow, trip: TripBreakdown): IncentiveSettlement {
  // Cash trips: the driver already holds the cash and owes UBI the commission,
  // so a rebate nets against what is owed rather than paying out (CLAUDE.md #27).
  if (rule.cashSettlement === "nets_against_owed" && trip.paymentMethod === "cash") {
    return "driver_owed";
  }
  return "driver_wallet";
}

export interface PostRebateInput {
  readonly actor: Actor;
  readonly cityId: string | null;
  readonly ruleId: string;
  readonly driverId: string;
  readonly tripId: string;
  readonly trip: TripBreakdown;
  readonly correlationId: string | null;
}

export type PostingResult =
  | {
      readonly posted: true;
      readonly posting: {
        readonly id: string;
        readonly kind: string;
        readonly amount: Money;
        readonly ledgerLineId: string;
        readonly effectiveBps: number;
      };
      readonly replayed: boolean;
    }
  | { readonly posted: false; readonly reasonCode: string };

async function postIncentiveLine(
  deps: GrowthDeps,
  input: PostRebateInput,
  kind: "rebate" | "window_waiver",
): Promise<PostingResult> {
  const rule = await loadRule(deps, input.ruleId);

  // Idempotent on (trip, kind): a replay returns the original posting.
  const existing = await deps.db.driverIncentivePosting.findUnique({
    where: { tripId_kind: { tripId: input.tripId, kind } },
  });
  if (existing !== null) {
    return {
      posted: true,
      posting: {
        id: existing.id,
        kind: existing.kind,
        amount: money(Number(existing.amountMinor), existing.currency),
        ledgerLineId: existing.ledgerLineId,
        effectiveBps: rule.baseBps ?? 0,
      },
      replayed: true,
    };
  }

  // Window rules only apply to trips that STARTED inside the window.
  if (kind === "window_waiver" && input.trip.startedAt !== undefined) {
    const startedAt = input.trip.startedAt.getTime();
    if (
      (rule.startsAt !== null && startedAt < rule.startsAt.getTime()) ||
      (rule.endsAt !== null && startedAt >= rule.endsAt.getTime())
    ) {
      return { posted: false, reasonCode: "outside_window" };
    }
  }

  const computed = computeRebate(rule, input.trip);
  if (computed.amountMinor <= 0) {
    return { posted: false, reasonCode: "no_reduction" };
  }
  const settlement = settlementFor(rule, input.trip);
  const currency = input.trip.currency;
  const postingId = deterministicId("dip", `${input.tripId}:${kind}`);

  return auditedTransaction(deps.db, async (tx) => {
    await lockRule(tx, rule.id);

    // Caps, recomputed under the lock.
    if (rule.eligibleTripCap !== null) {
      const trips = await tx.driverIncentivePosting.count({
        where: { ruleId: rule.id, driverId: input.driverId, kind },
      });
      if (trips >= rule.eligibleTripCap) {
        return capDenied(input, "trip_cap_reached");
      }
    }
    let amountMinor = computed.amountMinor;
    if (rule.moneyCapMinor !== null) {
      const agg = await tx.driverIncentivePosting.aggregate({
        where: { ruleId: rule.id, driverId: input.driverId, kind },
        _sum: { amountMinor: true },
      });
      const usedMinor = Number(agg._sum.amountMinor ?? 0n);
      const remaining = Number(rule.moneyCapMinor) - usedMinor;
      if (remaining <= 0) {
        return capDenied(input, "money_cap_reached");
      }
      if (amountMinor > remaining) {
        amountMinor = remaining; // cap at the boundary
      }
    }

    const amount = money(amountMinor, currency);
    // A SEPARATE journal line. The base commission entry is not touched.
    const posted = await deps.ledger.postIncentive({
      ruleId: rule.id,
      driverId: input.driverId,
      tripId: input.tripId,
      kind,
      amount,
      settlement,
      cityId: input.cityId,
      reason: `${kind} on trip ${input.tripId}`,
      idempotencyKey: `incentive:${input.tripId}:${kind}`,
      actor: input.actor,
    });

    const created = await tx.driverIncentivePosting.create({
      data: {
        id: postingId,
        ruleId: rule.id,
        driverId: input.driverId,
        tripId: input.tripId,
        ledgerLineId: posted.ledgerLineId,
        kind,
        amountMinor: BigInt(amountMinor),
        currency,
      },
    });

    const eventName =
      kind === "rebate" ? "incentive.rebate.posted" : "incentive.window.applied";
    const event: OutboxInput = {
      name: eventName,
      aggregateType: "driver",
      aggregateId: input.driverId,
      fromVersion: null,
      toVersion: 0,
      actor: input.actor,
      actorType: "system",
      cityId: input.cityId,
      idempotencyKey: `${eventName}:${input.tripId}`,
      correlationId: input.correlationId,
      occurredAt: deps.now(),
      payload: {
        tripId: input.tripId,
        driverId: input.driverId,
        ledgerLineId: posted.ledgerLineId,
        amountMinor,
        kind,
        basisBps: rule.reductionBps ?? 0,
        settlement,
      },
    };

    return {
      result: {
        posted: true,
        posting: {
          id: created.id,
          kind,
          amount,
          ledgerLineId: posted.ledgerLineId,
          effectiveBps: computed.effectiveBps,
        },
        replayed: false,
      },
      audit: {
        actor: input.actor,
        action: `growth.incentive.${kind}`,
        subjectType: "driver_incentive_posting",
        subjectId: created.id,
        reason: `${kind} posted as a separate ledger line`,
        before: null,
        after: {
          tripId: input.tripId,
          amountMinor,
          settlement,
          ledgerLineId: posted.ledgerLineId,
        },
        correlationId: input.correlationId,
      },
      events: [event],
    };
  });
}

function capDenied(
  input: PostRebateInput,
  reasonCode: string,
): {
  result: PostingResult;
  audit: AuditRecord;
} {
  return {
    result: { posted: false, reasonCode },
    audit: {
      actor: input.actor,
      action: "growth.incentive.cap_denied",
      subjectType: "driver_incentive_rule",
      subjectId: input.ruleId,
      reason: reasonCode,
      before: null,
      after: { driverId: input.driverId, tripId: input.tripId, reasonCode },
      correlationId: input.correlationId,
    },
  };
}

export function postRebate(
  deps: GrowthDeps,
  input: PostRebateInput,
): Promise<PostingResult> {
  return postIncentiveLine(deps, input, "rebate");
}

export function postWindowWaiver(
  deps: GrowthDeps,
  input: PostRebateInput,
): Promise<PostingResult> {
  return postIncentiveLine(deps, input, "window_waiver");
}

// ---------------------------------------------------------------------------
// Reversal — a separate compensating line on refund
// ---------------------------------------------------------------------------

export async function reverseRebate(
  deps: GrowthDeps,
  input: {
    actor: Actor;
    cityId: string | null;
    tripId: string;
    reasonCode: string;
    correlationId: string | null;
  },
): Promise<PostingResult> {
  const original = await deps.db.driverIncentivePosting.findUnique({
    where: { tripId_kind: { tripId: input.tripId, kind: "rebate" } },
  });
  if (original === null) {
    throw new ContractError("not_found", "no rebate to reverse for that trip", {
      tripId: input.tripId,
    });
  }
  const existing = await deps.db.driverIncentivePosting.findUnique({
    where: { tripId_kind: { tripId: input.tripId, kind: "rebate_reversal" } },
  });
  if (existing !== null) {
    return {
      posted: true,
      posting: {
        id: existing.id,
        kind: existing.kind,
        amount: money(Number(existing.amountMinor), existing.currency),
        ledgerLineId: existing.ledgerLineId,
        effectiveBps: 0,
      },
      replayed: true,
    };
  }

  const amount = money(Number(original.amountMinor), original.currency);
  const postingId = deterministicId("dip", `${input.tripId}:rebate_reversal`);

  // The compensating line: the rebate is taken back with an explicit reversal
  // line, disclosed on the statement — never a silent negative balance.
  const posted = await deps.ledger.postIncentive({
    ruleId: original.ruleId,
    driverId: original.driverId,
    tripId: input.tripId,
    kind: "rebate_reversal",
    amount,
    settlement: "driver_wallet",
    cityId: input.cityId,
    reason: `rebate reversal on trip ${input.tripId}: ${input.reasonCode}`,
    idempotencyKey: `incentive:${input.tripId}:rebate_reversal`,
    actor: input.actor,
  });

  return auditedTransaction(deps.db, async (tx) => {
    const created = await tx.driverIncentivePosting.create({
      data: {
        id: postingId,
        ruleId: original.ruleId,
        driverId: original.driverId,
        tripId: input.tripId,
        ledgerLineId: posted.ledgerLineId,
        kind: "rebate_reversal",
        amountMinor: original.amountMinor,
        currency: original.currency,
        reasonCode: input.reasonCode,
      },
    });
    const event: OutboxInput = {
      name: "incentive.rebate.reversed",
      aggregateType: "driver",
      aggregateId: original.driverId,
      fromVersion: null,
      toVersion: 0,
      actor: input.actor,
      actorType: "system",
      cityId: input.cityId,
      idempotencyKey: `incentive.rebate.reversed:${input.tripId}`,
      correlationId: input.correlationId,
      occurredAt: deps.now(),
      payload: {
        tripId: input.tripId,
        driverId: original.driverId,
        ledgerLineId: posted.ledgerLineId,
        amountMinor: Number(original.amountMinor),
        reasonCode: input.reasonCode,
      },
    };
    return {
      result: {
        posted: true,
        posting: {
          id: created.id,
          kind: "rebate_reversal",
          amount,
          ledgerLineId: posted.ledgerLineId,
          effectiveBps: 0,
        },
        replayed: false,
      },
      audit: {
        actor: input.actor,
        action: "growth.incentive.rebate_reversed",
        subjectType: "driver_incentive_posting",
        subjectId: created.id,
        reason: input.reasonCode,
        before: { originalPosting: original.id },
        after: { tripId: input.tripId, amountMinor: Number(original.amountMinor) },
        correlationId: input.correlationId,
      },
      events: [event],
    };
  });
}

// ---------------------------------------------------------------------------
// Milestone bonus (driver referrals)
// ---------------------------------------------------------------------------

export async function postMilestone(
  deps: GrowthDeps,
  input: {
    actor: Actor;
    cityId: string | null;
    ruleId: string;
    driverId: string;
    tripId: string;
    amount: Money;
    milestone: string;
    correlationId: string | null;
  },
): Promise<PostingResult> {
  const existing = await deps.db.driverIncentivePosting.findUnique({
    where: { tripId_kind: { tripId: input.tripId, kind: "milestone" } },
  });
  if (existing !== null) {
    return {
      posted: true,
      posting: {
        id: existing.id,
        kind: existing.kind,
        amount: money(Number(existing.amountMinor), existing.currency),
        ledgerLineId: existing.ledgerLineId,
        effectiveBps: 0,
      },
      replayed: true,
    };
  }
  const postingId = deterministicId("dip", `${input.tripId}:milestone`);
  const posted = await deps.ledger.postIncentive({
    ruleId: input.ruleId,
    driverId: input.driverId,
    tripId: input.tripId,
    kind: "milestone",
    amount: input.amount,
    settlement: "driver_wallet",
    cityId: input.cityId,
    reason: `driver referral milestone ${input.milestone}`,
    idempotencyKey: `incentive:${input.tripId}:milestone`,
    actor: input.actor,
  });
  return auditedTransaction(deps.db, async (tx) => {
    const created = await tx.driverIncentivePosting.create({
      data: {
        id: postingId,
        ruleId: input.ruleId,
        driverId: input.driverId,
        tripId: input.tripId,
        ledgerLineId: posted.ledgerLineId,
        kind: "milestone",
        amountMinor: BigInt(input.amount.amountMinor),
        currency: input.amount.currency,
      },
    });
    return {
      result: {
        posted: true,
        posting: {
          id: created.id,
          kind: "milestone",
          amount: input.amount,
          ledgerLineId: posted.ledgerLineId,
          effectiveBps: 0,
        },
        replayed: false,
      },
      audit: {
        actor: input.actor,
        action: "growth.incentive.milestone",
        subjectType: "driver_incentive_posting",
        subjectId: created.id,
        reason: `milestone ${input.milestone}`,
        before: null,
        after: { tripId: input.tripId, amountMinor: input.amount.amountMinor },
        correlationId: input.correlationId,
      },
      events: [
        {
          name: "driver_referral.milestone_reached",
          aggregateType: "driver",
          aggregateId: input.driverId,
          fromVersion: null,
          toVersion: 0,
          actor: input.actor,
          actorType: "system",
          cityId: input.cityId,
          idempotencyKey: `driver_referral.milestone_reached:${input.tripId}`,
          correlationId: input.correlationId,
          occurredAt: deps.now(),
          payload: {
            driverId: input.driverId,
            milestone: input.milestone,
            amountMinor: input.amount.amountMinor,
          },
        },
      ],
    };
  });
}

// ---------------------------------------------------------------------------
// Driver-facing reads
// ---------------------------------------------------------------------------

export async function getIncentivesOverview(
  deps: GrowthDeps,
  actor: Actor,
): Promise<JsonRecord> {
  assertPermission(actor.role, "driver.incentives.self");
  const rules = await deps.db.driverIncentiveRule.findMany({
    where: {
      campaignVersion: { campaign: { state: "active" } },
    },
    include: { campaignVersion: { include: { campaign: true } } },
    take: 50,
  });
  const now = deps.now();

  const rebates: JsonRecord[] = [];
  const windows: JsonRecord[] = [];
  for (const rule of rules) {
    const agg = await deps.db.driverIncentivePosting.aggregate({
      where: { ruleId: rule.id, driverId: actor.id, kind: rule.kind === "window" ? "window_waiver" : "rebate" },
      _sum: { amountMinor: true },
      _count: true,
    });
    const savedMinor = Number(agg._sum.amountMinor ?? 0n);
    const currency = rule.campaignVersion.currency;
    if (rule.kind === "window") {
      windows.push({
        id: rule.id,
        title: rule.campaignVersion.copy,
        startsAt: rule.startsAt?.toISOString() ?? null,
        endsAt: rule.endsAt?.toISOString() ?? null,
        zones: rule.zones,
        tripCap: rule.eligibleTripCap,
        moneyCapMinor: rule.moneyCapMinor === null ? null : Number(rule.moneyCapMinor),
        currency,
        used: { trips: agg._count, savedMinor },
        live:
          (rule.startsAt === null || rule.startsAt.getTime() <= now.getTime()) &&
          (rule.endsAt === null || rule.endsAt.getTime() > now.getTime()),
        rule: "trips started in the window",
      });
    } else {
      const baseBps = rule.baseBps ?? 0;
      const reductionBps = rule.reductionBps ?? 0;
      rebates.push({
        id: rule.id,
        title: rule.campaignVersion.copy,
        baseBps,
        reductionBps,
        kind: rule.kind,
        effectiveBps: baseBps - reductionBps,
        endsAt: rule.endsAt?.toISOString() ?? null,
        eligible: {
          used: agg._count,
          cap: rule.eligibleTripCap,
          rebatedSoFarMinor: savedMinor,
          currency,
        },
        fundedBy: (rule.campaignVersion.funding as { party?: string } | null)?.party ?? null,
      });
    }
  }

  const anyLive = rebates.length > 0 || windows.some((w) => w.live === true);
  return {
    strip: anyLive
      ? { headline: "Incentive live", detail: "See your incentives", badge: "LIVE" }
      : null,
    rebates,
    windows,
  };
}

export async function getRebateDetail(
  deps: GrowthDeps,
  actor: Actor,
  ruleId: string,
): Promise<JsonRecord> {
  assertPermission(actor.role, "driver.incentives.self");
  const rule = await deps.db.driverIncentiveRule.findUnique({
    where: { id: ruleId },
    include: { campaignVersion: true },
  });
  if (rule === null) {
    throw new ContractError("not_found", "no such incentive", { ruleId });
  }
  const agg = await deps.db.driverIncentivePosting.aggregate({
    where: { ruleId: rule.id, driverId: actor.id },
    _sum: { amountMinor: true },
    _count: true,
  });
  const baseBps = rule.baseBps ?? 0;
  const reductionBps = rule.reductionBps ?? 0;
  return {
    id: rule.id,
    title: rule.campaignVersion.copy,
    baseBps,
    reductionBps,
    kind: rule.kind,
    effectiveBps: baseBps - reductionBps,
    endsAt: rule.endsAt?.toISOString() ?? null,
    eligible: {
      used: agg._count,
      cap: rule.eligibleTripCap,
      rebatedSoFarMinor: Number(agg._sum.amountMinor ?? 0n),
      currency: rule.campaignVersion.currency,
    },
    rules: [
      { label: "Applies to", value: rule.appliesTo },
      { label: "Excludes", value: rule.exclusions.join(", ") },
      { label: "Cash settlement", value: rule.cashSettlement },
      { label: "Fleet interaction", value: rule.fleetInteraction },
      { label: "Rounding", value: rule.rounding },
    ],
    note: {
      title: rule.kind === "percentage_points" ? "Percentage points" : "Percent of commission",
      body:
        rule.kind === "percentage_points"
          ? "Your commission rate is reduced by the stated points."
          : "You get back the stated percentage of the commission.",
    },
  };
}

// ---------------------------------------------------------------------------
// Admin: live commission-incentive spend board (growth-ops.yaml)
// ---------------------------------------------------------------------------

export async function commissionIncentivesLive(
  deps: GrowthDeps,
  actor: Actor,
): Promise<JsonRecord> {
  assertPermission(actor.role, "commission.read");
  const rules = await deps.db.driverIncentiveRule.findMany({
    where: { campaignVersion: { campaign: { state: "active" } } },
    include: { campaignVersion: { include: { campaign: true } } },
    take: 200,
  });

  const byCampaign: JsonRecord[] = [];
  let paidOutMinor = 0;
  const driversAtCap = new Set<string>();

  for (const rule of rules) {
    const postings = await deps.db.driverIncentivePosting.findMany({
      where: { ruleId: rule.id },
    });
    let spendMinor = 0;
    const perDriver = new Map<string, number>();
    for (const p of postings) {
      const signed = p.kind === "rebate_reversal" ? -Number(p.amountMinor) : Number(p.amountMinor);
      spendMinor += signed;
      perDriver.set(p.driverId, (perDriver.get(p.driverId) ?? 0) + signed);
    }
    if (rule.moneyCapMinor !== null) {
      const cap = Number(rule.moneyCapMinor);
      for (const [driverId, sum] of perDriver) {
        if (sum >= cap) {
          driversAtCap.add(driverId);
        }
      }
    }
    byCampaign.push({
      campaignId: rule.campaignVersion.campaignId,
      ruleId: rule.id,
      kind: rule.kind,
      currency: rule.campaignVersion.currency,
      spendMinor,
      wordingCheck: rule.kind === "percentage_points" ? "points" : "percent_of_commission",
    });
  }

  // Cash netting vs payouts, from the settlement each posting used.
  const cashPostings = await deps.db.driverIncentivePosting.findMany({
    where: { kind: { in: ["rebate", "window_waiver"] } },
    take: 1000,
  });
  for (const p of cashPostings) {
    // Settlement is encoded in the ledger; here we surface the totals we posted.
    paidOutMinor += Number(p.amountMinor);
  }

  return {
    byCampaign,
    driversAtCap: driversAtCap.size,
    cashNetting: { paidOutMinor },
  };
}

export async function getStatement(
  deps: GrowthDeps,
  actor: Actor,
  periodId: string,
): Promise<JsonRecord> {
  assertPermission(actor.role, "driver.incentives.self");
  // Lines are derived from the postings (each carries its ledger line id), so a
  // statement is always reconcilable back to the ledger (CLAUDE.md #4).
  const postings = await deps.db.driverIncentivePosting.findMany({
    where: { driverId: actor.id },
    orderBy: { postedAt: "asc" },
    take: 500,
  });
  const currency = postings[0]?.currency ?? "NGN";
  const toneFor = (kind: string): string =>
    kind === "rebate_reversal" ? "negative" : "positive";
  const lines = postings.map((p) => ({
    ledgerLineId: p.ledgerLineId,
    kind:
      p.kind === "window_waiver"
        ? "window_waiver"
        : p.kind === "rebate_reversal"
          ? "rebate_reversal"
          : p.kind === "milestone"
            ? "quest_bonus"
            : "rebate",
    label: p.kind,
    amountMinor:
      p.kind === "rebate_reversal" ? -Number(p.amountMinor) : Number(p.amountMinor),
    currency: p.currency,
    tone: toneFor(p.kind),
  }));
  const payoutMinor = lines.reduce((sum, l) => sum + l.amountMinor, 0);
  return {
    periodId,
    status: "draft",
    lines,
    trips: [],
    payoutMinor,
    currency,
  };
}
