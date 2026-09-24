/**
 * Seed data for the cross-service contract test against the REAL ride-service
 * and payment-service processes (tests/ride-service-contract.test.ts): a city
 * whose ACTIVE config version both services read (the canonical city config,
 * ride-service's marketplace policy block and payment-service's wallet policy
 * block), the flags both gate on, and funded wallets.
 *
 * The numbers are test data — the same round, deliberately-not-Lagos values
 * ride-service's own harness uses (internal/testutil/fixtures.go) and
 * payment-service's ledger helpers use (tests/ledger/helpers.ts). A wallet's
 * opening balance is a top-up journal entry, the way a real top-up leaves it;
 * everything after that is the services' own postings.
 */
import { uid } from "./helpers";

import type { AskDb } from "../src/ops/types";

const FARE_BOUNDS = {
  absoluteFloorMinor: 40_000,
  costFloorMinor: 45_000,
  floorBpsOfSuggested: 7_000,
  ceilingBpsOfSuggested: 20_000,
};
const RATE_BOUNDS = {
  maxPerKmMinor: 50_000,
  maxMinimumTripFareMinor: 500_000,
};

interface CityOptions {
  /** ride-service's bid revision cooldown (the harness default is 15 s). */
  readonly revisionCooldownSec?: number;
}

function cityConfig(
  cityId: string,
  options: CityOptions = {},
): Record<string, unknown> {
  return {
    cityId,
    version: 1,
    currency: "NGN",
    currencyFractionDigits: 2,
    locale: "en-NG",
    timezone: "Africa/Lagos",
    emergencyNumber: "112",
    vehicleClasses: ["go", "comfort"],
    fares: {
      go: {
        baseMinor: 10_000,
        perKmMinor: 5_000,
        perMinMinor: 1_000,
        bookingFeeMinor: 2_000,
        minFareMinor: 50_000,
      },
      comfort: {
        baseMinor: 20_000,
        perKmMinor: 8_000,
        perMinMinor: 2_000,
        bookingFeeMinor: 2_000,
        minFareMinor: 90_000,
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
    ],
    arrivedGeofenceMeters: 150,
    maxPinAttempts: 3,
    paymentMethods: [
      { id: "cash", available: true },
      { id: "wallet", available: true },
      { id: "card", available: false, reason: "no acquirer in this city yet" },
    ],
    kycTiers: [
      {
        tier: "tier1",
        dailyOutMinor: 5_000_000,
        singleTransferMinor: 2_000_000,
        balanceCapMinor: 30_000_000,
      },
    ],
    serviceFeePct: 20,
    remittanceCapMinor: 5_000_000,
    reservationFreeReleaseSec: 900,
    airport: {
      codes: ["LOS"],
      arrivalBufferMin: 20,
      checkInCutoffMin: 90,
      trafficBufferMin: 45,
      doors: { international_arrivals: "Arrivals Door C" },
    },
    taxes: { vat: 7.5 },
    walletPolicy: {
      velocityWindowMinutes: 60,
      velocityMaxTransfers: 20,
      velocityMaxAmountMinor: 100_000_000,
      newRecipientHoldAboveMinor: 100_000_000,
      pinLockMinutes: 30,
      pinResetCoolingMinutes: 120,
      pinResetCoolingCapMinor: 500_000,
      returnRequestWindowHours: 48,
      disputeWindowHours: 48,
      nipReversalWindowHours: 24,
      riskReviewSlaMinutes: 60,
      reconBreakSlaHours: 24,
    },
    marketplace: {
      policyVersion: 1,
      commissionBps: 1_000,
      commissionRounding: "half_up",
      fareBounds: {
        "ride:go": FARE_BOUNDS,
        "ride:comfort": FARE_BOUNDS,
        "delivery:go": FARE_BOUNDS,
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
        revisionCooldownSec: options.revisionCooldownSec ?? 15,
        maxLiveBidsPerDriver: 3,
        maxOpenRequestsPerRequester: 2,
      },
      queue: { pickupWindowToleranceSec: 300 },
      stops: {
        maxIntermediateStops: 3,
        defaultDwellSec: 120,
        maxDwellSec: 600,
        paidWaiting: {
          perMinMinor: 1_000,
          maxAuthorizedMinor: 5_000,
          excessiveAfterSec: 900,
        },
        amendmentApprovalSec: 180,
      },
      rateProfileBounds: {
        "ride:go": RATE_BOUNDS,
        "ride:comfort": RATE_BOUNDS,
        "delivery:go": RATE_BOUNDS,
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
        },
        recurring: {
          generationHorizonDays: 7,
          maxActiveTemplatesPerRequester: 5,
          maxSeriesDays: 366,
        },
      },
    },
  };
}

/** A short city id: ride-service's own harness uses 8 characters. */
export function contractCityId(): string {
  return `T${Math.random().toString(36).slice(2, 9)}`;
}

/** Seeds the city, its active config version and the flags. */
export async function seedMarketplaceCity(
  db: AskDb,
  cityId: string,
  options: CityOptions = {},
): Promise<void> {
  await db.city.create({
    data: {
      id: cityId,
      name: cityId,
      country: "NG",
      timezone: "Africa/Lagos",
      active: true,
    },
  });
  await db.cityConfigVersion.create({
    data: {
      id: uid("cfg"),
      cityId,
      version: 1,
      config: cityConfig(cityId, options) as never,
      activatedAt: new Date(),
      createdBy: "ask-contract-seed",
      approvedBy: "ask-contract-approver",
    },
  });
  const flags: Record<string, boolean> = {
    move: true,
    ride_request: true,
    driver_online: true,
    marketplace_rides: true,
    ai_assistant: true,
    ai_transactions: true,
    ai_marketplace: true,
  };
  for (const [key, enabled] of Object.entries(flags)) {
    await db.featureFlag.upsert({
      where: { key },
      create: { key, defaultOn: false },
      update: {},
    });
    await db.flagRule.upsert({
      where: { flagKey_cityId: { flagKey: key, cityId } },
      create: { id: uid("rule"), flagKey: key, cityId, enabled },
      update: { enabled },
    });
  }
}

/** A wallet with an opening balance, the way a top-up would leave it. */
export async function fundWallet(
  db: AskDb,
  ownerId: string,
  amountMinor: number,
): Promise<string> {
  const walletId = uid("wal");
  await db.wallet.create({
    data: {
      id: walletId,
      ownerType: "user",
      ownerId,
      currency: "NGN",
      tier: "tier1",
    },
  });
  await db.$transaction(async (tx) => {
    const entryId = uid("je");
    await tx.journalEntry.create({
      data: {
        id: entryId,
        kind: "topup",
        reference: `topup:${walletId}`,
        occurredAt: new Date(),
      },
    });
    await tx.journalLine.createMany({
      data: [
        {
          id: uid("jl"),
          entryId,
          account: "psp_settlement",
          walletId: null,
          amountMinor: BigInt(-amountMinor),
          currency: "NGN",
          counterpartRef: `wallet:${walletId}`,
        },
        {
          id: uid("jl"),
          entryId,
          account: "wallet",
          walletId,
          amountMinor: BigInt(amountMinor),
          currency: "NGN",
          counterpartRef: `topup:${walletId}`,
        },
      ],
    });
  });
  return walletId;
}
