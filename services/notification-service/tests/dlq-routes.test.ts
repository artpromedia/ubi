/**
 * Notification DLQ Ops Routes integration test (CC-A15 / P2-04).
 *
 * Exercises GET /api/v1/ops/notifications/dlq, GET /:id, POST /:id/replay, and
 * POST /:id/discard against real Redis (db 5) with faked FCM/SMS senders and
 * audit capture.
 */
/* eslint-disable require-await, @typescript-eslint/require-await */
import { Hono } from "hono";
import { Redis } from "ioredis";
import { sign } from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildMarketplacePushPorts } from "../src/marketplace/consumer.js";
import {
  MarketplacePushDeliverer,
  type PushNotification,
} from "../src/marketplace/push.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { createDlqRoutes } from "../src/routes/dlq.js";
import {
  TEST_REDIS_URL,
  deleteKeys,
  runPrefix,
} from "../src/test-support/redis.js";
import {
  issuedEnvelope,
  randomKeyBase64,
} from "../src/test-support/trip-access.js";
import {
  PASSENGER_TRIP_LINK_BASE_URL_ENV,
  buildTripAccessPorts,
  loadTripAccessConfig,
} from "../src/trip-access/consumer.js";
import { TripAccessSmsDeliverer } from "../src/trip-access/deliverer.js";

import type { EventEnvelope } from "@ubi/contracts";

const JWT_SECRET = "test-dlq-jwt-secret-must-be-at-least-32-chars";
const KEY = randomKeyBase64();
const KID = "kid-dlq-test";
const LINK_BASE = "https://ride.ubi.africa/t";
const PHONE = "+2348039998877";
const TOKEN = "uta_secret_guest_token_9988776655";
const OPS_USER = "11111111-2222-4333-8444-555555555555";
const RIDER_USER = "22222222-3333-4444-8555-666666666666";

function makeToken(userId: string, role: string): string {
  return sign({ sub: userId, role, type: "access" }, JWT_SECRET, {
    expiresIn: "1h",
  });
}

