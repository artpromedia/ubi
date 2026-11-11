/**
 * Lagos (LOS) launch configuration and the deny-by-default flag registry.
 *
 * This module NEVER runs against production. The handoff forbids production
 * seeding, so `assertSeedAllowed` refuses when NODE_ENV is production and
 * requires an explicit CONFIG_SEED_ENABLED=true opt-in everywhere else.
 *
 * Board numbers (slice 01): currency NGN with 2 fraction digits, emergency 112,
 * classes go/comfort/xl (no moto in Lagos), 5:00 free wait then ₦50/min,
 * ₦300 rider cancellation after assignment and ₦0 for a driver cancellation,
 * PIN mandatory, quote TTL 300s, offer TTL 12s, service fee 20%, and
 * cash/card/bank_transfer/wallet as payment methods.
 *
 * The per-class fare tables, KYC limits and remittance cap are NOT on the board
 * for this slice. The values below are PROVISIONAL launch defaults: real,
 * internally-consistent NGN figures (kobo) chosen so the service is not seeded
 * with broken sentinels, but every one still REQUIRES ops/finance sign-off
 * before Lagos goes live. Each block is annotated where the number was set.
 */
import {
  type CityConfig,
  CityConfigSchema,
  ContractError,
  MP_RISK_REMATCH_MARGIN_SEC,
} from "@ubi/contracts";

import { LAGOS_CITY } from "./cities";
import { type SeedResult, seedCityConfig } from "./city-config";
import { GLOBAL_SCOPE } from "../lib/cache";

export { LAGOS_CITY };
export type { SeedResult };

/** Flags on for the Lagos launch. Everything else stays off (CLAUDE.md #5). */
export const LAGOS_ENABLED_FLAGS = [
  "move",
  "ride_request",
  "driver_online",
] as const;

