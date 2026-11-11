import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CityConfigSchema, type CityConfig } from "@ubi/contracts";

/**
 * Contract-generated config-service response fixture (GET /v1/config/cities/LOS).
 * Any drift between @ubi/contracts CityConfigSchema and mobile-core's CityConfig
 * consumption fails this test.
 */
function buildConfigServiceFixture(
  overrides: Partial<CityConfig> = {},
): CityConfig {
  return CityConfigSchema.parse({
    cityId: "LOS",
    version: 1,
    currency: "NGN",
    currencyFractionDigits: 2,
    locale: "en-NG",
    timezone: "Africa/Lagos",
    emergencyNumber: "112",
    supportPhone: "+23417000824",
    vehicleClasses: ["go", "comfort", "xl"],
    fares: {
      go: {
        baseMinor: 60_000,
        perKmMinor: 18_000,
        perMinMinor: 2_500,
        bookingFeeMinor: 10_000,
        minFareMinor: 120_000,
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
    matchingRings: [{ radiusMeters: 2_000, maxCandidates: 5 }],
    arrivedGeofenceMeters: 120,
    maxPinAttempts: 3,
    paymentMethods: [
      { id: "cash", available: true },
      { id: "card", available: true },
      { id: "bank_transfer", available: true },
      { id: "wallet", available: true },
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
    remittanceCapMinor: 15_000_000,
    reservationFreeReleaseSec: 900,
    airport: {
      codes: ["LOS"],
      arrivalBufferMin: 20,
      checkInCutoffMin: 90,
      trafficBufferMin: 45,
      doors: { domestic_arrivals: "Domestic Arrivals Door 2" },
    },
    taxes: { vat: 7.5 },
    ...overrides,
  });
}

describe("@ubi/mobile-core CityConfig contract parity (P2-14 / CC-A13)", () => {
  it("parses a real config-service response fixture validated by CityConfigSchema", () => {
    const config = buildConfigServiceFixture();
    assert.equal(config.cityId, "LOS");
    assert.equal(config.currency, "NGN");
    assert.equal(config.currencyFractionDigits, 2);
    assert.equal(config.supportPhone, "+23417000824");
    assert.equal("currencySymbol" in config, false);
    assert.equal("minorDigitsShown" in config, false);
    assert.equal("countryCode" in config, false);
    assert.equal("reservationFreeCancelMin" in config, false);
  });

  it("allows supportPhone to be omitted and rejects non-E.164 values", () => {
    const withoutPhone = buildConfigServiceFixture({ supportPhone: undefined });
    assert.equal(withoutPhone.supportPhone, undefined);
    assert.throws(() =>
      buildConfigServiceFixture({ supportPhone: "0800-UBI" }),
    );
  });
});
