/**
 * Negotiated-fare marketplace contracts (M01).
 *
 * The requester publishes a server-bounded fare, eligible drivers submit
 * funded private bids, and the requester selects the winner. These schemas are
 * the versioned wire contract between ride-service (Go, authoritative award
 * engine — see contracts/openapi/marketplace.yaml for the cross-language
 * source of truth), payment-service (wallet encumbrances), realtime-gateway
 * (event fan-out) and the RN/web apps.
 *
 * Non-negotiables encoded here rather than in prose:
 *  - a driver "accepting" the requested fare is a BID, never an assignment;
 *  - the 10% commission is reserved at bid and debited exactly once at
 *    selection (`MarketplacePolicySchema.commissionBps` is a literal 1000);
 *  - bids are private — the rider-facing view (`MpOfferSchema`) and the
 *    driver-facing views never carry rival prices or identities;
 *  - amounts are integer minor units (`Money`), computed server-side only.
 */
import { z } from "zod";

import {
  MpCriterionSchema,
  MpDriverReceiptEarningsSchema,
  MpOfferDriverProfileSchema,
  MpOfferPickupEstimateSchema,
  MpOfferVehicleSchema,
  MpOfferOrderSchema,
  MpPreferredDriverInputSchema,
  MpPreferredDriverSchema,
  MpPreferredInvitationSchema,
  MpReceiptLineSchema,
  MpReceiptTaxesSchema,
  MpReliabilitySchema,
  MpServiceFitSchema,
  MpServiceNeedsInputSchema,
  MpServiceNeedsSchema,
} from "./marketplace-confidence";
import {
  MP_GUEST_TRIP_STATUSES,
  MpDriverPassengerSchema,
  MpGuestTripActionsSchema,
  MpGuestTripEtaSchema,
  MpGuestTripSupportSchema,
  MpGuestTripVerificationSchema,
  MpPassengerInputSchema,
  MpRequestPassengerSchema,
} from "./marketplace-guest";
import { CurrencySchema, MoneySchema } from "./money";
import {
  MP_ADVANCE_BOOKING_STATES,
  MP_AMENDMENT_STATES,
  MP_AWARD_STATES,
  MP_BID_STATES,
  MP_BUSINESS_BOOKING_STATES,
  MP_CLAIM_STATES,
  MP_HOLD_STATES,
  MP_RECURRING_TEMPLATE_STATES,
  MP_REQUEST_STATES,
  MP_SCHEDULED_REQUEST_STATES,
} from "./state-machines";

export const MP_SERVICES = ["ride", "delivery"] as const;
export type MpService = (typeof MP_SERVICES)[number];
export const MpServiceSchema = z.enum(MP_SERVICES);

/** Which capacity slot a bid/claim is for (one current + at most one next). */
export const MP_SLOTS = ["current", "next"] as const;
export type MpSlot = (typeof MP_SLOTS)[number];
export const MpSlotSchema = z.enum(MP_SLOTS);

/**
 * What a BID (and the award it becomes) is for: one of the live capacity
 * slots, or `advance` — a future pickup window on the driver's booking
 * calendar (A03), which never occupies the live current/next slots until
 * activation near pickup. Claims stay `MpSlotSchema`.
 */
export const MP_BID_SLOTS = [...MP_SLOTS, "advance"] as const;
export type MpBidSlot = (typeof MP_BID_SLOTS)[number];
export const MpBidSlotSchema = z.enum(MP_BID_SLOTS);

// ── Book for Later: pickup time shapes (A03) ──────────────────────────────

/** A calendar date in the pickup's local timezone, `YYYY-MM-DD`. */
export const MpLocalDateSchema = z
  .string()
  .regex(
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
    "expected YYYY-MM-DD",
  );

/** A wall-clock time in the pickup's local timezone, `HH:MM` (24h). */
export const MpLocalTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM (24-hour)");

/**
 * How a local time that a daylight-saving change makes ambiguous resolves.
 * `compatible` (the default) moves a time inside a spring-forward GAP forward
 * by the gap and takes the EARLIER instant of a fall-back OVERLAP; `earlier`
 * / `later` pick explicitly; `reject` refuses both with validation_failed so
 * the rider chooses. The resolution applied is always reported back.
 */
export const MP_DST_DISAMBIGUATIONS = [
  "compatible",
  "earlier",
  "later",
  "reject",
] as const;
export const MP_DST_RESOLUTIONS = [
  "exact",
  "gap_shifted_forward",
  "gap_shifted_backward",
  "overlap_earlier",
  "overlap_later",
] as const;
export type MpDstResolution = (typeof MP_DST_RESOLUTIONS)[number];

/**
 * A requested pickup time: local date + local time + IANA timezone, plus the
 * pickup window length. The server computes and stores the UTC instant; a
 * client never sends one.
 */
export const MpPickupScheduleInputSchema = z
  .object({
    localDate: MpLocalDateSchema,
    localTime: MpLocalTimeSchema,
    /** IANA timezone, e.g. "Africa/Lagos"; the city's when omitted. */
    timeZone: z.string().min(1).optional(),
    /** Pickup window length; bounded by the market's scheduling policy. */
    windowMinutes: z.number().int().positive().optional(),
    dstDisambiguation: z.enum(MP_DST_DISAMBIGUATIONS).optional(),
  })
  .strict();
export type MpPickupScheduleInput = z.infer<typeof MpPickupScheduleInputSchema>;

/** A stored pickup time as the server resolved it. */
export const MpPickupScheduleSchema = z.object({
  localDate: MpLocalDateSchema,
  localTime: MpLocalTimeSchema,
  timeZone: z.string().min(1),
  /** The UTC offset in force at the pickup instant, e.g. "+01:00". */
  utcOffset: z.string().min(1),
  dstResolution: z.enum(MP_DST_RESOLUTIONS),
  /** The resolved pickup instant (= windowStart). */
  pickupAt: z.string().datetime({ offset: true }),
  windowStart: z.string().datetime({ offset: true }),
  windowEnd: z.string().datetime({ offset: true }),
  windowMinutes: z.number().int().positive(),
  /** Server-phrased local label, e.g. "Sun 8 Mar 2026, 03:30 (UTC-04:00)". */
  label: z.string().min(1),
});
export type MpPickupSchedule = z.infer<typeof MpPickupScheduleSchema>;

/**
 * The future-booking block on a request, feed card or driver view. `advance`
 * requests take offers now for the future window; `scheduled` requests are
 * published scheduled intents (an ordinary immediate market by then). The
 * notice always says whether a driver is secured — before an award, never.
 */
export const MpRequestBookingSchema = z.object({
  kind: z.enum(["scheduled", "advance"]),
  schedule: MpPickupScheduleSchema,
  scheduledRequestId: z.string().min(1).nullable(),
  driverSecured: z.boolean(),
  notice: z.string().min(1),
});
export type MpRequestBooking = z.infer<typeof MpRequestBookingSchema>;

/**
 * What an advance bid commits the driver's wallet to (explained BEFORE the
 * bid on the driver view, and restated on the bid): the 10% commission held
 * from the cleared balance while the offer stands, captured ONCE at the
 * requester's advance award, never charged again at activation, and returned
 * with a linked reversal if the booking fails or is cancelled.
 */
export const MpAdvanceCommitmentSchema = z.object({
  commissionMinor: MoneySchema,
  heldFrom: z.literal("cleared_balance"),
  capturedAt: z.literal("advance_award"),
  chargedAgainAtActivation: z.literal(false),
  holdExpiresAt: z.string().datetime({ offset: true }).nullable(),
  pickupWindowStart: z.string().datetime({ offset: true }),
  pickupWindowEnd: z.string().datetime({ offset: true }),
  terms: z.array(z.string().min(1)).min(1),
});
export type MpAdvanceCommitment = z.infer<typeof MpAdvanceCommitmentSchema>;

// ── Multiple stops (A02) ───────────────────────────────────────────────────

/**
 * What an intermediate stop is for. It tells the awarded driver what to
 * expect; it never changes the price — expected dwell does.
 */
export const MP_STOP_PURPOSES = [
  "pickup_passenger",
  "drop_passenger",
  "errand",
  "other",
] as const;
export type MpStopPurpose = (typeof MP_STOP_PURPOSES)[number];
export const MpStopPurposeSchema = z.enum(MP_STOP_PURPOSES);

/**
 * Per-market multi-stop limits. Optional inside a market's marketplace policy
 * (absent ⇒ `MP_MULTI_STOP_PILOT_DEFAULTS`); the capability itself stays behind
 * the deny-by-default `marketplace_multi_stop` flag, rides only.
 */
/**
 * Paid waiting at a stop (A02 item 7), optional inside the stops block. The
 * included allowance at each stop is the expected dwell the fare already
 * priced; past it each started minute costs `perMinMinor`, up to the waiting
 * cost the rider authorizes up front per trip (`maxAuthorizedMinor`; each
 * explicit rider approval extends the cap by one more increment). A stop
 * whose total wait reaches `excessiveAfterSec` is excessive and the driver
 * may leave it. Absent: waiting past the allowance is never charged.
 */
export const MpStopPaidWaitingPolicySchema = z.object({
  perMinMinor: z.number().int().nonnegative(),
  maxAuthorizedMinor: z.number().int().nonnegative(),
  excessiveAfterSec: z.number().int().positive(),
});
export type MpStopPaidWaitingPolicy = z.infer<
  typeof MpStopPaidWaitingPolicySchema
>;

export const MpMultiStopPolicySchema = z
  .object({
    /** Intermediate stops a request may carry (0 disables them structurally). */
    maxIntermediateStops: z.number().int().min(0).max(10),
    /** Expected dwell applied when the requester names none. */
    defaultDwellSec: z.number().int().nonnegative(),
    /** The most expected dwell one stop may declare (priced as route time). */
    maxDwellSec: z.number().int().nonnegative(),
    /** Paid stop waiting (absent: none). */
    paidWaiting: MpStopPaidWaitingPolicySchema.optional(),
    /**
     * How long a post-award amendment waits for both approvals before it
     * expires and releases what it reserved (absent: the pilot default).
     */
    amendmentApprovalSec: z.number().int().positive().optional(),
  })
  .refine((policy) => policy.defaultDwellSec <= policy.maxDwellSec, {
    message: "defaultDwellSec must not exceed maxDwellSec",
    path: ["defaultDwellSec"],
  });
export type MpMultiStopPolicy = z.infer<typeof MpMultiStopPolicySchema>;

/** The addendum's pilot product choice: up to three intermediate stops. */
export const MP_MULTI_STOP_PILOT_DEFAULTS: MpMultiStopPolicy = Object.freeze({
  maxIntermediateStops: 3,
  defaultDwellSec: 120,
  maxDwellSec: 600,
});

/**
 * One intermediate stop as a requester asks for it, in pickup → dropoff order.
 * No id, no order, no price: the server assigns the stable id, the array
 * position is the order, and the complete ordered route is priced server-side.
 * Sent to `GET /v1/mp/quote` as the JSON-encoded `stops` query parameter (see
 * `mpQuoteStopsParam`); unknown keys are refused.
 */
export const MpStopInputSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    label: z.string().max(80).optional(),
    /** Defaults to "other". */
    purpose: MpStopPurposeSchema.optional(),
    /** Defaults to the market's defaultDwellSec; bounded by its maxDwellSec. */
    dwellSec: z.number().int().nonnegative().optional(),
  })
  .strict();
