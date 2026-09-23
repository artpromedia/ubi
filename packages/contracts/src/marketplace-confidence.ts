/**
 * Rider confidence on the negotiated-fare marketplace (A06 parts A and D,
 * A04 item 3, receipts) — the building blocks `marketplace.ts` composes into
 * the offer, request, feed and receipt contracts, and re-exports.
 *
 * Non-negotiables encoded here rather than in prose:
 *  - every comparison figure is SERVER-computed: the total the rider pays,
 *    the pickup ESTIMATE (labelled as one, with its basis and age), the
 *    verified driver card, the defined reliability figure and the service
 *    fit. A client renders them; it never derives, ranks or fills them in;
 *  - nothing is invented: user-service's rating is `{ average, count }` or
 *    null, a driver card nobody could resolve is "unavailable" with every
 *    field null, and reliability below its minimum sample is
 *    `insufficient_history` with no rate at all;
 *  - no sponsored or unexplained default winner: the default order is the
 *    order drivers offered, and every badge carries its reason;
 *  - a service REQUIREMENT matches VERIFIED capability only; where none is
 *    verified it is `unavailable` (never silently matched), while a
 *    PREFERENCE only ever affects the service-fit order;
 *  - a preferred driver is ASKED, never assigned: same floors, stationary
 *    bidding, wallet hold and 10% commission; open-market fallback happens
 *    only with the rider's explicit consent at request time; declining is
 *    free and never recorded against the driver;
 *  - the rider's receipt never carries the driver's commission; the driver's
 *    receipt shows gross, commission and net; both reconcile exactly with
 *    the settlement.
 */
import { z } from "zod";

import { MoneySchema } from "./money";
import { MP_PREFERRED_WINDOW_STATES } from "./state-machines";

const Timestamp = z.string().datetime({ offset: true });

// ── Offer comparison (A06 part A) ──────────────────────────────────────────

/**
 * `GET /v1/mp/requests/:id?sort=` — the offer orders a requester may pick.
 * `offered` (the default) is the order drivers offered: neutral, so there is
 * no default winner.
 */
export const MP_OFFER_SORTS = [
  "offered",
  "price",
  "pickup",
  "service_fit",
] as const;
export type MpOfferSort = (typeof MP_OFFER_SORTS)[number];

/** What an offer's pickup estimate was measured with. */
export const MP_OFFER_PICKUP_BASES = [
  "routed_leg",
  "finishing_trip_prediction",
  "straight_line_estimate",
  "advance_booking",
  "unavailable",
] as const;

/**
 * An offer's pickup ESTIMATE: the eligibility prediction the bid passed
 * (minute-coarsened) with when it was made, else a live straight-line
 * estimate, else unavailable. Never a promise.
 */
export const MpOfferPickupEstimateSchema = z.object({
  seconds: z.number().int().nonnegative().nullable(),
  basis: z.enum(MP_OFFER_PICKUP_BASES),
  label: z.string().min(1),
  estimatedAt: Timestamp.nullable(),
  estimate: z.literal(true),
});
export type MpOfferPickupEstimate = z.infer<typeof MpOfferPickupEstimateSchema>;

/**
 * The vehicle behind an offer: the class ride-service verified the driver
 * eligible for, and — only from a VERIFIED user-service card — the registered
 * vehicle (body type, make, model, colour, masked plate). Seat capacity is
 * null where the market publishes none.
 */
export const MpOfferVehicleSchema = z.object({
  class: z.string().min(1),
  capacitySeats: z.number().int().positive().nullable(),
  capacityNote: z.string().min(1),
  bodyType: z
    .enum(["sedan", "suv", "van", "motorcycle", "electric"])
    .nullable(),
  make: z.string().min(1).nullable(),
  model: z.string().min(1).nullable(),
  colour: z.string().min(1).nullable(),
  plateMasked: z.string().min(1).nullable(),
  verified: z.boolean(),
});
export type MpOfferVehicle = z.infer<typeof MpOfferVehicleSchema>;

