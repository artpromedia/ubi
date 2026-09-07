/**
 * Integration-test harness. Real Postgres, real Redis, real route handlers.
 *
 * The only things supplied as fixtures are the two things a test cannot stand
 * up locally: the city config the policy is read from, and the biometric
 * provider. Both are injected through the same `IdentityDeps` interface
 * production uses, so the code under test is the production code.
 */
import { randomInt, randomUUID } from "node:crypto";

import { type CityConfig, ContractError } from "@ubi/contracts";
import { Hono } from "hono";
import * as jose from "jose";

import type { IdentityDeps } from "../../src/identity/deps";
import { createPolicyProvider } from "../../src/identity/policy";
import type { FaceVerification, FaceVerifier } from "../../src/identity/step-up";
import { prisma } from "../../src/lib/prisma";
import { redis } from "../../src/lib/redis";
import { createDeviceRoutes } from "../../src/routes/devices";
import { createIdentityRoutes } from "../../src/routes/identity";
import { INTERNAL_IDENTITY_SECRET } from "./setup-env";

/**
 * A complete Lagos-shaped city config. Every number the identity module reads
 * comes from here, exactly as it would from the config service.
 */
export const CITY_CONFIG: CityConfig = {
  cityId: "LOS",
  version: 7,
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
      perMinMinor: 3_000,
      bookingFeeMinor: 10_000,
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
  matchingRings: [{ radiusMeters: 2_000, maxCandidates: 8 }],
  arrivedGeofenceMeters: 120,
  maxPinAttempts: 5,
  paymentMethods: [
    { id: "cash", available: true },
    { id: "wallet", available: true },
  ],
  kycTiers: [
    { tier: "tier_0", dailyOutMinor: 5_000_000, singleTransferMinor: 2_000_000, balanceCapMinor: 30_000_000 },
    { tier: "tier_1", dailyOutMinor: 20_000_000, singleTransferMinor: 10_000_000, balanceCapMinor: null },
  ],
  serviceFeePct: 20,
  remittanceCapMinor: 100_000_000,
  reservationFreeReleaseSec: 600,
  airport: {
    codes: ["LOS"],
    arrivalBufferMin: 45,
    checkInCutoffMin: 60,
    trafficBufferMin: 30,
    doors: { departures: "D2", arrivals: "E" },
  },
  taxes: { vat: 7.5 },
};

export interface ScriptedFace {
  livenessScore: number;
  matchScore: number;
}

export interface TestHarness {
  readonly deps: IdentityDeps;
  readonly app: Hono;
  /** Mutable: set the next verdict the biometric provider will return. */
  readonly face: ScriptedFace;
  /** Every SMS the service tried to send, in order. */
  readonly sms: { phone: string; message: string }[];
  /** Mutable clock, so expiry and cooling windows are exercised, not slept through. */
  setNow(value: Date): void;
  now(): Date;
  /** Make the biometric provider unavailable. */
  breakFaceVerifier(broken: boolean): void;
  /** Make the notification service unavailable. */
  breakSms(broken: boolean): void;
}

export function createHarness(): TestHarness {
  const face: ScriptedFace = { livenessScore: 0.97, matchScore: 0.95 };
  const sms: { phone: string; message: string }[] = [];
  let clock = new Date();
  let faceBroken = false;
  let smsBroken = false;

  const faceVerifier: FaceVerifier = {
    async verify(): Promise<FaceVerification> {
      // Matches what the production HTTP verifier throws when the provider
      // cannot be reached, so the route's answer is the real one.
      if (faceBroken) {
        throw new ContractError(
          "service_unavailable",
          "Identity checks are unavailable right now. Please try again shortly.",
        );
      }
      return {
        livenessScore: face.livenessScore,
        matchScore: face.matchScore,
        providerRef: `ref_${randomUUID()}`,
      };
    },
  };

  const deps: IdentityDeps = {
    prisma,
    cache: redis,
    policy: createPolicyProvider({ getCityConfig: async () => CITY_CONFIG }),
    notifier: {
      async sendSms(params) {
        if (smsBroken) throw new Error("notification service unavailable");
        sms.push({ phone: params.phone, message: params.message });
      },
    },
    faceVerifier,
    now: () => clock,
  };

  const app = new Hono();
  app.route("/devices", createDeviceRoutes(deps));
  app.route("/", createIdentityRoutes(deps));

  return {
    deps,
    app,
    face,
    sms,
    setNow: (value: Date) => {
      clock = value;
    },
    now: () => clock,
    breakFaceVerifier: (broken: boolean) => {
      faceBroken = broken;
    },
    breakSms: (broken: boolean) => {
      smsBroken = broken;
    },
  };
}

// ---------------------------------------------------------------------------
// Signed gateway identity context
// ---------------------------------------------------------------------------

