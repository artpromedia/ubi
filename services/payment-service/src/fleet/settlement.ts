/**
 * Weekly fleet remittance settlement on the canonical ledger (A05 items 3-4;
 * decisions doc Q2 / Q7 / Q8).
 *
 * For every item contract B reports for a (city, week), and for each
 * (assignmentId, weekStart) EXACTLY ONCE:
 *
 *  1. the week's due, server-computed from the SIGNED terms snapshot the item
 *     carries (./math.ts): `weekly_fixed` pro-rated for planned maintenance
 *     only (Q2 — unplanned off-road hours are never deducted, Q8), over the
 *     week's signed-shift basis — its own shift, or the whole chain's when a
 *     mid-week supersession split the week (`weekShiftBases`), so one week
 *     is never charged two weekly amounts;
 *     `percent_of_net` on the driver's net for the week read from the ledger
 *     (./ledger-reads.ts). The city's `remittanceCapMinor` bounds a week's
 *     due (server-set, audited as `capApplied`);
 *  2. the carry-forward: the pair's outstanding shortfall is DERIVED from the
 *     `fleet_remittance_carry` memo lines (never a stored balance), by origin
 *     week. Any part older than the terms' `shortfall.maxWeeks` lapses first
 *     (the fleet's claim on it expires — it is never collected);
 *  3. collection: what is owed (this week's due + the live carry) is taken
 *     from the driver's wallet up to its SPENDABLE balance — never below zero,
 *     never out of a frozen wallet, never on credit: UBI does not lend.
 *     Payments settle the oldest origin first; what the wallet cannot cover
 *     stays in the carry-forward for later weeks;
 *  4. ONE journal entry (`fleet_remittance_settlement`, idempotency key
 *     `fleet.remittance:<assignmentId>:<weekStart>`): driver wallet → fleet
 *     wallet for the amount collected, plus the carry memo pairs. It never
 *     touches `ubi_commission` — the 10% was captured per job at selection
 *     (./commission-funding.ts: the driver's wallet funds it, one funder);
 *  5. the durable record — an outbox `remittance.applied` event (plus
 *     `remittance.shortfall` / `remittance.carried` when they apply) and an
 *     audit row, in the same transaction. The event carries ids and amounts
 *     only; a driver's NET never leaves the audit row (Q7).
 *
 * A CLOSED week is never re-settled. The same inputs replay the record. New
 * inputs for a closed week (a corrected maintenance block, a moved activeTo)
 * are recorded as a LINKED ADJUSTMENT (`fleet_remittance_adjustment`): the
 * difference against the week's effective due is put on the carry-forward at
 * the assignment's NEXT OPEN week, where that week's settlement collects it
 * (a positive difference) or nets it as a credit (a negative one; a credit
 * the fleet owes back is refunded fleet → driver as far as the fleet wallet
 * covers it, and never expires). Nothing about the closed week's entry
 * changes, ever.
 *
 * Restart-safe: each item settles in its own transaction under a per
 * fleet + driver advisory lock (every carry decision for the pair is
 * serialized), so a crash mid-run leaves some items settled and a re-run
 * replays them and settles the rest.
 */
import { z } from "zod";

import {
  type CityConfig,
  ContractError,
  money,
  scopedIdempotencyKey,
} from "@ubi/contracts";

import {
  assertNoCommissionLines,
  resolveCommissionFunding,
} from "./commission-funding";
import {
  assertInputsEnvelope,
  itemProblem,
  type SettlementInputItem,
  type SettlementInputsClient,
} from "./inputs";
import { carryBalances, carryMemoLines, driverNetMinor } from "./ledger-reads";
import {
  allocateOutstanding,
  centiHours,
  type OriginBalance,
  percentBps,
  percentOfNetMinor,
  proRataRemittanceMinor,
} from "./math";
import {
  addDays,
  adjustmentEntryKey,
  adjustmentEventKey,
  adjustmentReference,
  assertWeekStart,
  FLEET_FLAG,
  FLEET_WALLET_OWNER,
  pairLockKey,
  REMITTANCE_AGGREGATE,
  REMITTANCE_EVENT_KIND,
  REMITTANCE_EVENTS,
  remittanceEventVersion,
  settlementEntryKey,
  settlementEventKey,
  settlementReference,
  weeksBetween,
} from "./model";
import { publishEvent, writeAudit } from "../ledger/audit";
import { spendableOf } from "../ledger/balances";
import { assertFlagEnabled } from "../ledger/city-config";
import { lockWallet, type WalletDeps } from "../ledger/context";
import { rangeWindow, type DayWindow } from "../ledger/day-window";
import { payloadHashOf } from "../ledger/mp-holds";
import { postEntry } from "../ledger/post-entry";
import {
  ensureWallet,
  requireWallet,
  type WalletRecord,
} from "../ledger/wallets";
import { logger } from "../lib/logger";

import type {
  Actor,
  JournalLineInput,
  JsonRecord,
  LedgerTx,
} from "../ledger/types";

// ── Records ────────────────────────────────────────────────────────────────

/**
 * The settled (assignment, week) — the `remittance.applied` payload and what
 * the run answers. Ids and amounts only: no driver net (Q7), no PII.
 */
