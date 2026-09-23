/**
 * The organization outbox writer (CLAUDE.md #2).
 *
 * Identical to identity/outbox.ts — the row is written in the caller's
 * transaction and the envelope is validated against `EventEnvelopeSchema`
 * before insert, so the relay can always publish it — except for the name
 * check: this writer enforces the closed `ORG_EVENT_NAMES` list (registered
 * in the contract's `EVENT_NAMES` as `BUSINESS_TRAVEL_EVENT_NAMES`), so no
 * call site can invent a name or publish another module's event.
 *
 * Subject: the user the change is about (the invitee or member, or the acting
 * admin for an organization-level change) — the same `user` subject the
 * mandate events use, so the realtime gateway can route it. Payloads carry
 * ids and amounts only (CLAUDE.md #12).
 */
import {
  type ActorType,
  type EventEnvelope,
  EventEnvelopeSchema,
} from "@ubi/contracts";

import { ORG_EVENT_NAMES, type OrgEventName } from "./model";
import { newId } from "../identity/ids";

import type { Tx } from "../identity/audit";
import type { Prisma } from "@prisma/client";

export interface OrgEventInput {
  readonly name: OrgEventName;
  readonly subjectUserId: string;
  readonly actorType: ActorType;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly fromVersion: number | null;
  readonly toVersion: number;
  readonly cityId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

export async function writeOrgEvent(
  tx: Tx,
  input: OrgEventInput,
): Promise<EventEnvelope> {
  if (!(ORG_EVENT_NAMES as readonly string[]).includes(input.name)) {
    throw new Error(
      `unknown organization event "${input.name}" — add it to ORG_EVENT_NAMES and the business-travel contract first`,
    );
  }
  const envelope: EventEnvelope = EventEnvelopeSchema.parse({
    id: newId("evt"),
    name: input.name,
    version: 1,
    occurredAt: input.occurredAt.toISOString(),
    actor: { type: input.actorType, id: input.actorId },
    subject: { type: "user", id: input.subjectUserId },
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
      occurredAt: input.occurredAt,
    },
  });
  return envelope;
}
