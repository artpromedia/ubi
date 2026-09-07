/**
 * City configuration — the single source for every number, currency and policy
 * the apps display (CLAUDE.md #1). Nothing in this file has a default that
 * would let a client fall back to a hard-coded market.
 *
 * Source: contracts/openapi/support-config.yaml (CityConfig) and slice 01.
 */
import { z } from "zod";

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
});

export type CityConfig = z.infer<typeof CityConfigSchema>;

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