export type MpStopInput = z.infer<typeof MpStopInputSchema>;

/**
 * One ordered stop as the requester's own quote/request carries it. `stopId`
 * is server-assigned and stable from the quote through the request (and any
 * pre-award route revision that keeps the stop) to the execution ride.
 */
export const MpRouteStopSchema = z.object({
  stopId: z.string().min(1),
  /** 1-based position between pickup and dropoff. */
  order: z.number().int().min(1),
  label: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  purpose: MpStopPurposeSchema,
  dwellSec: z.number().int().nonnegative(),
});
export type MpRouteStop = z.infer<typeof MpRouteStopSchema>;

/**
 * A stop as a driver may see it BEFORE an award: coarsened exactly like the
 * pickup/dropoff area labels — never a coordinate, never the requester's words.
 */
export const MpFeedStopSchema = z.object({
  order: z.number().int().min(1),
  areaLabel: z.string().min(1),
  purpose: MpStopPurposeSchema,
  dwellSec: z.number().int().nonnegative(),
});
export type MpFeedStop = z.infer<typeof MpFeedStopSchema>;

/** Driver-card route summary for a multi-stop request (absent for plain routes). */
export const MpFeedRouteSchema = z.object({
  stopCount: z.number().int().min(1),
  stops: z.array(MpFeedStopSchema).min(1),
  /** The complete ordered route's server-measured metres/seconds. */
  routedDistanceMeters: z.number().int().nonnegative(),
  routedDurationSec: z.number().int().nonnegative(),
  /** Total expected dwell at the stops (priced as route time). */
  stopsDwellSec: z.number().int().nonnegative(),
});
export type MpFeedRoute = z.infer<typeof MpFeedRouteSchema>;

/**
 * Encodes stops for `GET /v1/mp/quote?stops=…` (URL-encode the result). The
 * input is validated first, so a client can never send a key the server
 * refuses — and never a stop id or a price.
 */
export function mpQuoteStopsParam(stops: readonly MpStopInput[]): string {
  return JSON.stringify(stops.map((stop) => MpStopInputSchema.parse(stop)));
}

// ── Quote envelope (R02) ────────────────────────────────────────────────────

/**
 * The organization's ADVISORY verdict at the quote's suggested fare
 * (payment-service `/policy-check`). `refused` names every reason; an
 * unanswered check is `unavailable`, never `allowed`. The budget is reserved
 * only at selection, when everything is decided again atomically. Members
 * only: a caller who may not book on the organization gets 403 forbidden
 * `booker_not_authorized` instead — the very answer for no organization at
 * all, so an outsider learns nothing of its status, policy or budget.
 */
export const MpBusinessQuoteCheckSchema = z.object({
  organizationId: z.string().min(1),
  status: z.enum(["allowed", "refused", "unavailable"]),
  reasons: z.array(z.string().min(1)),
  checkedAmountMinor: MoneySchema,
  available: MoneySchema.nullable(),
  costCentreId: z.string().min(1).nullable(),
  policyVersion: z.number().int().min(1).nullable(),
  note: z.string().min(1),
});
export type MpBusinessQuoteCheck = z.infer<typeof MpBusinessQuoteCheckSchema>;

/**
 * Returned by `GET /v1/mp/quote`. Wraps the signed platform quote with the
 * negotiation bounds. The signed payload itself is never editable; the
 * requester's amount is validated separately against these bounds.
 */
export const MpQuoteEnvelopeSchema = z.object({
  quoteId: z.string().min(1),
  service: MpServiceSchema,
  vehicleClass: z.string().min(1),
  cityId: z.string().min(1),
  currency: CurrencySchema,
  suggestedFareMinor: MoneySchema,
  minimumFareMinor: MoneySchema,
  maximumFareMinor: MoneySchema,
  expiresAt: z.string().datetime({ offset: true }),
  pricingVersion: z.string().min(1),
  policyVersion: z.number().int().positive(),
  breakdown: z.array(
    z.object({ label: z.string().min(1), amountMinor: MoneySchema }),
  ),
  /** Routed service metres/seconds — profile calculations reuse these. */
  routedDistanceMeters: z.number().int().nonnegative(),
  routedDurationSec: z.number().int().nonnegative(),
  /**
   * Multi-stop envelopes only (absent for a plain pickup → dropoff quote): the
   * ordered stops the COMPLETE route was measured and priced through (the
   * routed metres/seconds above include every leg), their total expected
   * dwell (priced as route time — see the "Stop waiting" breakdown row), and
   * the fingerprint of the exact route the bounds belong to. A request
   * published from this quote carries these very stops; the publish body
   * cannot restate them.
   */
  stops: z.array(MpRouteStopSchema).optional(),
  stopsDwellSec: z.number().int().nonnegative().optional(),
  routeFingerprint: z.string().min(1).optional(),
  /**
   * A06 part C (`business_travel`): present only when the quote named an
   * `organizationId` (query; with optional `costCentreId`, `travellerId`).
   */
  business: MpBusinessQuoteCheckSchema.optional(),
});
export type MpQuoteEnvelope = z.infer<typeof MpQuoteEnvelopeSchema>;

// ── Business bookings (A06 part C, `business_travel`) ──────────────────────

/**
 * `business` on `POST /v1/mp/requests` (rides only): book the ride on an
 * organization. The organization's budget pays INSTEAD OF the rider (the
 * publish names `paymentMethodId: "business"`; no rider funding exists for
 * the trip — never both). The requester is the BOOKER; `travellerId`
 * (default: the requester) is the passenger, an active member — a colleague
 * is ALSO named as the request's guest `passenger` (trip link, first-name
 * driver card). The organization's policy and budget are checked at the
 * requested fare; a refusal answers its `details.reason`
 * (BUSINESS_REFUSAL_REASONS) and nothing is written.
 */
export const MpBusinessBookingInputSchema = z
  .object({
    organizationId: z.string().min(1).max(64),
    costCentreId: z.string().min(1).max(64).optional(),
    expenseCategory: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9 ._-]+$/)
      .optional(),
    travellerId: z.string().uuid().optional(),
  })
  .strict();
export type MpBusinessBookingInput = z.infer<
  typeof MpBusinessBookingInputSchema
>;

/** Where an award's organization-budget funding stands (mpBusinessBooking). */
export const MpBusinessFundingSchema = z.object({
  state: z.enum(MP_BUSINESS_BOOKING_STATES),
  reservedMinor: MoneySchema,
  committedMinor: MoneySchema.nullable(),
  refusalReason: z.string().min(1).nullable(),
  releasedBy: z.string().min(1).nullable(),
});

/**
 * The requester's `business` block on their own request view. Never on any
 * driver surface: the driver learns nothing about the organization.
 */
export const MpRequestBusinessSchema = z.object({
  organizationId: z.string().min(1),
  costCentreId: z.string().min(1).nullable(),
  expenseCategory: z.string().min(1).nullable(),
  bookerId: z.string().min(1),
  travellerId: z.string().min(1),
  payerRole: z.literal("organization"),
  /** Null until an offer is selected (the budget is reserved at award). */
  funding: MpBusinessFundingSchema.nullable(),
});
export type MpRequestBusiness = z.infer<typeof MpRequestBusinessSchema>;

// ── Request ────────────────────────────────────────────────────────────────

export const MP_REQUEST_CLOSE_REASONS = [
  "awarded",
  "cancelled",
  "expired",
  "no_offers",
  // The assigned driver cancelled the execution: the request stays in its
  // terminal state and only an explicit new request starts a new search.
  "driver_cancelled",
  // The award saga abandoned the selection after the winner was chosen
  // (e.g. rider funding refused, execution creation blocked): the request is
  // closed by compensateAward. Present in the registry because the server
  // already emits it and request views serialize closeReason through it.
  "award_failed",
  // An advance reservation (A03) failed before activation — driver withdrew
  // or lost eligibility, reconfirmation or rider funding missed its deadline.
  // The booking view explains the financial outcome and the rematch option.
  "booking_failed",
  // A preferred-driver request (A04 item 3) whose named driver did not offer
  // in the exclusive window, and whose rider did not consent to open-market
  // fallback: expired free of charge. (Whether the driver declined or simply
  // did not answer is deliberately not said.)
  "preferred_driver_unavailable",
  // A guest passenger (A06 part B) declined the trip through their trip link
  // before pickup: free for the requester, the driver's commission returned.
  "passenger_declined",
] as const;
export type MpRequestCloseReason = (typeof MP_REQUEST_CLOSE_REASONS)[number];

/** Privacy-safe area reference: label + coarse centroid, never a house number. */
export const MpAreaSchema = z.object({
  label: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
});

export const MpDeliveryDetailsSchema = z.object({
  weightKg: z.number().positive(),
  lengthCm: z.number().positive().optional(),
  widthCm: z.number().positive().optional(),
  heightCm: z.number().positive().optional(),
  handling: z.array(z.string()).default([]),
});
export type MpDeliveryDetails = z.infer<typeof MpDeliveryDetailsSchema>;

export const MpSearchEnvelopeSchema = z.object({
  step: z.number().int().min(0),
  radiusMeters: z.number().int().positive(),
  pickupEtaSec: z.number().int().positive(),
});
export type MpSearchEnvelope = z.infer<typeof MpSearchEnvelopeSchema>;

/** `POST /v1/mp/requests` body. */
export const MpPublishRequestSchema = z.object({
  quoteId: z.string().min(1),
  requestedFareMinor: MoneySchema,
  paymentMethodId: z.string().min(1),
  delivery: MpDeliveryDetailsSchema.optional(),
  /**
   * A04 item 3 (marketplace_preferred_drivers): ask a saved driver first,
   * with the rider's explicit open-market fallback consent. Rides only.
   */
  preferredDriver: MpPreferredDriverInputSchema.optional(),
  /**
   * A06 part D (marketplace_accessibility_requirements): concrete
   * requirements (verified capability only) and soft preferences. Rides only.
   */
  serviceNeeds: MpServiceNeedsInputSchema.optional(),
  /**
   * A06 part B (marketplace_guest_bookings): book the ride for another named
   * ADULT, with the requester's attestation of their age and consent. The
   * requester stays the payer. Rides only.
   */
  passenger: MpPassengerInputSchema.optional(),
  /**
   * A06 part C (business_travel): book the ride on an organization — its
   * budget pays (`paymentMethodId: "business"`), never the rider. Rides only.
   */
  business: MpBusinessBookingInputSchema.optional(),
});
export type MpPublishRequest = z.infer<typeof MpPublishRequestSchema>;

/**
 * Owner view of a request. `revision` bumps on EVERY price- or route-affecting
 * edit and is what bids are pinned to; `routeRevision` bumps only when an edit
 * changed the stop set (a replacement quote with different stops on
 * `POST /v1/mp/requests/:id/revise`).
 */
