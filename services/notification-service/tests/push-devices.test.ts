/**
 * Push Device Registration, Signed Identity & Short-Window Pending Flush Tests (CC-B04 / P1-13)
 *
 * Exercises the REAL notification-service Hono app (`src/app.ts`), REAL Postgres
 * (`device_tokens` + `users` on `ubi_notify_test`), and REAL Redis (`notif:mp:pending`
 * + `notif:mp:flushed:*`).
 *
 * MOCK BOUNDARY (explicit per launch verification rules):
 * ONLY Firebase Cloud Messaging (`firebaseService.sendClassifiedMulticast`) is
 * spied on because no live Firebase project credentials exist in CI.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { createHmac, randomBytes, randomUUID } from "node:crypto";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { EventEnvelope } from "@ubi/contracts";
import type { Hono } from "hono";

const TEST_DB_URL =
  process.env.NOTIFY_TEST_DATABASE_URL ??
  "postgresql://ubi:ubi_dev_password@127.0.0.1:5432/ubi_notify_test";
const TEST_REDIS_URL =
  process.env.NOTIFY_TEST_REDIS_URL ?? "redis://127.0.0.1:6379/5";
const IDENTITY_SECRET = "test-gateway-identity-secret-at-least-32-chars!!";
const WRONG_IDENTITY_SECRET =
  "wrong-gateway-identity-secret-at-least-32-chars!!";

process.env.DATABASE_URL = TEST_DB_URL;
process.env.REDIS_URL = TEST_REDIS_URL;
process.env.UBI_IDENTITY_SECRET = IDENTITY_SECRET;
process.env.INTERNAL_SERVICE_KEY =
  "test-internal-service-key-at-least-32-chars!!";
process.env.NOTIFICATION_SERVICE_KEY =
  "test-notification-service-key-at-least-32!!";
process.env.JWT_SECRET = "test-dev-jwt-secret-at-least-32-characters!!";
process.env.LOG_LEVEL = "silent";

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signIdentityHeader(
  sub: string,
  options: {
    role?: string;
    mode?: "full" | "limited";
    secret?: string;
  } = {},
): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "ubi-id+jwt" }));
  const payload = b64url(
    JSON.stringify({
      iss: "ubi-gateway",
      aud: "ubi-internal",
      sub,
      role: options.role ?? "rider",
      rid: `req_${randomUUID()}`,
      scp: ["profile:read"],
      mod: options.mode === "limited" ? ["limited"] : [],
      city: "LOS",
      iat: nowSec,
      exp: nowSec + 60,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const sig = b64url(
    createHmac("sha256", options.secret ?? IDENTITY_SECRET)
      .update(signingInput)
      .digest(),
  );
  return `${signingInput}.${sig}`;
}

const RUN = randomBytes(4).toString("hex");
const userA = randomUUID();
const userB = randomUUID();

let app: Hono;
let prismaClient: typeof import("../src/lib/prisma.js").prisma;
let redisClient: typeof import("../src/lib/redis.js").redis;
let closeRedis: typeof import("../src/lib/redis.js").closeConnections;
let firebaseSvc: typeof import("../src/providers/firebase.js").firebaseService;
let buildPorts: typeof import("../src/marketplace/consumer.js").buildMarketplacePushPorts;
let flushPending: typeof import("../src/marketplace/consumer.js").flushPendingForUser;
let Deliverer: typeof import("../src/marketplace/push.js").MarketplacePushDeliverer;
let assertAuthCfg: typeof import("../src/middleware/auth.js").assertServiceAuthConfig;

beforeAll(async () => {
  const appMod = await import("../src/app.js");
  const prismaMod = await import("../src/lib/prisma.js");
  const redisMod = await import("../src/lib/redis.js");
  const firebaseMod = await import("../src/providers/firebase.js");
  const consumerMod = await import("../src/marketplace/consumer.js");
  const pushMod = await import("../src/marketplace/push.js");
  const authMod = await import("../src/middleware/auth.js");

  app = appMod.createApp();
  prismaClient = prismaMod.prisma;
  redisClient = redisMod.redis;
  closeRedis = redisMod.closeConnections;
  firebaseSvc = firebaseMod.firebaseService;
  buildPorts = consumerMod.buildMarketplacePushPorts;
  flushPending = consumerMod.flushPendingForUser;
  Deliverer = pushMod.MarketplacePushDeliverer;
  assertAuthCfg = authMod.assertServiceAuthConfig;

  await prismaClient.user.createMany({
    data: [
      {
        id: userA,
        email: `push-a-${RUN}@test.ubi`,
        phone: `+23481${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
        passwordHash: "x",
        firstName: "Amaka",
        lastName: "Obi",
        country: "NG",
        phoneVerified: true,
      },
      {
        id: userB,
        email: `push-b-${RUN}@test.ubi`,
        phone: `+23482${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
        passwordHash: "x",
        firstName: "Tunde",
        lastName: "Bello",
        country: "NG",
        phoneVerified: true,
      },
    ],
  });
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await prismaClient.deviceToken.deleteMany({
    where: { userId: { in: [userA, userB] } },
  });
  const pendingItems = await redisClient.lrange("notif:mp:pending", 0, -1);
  for (const raw of pendingItems) {
    if (raw.includes(userA) || raw.includes(userB)) {
      await redisClient.lrem("notif:mp:pending", 0, raw);
    }
  }
});

afterAll(async () => {
  await prismaClient.deviceToken.deleteMany({
    where: { userId: { in: [userA, userB] } },
  });
  await prismaClient.user.deleteMany({
    where: { id: { in: [userA, userB] } },
  });
  await prismaClient.$disconnect();
  await closeRedis().catch(() => undefined);
});

describe("notification-service push device registration & pending flush (CC-B04)", () => {
  it("enforces UBI_IDENTITY_SECRET >= 32 chars on production boot", () => {
    expect(() =>
      assertAuthCfg({
        NODE_ENV: "production",
        INTERNAL_SERVICE_KEY: "a".repeat(32),
        NOTIFICATION_SERVICE_KEY: "b".repeat(32),
      }),
    ).toThrow(/UBI_IDENTITY_SECRET/);

    expect(() =>
      assertAuthCfg({
        NODE_ENV: "production",
        UBI_IDENTITY_SECRET: "short",
        INTERNAL_SERVICE_KEY: "a".repeat(32),
        NOTIFICATION_SERVICE_KEY: "b".repeat(32),
      }),
    ).toThrow(/UBI_IDENTITY_SECRET/);

    expect(() =>
      assertAuthCfg({
        NODE_ENV: "production",
        UBI_IDENTITY_SECRET: "c".repeat(32),
        INTERNAL_SERVICE_KEY: "a".repeat(32),
        NOTIFICATION_SERVICE_KEY: "b".repeat(32),
      }),
    ).not.toThrow();
  });

  it("registers device strictly for signed x-ubi-identity principal, rejects body userId smuggling, and fails closed in production without signed JWS", async () => {
    // 1. Valid gateway-signed identity registers token under userA (even in limited mode).
    const regRes = await app.fetch(
      new Request("http://notif.test/api/v1/push/devices", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ubi-identity": signIdentityHeader(userA, { mode: "limited" }),
        },
        body: JSON.stringify({
          token: `fcm_tok_${RUN}_1`,
          platform: "android",
          deviceId: "rnd_device_1",
          appVersion: "0.1.0",
        }),
      }),
    );
    expect(regRes.status).toBe(200);
    const stored = await prismaClient.deviceToken.findUnique({
      where: { userId_token: { userId: userA, token: `fcm_tok_${RUN}_1` } },
    });
    expect(stored?.isActive).toBe(true);
    expect(stored?.platform).toBe("android");

    // 2. Attempting to smuggle another user's `userId` in the JSON body is rejected 400.
    const smuggleRes = await app.fetch(
      new Request("http://notif.test/api/v1/push/devices", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ubi-identity": signIdentityHeader(userA),
        },
        body: JSON.stringify({
          userId: userB,
          token: `fcm_tok_${RUN}_smuggled`,
          platform: "ios",
        }),
      }),
    );
    expect(smuggleRes.status).toBe(400);
    const smuggledRow = await prismaClient.deviceToken.findFirst({
      where: { userId: userB },
    });
    expect(smuggledRow).toBeNull();

    // 3. In production, missing or forged x-ubi-identity is rejected 401.
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const noIdentityRes = await app.fetch(
        new Request("http://notif.test/api/v1/push/devices", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer anything",
          },
          body: JSON.stringify({
            token: `fcm_tok_${RUN}_unsigned`,
            platform: "ios",
          }),
        }),
      );
      expect(noIdentityRes.status).toBe(401);

      const forgedRes = await app.fetch(
        new Request("http://notif.test/api/v1/push/devices", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ubi-identity": signIdentityHeader(userA, {
              secret: WRONG_IDENTITY_SECRET,
            }),
          },
          body: JSON.stringify({
            token: `fcm_tok_${RUN}_forged`,
            platform: "ios",
          }),
        }),
      );
      expect(forgedRes.status).toBe(401);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  it("flushes recent deferred notifications once on device registration, drops stale (>15m) items, and sends zero duplicates on repeat/concurrent flushes", async () => {
    // MOCKED EXTERNAL PROVIDER: Firebase Cloud Messaging multicast transport.
    const fcmSpy = vi
      .spyOn(firebaseSvc, "sendClassifiedMulticast")
      .mockResolvedValue({
        successCount: 1,
        failureCount: 0,
        invalidTokens: [],
        retryableTokens: [],
      });

    // UserA currently has zero active device tokens. Deliver a fresh outbox event:
    // it must defer into `notif:mp:pending` with its ids-only hint notification.
    const deliverer = new Deliverer(
      buildPorts(redisClient, { parties: null, sms: null }),
    );
    const freshEventId = `evt_fresh_${RUN}`;
    const freshEnv: EventEnvelope = {
      id: freshEventId,
      name: "mp.bid.submitted",
      version: 1,
      occurredAt: new Date().toISOString(),
      actor: { type: "driver", id: userB },
      subject: { type: "mp_bid", id: `bid_${RUN}` },
      idempotencyKey: `mp_bid:${RUN}:submitted`,
      fromVersion: null,
      toVersion: 1,
      cityId: "LOS",
      payload: {
        requestId: `req_${RUN}`,
        requesterId: userA,
        driverId: userB,
        amountMinor: 350000,
        currency: "NGN",
      },
    };
    const deferred = await deliverer.handle(freshEnv);
    expect(deferred.perUser[0]?.outcome).toBe("deferred_no_device");
    expect(fcmSpy).not.toHaveBeenCalled();

    // Seed an expired pending item (20 minutes old, outside the 15-minute window).
    const staleEventId = `evt_stale_${RUN}`;
    await redisClient.rpush(
      "notif:mp:pending",
      JSON.stringify({
        eventId: staleEventId,
        eventName: "mp.bid.submitted",
        userId: userA,
        reason: "no_active_device",
        prefCategory: "ride",
        at: new Date(Date.now() - 20 * 60_000).toISOString(),
        notification: {
          title: "Stale offer",
          body: "Should never flush after 20 minutes",
          type: "MARKETPLACE",
          data: { kind: "marketplace", name: "mp.bid.submitted" },
        },
      }),
    );

    // Register UserA's device via POST /api/v1/push/devices -> flushes ONLY freshEnv!
    const token = `fcm_tok_flush_${RUN}`;
    const firstReg = await app.fetch(
      new Request("http://notif.test/api/v1/push/devices", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ubi-identity": signIdentityHeader(userA),
        },
        body: JSON.stringify({ token, platform: "ios" }),
      }),
    );
    expect(firstReg.status).toBe(200);
    const firstBody = (await firstReg.json()) as {
      success: boolean;
      data: { flushed: number };
    };
    expect(firstBody.data.flushed).toBe(1);
    expect(fcmSpy).toHaveBeenCalledTimes(1);
    const sentCall = fcmSpy.mock.calls[0]?.[0];
    expect(sentCall?.tokens).toEqual([token]);
    expect(sentCall?.title).toBe("New offer on your request");
    // Private bid money never appears in the flushed notification payload.
    expect(JSON.stringify(sentCall)).not.toContain("350000");

    // Re-registering (or concurrent flush even if an identical pending entry were
    // still present before lrem) sends ZERO duplicates thanks to atomic SET NX.
    await redisClient.rpush(
      "notif:mp:pending",
      JSON.stringify({
        eventId: freshEventId,
        eventName: "mp.bid.submitted",
        userId: userA,
        reason: "no_active_device",
        prefCategory: "ride",
        at: new Date().toISOString(),
        notification: {
          title: "New offer on your request",
          body: "Duplicate test",
          type: "MARKETPLACE",
          data: { kind: "marketplace", name: "mp.bid.submitted" },
        },
      }),
    );
    const concurrent = await Promise.all([
      flushPending(redisClient, userA),
      flushPending(redisClient, userA),
    ]);
    expect(concurrent.reduce((acc, r) => acc + r.flushed, 0)).toBe(0);
    expect(
      concurrent.reduce((acc, r) => acc + r.skippedDuplicate, 0),
    ).toBeGreaterThanOrEqual(1);
    expect(fcmSpy).toHaveBeenCalledTimes(1);
  });

  it("unregisters only the authenticated caller's token via DELETE /push/devices and DELETE /push/devices/:token", async () => {
    const tokenA = `fcm:${RUN}/colon:token`;
    const tokenB = `fcm_${RUN}_other_user`;

    for (const [uid, tok] of [
      [userA, tokenA],
      [userB, tokenB],
    ] as const) {
      const res = await app.fetch(
        new Request("http://notif.test/api/v1/push/devices", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ubi-identity": signIdentityHeader(uid),
          },
          body: JSON.stringify({ token: tok, platform: "android" }),
        }),
      );
      expect(res.status).toBe(200);
    }

    // UserA cannot deactivate UserB's token.
    const crossDelete = await app.fetch(
      new Request("http://notif.test/api/v1/push/devices", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "x-ubi-identity": signIdentityHeader(userA),
        },
        body: JSON.stringify({ token: tokenB }),
      }),
    );
    expect(crossDelete.status).toBe(200);
    const rowB = await prismaClient.deviceToken.findUnique({
      where: { userId_token: { userId: userB, token: tokenB } },
    });
    expect(rowB?.isActive).toBe(true);

    // UserA deactivates their own token via JSON body (works with `:` and `/`).
    const selfDeleteBody = await app.fetch(
      new Request("http://notif.test/api/v1/push/devices", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "x-ubi-identity": signIdentityHeader(userA),
        },
        body: JSON.stringify({ token: tokenA }),
      }),
    );
    expect(selfDeleteBody.status).toBe(200);
    const afterBodyDelete = await prismaClient.deviceToken.findUnique({
      where: { userId_token: { userId: userA, token: tokenA } },
    });
    expect(afterBodyDelete?.isActive).toBe(false);

    // Re-activate and deactivate via URL-encoded DELETE /devices/:token.
    await prismaClient.deviceToken.update({
      where: { userId_token: { userId: userA, token: tokenA } },
      data: { isActive: true },
    });
    const selfDeleteParam = await app.fetch(
      new Request(
        `http://notif.test/api/v1/push/devices/${encodeURIComponent(tokenA)}`,
        {
          method: "DELETE",
          headers: {
            "x-ubi-identity": signIdentityHeader(userA),
          },
        },
      ),
    );
    expect(selfDeleteParam.status).toBe(200);
    const afterParamDelete = await prismaClient.deviceToken.findUnique({
      where: { userId_token: { userId: userA, token: tokenA } },
    });
    expect(afterParamDelete?.isActive).toBe(false);
  });
});
