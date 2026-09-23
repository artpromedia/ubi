/**
 * Travel-ops console writes (`/v1/ops/travel/*`): whose word the city rests
 * on, and exactly-once under an Idempotency-Key.
 *
 * THE CITY. A console action runs in the city the request resolved to
 * (middleware `cityProvenanceOf`): the gateway-verified one, or — for a
 * signed ops operator bound to no city — the SUPPORTED city that operator
 * declared. Every outbox row and audit row a console write produces records
 * where that city came from (`cityProvenance`) and, for an operator-declared
 * city, the operator it rests on (`cityDeclaredBy`), so a declared city is
 * never presented as gateway-verified.
 *
 * IDEMPOTENCY (CLAUDE.md #3). Every console state POST — an exception action,
 * a settlement, a commercial rate — takes an Idempotency-Key. The key is
 * scoped to the operator and the operation; its record is the action's ONE
 * audit_log row, whose primary key is derived from that scoped key and which
 * is written in the SAME transaction as the state change. So:
 *
 *   - a replay (same operator, operation and key) finds the record and
 *     answers the stored status and body — nothing runs again (a second
 *     `chase_refund` never advances the refund a second stage, a second
 *     settlement never records a second difference);
 *   - a replay with a different request under the same key is refused
 *     (`idempotency_key_reuse`), never answered with the stored body;
 *   - two identical requests racing: the loser's transaction fails on the
 *     record's primary key and rolls back with its state change, and it
 *     answers the winner's record.
 *
 * The one action whose work is not a single transaction here — the
 * reconciliation lookup, which asks the supplier — is safe to repeat by
 * construction (it converges, it can never re-purchase; ./reconcile.ts); its
 * record is written after it, and a racing duplicate answers that record.
 */
import { createHash } from "node:crypto";

import { ContractError, scopedIdempotencyKey } from "@ubi/contracts";

import { cleanJson } from "./json";
import { deterministicId } from "../lib/ids";

import type { TravelDeps } from "./context";
import type { Actor, JsonRecord, TravelDb, TravelTx } from "./types";

/** Where a console request's city came from (middleware/operator-city.ts). */
export type ConsoleCityProvenance =
  | "verified"
  | "operator_declared"
  | "declared_unverified";

/** The city a console action runs in, with its provenance. */
export interface ConsoleCity {
  readonly cityId: string;
  readonly provenance: ConsoleCityProvenance;
  /** The operator whose declaration it rests on; null unless declared. */
  readonly declaredBy: string | null;
}

/**
 * The fields every console outbox payload and audit row carries about the
 * city's provenance (the city itself is the row's own `cityId`). Ids and
 * codes only (CLAUDE.md #12). Nulls when the action names no city (a
 * supplier-level commercial rate).
 */
export function cityProvenanceFields(city: ConsoleCity | null): JsonRecord {
  return {
    cityProvenance: city?.provenance ?? null,
    cityDeclaredBy: city?.declaredBy ?? null,
  };
}

export type ConsoleOperation =
  | "exception_action"
  | "settlement"
  | "commercial_rate";

/** One console state POST, as the idempotency record keys and hashes it. */
export interface ConsoleWrite {
  readonly operation: ConsoleOperation;
  readonly actor: Actor;
  readonly city: ConsoleCity | null;
  readonly idempotencyKey: string;
  readonly subjectType: string;
  readonly subjectId: string;
  /** The normalized request; a replay must carry the same one. */
  readonly request: unknown;
}

/** A console answer: the HTTP status and body, first time or replayed. */
export interface ConsoleAnswer {
  readonly status: number;
  readonly body: JsonRecord;
  readonly replayed: boolean;
}

/** The record's primary key: the operator-scoped Idempotency-Key. */
export function consoleRecordId(write: ConsoleWrite): string {
  return deterministicId(
    "aud",
    scopedIdempotencyKey(
      `travel.ops.${write.operation}`,
      write.actor.id,
      write.idempotencyKey,
    ),
  );
}

function requestHash(write: ConsoleWrite): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        write.operation,
        write.subjectType,
        write.subjectId,
        write.city?.cityId ?? null,
        write.request,
      ]),
    )
    .digest("hex");
}

/**
 * The stored answer for this key, or null when it was never used. A
 * different request under the same key is refused, never answered.
 */
async function storedAnswer(
  db: TravelDb,
  write: ConsoleWrite,
): Promise<ConsoleAnswer | null> {
  const record = await db.auditLog.findUnique({
    where: { id: consoleRecordId(write) },
  });
  if (record === null) {
    return null;
  }
  const after = (record.after ?? {}) as JsonRecord;
  if (after.requestHash !== requestHash(write)) {
    throw new ContractError(
      "idempotency_key_reuse",
      "this Idempotency-Key was already used for a different console action",
    );
  }
  return {
    status: Number(after.status),
    body: (after.result ?? {}) as JsonRecord,
    replayed: true,
  };
}

/** What a console write's work records, inside its own transaction. */
export interface ConsoleOutcome {
  /** Audit action, e.g. `travel.ops.settlement_recorded`. */
  readonly action: string;
  readonly status: number;
  readonly result: JsonRecord;
  readonly reason: string | null;
}

/** Writes the console action's record — call inside the state change's transaction. */
export type ConsoleRecorder = (
  tx: TravelTx,
  outcome: ConsoleOutcome,
) => Promise<void>;

/**
 * Runs one console state POST exactly once per Idempotency-Key. `work`
 * performs the action and calls `record` inside the transaction that makes
 * its state change, then returns the answer it recorded.
 */
export async function runConsoleWrite(
  deps: TravelDeps,
  write: ConsoleWrite,
  work: (
    record: ConsoleRecorder,
  ) => Promise<{ readonly status: number; readonly body: JsonRecord }>,
): Promise<ConsoleAnswer> {
  const replay = await storedAnswer(deps.db, write);
  if (replay !== null) {
    return replay;
  }
  const hash = requestHash(write);
  const record: ConsoleRecorder = async (tx, outcome) => {
    await tx.auditLog.create({
      data: {
        id: consoleRecordId(write),
        actorId: write.actor.id,
        actorRole: write.actor.role,
        action: outcome.action,
        subjectType: write.subjectType,
        subjectId: write.subjectId,
        after: cleanJson({
          requestHash: hash,
          status: outcome.status,
          result: outcome.result,
          cityId: write.city?.cityId ?? null,
          ...cityProvenanceFields(write.city),
        }),
        reason: outcome.reason,
      },
    });
  };
  try {
    const answer = await work(record);
    return { ...answer, replayed: false };
  } catch (error) {
    // A duplicate that committed first: this attempt's transaction failed on
    // the record's primary key and rolled back with its state change.
    const raced = await storedAnswer(deps.db, write);
    if (raced !== null) {
      return raced;
    }
    throw error;
  }
}
