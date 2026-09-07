/**
 * Support cases (board 12b) and the typed remedies that close them.
 *
 * Three rules shape this module:
 *
 *  1. A remedy never edits a fare and never touches a historical journal entry.
 *     It asks the ledger to post a NEW entry of counter-lines carrying the case
 *     reference, so the original entry stays exactly as it was and the make-good
 *     is a separate, reconcilable fact (slice 11 guard, CLAUDE.md #4).
 *  2. Only the five typed remedies exist. Anything else is refused at the edge
 *     with 422 — an agent cannot invent a settlement shape.
 *  3. Nothing here writes without an audit row: every mutation runs inside
 *     `auditedTransaction`, which is the only source of the transaction handle
 *     these functions accept.
 */
import {
  assertTransition,
  ContractError,
  initialState,
  isTerminal,
  money,
  scopedIdempotencyKey,
  type Money,
} from "@ubi/contracts";


import { auditedTransaction, type AuditedTx, type OutboxInput } from "./audit";
import {
  remedyCapMinor,
  slaMinutesForCategory,
  type RemedyType,
  type SupportCategory,
  type SupportCityConfig,
} from "./city-config";
import { isUniqueViolation } from "./errors";
import { actorTypeFor, assertPermission, can, contactForRole } from "./roles";
import { unifiedTimeline, type TimelineItem } from "./timeline";
import { deterministicId, generateId } from "../lib/ids";

import type { SupportDeps } from "./context";
import type { Actor, JsonRecord, SupportTx } from "./types";

const MACHINE = "supportCase" as const;

/** Remedies that must name an amount; a make-good with no number is not one. */
const MONETARY_REMEDIES: readonly RemedyType[] = [
  "fee_reversal",
  "refund",
  "credit",
  "cash_dispute_resolution",
];

export function isMonetaryRemedy(type: RemedyType): boolean {
  return MONETARY_REMEDIES.includes(type);
}

export interface CaseSubject {
  readonly type: string;
  readonly id: string;
}

export interface RemedyView {
  readonly id: string;
  readonly type: RemedyType;
  readonly amount: Money | null;
  readonly reason: string | null;
  /** The journal entry holding the counter-lines. Null for a non-monetary remedy. */
  readonly entryId: string | null;
  readonly postedBy: string;
  readonly postedAt: string;
}

export interface CaseView {
  readonly id: string;
  readonly status: string;
  readonly category: string | null;
  readonly subject: CaseSubject | null;
  readonly userType: string | null;
  readonly userId: string | null;
  readonly assignee: string | null;
  readonly slaDueAt: string | null;
  readonly slaBreached: boolean;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  /**
   * What the customer sees on the item the case touched (board 13a): every
   * remedy posted against this case, with the ledger entry that carries it.
   */
  readonly outcome: {
    readonly status: string;
    readonly remedies: readonly RemedyView[];
  };
}

export interface CaseDetail extends CaseView {
  readonly timeline: readonly TimelineItem[];
  readonly customer: {
    readonly userId: string | null;
    readonly phone: string | null;
    readonly email: string | null;
    readonly contactMasked: boolean;
  } | null;
}

