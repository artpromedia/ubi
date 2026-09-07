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
import type { Prisma } from "@prisma/client";
import { type CityConfig, CityConfigSchema, ContractError, FLAG_KEYS } from "@ubi/contracts";

import { deterministicId, newId } from "../lib/ids";
import { GLOBAL_SCOPE } from "../lib/cache";
import { seedLogger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { writeAudit } from "../services/audit";
import { writeOutboxEvent } from "../services/outbox";

export const LAGOS_CITY = {
  id: "LOS",
  name: "Lagos",
  country: "NG",
  timezone: "Africa/Lagos",
} as const;

/** Actor recorded for seeded rows; not a person and never a login. */
const SEED_ACTOR = "system:seed";

/** Flags on for the Lagos launch. Everything else stays off (CLAUDE.md #5). */
export const LAGOS_ENABLED_FLAGS = ["move", "ride_request", "driver_online"] as const;

export function lagosConfig(version: number): CityConfig {
  return CityConfigSchema.parse({
    cityId: LAGOS_CITY.id,
    version,
    currency: "NGN",
    currencyFractionDigits: 2,
    locale: "en-NG",
    timezone: LAGOS_CITY.timezone,
    emergencyNumber: "112",
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
    throw new ContractError("forbidden", "seeding is not permitted in production");
  }
  if (env.CONFIG_SEED_ENABLED !== "true") {
    throw new ContractError(
      "forbidden",
      "seeding requires CONFIG_SEED_ENABLED=true",
    );
  }
}

export interface SeedResult {
  readonly cityId: string;
  readonly configVersion: number;
  readonly createdVersion: boolean;
  readonly flagsRegistered: number;
}

/**
 * Idempotent: a second run activates nothing. The activation is written with
 * its audit and outbox rows in one transaction, exactly like a real approval.
 */
export async function seedLagos(env: SeedEnv = process.env): Promise<SeedResult> {
  assertSeedAllowed(env);

  await prisma.city.upsert({
    where: { id: LAGOS_CITY.id },
    create: { ...LAGOS_CITY, active: true },
    update: { name: LAGOS_CITY.name, timezone: LAGOS_CITY.timezone, active: true },
  });

  for (const key of FLAG_KEYS) {
    await prisma.featureFlag.upsert({
      where: { key },
      create: { key, defaultOn: false, description: `${key} vertical` },
      update: {},
    });
  }

  for (const key of LAGOS_ENABLED_FLAGS) {
    const id = deterministicId("flr", key, LAGOS_CITY.id);
    await prisma.flagRule.upsert({
      where: { id },
      create: { id, flagKey: key, cityId: LAGOS_CITY.id, enabled: true, updatedBy: SEED_ACTOR },
      update: {},
    });
  }

  const existing = await prisma.cityConfigVersion.findFirst({
    where: { cityId: LAGOS_CITY.id, activatedAt: { not: null } },
    orderBy: { version: "desc" },
  });
  if (existing !== null) {
    seedLogger.info(
      { cityId: LAGOS_CITY.id, version: existing.version },
      "lagos config already activated; nothing to seed",
    );
    return {
      cityId: LAGOS_CITY.id,
      configVersion: existing.version,
      createdVersion: false,
      flagsRegistered: FLAG_KEYS.length,
    };
  }

  const version = 1;
  const config = lagosConfig(version);
  const activatedAt = new Date();

  await prisma.$transaction(async (tx) => {
    const created = await tx.cityConfigVersion.create({
      data: {
        id: newId("ccv"),
        cityId: LAGOS_CITY.id,
        version,
        config: config as unknown as Prisma.InputJsonValue,
        activatedAt,
        createdBy: SEED_ACTOR,
        approvedBy: SEED_ACTOR,
      },
    });
    await writeAudit(tx, {
      actorId: SEED_ACTOR,
      actorRole: "system",
      action: "config.version_activated",
      subjectType: "config",
      subjectId: created.id,
      after: { version, config, approvers: [SEED_ACTOR] } as unknown as Prisma.InputJsonValue,
      reason: "initial lagos configuration",
    });
    await writeOutboxEvent(tx, {
      name: "config.version_activated",
      subjectType: "config",
      subjectId: LAGOS_CITY.id,
      actorType: "system",
      actorId: SEED_ACTOR,
      idempotencyKey: `config.version_activated:seed:${LAGOS_CITY.id}:${version}`,
      fromVersion: null,
      toVersion: version,
      cityId: LAGOS_CITY.id,
      payload: { cityId: LAGOS_CITY.id, version, diff: [], by: [SEED_ACTOR] },
      occurredAt: activatedAt,
    });
  });

  seedLogger.info({ cityId: LAGOS_CITY.id, version }, "seeded lagos config");

  return {
    cityId: LAGOS_CITY.id,
    configVersion: version,
    createdVersion: true,
    flagsRegistered: FLAG_KEYS.length,
  };
}

/** Cache scopes a caller should invalidate after seeding into a running system. */
export const SEED_CACHE_SCOPES = [LAGOS_CITY.id, GLOBAL_SCOPE] as const;
