/**
 * Idempotency (CLAUDE.md #3): every POST that creates a ride, order, shipment,
 * transfer or booking takes an Idempotency-Key and returns the original result
 * on replay — including when the original attempt is still in flight.
 */
import { z } from "zod";

export const IDEMPOTENCY_HEADER = "idempotency-key";
export const IDEMPOTENCY_KEY_MAX_LENGTH = 64;

export const IdempotencyKeySchema = z
  .string()
  .min(8, "idempotency key must be at least 8 characters")
  .max(IDEMPOTENCY_KEY_MAX_LENGTH)
  .regex(/^[A-Za-z0-9_.:-]+$/, "idempotency key must be url-safe");

export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

/**
 * Scopes a client-supplied key to the actor and operation so two users cannot
 * collide, and one user cannot replay a ride key onto a transfer.
 */
export function scopedIdempotencyKey(
  operation: string,
  actorId: string,
  key: string,
): string {
  return `${operation}:${actorId}:${key}`;
}

export type IdempotentOutcome<T> =
  | { readonly replayed: false; readonly result: T }
  | { readonly replayed: true; readonly result: T };

/** Requests replaying the same key must also carry the same body. */
export class IdempotencyConflictError extends Error {
  readonly code = "idempotency_key_reuse";

  constructor(readonly key: string) {
    super(`idempotency key ${key} was already used with a different request body`);
    this.name = "IdempotencyConflictError";
  }
}
