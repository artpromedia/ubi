import "./setup-env";

import { createHash, randomInt } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as jose from "jose";

import { prisma } from "../../src/lib/prisma";
import { redis } from "../../src/lib/redis";
import {
  authedHeaders,
  closeConnections,
  createHarness,
  createUser,
  FULL_SCOPES,
  type TestHarness,
  type TestUser,
} from "./harness";

let harness: TestHarness;

beforeAll(() => {
  harness = createHarness();
  harness.setNow(new Date("2026-07-01T07:00:00.000Z"));
});

afterAll(async () => {
  await closeConnections();
});

function otpCacheKey(phone: string): string {
  const pepper = process.env.IDENTITY_OTP_PEPPER ?? "";
  const id = createHash("sha256")
    .update(`${pepper}:${phone}`)
    .digest("base64url")
    .slice(0, 32);
  return `ubi:identity:otp:${id}`;
}

async function requestCode(phone: string) {
  return harness.app.fetch(
    new Request("http://user-service.test/auth/otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone }),
    }),
  );
}

function lastCode(): string {
  const message = harness.sms[harness.sms.length - 1]?.message ?? "";
  const match = /\b(\d{6})\b/.exec(message);
  if (match?.[1] === undefined) throw new Error(`no code in "${message}"`);
  return match[1];
}

async function verify(phone: string, code: string, deviceId: string) {
  return harness.app.fetch(
    new Request("http://user-service.test/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, code, deviceId, platform: "android" }),
    }),
  );
}

async function clearOtpState(phone: string): Promise<void> {
  const key = otpCacheKey(phone);
  await redis.del(key, `${key.replace("otp:", "otp:cooldown:")}`);
  const pepper = process.env.IDENTITY_OTP_PEPPER ?? "";
  const id = createHash("sha256")
    .update(`${pepper}:${phone}`)
    .digest("base64url")
    .slice(0, 32);
  await redis.del(
    `ubi:identity:otp:cooldown:${id}`,
    `ubi:identity:otp:sends:${id}`,
  );
}

