import "./setup-env";

import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as jose from "jose";

import { prisma } from "../../src/lib/prisma";
import { redis } from "../../src/lib/redis";
import {
  closeConnections,
  createHarness,
  createUser,
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
  const id = createHash("sha256").update(`${pepper}:${phone}`).digest("base64url").slice(0, 32);
  await redis.del(`ubi:identity:otp:cooldown:${id}`, `ubi:identity:otp:sends:${id}`);
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

    const parsed = JSON.parse(stored as string) as { hash: string; attempts: number };
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
    expect((await verify(user.phone, code, "device-otp-attempts")).status).toBe(401);
  });

  it("refuses a code that was never issued", async () => {
    const user = await createUser("RIDER");
    await clearOtpState(user.phone);
    const response = await verify(user.phone, "123456", "device-otp-none-1");
    expect(response.status).toBe(401);
  });
});

describe("an SMS code never unlocks money", () => {
  it("hands a LIMITED-MODE token to a correct code on a new device", async () => {
    const user = await createUser("RIDER");
    await clearOtpState(user.phone);
    await requestCode(user.phone);

    const response = await verify(user.phone, lastCode(), "device-otp-newdev-1");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      data: {
        phoneVerified: boolean;
        grantsMoneyAccess: boolean;
        device: { trusted: boolean };
        stepUp: { required: boolean; methods: string[] };
        token: { accessToken: string; mode: string; scopes: string[] };
      };
    };

    expect(body.data.phoneVerified).toBe(true);
    expect(body.data.grantsMoneyAccess).toBe(false);
    expect(body.data.device.trusted).toBe(false);
    expect(body.data.stepUp.required).toBe(true);
    expect(body.data.stepUp.methods).toContain("selfie_nin");

    expect(body.data.token.mode).toBe("limited");
    expect(body.data.token.scopes).toContain("ride:book:cash");
    for (const forbidden of [
      "wallet:transfer:p2p",
      "wallet:transfer:nip",
      "security:pin:change",
      "security:phone:change",
      "wallet:topup",
    ]) {
      expect(body.data.token.scopes).not.toContain(forbidden);
    }

    const claims = jose.decodeJwt(body.data.token.accessToken);
    expect(claims.mode).toBe("limited");

    // The code is spent.
    expect(await redis.get(otpCacheKey(user.phone))).toBeNull();
  });

  it("hands a full-mode token only when the DEVICE is already trusted", async () => {
    const user = await createUser("RIDER");
    await clearOtpState(user.phone);
    await requestCode(user.phone);
    const first = await verify(user.phone, lastCode(), "device-otp-trusted1");
    const firstBody = (await first.json()) as { data: { device: { trusted: boolean } } };
    expect(firstBody.data.device.trusted).toBe(false);

    const device = await prisma.device.findFirstOrThrow({ where: { userId: user.id } });
    await prisma.device.update({ where: { id: device.id }, data: { trusted: true } });

    await clearOtpState(user.phone);
    await requestCode(user.phone);
    const second = await verify(user.phone, lastCode(), "device-otp-trusted1");
    const secondBody = (await second.json()) as {
      data: { device: { trusted: boolean }; token: { mode: string; scopes: null } };
    };
    expect(secondBody.data.device.trusted).toBe(true);
    expect(secondBody.data.token.mode).toBe("full");
    expect(secondBody.data.token.scopes).toBeNull();
  });

  it("refuses a suspended account outright", async () => {
    const user = await createUser("RIDER");
    await prisma.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });
    await clearOtpState(user.phone);

    const response = await requestCode(user.phone);
    expect(response.status).toBe(403);
  });
});

describe("delivery failures", () => {
  it("does not leave a live code behind when the SMS cannot be sent", async () => {
    const user = await createUser("RIDER");
    await clearOtpState(user.phone);

    harness.breakSms(true);
    try {
      const response = await requestCode(user.phone);
      expect(response.status).toBe(503);
      expect(await redis.get(otpCacheKey(user.phone))).toBeNull();
    } finally {
      harness.breakSms(false);
    }
  });
});
