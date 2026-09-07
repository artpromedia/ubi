/**
 * Transactional outbox (CLAUDE.md #2). The row is written in the same
 * transaction as the state change; a relay publishes it afterwards and
 * consumers are idempotent on `id`.
 *
 * The envelope is validated against `EventEnvelopeSchema` and the name against
 * the closed `EVENT_NAMES` set *before* the row is inserted, so nothing can be
 * persisted that a consumer would refuse to parse.
 */
import type { Prisma } from "@prisma/client";
import {
  type ActorType,
  type EventEnvelope,
  EventEnvelopeSchema,
  type SubjectType,
  assertKnownEventName,
} from "@ubi/contracts";

import { asJsonObject } from "../lib/json";
import { newId } from "../lib/ids";
import type { Tx } from "./audit";

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

export async function writeOutboxEvent(
  tx: Tx,
  input: OutboxInput,
): Promise<EventEnvelope> {
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
 * The result of a previous run of the same idempotent operation, if any. A
 * replay returns the original payload rather than writing a second event.
 */
export async function findOutboxByIdempotencyKey(
  tx: Tx,
  idempotencyKey: string,
): Promise<Record<string, unknown> | undefined> {
  const row = await tx.outboxEvent.findUnique({ where: { idempotencyKey } });
  if (row === null) return undefined;
  return asJsonObject(row.payload);
}