export const RemittanceRecordSchema = z.object({
  kind: z.literal(REMITTANCE_EVENT_KIND),
  record: z.literal("settlement"),
  assignmentId: z.string(),
  fleetId: z.string(),
  driverId: z.string(),
  vehicleId: z.string(),
  cityId: z.string(),
  weekStart: z.string(),
  weekEnd: z.string(),
  currency: z.string(),
  inputsHash: z.string(),
  termsType: z.enum(["weekly_fixed", "percent_of_net"]),
  termsVersion: z.number(),
  maxWeeks: z.number(),
  shiftHours: z.number(),
  /**
   * The week's signed-shift basis a weekly_fixed amount is pro-rated over:
   * `shiftHours` itself, unless a mid-week supersession split the week
   * across versions (./math.ts). Hours, never money.
   */
  shiftBasisHours: z.number(),
  plannedMaintenanceHours: z.number(),
  unplannedOffRoadHours: z.number(),
  dueMinor: z.number(),
  capApplied: z.boolean(),
  carryInMinor: z.number(),
  expiredMinor: z.number(),
  owedMinor: z.number(),
  collectedMinor: z.number(),
  refundedMinor: z.number(),
  shortfallMinor: z.number(),
  carryOutMinor: z.number(),
  driverWalletLocked: z.boolean(),
  commissionFunding: z.literal("driver_wallet"),
  journalEntryId: z.string().nullable(),
  settledAt: z.string(),
});
export type RemittanceRecord = z.infer<typeof RemittanceRecordSchema>;

/** A linked adjustment of a closed week — also a `remittance.applied` payload. */
export const AdjustmentRecordSchema = z.object({
  kind: z.literal(REMITTANCE_EVENT_KIND),
  record: z.literal("adjustment"),
  assignmentId: z.string(),
  fleetId: z.string(),
  driverId: z.string(),
  cityId: z.string(),
  closedWeekStart: z.string(),
  sequence: z.number(),
  appliesToWeekStart: z.string(),
  currency: z.string(),
  previousInputsHash: z.string(),
  inputsHash: z.string(),
  previousDueMinor: z.number(),
  dueMinor: z.number(),
  deltaMinor: z.number(),
  settlementEntryId: z.string().nullable(),
  journalEntryId: z.string().nullable(),
  recordedAt: z.string(),
});
export type AdjustmentRecord = z.infer<typeof AdjustmentRecordSchema>;

export type ItemResult =
  | {
      readonly status: "settled" | "replayed";
      readonly assignmentId: string;
      readonly remittance: RemittanceRecord;
      readonly adjustments: readonly AdjustmentRecord[];
    }
  | {
      readonly status: "adjusted";
      readonly assignmentId: string;
      readonly remittance: RemittanceRecord;
      readonly adjustment: AdjustmentRecord;
      readonly adjustments: readonly AdjustmentRecord[];
    }
  | {
      readonly status: "refused";
      readonly assignmentId: string;
      readonly code: string;
      readonly reason: string | null;
      readonly message: string;
    };

export interface SettlementRunResult {
  readonly cityId: string;
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly zone: string;
  readonly currency: string;
  readonly items: readonly ItemResult[];
  readonly totals: {
    readonly items: number;
    readonly settled: number;
    readonly replayed: number;
    readonly adjusted: number;
    readonly refused: number;
    /** Collected this week across every settled record the run answers. */
    readonly collectedMinor: number;
    readonly shortfallMinor: number;
  };
}

// ── The week ───────────────────────────────────────────────────────────────

export interface WeekContext {
  readonly cityId: string;
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly window: DayWindow;
  readonly city: CityConfig;
}

/**
 * The settlement week in the city's zone: [weekStart 00:00 local,
 * weekEnd + 1 day 00:00 local). Only a week that has ENDED is settled.
 */
export async function weekContext(
  deps: WalletDeps,
  cityId: string,
  weekStart: string,
): Promise<WeekContext> {
  assertWeekStart(weekStart);
  const { city, flags } = await deps.config.load(cityId);
  // Deny-by-default: no money moves for a fleet in a city the flag is off in.
  assertFlagEnabled(flags, FLEET_FLAG);
  const weekEnd = addDays(weekStart, 6);
  const window = rangeWindow(weekStart, weekEnd, city.timezone);
  if (window.end.getTime() > deps.now().getTime()) {
    throw new ContractError(
      "illegal_transition",
      "that week has not ended yet; only a complete week is settled",
      { weekStart, endsAt: window.end.toISOString() },
    );
  }
  return { cityId, weekStart, weekEnd, window, city };
}

// ── Computation ────────────────────────────────────────────────────────────

interface DueComputation {
  readonly shiftCenti: number;
  readonly weekBasisCenti: number;
  readonly plannedCenti: number;
  readonly unplannedCenti: number;
  readonly percentBps: number | null;
  /** percent_of_net only — audit row, never an event (Q7). */
  readonly netMinor: number | null;
  readonly computedDueMinor: number;
  readonly capMinor: number;
  readonly capApplied: boolean;
  readonly dueMinor: number;
}

