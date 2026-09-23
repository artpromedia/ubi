/**
 * City configuration — the single source for every number, currency and policy
 * the apps display (CLAUDE.md #1). Nothing in this file has a default that
 * would let a client fall back to a hard-coded market.
 *
 * Source: contracts/openapi/support-config.yaml (CityConfig) and slice 01.
 */
import { z } from "zod";

import {
  MpMultiStopPolicySchema,
  MpSchedulingPolicySchema,
} from "./marketplace";
import { CurrencySchema } from "./money";

export const VEHICLE_CLASSES = ["go", "comfort", "xl", "moto"] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

export const FareTableSchema = z.object({
  baseMinor: z.number().int().nonnegative(),
  perKmMinor: z.number().int().nonnegative(),
  perMinMinor: z.number().int().nonnegative(),
  bookingFeeMinor: z.number().int().nonnegative(),
  minFareMinor: z.number().int().nonnegative(),
});
export type FareTable = z.infer<typeof FareTableSchema>;

export const WaitPolicySchema = z.object({
  /** Free waiting time before the per-minute fee starts. Lagos board: 5:00. */
  freeSec: z.number().int().nonnegative(),
  perMinMinor: z.number().int().nonnegative(),
});

export const CancelPolicySchema = z.object({
  /** Rider cancels free until a driver is assigned, then this fee applies. */
  riderFeeAfterAssignMinor: z.number().int().nonnegative(),
  /** Driver-initiated cancellation never charges the rider. */
  driverFeeMinor: z.number().int().nonnegative(),
  freeWindowSec: z.number().int().nonnegative(),
});

export const PaymentMethodConfigSchema = z.object({
  id: z.string().min(1),
  available: z.boolean(),
  /** Required when unavailable: honest unavailability (CLAUDE.md #8). */
  reason: z.string().min(1).optional(),
});
export type PaymentMethodConfig = z.infer<typeof PaymentMethodConfigSchema>;

export const KycTierSchema = z.object({
  tier: z.string().min(1),
  dailyOutMinor: z.number().int().nonnegative(),
  singleTransferMinor: z.number().int().nonnegative(),
  balanceCapMinor: z.number().int().nonnegative().nullable(),
});
export type KycTier = z.infer<typeof KycTierSchema>;

export const MatchingRingSchema = z.object({
  radiusMeters: z.number().int().positive(),
  maxCandidates: z.number().int().positive(),
});

export const AirportConfigSchema = z.object({
  codes: z.array(z.string().min(3)),
  /** Arrival pickups are scheduled at landing + this buffer (slice 08). */
  arrivalBufferMin: z.number().int().nonnegative(),
  /** Departure rides: arriveBy = departure − checkInCutoffMin − trafficBufferMin. */
  checkInCutoffMin: z.number().int().nonnegative(),
  trafficBufferMin: z.number().int().nonnegative(),
  doors: z.record(z.string()),
});

/**
 * Negotiated-fare marketplace policy (M01). Every number the marketplace needs
 * lives here, versioned per city — radii, ETA budgets, dwell, cooldowns, caps,
 * bounds. No code constant may stand in for a missing value: a city without a
 * marketplace policy (or with a service/vehicle pair missing from `fareBounds`)
 * FAILS CLOSED with `market_not_configured`. Values shown in fixtures are test
 * data, never production defaults.
 */
export const MarketplaceFareBoundsSchema = z.object({
  /** Absolute floor for the negotiated service fare, minor units. */
  absoluteFloorMinor: z.number().int().positive(),
  /** Versioned cost-based floor component, minor units (operating-cost model). */
  costFloorMinor: z.number().int().nonnegative(),
  /** Floor as basis points of the suggested fare. Effective floor = max of the three. */
  floorBpsOfSuggested: z.number().int().min(0).max(10_000),
  /** Ceiling as basis points of the suggested fare — mistake/abuse protection. */
  ceilingBpsOfSuggested: z.number().int().min(10_000),
});
export type MarketplaceFareBounds = z.infer<typeof MarketplaceFareBoundsSchema>;