describe("OTP at rest", () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await createUser("RIDER");
    await clearOtpState(user.phone);
  });

  it("stores a hash, never the code, and keys the cache by a hash of the number", async () => {
    const response = await requestCode(user.phone);
    expect(response.status).toBe(200);

    const code = lastCode();
    const stored = await redis.get(otpCacheKey(user.phone));
    expect(stored).not.toBeNull();

    const parsed = JSON.parse(stored as string) as {
      hash: string;
      attempts: number;
    };
    expect(parsed.hash.startsWith("scrypt$")).toBe(true);
    expect(parsed.hash).not.toContain(code);
    expect(parsed.attempts).toBe(0);

    // Nothing in the whole key space names the phone number.
    const keys = await redis.keys("ubi:identity:otp:*");
    expect(keys.join(" ")).not.toContain(user.phone.replace("+", ""));

    const ttl = await redis.ttl(otpCacheKey(user.phone));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(300);
  });

  it("holds a resend behind a cooldown", async () => {
    const response = await requestCode(user.phone);
    expect(response.status).toBe(429);
    const body = (await response.json()) as {
      error: { code: string; details: { retryAfterSeconds: number } };
    };
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.details.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("OTP verification", () => {
  it("counts attempts and destroys the code when they run out", async () => {
    const user = await createUser("RIDER");
    await clearOtpState(user.phone);
    await requestCode(user.phone);
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await verify(user.phone, wrong, "device-otp-attempts");
      expect(response.status).toBe(401);
      const body = (await response.json()) as {
        error: { details: { attemptsRemaining: number } };
      };
      expect(body.error.details.attemptsRemaining).toBe(5 - attempt);
    }

    const exhausted = await verify(user.phone, wrong, "device-otp-attempts");
    expect(exhausted.status).toBe(429);

    // The code is gone, so the real one no longer works either.
    expect(await redis.get(otpCacheKey(user.phone))).toBeNull();
    expect((await verify(user.phone, code, "device-otp-attempts")).status).toBe(
      401,
    );
  });

  it("refuses a code that was never issued", async () => {
    const user = await createUser("RIDER");
    await clearOtpState(user.phone);
    const response = await verify(user.phone, "123456", "device-otp-none-1");
    expect(response.status).toBe(401);
  });
});

describe("first-device trust (DEC-7) and second-device limited mode", () => {
  it("trusts an account's first OTP-verified device and restricts every subsequent device to limited mode", async () => {
    const user = await createUser("RIDER");
    await clearOtpState(user.phone);
    await requestCode(user.phone);

    const first = await verify(user.phone, lastCode(), "device-otp-first-1");
    expect(first.status).toBe(200);

    const firstBody = (await first.json()) as {
      data: {
        phoneVerified: boolean;
        citySelectionRequired: boolean;
        device: { id: string; trusted: boolean };
        stepUp: { required: boolean };
        token: {
          accessToken: string;
          refreshToken: string;
          mode: string;
          scopes: null;
        };
      };
    };

    expect(firstBody.data.phoneVerified).toBe(true);
    expect(firstBody.data.citySelectionRequired).toBe(true);
    expect(firstBody.data.device.trusted).toBe(true);
    expect(firstBody.data.stepUp.required).toBe(false);
    expect(firstBody.data.token.mode).toBe("full");
    expect(firstBody.data.token.scopes).toBeNull();
    expect(firstBody.data.token.refreshToken.length).toBeGreaterThan(20);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        subjectId: firstBody.data.device.id,
        action: "device.enrolled",
      },
    });
    expect(audit.reason).toBe("first_device_trusted");

    // Second device on the SAME account must stay LIMITED until step-up passes.
    await clearOtpState(user.phone);
    await requestCode(user.phone);
    const second = await verify(user.phone, lastCode(), "device-otp-second-2");
    expect(second.status).toBe(200);

    const secondBody = (await second.json()) as {
      data: {
        phoneVerified: boolean;
        grantsMoneyAccess: boolean;
        device: { trusted: boolean };
        stepUp: { required: boolean; methods: string[] };
        token: { accessToken: string; mode: string; scopes: string[] };
      };
    };

    expect(secondBody.data.phoneVerified).toBe(true);
    expect(secondBody.data.grantsMoneyAccess).toBe(false);
    expect(secondBody.data.device.trusted).toBe(false);
    expect(secondBody.data.stepUp.required).toBe(true);
    expect(secondBody.data.stepUp.methods).toContain("old_device_approve");
    expect(secondBody.data.stepUp.methods).toContain("selfie_nin");

    expect(secondBody.data.token.mode).toBe("limited");
    expect(secondBody.data.token.scopes).toContain("ride:book:cash");
    for (const forbidden of [
      "wallet:transfer:p2p",
      "wallet:transfer:nip",
      "security:pin:change",
      "security:phone:change",
      "wallet:topup",
    ]) {
      expect(secondBody.data.token.scopes).not.toContain(forbidden);
    }

    const claims = jose.decodeJwt(secondBody.data.token.accessToken);
    expect(claims.mode).toBe("limited");
    expect(await redis.get(otpCacheKey(user.phone))).toBeNull();
  });

  it("refuses a suspended account outright", async () => {
    const user = await createUser("RIDER");
    await prisma.user.update({
      where: { id: user.id },
      data: { status: "SUSPENDED" },
    });
    await clearOtpState(user.phone);

    const response = await requestCode(user.phone);
    expect(response.status).toBe(403);
  });
});

