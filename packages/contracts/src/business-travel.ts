/**
 * Business travel (A06 part C) — organizations, prefunded budgets on the
 * canonical ledger, and the payer / passenger rights ride-service must honour
 * when it starts booking business trips.
 *
 * WHO SERVES WHAT
 *  - user-service (src/organizations) owns the ORGANIZATION: members and their
 *    roles, invitations, cost centres and the travel policy. User routes are
 *    mounted at `/organizations…` (the gateway's `/v1/organizations…`) and
 *    answer only to the gateway-signed identity context.
 *  - payment-service (src/business) owns the MONEY: the organization's
 *    prefunded wallet, one budget wallet per cost centre per month, booking
 *    reservations and the consolidated statement — all on the canonical
 *    double-entry ledger in integer minor units. User routes are mounted at
 *    `/v1/business…`; the internal API ride-service calls is
 *    `/v1/finance/business…` (service key; the gateway never proxies
 *    `/v1/finance`).
 *
 * Non-negotiables encoded here rather than in prose:
 *  - NO unsecured credit. An organization spends only what it has topped up
 *    and an admin has allocated to a cost centre's monthly budget; a booking
 *    without available budget is REFUSED at reservation, never deferred,
 *    invoiced later or allowed to overdraw;
 *  - reservation is atomic: it serializes on the budget account's row lock,
 *    so concurrent bookings can never spend the same money twice;
 *  - exactly once, by booking reference: one reservation per `bookingRef`
 *    ever, at most one commit and one release, a replay answers the original
 *    result and a replay with different money terms is refused (409);
 *  - the organization's budget is the RIDER-side funding of a business trip
 *    and never touches the driver side: the driver's 10% commission is still
 *    reserved at bid and captured once at selection from the driver's own
 *    wallet, exactly as for any marketplace trip;
 *  - roles are server-derived: the booker / traveller named on a reservation
 *    are checked against ACTIVE memberships in the same transaction that
 *    takes the reservation — a caller cannot assert its own authority;
 *  - passenger privacy: the organization sees its BUSINESS bookings' cost and
 *    metadata, never a traveller's personal trips, routes, locations or
 *    contact details (`BUSINESS_VISIBILITY`);
 *  - deny-by-default: `business_travel` (per city) gates NEW organizations,
 *    invitations, top-ups, allocations and reservations. Switching it off
 *    never strands money: commit, release, return-to-wallet and statements
 *    keep working.
 *
 * This module is not re-exported from `index.ts` yet (the same staging as
 * `driver-profile.ts`): the services mirror its constants and their tests
 * parse real responses against these schemas by relative import. Re-export it
 * — and register `BUSINESS_TRAVEL_FLAG` in FLAG_KEYS and
 * `BUSINESS_TRAVEL_EVENT_NAMES` in EVENT_NAMES — when a consumer outside
 * those two services needs it.
 */
import { z } from "zod";

import { VEHICLE_CLASSES } from "./city-config";
import { MP_SERVICES } from "./marketplace";
import { CurrencySchema, MoneySchema } from "./money";

const Timestamp = z.string().datetime({ offset: true });

// ── Flag ──────────────────────────────────────────────────────────────────

/**
 * The per-city switch for business travel. Not yet a declared `FlagKey`:
 * until it is, both services read the raw flag rule and an absent rule is
 * OFF — deny-by-default exactly like a declared flag. Nothing enables it.
 */
export const BUSINESS_TRAVEL_FLAG = "business_travel" as const;

// ── Organizations (user-service) ──────────────────────────────────────────

/**
 * - `owner`   — everything an admin can do, plus managing owners and admins.
 *               An organization always keeps at least one active owner.
 * - `admin`   — members (bookers and travellers), cost centres, policy,
 *               billing profile, funding, budgets and statements.
 * - `booker`  — books for any active member within policy; sees the business
 *               bookings THEY made.
 * - `traveller` — may be booked for, may book for THEMSELVES within policy,
 *               and sees their own business bookings.
 */
