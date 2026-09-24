/**
 * Idempotency for every state-changing fleet POST / PUT / PATCH (CLAUDE.md #3).
 *
 * The client key is scoped to the operation and the actor
 * (`scopedIdempotencyKey`), so two users cannot collide and one user cannot
 * replay a maintenance key onto a proposal. A replay with the same body
 * answers the stored response verbatim; the same key with another body is
 * `idempotency_key_reuse` (409).
 *
 * The record is the fast path. The flows themselves are replay-safe too: the
 * rows a request creates take ids derived from the scoped key
 * (lib/ids.ts `deterministicId`), and every transition re-reads the current
 * state, so a retry after a crash between the state change and this record
 * lands on the same rows instead of repeating the effect.
 *
 * Only successful answers are stored; a refusal that persisted nothing is
 * re-evaluated on retry. The payload hashed here must never include a
 * secret: the sign route hashes the offer id only, never the PIN (a hash of a
 * 4–6 digit PIN would be brute-forced offline in milliseconds).
 */
import { ContractError, scopedIdempotencyKey } from "@ubi/contracts";

import { isUniqueViolation } from "./errors";
import { canonicalHash, generateId } from "../lib/ids";

import type { FleetDb, JsonValue } from "./types";

export interface IdempotentRequest {
  readonly operation: string;
  readonly actorId: string;
  readonly key: string;
  /** What must match on replay. Never a secret. */
  readonly payload: unknown;
}

export interface IdempotentResponse {
  readonly status: number;
  readonly body: JsonValue;
}

function reuse(key: string): ContractError {
  return new ContractError(
    "idempotency_key_reuse",
    "this Idempotency-Key was already used with a different request",
    { key },
  );
}

export async function idempotent(
  db: FleetDb,
  request: IdempotentRequest,
  run: (scopedKey: string) => Promise<IdempotentResponse>,
): Promise<IdempotentResponse & { readonly replayed: boolean }> {
  const scopedKey = scopedIdempotencyKey(
    request.operation,
    request.actorId,
    request.key,
  );
  const payloadHash = canonicalHash(request.payload);
  const existing = await db.fleetIdempotencyRecord.findUnique({
    where: { scopedKey },
  });
  if (existing !== null) {
    if (existing.payloadHash !== payloadHash) {
      throw reuse(request.key);
    }
    return {
      status: existing.responseStatus,
      body: existing.responseBody as JsonValue,
      replayed: true,
    };
  }

  const outcome = await run(scopedKey);
  if (outcome.status >= 300) {
    return { ...outcome, replayed: false };
  }
  try {
    await db.fleetIdempotencyRecord.create({
      data: {
        id: generateId("idem"),
        scopedKey,
        operation: request.operation,
        actorId: request.actorId,
        payloadHash,
        responseStatus: outcome.status,
        responseBody: outcome.body as never,
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // A concurrent duplicate finished first: answer what it stored.
    const stored = await db.fleetIdempotencyRecord.findUnique({
      where: { scopedKey },
    });
    if (stored === null) {
      throw error;
    }
    if (stored.payloadHash !== payloadHash) {
      throw reuse(request.key);
    }
    return {
      status: stored.responseStatus,
      body: stored.responseBody as JsonValue,
      replayed: true,
    };
  }
  return { ...outcome, replayed: false };
}