/** The part of the week the assignment was active in. */
function activeWindow(
  week: DayWindow,
  item: SettlementInputItem,
): { start: Date; end: Date } {
  const from = new Date(item.activeFrom);
  const to = item.activeTo === null ? null : new Date(item.activeTo);
  const start = from.getTime() > week.start.getTime() ? from : week.start;
  const end = to !== null && to.getTime() < week.end.getTime() ? to : week.end;
  return { start, end };
}

/**
 * The week's signed-shift basis of every item (./math.ts, "THE WEEK'S
 * BASIS"): items of the same fleet + driver whose active windows MEET
 * (`activeTo` of one is `activeFrom` of another — fleet-service's shape for
 * a superseded arrangement) form one chain, and each member's basis is the
 * chain's total signed shift hours. An item that stands alone — every item
 * of an ordinary week, and concurrent arrangements whose windows overlap —
 * keeps its own shift as its basis, i.e. exactly the Q2 formula. Items whose
 * hours do not parse are left out (they are refused item by item).
 */
export function weekShiftBases(
  items: readonly SettlementInputItem[],
): Map<string, number> {
  const centiOf = new Map<string, number>();
  for (const item of items) {
    try {
      centiOf.set(item.assignmentId, centiHours(item.shiftHoursInWeek));
    } catch {
      // Refused by itemProblem; contributes nothing to a chain.
    }
  }
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    let next = parent.get(root);
    while (next !== undefined && next !== root) {
      root = next;
      next = parent.get(root);
    }
    parent.set(id, root);
    return root;
  };
  const valid = items.filter((item) => centiOf.has(item.assignmentId));
  const byPair = new Map<string, SettlementInputItem[]>();
  for (const item of valid) {
    parent.set(item.assignmentId, item.assignmentId);
    const pair = `${item.fleetId}|${item.driverId}`;
    byPair.set(pair, [...(byPair.get(pair) ?? []), item]);
  }
  for (const members of byPair.values()) {
    for (const a of members) {
      if (a.activeTo === null) {
        continue;
      }
      const end = Date.parse(a.activeTo);
      for (const b of members) {
        if (b !== a && Date.parse(b.activeFrom) === end) {
          parent.set(find(a.assignmentId), find(b.assignmentId));
        }
      }
    }
  }
  const totals = new Map<string, number>();
  for (const item of valid) {
    const root = find(item.assignmentId);
    totals.set(
      root,
      (totals.get(root) ?? 0) + (centiOf.get(item.assignmentId) ?? 0),
    );
  }
  const bases = new Map<string, number>();
  for (const item of valid) {
    const total = totals.get(find(item.assignmentId));
    if (total !== undefined) {
      bases.set(item.assignmentId, total);
    }
  }
  return bases;
}

async function computeDue(
  tx: LedgerTx,
  ctx: WeekContext,
  item: SettlementInputItem,
  driverWalletId: string,
  weekBasisCenti: number,
): Promise<DueComputation> {
  const shiftCenti = centiHours(item.shiftHoursInWeek);
  const plannedCenti = centiHours(item.plannedMaintenanceHoursInWeek);
  const unplannedCenti = centiHours(item.unplannedOffRoadHoursInWeek);
  let computedDueMinor: number;
  let bps: number | null = null;
  let netMinor: number | null = null;
  if (item.terms.type === "weekly_fixed") {
    // Q2: planned maintenance only, over the week's signed-shift basis.
    // Q8: unplanned hours are never deducted.
    computedDueMinor = proRataRemittanceMinor(
      item.terms.amountMinor ?? 0,
      shiftCenti,
      plannedCenti,
      weekBasisCenti,
    );
  } else {
    bps = percentBps(item.terms.percent ?? 0);
    netMinor = await driverNetMinor(
      tx,
      driverWalletId,
      ctx.city.currency,
      activeWindow(ctx.window, item),
    );
    computedDueMinor = percentOfNetMinor(netMinor, bps);
  }
  const capMinor = ctx.city.remittanceCapMinor;
  const capApplied = computedDueMinor > capMinor;
  return {
    shiftCenti,
    weekBasisCenti,
    plannedCenti,
    unplannedCenti,
    percentBps: bps,
    netMinor,
    computedDueMinor,
    capMinor,
    capApplied,
    dueMinor: capApplied ? capMinor : computedDueMinor,
  };
}

/** Hash of everything the week's money depends on from contract B. */
export function inputsHashOf(
  ctx: WeekContext,
  item: SettlementInputItem,
  weekBasisCenti: number,
): string {
  return payloadHashOf({
    // A sibling version's hours move this item's weekly_fixed basis: a
    // change to them is a changed input (a linked adjustment when closed).
    weekShiftBasisCentiHours:
      item.terms.type === "weekly_fixed" ? weekBasisCenti : null,
    cityId: ctx.cityId,
    weekStart: ctx.weekStart,
    assignmentId: item.assignmentId,
    fleetId: item.fleetId,
    driverId: item.driverId,
    vehicleId: item.vehicleId,
    termsVersion: item.termsVersion,
    terms: {
      type: item.terms.type,
      amountMinor: item.terms.amountMinor,
      currency: item.terms.currency,
      percent: item.terms.percent,
      shortfall: {
        policy: item.terms.shortfall.policy,
        maxWeeks: item.terms.shortfall.maxWeeks,
      },
    },
    shiftHoursInWeek: item.shiftHoursInWeek,
    plannedMaintenanceHoursInWeek: item.plannedMaintenanceHoursInWeek,
    unplannedOffRoadHoursInWeek: item.unplannedOffRoadHoursInWeek,
    activeFrom: item.activeFrom,
    activeTo: item.activeTo,
  });
}

