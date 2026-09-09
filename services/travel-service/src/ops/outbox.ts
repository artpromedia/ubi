/**
 * The transactional outbox, and the only door into a mutating travel flow.
 *
 * CLAUDE.md #2: every state transition is an event published through a
 * transactional outbox with actor, timestamp, idempotency key and prior/next
 * version. A convention cannot deliver that — the next call site forgets — so
 * the outbox rows are written by the wrapper that owns the transaction, from the
 * events the work itself returns, and the transaction client the work needs is
 * *branded* so it can only be obtained from that wrapper.
 *
 * The consequences are structural, not documentary:
 *  - a mutation cannot compile unless it runs inside `withOutbox`;
 *  - a mutation that throws rolls its outbox rows back with it, so a failed flow
 *    publishes nothing;
 *  - a mutation that commits always commits its outbox rows with it.
 */
import { assertKnownEventName, type EventName } from "@ubi/contracts";

import { generateId } from "../lib/ids";

import type { Actor, JsonRecord, TravelDb, TravelTx } from "./types";

declare const outboxBrand: unique symbol;

/**
 * A transaction that is already collecting outbox rows. Only `withOutbox` can
 * produce one, so every function that takes an `OutboxTx` is provably publishing
 * through the outbox.
 */
export type OutboxTx = TravelTx & { readonly [outboxBrand]: true };

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

/** What a unit of work hands back to the wrapper. */
export interface OutboxOutcome<T> {
  readonly result: T;
  readonly events?: readonly OutboxInput[];
}

export async function publishEvent(
  tx: TravelTx,
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
 * Runs one mutating flow. The work receives a branded transaction client, and
 * the outbox rows it describes are written in the same transaction before it
 * commits.
 */
export async function withOutbox<T>(
  db: TravelDb,
  work: (tx: OutboxTx) => Promise<OutboxOutcome<T>>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    const outcome = await work(tx as OutboxTx);
    for (const event of outcome.events ?? []) {
      await publishEvent(tx, event);
    }
    return outcome.result;
  });
}
