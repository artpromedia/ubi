/**
 * Typed supplier failures, so the ops layer can tell the three cases apart
 * that a booking ladder must never confuse:
 *
 *  1. `SupplierPreflightError` — refused BEFORE any provider call (missing
 *     credentials, an expired quote, passenger data the supplier would
 *     reject, a documents requirement UBI cannot meet). Nothing reached the
 *     supplier, so the outcome is definitive: checkout fails the order and
 *     releases the hold.
 *  2. `SupplierUnsupportedError` — the supplier does not offer this capability
 *     at all (LiteAPI has no flight-style change; neither supplier has a
 *     stand-alone refund call). It names the supported ALTERNATIVE the ops layer
 *     offers instead. Never a fabricated success.
 *  3. `SupplierHttpError` — the provider answered (or failed to). `ambiguous`
 *     is true when the call may have taken effect (timeout, dropped
 *     connection, a 5xx the supplier documents as "do not retry"): the caller
 *     must look the booking up by UBI's reference before doing anything else.
 */
import type { ErrorCode } from "@ubi/contracts";

export class SupplierPreflightError extends Error {
  /** Nothing was sent to the supplier. */
  readonly providerCalled = false as const;

  constructor(
    readonly code: ErrorCode,
    readonly reason: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "SupplierPreflightError";
  }
}

export class SupplierUnsupportedError extends Error {
  readonly providerCalled = false as const;

  constructor(
    readonly adapter: string,
    readonly capability: string,
    /** Machine-readable alternative the ops layer offers (e.g. `cancel_and_rebook`). */
    readonly alternative: string,
    message: string,
  ) {
    super(message);
    this.name = "SupplierUnsupportedError";
  }
}

export class SupplierHttpError extends Error {
  constructor(
    readonly adapter: string,
    readonly operation: string,
    /** HTTP status, or null when no response arrived (timeout / network). */
    readonly status: number | null,
    /** The supplier's own error code (Duffel `errors[].code`, LiteAPI `error.code`). */
    readonly supplierCode: string | null,
    /** True when the request may have taken effect on the supplier's side. */
    readonly ambiguous: boolean,
    message: string,
  ) {
    super(message);
    this.name = "SupplierHttpError";
  }
}

/** True when an error proves no provider call happened (definitive refusal). */
export function isPreCallRefusal(
  error: unknown,
): error is SupplierPreflightError | SupplierUnsupportedError {
  return (
    error instanceof SupplierPreflightError ||
    error instanceof SupplierUnsupportedError
  );
}