// ── Records on the outbox ──────────────────────────────────────────────────

export async function findSettlementRecord(
  tx: LedgerTx,
  assignmentId: string,
  weekStart: string,
): Promise<RemittanceRecord | null> {
  const row = await tx.outboxEvent.findUnique({
    where: { idempotencyKey: settlementEventKey(assignmentId, weekStart) },
  });
  if (row === null) {
    return null;
  }
  const parsed = RemittanceRecordSchema.safeParse(row.payload);
  if (!parsed.success) {
    throw new ContractError(
      "internal_error",
      "a remittance settlement record is unreadable",
      { assignmentId, weekStart },
    );
  }
  return parsed.data;
}

async function assignmentRecords(
  tx: LedgerTx,
  assignmentId: string,
): Promise<{
  settlements: RemittanceRecord[];
  adjustments: AdjustmentRecord[];
}> {
  const rows = await tx.outboxEvent.findMany({
    where: {
      aggregateType: REMITTANCE_AGGREGATE,
      aggregateId: assignmentId,
      name: REMITTANCE_EVENTS.applied,
    },
    select: { payload: true },
  });
  const settlements: RemittanceRecord[] = [];
  const adjustments: AdjustmentRecord[] = [];
  for (const row of rows) {
    const settled = RemittanceRecordSchema.safeParse(row.payload);
    if (settled.success) {
      settlements.push(settled.data);
      continue;
    }
    const adjusted = AdjustmentRecordSchema.safeParse(row.payload);
    if (adjusted.success) {
      adjustments.push(adjusted.data);
    }
  }
  adjustments.sort((a, b) => a.sequence - b.sequence);
  return { settlements, adjustments };
}

/** The linked adjustments recorded against one closed week, in order. */
export async function adjustmentsOf(
  tx: LedgerTx,
  assignmentId: string,
  weekStart: string,
): Promise<AdjustmentRecord[]> {
  const { adjustments } = await assignmentRecords(tx, assignmentId);
  return adjustments.filter((row) => row.closedWeekStart === weekStart);
}

async function lockPair(
  tx: LedgerTx,
  fleetId: string,
  driverId: string,
): Promise<void> {
  // Transaction-scoped: released at COMMIT / ROLLBACK, never leaked.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${pairLockKey(fleetId, driverId)}, 0))`;
}

function recordEventBase(
  ctx: WeekContext,
  item: SettlementInputItem,
  actor: Actor,
  occurredAt: Date,
) {
  return {
    aggregateType: REMITTANCE_AGGREGATE,
    aggregateId: item.assignmentId,
    fromVersion: null,
    actor,
    actorType: "system",
    cityId: ctx.cityId,
    occurredAt,
  } as const;
}

// ── Settling an open week ──────────────────────────────────────────────────

async function walletsFor(
  tx: LedgerTx,
  ctx: WeekContext,
  item: SettlementInputItem,
): Promise<{ driver: WalletRecord; fleet: WalletRecord }> {
  // The driver's wallet is the one marketplace earnings and the commission
  // already move through; the fleet's is created on first use (owner type
  // `fleet`, no migration — the round-6 organization-wallet pattern).
  const driver = await ensureWallet(tx, "user", item.driverId, ctx.city);
  const fleet = await ensureWallet(
    tx,
    FLEET_WALLET_OWNER,
    item.fleetId,
    ctx.city,
  );
  // One order everywhere: driver, then fleet. Re-read under the locks, so a
  // freeze that committed just before is honoured (never collect from it).
  await lockWallet(tx, driver.id);
  await lockWallet(tx, fleet.id);
  return {
    driver: await requireWallet(tx, driver.id),
    fleet: await requireWallet(tx, fleet.id),
  };
}

