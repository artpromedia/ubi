/**
 * Integration-test harness for business travel organizations (A06 part C).
 *
 * Real Postgres (IDENTITY_TEST_DATABASE_URL, bootstrapped by
 * ../identity/setup-env), real route handlers, the production mount order.
 * The only things supplied are a mutable clock and the rows a test cannot
 * get from anywhere else: a live city with an active config version, the
 * `business_travel` flag rule, and users.
 */
import { randomInt, randomUUID } from "node:crypto";

import { Hono } from "hono";
import * as jose from "jose";

import { prisma } from "../../src/lib/prisma";
import { serviceAuthMiddleware } from "../../src/middleware/service-auth";
import { createOrganizationRoutes } from "../../src/routes/organizations";
import { INTERNAL_IDENTITY_SECRET } from "../identity/setup-env";

import type { OrganizationDeps } from "../../src/organizations/model";

export { prisma };

export interface Harness {
  readonly deps: OrganizationDeps;
  readonly app: Hono;
  setNow(value: Date): void;
}

/**
 * The organization routes mounted exactly as src/index.ts mounts them:
 * BEFORE a `protectedApi` group whose `use("*", serviceAuthMiddleware)`
 * trusts plain `x-auth-*` headers outside production. A forged header must
 * still be refused by the routes themselves.
 */
export function createHarness(start: Date): Harness {
  let clock = start;
  const deps: OrganizationDeps = { prisma, now: () => clock };
  const app = new Hono();
  app.route("/", createOrganizationRoutes(deps));
  const protectedApi = new Hono();
  protectedApi.use("*", serviceAuthMiddleware);
  protectedApi.all("*", (c) =>
    c.json({ success: true, data: { via: "protectedApi" } }),
  );
  app.route("/", protectedApi);
  return {
    deps,
    app,
    setNow: (value: Date) => {
      clock = value;
    },
  };
}

let sequence = 0;
export function suffix(): string {
  sequence += 1;
  return `${Date.now().toString(36)}${sequence}${randomUUID().replace(/-/g, "").slice(0, 6)}`;
}

export function key(prefix = "org"): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/** A live city whose active config the organization reads its currency from. */
export async function seedCity(
  options: { flag?: boolean | null } = {},
): Promise<string> {
  const cityId = `BIZ${suffix()}`.slice(0, 40);
  await prisma.city.create({
    data: {
      id: cityId,
      name: cityId,
      country: "NG",
      timezone: "Africa/Lagos",
      status: "active",
      active: true,
    },
  });
  await prisma.cityConfigVersion.create({
    data: {
      id: `cfg_${suffix()}`,
      cityId,
      version: 1,
      activatedAt: new Date(),
      createdBy: "seed",
      approvedBy: "seed-approver",
      config: {
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
          {
            tier: "tier_0",
            dailyOutMinor: 5_000_000,
            singleTransferMinor: 2_000_000,
            balanceCapMinor: 30_000_000,
          },
        ],
        serviceFeePct: 20,
        remittanceCapMinor: 100_000_000,
        reservationFreeReleaseSec: 600,
        airport: {
          codes: ["LOS"],
          arrivalBufferMin: 45,
          checkInCutoffMin: 60,
          trafficBufferMin: 30,
          doors: { departures: "D2" },
        },
        taxes: { vat: 7.5 },
      },
    },
  });
  if (options.flag !== null) {
    await setBusinessTravel(cityId, options.flag ?? true);
  }
  return cityId;
}

/** Writes the per-city `business_travel` rule (the flag row is created off). */
export async function setBusinessTravel(
  cityId: string,
  enabled: boolean,
): Promise<void> {
  await prisma.featureFlag.upsert({
    where: { key: "business_travel" },
    create: { key: "business_travel", defaultOn: false },
    update: {},
  });
  await prisma.flagRule.upsert({
    where: { flagKey_cityId: { flagKey: "business_travel", cityId } },
    create: {
      id: `rule_${suffix()}`,
      flagKey: "business_travel",
      cityId,
      enabled,
    },
    update: { enabled },
  });
}

export interface TestUser {
  readonly id: string;
  readonly phone: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
}

export async function createUser(firstName = "Ada"): Promise<TestUser> {
  const tag = suffix();
  const phone = `+2347${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}`;
  const email = `org.${tag}@test.ubi.africa`;
  const lastName = `Member${tag.slice(-4)}`;
  const user = await prisma.user.create({
    data: {
      phone,
      email,
      passwordHash: "",
      firstName,
      lastName,
      country: "NG",
      role: "RIDER",
      status: "ACTIVE",
      phoneVerified: true,
    },
    select: { id: true },
  });
  return { id: user.id, phone, email, firstName, lastName };
}

/** Mints the signed identity header the API gateway would mint. */
export async function identityHeader(
  userId: string,
  cityId: string | null = "LOS",
): Promise<string> {
  const secret = new TextEncoder().encode(INTERNAL_IDENTITY_SECRET);
  const now = Math.floor(Date.now() / 1000);
  return new jose.SignJWT({
    role: "rider",
    scp: ["profile:read", "profile:write"],
    mod: [],
    city: cityId,
    tenant: null,
    sid: null,
    dev: null,
    rid: `req_${randomUUID()}`,
  })
    .setProtectedHeader({ alg: "HS256", kid: "test", typ: "UBI-IC" })
    .setSubject(userId)
    .setIssuer("ubi-gateway")
    .setAudience("ubi-internal")
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(secret);
}

export interface Envelope<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  };
}

export interface Reply<T> {
  readonly status: number;
  readonly body: Envelope<T>;
  readonly raw: string;
}

/** Calls the app as `userId` (signed context). `idempotencyKey` for mutations. */
export async function call<T>(
  app: Hono,
  method: string,
  path: string,
  userId: string | null,
  options: {
    body?: unknown;
    key?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<Reply<T>> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(options.headers ?? {}),
  };
  if (userId !== null) {
    headers["x-ubi-identity"] = await identityHeader(userId);
  }
  if (options.key !== undefined) {
    headers["idempotency-key"] = options.key;
  }
  const response = await app.fetch(
    new Request(`http://user-service.test${path}`, {
      method,
      headers,
      body:
        method === "GET" || method === "HEAD"
          ? undefined
          : JSON.stringify(options.body ?? {}),
    }),
  );
  const raw = await response.text();
  return {
    status: response.status,
    body: JSON.parse(raw) as Envelope<T>,
    raw,
  };
}
