/**
 * Canonical error codes. Clients branch on `code`, never on message text, so a
 * copy change can never alter behaviour.
 */
import { z } from "zod";

import { FLEET_ERROR_STATUS, type FleetErrorCode } from "./fleet";

import type { FleetInternalErrorCode } from "./marketplace-fleet";

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
  "launch_pair_incomplete",
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
  // negotiated-fare marketplace (M01)
  "market_not_configured",
  "fare_out_of_bounds",
  "request_closed",
  "bid_not_live",
  "bid_revision_cooldown",
  "bid_cap_reached",
  "request_cap_reached",
  "insufficient_spendable",
  "slot_unavailable",
  "queue_dependency_invalid",
  "award_unresolved",
  "rate_profile_out_of_bounds",
  // fleet availability calendar (A05): internal contract A between
  // ride-service and fleet-service (FLEET_INTERNAL_ERROR_CODES in
  // marketplace-fleet.ts) and fleet-service's own refusals
  // (FLEET_ERROR_STATUS in fleet.ts)
  "occupancy_conflict",
  "idempotency_conflict",
  "swap_ineligible",
  "shift_overlap",
  "above_city_cap",
  "needs_resolution",
  "terms_owner_only",
  "preview_stale",
  "maintenance_overlap",
  "unresolved_booking_overlap",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorBodySchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});

export type ErrorBody = z.infer<typeof ErrorBodySchema>;

/** HTTP status for each code, so every service answers the same way. */
const STATUS_BY_CODE = {
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
  launch_pair_incomplete: 409,
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
  // Unconfigured production markets fail closed rather than inventing bounds.
  market_not_configured: 503,
  fare_out_of_bounds: 422,
  request_closed: 409,
  bid_not_live: 409,
  bid_revision_cooldown: 429,
  bid_cap_reached: 429,
  request_cap_reached: 429,
  // Distinct from insufficient_funds: the cleared balance may cover the amount,
  // but active bid holds and other encumbrances make it unspendable.
  insufficient_spendable: 422,
  slot_unavailable: 409,
  queue_dependency_invalid: 409,
  // A hold whose award is unresolved can neither expire nor release; the award
  // must reconcile first (M04). Also returned when a second selection races a
  // pending award on the same request.
  award_unresolved: 409,
  rate_profile_out_of_bounds: 422,
  // A maintenance block the shared vehicle occupancy ledger refuses (it would
  // overlap a booking or another block).
  occupancy_conflict: 409,
  // An Idempotency-Key reused with a different body on internal contract A
  // (distinct from idempotency_key_reuse, the client-facing answer).
  idempotency_conflict: 409,
  // A vehicle swap the server found ineligible (reasons in details).
  swap_ineligible: 422,
  // Two signed shifts on one vehicle (or one driver) would overlap.
  shift_overlap: 422,
  // A weekly_fixed remittance above the city's remittanceCapMinor.
  above_city_cap: 422,
  // Planned maintenance overlaps a confirmed booking: resolve it first.
  needs_resolution: 409,
  // Managers propose only under the currently signed terms version.
  terms_owner_only: 403,
  // The request no longer matches the server preview it cites.
  preview_stale: 409,
  // Two planned maintenance blocks on one vehicle would overlap.
  maintenance_overlap: 409,
  // A time-off change overlaps bookings the driver has not chosen for.
  unresolved_booking_overlap: 409,
} as const satisfies Readonly<Record<ErrorCode, number>>;

export function statusForErrorCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}

/**
 * The fleet calendar's codes (fleet.ts FLEET_ERROR_STATUS, internal contract
 * A's FLEET_INTERNAL_ERROR_CODES), each registered above with the status its
 * own module declares. Checked by the compiler: a fleet code missing from
 * ERROR_CODES, or answering another status here, does not build.
 */
export const FLEET_REGISTERED_ERROR_STATUS: {
  readonly [K in
    | FleetErrorCode
    | FleetInternalErrorCode]: (typeof STATUS_BY_CODE)[K];
} = {
  ...FLEET_ERROR_STATUS,
  occupancy_conflict: STATUS_BY_CODE.occupancy_conflict,
  idempotency_conflict: STATUS_BY_CODE.idempotency_conflict,
};

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
      : {
          code: this.code,
          message: this.message,
          details: { ...this.details },
        };
  }
}

/** Feature-flag denial: deep links must 404, not 403, so a disabled vertical is invisible. */
export function featureDisabled(feature: string): ContractError {
  return new ContractError(
    "feature_disabled",
    `${feature} is not available here`,
    { feature },
  );
}
