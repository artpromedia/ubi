/**
 * Idempotency keys for every money/state POST the portal sends (fleet-service
 * requires `idempotency-key` on each: ops/idempotency.ts).
 *
 * One key per user INTENT. After a DEFINITE answer — a success, or a decoded
 * 4xx refusal that applied nothing — the next submit gets a fresh key. After
 * an AMBIGUOUS failure (network drop, timeout, 5xx: the request may have
 * reached fleet-service) the key is KEPT, so "Try again" replays the same
 * request and the server answers the stored outcome instead of applying it
 * twice.
 */
import { ApiError } from "./api-client";

/** Fresh url-safe key satisfying IdempotencyKeySchema (8–64, `[A-Za-z0-9_.:-]`). */
export function newIdempotencyKey(): string {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `fp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * True when the outcome of a failed command is UNKNOWN. Only a decoded 4xx
 * answer is definite; anything else (TypeError from fetch, 5xx, a throw
 * after a 2xx) may have applied.
 */
export function isAmbiguousFailure(error: unknown, online = true): boolean {
  return !online || !(error instanceof ApiError) || error.status >= 500;
}

/** The key the NEXT submit of the same intent must use. */
export function keyAfter(
  current: string,
  outcome:
    | { readonly ok: true }
    | { readonly ok: false; readonly error: unknown },
  online = true,
): string {
  if (!outcome.ok && isAmbiguousFailure(outcome.error, online)) {
    return current;
  }
  return newIdempotencyKey();
}
