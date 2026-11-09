import "./env";

/**
 * End-to-end contract test (CC-B00 / P0-06 / P1-14):
 *   user-service (real Hono + Postgres + Redis)
 *     → api-gateway (real auth + signed identity + cityId scope enforcement + HMAC ride headers)
 *     → ride-service (real compiled Go binary + Postgres + Redis)
 *
 * Proves:
 *   1. New rider signs up with launched `cityId`, verifies OTP on 1st device,
 *      receives `mode: "full"` token carrying `cityId`.
 *   2. New driver signs up with launched `cityId`, verifies OTP on 1st device
 *      (`first_device_trusted`), receives `mode: "full"` token carrying `cityId`,
 *      and goes online (`POST /v1/drivers/me/status` → 200 `state: "available"`)
 *      against the real Go `ride-service`.
 *   3. Second device on that driver account verifies OTP → receives `mode: "limited"`
 *      (`stepUp.required: true`), is refused go-online (`403 limited_mode`),
 *      gets approved by the 1st trusted device (`POST /v1/auth/step-up/approve`),
 *      receives `mode: "full"` token with `cityId`, and can then go online (`200`).
 *   4. Existing cityless driver (`homeCityId: null`) verifies OTP → receives
 *      `citySelectionRequired: true`, is blocked on `POST /v1/drivers/me/status`
 *      at the gateway (`409 city_selection_required`), selects a launched city
 *      via `POST /v1/auth/city`, receives a city-bound token, and goes online (`200`).
 *   5. Legacy `/v1/auth/login/otp`, `/v1/auth/verify-otp`, `/v1/auth/register`,
 *      and `/v1/auth/login` all return `410 legacy_auth_retired`.
 *   6. Negative control: dropping `cityId` fails closed both at the gateway
 *      (`409 city_selection_required`) and at `ride-service` (`422 validation_failed`).
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import * as jose from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import {
  RIDE_ISSUED_AT_HEADER,
  RIDE_SIGNATURE_HEADER,
  signRideContext,
} from "../src/identity/ride-context";
import { setIdentityStateStore } from "../src/lib/redis";
import { clientToken, openRiskStore } from "./helpers";

const E2E_DB_URL =
  process.env.GATEWAY_E2E_DATABASE_URL ??
  "postgresql://ubi:ubi_dev_password@127.0.0.1:5432/ubi_ride_test?schema=public";
const E2E_REDIS_URL =
  process.env.GATEWAY_E2E_REDIS_URL ?? "redis://127.0.0.1:6379/7";
const RIDE_SECRET = "e2e-cc-b00-ride-internal-context-secret-01";
const RIDE_DIR = path.resolve(__dirname, "../../ride-service");
const CITY_ID = "E2ELOS";

function goDbUrl(raw: string): string {
  const u = new URL(raw);
  u.searchParams.delete("schema");
  u.searchParams.set("sslmode", "disable");
  return u.toString();
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const p = (srv.address() as AddressInfo).port;
      srv.close(() => resolve(p));
    });
  });
}

function extractOtpCode(message: string): string {
  const m = /\b(\d{6})\b/.exec(message);
  if (!m?.[1]) {
    throw new Error(`Could not find 6-digit OTP in SMS: ${message}`);
  }
  return m[1];
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
    vehicleClasses: ["go", "comfort"],
    fares: {
      go: {
        baseMinor: 10_000,
        perKmMinor: 5_000,
        perMinMinor: 1_000,
        bookingFeeMinor: 2_000,
        minFareMinor: 50_000,
      },
      comfort: {
        baseMinor: 20_000,
        perKmMinor: 8_000,
        perMinMinor: 2_000,
        bookingFeeMinor: 2_000,
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

describe("CC-B00 end-to-end: user-service → api-gateway → Go ride-service", () => {
  const gateway = createApp("test");
  const sentSms: { phone: string; message: string }[] = [];
  let buildDir: string | undefined;
  let rideChild: ChildProcess | undefined;
  let rideBaseUrl = "";
  let userServer: ReturnType<typeof serve> | undefined;
  let prismaRef: import("@ubi/database").PrismaClient | undefined;
  let redisRef: { quit(): Promise<unknown> } | undefined;
  let makeInternalDeviceId:
    | ((userId: string, clientDeviceId: string) => string)
    | undefined;
  let ipSeq = 1;

  async function gw(
    method: string,
    pathname: string,
    opts: {
      token?: string;
      body?: unknown;
      idempotencyKey?: string;
    } = {},
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    ipSeq += 1;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-forwarded-for": `10.88.${Math.floor(ipSeq / 250) % 250}.${(ipSeq % 250) + 1}`,
    };
    if (opts.token) {
      headers.authorization = `Bearer ${opts.token}`;
    }
    if (method === "POST") {
      headers["idempotency-key"] =
        opts.idempotencyKey ?? `idem_${randomUUID()}`;
    }
    const res = await gateway.fetch(
      new Request(`http://gateway.test${pathname}`, {
        method,
        headers,
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      }),
    );
    const json = (await res.json()) as Record<string, unknown>;
    return { status: res.status, json };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = E2E_DB_URL;
    process.env.REDIS_URL = E2E_REDIS_URL;
    process.env.RIDE_INTERNAL_CONTEXT_SECRET = RIDE_SECRET;
    setIdentityStateStore(openRiskStore);

    const [
      { prisma },
      { redis },
      { createPolicyProvider },
      { internalDeviceId },
      { createIdentityRoutes },
      { createDeviceRoutes },
      { authRoutes },
      { errorHandler },
    ] = await Promise.all([
      import("../../user-service/src/lib/prisma"),
      import("../../user-service/src/lib/redis"),
      import("../../user-service/src/identity/policy"),
      import("../../user-service/src/identity/devices"),
      import("../../user-service/src/routes/identity"),
      import("../../user-service/src/routes/devices"),
      import("../../user-service/src/routes/auth"),
      import("../../user-service/src/middleware/error-handler"),
    ]);

    prismaRef = prisma;
    redisRef = redis;
    makeInternalDeviceId = internalDeviceId;

    // Seed launched city + active config + driver_online flag in test DB only.
    await prisma.city.upsert({
      where: { id: CITY_ID },
      create: {
        id: CITY_ID,
        name: "Lagos E2E",
        country: "NG",
        timezone: "Africa/Lagos",
        active: true,
      },
      update: { active: true },
    });
    const existingVer = await prisma.cityConfigVersion.findFirst({
      where: { cityId: CITY_ID, activatedAt: { not: null } },
    });
    if (!existingVer) {
      await prisma.cityConfigVersion.create({
        data: {
          id: `cfg_${randomUUID()}`,
          cityId: CITY_ID,
          version: 1,
          config: minimalCityConfig(CITY_ID) as never,
          activatedAt: new Date(),
          createdBy: "e2e-seed",
          approvedBy: "e2e-approver",
        },
      });
    }
    for (const key of ["move", "ride_request", "driver_online"]) {
      await prisma.featureFlag.upsert({
        where: { key },
        create: { key, defaultOn: false },
        update: {},
      });
      await prisma.flagRule.upsert({
        where: { flagKey_cityId: { flagKey: key, cityId: CITY_ID } },
        create: {
          id: `rule_${randomUUID()}`,
          flagKey: key,
          cityId: CITY_ID,
          enabled: true,
        },
        update: { enabled: true },
      });
    }

    // Stand up real user-service HTTP server.
    const cfg = minimalCityConfig(CITY_ID) as never;
    const identityDeps = {
      prisma,
      cache: redis,
      policy: createPolicyProvider({
        getCityConfig: async () => cfg,
      }),
      cities: {
        listLaunchedCities: async () => [
          {
            id: CITY_ID,
            name: "Lagos E2E",
            country: "NG",
            region: "LA",
            timezone: "Africa/Lagos",
          },
        ],
      },
      notifier: {
        sendSms: async (params: { phone: string; message: string }) => {
          sentSms.push({ phone: params.phone, message: params.message });
        },
      },
      faceVerifier: {
        verify: async () => ({
          providerRef: randomUUID(),
          livenessScore: 0.98,
          matchScore: 0.96,
        }),
      },
      now: () => new Date(),
    };

    const userApp = new Hono();
    userApp.onError(errorHandler);
    userApp.route("/devices", createDeviceRoutes(identityDeps));
    userApp.route("/", createIdentityRoutes(identityDeps));
    userApp.route("/auth", authRoutes);

    userServer = await new Promise<ReturnType<typeof serve>>((resolve) => {
      const s = serve(
        { fetch: userApp.fetch, port: 0, hostname: "127.0.0.1" },
        () => resolve(s),
      );
    });
    const userPort = (userServer.address() as AddressInfo).port;
    process.env.USER_SERVICE_URL = `http://127.0.0.1:${userPort}`;

    // Build and spawn real Go ride-service binary.
    buildDir = mkdtempSync(path.join(tmpdir(), "cc-b00-ride-e2e-"));
    const binary = path.join(buildDir, "ride-server");
    execFileSync("go", ["build", "-o", binary, "./cmd/server"], {
      cwd: RIDE_DIR,
      stdio: "pipe",
    });

    const ridePort = await freePort();
    rideBaseUrl = `http://127.0.0.1:${ridePort}`;
    let rideLogs = "";
    rideChild = spawn(binary, [], {
      cwd: RIDE_DIR,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        NODE_ENV: "development",
        PORT: String(ridePort),
        DATABASE_URL: goDbUrl(E2E_DB_URL),
        REDIS_URL: E2E_REDIS_URL,
        RIDE_QUOTE_SIGNING_SECRET: "e2e-cc-b00-quote-signing-secret-0001",
        RIDE_INTERNAL_CONTEXT_SECRET: RIDE_SECRET,
        RIDE_MIGRATE_ON_BOOT: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    rideChild.stdout?.on("data", (c: Buffer) => {
      rideLogs = (rideLogs + c.toString("utf8")).slice(-10_000);
    });
    rideChild.stderr?.on("data", (c: Buffer) => {
      rideLogs = (rideLogs + c.toString("utf8")).slice(-10_000);
    });

    const deadline = Date.now() + 45_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (rideChild.exitCode !== null) {
        throw new Error(
          `ride-service exited (${rideChild.exitCode}) before ready:\n${rideLogs}`,
        );
      }
      try {
        const h = await fetch(`${rideBaseUrl}/health/ready`);
        if (h.ok) {
          ready = true;
          break;
        }
      } catch {
        // wait
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!ready) {
      throw new Error(`ride-service timed out becoming ready:\n${rideLogs}`);
    }
    process.env.RIDE_SERVICE_URL = rideBaseUrl;
    // Keep gateway rate-limiter in-memory for deterministic in-process fetch calls
    delete process.env.REDIS_URL;
  }, 120_000);

  afterAll(async () => {
    delete process.env.RIDE_INTERNAL_CONTEXT_SECRET;
    if (rideChild && rideChild.exitCode === null) {
      await new Promise<void>((resolve) => {
        rideChild!.once("exit", () => resolve());
        rideChild!.kill("SIGTERM");
      });
    }
    if (userServer) {
      await new Promise<void>((resolve) => {
        userServer!.close(() => resolve());
      });
    }
    if (buildDir) {
      rmSync(buildDir, { recursive: true, force: true });
    }
    await redisRef?.quit().catch(() => {});
    await prismaRef?.$disconnect().catch(() => {});
  });

  it("signs up a new rider in a launched city and issues a full-mode city-bound token on 1st device", async () => {
    const citiesRes = await gw("GET", "/v1/auth/cities");
    expect(citiesRes.status).toBe(200);
    const cities = (citiesRes.json.data as { cities: { id: string }[] }).cities;
    expect(cities.some((c) => c.id === CITY_ID)).toBe(true);

    const riderPhone = `+23481${Math.floor(10000000 + Math.random() * 89999999)}`;
    const signupRes = await gw("POST", "/v1/auth/signup", {
      body: {
        phone: riderPhone,
        firstName: "Ngozi",
        lastName: "Rider",
        cityId: CITY_ID,
        role: "RIDER",
      },
    });
    expect(signupRes.status).toBe(201);

    const otpCode = extractOtpCode(sentSms.at(-1)!.message);
    const verifyRes = await gw("POST", "/v1/auth/verify", {
      body: {
        phone: riderPhone,
        code: otpCode,
        deviceId: `rider-dev-${randomUUID()}`,
        platform: "ios",
      },
    });
    expect(verifyRes.status).toBe(200);
    const data = verifyRes.json.data as {
      user: { cityId: string };
      tokens: { accessToken: string; mode: string };
      citySelectionRequired: boolean;
    };
    expect(data.citySelectionRequired).toBe(false);
    expect(data.user.cityId).toBe(CITY_ID);
    expect(data.tokens.mode).toBe("full");

    const claims = jose.decodeJwt(data.tokens.accessToken);
    expect(claims.cityId).toBe(CITY_ID);
    expect(claims.mode).toBe("full");
  });

  it("lets a newly signed-up driver go online on Go ride-service on 1st device, gates 2nd device in limited mode until step-up approval", async () => {
    const driverPhone = `+23482${Math.floor(10000000 + Math.random() * 89999999)}`;
    const dev1 = `drv-dev1-${randomUUID()}`;
    const dev2 = `drv-dev2-${randomUUID()}`;

    const signupRes = await gw("POST", "/v1/auth/signup", {
      body: {
        phone: driverPhone,
        firstName: "Chinedu",
        lastName: "Driver",
        cityId: CITY_ID,
        role: "DRIVER",
      },
    });
    expect(signupRes.status).toBe(201);

    const code1 = extractOtpCode(sentSms.at(-1)!.message);
    const verify1 = await gw("POST", "/v1/auth/verify", {
      body: {
        phone: driverPhone,
        code: code1,
        deviceId: dev1,
        platform: "android",
      },
    });
    expect(verify1.status).toBe(200);
    const d1 = verify1.json.data as {
      user: { id: string };
      tokens: { accessToken: string; mode: string };
      device: { id: string; trusted: boolean };
    };
    expect(d1.device.trusted).toBe(true);
    expect(d1.tokens.mode).toBe("full");

    const firstDeviceAudit = await prismaRef!.auditLog.findFirst({
      where: {
        subjectType: "device",
        subjectId: d1.device.id,
        action: "device.enrolled",
      },
    });
    expect(firstDeviceAudit?.reason).toBe("first_device_trusted");

    // 1st device goes online on the REAL Go ride-service!
    const goOnline1 = await gw("POST", "/v1/drivers/me/status", {
      token: d1.tokens.accessToken,
      body: { online: true, filters: { vehicleClasses: ["go"] } },
    });
    expect(goOnline1.status).toBe(200);
    expect(goOnline1.json.state).toBe("available");

    // Take driver back offline so 2nd device can also test going online after step-up.
    const goOffline = await gw("POST", "/v1/drivers/me/status", {
      token: d1.tokens.accessToken,
      body: { online: false, filters: { vehicleClasses: ["go"] } },
    });
    expect(goOffline.status).toBe(200);

    // 2nd device signs in → limited mode + step-up challenge required.
    const otp2 = await gw("POST", "/v1/auth/otp", {
      body: { phone: driverPhone, purpose: "login" },
    });
    expect(otp2.status).toBe(200);
    const code2 = extractOtpCode(sentSms.at(-1)!.message);

    const verify2 = await gw("POST", "/v1/auth/verify", {
      body: {
        phone: driverPhone,
        code: code2,
        deviceId: dev2,
        platform: "ios",
      },
    });
    expect(verify2.status).toBe(200);
    const d2 = verify2.json.data as {
      tokens: { accessToken: string; mode: string };
      stepUp: { required: boolean; challengeId?: string };
    };
    expect(d2.tokens.mode).toBe("limited");
    expect(d2.stepUp.required).toBe(true);
    expect(typeof d2.stepUp.challengeId).toBe("string");

    // Limited-mode 2nd device CANNOT go online.
    const limitedOnline = await gw("POST", "/v1/drivers/me/status", {
      token: d2.tokens.accessToken,
      body: { online: true, filters: { vehicleClasses: ["go"] } },
    });
    expect(limitedOnline.status).toBe(403);
    expect((limitedOnline.json.error as { code: string }).code).toBe(
      "limited_mode",
    );

    // Trusted 1st device approves the 2nd device's challenge → returns full-mode city-bound token!
    const approveRes = await gw("POST", "/v1/auth/step-up/approve", {
      token: d1.tokens.accessToken,
      body: {
        challengeId: d2.stepUp.challengeId,
      },
    });
    expect(approveRes.status).toBe(200);
    const upgraded = approveRes.json.data as {
      token: { accessToken: string; mode: string };
    };
    expect(upgraded.token.mode).toBe("full");
    expect(jose.decodeJwt(upgraded.token.accessToken).cityId).toBe(CITY_ID);

    // Upgraded 2nd device can now go online on Go ride-service!
    const goOnline2 = await gw("POST", "/v1/drivers/me/status", {
      token: upgraded.token.accessToken,
      body: { online: true, filters: { vehicleClasses: ["go"] } },
    });
    expect(goOnline2.status).toBe(200);
    expect(goOnline2.json.state).toBe("available");
  });

  it("blocks a cityless existing driver with 409 city_selection_required until POST /v1/auth/city re-issues a city-bound token", async () => {
    const legacyPhone = `+23483${Math.floor(10000000 + Math.random() * 89999999)}`;
    const legacyUserId = randomUUID();
    const legacyDev = `drv-legacy-${randomUUID()}`;

    await prismaRef!.user.create({
      data: {
        id: legacyUserId,
        email: `${legacyUserId}@phone.ubi.local`,
        phone: legacyPhone,
        phoneVerified: true,
        passwordHash: "otp-only",
        firstName: "Legacy",
        lastName: "Driver",
        country: "NG",
        homeCityId: null,
        role: "DRIVER",
        status: "ACTIVE",
      },
    });
    const past = new Date(Date.now() - 86_400_000);
    await prismaRef!.device.create({
      data: {
        id: makeInternalDeviceId!(legacyUserId, legacyDev),
        userId: legacyUserId,
        trusted: true,
        enrolledAt: past,
        lastSeen: past,
        platform: "android",
      },
    });

    await gw("POST", "/v1/auth/otp", {
      body: { phone: legacyPhone, purpose: "login" },
    });
    const code = extractOtpCode(sentSms.at(-1)!.message);
    const verifyRes = await gw("POST", "/v1/auth/verify", {
      body: {
        phone: legacyPhone,
        code,
        deviceId: legacyDev,
        platform: "android",
      },
    });
    expect(verifyRes.status).toBe(200);
    const verified = verifyRes.json.data as {
      citySelectionRequired: boolean;
      user: { cityId: string | null };
      tokens: { accessToken: string };
    };
    expect(verified.citySelectionRequired).toBe(true);
    expect(verified.user.cityId).toBeNull();

    // Gateway rejects go-online with 409 city_selection_required before forwarding.
    const blocked = await gw("POST", "/v1/drivers/me/status", {
      token: verified.tokens.accessToken,
      body: { online: true, filters: { vehicleClasses: ["go"] } },
    });
    expect(blocked.status).toBe(409);
    expect((blocked.json.error as { code: string }).code).toBe(
      "city_selection_required",
    );

    // Driver picks launched home city via POST /v1/auth/city → re-issued token works on Go ride-service!
    const pickRes = await gw("POST", "/v1/auth/city", {
      token: verified.tokens.accessToken,
      body: { cityId: CITY_ID },
    });
    expect(pickRes.status).toBe(200);
    const picked = pickRes.json.data as {
      cityId: string;
      tokens: { accessToken: string };
    };
    expect(picked.cityId).toBe(CITY_ID);

    const onlineRes = await gw("POST", "/v1/drivers/me/status", {
      token: picked.tokens.accessToken,
      body: { online: true, filters: { vehicleClasses: ["go"] } },
    });
    expect(onlineRes.status).toBe(200);
    expect(onlineRes.json.state).toBe("available");
  });

  it("answers 410 legacy_auth_retired on all retired unhardened auth endpoints", async () => {
    for (const pathname of [
      "/v1/auth/login/otp",
      "/v1/auth/verify-otp",
      "/v1/auth/register",
      "/v1/auth/login",
    ]) {
      const res = await gw("POST", pathname, { body: {} });
      expect(res.status, pathname).toBe(410);
      expect((res.json.error as { code: string }).code, pathname).toBe(
        "legacy_auth_retired",
      );
    }
  });

  it("negative control: dropping cityId fails closed at both api-gateway (409) and Go ride-service (422)", async () => {
    const citylessToken = await clientToken({
      sub: randomUUID(),
      role: "driver",
    });
    const gwRes = await gw("POST", "/v1/drivers/me/status", {
      token: citylessToken,
      body: { online: true, filters: { vehicleClasses: ["go"] } },
    });
    expect(gwRes.status).toBe(409);
    expect((gwRes.json.error as { code: string }).code).toBe(
      "city_selection_required",
    );

    // Direct call to Go ride-service with validly HMAC-signed context but empty cityId → 422 validation_failed
    const directUserId = randomUUID();
    const issuedAt = Math.floor(Date.now() / 1000);
    const signature = signRideContext(
      RIDE_SECRET,
      directUserId,
      "driver",
      "",
      issuedAt,
    );
    const directRes = await fetch(`${rideBaseUrl}/v1/drivers/me/status`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `idem_${randomUUID()}`,
        "x-auth-user-id": directUserId,
        "x-auth-user-role": "driver",
        [RIDE_ISSUED_AT_HEADER]: String(issuedAt),
        [RIDE_SIGNATURE_HEADER]: signature,
      },
      body: JSON.stringify({
        online: true,
        filters: { vehicleClasses: ["go"] },
      }),
    });
    expect(directRes.status).toBe(422);
    const directBody = (await directRes.json()) as {
      code?: string;
    };
    expect(directBody.code).toBe("validation_failed");
  });
});