export const MpRequestSchema = z.object({
  requestId: z.string().min(1),
  state: z.enum(MP_REQUEST_STATES),
  revision: z.number().int().min(1),
  version: z.number().int().min(1),
  service: MpServiceSchema,
  vehicleClass: z.string().min(1),
  cityId: z.string().min(1),
  currency: CurrencySchema,
  requesterId: z.string().min(1),
  quoteId: z.string().min(1),
  requestedFareMinor: MoneySchema,
  suggestedFareMinor: MoneySchema,
  minimumFareMinor: MoneySchema,
  maximumFareMinor: MoneySchema,
  pickup: MpAreaSchema,
  dropoff: MpAreaSchema,
  delivery: MpDeliveryDetailsSchema.nullable(),
  searchEnvelope: MpSearchEnvelopeSchema,
  policyVersion: z.number().int().positive(),
  pricingVersion: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true }),
  closeReason: z.enum(MP_REQUEST_CLOSE_REASONS).nullable(),
  /**
   * Present only for a request that carries (or carried) intermediate stops;
   * a plain request renders exactly as before. `stops` absent ⇒ none.
   */
  stops: z.array(MpRouteStopSchema).optional(),
  routeRevision: z.number().int().min(1).optional(),
  routeFingerprint: z.string().min(1).optional(),
  /** A03: present only on a scheduled or advance-booking request. */
  booking: MpRequestBookingSchema.optional(),
  /** A04 item 3: present only on a request that named a saved driver. */
  preferredDriver: MpPreferredDriverSchema.optional(),
  /** A06 part D: present only when the requester stated needs. */
  serviceNeeds: MpServiceNeedsSchema.optional(),
  /**
   * A06 part B: present only on the REQUESTER's view of a request booked for
   * another adult — the passenger on this request, never on any other.
   */
  passenger: MpRequestPassengerSchema.optional(),
  /**
   * A06 part C: present only on the REQUESTER's view of a request booked on
   * an organization.
   */
  business: MpRequestBusinessSchema.optional(),
});
export type MpRequest = z.infer<typeof MpRequestSchema>;

// ── Bids ───────────────────────────────────────────────────────────────────

/** `POST /v1/mp/bids` body. Slot intent is recorded at creation (M05A). */
export const MpSubmitBidSchema = z.object({
  requestId: z.string().min(1),
  /** The revision the driver saw; a newer revision rejects with version_conflict. */
  requestRevision: z.number().int().min(1),
  amountMinor: MoneySchema,
  /** `advance` only on an advance-reservation request (A03). */
  slot: MpBidSlotSchema,
  /** Required when slot === "next": the current job this bid depends on. */
  dependsOnClaimId: z.string().min(1).optional(),
  /** Availability epoch from the eligibility evaluation the driver acted on. */
  availabilityEpoch: z.number().int().min(0),
  /** Set when the amount came from the driver's rate profile calculation. */
  rateProfileVersion: z.number().int().positive().optional(),
});
export type MpSubmitBid = z.infer<typeof MpSubmitBidSchema>;

/** Driver's own bid (D03). Carries the money the driver needs to see, only theirs. */
export const MpBidSchema = z.object({
  bidId: z.string().min(1),
  requestId: z.string().min(1),
  requestRevision: z.number().int().min(1),
  bidVersion: z.number().int().min(1),
  state: z.enum(MP_BID_STATES),
  driverId: z.string().min(1),
  amountMinor: MoneySchema,
  commissionMinor: MoneySchema,
  netMinor: MoneySchema,
  slot: MpBidSlotSchema,
  dependsOnClaimId: z.string().min(1).nullable(),
  reservationId: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true }),
  /**
   * Advance bids only (A03): the wallet commitment the driver takes on — the
   * 10% held from the cleared balance now, captured ONCE if the requester
   * selects this offer, never charged again at activation.
   */
  advanceCommitment: MpAdvanceCommitmentSchema.optional(),
});
export type MpBid = z.infer<typeof MpBidSchema>;

/**
 * Rider-facing driver display (G09). Verified driver identity — names, plates,
 * photos and the rating/trip history — lives in user-service; ride-service
 * resolves it through its driver-profile port (A06 part A; see
 * docs/marketplace/DRIVER_IDENTITY.md).
 *
 * `profileStatus` is the honesty gate. It is "verified" only when user-service
 * returned a card whose verification status is "verified", and then the fields
 * carry that card's values (`rating` is its average; `completedTrips` its real
 * count). Otherwise it is "unavailable": `displayName` is a stable pseudonym
 * (never a claimed real name), `rating` is the "–" no-value marker and
 * `completedTrips` a placeholder 0 — none of which a client may present as a
 * real, verified figure. `vehicle` IS server-verified: it is the class the
 * driver is eligible for and bidding on. These legacy fields stay
 * non-nullable for the apps that read them; the nullable, structured card
 * (with the rating COUNT) is `MpOffer.driverProfile`.
 *
 * The offer, winner (post-selection) and queue projections all derive this from
 * the SAME server function, so a driver never renders inconsistently.
 */
export const MpOfferDriverSchema = z.object({
  displayName: z.string().min(1),
  initials: z.string().min(1),
  rating: z.string().min(1),
  completedTrips: z.number().int().nonnegative(),
  vehicle: z.string().min(1),
  plateMasked: z.string().min(1),
  /** Whether a verified user-service profile backs the identity/rating fields. */
  profileStatus: z.enum(["verified", "unavailable"]),
});
export type MpOfferDriver = z.infer<typeof MpOfferDriverSchema>;

/**
 * Rider-facing offer view (R04/R05). Deliberately excludes anything that would
 * leak rival bids; deltas and pickup labels are server-phrased strings.
 */
export const MpOfferSchema = z.object({
  bidId: z.string().min(1),
  bidVersion: z.number().int().min(1),
  requestRevision: z.number().int().min(1),
  amountMinor: MoneySchema,
  kind: z.enum(["immediate", "finishing_trip"]),
  driver: MpOfferDriverSchema,
  /** "Pickup in 4 min · 1.2 km away" or "Pickup window 12–18 min". */
  pickupLabel: z.string().min(1),
  pickupWindow: z
    .object({
      earliestSec: z.number().int().nonnegative(),
      latestSec: z.number().int().nonnegative(),
      etaVersion: z.number().int().min(1),
    })
    .nullable(),
  expiresAt: z.string().datetime({ offset: true }),
  withdrawn: z.boolean(),
  /** Disclosed criteria when the server recommends this offer; never sponsored. */
  whyRecommended: z.string().nullable(),
  /**
   * Server-computed rider-side booking fee, when the market charges one. The
   * marketplace adds none on top of the offered fare, so ride-service states
   * an explicit zero.
   */
  bookingFeeMinor: MoneySchema.nullable().optional(),
  /** Server-computed total the rider pays for this offer. */
  totalMinor: MoneySchema.nullable().optional(),
  /** Server-phrased comparison to the requested amount (e.g. "+₦200"). */
  deltaLabel: z.string().nullable().optional(),
  // ── Offer comparison (A06 part A). Absent only from servers predating it;
  // a client then shows none of it, never a figure of its own.
  /** "You pay ₦…" — the total, phrased by the server. */
  totalLabel: z.string().min(1).optional(),
  /** What the total includes (no fee on top; paid waiting only if approved). */
  totalNote: z.string().min(1).optional(),
  pickupEstimate: MpOfferPickupEstimateSchema.optional(),
  vehicle: MpOfferVehicleSchema.optional(),
  driverProfile: MpOfferDriverProfileSchema.optional(),
  reliability: MpReliabilitySchema.optional(),
  serviceFit: MpServiceFitSchema.optional(),
  /** Reasoned badges ("Lowest total of 3 offers"); never "recommended". */
  badges: z.array(MpCriterionSchema).optional(),
});
export type MpOffer = z.infer<typeof MpOfferSchema>;

/**
 * A03: an offer on an advance-booking request — a driver's bid on a FUTURE
 * pickup window, not transport now. The request snapshot lists these under
 * `advanceOffers`, never under `offers`, so a client that only knows the live
 * offer kinds can never render one as a live pickup. `pickupLabel` names the
 * booked window; there is no live ETA (`pickupWindow` is null).
 */
export const MpAdvanceOfferSchema = MpOfferSchema.extend({
  kind: z.literal("advance_booking"),
});
export type MpAdvanceOffer = z.infer<typeof MpAdvanceOfferSchema>;

/** `POST /v1/mp/requests/:id/select` — acceptance pins both versions (M05). */
export const MpSelectBidSchema = z.object({
  bidId: z.string().min(1),
  requestVersion: z.number().int().min(1),
  bidVersion: z.number().int().min(1),
  /** Required for finishing-trip winners: explicit pickup-window consent. */
  pickupWindowConsent: z
    .object({ etaVersion: z.number().int().min(1), accepted: z.literal(true) })
    .optional(),
});
export type MpSelectBid = z.infer<typeof MpSelectBidSchema>;

// ── Eligibility (M03A) ─────────────────────────────────────────────────────

/**
 * Machine-readable reason codes from the single server-owned evaluator.
 * The driver app renders these verbatim next to a human title/detail (D10);
 * it never computes eligibility locally.
 */
export const MP_ELIGIBILITY_REASONS = [
  "OUTSIDE_RADIUS",
  "PICKUP_ETA_TOO_LONG",
  "LOCATION_STALE",
  "LOCATION_INACCURATE",
  "NOT_STATIONARY",
  "NOT_NEAR_COMPLETION",
  "WRONG_DIRECTION",
  "SLOT_FULL",
  "QUEUE_DISABLED",
  "UNSUPPORTED_CAPABILITY",
  "ACCOUNT_NOT_ELIGIBLE",
  "OFFLINE",
  "INSUFFICIENT_SPENDABLE",
  "ROUTING_UNAVAILABLE",
  // Advance reservations (A03): the pickup window (plus the routed trip,
  // uncertainty buffers and the travel from/to the neighbouring bookings)
  // collides with the driver's booking calendar; or advance bidding is off.
  "CALENDAR_CONFLICT",
  "ADVANCE_DISABLED",
  // A06 part D: the request states a service requirement (e.g. a
  // wheelchair-accessible vehicle) this driver is not VERIFIED to meet.
  "SERVICE_NEED_UNVERIFIED",
] as const;
export type MpEligibilityReason = (typeof MP_ELIGIBILITY_REASONS)[number];

export const MpEligibilityReasonSchema = z.object({
  code: z.enum(MP_ELIGIBILITY_REASONS),
  title: z.string().min(1),
  detail: z.string().min(1),
});

/**
 * What an eligible driver's predicted pickup was measured with: the routed
 * leg (immediate branch), or remaining service + completion buffer + the
 * post-dropoff leg + uncertainty buffer (finishing-trip branch).
 */
export const MP_PREDICTED_PICKUP_BASES = [
  "routed_leg",
  "finishing_trip_prediction",
] as const;

export const MpEligibilitySchema = z.object({
  eligible: z.boolean(),
  slot: MpBidSlotSchema.nullable(),
  reasons: z.array(MpEligibilityReasonSchema),
  policyVersion: z.number().int().positive(),
  availabilityEpoch: z.number().int().min(0),
  evaluatedAt: z.string().datetime({ offset: true }),
  /**
   * A04.1: the server's time-until-pickup ESTIMATE for an eligible driver,
   * rounded up to the whole minute (so repeated reads cannot triangulate the
   * pickup); null when not eligible. Absent from servers predating A04.
   */
  predictedPickupSec: z.number().int().nonnegative().nullable().optional(),
  predictedPickupBasis: z.enum(MP_PREDICTED_PICKUP_BASES).nullable().optional(),
});
export type MpEligibility = z.infer<typeof MpEligibilitySchema>;

// ── Earnings breakdown (A04.1) ─────────────────────────────────────────────

/**
 * The disclosed fleet share of a fare. No fleet arrangement applies to
 * marketplace jobs today, so the only status is an explicit `none` with a
 * NULL amount and the reason — never a fabricated number (a fleet split, when
 * it lands, extends this union).
 */
