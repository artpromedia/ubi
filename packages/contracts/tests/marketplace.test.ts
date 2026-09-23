import { describe, expect, it } from "vitest";

import {
  MP_ELIGIBILITY_REASONS,
  MP_MULTI_STOP_PILOT_DEFAULTS,
  MP_STOP_PURPOSES,
  MpFeedItemSchema,
  MpMultiStopPolicySchema,
  MpQuoteEnvelopeSchema,
  MpRequestSchema,
  MpSelectBidSchema,
  MpStopInputSchema,
  MpSubmitBidSchema,
  commissionMinorFor,
  mpQuoteStopsParam,
} from "../src/marketplace";
import { DENY_ALL, FLAG_KEYS, isEnabled } from "../src/flags";
import {
  MarketplacePolicySchema,
  marketplaceBoundsFor,
  type CityConfig,
} from "../src/city-config";
import { allowedTransitions, assertTransition } from "../src/state-machines";
import { statusForErrorCode } from "../src/errors";

describe("marketplace commission", () => {
  it("implements the worked example: ₦5,000 fare → ₦500 fee (minor units)", () => {
    // Section 3 worked example. 10% of 500,000 kobo = 50,000 kobo.
    expect(commissionMinorFor(500_000)).toBe(50_000);
  });

  it("rounds half-up at the minor unit", () => {
    expect(commissionMinorFor(5)).toBe(1); // 0.5 → 1
    expect(commissionMinorFor(4)).toBe(0); // 0.4 → 0
    expect(commissionMinorFor(15)).toBe(2); // 1.5 → 2
    expect(commissionMinorFor(14)).toBe(1); // 1.4 → 1
    expect(commissionMinorFor(0)).toBe(0);
  });

  it("refuses non-integer and negative bases", () => {
    expect(() => commissionMinorFor(10.5)).toThrow(TypeError);
    expect(() => commissionMinorFor(-1)).toThrow(TypeError);
  });
});

describe("marketplace flags", () => {
  it("denies rides, delivery and queued jobs by default", () => {
    for (const key of [
      "marketplace_rides",
      "marketplace_delivery",
      "marketplace_queued_jobs",
      "marketplace_multi_stop",
    ] as const) {
      expect(FLAG_KEYS).toContain(key);
      expect(isEnabled(undefined, key)).toBe(false);
      expect(isEnabled({}, key)).toBe(false);
      expect(isEnabled(DENY_ALL, key)).toBe(false);
    }
  });
});

describe("marketplace policy (fail closed)", () => {
  it("rejects any commission other than 1,000 bps", () => {
    const base = {
      policyVersion: 1,
      commissionBps: 1_000,
      commissionRounding: "half_up",
      fareBounds: {},
      searchEnvelope: {
        initialRadiusMeters: 3_000,
        maxRadiusMeters: 8_000,
        initialPickupEtaSec: 480,
        maxPickupEtaSec: 900,
        expandAfterSec: 90,
        minOffersBeforeExpand: 2,
        expansionSteps: 3,
      },
      stationary: {
        minDwellSec: 45,
        maxSpeedMps: 1.5,
        maxLocationAgeSec: 30,
        maxAccuracyMeters: 50,
        motionCloseSec: 10,
      },
      finishingTrip: {
        maxRemainingSec: 600,
        completionBufferSec: 120,
        uncertaintyBufferSec: 90,
        corridorMaxBearingDeltaDeg: 75,
      },
      bids: {
        bidExpirySec: 300,
        requestExpirySec: 600,
        revisionCooldownSec: 20,
        maxLiveBidsPerDriver: 3,
        maxOpenRequestsPerRequester: 2,
      },
      queue: { pickupWindowToleranceSec: 300 },
      rateProfileBounds: {},
    };
    expect(MarketplacePolicySchema.safeParse(base).success).toBe(true);
    expect(
      MarketplacePolicySchema.safeParse({ ...base, commissionBps: 1_500 })
        .success,
    ).toBe(false);
    expect(
      MarketplacePolicySchema.safeParse({ ...base, commissionBps: 500 })
        .success,
    ).toBe(false);
  });

  it("throws for a city without marketplace bounds instead of inventing a floor", () => {
    const config = {
      cityId: "lagos",
      version: 3,
      marketplace: undefined,
    } as unknown as CityConfig;
    expect(() => marketplaceBoundsFor(config, "ride", "go")).toThrow(
      /market not configured/,
    );
  });

  it("maps market_not_configured to 503 and fare_out_of_bounds to 422", () => {
    expect(statusForErrorCode("market_not_configured")).toBe(503);
    expect(statusForErrorCode("fare_out_of_bounds")).toBe(422);
    expect(statusForErrorCode("insufficient_spendable")).toBe(422);
    expect(statusForErrorCode("award_unresolved")).toBe(409);
  });
});

