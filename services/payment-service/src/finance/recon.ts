/**
 * Daily reconciliation (slice 11, board 13c).
 *
 * The ledger is compared with each external rail for a business day. Anything
 * that does not agree becomes a break with an owner and a deadline. Day-close
 * is gated: while any break is neither adjusted nor explained the close returns
 * `recon_unexplained`, and no amount of retrying changes that — the only ways
 * through are a journal entry that references a case, or an explanation that
 * references one. History is never edited.
 */
import {
  assertKnownEventName,
  ContractError,
  type Money,
  money,
} from "@ubi/contracts";

import type { LedgerAccount } from "../ledger/accounts";
import { writeAudit } from "../ledger/audit";
import type { WalletDeps } from "../ledger/context";
import { assertIsoDate, dayWindow } from "../ledger/day-window";
import { fromDbMinor, fromNullableDbMinor } from "../ledger/minor-units";
import { postEntry } from "../ledger/post-entry";
import type { Actor, LedgerTx } from "../ledger/types";
import { generateId } from "../lib/utils";

import {
  isExplanation,
  RAIL_ACCOUNTS,
  RECON_RAILS,
  type ReconRailName,
  RESOLUTION_PREFIXES,
} from "./rails";

/** One line of a reconciliation adjustment, in the run's currency. */
export interface AdjustmentLine {
  readonly account: LedgerAccount;
  readonly walletId?: string | null;
  readonly amountMinor: number;
}

export interface ReconBreakView {
  readonly id: string;
  readonly amount: Money;
  readonly description: string;
  readonly owner: string | null;
  readonly deadline: string | null;
  readonly resolutionRef: string | null;
  readonly resolvedAt: string | null;
}

export interface ReconRailView {
  readonly rail: ReconRailName;
  readonly ledger: Money;
  readonly external: Money;
  readonly diff: Money;
  readonly status: string;
  readonly externalReported: boolean;
  readonly breaks: readonly ReconBreakView[];
}

export interface ReconReport {
  readonly date: string;
  readonly cityId: string;
  readonly currency: string;
  readonly status: string;
  readonly unexplained: Money;
  readonly closeAllowed: boolean;
  readonly closedBy: string | null;
  readonly closedAt: string | null;
  readonly rails: readonly ReconRailView[];
}

interface RunContext {
  readonly date: string;
  readonly currency: string;
  readonly timezone: string;
  readonly slaHours: number;
}

async function runContext(deps: WalletDeps, cityId: string, date: string): Promise<RunContext> {
  assertIsoDate(date);
  const config = await deps.config.loadForWallet(cityId);
  return {
    date,
    currency: config.city.currency,
    timezone: config.city.timezone,
    slaHours: config.policy.reconBreakSlaHours,
  };
}

const asDate = (isoDate: string): Date => new Date(`${isoDate}T00:00:00.000Z`);

/** Net inflow the ledger says arrived over this rail on this day. */
async function ledgerTotal(
  tx: LedgerTx,
  rail: ReconRailName,
  currency: string,
  window: { readonly start: Date; readonly end: Date },
): Promise<number> {
  const aggregate = await tx.journalLine.aggregate({
    _sum: { amountMinor: true },
    where: {
      account: { in: [...RAIL_ACCOUNTS[rail]] },
      currency,
      entry: { occurredAt: { gte: window.start, lt: window.end } },
    },
  });
  return -fromNullableDbMinor(aggregate._sum.amountMinor);
}

async function requireOpenRun(
  tx: LedgerTx,
  date: string,
  currency: string,
): Promise<void> {
  const run = await tx.reconRun.findUnique({ where: { date: asDate(date) } });
  if (run === null) {
    return;
  }
  if (run.currency !== currency) {
    throw new ContractError(
      "conflict",
      "that date is already reconciled in another currency",
      { date, existingCurrency: run.currency, requestedCurrency: currency },
    );
  }
  if (run.status === "closed") {
    throw new ContractError("conflict", "that reconciliation day is already closed", {
      date,
    });
  }
}

export interface ExternalTotalInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly date: string;
  readonly rail: ReconRailName;
  readonly amountMinor: number;
  readonly source: string;
}

/**
 * Records what a counterparty's own statement says for the day. Nothing is
 * invented here: a rail with no statement stays `externalReported: false` and
 * is shown as awaiting its file rather than silently reconciling to zero.
 */