export const MpFleetRemittanceSchema = z.object({
  status: z.literal("none"),
  amountMinor: z.null(),
  reason: z.string().min(1),
});
export type MpFleetRemittance = z.infer<typeof MpFleetRemittanceSchema>;

/**
 * The UNPAID drive to the pickup. Always an estimate; distance coarsened to
 * 100 m and time rounded up to the minute pre-award. Null (with basis
 * `unavailable`) when the server has no location to measure from.
 */
export const MpPickupEstimateSchema = z.object({
  distanceMeters: z.number().int().nonnegative().nullable(),
  distanceBasis: z.enum(["routed", "straight_line", "unavailable"]),
  durationSec: z.number().int().nonnegative().nullable(),
  durationBasis: z.enum([
    "routed_leg",
    "straight_line_estimate",
    "unavailable",
  ]),
  estimate: z.literal(true),
  paid: z.literal(false),
  /** Server-phrased, e.g. "Unpaid pickup · 1.2 km · ~3 min (estimate)". */
  label: z.string().min(1),
});
export type MpPickupEstimate = z.infer<typeof MpPickupEstimateSchema>;

/**
 * The trip the fare pays for: the complete ordered route the request was
 * priced on (every leg through every stop) and the expected stop waiting.
 */
export const MpPaidRouteSchema = z.object({
  distanceMeters: z.number().int().positive(),
  durationSec: z.number().int().nonnegative(),
  stopCount: z.number().int().nonnegative(),
  stopsWaitingSec: z.number().int().nonnegative(),
  /** The durations are router estimates; the fare itself is fixed. */
  estimate: z.literal(true),
  label: z.string().min(1),
  waitingLabel: z.string().min(1),
});
export type MpPaidRoute = z.infer<typeof MpPaidRouteSchema>;

/** Estimated net per hour of the job's own time, with its inputs. */
export const MpNetPerHourSchema = z.object({
  amountMinor: MoneySchema,
  estimate: z.literal(true),
  /** pickup + paid route + expected stop waiting, in the figures shown. */
  basisSec: z.number().int().positive(),
  basis: z.string().min(1),
});
export type MpNetPerHour = z.infer<typeof MpNetPerHourSchema>;

/**
 * Server-composed earnings breakdown on every driver feed card (at the
 * requester's fare) and every preset (at the preset's amount). commission is
 * the server's `commissionMinorFor(gross)`; estimatedNet = gross − commission
 * − fleet remittance. The client renders these fields and labels; it never
 * derives a fee, a net or a rate. No fuel/energy figure exists because no
 * such input is disclosed (`runningCosts.status: "not_estimated"`).
 */
export const MpEarningsBreakdownSchema = z.object({
  grossMinor: MoneySchema,
  grossBasis: z.enum(["requested_fare", "preset_amount"]),
  commissionMinor: MoneySchema,
  commissionBps: z.literal(1_000),
  fleetRemittance: MpFleetRemittanceSchema,
  estimatedNetMinor: MoneySchema,
  pickup: MpPickupEstimateSchema,
  /** Null only for a request stored before route metrics existed. */
  route: MpPaidRouteSchema.nullable(),
  /** Null whenever any time input (e.g. the pickup) is unknown. */
  estimatedNetPerHour: MpNetPerHourSchema.nullable(),
  runningCosts: z.object({
    status: z.literal("not_estimated"),
    reason: z.string().min(1),
  }),
  disclaimer: z.string().min(1),
});
export type MpEarningsBreakdown = z.infer<typeof MpEarningsBreakdownSchema>;

// ── Presets (D02) ──────────────────────────────────────────────────────────

/**
 * Server-generated quick offers: deduplicated, in-bounds, affordability-checked
 * against the driver's spendable balance. The client renders; it never derives
 * fee or net from the gross.
 */
export const MpPresetSchema = z.object({
  key: z.string().min(1),
  amountMinor: MoneySchema,
  commissionMinor: MoneySchema,
  netMinor: MoneySchema,
  title: z.string().min(1),
  feeNetLabel: z.string().min(1),
  affordable: z.boolean(),
  shortfallMinor: MoneySchema.nullable(),
  shortfallLabel: z.string().nullable(),
  emphasized: z.boolean(),
  /**
   * `preference_minimum` (A04.2): the driver's minimum trip amount, suggested
   * when the request asks less but its maximum can pay it. A suggestion —
   * nothing is ever bid automatically.
   */
  source: z.enum([
    "requested",
    "lower",
    "higher",
    "rate_profile",
    "preference_minimum",
  ]),
  /** A04.1: the breakdown at this preset's amount. */
  earnings: MpEarningsBreakdownSchema.optional(),
});
export type MpPreset = z.infer<typeof MpPresetSchema>;

// ── Wallet reservation / commission receipt (M04) ─────────────────────────

export const MpWalletHoldSchema = z.object({
  reservationId: z.string().min(1),
  bidId: z.string().min(1),
  driverId: z.string().min(1),
  state: z.enum(MP_HOLD_STATES),
  amountMinor: MoneySchema,
  /** Snapshot of rate, base and rounding rule at reservation time. */
  commissionBps: z.literal(1_000),
  baseMinor: MoneySchema,
  roundingRule: z.literal("half_up"),
  policyVersion: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
  releasedAt: z.string().datetime({ offset: true }).nullable(),
  capturedAt: z.string().datetime({ offset: true }).nullable(),
  /** The request the funded bid belongs to and, once selected, its award. */
  requestRef: z.string().nullable().optional(),
  awardRef: z.string().nullable().optional(),
});
export type MpWalletHold = z.infer<typeof MpWalletHoldSchema>;

/** Driver wallet overview (D04): one server-computed spendable, everywhere. */
export const MpWalletOverviewSchema = z.object({
  clearedMinor: MoneySchema,
  heldMinor: MoneySchema,
  spendableMinor: MoneySchema,
  holds: z.array(MpWalletHoldSchema),
});
export type MpWalletOverview = z.infer<typeof MpWalletOverviewSchema>;

export const MpCommissionReceiptSchema = z.object({
  receiptId: z.string().min(1),
  awardId: z.string().min(1),
  bidId: z.string().min(1),
  driverId: z.string().min(1),
  fareMinor: MoneySchema,
  commissionMinor: MoneySchema,
  commissionBps: z.literal(1_000),
  roundingRule: z.literal("half_up"),
  journalEntryId: z.string().min(1),
  capturedAt: z.string().datetime({ offset: true }),
});
export type MpCommissionReceipt = z.infer<typeof MpCommissionReceiptSchema>;

// ── Award (M05) ────────────────────────────────────────────────────────────

export const MpAwardSchema = z.object({
  awardId: z.string().min(1),
  requestId: z.string().min(1),
  bidId: z.string().min(1),
  state: z.enum(MP_AWARD_STATES),
  requestVersion: z.number().int().min(1),
  bidVersion: z.number().int().min(1),
  driverId: z.string().min(1),
  requesterId: z.string().min(1),
  fareMinor: MoneySchema,
  commissionMinor: MoneySchema,
  slot: MpBidSlotSchema,
  executionRef: z
    .object({ service: MpServiceSchema, id: z.string().min(1) })
    .nullable(),
  createdAt: z.string().datetime({ offset: true }),
  resolvedAt: z.string().datetime({ offset: true }).nullable(),
  /** Human-phrased reason on award.failed; the request reopened if still valid. */
  failReason: z.string().nullable().optional(),
});
export type MpAward = z.infer<typeof MpAwardSchema>;

// ── Driver work claims (M05A) ──────────────────────────────────────────────

/**
 * The shared capacity authority row: one `current` and at most one dependent
 * `next` claim per driver ACROSS rides and deliveries, DB-enforced. Execution
 * services couple their transitions to fenced claim ownership.
 */
export const MpDriverClaimSchema = z.object({
  claimId: z.string().min(1),
  driverId: z.string().min(1),
  state: z.enum(MP_CLAIM_STATES),
  slot: MpSlotSchema,
  service: MpServiceSchema,
  awardId: z.string().min(1).nullable(),
  executionRef: z
    .object({ service: MpServiceSchema, id: z.string().min(1) })
    .nullable(),
  dependsOnClaimId: z.string().min(1).nullable(),
  availabilityEpoch: z.number().int().min(0),
  fencingToken: z.number().int().min(0),
  createdAt: z.string().datetime({ offset: true }),
});
export type MpDriverClaim = z.infer<typeof MpDriverClaimSchema>;

/**
 * `GET /v1/mp/driver/jobs` → `current` / `next` (contract DriverJob): the
 * driver's claim with its award's money, receipt, execution reference and —
 * for the queued job — the pickup window. `requestId` is the award's
 * marketplace request: the key of the trip, stop and amendment routes the
 * driver app opens (absent only for a claim with no award). `passenger` is
 * present only on a trip booked for another adult (A06 part B).
 */
export const MpDriverJobSchema = z.object({
  claimId: z.string().min(1),
  requestId: z.string().min(1).optional(),
  slot: MpSlotSchema,
  service: MpServiceSchema,
  state: z.string().min(1),
  fareMinor: MoneySchema,
  commissionMinor: MoneySchema,
  receiptId: z.string().min(1).optional(),
  executionRef: z
    .object({ service: MpServiceSchema, id: z.string().min(1) })
    .optional(),
  pickupWindow: z
    .object({
      earliestSec: z.number().int(),
      latestSec: z.number().int(),
      etaVersion: z.number().int(),
    })
    .optional(),
  passenger: MpDriverPassengerSchema.optional(),
});
export type MpDriverJob = z.infer<typeof MpDriverJobSchema>;

/** `GET /v1/mp/driver/jobs` (D05 winner card + D11 current-plus-next). */
export const MpDriverJobsSchema = z.object({
  current: MpDriverJobSchema.optional(),
  next: MpDriverJobSchema.optional(),
  promotion: z.enum(["none", "pending", "failed_revalidating"]),
});
export type MpDriverJobs = z.infer<typeof MpDriverJobsSchema>;

// ── Rate profiles (M03A / D09) ─────────────────────────────────────────────

export const MpRateProfileSchema = z.object({
  profileId: z.string().min(1),
  driverId: z.string().min(1),
  version: z.number().int().positive(),
  cityId: z.string().min(1),
  service: MpServiceSchema,
  vehicleClass: z.string().min(1),
  currency: CurrencySchema,
  /** Gross (before the 10% commission), minor units per routed kilometre. */
  perKmMinor: z.number().int().nonnegative(),
  minimumTripFareMinor: z.number().int().nonnegative(),
  /** Optional components stay disabled unless configured AND disclosed. */
  components: z.object({
    perMinuteMinor: z.number().int().nonnegative().nullable(),
    pickupPerKmMinor: z.number().int().nonnegative().nullable(),
    handlingMinor: z.number().int().nonnegative().nullable(),
  }),
  createdAt: z.string().datetime({ offset: true }),
});
export type MpRateProfile = z.infer<typeof MpRateProfileSchema>;

/** `POST /v1/mp/rate-profiles/preview` — the ONLY place example maths happens. */
export const MpRatePreviewRequestSchema = z.object({
  cityId: z.string().min(1),
  service: MpServiceSchema,
  vehicleClass: z.string().min(1),
  perKmMinor: z.number().int().nonnegative(),
  minimumTripFareMinor: z.number().int().nonnegative(),
  /** Example routed distance; production bids use the request's routed metres. */
  exampleDistanceMeters: z.number().int().positive(),
});