export const ORG_ROLES = ["owner", "admin", "booker", "traveller"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
export const OrgRoleSchema = z.enum(ORG_ROLES);

/** Roles that manage the organization (members, policy, money). */
export const ORG_ADMIN_ROLES = [
  "owner",
  "admin",
] as const satisfies readonly OrgRole[];

/** Roles that may book for someone other than themselves. */
export const ORG_BOOKER_ROLES = [
  "owner",
  "admin",
  "booker",
] as const satisfies readonly OrgRole[];

export const ORG_STATUSES = ["active", "suspended"] as const;
export const ORG_MEMBER_STATUSES = ["active", "removed"] as const;
export const ORG_INVITATION_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "revoked",
  "expired",
] as const;
export const ORG_COST_CENTRE_STATUSES = ["active", "archived"] as const;

/** A pending invitation lapses after this long (accept → 409 when expired). */
export const ORG_INVITATION_TTL_DAYS = 14;

export const BusinessServiceSchema = z.enum(MP_SERVICES);
export const BusinessVehicleClassSchema = z.enum(VEHICLE_CLASSES);

/**
 * The travel policy. Deny-by-default: a new organization's policy is a zero
 * cap and empty allow lists, so nothing is bookable until an admin sets it.
 */
export const OrgPolicySchema = z.object({
  tripCap: MoneySchema,
  allowedServices: z.array(BusinessServiceSchema),
  allowedClasses: z.array(BusinessVehicleClassSchema),
  version: z.number().int().min(1),
});
export type OrgPolicy = z.infer<typeof OrgPolicySchema>;

export const OrganizationViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  cityId: z.string().min(1),
  currency: CurrencySchema,
  status: z.enum(ORG_STATUSES),
  policy: OrgPolicySchema,
  /** The billing profile, shown to owners and admins only (null otherwise). */
  billing: z
    .object({ legalName: z.string().nullable(), taxId: z.string().nullable() })
    .nullable(),
  myRole: OrgRoleSchema,
  version: z.number().int().min(1),
  createdAt: Timestamp,
});
export type OrganizationView = z.infer<typeof OrganizationViewSchema>;

/**
 * A member as the organization sees them. `.strict()` on purpose: no phone,
 * email or personal trip data ever rides on it — a display name identifies
 * the person to their colleagues, nothing more.
 */
export const OrgMemberViewSchema = z
  .object({
    memberId: z.string().min(1),
    userId: z.string().min(1),
    displayName: z.string(),
    role: OrgRoleSchema,
    status: z.enum(ORG_MEMBER_STATUSES),
    costCentreId: z.string().nullable(),
    joinedAt: Timestamp,
  })
  .strict();
export type OrgMemberView = z.infer<typeof OrgMemberViewSchema>;

export const OrgInvitationViewSchema = z
  .object({
    invitationId: z.string().min(1),
    organizationId: z.string().min(1),
    organizationName: z.string().min(1),
    inviteeUserId: z.string().min(1),
    role: OrgRoleSchema,
    costCentreId: z.string().nullable(),
    status: z.enum(ORG_INVITATION_STATUSES),
    expiresAt: Timestamp,
    createdAt: Timestamp,
  })
  .strict();
export type OrgInvitationView = z.infer<typeof OrgInvitationViewSchema>;

export const OrgCostCentreViewSchema = z.object({
  costCentreId: z.string().min(1),
  organizationId: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(ORG_COST_CENTRE_STATUSES),
});
export type OrgCostCentreView = z.infer<typeof OrgCostCentreViewSchema>;

const E164 = /^\+[1-9]\d{6,14}$/;

export const CreateOrganizationInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  cityId: z.string().min(1).max(64),
  legalName: z.string().trim().min(2).max(200).optional(),
  taxId: z.string().trim().min(2).max(64).optional(),
});

export const UpdateOrgPolicyInputSchema = z.object({
  tripCapMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  allowedServices: z.array(BusinessServiceSchema).max(MP_SERVICES.length),
  allowedClasses: z
    .array(BusinessVehicleClassSchema)
    .max(VEHICLE_CLASSES.length),
  /** Optimistic concurrency: the policy version the admin edited. */
  expectedPolicyVersion: z.number().int().min(1),
});

export const UpdateOrgBillingInputSchema = z.object({
  legalName: z.string().trim().min(2).max(200).nullable(),
  taxId: z.string().trim().min(2).max(64).nullable(),
});

export const CreateCostCentreInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9._-]+$/, "a cost centre code is letters, digits, . _ -"),
  name: z.string().trim().min(1).max(120),
});