/**
 * The driver card as the requester may see it, straight from user-service's
 * privacy-limited read model (`DriverProfilesResponseSchema`):
 *  - `verified`: the card's verification status is "verified";
 *  - `not_verified`: a card exists but checks are not (or no longer) complete;
 *  - `unavailable`: no card could be resolved — user-service unconfigured,
 *    down, slow, malformed, or deliberately non-disclosing. Every field is
 *    null; the offer is still served.
 * `rating` is exactly user-service's `{ average, count }`, or null when no
 * completed trip carries a rating — never 0, never a default.
 */
export const MpOfferDriverProfileSchema = z.object({
  status: z.enum(["verified", "not_verified", "unavailable"]),
  label: z.string().min(1),
  displayName: z.string().min(1).nullable(),
  initials: z.string().min(1).nullable(),
  photoRef: z.string().min(1).nullable(),
  photoVerified: z.boolean().nullable(),
  verifiedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  rating: z
    .object({
      average: z.number().min(1).max(5),
      count: z.number().int().positive(),
    })
    .nullable(),
  ratingLabel: z.string().min(1),
  completedTrips: z.number().int().nonnegative().nullable(),
  memberSince: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .nullable(),
  /** Verified accessibility capability: none exists yet. */
  accessibility: z.literal("unavailable"),
});
export type MpOfferDriverProfile = z.infer<typeof MpOfferDriverProfileSchema>;

/**
 * Reliability, DEFINED: of the marketplace rides the driver was awarded in
 * the trailing `windowDays` that ended, the share completed and the share
 * the driver cancelled (rider cancellations, rider no-shows, declined or
 * lapsed preferred invitations and trips still under way are not counted).
 * Below `minimumSample` the status is `insufficient_history` and both rates
 * are null — a number is never shown on too little history. Rates are basis
 * points and sum to 10,000.
 */
export const MpReliabilitySchema = z.object({
  status: z.enum(["available", "insufficient_history", "unavailable"]),
  definition: z.string().min(1),
  windowDays: z.number().int().positive(),
  minimumSample: z.number().int().positive(),
  sampleSize: z.number().int().nonnegative(),
  completedJobs: z.number().int().nonnegative(),
  driverCancellations: z.number().int().nonnegative(),
  completionRateBps: z.number().int().min(0).max(10_000).nullable(),
  driverCancellationRateBps: z.number().int().min(0).max(10_000).nullable(),
  label: z.string().min(1),
  computedAt: Timestamp,
});
export type MpReliability = z.infer<typeof MpReliabilitySchema>;

/** One named fact behind a service-fit point or a badge. */
export const MpCriterionSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
});
export type MpCriterion = z.infer<typeof MpCriterionSchema>;

/**
 * Service fit: one point per criterion — driver details verified, a driver
 * the rider saved, and each stated preference the driver's VERIFIED vehicle
 * meets — with every matched and unmet criterion named.
 */
export const MpServiceFitSchema = z.object({
  score: z.number().int().nonnegative(),
  maxScore: z.number().int().nonnegative(),
  matched: z.array(MpCriterionSchema),
  unmet: z.array(MpCriterionSchema),
  definition: z.string().min(1),
});
export type MpServiceFit = z.infer<typeof MpServiceFitSchema>;

/** One sort the requester may pick, with the tie-breaks it applies. */
export const MpOfferSortOptionSchema = z.object({
  key: z.enum(MP_OFFER_SORTS),
  label: z.string().min(1),
  tieBreak: z.string().min(1),
});

/** Which order a snapshot's offers are in, and the other orders available. */
export const MpOfferOrderSchema = z.object({
  sort: z.enum(MP_OFFER_SORTS),
  label: z.string().min(1),
  tieBreak: z.string().min(1),
  options: z.array(MpOfferSortOptionSchema),
  note: z.string().min(1),
});
export type MpOfferOrder = z.infer<typeof MpOfferOrderSchema>;