export const MpRatePreviewSchema = z.object({
  profileFormulaVersion: z.number().int().positive(),
  grossMinor: MoneySchema,
  commissionMinor: MoneySchema,
  netMinor: MoneySchema,
  floorAdjusted: z.boolean(),
  exceedsCeiling: z.boolean(),
  rows: z.array(
    z.object({
      label: z.string().min(1),
      value: z.string().min(1),
      tone: z.enum(["ok", "errorInk"]).optional(),
    }),
  ),
  disclaimer: z.string().min(1),
});
export type MpRatePreview = z.infer<typeof MpRatePreviewSchema>;

// ── Feed (D01) ─────────────────────────────────────────────────────────────

/** Privacy-limited feed card: areas, distances and money — no exact addresses. */
export const MpFeedItemSchema = z.object({
  requestId: z.string().min(1),
  revision: z.number().int().min(1),
  service: MpServiceSchema,
  title: z.string().min(1),
  meta: z.string().min(1),
  askedMinor: MoneySchema,
  askedByLabel: z.string().min(1),
  capabilityBadge: z.string().nullable(),
  expiresAt: z.string().datetime({ offset: true }),
  /** Multi-stop summary: stop count, coarse stops, full-route metrics. */
  route: MpFeedRouteSchema.optional(),
  /**
   * A04.1: the earnings breakdown at the requester's fare. Absent only from
   * servers predating A04 — a client then shows no breakdown, never one of
   * its own.
   */
  earnings: MpEarningsBreakdownSchema.optional(),
  /** A04.2: the driver's own preference matches (absent when none). */
  preferenceTags: z.array(z.enum(["homeward"])).optional(),
  /**
   * A03: an advance-booking request's future pickup window (the card is a
   * future booking, not an immediate job) — absent for immediate requests.
   */
  booking: MpRequestBookingSchema.optional(),
  /**
   * A04 item 3: a rider asked THIS driver first — the exclusive window and
   * the free-decline note. Absent otherwise; no other driver sees the card
   * while the window is exclusive.
   */
  preferredRequest: MpPreferredInvitationSchema.optional(),
});
export type MpFeedItem = z.infer<typeof MpFeedItemSchema>;

/**
 * Whether the driver's saved preferences shaped a feed page, and how many
 * requests they hid (never which). Absent when the driver saved none.
 */
export const MpFeedPreferencesSchema = z.object({
  version: z.number().int().positive(),
  applied: z.boolean(),
  hiddenCount: z.number().int().nonnegative(),
  note: z.string().min(1),
});
export type MpFeedPreferences = z.infer<typeof MpFeedPreferencesSchema>;

export const MpFeedPageSchema = z.object({
  items: z.array(MpFeedItemSchema),
  nextCursor: z.string().nullable(),
  availabilityEpoch: z.number().int().min(0),
  preferences: MpFeedPreferencesSchema.optional(),
});
export type MpFeedPage = z.infer<typeof MpFeedPageSchema>;

// ── Driver preferences (A04.2) ─────────────────────────────────────────────

export const MP_WEEKDAYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;
export type MpWeekday = (typeof MP_WEEKDAYS)[number];

const MpAvailabilityWindowShape = z.object({
  day: z.enum(MP_WEEKDAYS),
  /** Minutes from local midnight (city timezone); end exclusive, ≤ 1440. */
  startMinute: z.number().int().min(0).max(1_439),
  endMinute: z.number().int().min(1).max(1_440),
});

/** One weekly availability window. Stored only: scheduling comes later. */
export const MpAvailabilityWindowSchema = MpAvailabilityWindowShape.refine(
  (window) => window.startMinute < window.endMinute,
  {
    message: "a window must start before it ends (split overnight windows)",
    path: ["endMinute"],
  },
);
export type MpAvailabilityWindow = z.infer<typeof MpAvailabilityWindowSchema>;

/** The driver's OWN return area. Never shown to a requester. */
export const MpHomewardSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusMeters: z.number().int().positive(),
  label: z.string().min(1),
});
export type MpHomeward = z.infer<typeof MpHomewardSchema>;

const MpIntRangeSchema = z.object({
  min: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
});

/**
 * `GET|PATCH /v1/mp/driver/preferences`. Version 0 is the unsaved default
 * (nothing filtered). Preferences FILTER and RANK the feed and PRE-FILL a
 * suggested preset; they are never eligibility and never bid. The per-km
 * rate and minimum trip fare the "Your rate" preset uses stay in rate
 * profiles (`MpRateProfileSchema`).
 */
export const MpDriverPreferencesSchema = z.object({
  driverId: z.string().min(1),
  cityId: z.string().min(1),
  version: z.number().int().min(0),
  currency: CurrencySchema,
  timezone: z.string().min(1),
  /** Hide requests whose MAXIMUM fare cannot reach this. Null = none. */
  minimumTripAmountMinor: MoneySchema.nullable(),
  /** Hide pickups farther than this. Null = the request envelope decides. */
  maxPickupDistanceMeters: z.number().int().positive().nullable(),
  acceptsDeliveries: z.boolean(),
  acceptsStops: z.boolean(),
  /** Null = up to the market's stop limit. */
  maxStops: z.number().int().nonnegative().nullable(),
  homeward: MpHomewardSchema.nullable(),
  /** Hide everything that does not end in the homeward area. */
  homewardOnly: z.boolean(),
  availabilityWindows: z.array(
    MpAvailabilityWindowShape.extend({ label: z.string().min(1) }),
  ),
  availabilityNote: z.string().min(1),
  /**
   * A04 item 3: the opt-in to riders naming this driver on a preferred
   * request (off unless the driver turns it on), and what it means.
   */
  acceptsPreferredRequests: z.boolean().optional(),
  preferredRequestsNote: z.string().min(1).optional(),
  /** What the server accepts, derived from the market's policy. */
  bounds: z.object({
    minimumTripAmountMaxMinor: MoneySchema.nullable(),
    maxPickupDistanceMeters: MpIntRangeSchema,
    maxStopsCeiling: z.number().int().nonnegative(),
    homewardRadiusMeters: MpIntRangeSchema,
    maxAvailabilityWindows: z.number().int().positive(),
  }),
  disclosure: z.string().min(1),
  updatedAt: z.string().datetime({ offset: true }).nullable(),
});
export type MpDriverPreferences = z.infer<typeof MpDriverPreferencesSchema>;

/**
 * `PATCH /v1/mp/driver/preferences` body (Idempotency-Key required).
 * `expectedVersion` is the version last read (0 if never saved) — a stale one
 * answers version_conflict. Absent fields are unchanged; null clears a
 * nullable field. Unknown keys are refused (there is no auto-bid switch).
 */
export const MpDriverPreferencesPatchSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    minimumTripAmountMinor: MoneySchema.nullable().optional(),
    maxPickupDistanceMeters: z.number().int().positive().nullable().optional(),
    acceptsDeliveries: z.boolean().optional(),
    acceptsStops: z.boolean().optional(),
    maxStops: z.number().int().nonnegative().nullable().optional(),
    homeward: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        radiusMeters: z.number().int().positive(),
        label: z.string().max(40).optional(),
      })
      .strict()
      .nullable()
      .optional(),
    homewardOnly: z.boolean().optional(),
    availabilityWindows: z.array(MpAvailabilityWindowSchema).max(28).optional(),
    /**
     * A04 item 3: opt in to (or out of) preferred requests. Turning it on
     * needs marketplace_preferred_drivers; turning it off never does.
     */
    acceptsPreferredRequests: z.boolean().optional(),
  })
  .strict();
export type MpDriverPreferencesPatch = z.infer<
  typeof MpDriverPreferencesPatchSchema
>;

// ── Rider queue projection (R10 / G07) ──────────────────────────────────────

/**
 * One ladder row in the rider's queue tracker. `state` matches the RN Ladder
 * component vocabulary; `label`/`detail` are server-phrased strings.
 */
export const MpQueueStepSchema = z.object({
  label: z.string().min(1),
  detail: z.string().min(1).optional(),
  state: z.enum(["done", "active", "pending", "skipped"]),
});

/**
 * Rider-facing queue projection served by `GET /v1/mp/requests/:id/queue`
 * (G07). It is authorized (owner-only, foreign rider → 404), versioned
 * (`version` mirrors the request version for optimistic refresh) and carries
 * an `asOf` freshness stamp so a client can detect a stale ETA. Every field is
 * composed server-side from the real award/claim/promotion/execution state —
 * the client renders, it never derives.
 *
 * Money and rival-bid privacy: the fare shown is the rider's own agreed fare;
 * nothing about other bidders or the driver's other trip leaks through it.
 */
export const MpQueueViewSchema = z.object({
  requestId: z.string().min(1),
  /** Optimistic-refresh cursor; mirrors the request version. */
  version: z.number().int().min(1),
  /** When the server composed this projection (ETA freshness). */
  asOf: z.string().datetime({ offset: true }),
  /**
   * Composed lifecycle the rider is in:
   *  - `queued`    — awarded to a finishing-trip driver, waiting behind their trip
   *  - `promoting` — the dependency finished; the queued job is being started
   *  - `assigned`  — the execution ride exists and the driver is en route
   *  - `arrived`   — the driver is at pickup (PIN relevant)
   *  - `in_progress` — the trip has started
   *  - `settled`   — the ride reached a terminal/complete state
   *  - `cancelled` — the request/award was cancelled
   */
  status: z.enum([
    "queued",
    "promoting",
    "assigned",
    "arrived",
    "in_progress",
    "settled",
    "cancelled",
  ]),
  /** The queued-claim promotion state (mirrors DriverJobs.promotion). */
  promotion: z.enum(["none", "pending", "failed_revalidating"]),
  /** Consistent with the offer/winner projections (same server function). */
  driver: MpOfferDriverSchema,
  /** Pseudonymous display convenience for the tracker header (== driver.displayName). */
  driverFirstName: z.string().min(1),
  steps: z.array(MpQueueStepSchema),
  fareMinor: MoneySchema,
  /** The pickup window the rider consented to, phrased (e.g. "12–18 min"). */
  windowLabel: z.string().min(1),
  eta: z.object({
    label: z.string().min(1),
    /** Whether the current estimate still falls inside the accepted window. */
    inWindow: z.boolean(),
    /** Raw seconds for clients that re-phrase; null when unknown. */
    etaSeconds: z.number().int().nonnegative().nullable(),
    /** Freshness of THIS ETA specifically. */
    asOf: z.string().datetime({ offset: true }),
  }),
  /** The consented window plus its uncertainty band, or null before promotion data exists. */
  pickupWindow: z
    .object({
      earliestSec: z.number().int().nonnegative(),
      latestSec: z.number().int().nonnegative(),
      etaVersion: z.number().int().min(1),
      uncertaintySec: z.number().int().nonnegative(),
    })
    .nullable(),
  /** Server-decided permitted actions; the client never infers these. */
  actions: z.object({
    canCancel: z.boolean(),
    /** True when the estimate broke the accepted window: cancellation is fee-free. */
    feeFreeExit: z.boolean(),
  }),
  /** The delay/cancellation notice, or null when the pickup is on track. */
  delayed: z
    .object({
      noticeTitle: z.string().min(1),
      noticeBody: z.string().min(1),
      keepLabel: z.string().min(1),
      reversal: z
        .object({
          riderHold: z.enum(["releasing", "released"]),
          driverFee: z.enum(["pending", "reversed"]),
        })
        .nullable(),
    })
    .nullable(),
});
export type MpQueueView = z.infer<typeof MpQueueViewSchema>;

