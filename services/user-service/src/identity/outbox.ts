/**
 * Transactional outbox (CLAUDE.md #2). The row is written in the same
 * transaction as the state change; a relay publishes it afterwards and
 * consumers are idempotent on `id`.
 *
 * The envelope is validated against `EventEnvelopeSchema` and the name against
 * the closed `EVENT_NAMES` set BEFORE the row is inserted, so nothing can be
 * persisted that a consumer would refuse to parse.
 *
 * `idempotency_key` is unique in the database. That is what makes a replayed
 * request — or a reminder sweep that runs twice — produce one event and not two.
 */
import type { Prisma } from "@prisma/client";
import {
  type ActorType,
  assertKnownEventName,
  type EventEnvelope,
  EventEnvelopeSchema,
  type SubjectType,
} from "@ubi/contracts";

import type { Tx } from "./audit";
import { deterministicId, newId } from "./ids";

/**
 * Builds an idempotency key that always fits the envelope's 64-character limit.
 *
 * Readable while it fits — `document.expiring:doc_abc:14` — and a stable digest
 * of the same parts once it would not, so the key stays deterministic either
 * way and a replay still collides with its own earlier write.
 */
export function eventIdempotencyKey(name: string, ...parts: readonly string[]): string {
  const readable = `${name}:${parts.join(":")}`;
  return readable.length <= 64 ? readable : `${name}:${deterministicId("k", ...parts)}`;
}

export interface OutboxInput {
  readonly name: string;
  readonly subjectType: SubjectType;
  readonly subjectId: string;
  readonly actorType: ActorType;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly fromVersion: number | null;
  readonly toVersion: number;
  readonly cityId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt?: Date;
}

export async function writeOutboxEvent(tx: Tx, input: OutboxInput): Promise<EventEnvelope> {
  const occurredAt = input.occurredAt ?? new Date();
  const envelope: EventEnvelope = EventEnvelopeSchema.parse({
    id: newId("evt"),
    name: assertKnownEventName(input.name),
    version: 1,
    occurredAt: occurredAt.toISOString(),
    actor: { type: input.actorType, id: input.actorId },
    subject: { type: input.subjectType, id: input.subjectId },
    idempotencyKey: input.idempotencyKey,
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    cityId: input.cityId,
    payload: input.payload,
  });

  await tx.outboxEvent.create({
    data: {
      id: envelope.id,
      name: envelope.name,
      schemaVersion: envelope.version,
      aggregateType: envelope.subject.type,
      aggregateId: envelope.subject.id,
      fromVersion: envelope.fromVersion,
      toVersion: envelope.toVersion,
      cityId: envelope.cityId,
      actorType: envelope.actor.type,
      actorId: envelope.actor.id,
      idempotencyKey: envelope.idempotencyKey,
      payload: envelope.payload as unknown as Prisma.InputJsonValue,
      occurredAt,
    },
  });

  return envelope;
}

/**
 * Writes the event unless one with this idempotency key already exists.
 * Returns `undefined` when the event was already emitted, which is how the
 * expiry sweep can run every hour and still send one reminder per threshold.
 */
export async function writeOutboxEventOnce(
  tx: Tx,
  input: OutboxInput,
): Promise<EventEnvelope | undefined> {
  const existing = await tx.outboxEvent.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true },
  });
  if (existing !== null) return undefined;
  return writeOutboxEvent(tx, input);
}

/**
 * The payload of a previous run of the same idempotent operation, if any. A
 * replay returns the original result rather than writing a second event.
 */
export async function findOutboxByIdempotencyKey(
  tx: Tx,
  idempotencyKey: string,
): Promise<Record<string, unknown> | undefined> {
  const row = await tx.outboxEvent.findUnique({ where: { idempotencyKey } });
  if (row === null) return undefined;
  return typeof row.payload === "object" && row.payload !== null && !Array.isArray(row.payload)
    ? (row.payload as Record<string, unknown>)
    : {};
}