export async function recordExternalTotal(
  deps: WalletDeps,
  input: ExternalTotalInput,
): Promise<ReconRailView> {
  const context = await runContext(deps, input.cityId, input.date);

  return deps.db.$transaction(async (tx) => {
    await requireOpenRun(tx, input.date, context.currency);
    await ensureRun(tx, context);

    const existing = await tx.reconRail.findUnique({
      where: { date_rail: { date: asDate(input.date), rail: input.rail } },
    });
    const ledgerMinor =
      existing === null
        ? await ledgerTotal(
            tx,
            input.rail,
            context.currency,
            dayWindow(input.date, context.timezone),
          )
        : fromDbMinor(existing.ledgerMinor);

    const railId = existing?.id ?? generateId("rrl");
    await tx.reconRail.upsert({
      where: { date_rail: { date: asDate(input.date), rail: input.rail } },
      create: {
        id: railId,
        date: asDate(input.date),
        rail: input.rail,
        ledgerMinor: BigInt(ledgerMinor),
        externalMinor: BigInt(input.amountMinor),
        diffMinor: BigInt(ledgerMinor - input.amountMinor),
        currency: context.currency,
        status: ledgerMinor - input.amountMinor === 0 ? "balanced" : "break",
      },
      update: {
        externalMinor: BigInt(input.amountMinor),
        diffMinor: BigInt(ledgerMinor - input.amountMinor),
        status: ledgerMinor - input.amountMinor === 0 ? "balanced" : "break",
      },
    });

    await writeAudit(tx, {
      actor: input.actor,
      action: "finance.recon.external_recorded",
      subjectType: "recon",
      subjectId: `${input.date}:${input.rail}`,
      after: {
        externalMinor: input.amountMinor,
        currency: context.currency,
        source: input.source,
      },
    });

    return railView(tx, railId, input.rail, context.currency);
  });
}

async function ensureRun(tx: LedgerTx, context: RunContext): Promise<void> {
  await tx.reconRun.upsert({
    where: { date: asDate(context.date) },
    create: {
      date: asDate(context.date),
      status: "open",
      unexplainedMinor: BigInt(0),
      currency: context.currency,
    },
    update: {},
  });
}

async function railView(
  tx: LedgerTx,
  railId: string,
  rail: ReconRailName,
  currency: string,
): Promise<ReconRailView> {
  const row = await tx.reconRail.findUniqueOrThrow({
    where: { id: railId },
    include: { breaks: { orderBy: { createdAt: "asc" } } },
  });
  return {
    rail,
    ledger: money(fromDbMinor(row.ledgerMinor), currency),
    external: money(fromDbMinor(row.externalMinor), currency),
    diff: money(fromDbMinor(row.diffMinor), currency),
    status: row.status,
    externalReported: true,
    breaks: row.breaks.map((entry) => ({
      id: entry.id,
      amount: money(fromDbMinor(entry.amountMinor), currency),
      description: entry.description,
      owner: entry.owner,
      deadline: entry.deadline?.toISOString() ?? null,
      resolutionRef: entry.resolutionRef,
      resolvedAt: entry.resolvedAt?.toISOString() ?? null,
    })),
  };
}

export interface RunReconInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly date: string;
}

/**
 * Recomputes every rail against the journal and brings its breaks up to date.
 * Safe to run repeatedly: a rail that now agrees closes its break, and one that
 * still differs has its outstanding amount corrected rather than duplicated.
 */