// ── Accessibility and service needs (A06 part D) ───────────────────────────

/** Concrete requirements: matched to VERIFIED capability only. */
export const MP_SERVICE_REQUIREMENTS = [
  "wheelchair_accessible_vehicle",
  "assistance_animal",
  "extra_luggage_capacity",
] as const;
export type MpServiceRequirement = (typeof MP_SERVICE_REQUIREMENTS)[number];

/** Soft preferences: service-fit ranking only, never a gate. */
export const MP_SERVICE_PREFERENCES = [
  "larger_vehicle",
  "electric_vehicle",
] as const;
export type MpServicePreference = (typeof MP_SERVICE_PREFERENCES)[number];

/**
 * `POST /v1/mp/requests` `serviceNeeds` (marketplace_accessibility_requirements).
 * A requirement the market cannot verify refuses the publish with 409
 * `conflict` (`details.reason: "service_need_unavailable"`, the per-requirement
 * reasons and a fallback) — nothing is published without it.
 */
export const MpServiceNeedsInputSchema = z
  .object({
    requirements: z
      .array(z.enum(MP_SERVICE_REQUIREMENTS))
      .max(MP_SERVICE_REQUIREMENTS.length)
      .optional(),
    preferences: z
      .array(z.enum(MP_SERVICE_PREFERENCES))
      .max(MP_SERVICE_PREFERENCES.length)
      .optional(),
  })
  .strict();
export type MpServiceNeedsInput = z.infer<typeof MpServiceNeedsInputSchema>;

/** A request's stated needs, codes only (owner view). */
export const MpServiceNeedsSchema = z.object({
  requirements: z.array(z.enum(MP_SERVICE_REQUIREMENTS)),
  preferences: z.array(z.enum(MP_SERVICE_PREFERENCES)),
});
export type MpServiceNeeds = z.infer<typeof MpServiceNeedsSchema>;

export const MpServiceRequirementAvailabilitySchema = z.object({
  code: z.enum(MP_SERVICE_REQUIREMENTS),
  title: z.string().min(1),
  availability: z.enum(["verified", "unavailable"]),
  detail: z.string().min(1),
});

/** `GET /v1/mp/service-needs?service=ride&vehicleClass=` — honest availability. */
export const MpServiceNeedsCatalogSchema = z.object({
  cityId: z.string().min(1),
  service: z.literal("ride"),
  vehicleClass: z.string().min(1),
  requirements: z.array(MpServiceRequirementAvailabilitySchema),
  preferences: z.array(
    z.object({
      code: z.enum(MP_SERVICE_PREFERENCES),
      title: z.string().min(1),
      effect: z.literal("ranking_only"),
      detail: z.string().min(1),
    }),
  ),
  fallback: z.string().min(1),
  disclosure: z.string().min(1),
});
export type MpServiceNeedsCatalog = z.infer<typeof MpServiceNeedsCatalogSchema>;

// ── Preferred-driver requests (A04 item 3) ─────────────────────────────────

/**
 * Per-market preferred-driver window (`MarketplacePolicy.preferredDriver`).
 * Absent ⇒ the pilot default (`MP_PREFERRED_DRIVER_PILOT_WINDOW_SEC`, cut to
 * half the request lifetime in a market whose requests live shorter). The
 * window is always strictly shorter than the request lifetime.
 */
export const MpPreferredDriverPolicySchema = z.object({
  exclusiveWindowSec: z.number().int().min(30).max(900),
});
export type MpPreferredDriverPolicy = z.infer<
  typeof MpPreferredDriverPolicySchema
>;
export const MP_PREFERRED_DRIVER_PILOT_WINDOW_SEC = 120;

