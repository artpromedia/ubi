import "./env";

/**
 * In-process backend harness for Admin Console Playwright E2E (CC-B05).
 *
 * Runs REAL `api-gateway` + REAL `user-service` (Hono + PostgreSQL + Redis).
 *
 * NOTE ON MOCKS: ONLY the external SMS gateway (`mockSmsProvider`) and face
 * biometric provider (`mockFaceVerifier`) are mocked so tests never hit live
 * telco/biometric networks. OTP generation, scrypt hashing, rate limiting,
 * device enrolment, session rotation, JWT signing, and gateway scope/identity
 * signing are 100% real.
 */
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { createApp } from "../src/app";
import { setIdentityStateStore } from "../src/lib/redis";
import { openRiskStore } from "./helpers";

const GATEWAY_PORT = Number(process.env.E2E_GATEWAY_PORT ?? "44180");
const CONTROL_PORT = Number(process.env.E2E_CONTROL_PORT ?? "44181");
const DB_URL =
  process.env.GATEWAY_E2E_DATABASE_URL ??
  "postgresql://ubi:ubi_dev_password@127.0.0.1:5432/template1?schema=public";
const REDIS_URL =
  process.env.GATEWAY_E2E_REDIS_URL ?? "redis://127.0.0.1:6379/9";
const CITY_ID = "ADMINE2E";

function extractSixDigitOtp(message: string): string {
  const match = /\b(\d{6})\b/.exec(message);
  if (!match?.[1]) {
    throw new Error(`No 6-digit OTP found in mock SMS message: ${message}`);
  }
  return match[1];
}

