/**
 * Canonical error codes. Clients branch on `code`, never on message text, so a
 * copy change can never alter behaviour.
 */
import { z } from "zod";

export const ERROR_CODES = [
  // generic
  "unauthorized",
  "forbidden",
  "not_found",
  "validation_failed",
  "rate_limited",
  "conflict",
  "internal_error",
  "service_unavailable",
  // flags & config
  "feature_disabled",
  "city_unsupported",
  "config_unavailable",
  "approver_is_author",
  "already_approved",
  // state
  "illegal_transition",
  "version_conflict",
  "idempotency_key_reuse",
  // ride lifecycle
  "quote_expired",
  "quote_signature_invalid",
  "payment_method_unavailable",
  "already_assigned",
  "offer_expired",
  "driver_ineligible",
  "not_at_pickup",
  "wrong_pin",
  "pin_attempts_exhausted",
  "pin_not_verified",
  "reason_code_required",
  "no_active_ride",
  // wallet
  "insufficient_funds",
  "limit_exceeded",
  "safe_mode_active",
  "wallet_locked",
  "pin_locked",
  "cooling_period",
  "risk_hold",
  "recipient_not_found",
  "unbalanced_journal",
  "return_not_consented",
  // identity
  "step_up_required",
  "liveness_failed",
  "document_expired",
  "limited_mode",
  // ops
  "recon_unexplained",
  "remedy_not_permitted",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorBodySchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});

export type ErrorBody = z.infer<typeof ErrorBodySchema>;

/** HTTP status for each code, so every service answers the same way. */
const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  rate_limited: 429,
  conflict: 409,
  internal_error: 500,
  service_unavailable: 503,
  feature_disabled: 404,
  city_unsupported: 404,
  config_unavailable: 503,
  approver_is_author: 409,
  already_approved: 409,
  illegal_transition: 409,
  version_conflict: 409,
  idempotency_key_reuse: 409,
  quote_expired: 409,
  quote_signature_invalid: 422,
  payment_method_unavailable: 422,
  already_assigned: 409,
  offer_expired: 409,
  driver_ineligible: 403,
  not_at_pickup: 422,
  wrong_pin: 422,
  pin_attempts_exhausted: 429,
  pin_not_verified: 409,
  reason_code_required: 422,
  no_active_ride: 404,
  insufficient_funds: 422,
  limit_exceeded: 422,
  safe_mode_active: 403,
  wallet_locked: 403,
  pin_locked: 403,
  cooling_period: 403,
  risk_hold: 202,
  recipient_not_found: 404,
  unbalanced_journal: 500,
  return_not_consented: 409,
  step_up_required: 401,
  liveness_failed: 403,
  document_expired: 403,
  limited_mode: 403,
  recon_unexplained: 409,
  remedy_not_permitted: 403,
};

export function statusForErrorCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}

/**
 * A domain error carrying a canonical code. Services map this to a response;
 * nothing else should construct an error body by hand.
 */
export class ContractError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "ContractError";
    this.status = STATUS_BY_CODE[code];
  }

  toBody(): ErrorBody {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: { ...this.details } };
  }
}

/** Feature-flag denial: deep links must 404, not 403, so a disabled vertical is invisible. */
export function featureDisabled(feature: string): ContractError {
  return new ContractError("feature_disabled", `${feature} is not available here`, { feature });
}