/**
 * `GET /v1/mp/requests/:id/pin` (secure pickup-PIN retrieval, G07 companion).
 * The PIN is delivered ONLY over this authenticated REST channel; it never
 * appears in a push payload, an event, analytics or a log. Owner-only, and only
 * while the execution ride is in a PIN-relevant lifecycle state.
 */
export const MpPickupPinSchema = z.object({
  rideId: z.string().min(1),
  pin: z.string().min(1),
  /** The lifecycle state that still makes the PIN retrievable. */
  state: z.string().min(1),
  /** When retrieval stops working (the PIN vault entry's backstop expiry). */
  expiresAt: z.string().datetime({ offset: true }),
});
export type MpPickupPin = z.infer<typeof MpPickupPinSchema>;

/**
 * `GET /v1/mp/trip-access` — a guest passenger's trip (A06 part B),
 * authenticated ONLY by the `X-Trip-Access-Token` header (no gateway
 * identity). `driver` is the same verified-card projection every rider
 * surface uses, present once a driver is committed. Nothing about the
 * requester, the money or any other trip. The PIN is fetched separately
 * (`GET /v1/mp/trip-access/pin` → `MpPickupPin`) while
 * `pickupVerification.pinAvailable`; `POST /v1/mp/trip-access/decline`
 * (Idempotency-Key) declines for free before pickup.
 */
export const MpTripAccessViewSchema = z.object({
  status: z.enum(MP_GUEST_TRIP_STATUSES),
  statusLabel: z.string().min(1),
  passenger: z.object({ firstName: z.string().min(1) }),
  pickup: z.object({ label: z.string() }),
  dropoff: z.object({ label: z.string() }),
  driver: MpOfferDriverSchema.nullable(),
  eta: MpGuestTripEtaSchema.nullable(),
  pickupVerification: MpGuestTripVerificationSchema,
  support: MpGuestTripSupportSchema,
  actions: MpGuestTripActionsSchema,
  expiresAt: z.string().datetime({ offset: true }),
  asOf: z.string().datetime({ offset: true }),
});
export type MpTripAccessView = z.infer<typeof MpTripAccessViewSchema>;

// ── Post-award trip amendments (A02 items 4-6) ─────────────────────────────

/**
 * What an amendment changes. `route` is proposed by either party and needs
 * both approvals; `stop_waiting` (paid waiting the rider authorized up front)
 * and `early_termination` (a safe partial journey) are server-proposed and
 * settle through the same linked-adjustment money path.
 */
export const MP_AMENDMENT_KINDS = [
  "route",
  "stop_waiting",
  "early_termination",
] as const;
export type MpAmendmentKind = (typeof MP_AMENDMENT_KINDS)[number];
export const MpAmendmentKindSchema = z.enum(MP_AMENDMENT_KINDS);

export const MpAmendmentStateSchema = z.enum(MP_AMENDMENT_STATES);

/** The rider-side money of an amendment, stated honestly. */
export const MP_AMENDMENT_RIDER_FUNDING = [
  "pending",
  "reserved",
  "committed",
  "released",
  "release_on_commit",
  "partially_released",
  "not_required",
  "unsecured_cash",
] as const;

/**
 * `POST /v1/mp/requests/:id/amendments`. `stops` are the REMAINING
 * intermediate stops after the change, in order (stops already reached are
 * history and stay as they are); a surviving stop keeps its stopId. The
 * expected revisions name the committed terms being edited — stale ones
 * answer version_conflict with the refreshed terms. No price: the delta is
 * priced server-side under the award's own pricing snapshot.
 */
export const MpProposeAmendmentSchema = z
  .object({
    stops: z.array(MpStopInputSchema).max(10),
    dropoff: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        label: z.string().max(80).optional(),
      })
      .strict()
      .optional(),
    expectedRouteRevision: z.number().int().min(1),
    expectedFareRevision: z.number().int().min(1),
  })
  .strict();
export type MpProposeAmendment = z.infer<typeof MpProposeAmendmentSchema>;

/**
 * `POST .../amendments/:amendmentId/{approve,reject}`: a decision binds to the
 * exact (amendment id, route revision, fare revision). A driver's decision
 * (approve or reject — and a driver's proposal) is accepted only while the
 * server confirms them parked; a rejection carries no standing penalty.
 */
export const MpAmendmentDecisionSchema = z
  .object({
    routeRevision: z.number().int().min(1),
    fareRevision: z.number().int().min(1),
    reason: z.string().max(120).optional(),
  })
  .strict();
export type MpAmendmentDecision = z.infer<typeof MpAmendmentDecisionSchema>;

const MpTripPlaceSchema = z.object({
  label: z.string(),
  lat: z.number(),
  lng: z.number(),
});

const MpApprovalSchema = z.object({
  approved: z.boolean(),
  approvedAt: z.string().datetime({ offset: true }).optional(),
});

/**
 * One amendment as a party sees it. Every amount is server-computed. The
 * driver also sees `commissionDeltaMinor` (the incremental 10% — captured
 * once on an increase, refunded as a linked partial reversal on a decrease)
 * and `driverNetDeltaMinor`; the rider never sees the driver's commission.
 */
export const MpAmendmentSchema = z.object({
  amendmentId: z.string().min(1),
  requestId: z.string().min(1),
  awardId: z.string().min(1),
  kind: MpAmendmentKindSchema,
  state: MpAmendmentStateSchema,
  proposedByRole: z.enum(["rider", "driver", "system"]),
  baseRouteRevision: z.number().int().min(1),
  baseFareRevision: z.number().int().min(1),
  routeRevision: z.number().int().min(1),
  fareRevision: z.number().int().min(1),
  stops: z.array(MpRouteStopSchema),
  dropoff: MpTripPlaceSchema,
  priorFareMinor: MoneySchema,
  revisedFareMinor: MoneySchema,
  /** Signed: revised − prior. */
  fareDeltaMinor: MoneySchema,
  /** Signed: what the rider's funding adds (or gets back). */
  riderFundingDeltaMinor: MoneySchema,
  riderFunding: z.enum(MP_AMENDMENT_RIDER_FUNDING),
  commissionDeltaMinor: MoneySchema.optional(),
  driverNetDeltaMinor: MoneySchema.optional(),
  addedDistanceMeters: z.number().int(),
  addedDurationSec: z.number().int(),
  approvals: z.object({ rider: MpApprovalSchema, driver: MpApprovalSchema }),
  expiresAt: z.string().datetime({ offset: true }),
  /** e.g. next_job_conflict, insufficient_driver_spendable, driver_rejected. */
  reason: z.string().optional(),
  pricing: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime({ offset: true }),
  resolvedAt: z.string().datetime({ offset: true }).optional(),
});
export type MpAmendment = z.infer<typeof MpAmendmentSchema>;

/** `GET /v1/mp/requests/:id/amendments`. */
export const MpAmendmentListSchema = z.object({
  requestId: z.string().min(1),
  routeRevision: z.number().int().min(1),
  fareRevision: z.number().int().min(1),
  agreedFareMinor: MoneySchema,
  amendments: z.array(MpAmendmentSchema),
});
export type MpAmendmentList = z.infer<typeof MpAmendmentListSchema>;

// ── Server-authoritative stop events (A02 item 7) ─────────────────────────

export const MP_STOP_STATES = [
  "pending",
  "arrived",
  "departed",
  "skipped",
] as const;
export type MpStopState = (typeof MP_STOP_STATES)[number];

/** Reasons a DRIVER may end a trip early with (a rider may use any). */
export const MP_TERMINATION_REASONS = [
  "excessive_waiting",
  "rider_request",
  "safety_concern",
  "vehicle_issue",
] as const;

/** `POST .../stops/:stopId/arrive` (driver). */
export const MpStopArriveSchema = z
  .object({
    /**
     * Record the arrival although the server cannot confirm the driver in
     * the geofence. A disputed arrival never starts paid waiting.
     */
    disputed: z.boolean().optional(),
  })
  .strict();

/** `POST .../stops/:stopId/skip` (rider any time; driver after excessive waiting). */
export const MpStopSkipSchema = z
  .object({ reason: z.string().max(80).optional() })
  .strict();

/** `POST .../stops/:stopId/waiting-approval` (rider), bound to the cap revision. */
export const MpWaitingApprovalSchema = z
  .object({ capRevision: z.number().int().min(1) })
  .strict();

/** `POST /v1/mp/requests/:id/terminate`: a safe early end of the journey. */
export const MpTerminateTripSchema = z
  .object({
    reason: z.string().max(80).optional(),
    expectedFareRevision: z.number().int().min(1),
  })
  .strict();

export const MpStopWaitingSchema = z.object({
  waitedSec: z.number().int().nonnegative(),
  includedSec: z.number().int().nonnegative(),
  allowanceRemainingSec: z.number().int().nonnegative(),
  paidSec: z.number().int().nonnegative(),
  /** Accrued (capped) while waiting; the finalised fee after departure. */
  feeMinor: MoneySchema,
  accruing: z.boolean(),
  /** The authorized cap is reached: nothing more accrues without the rider. */
  approvalRequired: z.boolean(),
  excessive: z.boolean(),
  settlement: z.enum(["none", "pending", "committed", "failed"]),
});

export const MpTripStopSchema = z.object({
  stopId: z.string().min(1),
  order: z.number().int().min(1),
  state: z.enum(MP_STOP_STATES),
  label: z.string(),
  purpose: MpStopPurposeSchema,
  lat: z.number(),
  lng: z.number(),
  dwellSec: z.number().int().nonnegative(),
  arrivedAt: z.string().datetime({ offset: true }).optional(),
  arrivalDisputed: z.boolean(),
  arrivalDistanceMeters: z.number().int().optional(),
  departedAt: z.string().datetime({ offset: true }).optional(),
  skippedAt: z.string().datetime({ offset: true }).optional(),
  skipReason: z.string().optional(),
  waiting: MpStopWaitingSchema.optional(),
});
export type MpTripStop = z.infer<typeof MpTripStopSchema>;

/** The published paid-waiting terms of an executing trip. */
export const MpWaitingTermsSchema = z.object({
  includedBasis: z.literal("stop_dwell"),
  perMinMinor: MoneySchema,
  maxAuthorizedMinor: MoneySchema,
  authorizedCapMinor: MoneySchema,
  capRevision: z.number().int().min(1),
  committedMinor: MoneySchema,
  excessiveAfterSec: z.number().int().nonnegative(),
  geofenceMeters: z.number().int().nonnegative(),
});

/** One committed line of the trip's receipt. */
export const MpTripAdjustmentSchema = z.object({
  amendmentId: z.string().min(1),
  kind: MpAmendmentKindSchema,
  fareDeltaMinor: MoneySchema,
  fareRevision: z.number().int().min(1),
  committedAt: z.string().datetime({ offset: true }),
});

/**
 * `GET /v1/mp/requests/:id/trip` — and the answer of every stop POST. The
 * receipt reconciles: originalFareMinor + Σ committedAdjustments =
 * agreedFareMinor, which is what completion settles; nothing uncommitted
 * ever appears in it.
 */