describe("marketplace state machines", () => {
  it("keeps award_pending out of any timeout path except explicit resolution", () => {
    // No transition from award_pending to expired/no_offers: an unresolved
    // debit can never be timed out back into the pool (M05 rule 6).
    expect(allowedTransitions("mpRequest", "award_pending")).toEqual([
      "awarded",
      "open",
      "cancelled",
    ]);
  });

  it("only promotes a next claim into current, exactly once", () => {
    expect(allowedTransitions("mpClaim", "next")).toEqual([
      "current",
      "released",
    ]);
    expect(allowedTransitions("mpClaim", "completed")).toEqual([]);
  });

  it("reverses a captured hold via a new state, never by re-opening it", () => {
    expect(allowedTransitions("mpHold", "captured")).toEqual(["reversed"]);
    expect(() => assertTransition("mpHold", "captured", "active")).toThrow();
    expect(() => assertTransition("mpHold", "released", "active")).toThrow();
  });

  it("returns a failed selection's bid to a live state, not a terminal one", () => {
    expect(allowedTransitions("mpBid", "selected_pending")).toContain(
      "submitted",
    );
    expect(allowedTransitions("mpBid", "selected_pending")).toContain(
      "revised",
    );
    expect(() => assertTransition("mpBid", "won", "lost")).toThrow();
  });
});

describe("marketplace wire schemas", () => {
  it("requires a dependency for next-slot bids to be expressible", () => {
    const bid = MpSubmitBidSchema.parse({
      requestId: "req_1",
      requestRevision: 1,
      amountMinor: { amountMinor: 280_000, currency: "NGN" },
      slot: "next",
      dependsOnClaimId: "claim_9",
      availabilityEpoch: 4,
    });
    expect(bid.dependsOnClaimId).toBe("claim_9");
  });

  it("pins both versions on selection", () => {
    expect(
      MpSelectBidSchema.safeParse({ bidId: "bid_1", requestVersion: 2 })
        .success,
    ).toBe(false);
    expect(
      MpSelectBidSchema.safeParse({
        bidId: "bid_1",
        requestVersion: 2,
        bidVersion: 1,
      }).success,
    ).toBe(true);
  });

  it("keeps the quote envelope's bounds and pricing version mandatory", () => {
    const missingBounds = MpQuoteEnvelopeSchema.safeParse({
      quoteId: "q1",
      service: "ride",
      vehicleClass: "go",
      cityId: "lagos",
      currency: "NGN",
      suggestedFareMinor: { amountMinor: 280_000, currency: "NGN" },
      expiresAt: new Date(0).toISOString(),
      pricingVersion: "2026-09-01",
      policyVersion: 1,
      breakdown: [],
      routedDistanceMeters: 12_400,
      routedDurationSec: 1_680,
    });
    expect(missingBounds.success).toBe(false);
  });

  it("covers every D10 board reason with a machine-readable code", () => {
    for (const code of [
      "OUTSIDE_RADIUS",
      "PICKUP_ETA_TOO_LONG",
      "LOCATION_STALE",
      "NOT_STATIONARY",
      "UNSUPPORTED_CAPABILITY",
      "NOT_NEAR_COMPLETION",
      "SLOT_FULL",
    ]) {
      expect(MP_ELIGIBILITY_REASONS).toContain(code);
    }
  });
});