interface CaseRow {
  id: string;
  userType: string | null;
  userId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  category: string | null;
  status: string;
  slaDue: Date | null;
  assignee: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

interface RemedyRow {
  id: string;
  type: string;
  amountMinor: bigint | null;
  currency: string | null;
  reason: string | null;
  entryId: string | null;
  byUser: string;
  createdAt: Date;
}

function remedyView(row: RemedyRow): RemedyView {
  return {
    id: row.id,
    type: row.type as RemedyType,
    amount:
      row.amountMinor === null || row.currency === null
        ? null
        : money(Number(row.amountMinor), row.currency),
    reason: row.reason,
    entryId: row.entryId,
    postedBy: row.byUser,
    postedAt: row.createdAt.toISOString(),
  };
}

function caseView(row: CaseRow, remedies: readonly RemedyRow[], now: Date): CaseView {
  return {
    id: row.id,
    status: row.status,
    category: row.category,
    subject:
      row.subjectType === null || row.subjectId === null
        ? null
        : { type: row.subjectType, id: row.subjectId },
    userType: row.userType,
    userId: row.userId,
    assignee: row.assignee,
    slaDueAt: row.slaDue === null ? null : row.slaDue.toISOString(),
    slaBreached:
      row.slaDue !== null && row.resolvedAt === null && row.slaDue.getTime() < now.getTime(),
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt === null ? null : row.resolvedAt.toISOString(),
    outcome: {
      status: row.status,
      remedies: remedies.map(remedyView),
    },
  };
}

/** Aggregate version = how many events the case has recorded. Monotonic by construction. */
async function caseVersion(tx: SupportTx, caseId: string): Promise<number> {
  const count = await tx.caseEvent.count({ where: { caseId } });
  return count;
}

async function appendCaseEvent(
  tx: AuditedTx,
  caseId: string,
  kind: string,
  actor: string | null,
  payload: JsonRecord,
): Promise<void> {
  await tx.caseEvent.create({
    data: { id: generateId("cev"), caseId, kind, actor, payload: { ...payload } },
  });
}

async function loadCase(tx: SupportTx, caseId: string): Promise<CaseRow> {
  const row = await tx.supportCase.findUnique({ where: { id: caseId } });
  if (row === null) {
    throw new ContractError("not_found", "no such case", { caseId });
  }
  return row;
}

/**
 * A case belongs to its customer and to ops. Anyone without `case.read.any` may
 * only see their own — the handler never trusts a user id from the body.
 */
function assertMayRead(actor: Actor, row: CaseRow): void {
  if (can(actor.role, "case.read.any")) {
    return;
  }
  if (row.userId !== null && row.userId === actor.id) {
    return;
  }
  // Not "forbidden": a case you may not read must not be discoverable either.
  throw new ContractError("not_found", "no such case", { caseId: row.id });
}

// ---------------------------------------------------------------------------
// Opening a case
// ---------------------------------------------------------------------------

export interface OpenCaseInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly category: SupportCategory;
  readonly description: string;
  readonly subject: CaseSubject | null;
  /** Ops opening a case for a customer. Requires `case.open.on_behalf`. */
  readonly onBehalfOf: { readonly userType: string; readonly userId: string } | null;
  readonly idempotencyKey: string;
  readonly correlationId: string | null;
}

