/**
 * Audit records and the transactional outbox.
 *
 * Every state transition is written as an audit row and an outbox event inside
 * the same transaction as the state change (CLAUDE.md #2), so a transition can
 * never be persisted without its trail, and the trail can never claim a
 * transition that rolled back.
 */
import { assertKnownEventName, type EventName } from "@ubi/contracts";

import { generateId } from "../lib/utils";

import type { Actor, JsonRecord, LedgerTx } from "./types";

export interface AuditInput {
  readonly actor: Actor;
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly before?: JsonRecord | null;
  readonly after?: JsonRecord | null;
  readonly reason?: string | null;
}

export async function writeAudit(
  tx: LedgerTx,
  input: AuditInput,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      id: generateId("aud"),
      actorId: input.actor.id,
      actorRole: input.actor.role,
      action: input.action,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      before:
        input.before === undefined || input.before === null
          ? undefined
          : { ...input.before },
      after:
        input.after === undefined || input.after === null
          ? undefined
          : { ...input.after },
      reason: input.reason ?? null,
    },
  });
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
  /** Never put PII here (CLAUDE.md #12) — ids and amounts only. */
  readonly payload: JsonRecord;
}

export async function publishEvent(
  tx: LedgerTx,
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