export async function runRecon(
  deps: WalletDeps,
  input: RunReconInput,
): Promise<ReconReport> {
  const now = deps.now();
  const context = await runContext(deps, input.cityId, input.date);
  const window = dayWindow(input.date, context.timezone);

  await deps.db.$transaction(async (tx) => {
    await requireOpenRun(tx, input.date, context.currency);
    await ensureRun(tx, context);

    for (const rail of RECON_RAILS) {
      const ledgerMinor = await ledgerTotal(tx, rail, context.currency, window);
      const existing = await tx.reconRail.findUnique({
        where: { date_rail: { date: asDate(input.date), rail } },
      });

      // A rail with neither ledger movement nor an external statement has
      // nothing to reconcile; leave it out rather than assert it balanced.
      if (existing === null && ledgerMinor === 0) {
        continue;
      }

      const externalMinor = existing === null ? 0 : fromDbMinor(existing.externalMinor);
      const diffMinor = ledgerMinor - externalMinor;
      const railId = existing?.id ?? generateId("rrl");

      await tx.reconRail.upsert({
        where: { date_rail: { date: asDate(input.date), rail } },
        create: {
          id: railId,
          date: asDate(input.date),
          rail,
          ledgerMinor: BigInt(ledgerMinor),
          externalMinor: BigInt(externalMinor),
          diffMinor: BigInt(diffMinor),
          currency: context.currency,
          status: diffMinor === 0 ? "balanced" : "break",
        },
        update: {
          ledgerMinor: BigInt(ledgerMinor),
          diffMinor: BigInt(diffMinor),
          status: diffMinor === 0 ? "balanced" : "break",
        },
      });

      await syncBreak(tx, {
        railId,
        rail,
        diffMinor,
        currency: context.currency,
        actor: input.actor,
        cityId: input.cityId,
        slaHours: context.slaHours,
        now,
      });
    }

    const unexplained = await unexplainedTotal(tx, input.date);
    await tx.reconRun.update({
      where: { date: asDate(input.date) },
      data: { unexplainedMinor: BigInt(unexplained) },
    });

    await tx.outboxEvent.create({
      data: {
        id: generateId("evt"),
        name: assertKnownEventName("recon.run"),
        aggregateType: "recon",
        aggregateId: input.date,
        toVersion: 1,
        cityId: input.cityId,
        actorType: "agent",
        actorId: input.actor.id,
        idempotencyKey: `recon.run:${input.date}:${now.toISOString()}`,
        payload: {
          date: input.date,
          unexplainedMinor: unexplained,
          currency: context.currency,
        },
        occurredAt: now,
      },
    });

    await writeAudit(tx, {
      actor: input.actor,
      action: "finance.recon.run",
      subjectType: "recon",
      subjectId: input.date,
      after: { unexplainedMinor: unexplained, currency: context.currency },
    });
  });

  return getRecon(deps, input.cityId, input.date);
}

interface SyncBreakInput {
  readonly railId: string;
  readonly rail: ReconRailName;
  readonly diffMinor: number;
  readonly currency: string;
  readonly actor: Actor;
  readonly cityId: string;
  readonly slaHours: number;
  readonly now: Date;
}

async function syncBreak(tx: LedgerTx, input: SyncBreakInput): Promise<void> {
  const breaks = await tx.reconBreak.findMany({ where: { railId: input.railId } });
  const explained = breaks
    .filter((entry) => entry.resolvedAt !== null && isExplanation(entry.resolutionRef))
    .reduce((total, entry) => total + fromDbMinor(entry.amountMinor), 0);
  const outstanding = input.diffMinor - explained;
  const open = breaks.find((entry) => entry.resolvedAt === null);

  if (outstanding === 0) {
    if (open !== undefined) {
      await tx.reconBreak.update({
        where: { id: open.id },
        data: {
          amountMinor: BigInt(0),
          resolvedAt: input.now,
          resolutionRef: `${RESOLUTION_PREFIXES.adjustment}cleared`,
        },
      });
      await writeAudit(tx, {
        actor: input.actor,
        action: "finance.recon.break_cleared",
        subjectType: "recon",
        subjectId: open.id,
        after: { railId: input.railId, diffMinor: input.diffMinor },
      });
    }
    return;
  }

  if (open !== undefined) {
    await tx.reconBreak.update({
      where: { id: open.id },
      data: { amountMinor: BigInt(outstanding) },
    });
    return;
  }

  const breakId = generateId("rbk");
  await tx.reconBreak.create({
    data: {
      id: breakId,
      railId: input.railId,
      amountMinor: BigInt(outstanding),
      currency: input.currency,
      description: `${input.rail}: ledger and external statement differ`,
      deadline: new Date(input.now.getTime() + input.slaHours * 3_600_000),
    },
  });

  await tx.outboxEvent.create({
    data: {
      id: generateId("evt"),
      name: assertKnownEventName("recon.break_opened"),
      aggregateType: "recon",
      aggregateId: breakId,
      toVersion: 1,
      cityId: input.cityId,
      actorType: "agent",
      actorId: input.actor.id,
      idempotencyKey: `recon.break_opened:${breakId}`,
      payload: {
        breakId,
        rail: input.rail,
        diffMinor: outstanding,
        currency: input.currency,
      },
      occurredAt: input.now,
    },
  });
}

