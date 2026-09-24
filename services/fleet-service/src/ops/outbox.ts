/**
 * The transactional outbox and audit trail — the only door into a mutating
 * fleet flow.
 *
 * CLAUDE.md #2: every state transition is an event published through a
 * transactional outbox with actor, timestamp, idempotency key and prior/next
 * version, plus an audit row. A convention cannot deliver that — the next
 * call site forgets — so both are written by the wrapper that owns the
 * transaction, from what the work itself returns, and the transaction client
 * the work needs is BRANDED so it can only be obtained from that wrapper:
 *  - a mutation cannot compile unless it runs inside `withOutbox`;
 *  - a mutation that throws rolls its outbox and audit rows back with it;
 *  - a mutation that commits always commits them.
 *
 * Every row is written so the shared relay (@ubi/outbox) can publish it: the
 * name is in the canonical catalog or FLEET_EVENT_NAMES, the subject and
 * actor are envelope types (FLEET_SUBJECT_TYPES / FLEET_ACTOR_TYPES), and
 * the idempotency key fits the envelope's 64 characters (a longer natural
 * key is replaced by its SHA-256, deterministically, so dedupe still holds).
 * Payloads carry ids, codes, times and money — never PII.
 */
import { createHash } from "node:crypto";

import { isKnownEventName, type EventName } from "@ubi/contracts";

import {
  FLEET_EVENT_NAMES,
  type FleetActorType,
  type FleetEventName,
  type FleetSubjectType,
} from "../contract";
import { generateId } from "../lib/ids";

import type { Actor, FleetDb, FleetTx, JsonRecord, JsonValue } from "./types";

declare const outboxBrand: unique symbol;

export type OutboxTx = FleetTx & { readonly [outboxBrand]: true };

const FLEET_EVENT_SET: ReadonlySet<string> = new Set(FLEET_EVENT_NAMES);

/** The envelope's limit on an event idempotency key. */
const MAX_EVENT_KEY_LENGTH = 64;

export interface OutboxInput {
  /**
   * A fleet event, or a canonical one fleet-service produces (the slice-10
   * `fleet.alert` a driver's vehicle-problem report raises). Checked again at
   * runtime by `assertFleetEventName`.
   */
  readonly name: FleetEventName | EventName;
  readonly aggregateType: FleetSubjectType;
  readonly aggregateId: string;
  readonly fromVersion: number | null;
  readonly toVersion: number;
  readonly actor: Actor;
  /** Who acted, as the envelope records it; `system` for sweeps. Default `fleet`. */
  readonly actorType?: FleetActorType;
  readonly cityId: string | null;
  /** Defaults to name + subject + toVersion (unique per transition). */
  readonly idempotencyKey?: string;
  readonly correlationId?: string | null;
  readonly occurredAt: Date;
  readonly payload: JsonRecord;
}

export interface AuditInput {
  readonly actor: Actor;
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly before?: JsonValue;
  readonly after?: JsonValue;
  readonly reason?: string | null;
}

export interface OutboxOutcome<T> {
  readonly result: T;
  readonly events?: readonly OutboxInput[];
  readonly audits?: readonly AuditInput[];
}

/** A natural key made envelope-safe: itself, or its SHA-256 when too long. */
export function outboxKey(key: string): string {
  return key.length <= MAX_EVENT_KEY_LENGTH
    ? key
    : createHash("sha256").update(key).digest("hex");
}

export function assertFleetEventName(name: string): string {
  if (!FLEET_EVENT_SET.has(name) && !isKnownEventName(name)) {
    throw new Error(
      `unknown event name "${name}" — add it to FLEET_EVENT_NAMES (packages/contracts/src/fleet.ts) before publishing`,
    );
  }
  return name;
}

function actorTypeOf(input: OutboxInput): FleetActorType {
  if (input.actor.role === "system") {
    return "system";
  }
  return input.actorType ?? input.actor.as ?? "fleet";
}

async function publishEvent(tx: FleetTx, input: OutboxInput): Promise<void> {
  const name = assertFleetEventName(input.name);
  await tx.outboxEvent.create({
    data: {
      id: generateId("evt"),
      name,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      cityId: input.cityId,
      actorType: actorTypeOf(input),
      actorId: input.actor.id,
      idempotencyKey: outboxKey(
        input.idempotencyKey ??
          `${name}:${input.aggregateId}:v${input.toVersion}`,
      ),
      correlationId: input.correlationId ?? null,
      payload: { ...input.payload },
      occurredAt: input.occurredAt,
    },
  });
}

async function writeAudit(tx: FleetTx, input: AuditInput): Promise<void> {
  await tx.auditLog.create({
    data: {
      id: generateId("aud"),
      actorId: input.actor.id,
      actorRole: input.actor.role,
      action: input.action,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      ...(input.before === undefined ? {} : { before: input.before as never }),
      ...(input.after === undefined ? {} : { after: input.after as never }),
      reason: input.reason ?? null,
    },
  });
}

/**
 * An audit row written by a helper that changes a CHILD row inside a flow's
 * transaction (a conflict opened or settled): the branded transaction can
 * only come from `withOutbox`, so the row commits or rolls back with the
 * flow — the same guarantee as the audits a flow returns.
 */
export async function auditInTx(
  tx: OutboxTx,
  input: AuditInput,
): Promise<void> {
  await writeAudit(tx, input);
}

/**
 * Runs one mutating flow in one transaction: the work, then its audit rows,
 * then its outbox rows.
 */
export async function withOutbox<T>(
  db: FleetDb,
  work: (tx: OutboxTx) => Promise<OutboxOutcome<T>>,
): Promise<T> {
  const result = await db.$transaction(async (tx) => {
    const outcome = await work(tx as OutboxTx);
    for (const audit of outcome.audits ?? []) {
      await writeAudit(tx, audit);
    }
    for (const event of outcome.events ?? []) {
      await publishEvent(tx, event);
    }
    return outcome.result;
  });
  return result;
}