/**
 * `POST /v1/mp/requests` `preferredDriver` (marketplace_preferred_drivers).
 * `driverId` must be a driver the rider saved after a completed trip, who
 * opted in to preferred requests. `fallbackToMarket` is REQUIRED: the rider's
 * explicit consent (or refusal) to open the request to every driver if the
 * named one does not offer in time.
 */
export const MpPreferredDriverInputSchema = z
  .object({
    driverId: z.string().uuid(),
    fallbackToMarket: z.boolean(),
  })
  .strict();
export type MpPreferredDriverInput = z.infer<
  typeof MpPreferredDriverInputSchema
>;

/** The requester's view of the window (`MpRequest.preferredDriver`). */
export const MpPreferredDriverSchema = z.object({
  driverId: z.string().min(1),
  state: z.enum(MP_PREFERRED_WINDOW_STATES),
  windowSec: z.number().int().positive(),
  windowEndsAt: Timestamp,
  fallbackToMarket: z.boolean(),
  label: z.string().min(1),
});
export type MpPreferredDriver = z.infer<typeof MpPreferredDriverSchema>;

/**
 * The named driver's invitation on a feed card / driver view. It never
 * identifies the rider; declining is free.
 */
export const MpPreferredInvitationSchema = z.object({
  windowEndsAt: Timestamp,
  label: z.string().min(1),
  note: z.string().min(1),
  canDecline: z.boolean(),
});
export type MpPreferredInvitation = z.infer<typeof MpPreferredInvitationSchema>;

/** `POST /v1/mp/requests/:id/preferred/decline` answer (Idempotency-Key). */
export const MpPreferredDeclineSchema = z.object({
  requestId: z.string().min(1),
  declined: z.literal(true),
  declinedAt: Timestamp,
  note: z.string().min(1),
});
export type MpPreferredDecline = z.infer<typeof MpPreferredDeclineSchema>;

/** `POST /v1/mp/favourite-drivers` body (Idempotency-Key required). */
export const MpSaveFavouriteDriverSchema = z
  .object({ requestId: z.string().uuid() })
  .strict();
export type MpSaveFavouriteDriver = z.infer<typeof MpSaveFavouriteDriverSchema>;

// ── Receipts ───────────────────────────────────────────────────────────────

/** Receipt line codes. Commission lines appear on the DRIVER's view only. */
export const MP_RECEIPT_LINE_CODES = [
  "agreed_fare",
  "route_change",
  "stop_waiting",
  "early_termination",
  "commission",
  "commission_adjustment",
] as const;

export const MpReceiptLineSchema = z.object({
  code: z.enum(MP_RECEIPT_LINE_CODES),
  label: z.string().min(1),
  amountMinor: MoneySchema,
  amendmentId: z.string().min(1).optional(),
  committedAt: Timestamp.optional(),
});
export type MpReceiptLine = z.infer<typeof MpReceiptLineSchema>;

/**
 * Taxes on a rider receipt: the share of the total at the rates the market's
 * config defined for the trip's pricing snapshot — `included` (nothing is
 * ever added on top), `not_configured` (no rates, none itemised) or
 * `unavailable` (the snapshot could not be read; the total is unaffected).
 */
export const MpReceiptTaxesSchema = z.object({
  basis: z.enum(["included", "not_configured", "unavailable"]),
  lines: z.array(
    z.object({
      code: z.string().min(1),
      rateBps: z.number().int().positive().max(9_999),
      label: z.string().min(1),
      amountMinor: MoneySchema,
    }),
  ),
  note: z.string().min(1),
});

/** The driver's receipt view: gross, the 10% and its linked moves, net. */
export const MpDriverReceiptEarningsSchema = z.object({
  grossMinor: MoneySchema,
  commissionBps: z.literal(1_000),
  commissionLines: z.array(MpReceiptLineSchema),
  commissionMinor: MoneySchema,
  netMinor: MoneySchema,
  note: z.string().min(1),
});