export async function openCase(
  deps: SupportDeps,
  input: OpenCaseInput,
): Promise<CaseView> {
  assertPermission(input.actor.role, "case.open");
  if (input.onBehalfOf !== null) {
    // Opening a case in someone else's name is a separate permission, checked
    // before anything else is looked up.
    assertPermission(input.actor.role, "case.open.on_behalf");
  }
  const owner =
    input.onBehalfOf === null
      ? { userType: actorTypeFor(input.actor.role), userId: input.actor.id }
      : input.onBehalfOf;

  const config = await deps.config.loadForSupport(input.cityId);
  const slaMinutes = slaMinutesForCategory(config.policy, input.category);

  const scoped = scopedIdempotencyKey(
    "support.case.open",
    input.actor.id,
    input.idempotencyKey,
  );
  const caseId = deterministicId("case", scoped);

  const replay = await deps.db.supportCase.findUnique({ where: { id: caseId } });
  if (replay !== null) {
    return withRemedies(deps, replay);
  }

  const now = deps.now();
  const slaDue = new Date(now.getTime() + slaMinutes * 60_000);
  const status = initialState(MACHINE);

  try {
    return await auditedTransaction(deps.db, async (tx) => {
      const created = await tx.supportCase.create({
        data: {
          id: caseId,
          userType: owner.userType,
          userId: owner.userId,
          subjectType: input.subject?.type ?? null,
          subjectId: input.subject?.id ?? null,
          category: input.category,
          status,
          slaDue,
          assignee: null,
        },
      });

      await appendCaseEvent(tx, caseId, "case.opened", input.actor.id, {
        category: input.category,
        subjectType: input.subject?.type ?? null,
        subjectId: input.subject?.id ?? null,
        // The customer's own words stay on the case record, where the customer
        // and the agent working it can see them; they never reach a log or an
        // event payload.
        description: input.description,
        slaDueAt: slaDue.toISOString(),
      });

      const version = await caseVersion(tx, caseId);
      const event: OutboxInput = {
        name: "case.opened",
        aggregateType: "case",
        aggregateId: caseId,
        fromVersion: null,
        toVersion: version,
        actor: input.actor,
        actorType: actorTypeFor(input.actor.role),
        cityId: input.cityId,
        idempotencyKey: `case.opened:${caseId}`,
        correlationId: input.correlationId,
        occurredAt: now,
        payload: {
          caseId,
          category: input.category,
          subjectType: input.subject?.type ?? null,
          subjectId: input.subject?.id ?? null,
          slaDueAt: slaDue.toISOString(),
        },
      };

      return {
        result: caseView(created, [], now),
        audit: {
          actor: input.actor,
          action: "support.case.opened",
          subjectType: "support_case",
          subjectId: caseId,
          reason: `case opened in category ${input.category}`,
          before: null,
          after: {
            status,
            category: input.category,
            slaDueAt: slaDue.toISOString(),
            onBehalfOf: input.onBehalfOf !== null,
          },
          correlationId: input.correlationId,
        },
        events: [event],
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Concurrent replay: the winner already wrote it, return what it wrote.
      const existing = await deps.db.supportCase.findUnique({ where: { id: caseId } });
      if (existing !== null) {
        return withRemedies(deps, existing);
      }
    }
    throw error;
  }
}

async function withRemedies(deps: SupportDeps, row: CaseRow): Promise<CaseView> {
  const remedies = await deps.db.remedy.findMany({
    where: { caseId: row.id },
    orderBy: { createdAt: "asc" },
  });
  return caseView(row, remedies, deps.now());
}

// ---------------------------------------------------------------------------
// Reading a case
// ---------------------------------------------------------------------------

/** How far back the wallet half of the timeline reaches, in days. */
const WALLET_WINDOW_DAYS = 30;
const TIMELINE_LIMIT_PER_SOURCE = 100;

export async function getCase(
  deps: SupportDeps,
  actor: Actor,
  caseId: string,
): Promise<CaseDetail> {
  const row = await loadCase(deps.db, caseId);
  assertMayRead(actor, row);

  const now = deps.now();
  const remedies = await deps.db.remedy.findMany({
    where: { caseId },
    orderBy: { createdAt: "asc" },
  });

  const timeline = await unifiedTimeline(deps.db, actor.role, {
    caseId,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    userId: row.userId,
    walletWindowStart: new Date(
      row.createdAt.getTime() - WALLET_WINDOW_DAYS * 24 * 60 * 60_000,
    ),
    limitPerSource: TIMELINE_LIMIT_PER_SOURCE,
  });

  const customer = await customerBlock(deps, actor, row);
  return { ...caseView(row, remedies, now), timeline, customer };
}

async function customerBlock(
  deps: SupportDeps,
  actor: Actor,
  row: CaseRow,
): Promise<CaseDetail["customer"]> {
  if (row.userId === null) {
    return null;
  }
  const user = await deps.db.user.findUnique({
    where: { id: row.userId },
    select: { phone: true, email: true },
  });
  const contact = contactForRole(actor.role, {
    phone: user?.phone ?? null,
    email: user?.email ?? null,
  });
  return {
    userId: row.userId,
    phone: contact.phone,
    email: contact.email,
    contactMasked: contact.masked,
  };
}

export interface CaseListFilter {
  readonly status?: string | undefined;
  readonly subject?: CaseSubject | undefined;
  readonly overdueOnly?: boolean | undefined;
  readonly limit: number;
}

export async function listCases(
  deps: SupportDeps,
  actor: Actor,
  filter: CaseListFilter,
): Promise<readonly CaseView[]> {
  const now = deps.now();
  const rows = await deps.db.supportCase.findMany({
    where: {
      // Anyone without `case.read.any` sees only their own cases, whatever the
      // query string asks for.
      ...(can(actor.role, "case.read.any") ? {} : { userId: actor.id }),
      ...(filter.status === undefined ? {} : { status: filter.status }),
      ...(filter.subject === undefined
        ? {}
        : { subjectType: filter.subject.type, subjectId: filter.subject.id }),
      ...(filter.overdueOnly === true
        ? { resolvedAt: null, slaDue: { lt: now } }
        : {}),
    },
    orderBy: [{ slaDue: "asc" }, { createdAt: "desc" }],
    take: filter.limit,
  });
  if (rows.length === 0) {
    return [];
  }
  const remedies = await deps.db.remedy.findMany({
    where: { caseId: { in: rows.map((row) => row.id) } },
    orderBy: { createdAt: "asc" },
  });
  const byCase = new Map<string, RemedyRow[]>();
  for (const remedy of remedies) {
    const bucket = byCase.get(remedy.caseId);
    if (bucket === undefined) {
      byCase.set(remedy.caseId, [remedy]);
    } else {
      bucket.push(remedy);
    }
  }
  return rows.map((row) => caseView(row, byCase.get(row.id) ?? [], now));
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface AddMessageInput {
  readonly actor: Actor;
  readonly caseId: string;
  readonly body: string;
  readonly correlationId: string | null;
}

export async function addMessage(
  deps: SupportDeps,
  input: AddMessageInput,
): Promise<CaseView> {
  assertPermission(input.actor.role, "case.message");
  const row = await loadCase(deps.db, input.caseId);
  assertMayRead(input.actor, row);
  if (isTerminal(MACHINE, row.status)) {
    throw new ContractError("conflict", "this case is closed", {
      caseId: row.id,
      status: row.status,
    });
  }

  return auditedTransaction(deps.db, async (tx) => {
    await appendCaseEvent(tx, input.caseId, "case.message", input.actor.id, {
      body: input.body,
      authorRole: input.actor.role,
    });
    const remedies = await tx.remedy.findMany({
      where: { caseId: input.caseId },
      orderBy: { createdAt: "asc" },
    });
    return {
      result: caseView(row, remedies, deps.now()),
      audit: {
        actor: input.actor,
        action: "support.case.message_added",
        subjectType: "support_case",
        subjectId: input.caseId,
        reason: "message added to case timeline",
        before: null,
        // The message body is on the case, not in the audit trail: audit says
        // who did what, it is not a second copy of the customer's words.
        after: { messageLength: input.body.length, authorRole: input.actor.role },
        correlationId: input.correlationId,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

export interface TransitionInput {
  readonly actor: Actor;
  readonly caseId: string;
  readonly to: string;
  readonly reason: string;
  readonly cityId: string;
  readonly correlationId: string | null;
}

export async function transitionCase(
  deps: SupportDeps,
  input: TransitionInput,
): Promise<CaseView> {
  assertPermission(input.actor.role, "case.transition");
  const row = await loadCase(deps.db, input.caseId);
  // Throws IllegalTransitionError, mapped to `illegal_transition` at the edge.
  assertTransition(MACHINE, row.status, input.to);

  const now = deps.now();
  const resolvedAt = input.to === "resolved" ? now : row.resolvedAt;

  return auditedTransaction(deps.db, async (tx) => {
    const updated = await tx.supportCase.update({
      where: { id: input.caseId },
      data: { status: input.to, resolvedAt },
    });
    await appendCaseEvent(
      tx,
      input.caseId,
      input.to === "resolved" ? "case.resolved" : "case.status_changed",
      input.actor.id,
      { from: row.status, to: input.to, reason: input.reason },
    );
    const version = await caseVersion(tx, input.caseId);

    const events: OutboxInput[] =
      input.to === "resolved"
        ? [
            {
              name: "case.resolved",
              aggregateType: "case",
              aggregateId: input.caseId,
              fromVersion: version - 1,
              toVersion: version,
              actor: input.actor,
              actorType: actorTypeFor(input.actor.role),
              cityId: input.cityId,
              idempotencyKey: `case.resolved:${input.caseId}:${version}`,
              correlationId: input.correlationId,
              occurredAt: now,
              payload: {
                caseId: input.caseId,
                subjectType: row.subjectType,
                subjectId: row.subjectId,
                from: row.status,
                to: input.to,
              },
            },
          ]
        : [];

    const remedies = await tx.remedy.findMany({
      where: { caseId: input.caseId },
      orderBy: { createdAt: "asc" },
    });

    return {
      result: caseView(updated, remedies, now),
      audit: {
        actor: input.actor,
        action: `support.case.${input.to}`,
        subjectType: "support_case",
        subjectId: input.caseId,
        reason: input.reason,
        before: { status: row.status },
        after: { status: input.to },
        correlationId: input.correlationId,
      },
      events,
    };
  });
}

// ---------------------------------------------------------------------------
// Remedies
// ---------------------------------------------------------------------------

/**
 * The contract path from the case's current status to `remedied`. Every hop is
 * checked against the canonical machine, so a case can never arrive at
 * `remedied` by a route the contract does not contain.
 */
function remedyStatusPath(from: string): readonly string[] {
  if (from === "remedied") {
    return [];
  }
  if (from === "open") {
    assertTransition(MACHINE, "open", "investigating");
    assertTransition(MACHINE, "investigating", "remedied");
    return ["investigating", "remedied"];
  }
  assertTransition(MACHINE, from, "remedied");
  return ["remedied"];
}

export interface PostRemedyInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly caseId: string;
  readonly type: RemedyType;
  readonly amountMinor: number | null;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly correlationId: string | null;
}

export interface RemedyResult {
  readonly remedy: RemedyView;
  readonly case: CaseView;
  readonly replayed: boolean;
}

function assertAmountShape(
  type: RemedyType,
  amountMinor: number | null,
): number | null {
  if (isMonetaryRemedy(type)) {
    if (amountMinor === null || amountMinor <= 0) {
      throw new ContractError(
        "validation_failed",
        `a ${type} remedy must name a positive amount`,
        { type },
      );
    }
    return amountMinor;
  }
  // A re-delivery may cost UBI money, or may cost nothing at all.
  if (amountMinor !== null && amountMinor < 0) {
    throw new ContractError("validation_failed", "an amount cannot be negative", {
      type,
    });
  }
  return amountMinor === null || amountMinor === 0 ? null : amountMinor;
}

function assertWithinPolicy(
  config: SupportCityConfig,
  actor: Actor,
  type: RemedyType,
  amount: Money,
): void {
  const cap = remedyCapMinor(config.policy, type);
  if (amount.amountMinor > cap) {
    throw new ContractError(
      "limit_exceeded",
      "that remedy is larger than this city allows for its type",
      { type, capMinor: cap, currency: amount.currency },
    );
  }
  if (
    amount.amountMinor > config.policy.remedyHighValueAboveMinor &&
    !can(actor.role, "remedy.post.high_value")
  ) {
    throw new ContractError(
      "remedy_not_permitted",
      "a remedy this large has to be posted by a support lead",
      {
        thresholdMinor: config.policy.remedyHighValueAboveMinor,
        currency: amount.currency,
      },
    );
  }
}

export async function postRemedy(
  deps: SupportDeps,
  input: PostRemedyInput,
): Promise<RemedyResult> {
  assertPermission(input.actor.role, "remedy.post");

  const config = await deps.config.loadForSupport(input.cityId);
  const currency = config.city.currency;
  const row = await loadCase(deps.db, input.caseId);

  const amountMinor = assertAmountShape(input.type, input.amountMinor);
  const amount = amountMinor === null ? null : money(amountMinor, currency);
  if (amount !== null) {
    assertWithinPolicy(config, input.actor, input.type, amount);
  }

  const scoped = scopedIdempotencyKey(
    `support.remedy:${input.caseId}`,
    input.actor.id,
    input.idempotencyKey,
  );
  const remedyId = deterministicId("rem", scoped);

  const existing = await deps.db.remedy.findUnique({ where: { id: remedyId } });
  if (existing !== null) {
    // A replay must return the original result, and a key reused for a
    // different remedy must not silently overwrite the first one.
    if (
      existing.caseId !== input.caseId ||
      existing.type !== input.type ||
      Number(existing.amountMinor ?? 0) !== (amountMinor ?? 0)
    ) {
      throw new ContractError(
        "idempotency_key_reuse",
        "that idempotency key was already used for a different remedy",
        { remedyId },
      );
    }
    return {
      remedy: remedyView(existing),
      case: await withRemedies(deps, row),
      replayed: true,
    };
  }

  if (row.userId === null || row.userType === null) {
    throw new ContractError(
      "validation_failed",
      "this case names no customer, so there is nobody to make whole",
      { caseId: row.id },
    );
  }

  const path = remedyStatusPath(row.status);
  const now = deps.now();

  // The ledger posts first because it owns the money and is itself idempotent on
  // this key: if the transaction below fails, a retry lands on the same entry
  // instead of posting a second one. The entry carries the case reference, so an
  // entry that never got its remedy row is visible to reconciliation rather than
  // lost.
  const posted =
    amount === null
      ? null
      : await deps.ledger.postRemedy({
          caseId: input.caseId,
          remedyId,
          type: input.type,
          amount,
          cityId: input.cityId,
          beneficiary: { userType: row.userType, userId: row.userId },
          subject:
            row.subjectType === null || row.subjectId === null
              ? null
              : { type: row.subjectType, id: row.subjectId },
          reason: input.reason,
          idempotencyKey: scoped,
          actor: input.actor,
        });

  const finalStatus = path.length === 0 ? row.status : path[path.length - 1];
  if (finalStatus === undefined) {
    throw new ContractError("internal_error", "could not determine the case status");
  }

  return auditedTransaction(deps.db, async (tx) => {
    const remedy = await tx.remedy.create({
      data: {
        id: remedyId,
        caseId: input.caseId,
        type: input.type,
        amountMinor: amount === null ? null : amount.amountMinor,
        currency: amount === null ? null : amount.currency,
        reason: input.reason,
        entryId: posted?.entryId ?? null,
        byUser: input.actor.id,
      },
    });

    let previous = row.status;
    for (const next of path) {
      await appendCaseEvent(tx, input.caseId, "case.status_changed", input.actor.id, {
        from: previous,
        to: next,
        reason: `remedy ${input.type} posted`,
      });
      previous = next;
    }
    if (path.length > 0) {
      await tx.supportCase.update({
        where: { id: input.caseId },
        data: { status: finalStatus },
      });
    }

    await appendCaseEvent(tx, input.caseId, "case.remedy_posted", input.actor.id, {
      remedyId,
      type: input.type,
      amountMinor: amount?.amountMinor ?? null,
      currency: amount?.currency ?? null,
      entryId: posted?.entryId ?? null,
      reason: input.reason,
    });

    const version = await caseVersion(tx, input.caseId);
    const event: OutboxInput = {
      name: "remedy.posted",
      aggregateType: "case",
      aggregateId: input.caseId,
      fromVersion: version - 1,
      toVersion: version,
      actor: input.actor,
      actorType: actorTypeFor(input.actor.role),
      cityId: input.cityId,
      idempotencyKey: `remedy.posted:${remedyId}`,
      correlationId: input.correlationId,
      occurredAt: now,
      payload: {
        caseId: input.caseId,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        remedy: {
          type: input.type,
          amountMinor: amount?.amountMinor ?? null,
          currency: amount?.currency ?? null,
        },
        entryId: posted?.entryId ?? null,
      },
    };

    const remedies = await tx.remedy.findMany({
      where: { caseId: input.caseId },
      orderBy: { createdAt: "asc" },
    });

    return {
      result: {
        remedy: remedyView(remedy),
        case: caseView({ ...row, status: finalStatus }, remedies, now),
        replayed: false,
      },
      audit: {
        actor: input.actor,
        action: "support.remedy.posted",
        subjectType: "support_case",
        subjectId: input.caseId,
        reason: input.reason,
        before: { status: row.status, remedyCount: remedies.length - 1 },
        after: {
          status: finalStatus,
          remedyId,
          type: input.type,
          amountMinor: amount?.amountMinor ?? null,
          currency: amount?.currency ?? null,
          entryId: posted?.entryId ?? null,
        },
        correlationId: input.correlationId,
      },
      events: [event],
    };
  });
}
