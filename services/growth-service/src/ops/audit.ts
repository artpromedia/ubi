/**
 * The audit trail, and the only door into a mutating growth transaction.
 *
 * Every campaign transition, reservation, referral decision and incentive
 * posting is typed and audited (who, what, why, before/after). A convention
 * cannot deliver that — the next call site forgets. So the audit row is not
 * something a handler remembers to write: it is written by the wrapper that
 * opens the transaction, from the description the work itself returns, and the
 * transaction client the work needs is *branded* so it can only be obtained
 * from that wrapper.
 *
 * The consequences are structural, not documentary:
 *  - a mutation cannot compile unless it runs inside `auditedTransaction`;
 *  - a mutation that throws rolls the audit row back with it;
 *  - a mutation that commits always commits exactly one audit row, and every
 *    outbox event it describes, with it (CLAUDE.md #2 — the transactional
 *    outbox).
 */
import { assertKnownEventName, type EventName } from "@ubi/contracts";

import { generateId } from "../lib/ids";

import type { Actor, GrowthDb, GrowthTx, JsonRecord } from "./types";

declare const auditedBrand: unique symbol;

/**
 * A transaction that is already carrying an audit row. Only
 * `auditedTransaction` can produce one, so every function that takes an
 * `AuditedTx` is provably audited.
 */
export type AuditedTx = GrowthTx & { readonly [auditedBrand]: true };

export interface AuditRecord {
  readonly actor: Actor;
  /** Typed action name, e.g. `growth.campaign.activated`. Never free text. */
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId: string;
  /** Why the actor did it. Required for anything that moves money. */
  readonly reason?: string | null;
  readonly before?: JsonRecord | null;
  readonly after?: JsonRecord | null;
  /** Ties this action to the request that caused it. */
  readonly correlationId?: string | null;
}

export interface OutboxInput {
  readonly name: EventName | string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly fromVersion: number | null;
  readonly toVersion: number;
  readonly actor: Actor;
  readonly actorType: string;
  readonly cityId: string | null;
  readonly idempotencyKey: string;
  readonly correlationId?: string | null;
  readonly occurredAt: Date;
  /** Ids, amounts and codes only — never PII (CLAUDE.md #12). */
  readonly payload: JsonRecord;
}

/** What an audited unit of work hands back to the wrapper. */
export interface AuditedOutcome<T> {
  readonly result: T;
  readonly audit: AuditRecord;
  readonly events?: readonly OutboxInput[];
}

function jsonOrNull(
  value: JsonRecord | null | undefined,
): JsonRecord | undefined {
  return value === undefined || value === null ? undefined : { ...value };
}

export async function writeAudit(
  tx: GrowthTx,
  record: AuditRecord,
): Promise<void> {
  const correlationId = record.correlationId ?? null;
  const after = jsonOrNull(record.after);
  await tx.auditLog.create({
    data: {
      id: generateId("aud"),
      actorId: record.actor.id,
      actorRole: record.actor.role,
      action: record.action,
      subjectType: record.subjectType,
      subjectId: record.subjectId,
      before: jsonOrNull(record.before),
      // The correlation id rides with the "after" picture so an action can be
      // traced to its request without adding a column to audit_log.
      after:
        correlationId === null ? after : { ...(after ?? {}), correlationId },
      reason: record.reason ?? null,
    },
  });
}

export async function publishEvent(
  tx: GrowthTx,
  input: OutboxInput,
): Promise<void> {
  const name = assertKnownEventName(input.name);
  await tx.outboxEvent.create({
    data: {
      id: generateId("evt"),
      name,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      cityId: input.cityId,
      actorType: input.actorType,
      actorId: input.actor.id,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId ?? null,
      payload: { ...input.payload },
      occurredAt: input.occurredAt,
    },
  });
}

/**
 * Runs one growth action. The work receives a branded transaction client, and
 * the audit row and outbox rows it describes are written in the same
 * transaction before it commits.
 */
export async function auditedTransaction<T>(
  db: GrowthDb,
  work: (tx: AuditedTx) => Promise<AuditedOutcome<T>>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    const outcome = await work(tx as AuditedTx);
    await writeAudit(tx, outcome.audit);
    for (const event of outcome.events ?? []) {
      await publishEvent(tx, event);
    }
    return outcome.result;
  });
}