export const MpTripSchema = z.object({
  requestId: z.string().min(1),
  awardId: z.string().min(1),
  executionId: z.string().min(1),
  routeRevision: z.number().int().min(1),
  fareRevision: z.number().int().min(1),
  originalFareMinor: MoneySchema,
  agreedFareMinor: MoneySchema,
  committedAdjustments: z.array(MpTripAdjustmentSchema),
  /** Driver only: commission captured so far (= commission(agreed fare)). */
  capturedCommissionMinor: MoneySchema.optional(),
  pickup: MpTripPlaceSchema,
  dropoff: MpTripPlaceSchema,
  stops: z.array(MpTripStopSchema),
  waitingTerms: MpWaitingTermsSchema,
  openAmendmentId: z.string().min(1).optional(),
  terminatedAt: z.string().datetime({ offset: true }).optional(),
  version: z.number().int().min(1),
});
export type MpTrip = z.infer<typeof MpTripSchema>;

// ── Book for Later (A03) ──────────────────────────────────────────────────
//
// Two explicitly different products plus recurring templates:
//  - SCHEDULED REQUEST (`/v1/mp/scheduled-requests`, flag `scheduled_rides`):
//    a stored intent; NO driver is secured; published as an ordinary request
//    at the market's lead time with routing, bounds and funding refreshed.
//  - ADVANCE DRIVER RESERVATION (`/v1/mp/advance-requests` →
//    `/v1/mp/advance-bookings`, flag `marketplace_advance_reservations`):
//    drivers bid on a future pickup window, the requester selects one in
//    advance, the commission is captured once at that award, and the booking
//    lives on a calendar separate from the live current/next slots.
//  - RECURRING TEMPLATE (`/v1/mp/recurring-templates`, flag
//    `marketplace_recurring_journeys`): occurrences of either product, each
//    with its own fare approval, funding, driver commitment and receipt.

/**
 * The market's Book for Later policy, optional inside the marketplace policy
 * (absent ⇒ every Book for Later capability fails closed with
 * market_not_configured). Every duration is seconds; values in fixtures are
 * test data, never production defaults.
 */
export const MpScheduledRequestPolicySchema = z.object({
  /** Publish the stored intent this long before the pickup. */
  publishLeadSec: z.number().int().positive(),
  /** The earliest a scheduled request may be made before its pickup. */
  minLeadSec: z.number().int().positive(),
  /** The furthest ahead a pickup may be scheduled. */
  maxHorizonSec: z.number().int().positive(),
  defaultWindowSec: z.number().int().positive(),
  minWindowSec: z.number().int().positive(),
  maxWindowSec: z.number().int().positive(),
  /** Reminder offsets before the pickup (e.g. 12 h and 1 h). */
  reminderOffsetsSec: z.array(z.number().int().positive()).max(4),
  maxPendingPerRequester: z.number().int().positive(),
});

export const MpAdvanceReservationPolicySchema = z.object({
  /** Bounded booking horizon: no hold is ever longer-lived than this. */
  bookingHorizonSec: z.number().int().positive(),
  minLeadSec: z.number().int().positive(),
  /** How long an advance request takes offers (capped before reconfirmation). */
  offerWindowSec: z.number().int().positive(),
  bidExpirySec: z.number().int().positive(),
  defaultWindowSec: z.number().int().positive(),
  minWindowSec: z.number().int().positive(),
  maxWindowSec: z.number().int().positive(),
  /**
   * Rider funding is secured with the wallet funding authorization at the
   * advance award only when the pickup is within this horizon; otherwise the
   * booking is payment_pending and funding is secured when it enters it.
   */
  fundingHorizonSec: z.number().int().positive(),
  /** Funding still unsecured this long before pickup fails the booking. */
  fundingDeadlineSec: z.number().int().positive(),
  reconfirmOpensSec: z.number().int().positive(),
  reconfirmDeadlineSec: z.number().int().positive(),
  /** Activation into the live current/next slots this long before pickup. */
  activationLeadSec: z.number().int().positive(),
  /** Uncertainty buffers around each booking's calendar interval. */
  preBufferSec: z.number().int().nonnegative(),
  postBufferSec: z.number().int().nonnegative(),
  reminderOffsetsSec: z.array(z.number().int().positive()).max(4),
  maxOpenPerRequester: z.number().int().positive(),
});

export const MpRecurringPolicySchema = z.object({
  /** Occurrences are generated this many local days ahead. */
  generationHorizonDays: z.number().int().min(1).max(14),
  maxActiveTemplatesPerRequester: z.number().int().positive(),
  /** Longest series (startsOn → endsOn) a template may span. */
  maxSeriesDays: z.number().int().positive(),
});

export const MpSchedulingPolicySchema = z.object({
  scheduledRequests: MpScheduledRequestPolicySchema.optional(),
  advanceReservations: MpAdvanceReservationPolicySchema.optional(),
  recurring: MpRecurringPolicySchema.optional(),
});
export type MpSchedulingPolicy = z.infer<typeof MpSchedulingPolicySchema>;

/** What a Book for Later intent becomes when published. */
export const MP_BOOKING_PRODUCTS = [
  "scheduled_request",
  "advance_reservation",
] as const;
export type MpBookingProduct = (typeof MP_BOOKING_PRODUCTS)[number];

/** `POST /v1/mp/scheduled-requests` (Idempotency-Key required). */
export const MpCreateScheduledRequestSchema = z
  .object({
    /** A fresh quote: pins the route, service and class; not consumed. */
    quoteId: z.string().min(1),
    /** The asked fare the request publishes with (clamped into fresh bounds). */
    requestedFareMinor: MoneySchema,
    /** The most the rider approves; refreshed bounds above it need approval. */
    maxFareMinor: MoneySchema,
    paymentMethodId: z.string().min(1),
    schedule: MpPickupScheduleInputSchema,
  })
  .strict();
export type MpCreateScheduledRequest = z.infer<
  typeof MpCreateScheduledRequestSchema
>;

/** Why a stored intent is waiting for the rider instead of publishing. */
export const MP_SCHEDULED_APPROVAL_REASONS = [
  "fare_above_approval",
  "payment_method_unavailable",
  "funding_unavailable",
] as const;

export const MpScheduledRequestSchema = z.object({
  scheduledRequestId: z.string().min(1),
  product: z.enum(MP_BOOKING_PRODUCTS),
  state: z.enum(MP_SCHEDULED_REQUEST_STATES),
  version: z.number().int().min(1),
  /** False until a published request's offer is selected and confirmed. */
  driverSecured: z.boolean(),
  /** e.g. "Scheduled — no driver secured yet". */
  statusLabel: z.string().min(1),
  notice: z.string().min(1),
  service: MpServiceSchema,
  vehicleClass: z.string().min(1),
  cityId: z.string().min(1),
  currency: CurrencySchema,
  pickup: MpAreaSchema,
  dropoff: MpAreaSchema,
  stops: z.array(MpRouteStopSchema).optional(),
  schedule: MpPickupScheduleSchema,
  publishAt: z.string().datetime({ offset: true }),
  requestedFareMinor: MoneySchema,
  maxFareMinor: MoneySchema,
  paymentMethodId: z.string().min(1),
  requestId: z.string().min(1).nullable(),
  requestState: z.enum(MP_REQUEST_STATES).nullable(),
  templateId: z.string().min(1).nullable(),
  occurrenceDate: MpLocalDateSchema.nullable(),
  approval: z
    .object({
      reason: z.enum(MP_SCHEDULED_APPROVAL_REASONS),
      message: z.string().min(1),
      refreshedTerms: z
        .object({
          minimumFareMinor: MoneySchema,
          maximumFareMinor: MoneySchema,
          suggestedFareMinor: MoneySchema,
        })
        .nullable(),
    })
    .nullable(),
  closeReason: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type MpScheduledRequest = z.infer<typeof MpScheduledRequestSchema>;

/**
 * `POST /v1/mp/scheduled-requests/:id/approve` — the rider's renewed
 * approval of refreshed terms (a new maximum at or above the refreshed
 * minimum). The intent returns to scheduled_unassigned and publishes on the
 * next worker pass, re-refreshing once more.
 */
export const MpApproveScheduledRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    maxFareMinor: MoneySchema,
    requestedFareMinor: MoneySchema.optional(),
    /**
     * A replacement payment method (must be available in the city) — how a
     * rider answers a `payment_method_unavailable` approval.
     */
    paymentMethodId: z.string().min(1).optional(),
  })
  .strict();

/** `POST /v1/mp/advance-requests` (Idempotency-Key required). */
export const MpCreateAdvanceRequestSchema = z
  .object({
    quoteId: z.string().min(1),
    requestedFareMinor: MoneySchema,
    paymentMethodId: z.string().min(1),
    schedule: MpPickupScheduleInputSchema,
  })
  .strict();
export type MpCreateAdvanceRequest = z.infer<
  typeof MpCreateAdvanceRequestSchema
>;

/** Rider funding of an advance booking across the booking horizon. */
export const MP_BOOKING_FUNDING_STATES = [
  /** Not yet secured: the pickup is beyond the funding horizon. */
  "pending",
  /** A durable wallet funding reservation encumbers the fare. */
  "secured",
  /** Cash: explicitly unsecured, collected at the trip. */
  "unsecured_cash",
  /** The last attempt was refused; retried until the funding deadline. */
  "refused",
  /** Released after a failure or cancellation. */
  "released",
] as const;

export const MpBookingFailureSchema = z.object({
  reason: z.enum([
    "driver_withdrew",
    "driver_ineligible",
    "reconfirmation_missed",
    "funding_not_secured",
    "driver_unavailable",
    "driver_on_running_trip",
    "execution_blocked",
    "award_cancelled",
    // The activated trip was cancelled other than by the driver.
    "trip_cancelled",
    // The rider cancelled before activation (no fee in this slice).
    "rider_cancelled",
  ]),
  message: z.string().min(1),
  financialOutcome: z.object({
    /** The driver's captured commission returned with a linked reversal. */
    commissionReversed: z.boolean(),
    /** Any rider funding reservation released. */
    riderFundingReleased: z.boolean(),
    /** Nothing is ever charged to the rider for a failed booking. */
    riderCharged: z.literal(false),
  }),
  /** A consented re-publish is available (never an automatic substitute). */
  rematchAvailable: z.boolean(),
});

