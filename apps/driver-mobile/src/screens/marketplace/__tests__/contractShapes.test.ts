// Consumer-side checks of the @ubi/contracts shapes this slice depends on:
//  - a market's stop limits (MarketplacePolicy.stops) survive schema parsing, so the
//    server-derived maxStopsCeiling the preferences screen offers is the market's real
//    limit rather than a silently-restored pilot default;
//  - the preferences PATCH contract has no auto-bid switch (unknown keys are refused);
//  - the fleet remittance can only be an explicit none with a null amount.
import {
  MP_MULTI_STOP_PILOT_DEFAULTS,
  MarketplacePolicySchema,
  MpDriverPreferencesPatchSchema,
  MpEarningsBreakdownSchema,
  MpFeedItemSchema,
} from "@ubi/contracts";

const bounds = {
  absoluteFloorMinor: 40_000,
  costFloorMinor: 45_000,
  floorBpsOfSuggested: 7_000,
  ceilingBpsOfSuggested: 20_000,
};
const policy = (extra: Record<string, unknown> = {}) => ({
  policyVersion: 1,
  commissionBps: 1_000,
  commissionRounding: "half_up",
  fareBounds: { "ride:go": bounds },
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
  queue: { pickupWindowToleranceSec: 300 },
  rateProfileBounds: {
    "ride:go": { maxPerKmMinor: 50_000, maxMinimumTripFareMinor: 500_000 },
  },
  ...extra,
});

describe("contract shapes used by driver economics", () => {
  it("keeps a market's stop limits through MarketplacePolicySchema", () => {
    const stops = {
      maxIntermediateStops: 2,
      defaultDwellSec: 90,
      maxDwellSec: 300,
    };
    expect(MarketplacePolicySchema.parse(policy({ stops })).stops).toEqual(
      stops,
    );
    // Absent stays absent: the pilot defaults apply server-side, not by parsing.
    expect(MarketplacePolicySchema.parse(policy()).stops).toBeUndefined();
    expect(MP_MULTI_STOP_PILOT_DEFAULTS.maxIntermediateStops).toBe(3);
    // An incoherent stop policy is refused, not stripped.
    expect(() =>
      MarketplacePolicySchema.parse(
        policy({
          stops: {
            maxIntermediateStops: 2,
            defaultDwellSec: 900,
            maxDwellSec: 300,
          },
        }),
      ),
    ).toThrow();
  });

  it("refuses an auto-bid (or any unknown) key in the preferences PATCH", () => {
    expect(() =>
      MpDriverPreferencesPatchSchema.parse({
        expectedVersion: 1,
        autoBid: true,
      }),
    ).toThrow();
    expect(() =>
      MpDriverPreferencesPatchSchema.parse({ maxStops: 1 }),
    ).toThrow();
    expect(
      MpDriverPreferencesPatchSchema.parse({
        expectedVersion: 1,
        minimumTripAmountMinor: null,
      }),
    ).toEqual({ expectedVersion: 1, minimumTripAmountMinor: null });
  });

  it("allows a fleet remittance only as an explicit none with a null amount", () => {
    const remittance = (amountMinor: unknown) => ({
      grossMinor: { amountMinor: 45_000, currency: "NGN" },
      grossBasis: "requested_fare",
      commissionMinor: { amountMinor: 4_500, currency: "NGN" },
      commissionBps: 1_000,
      fleetRemittance: {
        status: "none",
        amountMinor,
        reason: "No fleet arrangement applies.",
      },
      estimatedNetMinor: { amountMinor: 40_500, currency: "NGN" },
      pickup: {
        distanceMeters: null,
        distanceBasis: "unavailable",
        durationSec: null,
        durationBasis: "unavailable",
        estimate: true,
        paid: false,
        label: "Pickup distance unavailable without a recent location",
      },
      route: null,
      estimatedNetPerHour: null,
      runningCosts: {
        status: "not_estimated",
        reason: "No fuel or energy input is disclosed.",
      },
      disclaimer: "Estimates are not guaranteed earnings.",
    });
    expect(() =>
      MpEarningsBreakdownSchema.parse(remittance(null)),
    ).not.toThrow();
    expect(() =>
      MpEarningsBreakdownSchema.parse(
        remittance({ amountMinor: 0, currency: "NGN" }),
      ),
    ).toThrow();
    // A card without a breakdown (older server) still parses; one with it keeps it.
    const card = {
      requestId: "req_1",
      revision: 1,
      service: "ride",
      title: "Ride request · go",
      meta: "Area → Area",
      askedMinor: { amountMinor: 45_000, currency: "NGN" },
      askedByLabel: "Requester asks",
      capabilityBadge: null,
      expiresAt: new Date().toISOString(),
    };
    expect(MpFeedItemSchema.parse(card).earnings).toBeUndefined();
    expect(
      MpFeedItemSchema.parse({ ...card, earnings: remittance(null) }).earnings,
    ).toBeDefined();
  });
});