async function settleOpenWeekInTx(
  deps: WalletDeps,
  tx: LedgerTx,
  ctx: WeekContext,
  item: SettlementInputItem,
  inputsHash: string,
  weekBasisCenti: number,
  actor: Actor,
): Promise<ItemResult> {
  const now = deps.now();
  const currency = ctx.city.currency;
  const { fleetId, driverId, assignmentId } = item;
  const W = ctx.weekStart;
  const funding = resolveCommissionFunding(driverId);
  const wallets = await walletsFor(tx, ctx, item);
  const due = await computeDue(
    tx,
    ctx,
    item,
    wallets.driver.id,
    weekBasisCenti,
  );

  // The pair's carry-forward, by origin week. An adjustment attributed to a
  // LATER week waits for that week's settlement.
  const before = (await carryBalances(tx, fleetId, driverId, currency)).filter(
    (balance) => balance.origin <= W,
  );
  const maxWeeks = item.terms.shortfall.maxWeeks;
  const expired = before.filter(
    (balance) =>
      balance.amountMinor > 0 && weeksBetween(balance.origin, W) > maxWeeks,
  );
  const expiredOrigins = new Set(expired.map((balance) => balance.origin));
  const live = before.filter((balance) => !expiredOrigins.has(balance.origin));
  const expiredMinor = expired.reduce((sum, b) => sum + b.amountMinor, 0);
  const carryInMinor = live.reduce((sum, b) => sum + b.amountMinor, 0);
  const owedMinor = due.dueMinor + carryInMinor;

  let collectedMinor = 0;
  let refundedMinor = 0;
  if (owedMinor > 0 && !wallets.driver.locked) {
    // Never below the driver's spendable balance: no overdraft, no credit.
    const spendable = await spendableOf(tx, wallets.driver.id, currency);
    collectedMinor = Math.min(owedMinor, Math.max(0, spendable.amountMinor));
  } else if (owedMinor < 0 && !wallets.fleet.locked) {
    // A credit the fleet owes back (a closed week found over-charged): paid
    // from the fleet wallet as far as it covers; the rest stays a credit.
    const spendable = await spendableOf(tx, wallets.fleet.id, currency);
    refundedMinor = Math.min(-owedMinor, Math.max(0, spendable.amountMinor));
  }
  const remainingMinor = owedMinor - collectedMinor + refundedMinor;

  // Where the remainder sits by origin (oldest paid first).
  const liveAtW = live.find((b) => b.origin === W)?.amountMinor ?? 0;
  const claims: OriginBalance[] = [
    ...live.filter((b) => b.origin !== W),
    { origin: W, amountMinor: liveAtW + due.dueMinor },
  ];
  const after = allocateOutstanding(claims, remainingMinor);

  const reference = settlementReference(assignmentId, W);
  const lines: JournalLineInput[] = [];
  if (collectedMinor > 0) {
    lines.push(
      {
        account: "wallet",
        walletId: wallets.driver.id,
        amount: money(-collectedMinor, currency),
        counterpartRef: reference,
      },
      {
        account: "wallet",
        walletId: wallets.fleet.id,
        amount: money(collectedMinor, currency),
        counterpartRef: reference,
      },
    );
  }
  if (refundedMinor > 0) {
    lines.push(
      {
        account: "wallet",
        walletId: wallets.fleet.id,
        amount: money(-refundedMinor, currency),
        counterpartRef: `${reference}:refund`,
      },
      {
        account: "wallet",
        walletId: wallets.driver.id,
        amount: money(refundedMinor, currency),
        counterpartRef: `${reference}:refund`,
      },
    );
  }
  const origins = new Set<string>([...before.map((b) => b.origin), W]);
  for (const origin of [...origins].sort()) {
    const pre = before.find((b) => b.origin === origin)?.amountMinor ?? 0;
    const post = expiredOrigins.has(origin) ? 0 : (after.get(origin) ?? 0);
    lines.push(
      ...carryMemoLines(fleetId, driverId, origin, post - pre, currency),
    );
  }
  assertNoCommissionLines(lines);

  const entry =
    lines.length === 0
      ? null
      : await postEntry(tx, {
          kind: "fleet_remittance_settlement",
          reference,
          occurredAt: now,
          idempotencyKey: settlementEntryKey(assignmentId, W),
          description: "weekly fleet remittance (commission untouched)",
          lines,
        });

  const shortfallMinor =
    remainingMinor > 0 ? Math.min(due.dueMinor, remainingMinor) : 0;
  const record: RemittanceRecord = {
    kind: REMITTANCE_EVENT_KIND,
    record: "settlement",
    assignmentId,
    fleetId,
    driverId,
    vehicleId: item.vehicleId,
    cityId: ctx.cityId,
    weekStart: W,
    weekEnd: ctx.weekEnd,
    currency,
    inputsHash,
    termsType: item.terms.type,
    termsVersion: item.termsVersion,
    maxWeeks,
    shiftHours: item.shiftHoursInWeek,
    shiftBasisHours: due.weekBasisCenti / 100,
    plannedMaintenanceHours: item.plannedMaintenanceHoursInWeek,
    unplannedOffRoadHours: item.unplannedOffRoadHoursInWeek,
    dueMinor: due.dueMinor,
    capApplied: due.capApplied,
    carryInMinor,
    expiredMinor,
    owedMinor,
    collectedMinor,
    refundedMinor,
    shortfallMinor,
    carryOutMinor: remainingMinor,
    driverWalletLocked: wallets.driver.locked,
    commissionFunding: funding.source,
    journalEntryId: entry?.id ?? null,
    settledAt: now.toISOString(),
  };

  await writeAudit(tx, {
    actor,
    action: "fleet.remittance.settled",
    subjectType: "fleet_assignment_week",
    subjectId: `${assignmentId}:${W}`,
    before: null,
    after: {
      ...record,
      // The computation, for ops. The driver's net stays HERE (Q7).
      computation: {
        shiftCentiHours: due.shiftCenti,
        weekShiftBasisCentiHours: due.weekBasisCenti,
        plannedCentiHours: due.plannedCenti,
        unplannedCentiHours: due.unplannedCenti,
        amountMinor: item.terms.amountMinor,
        percentBps: due.percentBps,
        netMinor: due.netMinor,
        computedDueMinor: due.computedDueMinor,
        capMinor: due.capMinor,
        rounding: "floor",
      },
      expiredOrigins: [...expiredOrigins],
    },
  });
  const base = recordEventBase(ctx, item, actor, now);
  const key = settlementEventKey(assignmentId, W);
  await publishEvent(tx, {
    ...base,
    name: REMITTANCE_EVENTS.applied,
    toVersion: remittanceEventVersion(W, 0),
    idempotencyKey: key,
    payload: { ...record },
  });
  if (shortfallMinor > 0) {
    await publishEvent(tx, {
      ...base,
      name: REMITTANCE_EVENTS.shortfall,
      toVersion: remittanceEventVersion(W, 1),
      idempotencyKey: `${key}:s`,
      payload: eventSummary(record),
    });
  }
  if (remainingMinor !== 0 || expiredMinor > 0) {
    await publishEvent(tx, {
      ...base,
      name: REMITTANCE_EVENTS.carried,
      toVersion: remittanceEventVersion(W, 2),
      idempotencyKey: `${key}:c`,
      payload: eventSummary(record),
    });
  }
  return {
    status: "settled",
    assignmentId,
    remittance: record,
    adjustments: [],
  };
}