export const MpAdvanceBookingSchema = z.object({
  bookingId: z.string().min(1),
  requestId: z.string().min(1),
  awardId: z.string().min(1),
  state: z.enum(MP_ADVANCE_BOOKING_STATES),
  version: z.number().int().min(1),
  /** Whose view this is: fields differ (the driver sees their money). */
  viewer: z.enum(["rider", "driver"]),
  /** A specific driver is committed (held/payment_pending/confirmed/…). */
  driverReserved: z.boolean(),
  /** Driver committed AND rider funding secured (or cash explicitly). */
  fullySecured: z.boolean(),
  statusLabel: z.string().min(1),
  /** Always includes the no-guaranteed-pickup disclosure. */
  notices: z.array(z.string().min(1)),
  schedule: MpPickupScheduleSchema,
  pickup: MpAreaSchema,
  dropoff: MpAreaSchema,
  fareMinor: MoneySchema,
  /** Driver view only: the commission captured once at the advance award. */
  commissionMinor: MoneySchema.optional(),
  netMinor: MoneySchema.optional(),
  /** Rider view only: the selected driver. */
  driver: MpOfferDriverSchema.optional(),
  funding: z.object({
    state: z.enum(MP_BOOKING_FUNDING_STATES),
    label: z.string().min(1),
    dueAt: z.string().datetime({ offset: true }).nullable(),
    deadline: z.string().datetime({ offset: true }).nullable(),
  }),
  reconfirmation: z.object({
    opensAt: z.string().datetime({ offset: true }),
    deadline: z.string().datetime({ offset: true }),
    reconfirmedAt: z.string().datetime({ offset: true }).nullable(),
  }),
  activationAt: z.string().datetime({ offset: true }),
  activatedSlot: MpSlotSchema.nullable(),
  failure: MpBookingFailureSchema.nullable(),
  rematchRequestId: z.string().min(1).nullable(),
  /**
   * The market's reminder offsets for this booking, in seconds before the
   * pickup window opens (the rider is reminded at each; empty when the
   * market configures none).
   */
  reminderOffsetsSec: z.array(z.number().int().positive()),
  /**
   * Rider view: until when the rider may cancel this booking free of charge
   * (activation — no cancellation fee is charged before it); null once it
   * can no longer be cancelled that way, and always null on the driver view.
   */
  freeCancellationDeadline: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type MpAdvanceBooking = z.infer<typeof MpAdvanceBookingSchema>;

/** `GET /v1/mp/driver/calendar` — the driver's committed future bookings. */
export const MpDriverCalendarSchema = z.object({
  bookings: z.array(MpAdvanceBookingSchema),
  note: z.string().min(1),
});

/** `POST /v1/mp/advance-bookings/:id/withdraw` (driver cannot attend). */
export const MpWithdrawBookingSchema = z
  .object({ reason: z.string().min(1).max(280) })
  .strict();

/**
 * `POST /v1/mp/advance-bookings/:id/rematch` — the rider's explicit consent
 * to re-publish a failed booking's trip. The fare is the original asked fare
 * unless the rider names another; bounds are refreshed and never silently
 * raised. Answers the new advance request (no driver secured).
 */
export const MpRematchBookingSchema = z
  .object({ requestedFareMinor: MoneySchema.optional() })
  .strict();

/** `POST /v1/mp/recurring-templates` (Idempotency-Key required). */
export const MpCreateRecurringTemplateSchema = z
  .object({
    quoteId: z.string().min(1),
    product: z.enum(MP_BOOKING_PRODUCTS),
    daysOfWeek: z.array(z.enum(MP_WEEKDAYS)).min(1).max(7),
    localTime: MpLocalTimeSchema,
    timeZone: z.string().min(1).optional(),
    startsOn: MpLocalDateSchema,
    endsOn: MpLocalDateSchema.optional(),
    windowMinutes: z.number().int().positive().optional(),
    dstDisambiguation: z.enum(MP_DST_DISAMBIGUATIONS).optional(),
    requestedFareMinor: MoneySchema,
    maxFareMinor: MoneySchema,
    paymentMethodId: z.string().min(1),
  })
  .strict();
export type MpCreateRecurringTemplate = z.infer<
  typeof MpCreateRecurringTemplateSchema
>;

export const MpRecurringTemplateSchema = z.object({
  templateId: z.string().min(1),
  state: z.enum(MP_RECURRING_TEMPLATE_STATES),
  version: z.number().int().min(1),
  product: z.enum(MP_BOOKING_PRODUCTS),
  daysOfWeek: z.array(z.enum(MP_WEEKDAYS)),
  localTime: MpLocalTimeSchema,
  timeZone: z.string().min(1),
  startsOn: MpLocalDateSchema,
  endsOn: MpLocalDateSchema.nullable(),
  windowMinutes: z.number().int().positive(),
  requestedFareMinor: MoneySchema,
  maxFareMinor: MoneySchema,
  paymentMethodId: z.string().min(1),
  service: MpServiceSchema,
  vehicleClass: z.string().min(1),
  pickup: MpAreaSchema,
  dropoff: MpAreaSchema,
  stops: z.array(MpRouteStopSchema).optional(),
  generatedThrough: MpLocalDateSchema.nullable(),
  /** Always states that each occurrence books (and is secured) separately. */
  seriesNote: z.string().min(1),
  occurrences: z.array(MpScheduledRequestSchema),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type MpRecurringTemplate = z.infer<typeof MpRecurringTemplateSchema>;

/** Pause / resume / cancel a series (Idempotency-Key required). */
export const MpRecurringTemplateCommandSchema = z
  .object({ expectedVersion: z.number().int().min(1) })
  .strict();

// ── Rider confidence: snapshot order, saved drivers, receipts (A06/A04.3) ──

export * from "./marketplace-confidence";
export * from "./marketplace-guest";

/**
 * `GET /v1/mp/requests/:id[?sort=offered|price|pickup|service_fit]` — the
 * owner snapshot. Offers carry their server-computed comparison; `offerOrder`
 * states the order they are in (the neutral offered order by default).
 */
export const MpRequestSnapshotSchema = z.object({
  request: MpRequestSchema,
  offers: z.array(MpOfferSchema),
  advanceOffers: z.array(MpAdvanceOfferSchema).optional(),
  award: MpAwardSchema.optional(),
  seq: z.number().int().min(0),
  offerOrder: MpOfferOrderSchema.optional(),
});
export type MpRequestSnapshot = z.infer<typeof MpRequestSnapshotSchema>;

/**
 * One saved driver (`GET|POST /v1/mp/favourite-drivers`). `canRequest` says
 * whether the rider may ask them first right now; why not (opted out, or not
 * taking marketplace work) is deliberately not distinguished.
 */
export const MpFavouriteDriverSchema = z.object({
  driverId: z.string().min(1),
  cityId: z.string().min(1),
  state: z.enum(["active", "removed"]),
  savedAt: z.string().datetime({ offset: true }),
  driver: MpOfferDriverSchema,
  driverProfile: MpOfferDriverProfileSchema,
  canRequest: z.boolean(),
  canRequestLabel: z.string().min(1),
});
export type MpFavouriteDriver = z.infer<typeof MpFavouriteDriverSchema>;

export const MpFavouriteDriversSchema = z.object({
  items: z.array(MpFavouriteDriverSchema),
  note: z.string().min(1),
});
export type MpFavouriteDrivers = z.infer<typeof MpFavouriteDriversSchema>;

/**
 * `GET /v1/mp/requests/:id/receipt` — a COMPLETED marketplace ride's receipt,
 * to its two parties only. `viewer: "rider"` carries taxes and never a
 * commission line; `viewer: "driver"` carries `driver` (gross, the 10%
 * captured once plus linked adjustments, net). `lines` sum to `totalMinor`,
 * which equals `reconciliation.settledFareMinor` (agreed fare + committed
 * adjustments). While money is still settling the route answers 409
 * `conflict` (`details.reason: "settling"`).
 */
export const MpReceiptSchema = z
  .object({
    receiptId: z.string().min(1),
    viewer: z.enum(["rider", "driver"]),
    requestId: z.string().min(1),
    awardId: z.string().min(1),
    executionId: z.string().min(1),
    currency: CurrencySchema,
    lines: z.array(MpReceiptLineSchema).min(1),
    totalMinor: MoneySchema,
    taxes: MpReceiptTaxesSchema.optional(),
    payment: z.object({
      /** `business`: an organization's budget paid (A06 part C). */
      method: z.enum(["wallet", "cash", "business"]),
      label: z.string().min(1),
    }),
    trip: z.object({
      service: z.literal("ride"),
      vehicleClass: z.string().min(1),
      pickup: z.string().min(1),
      dropoff: z.string().min(1),
      stopCount: z.number().int().nonnegative(),
      stopsVisited: z.number().int().nonnegative(),
      stopsSkipped: z.number().int().nonnegative(),
      routedDistanceMeters: z.number().int().nonnegative(),
      startedAt: z.string().datetime({ offset: true }).nullable(),
      completedAt: z.string().datetime({ offset: true }),
      terminatedEarly: z.boolean(),
      driver: MpOfferDriverSchema,
    }),
    settlement: z.object({
      status: z.enum(["posted", "pending"]),
      settledAt: z.string().datetime({ offset: true }).nullable(),
      note: z.string().min(1),
    }),
    reconciliation: z.object({
      originalFareMinor: MoneySchema,
      adjustmentsMinor: MoneySchema,
      totalMinor: MoneySchema,
      settledFareMinor: MoneySchema,
      rule: z.string().min(1),
    }),
    driver: MpDriverReceiptEarningsSchema.optional(),
    /**
     * A06 part C — a BUSINESS receipt (rider view only; the driver learns
     * nothing about the organization): the paying organization's billing
     * identity and tax id, the cost centre and expense category, and the
     * budget funding as the ledger recorded it. VAT is `taxes` above, at the
     * market's configured rates. Billing fields are null (and `note` says
     * so) while payment-service cannot be read — never invented.
     */
    business: z
      .object({
        organizationId: z.string().min(1),
        organizationName: z.string().min(1).nullable(),
        legalName: z.string().nullable(),
        taxId: z.string().nullable(),
        costCentre: z
          .object({
            id: z.string().min(1),
            code: z.string().min(1).nullable(),
            name: z.string().min(1).nullable(),
          })
          .nullable(),
        expenseCategory: z.string().min(1).nullable(),
        bookingRef: z.string().min(1),
        bookerId: z.string().min(1),
        travellerId: z.string().min(1),
        fundingState: z.enum(MP_BUSINESS_BOOKING_STATES),
        committedMinor: MoneySchema.nullable(),
        ledgerTaxes: z.array(
          z.object({
            code: z.string().min(1),
            rateBps: z.number().int().positive(),
            amountMinor: z.number().int().nonnegative(),
          }),
        ),
        note: z.string().min(1),
      })
      .optional(),
    format: z.literal("json"),
    issuedAt: z.string().datetime({ offset: true }),
  })
  .superRefine((receipt, ctx) => {
    if (receipt.viewer === "driver" && receipt.business) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["business"],
        message: "a driver's receipt never names the paying organization",
      });
    }
    const sum = receipt.lines
      .filter((line) => !line.code.startsWith("commission"))
      .reduce((total, line) => total + line.amountMinor.amountMinor, 0);
    if (sum !== receipt.totalMinor.amountMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lines"],
        message: "receipt lines must add up to the total",
      });
    }
    if (
      receipt.totalMinor.amountMinor !==
      receipt.reconciliation.settledFareMinor.amountMinor
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reconciliation"],
        message: "the receipt total must equal the settled fare",
      });
    }
    const commissionLine = receipt.lines.some((line) =>
      line.code.startsWith("commission"),
    );
    if (receipt.viewer === "rider" && (receipt.driver || commissionLine)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["driver"],
        message: "a rider's receipt never carries the driver's commission",
      });
    }
    if (receipt.viewer === "driver" && !receipt.driver) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["driver"],
        message: "a driver's receipt states gross, commission and net",
      });
    }
  });
export type MpReceipt = z.infer<typeof MpReceiptSchema>;

// ── Commission arithmetic (server-side; exported for service reuse) ───────

/**
 * The one commission function: 10% of the accepted service fare, half-up to
 * the minor unit. Services call this; clients never do.
 */
export function commissionMinorFor(fareMinor: number): number {
  if (!Number.isInteger(fareMinor) || fareMinor < 0) {
    throw new TypeError(
      `fareMinor must be a nonnegative integer, received ${fareMinor}`,
    );
  }
  // bps/10_000 with half-up rounding, in integer arithmetic.
  return Math.floor((fareMinor * 1_000 + 5_000) / 10_000);
}