/**
 * Invite an EXISTING UBI user by their E.164 phone number. The invitation is
 * bound to that user; only they can accept or decline it.
 */
export const InviteMemberInputSchema = z.object({
  phone: z.string().regex(E164, "phone must be E.164, e.g. +2348012345678"),
  role: OrgRoleSchema,
  costCentreId: z.string().min(1).optional(),
});

export const UpdateMemberInputSchema = z
  .object({
    role: OrgRoleSchema.optional(),
    costCentreId: z.string().min(1).nullable().optional(),
  })
  .refine(
    (value) => value.role !== undefined || value.costCentreId !== undefined,
    { message: "name a role or a cost centre to change" },
  );

// ── Budgets on the canonical ledger (payment-service) ─────────────────────

/** Budgets are monthly, in the organization's city-local calendar. */
export const BUSINESS_PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
export const BusinessPeriodSchema = z
  .string()
  .regex(BUSINESS_PERIOD_PATTERN, "a budget period is YYYY-MM");

/**
 * How the money is booked. Balances are derived from journal lines; nothing
 * here stores one.
 *  - top-up:     psp_settlement → organization wallet   (kind `topup`)
 *  - allocate:   organization wallet → budget wallet    (`business_budget_allocation`)
 *  - return:     budget wallet → organization wallet    (`business_budget_return`)
 *  - reserve:    no journal movement — a reservation row; available drops
 *  - commit:     budget wallet → business_clearing      (`business_trip_commit`)
 *  - release:    no journal movement — the row stops encumbering
 * `business_clearing` holds committed business spend until the trip's
 * settlement pays the driver out of it (ride-service integration, next
 * round), so recon can prove it nets to zero per booking.
 */
export const BUSINESS_LEDGER = {
  organizationWalletOwnerType: "organization",
  budgetWalletOwnerType: "org_budget",
  clearingAccount: "business_clearing",
  entryKinds: {
    topup: "topup",
    allocate: "business_budget_allocation",
    return: "business_budget_return",
    commit: "business_trip_commit",
  },
} as const;

export const BUDGET_RESERVATION_STATES = [
  "reserved",
  "committed",
  "released",
] as const;
export type BudgetReservationState = (typeof BUDGET_RESERVATION_STATES)[number];

export const BUDGET_OPS = [
  "topup",
  "allocate",
  "return",
  "reserve",
  "commit",
  "release",
] as const;
export type BudgetOp = (typeof BUDGET_OPS)[number];

/**
 * Why a policy check or reservation was refused — `details.reason` on the
 * canonical error body (and the entries of `reasons` on a policy check).
 */