export function lagosConfig(version: number): CityConfig {
  return CityConfigSchema.parse({
    cityId: LAGOS_CITY.id,
    version,
    currency: "NGN",
    currencyFractionDigits: 2,
    locale: "en-NG",
    timezone: LAGOS_CITY.timezone,
    emergencyNumber: "112",
    supportPhone: "+23417000824",
    vehicleClasses: ["go", "comfort", "xl"],
    // PROVISIONAL, pending ops/finance sign-off — not on the slice 01 board.
    // NGN kobo (minor units; 100 kobo = ₦1). Defensible 2026 Lagos ride-hailing
    // defaults, monotonic across classes: comfort > go and xl > comfort on
    // base and perKm (and, deliberately, on perMin and minFare too). The
    // platform booking fee is flat at ₦100 across classes. Worked example, an
    // 8 km / 20 min trip: go ₦2,640, comfort ₦3,620, xl ₦4,960.
    fares: {
      go: {
        baseMinor: 60_000, // ₦600 base
        perKmMinor: 18_000, // ₦180/km
        perMinMinor: 2_500, // ₦25/min
        bookingFeeMinor: 10_000, // ₦100 flat platform booking fee
        minFareMinor: 120_000, // ₦1,200 floor
      },
      comfort: {
        baseMinor: 90_000, // ₦900 base
        perKmMinor: 24_000, // ₦240/km
        perMinMinor: 3_500, // ₦35/min
        bookingFeeMinor: 10_000, // ₦100 flat platform booking fee
        minFareMinor: 180_000, // ₦1,800 floor
      },
      xl: {
        baseMinor: 140_000, // ₦1,400 base
        perKmMinor: 32_000, // ₦320/km
        perMinMinor: 4_500, // ₦45/min
        bookingFeeMinor: 10_000, // ₦100 flat platform booking fee
        minFareMinor: 260_000, // ₦2,600 floor
      },
    },
    waitPolicy: { freeSec: 300, perMinMinor: 5_000 },
    cancelPolicy: {
      riderFeeAfterAssignMinor: 30_000,
      driverFeeMinor: 0,
      freeWindowSec: 120,
    },
    pinRequired: true,
    quoteTtlSec: 300,
    offerTtlSec: 12,
    matchingRings: [
      { radiusMeters: 2_000, maxCandidates: 5 },
      { radiusMeters: 4_000, maxCandidates: 8 },
      { radiusMeters: 7_000, maxCandidates: 12 },
    ],
    arrivedGeofenceMeters: 120,
    maxPinAttempts: 3,
    paymentMethods: [
      { id: "cash", available: true },
      { id: "card", available: true },
      { id: "bank_transfer", available: true },
      { id: "wallet", available: true },
    ],
    // PROVISIONAL, pending ops/finance sign-off — KYC limits are not on the
    // slice 01 board. CBN-style three-tier ladder in NGN kobo: tier1 is the
    // most restrictive (a new wallet starts here — the payment service derives
    // the entry tier from the lowest dailyOut, so tier1 must stay lowest) and
    // tier3 is fully-KYC'd with an uncapped balance. Every limit is strictly
    // increasing across tiers; null balanceCap means "no cap" (tier3 only),
    // not an unset sentinel. Aligns with the CBN three-tier framework
    // (~₦50k/₦300k, ₦200k/₦500k, unlimited-with-full-KYC).
    kycTiers: [
      {
        tier: "tier1", // minimal KYC (name + phone/BVN): lowest ceilings
        dailyOutMinor: 5_000_000, // ₦50,000/day out
        singleTransferMinor: 2_000_000, // ₦20,000 per transfer
        balanceCapMinor: 30_000_000, // ₦300,000 balance cap
      },
      {
        tier: "tier2", // BVN + verified ID/address
        dailyOutMinor: 20_000_000, // ₦200,000/day out
        singleTransferMinor: 10_000_000, // ₦100,000 per transfer
        balanceCapMinor: 50_000_000, // ₦500,000 balance cap
      },
      {
        tier: "tier3", // full KYC: highest ceilings, uncapped balance
        dailyOutMinor: 500_000_000, // ₦5,000,000/day out
        singleTransferMinor: 100_000_000, // ₦1,000,000 per transfer
        balanceCapMinor: null, // no balance cap
      },
    ],
    serviceFeePct: 20,
    // PROVISIONAL, pending ops/finance sign-off — remittance cap is not on the
    // slice 01 board. Ceiling on a fleet's WEEKLY remittance from a driver
    // (slice 10 fleet: "weekly remittance or % of net, ≤ cap from config"),
    // in NGN kobo. ₦150,000/week — comfortably above legitimate Lagos
    // hire-purchase / vehicle-financing arrangements (typically ≤ ₦100k/week,
    // more for XL) while capping exploitative terms.
    remittanceCapMinor: 15_000_000,
    reservationFreeReleaseSec: 900,
    airport: {
      codes: ["LOS"],
      arrivalBufferMin: 20,
      checkInCutoffMin: 90,
      trafficBufferMin: 45,
      doors: {
        international_arrivals: "Arrivals Door C",
        domestic_arrivals: "Domestic Arrivals Door 2",
        international_departures: "Departures Door D",
        domestic_departures: "Domestic Departures Door 1",
      },
    },
    taxes: { vat: 7.5 },
    // PROVISIONAL dev/test marketplace policy (CC-A05, DEC-2 = A). All
    // marketplace flags stay OFF in LAGOS_ENABLED_FLAGS, and assertSeedAllowed
    // forbids running this seed in production.
    marketplace: {
      policyVersion: 1,
      commissionBps: 1_000,
      commissionRounding: "half_up",
      fareBounds: {
        "ride:go": {
          absoluteFloorMinor: 80_000,
          costFloorMinor: 90_000,
          floorBpsOfSuggested: 7_000,
          ceilingBpsOfSuggested: 20_000,
        },
        "ride:comfort": {
          absoluteFloorMinor: 120_000,
          costFloorMinor: 135_000,
          floorBpsOfSuggested: 7_000,
          ceilingBpsOfSuggested: 20_000,
        },
        "ride:xl": {
          absoluteFloorMinor: 180_000,
          costFloorMinor: 200_000,
          floorBpsOfSuggested: 7_000,
          ceilingBpsOfSuggested: 20_000,
        },
      },
      searchEnvelope: {
        initialRadiusMeters: 3_000,
        maxRadiusMeters: 9_000,
        initialPickupEtaSec: 600,
        maxPickupEtaSec: 1_500,
        expandAfterSec: 30,
        minOffersBeforeExpand: 2,
        expansionSteps: 3,
      },
      stationary: {
        minDwellSec: 60,
        maxSpeedMps: 1.5,
        maxLocationAgeSec: 120,
        maxAccuracyMeters: 50,
        motionCloseSec: 20,
      },
      finishingTrip: {
        maxRemainingSec: 600,
        completionBufferSec: 120,
        uncertaintyBufferSec: 60,
        corridorMaxBearingDeltaDeg: 90,
      },
      bids: {
        bidExpirySec: 120,
        requestExpirySec: 600,
        revisionCooldownSec: 15,
        maxLiveBidsPerDriver: 3,
        maxOpenRequestsPerRequester: 2,
      },
      queue: {
        pickupWindowToleranceSec: 300,
      },
      rateProfileBounds: {
        "ride:go": {
          maxPerKmMinor: 50_000,
          maxMinimumTripFareMinor: 500_000,
        },
        "ride:comfort": {
          maxPerKmMinor: 70_000,
          maxMinimumTripFareMinor: 700_000,
        },
        "ride:xl": {
          maxPerKmMinor: 100_000,
          maxMinimumTripFareMinor: 1_000_000,
        },
      },
      scheduling: {
        scheduledRequests: {
          publishLeadSec: 1_800,
          minLeadSec: 3_600,
          maxHorizonSec: 1_209_600,
          defaultWindowSec: 600,
          minWindowSec: 300,
          maxWindowSec: 1_800,
          reminderOffsetsSec: [43_200, 3_600],
          maxPendingPerRequester: 10,
        },
        advanceReservations: {
          bookingHorizonSec: 604_800,
          minLeadSec: 10_800,
          offerWindowSec: 3_600,
          bidExpirySec: 3_600,
          defaultWindowSec: 600,
          minWindowSec: 300,
          maxWindowSec: 1_800,
          fundingHorizonSec: 172_800,
          fundingDeadlineSec: 7_200,
          reconfirmOpensSec: 7_200,
          reconfirmDeadlineSec: 2_700,
          activationLeadSec: 1_800,
          preBufferSec: 600,
          postBufferSec: 600,
          reminderOffsetsSec: [43_200, 3_600],
          maxOpenPerRequester: 5,
          // DEC-2 = A: minLeadSec (3 h) + MP_RISK_REMATCH_MARGIN_SEC (15 min)
          // = 11,700 s (3 h 15 min), so a lapse at the pickup − lead deadline
          // leaves the 15-min margin required to offer a same-fare rematch.
          riskResolutionLeadSec: 10_800 + MP_RISK_REMATCH_MARGIN_SEC,
        },
        recurring: {
          generationHorizonDays: 7,
          maxActiveTemplatesPerRequester: 5,
          maxSeriesDays: 366,
        },
      },
    },
    // PROVISIONAL dev/test fleet policy + KYB requirements (CC-C02, DEC-5).
    // The `fleet` flag stays OFF in LAGOS_ENABLED_FLAGS.
    fleet: {
      proposalTtlHours: 48,
      documentWarningDays: [30, 14, 7, 1],
      utilisationMinDays: 7,
      terminationNoticeDays: 14,
      shifts: {
        day: { start: "06:00", end: "18:00" },
        night: { start: "18:00", end: "06:00" },
      },
      availabilityCheckHorizonDays: 60,
      kyb: {
        requirements: [
          {
            key: "cac_certificate",
            label: "CAC Certificate of Incorporation",
            kind: "document",
            required: true,
          },
          {
            key: "tax_identification_number",
            label: "FIRS Tax Identification Number (TIN)",
            kind: "text",
            required: true,
          },
          {
            key: "director_identity",
            label: "Director Government ID",
            kind: "document",
            required: true,
          },
          {
            key: "proof_of_office",
            label: "Proof of Registered Office",
            kind: "document",
            required: false,
          },
        ],
      },
    },
    // PROVISIONAL, pending ops/finance sign-off — pilot driver ops credit caps
    // (CC-B03, DEC-6=C), in NGN kobo. Gated by `ops_driver_wallet_credit`, which
    // stays OFF in LAGOS_ENABLED_FLAGS.
    opsCreditPolicy: {
      maxPerCreditMinor: 2_500_000, // ₦25,000 per single credit
      maxDriverDailyMinor: 5_000_000, // ₦50,000 per driver per Lagos calendar day
      maxCityDailyMinor: 100_000_000, // ₦1,000,000 across Lagos per calendar day
      reasonCodes: [
        "pilot_onboarding_float",
        "bank_deposit_verified",
        "goodwill_commission_relief",
        "ops_settlement_adjustment",
      ],
    },
  });
}