describe("Notification DLQ Ops Routes (/api/v1/ops/notifications/dlq)", () => {
  const mpPrefix = runPrefix("dlq_mp");
  const taPrefix = runPrefix("dlq_ta");
  let redis: Redis;
  let app: Hono;

  let failFcm = true;
  let failSms = true;
  const pushSends: Array<{ userId: string; notification: PushNotification }> =
    [];
  const smsSends: Array<{ to: string; message: string }> = [];
  const audits: Array<{
    actorId: string;
    action: string;
    resourceId: string;
    details: Record<string, unknown>;
  }> = [];

  const taEnv = {
    TRIP_ACCESS_DELIVERY_KEY: KEY,
    TRIP_ACCESS_DELIVERY_KID: KID,
    [PASSENGER_TRIP_LINK_BASE_URL_ENV]: LINK_BASE,
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    redis = new Redis(TEST_REDIS_URL);

    const mpOverrides = {
      keyPrefix: mpPrefix,
      devices: {
        activeTokens: async (userId: string) => [`tok_${userId}`],
        deactivate: async () => {},
      },
      prefs: { allows: async () => true },
      sender: {
        send: async (
          userId: string,
          _tokens: string[],
          notification: PushNotification,
        ) => {
          pushSends.push({ userId, notification });
          return failFcm
            ? { success: false, error: "fcm_503_unavailable" }
            : { success: true };
        },
      },
      inbox: null,
      parties: null,
      sms: null,
      maxAttempts: 1,
      delay: async () => {},
    };

    const taSms = {
      send: async (to: string, message: string) => {
        smsSends.push({ to, message });
        return failSms
          ? {
              success: false,
              permanent: true,
              error: `Upstream error for ${PHONE}`,
            }
          : { success: true, provider: "fake", messageId: "SM_OK" };
      },
    };

    // Seed one marketplace push DLQ item and one trip_access SMS DLQ item.
    const mpPorts = buildMarketplacePushPorts(redis, mpOverrides);
    const mpDeliverer = new MarketplacePushDeliverer(mpPorts);
    const mpEnv: EventEnvelope = {
      id: "evt_dlq_mp_1",
      name: "mp.bid.won",
      version: 1,
      occurredAt: "2026-09-23T10:00:00.000Z",
      actor: { type: "system", id: "ride-service" },
      subject: { type: "mp_bid", id: "bid_dlq_1" },
      idempotencyKey: "mp.bid.won:evt_dlq_mp_1",
      fromVersion: 0,
      toVersion: 1,
      cityId: "lagos",
      sequence: 1,
      payload: {
        requestId: "req_dlq_1",
        driverId: RIDER_USER,
        amountMinor: 450000,
        currency: "NGN",
      },
    };
    await mpDeliverer.handle(mpEnv);

    const cfg = loadTripAccessConfig(taEnv);
    if (!cfg.ok) throw new Error(cfg.reason);
    const taPorts = buildTripAccessPorts(redis, cfg, {
      keyPrefix: taPrefix,
      sms: taSms,
    });
    const taDeliverer = new TripAccessSmsDeliverer(taPorts);
    const taEvent = issuedEnvelope({
      keyBase64: KEY,
      kid: KID,
      tokenId: "tac_dlq_1",
      phone: PHONE,
      token: TOKEN,
      firstName: "Amina",
    });
    await taDeliverer.handle(taEvent);

    app = new Hono();
    app.onError(errorHandler);
    app.route(
      "/api/v1/ops/notifications/dlq",
      createDlqRoutes({
        redis,
        mpKeyPrefix: mpPrefix,
        taKeyPrefix: taPrefix,
        mpOverrides,
        taEnv,
        taSms,
        recordAudit: async (entry) => {
          audits.push(entry);
        },
      }),
    );
  });

  afterAll(async () => {
    await deleteKeys(redis, mpPrefix);
    await deleteKeys(redis, taPrefix);
    await redis.quit();
  });

  it("rejects unauthenticated and non-ops callers", async () => {
    const unauth = await app.request("/api/v1/ops/notifications/dlq");
    expect(unauth.status).toBe(401);

    const riderToken = makeToken(RIDER_USER, "rider");
    const forbidden = await app.request("/api/v1/ops/notifications/dlq", {
      headers: { Authorization: `Bearer ${riderToken}` },
    });
    expect(forbidden.status).toBe(403);
  });

  it("lists pending DLQ entries across queues without leaking phones, tokens, or sealed ciphertext", async () => {
    const opsToken = makeToken(OPS_USER, "ops_admin");
    const res = await app.request("/api/v1/ops/notifications/dlq", {
      headers: { Authorization: `Bearer ${opsToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        items: Array<Record<string, unknown>>;
        total: number;
        counts: Record<string, number>;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.total).toBe(2);
    expect(body.data.counts.marketplace).toBe(1);
    expect(body.data.counts.tripAccess).toBe(1);
    expect(body.data.counts.pending).toBe(2);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(PHONE);
    expect(serialized).not.toContain(PHONE.slice(1));
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain("450000");
    expect(serialized).not.toContain("ciphertext");
  });

  it("replays a marketplace DLQ item idempotently and records an audit log", async () => {
    const opsToken = makeToken(OPS_USER, "ops_admin");
    const listRes = await app.request(
      "/api/v1/ops/notifications/dlq?queue=marketplace",
      {
        headers: { Authorization: `Bearer ${opsToken}` },
      },
    );
    const listBody = (await listRes.json()) as {
      data: { items: Array<{ id: string }> };
    };
    const mpId = listBody.data.items[0]!.id;

    // Detail endpoint works
    const detailRes = await app.request(
      `/api/v1/ops/notifications/dlq/${mpId}`,
      {
        headers: { Authorization: `Bearer ${opsToken}` },
      },
    );
    expect(detailRes.status).toBe(200);

    // Fix upstream FCM and replay
    failFcm = false;
    const beforeSends = pushSends.length;
    const replayRes = await app.request(
      `/api/v1/ops/notifications/dlq/${mpId}/replay`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${opsToken}` },
      },
    );
    expect(replayRes.status).toBe(200);
    const replayBody = (await replayRes.json()) as {
      replayed: boolean;
      idempotent: boolean;
      data: { status: string; replayOutcome: string; replayedBy: string };
    };
    expect(replayBody.replayed).toBe(true);
    expect(replayBody.idempotent).toBe(false);
    expect(replayBody.data.status).toBe("replayed");
    expect(replayBody.data.replayOutcome).toBe("processed");
    expect(replayBody.data.replayedBy).toBe(OPS_USER);
    expect(pushSends.length).toBe(beforeSends + 1);
    expect(
      audits.some(
        (a) => a.action === "notification.dlq.replay" && a.resourceId === mpId,
      ),
    ).toBe(true);

    // Second replay is a no-op (idempotent)
    const replayAgain = await app.request(
      `/api/v1/ops/notifications/dlq/${mpId}/replay`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${opsToken}` },
      },
    );
    expect(replayAgain.status).toBe(200);
    const againBody = (await replayAgain.json()) as { idempotent: boolean };
    expect(againBody.idempotent).toBe(true);
    expect(pushSends.length).toBe(beforeSends + 1);
  });

  it("discards a trip_access DLQ item with an audited reason and blocks subsequent replay", async () => {
    const opsToken = makeToken(OPS_USER, "ops_admin");
    const listRes = await app.request(
      "/api/v1/ops/notifications/dlq?queue=trip_access",
      {
        headers: { Authorization: `Bearer ${opsToken}` },
      },
    );
    const listBody = (await listRes.json()) as {
      data: { items: Array<{ id: string }> };
    };
    const taId = listBody.data.items[0]!.id;

    const discardRes = await app.request(
      `/api/v1/ops/notifications/dlq/${taId}/discard`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opsToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reason: "Passenger phone number permanently invalid",
        }),
      },
    );
    expect(discardRes.status).toBe(200);
    const discardBody = (await discardRes.json()) as {
      discarded: boolean;
      data: { status: string; discardReason: string; discardedBy: string };
    };
    expect(discardBody.discarded).toBe(true);
    expect(discardBody.data.status).toBe("discarded");
    expect(discardBody.data.discardReason).toBe(
      "Passenger phone number permanently invalid",
    );
    expect(discardBody.data.discardedBy).toBe(OPS_USER);
    expect(
      audits.some(
        (a) => a.action === "notification.dlq.discard" && a.resourceId === taId,
      ),
    ).toBe(true);

    // Attempting to replay a discarded item returns 409
    const replayAfterDiscard = await app.request(
      `/api/v1/ops/notifications/dlq/${taId}/replay`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${opsToken}` },
      },
    );
    expect(replayAfterDiscard.status).toBe(409);
  });
});
