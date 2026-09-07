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
 * for this slice; they are marked below and must be replaced with the launch
 * numbers before Lagos goes live.
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
    // PLACEHOLDER — not on the slice 01 board. Replace with the launch fare table.
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
    // PLACEHOLDER — KYC limits are not on the slice 01 board.
    kycTiers: [
      { tier: "tier0", dailyOutMinor: 0, singleTransferMinor: 0, balanceCapMinor: 5_000_000 },
      {
        tier: "tier1",
        dailyOutMinor: 5_000_000,
        singleTransferMinor: 2_000_000,
        balanceCapMinor: 30_000_000,
      },
      {
        tier: "tier2",
        dailyOutMinor: 50_000_000,
        singleTransferMinor: 20_000_000,
        balanceCapMinor: null,
      },
    ],
    serviceFeePct: 20,
    // PLACEHOLDER — remittance cap is not on the slice 01 board.
    remittanceCapMinor: 5_000_000,
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