function eventSummary(record: RemittanceRecord): JsonRecord {
  return {
    kind: REMITTANCE_EVENT_KIND,
    assignmentId: record.assignmentId,
    fleetId: record.fleetId,
    driverId: record.driverId,
    weekStart: record.weekStart,
    currency: record.currency,
    dueMinor: record.dueMinor,
    collectedMinor: record.collectedMinor,
    shortfallMinor: record.shortfallMinor,
    carryOutMinor: record.carryOutMinor,
    expiredMinor: record.expiredMinor,
    maxWeeks: record.maxWeeks,
    journalEntryId: record.journalEntryId,
  };
}

// ── A closed week ──────────────────────────────────────────────────────────

/** The earliest week after `weekStart` the assignment has not settled. */
function nextOpenWeek(
  settled: readonly RemittanceRecord[],
  weekStart: string,
): string {
  const weeks = new Set(settled.map((row) => row.weekStart));
  let candidate = addDays(weekStart, 7);
  while (weeks.has(candidate)) {
    candidate = addDays(candidate, 7);
  }
  return candidate;
}

async function closedWeekInTx(
  deps: WalletDeps,
  tx: LedgerTx,
  ctx: WeekContext,
  item: SettlementInputItem,
  inputsHash: string,
  weekBasisCenti: number,
  settlement: RemittanceRecord,
  actor: Actor,
): Promise<ItemResult> {
  const { assignmentId } = item;
  if (
    settlement.fleetId !== item.fleetId ||
    settlement.driverId !== item.driverId
  ) {
    throw new ContractError(
      "conflict",
      "this assignment's week was settled for a different fleet or driver; ops must review it",
      { reason: "assignment_parties_changed", assignmentId },
    );
  }
  const records = await assignmentRecords(tx, assignmentId);
  const adjustments = records.adjustments.filter(
    (row) => row.closedWeekStart === ctx.weekStart,
  );
  const latest = adjustments.at(-1);
  const latestHash = latest?.inputsHash ?? settlement.inputsHash;
  if (inputsHash === latestHash) {
    return {
      status: "replayed",
      assignmentId,
      remittance: settlement,
      adjustments,
    };
  }

  // New inputs for a CLOSED week: never re-settled — the difference is a
  // linked adjustment carried to the assignment's next open week.
  const now = deps.now();
  const currency = ctx.city.currency;
  const driver = await ensureWallet(tx, "user", item.driverId, ctx.city);
  const due = await computeDue(tx, ctx, item, driver.id, weekBasisCenti);
  const previousDueMinor = latest?.dueMinor ?? settlement.dueMinor;
  const deltaMinor = due.dueMinor - previousDueMinor;
  const sequence = adjustments.length + 1;
  const appliesTo = nextOpenWeek(records.settlements, ctx.weekStart);
  const lines = carryMemoLines(
    item.fleetId,
    item.driverId,
    appliesTo,
    deltaMinor,
    currency,
  );
  assertNoCommissionLines(lines);
  const entry =
    lines.length === 0
      ? null
      : await postEntry(tx, {
          kind: "fleet_remittance_adjustment",
          reference: adjustmentReference(assignmentId, ctx.weekStart, sequence),
          occurredAt: now,
          idempotencyKey: adjustmentEntryKey(
            assignmentId,
            ctx.weekStart,
            sequence,
          ),
          description: `linked adjustment of closed week ${ctx.weekStart}, applied in ${appliesTo}`,
          lines,
        });
  const adjustment: AdjustmentRecord = {
    kind: REMITTANCE_EVENT_KIND,
    record: "adjustment",
    assignmentId,
    fleetId: item.fleetId,
    driverId: item.driverId,
    cityId: ctx.cityId,
    closedWeekStart: ctx.weekStart,
    sequence,
    appliesToWeekStart: appliesTo,
    currency,
    previousInputsHash: latestHash,
    inputsHash,
    previousDueMinor,
    dueMinor: due.dueMinor,
    deltaMinor,
    settlementEntryId: settlement.journalEntryId,
    journalEntryId: entry?.id ?? null,
    recordedAt: now.toISOString(),
  };
  await writeAudit(tx, {
    actor,
    action: "fleet.remittance.adjusted",
    subjectType: "fleet_assignment_week",
    subjectId: `${assignmentId}:${ctx.weekStart}`,
    before: { dueMinor: previousDueMinor, inputsHash: latestHash },
    after: {
      ...adjustment,
      computation: {
        shiftCentiHours: due.shiftCenti,
        weekShiftBasisCentiHours: due.weekBasisCenti,
        plannedCentiHours: due.plannedCenti,
        unplannedCentiHours: due.unplannedCenti,
        percentBps: due.percentBps,
        netMinor: due.netMinor,
        computedDueMinor: due.computedDueMinor,
        capMinor: due.capMinor,
      },
    },
    reason: "closed week inputs changed",
  });
  await publishEvent(tx, {
    ...recordEventBase(ctx, item, actor, now),
    name: REMITTANCE_EVENTS.applied,
    toVersion: remittanceEventVersion(appliesTo, 3),
    idempotencyKey: adjustmentEventKey(assignmentId, ctx.weekStart, sequence),
    payload: { ...adjustment },
  });
  return {
    status: "adjusted",
    assignmentId,
    remittance: settlement,
    adjustment,
    adjustments: [...adjustments, adjustment],
  };
}

