/**
 * Test fixture only. Real configuration comes from the config service; nothing
 * outside tests may construct a CityConfig by hand.
 */
import { type CityConfig, CityConfigSchema } from "@ubi/contracts";

export function cityConfigFixture(overrides: Record<string, unknown> = {}): CityConfig {
  return CityConfigSchema.parse({
    cityId: "LOS",
    version: 1,
    currency: "NGN",
    currencyFractionDigits: 2,
    locale: "en-NG",
    timezone: "Africa/Lagos",
    emergencyNumber: "112",
    vehicleClasses: ["go", "comfort", "xl"],
    fares: {
      go: {
        baseMinor: 50_000,
        perKmMinor: 12_000,
        perMinMinor: 2_500,
        bookingFeeMinor: 10_000,
        minFareMinor: 90_000,
      },
      comfort: {
        baseMinor: 80_000,
        perKmMinor: 16_000,
        perMinMinor: 3_500,
        bookingFeeMinor: 10_000,
        minFareMinor: 140_000,
      },
      xl: {
        baseMinor: 120_000,
        perKmMinor: 22_000,
        perMinMinor: 4_500,
        bookingFeeMinor: 10_000,
        minFareMinor: 200_000,
      },
    },
    waitPolicy: { freeSec: 300, perMinMinor: 5_000 },
    cancelPolicy: { riderFeeAfterAssignMinor: 30_000, driverFeeMinor: 0, freeWindowSec: 120 },
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
    kycTiers: [{ tier: "tier1", dailyOutMinor: 5_000_000, singleTransferMinor: 2_000_000, balanceCapMinor: null }],
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
    ...overrides,
  });
}