async function unexplainedTotal(tx: LedgerTx, date: string): Promise<number> {
  const rails = await tx.reconRail.findMany({
    where: { date: asDate(date) },
    include: { breaks: { where: { resolvedAt: null } } },
  });
  return rails.reduce(
    (total, rail) =>
      total +
      rail.breaks.reduce(
        (railTotal, entry) => railTotal + Math.abs(fromDbMinor(entry.amountMinor)),
        0,
      ),
    0,
  );
}

export async function getRecon(
  deps: WalletDeps,
  cityId: string,
  date: string,
): Promise<ReconReport> {
  const context = await runContext(deps, cityId, date);

  return deps.db.$transaction(async (tx) => {
    const run = await tx.reconRun.findUnique({ where: { date: asDate(date) } });
    const rails = await tx.reconRail.findMany({
      where: { date: asDate(date) },
      include: { breaks: { orderBy: { createdAt: "asc" } } },
    });

    const views: ReconRailView[] = rails.map((row) => ({
      rail: row.rail as ReconRailName,
      ledger: money(fromDbMinor(row.ledgerMinor), row.currency),
      external: money(fromDbMinor(row.externalMinor), row.currency),
      diff: money(fromDbMinor(row.diffMinor), row.currency),
      status: row.status,
      externalReported: row.externalMinor !== BigInt(0) || row.status === "balanced",
      breaks: row.breaks.map((entry) => ({
        id: entry.id,
        amount: money(fromDbMinor(entry.amountMinor), entry.currency),
        description: entry.description,
        owner: entry.owner,
        deadline: entry.deadline?.toISOString() ?? null,
        resolutionRef: entry.resolutionRef,
        resolvedAt: entry.resolvedAt?.toISOString() ?? null,
      })),
    }));

    const unexplained = await unexplainedTotal(tx, date);

    return {
      date,
      cityId,
      currency: run?.currency ?? context.currency,
      status: run?.status ?? "not_run",
      unexplained: money(unexplained, run?.currency ?? context.currency),
      closeAllowed: run !== null && run.status === "open" && unexplained === 0,
      closedBy: run?.closedBy ?? null,
      closedAt: run?.closedAt?.toISOString() ?? null,
      rails: views,
    };
  });
}

export interface AssignBreakInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly date: string;
  readonly breakId: string;
  readonly owner: string;
  readonly deadline?: string | undefined;
}

export async function assignBreak(
  deps: WalletDeps,
  input: AssignBreakInput,
): Promise<ReconBreakView> {
  const now = deps.now();

  return deps.db.$transaction(async (tx) => {
    const entry = await tx.reconBreak.findUnique({ where: { id: input.breakId } });
    if (entry === null) {
      throw new ContractError("not_found", "no such reconciliation break");
    }
    const deadline = input.deadline === undefined ? entry.deadline : new Date(input.deadline);
    await tx.reconBreak.update({
      where: { id: entry.id },
      data: { owner: input.owner, deadline },
    });
    await writeAudit(tx, {
      actor: input.actor,
      action: "finance.recon.break_owned",
      subjectType: "recon",
      subjectId: entry.id,
      before: { owner: entry.owner },
      after: { owner: input.owner, deadline: deadline?.toISOString() ?? null },
    });
    await tx.outboxEvent.create({
      data: {
        id: generateId("evt"),
        name: assertKnownEventName("recon.break_owned"),
        aggregateType: "recon",
        aggregateId: entry.id,
        toVersion: 1,
        cityId: input.cityId,
        actorType: "agent",
        actorId: input.actor.id,
        idempotencyKey: `recon.break_owned:${entry.id}:${input.owner}`,
        payload: { breakId: entry.id, owner: input.owner },
        occurredAt: now,
      },
    });
    return {
      id: entry.id,
      amount: money(fromDbMinor(entry.amountMinor), entry.currency),
      description: entry.description,
      owner: input.owner,
      deadline: deadline?.toISOString() ?? null,
      resolutionRef: entry.resolutionRef,
      resolvedAt: entry.resolvedAt?.toISOString() ?? null,
    };
  });
}

export interface ResolveBreakInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly date: string;
  readonly breakId: string;
  /** The support case or bug this break answers to. Always required. */
  readonly caseRef: string;
  /**
   * When present, the break is settled by posting this adjustment. It is a new
   * journal entry carrying the case reference — the original entries are never
   * touched.
   */
  readonly adjustment?:
    | {
        readonly lines: readonly AdjustmentLine[];
      }
    | undefined;
  readonly note?: string | undefined;
}

