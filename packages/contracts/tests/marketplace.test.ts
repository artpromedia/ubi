import { describe, expect, it } from "vitest";

import {
  MP_ELIGIBILITY_REASONS,
  MpQuoteEnvelopeSchema,
  MpSelectBidSchema,
  MpSubmitBidSchema,
  commissionMinorFor,
} from "../src/marketplace";
import { DENY_ALL, isEnabled } from "../src/flags";
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
    ] as const) {
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
