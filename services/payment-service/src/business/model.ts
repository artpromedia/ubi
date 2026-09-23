/**
 * Business travel budgets (A06 part C) — the closed vocabularies and the
 * refusal mapping.
 *
 * Every constant here mirrors packages/contracts/src/business-travel.ts (not
 * re-exported from @ubi/contracts yet); tests/business parses real responses
 * against that contract, so the two cannot drift silently.
 */
import { ContractError, type ErrorCode } from "@ubi/contracts";

import type { Actor } from "../ledger/types";

/** Mirrors `BUSINESS_TRAVEL_FLAG` (not yet a declared FlagKey). */
export const BUSINESS_TRAVEL_FLAG = "business_travel";

/** Mirrors `ORG_ROLES`. user-service owns memberships; this module reads them. */
export const ORG_ROLES = ["owner", "admin", "booker", "traveller"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Mirrors `ORG_ADMIN_ROLES`: funding, budgets, every booking, statements. */
export const ORG_ADMIN_ROLES: readonly OrgRole[] = ["owner", "admin"];

/** Mirrors `ORG_BOOKER_ROLES`: may book for someone other than themselves. */
export const ORG_BOOKER_ROLES: readonly OrgRole[] = [
  "owner",
  "admin",
  "booker",
];

/** Mirrors `BUDGET_RESERVATION_STATES`. */
export const RESERVATION_STATES = [
  "reserved",
  "committed",
  "released",
] as const;
export type ReservationState = (typeof RESERVATION_STATES)[number];

/** Mirrors `BUDGET_OPS`. */
export const BUDGET_OPS = [
  "topup",
  "allocate",
  "return",
  "reserve",
  "commit",
  "release",
] as const;
export type BudgetOp = (typeof BUDGET_OPS)[number];

/** Mirrors `BUSINESS_CANCEL_PARTIES`. */
export const CANCEL_PARTIES = [
  "traveller",
  "booker",
  "org_admin",
  "system",
] as const;
export type CancelParty = (typeof CANCEL_PARTIES)[number];

/** Mirrors `BUSINESS_LEDGER`. */
export const ORG_WALLET_OWNER = "organization";
export const BUDGET_WALLET_OWNER = "org_budget";
/**
 * Organization and budget wallets are not KYC-tiered personal wallets: no
 * personal wallet path (transfers, NIP, top-ups) ever resolves one — they are
 * keyed by owner type — so this tier value only labels them.
 */
export const BUSINESS_WALLET_TIER = "business";

/** Mirrors `BUSINESS_BUDGET_OP_EVENTS` (the catalog's generic payment names). */
export const OP_EVENT = {
  topup: "topup.captured",
  allocate: "transfer.posted",
  return: "transfer.posted",
  reserve: "transfer.held",
  commit: "transfer.posted",
  release: "payment.auth_released",
} as const satisfies Record<BudgetOp, string>;

/** Mirrors `BUSINESS_STATEMENT_CSV_COLUMNS`. */
export const STATEMENT_CSV_COLUMNS = [
  "booking_ref",
  "committed_at",
  "cost_centre_code",
  "traveller_id",
  "booker_id",
  "service",
  "vehicle_class",
  "expense_category",
  "gross_minor",
  "tax_minor",
  "net_minor",
  "currency",
  "journal_entry_id",
] as const;

/** The internal API's authenticated principal: ride-service, by service key. */
export const BUSINESS_SERVICE_ACTOR: Actor = {
  id: "ride-service",
  role: "service",
};

/** Mirrors `BUSINESS_REFUSAL_REASONS`. */
export const REFUSAL_REASONS = [
  "feature_disabled",
  "organization_not_active",
  "booker_not_authorized",
  "traveller_not_member",
  "cost_centre_invalid",
  "service_not_allowed",
  "class_not_allowed",
  "trip_cap_exceeded",
  "currency_mismatch",
  "no_budget_for_period",
  "budget_insufficient",
] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

/**
 * Each refusal travels as a canonical error code (clients branch on `code`,
 * ride-service on `details.reason`). Budget refusals are
 * `insufficient_spendable`: the booking is REFUSED — never deferred, never
 * put on credit.
 */
const REFUSAL_CODE: Readonly<Record<RefusalReason, ErrorCode>> = {
  feature_disabled: "feature_disabled",
  organization_not_active: "forbidden",
  booker_not_authorized: "forbidden",
  traveller_not_member: "forbidden",
  cost_centre_invalid: "validation_failed",
  service_not_allowed: "forbidden",
  class_not_allowed: "forbidden",
  trip_cap_exceeded: "limit_exceeded",
  currency_mismatch: "validation_failed",
  no_budget_for_period: "insufficient_spendable",
  budget_insufficient: "insufficient_spendable",
};

const REFUSAL_MESSAGE: Readonly<Record<RefusalReason, string>> = {
  feature_disabled: "business travel is not available here",
  organization_not_active: "this organization cannot book right now",
  booker_not_authorized:
    "the requester is not authorized to book for this organization",
  traveller_not_member:
    "the passenger is not an active member of this organization",
  cost_centre_invalid:
    "the booking must name an active cost centre of this organization",
  service_not_allowed: "the organization's policy does not allow this service",
  class_not_allowed:
    "the organization's policy does not allow this vehicle class",
  trip_cap_exceeded: "the trip exceeds the organization's per-trip cap",
  currency_mismatch: "the booking currency is not the organization's currency",
  no_budget_for_period: "this cost centre has no budget for the current period",
  budget_insufficient:
    "this cost centre's budget cannot cover the booking — it is refused, not deferred",
};

export function refusal(
  reason: RefusalReason,
  details: Readonly<Record<string, unknown>> = {},
): ContractError {
  return new ContractError(REFUSAL_CODE[reason], REFUSAL_MESSAGE[reason], {
    reason,
    ...details,
  });
}

export function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value);
}

export function isCancelParty(value: string): value is CancelParty {
  return (CANCEL_PARTIES as readonly string[]).includes(value);
}