export interface ResolveBreakResult {
  readonly breakId: string;
  readonly resolutionRef: string;
  readonly entryId: string | null;
}

export async function resolveBreak(
  deps: WalletDeps,
  input: ResolveBreakInput,
): Promise<ResolveBreakResult> {
  const now = deps.now();
  const context = await runContext(deps, input.cityId, input.date);

  return deps.db.$transaction(async (tx) => {
    await requireOpenRun(tx, input.date, context.currency);
    const entry = await tx.reconBreak.findUnique({ where: { id: input.breakId } });
    if (entry === null) {
      throw new ContractError("not_found", "no such reconciliation break");
    }
    if (entry.resolvedAt !== null) {
      throw new ContractError("conflict", "that break is already resolved", {
        breakId: entry.id,
      });
    }

    let entryId: string | null = null;
    let resolutionRef = `${RESOLUTION_PREFIXES.explanation}${input.caseRef}`;

    if (input.adjustment !== undefined) {
      const posted = await postEntry(tx, {
        kind: "recon_adjustment",
        reference: `recon:${input.date}:${entry.id}`,
        occurredAt: now,
        idempotencyKey: `recon.adjustment:${entry.id}`,
        caseRef: input.caseRef,
        description: input.note ?? "reconciliation adjustment",
        lines: input.adjustment.lines.map((line) => ({
          account: line.account,
          walletId: line.walletId ?? null,
          amount: money(line.amountMinor, context.currency),
          counterpartRef: `case:${input.caseRef}`,
        })),
      });
      entryId = posted.id;
      resolutionRef = `${RESOLUTION_PREFIXES.adjustment}${posted.id}`;
    }

    await tx.reconBreak.update({
      where: { id: entry.id },
      data: { resolutionRef, resolvedAt: now },
    });

    await writeAudit(tx, {
      actor: input.actor,
      action: "finance.recon.break_resolved",
      subjectType: "recon",
      subjectId: entry.id,
      before: { resolvedAt: null },
      after: { resolutionRef, entryId, caseRef: input.caseRef },
      reason: input.note ?? null,
    });

    return { breakId: entry.id, resolutionRef, entryId };
  });
}

export interface CloseReconInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly date: string;
}

/**
 * The day-close gate. It recomputes first — so a close can never be granted on
 * a stale view — and refuses while anything is unexplained.
 */
export async function closeRecon(
  deps: WalletDeps,
  input: CloseReconInput,
): Promise<ReconReport> {
  const now = deps.now();
  await runRecon(deps, { actor: input.actor, cityId: input.cityId, date: input.date });

  await deps.db.$transaction(async (tx) => {
    const run = await tx.reconRun.findUnique({ where: { date: asDate(input.date) } });
    if (run === null) {
      throw new ContractError("not_found", "there is no reconciliation for that date");
    }
    if (run.status === "closed") {
      throw new ContractError("conflict", "that day is already closed", {
        date: input.date,
      });
    }

    const unexplained = await unexplainedTotal(tx, input.date);
    if (unexplained !== 0) {
      throw new ContractError(
        "recon_unexplained",
        "the day cannot be closed while a break is neither adjusted nor explained",
        { date: input.date, unexplainedMinor: unexplained, currency: run.currency },
      );
    }

    await tx.reconRun.update({
      where: { date: asDate(input.date) },
      data: {
        status: "closed",
        unexplainedMinor: BigInt(0),
        closedBy: input.actor.id,
        closedAt: now,
      },
    });

    await writeAudit(tx, {
      actor: input.actor,
      action: "finance.recon.closed",
      subjectType: "recon",
      subjectId: input.date,
      before: { status: "open" },
      after: { status: "closed", unexplainedMinor: 0 },
    });

    await tx.outboxEvent.create({
      data: {
        id: generateId("evt"),
        name: assertKnownEventName("recon.closed"),
        aggregateType: "recon",
        aggregateId: input.date,
        toVersion: 1,
        cityId: input.cityId,
        actorType: "agent",
        actorId: input.actor.id,
        idempotencyKey: `recon.closed:${input.date}`,
        payload: { date: input.date, currency: run.currency },
        occurredAt: now,
      },
    });
  });

  return getRecon(deps, input.cityId, input.date);
}