describe("marketplace multiple stops (A02)", () => {
  const envelope = {
    quoteId: "q1",
    service: "ride",
    vehicleClass: "go",
    cityId: "lagos",
    currency: "NGN",
    suggestedFareMinor: { amountMinor: 280_000, currency: "NGN" },
    minimumFareMinor: { amountMinor: 200_000, currency: "NGN" },
    maximumFareMinor: { amountMinor: 560_000, currency: "NGN" },
    expiresAt: new Date(0).toISOString(),
    pricingVersion: "engine.v1/cfg.1",
    policyVersion: 1,
    breakdown: [],
    routedDistanceMeters: 12_400,
    routedDurationSec: 1_680,
  };
  const stop = {
    stopId: "5b0e6d7e-0000-4000-8000-000000000001",
    order: 1,
    label: "School gate",
    lat: 6.53,
    lng: 3.38,
    purpose: "drop_passenger",
    dwellSec: 120,
  };

  it("keeps a plain quote/request valid with no route fields at all", () => {
    expect(MpQuoteEnvelopeSchema.safeParse(envelope).success).toBe(true);
  });

  it("documents stops, dwell and the route fingerprint on a multi-stop quote", () => {
    const parsed = MpQuoteEnvelopeSchema.parse({
      ...envelope,
      stops: [stop],
      stopsDwellSec: 120,
      routeFingerprint: "rt_abc",
    });
    expect(parsed.stops?.[0]?.stopId).toBe(stop.stopId);
    expect(
      MpQuoteEnvelopeSchema.safeParse({
        ...envelope,
        stops: [{ ...stop, purpose: "joyride" }],
      }).success,
    ).toBe(false);
  });

  it("carries the route revision on the owner's request view", () => {
    const request = MpRequestSchema.shape;
    expect(request.stops).toBeDefined();
    expect(request.routeRevision).toBeDefined();
    expect(request.routeFingerprint).toBeDefined();
  });

  it("never lets a stop input name an id, an order or a price", () => {
    expect(
      MpStopInputSchema.safeParse({ lat: 6.5, lng: 3.3, stopId: "x" }).success,
    ).toBe(false);
    expect(
      MpStopInputSchema.safeParse({ lat: 6.5, lng: 3.3, order: 1 }).success,
    ).toBe(false);
    expect(
      MpStopInputSchema.safeParse({ lat: 6.5, lng: 3.3, fareMinor: 1 }).success,
    ).toBe(false);
    expect(MpStopInputSchema.safeParse({ lat: 91, lng: 3.3 }).success).toBe(
      false,
    );
    expect(
      MpStopInputSchema.safeParse({ lat: 6.5, lng: 3.3, dwellSec: -1 }).success,
    ).toBe(false);
  });

  it("encodes the quote's stops parameter from validated input only", () => {
    const encoded = mpQuoteStopsParam([
      { lat: 6.53, lng: 3.38, purpose: "errand", dwellSec: 60 },
    ]);
    expect(JSON.parse(encoded)).toEqual([
      { lat: 6.53, lng: 3.38, purpose: "errand", dwellSec: 60 },
    ]);
    expect(() =>
      mpQuoteStopsParam([
        { lat: 6.53, lng: 3.38, stopId: "x" } as unknown as {
          lat: number;
          lng: number;
        },
      ]),
    ).toThrow();
  });

  it("shows drivers only coarse stop areas on the feed card", () => {
    const item = {
      requestId: "req_1",
      revision: 2,
      service: "ride",
      title: "Ride request · go",
      meta: "Area 6.52, 3.37 → Area 6.56, 3.37 · 1 stop",
      askedMinor: { amountMinor: 280_000, currency: "NGN" },
      askedByLabel: "Requester asks",
      capabilityBadge: null,
      expiresAt: new Date(0).toISOString(),
      route: {
        stopCount: 1,
        stops: [
          {
            order: 1,
            areaLabel: "Area 6.53, 3.38",
            purpose: "drop_passenger",
            dwellSec: 120,
          },
        ],
        routedDistanceMeters: 7_100,
        routedDurationSec: 900,
        stopsDwellSec: 120,
      },
    };
    const parsed = MpFeedItemSchema.parse(item);
    expect(Object.keys(parsed.route?.stops[0] ?? {}).sort()).toEqual([
      "areaLabel",
      "dwellSec",
      "order",
      "purpose",
    ]);
  });

  it("pins the pilot limits and refuses an incoherent market policy", () => {
    expect(MP_MULTI_STOP_PILOT_DEFAULTS.maxIntermediateStops).toBe(3);
    expect(
      MpMultiStopPolicySchema.safeParse(MP_MULTI_STOP_PILOT_DEFAULTS).success,
    ).toBe(true);
    expect(
      MpMultiStopPolicySchema.safeParse({
        maxIntermediateStops: 3,
        defaultDwellSec: 900,
        maxDwellSec: 600,
      }).success,
    ).toBe(false);
    expect(MP_STOP_PURPOSES).toEqual([
      "pickup_passenger",
      "drop_passenger",
      "errand",
      "other",
    ]);
  });
});