export const SearchEnvelopePolicySchema = z.object({
  initialRadiusMeters: z.number().int().positive(),
  maxRadiusMeters: z.number().int().positive(),
  initialPickupEtaSec: z.number().int().positive(),
  maxPickupEtaSec: z.number().int().positive(),
  /** Expand after this long open without a sufficient offer count. */
  expandAfterSec: z.number().int().positive(),
  /** Offers below this count allow expansion at the timeout. */
  minOffersBeforeExpand: z.number().int().nonnegative(),
  /** Radius/ETA grow by these factors per step, clamped at the maxima. */
  expansionSteps: z.number().int().min(1).max(10),
});

export const StationaryPolicySchema = z.object({
  /** Sustained dwell below the speed gate before interactive bidding opens. */
  minDwellSec: z.number().int().positive(),
  maxSpeedMps: z.number().nonnegative(),
  maxLocationAgeSec: z.number().int().positive(),
  maxAccuracyMeters: z.number().int().positive(),
  /** Hysteresis: once open, motion above the gate for this long closes it. */
  motionCloseSec: z.number().int().positive(),
});

export const FinishingTripPolicySchema = z.object({
  /** Current job must have at most this much estimated service time left. */
  maxRemainingSec: z.number().int().positive(),
  /** Completion/handoff buffer added to the predicted pickup time. */
  completionBufferSec: z.number().int().nonnegative(),
  uncertaintyBufferSec: z.number().int().nonnegative(),
  /** Max bearing delta between post-dropoff heading-to-pickup and corridor. */
  corridorMaxBearingDeltaDeg: z.number().int().min(0).max(180),
});

export const MarketplaceBidPolicySchema = z.object({
  bidExpirySec: z.number().int().positive(),
  requestExpirySec: z.number().int().positive(),
  revisionCooldownSec: z.number().int().nonnegative(),
  maxLiveBidsPerDriver: z.number().int().positive(),
  maxOpenRequestsPerRequester: z.number().int().positive(),
});

export const QueuePolicySchema = z.object({
  /** Beyond this drift from the accepted window the rider may exit fee-free. */
  pickupWindowToleranceSec: z.number().int().nonnegative(),
});

export const RateProfileBoundsSchema = z.object({
  maxPerKmMinor: z.number().int().positive(),
  maxMinimumTripFareMinor: z.number().int().positive(),
});

export const MarketplacePolicySchema = z.object({
  policyVersion: z.number().int().positive(),
  /**
   * User-mandated marketplace commission: 10%, 1,000 basis points, on the
   * accepted negotiated service fare (tips, goods value, taxes and pass-through
   * tolls excluded). Fixed by contract — not grantable to any admin role.
   */
  commissionBps: z.literal(1_000),
  /** Documented integer rounding for the commission (half-up per spec). */
  commissionRounding: z.literal("half_up"),
  /** Keyed `service:vehicleClass` (e.g. "ride:go", "delivery:moto"). */
  fareBounds: z.record(MarketplaceFareBoundsSchema),
  searchEnvelope: SearchEnvelopePolicySchema,
  stationary: StationaryPolicySchema,
  finishingTrip: FinishingTripPolicySchema,
  bids: MarketplaceBidPolicySchema,
  queue: QueuePolicySchema,
  rateProfileBounds: z.record(RateProfileBoundsSchema),
  /**
   * Per-market multi-stop limits (A02). Absent ⇒ the pilot defaults
   * (`MP_MULTI_STOP_PILOT_DEFAULTS`). Declared here so a market's stop limits
   * survive schema parsing instead of being stripped as an unknown key.
   */
  stops: MpMultiStopPolicySchema.optional(),
  // Book for Later policy (A03): scheduled requests, advance reservations and
  // recurring journeys. Without it config-service strips the block and all
  // three products fail closed for the market.
  scheduling: MpSchedulingPolicySchema.optional(),
});
export type MarketplacePolicy = z.infer<typeof MarketplacePolicySchema>;