/** Shaped like `process.env` so the guards can be exercised with a plain object. */
export interface SeedEnv {
  readonly [key: string]: string | undefined;
}

/**
 * Two independent guards, because a seed that reaches production would write
 * fares and policies nobody approved.
 */
export function assertSeedAllowed(env: SeedEnv = process.env): void {
  const nodeEnv = env.NODE_ENV ?? "development";
  if (nodeEnv === "production") {
    throw new ContractError(
      "forbidden",
      "seeding is not permitted in production",
    );
  }
  if (env.CONFIG_SEED_ENABLED !== "true") {
    throw new ContractError(
      "forbidden",
      "seeding requires CONFIG_SEED_ENABLED=true",
    );
  }
}

/**
 * Idempotent: a second run activates nothing. Lagos is seeded with status
 * `launching` (the launch plan) and its launch-day flags on, so the ride flow
 * can be exercised in dev and test while nothing reads as publicly live.
 */
export async function seedLagos(
  env: SeedEnv = process.env,
): Promise<SeedResult> {
  assertSeedAllowed(env);
  const result = await seedCityConfig({
    city: LAGOS_CITY,
    config: lagosConfig,
    enabledFlags: LAGOS_ENABLED_FLAGS,
    reason: "initial lagos configuration",
  });
  return result;
}

/** Cache scopes a caller should invalidate after seeding into a running system. */
export const SEED_CACHE_SCOPES = [LAGOS_CITY.id, GLOBAL_SCOPE] as const;