export interface PrincipalInput {
  readonly userId: string;
  readonly role: string;
  readonly scopes: readonly string[];
  readonly modes?: readonly string[];
  readonly cityId?: string | null;
  readonly deviceId?: string | null;
  readonly sessionId?: string | null;
}

export const FULL_SCOPES: readonly string[] = [
  "profile:read",
  "profile:write",
  "ride:book:cash",
  "ride:book:wallet",
  "ride:read",
  "history:read",
  "wallet:read",
  "wallet:topup",
  "wallet:transfer:p2p",
  "wallet:transfer:nip",
  "security:pin:change",
  "device:enroll",
  "auth:step_up",
  "driver:online",
  "driver:documents:write",
  "support:write",
];

/** Mints the header the API gateway would mint. */
export async function identityHeader(
  input: PrincipalInput,
  options: { secret?: string; expiresInSeconds?: number } = {},
): Promise<string> {
  const key = new TextEncoder().encode(options.secret ?? INTERNAL_IDENTITY_SECRET);
  const now = Math.floor(Date.now() / 1000);
  return new jose.SignJWT({
    role: input.role,
    scp: [...input.scopes],
    mod: [...(input.modes ?? [])],
    city: input.cityId ?? "LOS",
    tenant: null,
    sid: input.sessionId ?? null,
    dev: input.deviceId ?? null,
    rid: `req_${randomUUID()}`,
  })
    .setProtectedHeader({ alg: "HS256", kid: "test", typ: "UBI-IC" })
    .setSubject(input.userId)
    .setIssuer("ubi-gateway")
    .setAudience("ubi-internal")
    .setIssuedAt(now)
    .setExpirationTime(now + (options.expiresInSeconds ?? 120))
    .sign(key);
}

export async function authedHeaders(
  input: PrincipalInput,
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  return {
    "content-type": "application/json",
    "x-ubi-identity": await identityHeader(input),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Fixtures in the database
// ---------------------------------------------------------------------------

export interface TestUser {
  readonly id: string;
  readonly phone: string;
  readonly email: string;
}

let sequence = 0;
function uniqueSuffix(): string {
  sequence += 1;
  return `${Date.now().toString(36)}${sequence}${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export async function createUser(role: "RIDER" | "DRIVER" = "RIDER"): Promise<TestUser> {
  const suffix = uniqueSuffix();
  const phone = `+2348${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}`;
  const email = `identity.${suffix}@test.ubi.africa`;
  const user = await prisma.user.create({
    data: {
      phone,
      email,
      passwordHash: "",
      firstName: "Test",
      lastName: "Person",
      country: "NG",
      role,
      status: "ACTIVE",
      phoneVerified: true,
    },
    select: { id: true },
  });
  return { id: user.id, phone, email };
}

export interface TestDriver extends TestUser {
  readonly driverId: string;
  readonly vehicleId: string;
}

export async function createDriver(options: { online?: boolean } = {}): Promise<TestDriver> {
  const user = await createUser("DRIVER");
  const suffix = uniqueSuffix();
  const vehicle = await prisma.vehicle.create({
    data: {
      make: "Toyota",
      model: "Corolla",
      year: 2019,
      color: "Silver",
      plateNumber: `TST-${suffix.slice(-10)}`,
      type: "SEDAN",
    },
    select: { id: true },
  });
  const driver = await prisma.driver.create({
    data: {
      userId: user.id,
      licenseNumber: `LIC-${suffix}`,
      licenseExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      vehicleId: vehicle.id,
      isOnline: options.online ?? true,
      isAvailable: options.online ?? true,
    },
    select: { id: true },
  });
  return { ...user, driverId: driver.id, vehicleId: vehicle.id };
}

export async function createWallet(
  userId: string,
  overrides: {
    pinHash?: string;
    pinFailedAttempts?: number;
    pinLockedUntil?: Date | null;
    safeModeUntil?: Date | null;
  } = {},
): Promise<string> {
  const id = `wal_${uniqueSuffix()}`;
  await prisma.wallet.create({
    data: {
      id,
      ownerType: "user",
      ownerId: userId,
      currency: CITY_CONFIG.currency,
      tier: "tier_0",
      pinFailedAttempts: overrides.pinFailedAttempts ?? 0,
      ...(overrides.pinHash === undefined ? {} : { pinHash: overrides.pinHash }),
      ...(overrides.pinLockedUntil === undefined
        ? {}
        : { pinLockedUntil: overrides.pinLockedUntil }),
      ...(overrides.safeModeUntil === undefined
        ? {}
        : { safeModeUntil: overrides.safeModeUntil }),
    },
  });
  return id;
}

export async function outboxNames(subjectId: string): Promise<string[]> {
  const events = await prisma.outboxEvent.findMany({
    where: { aggregateId: subjectId },
    orderBy: { createdAt: "asc" },
    select: { name: true },
  });
  return events.map((event) => event.name);
}

export async function closeConnections(): Promise<void> {
  await prisma.$disconnect();
  await redis.quit();
}