// ── One item, one transaction ──────────────────────────────────────────────

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function refused(item: SettlementInputItem, error: ContractError): ItemResult {
  const reason = error.details?.reason;
  return {
    status: "refused",
    assignmentId: item.assignmentId,
    code: error.code,
    reason: typeof reason === "string" ? reason : null,
    message: error.message,
  };
}

/**
 * Settles one contract-B item for the week, exactly once. Refusals are
 * answered per item (the rest of the week still settles); an unexpected
 * failure rolls that item's transaction back and is reported, so a re-run
 * picks it up.
 */
export async function settleItem(
  deps: WalletDeps,
  ctx: WeekContext,
  item: SettlementInputItem,
  actor: Actor,
  weekBasis?: number,
): Promise<ItemResult> {
  const problem = itemProblem(item, ctx.city.currency);
  if (problem !== null) {
    return refused(
      item,
      new ContractError("validation_failed", problem.message, {
        reason: problem.reason,
      }),
    );
  }
  // The item's own shift unless the run found it in a mid-week chain.
  const weekBasisCenti = weekBasis ?? centiHours(item.shiftHoursInWeek);
  const inputsHash = inputsHashOf(ctx, item, weekBasisCenti);
  const attempt = async (): Promise<ItemResult> => {
    const outcome = await deps.db.$transaction(async (tx) => {
      await lockPair(tx, item.fleetId, item.driverId);
      const settled = await findSettlementRecord(
        tx,
        item.assignmentId,
        ctx.weekStart,
      );
      if (settled !== null) {
        return closedWeekInTx(
          deps,
          tx,
          ctx,
          item,
          inputsHash,
          weekBasisCenti,
          settled,
          actor,
        );
      }
      return settleOpenWeekInTx(
        deps,
        tx,
        ctx,
        item,
        inputsHash,
        weekBasisCenti,
        actor,
      );
    });
    return outcome;
  };
  try {
    try {
      return await attempt();
    } catch (error) {
      // A rival settled this (assignment, week) under another pair lock (its
      // parties changed): the unique keys refused ours — re-read and answer.
      if (isUniqueViolation(error)) {
        return await attempt();
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof ContractError) {
      return refused(item, error);
    }
    logger.error(
      {
        err: error,
        component: "fleet-settlement",
        assignmentId: item.assignmentId,
      },
      "fleet remittance item failed; a re-run will retry it",
    );
    return refused(
      item,
      new ContractError(
        "internal_error",
        "this item could not be settled; a re-run retries it",
      ),
    );
  }
}

/**
 * Settles a whole (city, week) from contract B. Idempotent and restart-safe:
 * running it again replays what settled and settles what did not.
 */
export async function runWeeklySettlement(
  deps: WalletDeps,
  client: SettlementInputsClient,
  input: {
    readonly cityId: string;
    readonly weekStart: string;
    readonly actor: Actor;
  },
): Promise<SettlementRunResult> {
  const ctx = await weekContext(deps, input.cityId, input.weekStart);
  const inputs = await client.fetchInputs(input.cityId, input.weekStart);
  assertInputsEnvelope(inputs, {
    weekStart: ctx.weekStart,
    timezone: ctx.city.timezone,
  });
  const bases = weekShiftBases(inputs.items);
  const items: ItemResult[] = [];
  for (const item of inputs.items) {
    items.push(
      await settleItem(
        deps,
        ctx,
        item,
        input.actor,
        bases.get(item.assignmentId),
      ),
    );
  }
  let collectedMinor = 0;
  let shortfallMinor = 0;
  const count = { settled: 0, replayed: 0, adjusted: 0, refused: 0 };
  for (const result of items) {
    count[result.status] += 1;
    if (result.status !== "refused") {
      collectedMinor += result.remittance.collectedMinor;
      shortfallMinor += result.remittance.shortfallMinor;
    }
  }
  return {
    cityId: ctx.cityId,
    weekStart: ctx.weekStart,
    weekEnd: ctx.weekEnd,
    zone: inputs.zone,
    currency: ctx.city.currency,
    items,
    totals: { items: items.length, ...count, collectedMinor, shortfallMinor },
  };
}

// ── Reads (ops) ────────────────────────────────────────────────────────────

/** Every settlement and adjustment recorded for a (city, week). */
export async function settlementsOfWeek(
  deps: WalletDeps,
  cityId: string,
  weekStart: string,
): Promise<{
  readonly cityId: string;
  readonly weekStart: string;
  readonly settlements: readonly RemittanceRecord[];
  readonly adjustments: readonly AdjustmentRecord[];
}> {
  assertWeekStart(weekStart);
  const [settledRows, adjustedRows] = await Promise.all([
    deps.db.outboxEvent.findMany({
      where: {
        name: REMITTANCE_EVENTS.applied,
        aggregateType: REMITTANCE_AGGREGATE,
        cityId,
        payload: { path: ["weekStart"], equals: weekStart },
      },
      orderBy: { createdAt: "asc" },
    }),
    deps.db.outboxEvent.findMany({
      where: {
        name: REMITTANCE_EVENTS.applied,
        aggregateType: REMITTANCE_AGGREGATE,
        cityId,
        payload: { path: ["closedWeekStart"], equals: weekStart },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return {
    cityId,
    weekStart,
    settlements: settledRows.flatMap((row) => {
      const parsed = RemittanceRecordSchema.safeParse(row.payload);
      return parsed.success ? [parsed.data] : [];
    }),
    adjustments: adjustedRows.flatMap((row) => {
      const parsed = AdjustmentRecordSchema.safeParse(row.payload);
      return parsed.success ? [parsed.data] : [];
    }),
  };
}

/** The pair's derived carry-forward, by origin week (ops). */
export async function carryForwardView(
  deps: WalletDeps,
  fleetId: string,
  driverId: string,
  currency: string,
): Promise<{
  readonly fleetId: string;
  readonly driverId: string;
  readonly currency: string;
  readonly outstanding: {
    readonly amountMinor: number;
    readonly currency: string;
  };
  readonly origins: readonly OriginBalance[];
}> {
  const origins = await carryBalances(deps.db, fleetId, driverId, currency);
  return {
    fleetId,
    driverId,
    currency,
    outstanding: money(
      origins.reduce((sum, origin) => sum + origin.amountMinor, 0),
      currency,
    ),
    origins,
  };
}

// ── The ops run's own idempotency record ───────────────────────────────────

const RUN_SUBJECT = "fleet_settlement_run";

const RunRecordSchema = z.object({
  payloadHash: z.string(),
  result: z.unknown(),
});

/**
 * `POST /v1/finance/fleet/settlements/run` under an Idempotency-Key. Every
 * item is already exactly-once on (assignment, week); the key additionally
 * binds to its (city, week): the same key answers the ORIGINAL run verbatim,
 * and the same key with another city or week is `idempotency_key_reuse`. A
 * run that crashed before recording leaves no record, so its retry runs
 * again — converging on the per-item records.
 */
export async function runSettlementOnce(
  deps: WalletDeps,
  client: SettlementInputsClient,
  input: { readonly cityId: string; readonly weekStart: string },
  actor: Actor,
  clientKey: string,
): Promise<{
  readonly result: SettlementRunResult;
  readonly replayed: boolean;
}> {
  const key = scopedIdempotencyKey("fleet.settlement.run", actor.id, clientKey);
  const hash = payloadHashOf({
    cityId: input.cityId,
    weekStart: input.weekStart,
  });
  const recorded = async (
    tx: LedgerTx,
  ): Promise<SettlementRunResult | null> => {
    const row = await tx.auditLog.findFirst({
      where: { subjectType: RUN_SUBJECT, subjectId: key },
      orderBy: { createdAt: "asc" },
    });
    if (row === null) {
      return null;
    }
    const parsed = RunRecordSchema.safeParse(row.after);
    if (!parsed.success) {
      throw new ContractError(
        "internal_error",
        "a settlement run record is unreadable",
      );
    }
    if (parsed.data.payloadHash !== hash) {
      throw new ContractError(
        "idempotency_key_reuse",
        "this idempotency key was already used for another city or week",
      );
    }
    return parsed.data.result as SettlementRunResult;
  };

  const prior = await recorded(deps.db);
  if (prior !== null) {
    return { result: prior, replayed: true };
  }
  const result = await runWeeklySettlement(deps, client, {
    ...input,
    actor,
  });
  return deps.db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const raced = await recorded(tx);
    if (raced !== null) {
      return { result: raced, replayed: true };
    }
    await writeAudit(tx, {
      actor,
      action: "fleet.settlement.run",
      subjectType: RUN_SUBJECT,
      subjectId: key,
      before: null,
      after: {
        payloadHash: hash,
        clientKey,
        cityId: input.cityId,
        weekStart: input.weekStart,
        result: JSON.parse(JSON.stringify(result)) as JsonRecord,
      },
    });
    return { result, replayed: false };
  });
}