describe("city-bound sign-up, city selection, refresh rotation, and recovery (DEC-7 / DEC-8)", () => {
  it("lists launched cities, signs up with a launched city, and issues city-bound rotatable tokens", async () => {
    const citiesRes = await harness.app.fetch(
      new Request("http://user-service.test/auth/cities"),
    );
    expect(citiesRes.status).toBe(200);
    const citiesBody = (await citiesRes.json()) as {
      data: { cities: { id: string; name: string }[] };
    };
    expect(citiesBody.data.cities.map((c) => c.id)).toEqual(["LOS", "ABV"]);

    const phone = `+2348${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}`;
    await clearOtpState(phone);

    // Unlaunched city is rejected with 404 city_unsupported
    const badCityRes = await harness.app.fetch(
      new Request("http://user-service.test/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone,
          firstName: "Ada",
          lastName: "Okafor",
          cityId: "XYZ",
          role: "DRIVER",
        }),
      }),
    );
    expect(badCityRes.status).toBe(404);
    const badCityBody = (await badCityRes.json()) as {
      error: { code: string };
    };
    expect(badCityBody.error.code).toBe("city_unsupported");

    // Launched city succeeds and sends OTP
    const signupRes = await harness.app.fetch(
      new Request("http://user-service.test/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone,
          firstName: "Ada",
          lastName: "Okafor",
          cityId: "LOS",
          role: "DRIVER",
        }),
      }),
    );
    expect(signupRes.status).toBe(201);

    const verifyRes = await verify(phone, lastCode(), "device-signup-los-1");
    expect(verifyRes.status).toBe(200);
    const verifyBody = (await verifyRes.json()) as {
      data: {
        citySelectionRequired: boolean;
        user: { id: string; cityId: string | null; role: string };
        token: { accessToken: string; refreshToken: string; mode: string };
      };
    };
    expect(verifyBody.data.citySelectionRequired).toBe(false);
    expect(verifyBody.data.user.cityId).toBe("LOS");
    expect(verifyBody.data.token.mode).toBe("full");

    const accessClaims = jose.decodeJwt(verifyBody.data.token.accessToken);
    expect(accessClaims.cityId).toBe("LOS");
    expect(accessClaims.role).toBe("driver");

    // Refresh rotates single-use token and preserves cityId + mode
    const refreshRes = await harness.app.fetch(
      new Request("http://user-service.test/auth/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          refreshToken: verifyBody.data.token.refreshToken,
          deviceId: "device-signup-los-1",
        }),
      }),
    );
    expect(refreshRes.status).toBe(200);
    const refreshBody = (await refreshRes.json()) as {
      data: {
        tokens: { accessToken: string; refreshToken: string; mode: string };
      };
    };
    expect(refreshBody.data.tokens.refreshToken).not.toBe(
      verifyBody.data.token.refreshToken,
    );
    expect(jose.decodeJwt(refreshBody.data.tokens.accessToken).cityId).toBe(
      "LOS",
    );

    // Replaying the rotated-away refresh token is rejected
    const replayRes = await harness.app.fetch(
      new Request("http://user-service.test/auth/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          refreshToken: verifyBody.data.token.refreshToken,
        }),
      }),
    );
    expect(replayRes.status).toBe(401);

    // Changing city via POST /auth/city updates homeCityId, audits, and re-issues token
    const changeCityRes = await harness.app.fetch(
      new Request("http://user-service.test/auth/city", {
        method: "POST",
        headers: await authedHeaders(
          {
            userId: verifyBody.data.user.id,
            role: "driver",
            scopes: ["profile:read"],
            modes: ["limited"],
            cityId: null,
          },
          { "idempotency-key": "idem-city-select-abv-1" },
        ),
        body: JSON.stringify({ cityId: "ABV" }),
      }),
    );
    expect(changeCityRes.status).toBe(200);
    const changeCityBody = (await changeCityRes.json()) as {
      data: {
        cityId: string;
        token: { accessToken: string };
      };
    };
    expect(changeCityBody.data.cityId).toBe("ABV");
    expect(jose.decodeJwt(changeCityBody.data.token.accessToken).cityId).toBe(
      "ABV",
    );

    const cityAudit = await prisma.auditLog.findFirstOrThrow({
      where: {
        subjectId: verifyBody.data.user.id,
        action: "user.city_changed",
      },
    });
    expect(cityAudit.reason).toBe("user_selected_city");
  });

  it("recovers a trusted device only when an account has zero trusted devices and reviewer !== user", async () => {
    const account = await createUser("RIDER");
    const reviewer = await createUser("RIDER");

    // Enrol an untrusted device via POST /devices/enroll (0 trusted devices)
    const enrolRes = await harness.app.fetch(
      new Request("http://user-service.test/devices/enroll", {
        method: "POST",
        headers: await authedHeaders({
          userId: account.id,
          role: "rider",
          scopes: FULL_SCOPES,
        }),
        body: JSON.stringify({
          deviceId: "device-recover-01",
          platform: "ios",
        }),
      }),
    );
    expect(enrolRes.status).toBe(201);

    // Self-recovery is forbidden (approver_is_author)
    const selfRecoverRes = await harness.app.fetch(
      new Request("http://user-service.test/identity/devices/recover", {
        method: "POST",
        headers: await authedHeaders(
          {
            userId: account.id,
            role: "admin",
            scopes: FULL_SCOPES,
          },
          { "idempotency-key": "idem-recover-self-1" },
        ),
        body: JSON.stringify({
          userId: account.id,
          deviceId: "device-recover-01",
          ticketId: "SUP-10001",
          note: "Verified caller via live support video check",
        }),
      }),
    );
    expect(selfRecoverRes.status).toBe(409);

    // Distinct reviewer succeeds when 0 trusted devices exist
    const recoverRes = await harness.app.fetch(
      new Request("http://user-service.test/identity/devices/recover", {
        method: "POST",
        headers: await authedHeaders(
          {
            userId: reviewer.id,
            role: "admin",
            scopes: FULL_SCOPES,
          },
          { "idempotency-key": "idem-recover-ok-1" },
        ),
        body: JSON.stringify({
          userId: account.id,
          deviceId: "device-recover-01",
          ticketId: "SUP-10001",
          note: "Verified caller via live support video check",
        }),
      }),
    );
    expect(recoverRes.status).toBe(200);

    // Recovery is refused once the account already has a trusted device
    const enrolSecond = await harness.app.fetch(
      new Request("http://user-service.test/devices/enroll", {
        method: "POST",
        headers: await authedHeaders({
          userId: account.id,
          role: "rider",
          scopes: FULL_SCOPES,
        }),
        body: JSON.stringify({
          deviceId: "device-recover-02",
          platform: "android",
        }),
      }),
    );
    expect(enrolSecond.status).toBe(201);

    const secondRecoverRes = await harness.app.fetch(
      new Request("http://user-service.test/identity/devices/recover", {
        method: "POST",
        headers: await authedHeaders(
          {
            userId: reviewer.id,
            role: "admin",
            scopes: FULL_SCOPES,
          },
          { "idempotency-key": "idem-recover-dup-1" },
        ),
        body: JSON.stringify({
          userId: account.id,
          deviceId: "device-recover-02",
          ticketId: "SUP-10002",
          note: "Attempted recovery while trusted device exists",
        }),
      }),
    );
    expect(secondRecoverRes.status).toBe(409);
  });
});

describe("delivery failures", () => {
  it("answers otp_send_failed without leaving a live code or blocking an immediate retry", async () => {
    const user = await createUser("RIDER");
    await clearOtpState(user.phone);

    harness.breakSms(true);
    try {
      const response = await requestCode(user.phone);
      expect(response.status).toBe(503);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("otp_send_failed");
      expect(await redis.get(otpCacheKey(user.phone))).toBeNull();
    } finally {
      harness.breakSms(false);
    }

    const retry = await requestCode(user.phone);
    expect(retry.status).toBe(200);
  });
});