function minimalCityConfig(cityId: string): Record<string, unknown> {
  return {
    cityId,
    version: 1,
    currency: "NGN",
    currencyFractionDigits: 2,
    locale: "en-NG",
    timezone: "Africa/Lagos",
    emergencyNumber: "112",
    vehicleClasses: ["go"],
    fares: {
      go: {
        baseMinor: 10_000,
        perKmMinor: 5_000,
        perMinMinor: 1_000,
        bookingFeeMinor: 2_000,
        minFareMinor: 50_000,
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
    arrivedGeofenceMeters: 150,
    maxPinAttempts: 3,
    paymentMethods: [
      { id: "cash", available: true },
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
    remittanceCapMinor: 5_000_000,
    reservationFreeReleaseSec: 900,
    airport: {
      codes: ["LOS"],
      arrivalBufferMin: 20,
      checkInCutoffMin: 90,
      trafficBufferMin: 45,
      doors: { arrivals: "Door C" },
    },
    taxes: { vat: 7.5 },
  };
}

async function main(): Promise<void> {
  process.env.DATABASE_URL = DB_URL;
  process.env.REDIS_URL = REDIS_URL;
  setIdentityStateStore(openRiskStore);

  const [
    { prisma },
    { redis },
    { createPolicyProvider },
    { createIdentityRoutes },
    { createDeviceRoutes },
    { authRoutes },
    { errorHandler },
  ] = await Promise.all([
    import("../../user-service/src/lib/prisma"),
    import("../../user-service/src/lib/redis"),
    import("../../user-service/src/identity/policy"),
    import("../../user-service/src/routes/identity"),
    import("../../user-service/src/routes/devices"),
    import("../../user-service/src/routes/auth"),
    import("../../user-service/src/middleware/error-handler"),
  ]);

  await redis.flushdb();
  await prisma.city.upsert({
    where: { id: CITY_ID },
    create: {
      id: CITY_ID,
      name: "Lagos Admin E2E",
      country: "NG",
      timezone: "Africa/Lagos",
      active: true,
    },
    update: { active: true },
  });

  // Clearly-labeled MOCK SMS OTP provider capturing codes sent by real user-service
  const mockSmsInbox = new Map<string, string>();
  const mockSmsProvider = {
    sendSms: async (params: { phone: string; message: string }) => {
      await Promise.resolve();
      mockSmsInbox.set(params.phone, extractSixDigitOtp(params.message));
    },
  };

  // Clearly-labeled MOCK face biometric verifier for offline E2E runs
  const mockFaceVerifier = {
    verify: async () => {
      await Promise.resolve();
      return {
        providerRef: `mock_face_${randomUUID()}`,
        livenessScore: 0.98,
        matchScore: 0.97,
      };
    },
  };

  const cityCfg = minimalCityConfig(CITY_ID) as never;
  const identityDeps = {
    prisma,
    cache: redis,
    policy: createPolicyProvider({
      getCityConfig: async () => {
        await Promise.resolve();
        return cityCfg;
      },
    }),
    cities: {
      listLaunchedCities: async () => {
        await Promise.resolve();
        return [
          {
            id: CITY_ID,
            name: "Lagos Admin E2E",
            country: "NG",
            region: "LA",
            timezone: "Africa/Lagos",
          },
        ];
      },
    },
    notifier: mockSmsProvider,
    faceVerifier: mockFaceVerifier,
    now: () => new Date(),
  };

  const userApp = new Hono();
  userApp.onError(errorHandler);
  userApp.route("/devices", createDeviceRoutes(identityDeps));
  userApp.route("/", createIdentityRoutes(identityDeps));
  userApp.route("/auth", authRoutes);

  const userServer = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const srv = serve(
      { fetch: userApp.fetch, port: 0, hostname: "127.0.0.1" },
      () => resolve(srv),
    );
  });
  const userPort = (userServer.address() as AddressInfo).port;

  // Lightweight stub for non-auth downstream services (returns empty arrays so
  // console boards render cleanly without connection-refused noise).
  const stubUpstream = new Hono();
  stubUpstream.all("*", (c) =>
    c.json({ rows: [], items: [], cities: [], fleets: [] }),
  );
  const stubServer = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const srv = serve(
      { fetch: stubUpstream.fetch, port: 0, hostname: "127.0.0.1" },
      () => resolve(srv),
    );
  });
  const stubUrl = `http://127.0.0.1:${(stubServer.address() as AddressInfo).port}`;

  process.env.USER_SERVICE_URL = `http://127.0.0.1:${userPort}`;
  process.env.RIDE_SERVICE_URL = stubUrl;
  process.env.PAYMENT_SERVICE_URL = stubUrl;
  process.env.NOTIFICATION_SERVICE_URL = stubUrl;
  process.env.ASK_SERVICE_URL = stubUrl;
  process.env.TRAVEL_SERVICE_URL = stubUrl;
  process.env.FLEET_SERVICE_URL = stubUrl;
  process.env.CONFIG_SERVICE_URL = stubUrl;

  const gatewayApp = createApp("test");
  const gatewayServer = await new Promise<ReturnType<typeof serve>>(
    (resolve) => {
      const srv = serve(
        { fetch: gatewayApp.fetch, port: GATEWAY_PORT, hostname: "127.0.0.1" },
        () => resolve(srv),
      );
    },
  );

  // Localhost-only test control plane (never reachable through api-gateway)
  const controlApp = new Hono();
  controlApp.get("/health", (c) =>
    c.json({
      ok: true,
      gatewayPort: GATEWAY_PORT,
      mockedProviders: ["sms_otp", "face_biometrics"],
    }),
  );
  controlApp.post("/seed-user", async (c) => {
    const body = (await c.req.json()) as {
      phone: string;
      email: string;
      firstName: string;
      lastName: string;
      role:
        | "SUPER_ADMIN"
        | "ADMIN"
        | "RIDER"
        | "DRIVER"
        | "FLEET_MANAGER"
        | "MERCHANT";
    };
    const existing = await prisma.user.findUnique({
      where: { phone: body.phone },
      select: { id: true },
    });
    if (existing) {
      await prisma.session.deleteMany({ where: { userId: existing.id } });
      await prisma.stepUpChallenge.deleteMany({
        where: { userId: existing.id },
      });
      await prisma.device.deleteMany({ where: { userId: existing.id } });
    }
    const user = await prisma.user.upsert({
      where: { phone: body.phone },
      create: {
        phone: body.phone,
        email: body.email,
        passwordHash: "",
        firstName: body.firstName,
        lastName: body.lastName,
        country: "NG",
        homeCityId: CITY_ID,
        language: "en",
        role: body.role,
        status: "ACTIVE",
        phoneVerified: true,
      },
      update: {
        email: body.email,
        firstName: body.firstName,
        lastName: body.lastName,
        homeCityId: CITY_ID,
        role: body.role,
        status: "ACTIVE",
        phoneVerified: true,
      },
      select: { id: true, phone: true, role: true },
    });
    return c.json({ user });
  });
  controlApp.get("/latest-otp", (c) => {
    const phone = c.req.query("phone") ?? "";
    const code = mockSmsInbox.get(phone) ?? null;
    return c.json({ phone, code, provider: "MOCK_SMS_PROVIDER" });
  });

  const controlServer = await new Promise<ReturnType<typeof serve>>(
    (resolve) => {
      const srv = serve(
        { fetch: controlApp.fetch, port: CONTROL_PORT, hostname: "127.0.0.1" },
        () => resolve(srv),
      );
    },
  );

  process.stdout.write(
    `READY gateway=http://127.0.0.1:${GATEWAY_PORT} control=http://127.0.0.1:${CONTROL_PORT}\n`,
  );

  const shutdown = async (): Promise<void> => {
    controlServer.close();
    gatewayServer.close();
    stubServer.close();
    userServer.close();
    await redis.quit().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("SIGINT", () => {
    void shutdown();
  });
}

void main();