export const CityConfigSchema = z.object({
  cityId: z.string().min(1),
  version: z.number().int().positive(),
  currency: CurrencySchema,
  /** Minor-unit exponent — kobo is 2. Formatters must read this, not assume it. */
  currencyFractionDigits: z.number().int().min(0).max(4),
  locale: z.string().min(2),
  timezone: z.string().min(1),
  emergencyNumber: z.string().min(3),
  vehicleClasses: z.array(z.enum(VEHICLE_CLASSES)).min(1),
  fares: z.record(FareTableSchema),
  waitPolicy: WaitPolicySchema,
  cancelPolicy: CancelPolicySchema,
  pinRequired: z.boolean(),
  quoteTtlSec: z.number().int().positive(),
  offerTtlSec: z.number().int().positive(),
  matchingRings: z.array(MatchingRingSchema).min(1),
  /** Server checks the driver is within this radius before accepting "arrived". */
  arrivedGeofenceMeters: z.number().int().positive(),
  maxPinAttempts: z.number().int().positive(),
  paymentMethods: z.array(PaymentMethodConfigSchema).min(1),
  kycTiers: z.array(KycTierSchema).min(1),
  serviceFeePct: z.number().min(0).max(100),
  remittanceCapMinor: z.number().int().nonnegative(),
  reservationFreeReleaseSec: z.number().int().nonnegative(),
  airport: AirportConfigSchema,
  taxes: z.record(z.number()),
  /** Absent ⇒ the negotiated-fare marketplace is not configured here: fail closed. */
  marketplace: MarketplacePolicySchema.optional(),
});

export type CityConfig = z.infer<typeof CityConfigSchema>;

/**
 * The only way to read marketplace fare bounds. Throws the fail-closed error
 * when the city has no policy or the service/vehicle pair is unconfigured.
 */
export function marketplaceBoundsFor(
  config: CityConfig,
  service: "ride" | "delivery",
  vehicleClass: string,
): MarketplaceFareBounds {
  const bounds = config.marketplace?.fareBounds[`${service}:${vehicleClass}`];
  if (bounds === undefined) {
    throw new Error(
      `city ${config.cityId} v${config.version} has no marketplace fare bounds for "${service}:${vehicleClass}" — market not configured, failing closed`,
    );
  }
  return bounds;
}

export function fareTableFor(
  config: CityConfig,
  vehicleClass: string,
): FareTable {
  const table = config.fares[vehicleClass];
  if (table === undefined) {
    throw new Error(
      `city ${config.cityId} v${config.version} has no fare table for vehicle class "${vehicleClass}"`,
    );
  }
  return table;
}

export function paymentMethodAvailable(
  config: CityConfig,
  methodId: string,
): boolean {
  return config.paymentMethods.some((m) => m.id === methodId && m.available);
}

export function kycTier(config: CityConfig, tier: string): KycTier {
  const found = config.kycTiers.find((t) => t.tier === tier);
  if (found === undefined) {
    throw new Error(`city ${config.cityId} has no KYC tier "${tier}"`);
  }
  return found;
}

/**
 * Where a city is on its way to launch. The marketing site and the ops console
 * render ONLY from this: `active` cities show services from their flags,
 * `launching` cities are announced without a date, `planned` cities are named
 * as intent, `paused` cities show nothing as live.
 */
export const CITY_STATUSES = [
  "planned",
  "launching",
  "active",
  "paused",
] as const;
export type CityStatus = (typeof CITY_STATUSES)[number];

export const CityStatusSchema = z.enum(CITY_STATUSES);

/** `GET /v1/config/cities` row (contracts/openapi/support-config.yaml). */
export const CitySummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  country: z.string().length(2),
  region: z.string().min(1).nullable(),
  timezone: z.string().min(1),
  status: CityStatusSchema,
  /** Derived from `status` (`active` only); kept for readers that predate it. */
  active: z.boolean(),
  /**
   * Cities that must go live together. A status change to `active` fails with
   * `launch_pair_incomplete` unless every city in the group is active after it.
   */
  launchGroup: z.string().min(1).nullable(),
});
export type CitySummary = z.infer<typeof CitySummarySchema>;

export function cityIsActive(status: CityStatus): boolean {
  return status === "active";
}
