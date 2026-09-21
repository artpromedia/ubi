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

import { CurrencySchema, MoneySchema } from "./money";
import {
  MP_AWARD_STATES,
  MP_BID_STATES,
  MP_CLAIM_STATES,
  MP_HOLD_STATES,
  MP_REQUEST_STATES,
} from "./state-machines";

export const MP_SERVICES = ["ride", "delivery"] as const;
export type MpService = (typeof MP_SERVICES)[number];
export const MpServiceSchema = z.enum(MP_SERVICES);

/** Which capacity slot a bid/claim is for (one current + at most one next). */
export const MP_SLOTS = ["current", "next"] as const;
export type MpSlot = (typeof MP_SLOTS)[number];
export const MpSlotSchema = z.enum(MP_SLOTS);

// ── Quote envelope (R02) ────────────────────────────────────────────────────

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
});
export type MpQuoteEnvelope = z.infer<typeof MpQuoteEnvelopeSchema>;

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
});
export type MpPublishRequest = z.infer<typeof MpPublishRequestSchema>;

/** Owner view of a request. `revision` bumps on price-affecting edits. */
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
});
export type MpRequest = z.infer<typeof MpRequestSchema>;

// ── Bids ───────────────────────────────────────────────────────────────────

/** `POST /v1/mp/bids` body. Slot intent is recorded at creation (M05A). */
export const MpSubmitBidSchema = z.object({
  requestId: z.string().min(1),
  /** The revision the driver saw; a newer revision rejects with version_conflict. */
  requestRevision: z.number().int().min(1),
  amountMinor: MoneySchema,
  slot: MpSlotSchema,
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
  slot: MpSlotSchema,
  dependsOnClaimId: z.string().min(1).nullable(),
  reservationId: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true }),
});
export type MpBid = z.infer<typeof MpBidSchema>;

/**
 * Rider-facing driver display (G09). ride-service does NOT own verified driver
 * identity — names, plates, photos and the rating/trip history all live in
 * user-service, and this service holds no projection of them and makes no
 * cross-service call for them (see docs/marketplace/DRIVER_IDENTITY.md).
 *
 * `profileStatus` is the honesty gate. When it is "unavailable" the server has
 * NOT joined a verified profile, so `displayName` is a stable pseudonym (never
 * a claimed real name), `rating` is the "–" no-value marker and `completedTrips`
 * is a placeholder 0 — none of which a client may present as a real, verified
 * figure. `vehicle` IS server-verified: it is the class the driver is eligible
 * for and bidding on. When a verified join lands, `profileStatus` becomes
 * "verified" and the fields carry real values (and can then be widened to
 * nullable across the contract + apps in one change).
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
  /** Server-computed rider-side booking fee, when the market charges one. */
  bookingFeeMinor: MoneySchema.nullable().optional(),
  /** Server-computed total the rider pays for this offer. */
  totalMinor: MoneySchema.nullable().optional(),
  /** Server-phrased comparison to the requested amount (e.g. "+₦200"). */
  deltaLabel: z.string().nullable().optional(),
});
export type MpOffer = z.infer<typeof MpOfferSchema>;

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
] as const;
export type MpEligibilityReason = (typeof MP_ELIGIBILITY_REASONS)[number];

export const MpEligibilityReasonSchema = z.object({
  code: z.enum(MP_ELIGIBILITY_REASONS),
  title: z.string().min(1),
  detail: z.string().min(1),
});

export const MpEligibilitySchema = z.object({
  eligible: z.boolean(),
  slot: MpSlotSchema.nullable(),
  reasons: z.array(MpEligibilityReasonSchema),
  policyVersion: z.number().int().positive(),
  availabilityEpoch: z.number().int().min(0),
  evaluatedAt: z.string().datetime({ offset: true }),
});
export type MpEligibility = z.infer<typeof MpEligibilitySchema>;

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
  source: z.enum(["requested", "lower", "higher", "rate_profile"]),
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
  slot: MpSlotSchema,
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
});
export type MpFeedItem = z.infer<typeof MpFeedItemSchema>;

export const MpFeedPageSchema = z.object({
  items: z.array(MpFeedItemSchema),
  nextCursor: z.string().nullable(),
  availabilityEpoch: z.number().int().min(0),
});
export type MpFeedPage = z.infer<typeof MpFeedPageSchema>;

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