export const BUSINESS_REFUSAL_REASONS = [
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
export type BusinessRefusalReason = (typeof BUSINESS_REFUSAL_REASONS)[number];

export const BudgetAccountViewSchema = z.object({
  budgetId: z.string().min(1),
  organizationId: z.string().min(1),
  costCentreId: z.string().min(1),
  period: BusinessPeriodSchema,
  /** Journal-derived balance of the budget wallet. */
  balance: MoneySchema,
  /** Sum of reservations still `reserved` against it. */
  reserved: MoneySchema,
  /** balance − reserved: what the next booking may take. */
  available: MoneySchema,
});
export type BudgetAccountView = z.infer<typeof BudgetAccountViewSchema>;

export const OrgFundingViewSchema = z.object({
  organizationId: z.string().min(1),
  currency: CurrencySchema,
  /** The prefunded organization wallet: topped up, not yet allocated. */
  unallocated: MoneySchema,
  budgets: z.array(BudgetAccountViewSchema),
});

export const OrgTopupInputSchema = z.object({
  methodId: z.string().min(1),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

export const BudgetAllocationInputSchema = z.object({
  costCentreId: z.string().min(1),
  period: BusinessPeriodSchema,
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

// ── The internal API ride-service calls (/v1/finance/business) ────────────

/**
 * Base path. Every call carries `X-Service-Key` (INTERNAL_SERVICE_KEY); every
 * POST but `/policy-check` an `Idempotency-Key` (≤ 255 chars, url-safe);
 * `/policy-check` and `/reserve` an `X-City-ID` — the TRIP's city, whose
 * `business_travel` flag, timezone (budget month) and tax rates apply.
 *
 * THE SEQUENCE ride-service implements (next round — nothing calls it yet):
 *  1. QUOTE — `POST /policy-check` with the server-computed total. An option
 *     that is out of policy or unfunded is shown as unavailable with its
 *     `reasons`, never as bookable. Advisory only: reserve re-decides all of it.
 *  2. PUBLISH — a business request names `organizationId` (and optionally
 *     `costCentreId`, `expenseCategory`); the authenticated requester is the
 *     booker, the named passenger the traveller. No money moves.
 *  3. SELECT / AWARD — `POST /reserve` with `bookingRef` = the award id and
 *     key `business:<awardId>:reserve`, INSTEAD OF the rider-wallet funding
 *     reservation. A refusal fails the selection before any transport is
 *     promised. The driver's 10% commission hold and its one capture at
 *     selection are unchanged.
 *  4. COMPLETION — `POST /commit` with the actual total (never above the
 *     reservation), key `business:<awardId>:commit`. The driver is then paid
 *     out of `business_clearing` for that booking ref by the trip's settlement
 *     (payment-service settlement for business-funded awards — next round).
 *     An amendment that would raise the total above the reservation needs a
 *     reserve top-up op first (next round); until then it must be refused.
 *  5. CANCEL / NO AWARD — `POST /release` naming who cancelled
 *     (`BUSINESS_CANCEL_RIGHTS`), key `business:<awardId>:release`.
 *  6. TIMEOUT — `GET /reservations/:bookingRef` to learn what happened, then
 *     retry with the SAME key; a replay answers the original result (200).
 *
 * Answers: 201 recorded / 200 replayed (`BusinessOpResultSchema`); refusals
 * are the canonical error body with `details.reason` from
 * `BUSINESS_REFUSAL_REASONS` (or `cancel_not_permitted`); a key reused with
 * other terms is `idempotency_key_reuse` (409), a booking reserved with other
 * terms `conflict` (409), commit/release of a settled booking
 * `illegal_transition` (409).
 */
export const BUSINESS_INTERNAL_BASE_PATH = "/v1/finance/business";

/**
 * A business booking's terms, as ride-service states them at POLICY CHECK
 * (quote time, read-only) and at RESERVE (when the requester selects an offer
 * — the award saga reserves the budget INSTEAD OF the rider's wallet). The
 * amount is the server-computed total payable in minor units; clients never
 * compute it. `costCentreId` defaults to the traveller's member cost centre.
 */
export const BusinessBookingTermsSchema = z.object({
  /** ride-service's award (or request) id: one reservation per ref, ever. */
  bookingRef: z.string().min(1).max(200),
  organizationId: z.string().min(1),
  costCentreId: z.string().min(1).optional(),
  /** The authenticated requester — the organization's booker. */
  bookerId: z.string().min(1),
  /** The passenger. May equal bookerId (a traveller booking for themselves). */
  travellerId: z.string().min(1),
  service: BusinessServiceSchema,
  vehicleClass: BusinessVehicleClassSchema,
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: CurrencySchema,
  expenseCategory: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9 ._-]+$/)
    .optional(),
});
export type BusinessBookingTerms = z.infer<typeof BusinessBookingTermsSchema>;

export const BusinessPolicyCheckResultSchema = z.object({
  allowed: z.boolean(),
  /** Empty exactly when `allowed`. */
  reasons: z.array(z.enum(BUSINESS_REFUSAL_REASONS)),
  costCentreId: z.string().nullable(),
  budgetId: z.string().nullable(),
  /** What the budget could fund right now (null when there is no budget). */
  available: MoneySchema.nullable(),
  policyVersion: z.number().int().min(1).nullable(),
});
export type BusinessPolicyCheckResult = z.infer<
  typeof BusinessPolicyCheckResultSchema
>;

/**
 * Commit the ACTUAL total at completion (never more than reserved; the rest
 * is freed). A trip that ends up costing nothing is released, not committed.
 */
export const BusinessCommitInputSchema = z.object({
  bookingRef: z.string().min(1).max(200),
  actualMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: CurrencySchema,
});

/**
 * Who cancelled a business booking — the payer / passenger split
 * (`BUSINESS_CANCEL_RIGHTS`). payment-service re-derives the party's
 * authority from the reservation and the ACTIVE membership; ride-service
 * still owns WHEN a cancel is allowed in the trip's lifecycle.
 */
export const BUSINESS_CANCEL_PARTIES = [
  "traveller",
  "booker",
  "org_admin",
  "system",
] as const;
export type BusinessCancelParty = (typeof BUSINESS_CANCEL_PARTIES)[number];

export const BusinessReleaseInputSchema = z.object({
  bookingRef: z.string().min(1).max(200),
  cancelledBy: z.object({
    party: z.enum(BUSINESS_CANCEL_PARTIES),
    /** Required for every party except `system`. */
    userId: z.string().min(1).nullable(),
  }),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_]+$/, "a release reason is a snake_case code"),
});

export const BusinessTaxLineSchema = z.object({
  code: z.string().min(1),
  rateBps: z.number().int().positive().max(9_999),
  amountMinor: z.number().int().nonnegative(),
});

export const BusinessReservationViewSchema = z.object({
  reservationId: z.string().min(1),
  bookingRef: z.string().min(1),
  organizationId: z.string().min(1),
  costCentreId: z.string().min(1),
  budgetId: z.string().min(1),
  period: BusinessPeriodSchema,
  bookerId: z.string().min(1),
  travellerId: z.string().min(1),
  service: BusinessServiceSchema,
  vehicleClass: BusinessVehicleClassSchema,
  expenseCategory: z.string().nullable(),
  state: z.enum(BUDGET_RESERVATION_STATES),
  reserved: MoneySchema,
  committed: MoneySchema.nullable(),
  /** Taxes INCLUDED in the committed amount (empty until committed / none configured). */
  taxes: z.array(BusinessTaxLineSchema),
  commitEntryId: z.string().nullable(),
  policyVersion: z.number().int().min(1),
  releaseReason: z.string().nullable(),
  releasedBy: z.enum(BUSINESS_CANCEL_PARTIES).nullable(),
  createdAt: Timestamp,
  committedAt: Timestamp.nullable(),
  releasedAt: Timestamp.nullable(),
});
export type BusinessReservationView = z.infer<
  typeof BusinessReservationViewSchema
>;

/** What reserve / commit / release answer (201 recorded, 200 replayed). */
export const BusinessOpResultSchema = z.object({
  ref: z.string().min(1),
  op: z.enum(BUDGET_OPS),
  entryId: z.string().nullable(),
  amount: MoneySchema,
  reservation: BusinessReservationViewSchema,
  replayed: z.boolean(),
});

// ── Payer / passenger rights (the contract ride-service implements) ───────

/**
 * Who may cancel a business booking. payment-service enforces the IDENTITY
 * half on release (the named party must be the reservation's traveller, its
 * booker while still an active booking member, or an active admin/owner);
 * ride-service enforces the LIFECYCLE half before it calls release.
 */
export const BUSINESS_CANCEL_RIGHTS: Readonly<
  Record<BusinessCancelParty, string>
> = {
  traveller:
    "The passenger may cancel their own business trip before pickup, and end it early after pickup through the normal early-termination path (the commit then reflects the actual fare). The organization is told; no approval is needed.",
  booker:
    "The booker may cancel a booking they made, before pickup only. Once the passenger is on board the payer can no longer cancel or divert the trip — never divert a current passenger.",
  org_admin:
    "An owner or admin may cancel any of the organization's bookings, before pickup only, on the same terms as the booker.",
  system:
    "ride-service releases the reservation when no award results (no offers, request expired, award saga abandoned) — no user is named.",
};

/**
 * What each party sees. Enforced server-side: the organization reads come
 * from reservations only (the org's money), never from a traveller's
 * personal trip history, and carry no route, location or contact data.
 */
export const BUSINESS_VISIBILITY = {
  org_admin:
    "Every business booking of the organization: booking ref, cost centre, booker and traveller ids, service, vehicle class, expense category, reserved/committed amounts, included taxes, state and timestamps; the funding and budget balances; the consolidated statement. Never personal trips, routes, locations, driver details or contact data.",
  booker:
    "The same booking fields for the bookings they made, plus budget availability to book against. No funding history or statements.",
  traveller:
    "Their own business bookings (as passenger), including who booked them. Their trip itself is served by ride-service exactly like any trip.",
  driver:
    "Nothing about the organization, its budget or its policy: the trip looks like any marketplace trip, and the driver's 10% commission is unchanged.",
  personal_trips:
    "A member's trips that were not funded by an organization budget are never visible to the organization, in any view.",
} as const;

// ── Consolidated statement ────────────────────────────────────────────────

/** The CSV export's columns, in order. Money columns are integer minor units. */
export const BUSINESS_STATEMENT_CSV_COLUMNS = [
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

export const BusinessStatementLineSchema = z.object({
  bookingRef: z.string().min(1),
  reservationId: z.string().min(1),
  journalEntryId: z.string().min(1),
  committedAt: Timestamp,
  costCentreId: z.string().min(1),
  costCentreCode: z.string().min(1),
  travellerId: z.string().min(1),
  bookerId: z.string().min(1),
  service: BusinessServiceSchema,
  vehicleClass: BusinessVehicleClassSchema,
  expenseCategory: z.string().nullable(),
  gross: MoneySchema,
  taxes: z.array(BusinessTaxLineSchema),
  /** gross − included taxes. */
  net: MoneySchema,
});

/**
 * The period statement, built from journal lines on the organization's
 * wallets — never from a separately stored balance. `reconciliation` states
 * the journal figures the lines must (and do) add up to.
 */
export const BusinessStatementSchema = z.object({
  organizationId: z.string().min(1),
  period: BusinessPeriodSchema,
  currency: CurrencySchema,
  window: z.object({ start: Timestamp, end: Timestamp }),
  billing: z.object({
    name: z.string().min(1),
    legalName: z.string().nullable(),
    taxId: z.string().nullable(),
  }),
  lines: z.array(BusinessStatementLineSchema),
  totals: z.object({
    trips: z.number().int().nonnegative(),
    gross: MoneySchema,
    tax: MoneySchema,
    net: MoneySchema,
    taxByCode: z.array(z.object({ code: z.string(), amount: MoneySchema })),
  }),
  byCostCentre: z.array(
    z.object({
      costCentreId: z.string().min(1),
      code: z.string().min(1),
      trips: z.number().int().nonnegative(),
      gross: MoneySchema,
    }),
  ),
  funding: z.object({
    toppedUp: MoneySchema,
    allocated: MoneySchema,
    returned: MoneySchema,
  }),
  reconciliation: z.object({
    /** Commit entries on the org's budget wallets in the window. */
    commitEntries: z.number().int().nonnegative(),
    /** −SUM(their budget-wallet lines): must equal totals.gross. */
    journalCommittedMinor: z.number().int().nonnegative(),
  }),
});
export type BusinessStatement = z.infer<typeof BusinessStatementSchema>;

// ── Events ────────────────────────────────────────────────────────────────

/**
 * Organization events user-service writes to the outbox (subject: the user
 * the change is about — the invitee / member, or the acting admin for an
 * organization-level change; payload: ids only). Proposed EVENT_NAMES
 * additions: user-service validates against this closed list until they are
 * registered.
 */
export const BUSINESS_TRAVEL_EVENT_NAMES = [
  "organization.created",
  "organization.policy_updated",
  "organization.billing_updated",
  "organization.cost_centre_created",
  "organization.cost_centre_archived",
  "organization.member_invited",
  "organization.invitation_accepted",
  "organization.invitation_declined",
  "organization.invitation_revoked",
  "organization.member_updated",
  "organization.member_removed",
] as const;
export type BusinessTravelEventName =
  (typeof BUSINESS_TRAVEL_EVENT_NAMES)[number];

/**
 * payment-service publishes budget movements under the catalog's existing
 * generic payment names (the travel-payment / marketplace-settlement
 * convention), with `payload.kind = "business_budget"` and `payload.op`
 * saying which. Subject: `booking` for a reservation's ops, `wallet` for
 * funding and allocations.
 */
export const BUSINESS_BUDGET_OP_EVENTS: Readonly<Record<BudgetOp, string>> = {
  topup: "topup.captured",
  allocate: "transfer.posted",
  return: "transfer.posted",
  reserve: "transfer.held",
  commit: "transfer.posted",
  release: "payment.auth_released",
};
