/**
 * Tests for service authentication on /broadcast/user/:userId and /stats,
 * plus WebSocket upgrade role derivation, /v1/stream + /ws path support, and
 * bounded replay.
 */

import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../connection-manager.js";
import {
  checkServiceAuth,
  verifyServiceHmacToken,
} from "../lib/service-auth.js";
import {
  createRealtimeHttpApp,
  handleWebSocketUpgradeConnection,
} from "../server.js";

const SERVICE_SECRET = "test-service-secret";
const INTERNAL_KEY = "test-internal-key";
const TEST_JWT_SECRET = "test-secret-for-testing-only-32-chars!";
const TEST_IDENTITY_SECRET = "test-identity-secret-32-characters!!";

function makeSvcToken(serviceId: string, secret: string): string {
  const hmac = createHmac("sha256", secret)
    .update(`svc_${serviceId}`)
    .digest("hex")
    .substring(0, 32);
  return `svc_${serviceId}_${hmac}`;
}

async function signAccessJwt(sub: string, role: string): Promise<string> {
  return await new jose.SignJWT({ sub, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("ubi.africa")
    .setAudience("ubi-api")
    .setExpirationTime("15m")
    .setIssuedAt()
    .sign(new TextEncoder().encode(TEST_JWT_SECRET));
}

async function signGatewayIdentityJwt(
  sub: string,
  modes: string[],
): Promise<string> {
  return await new jose.SignJWT({ sub, modes, scopes: [] })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("ubi-api-gateway")
    .setAudience("ubi-internal")
    .setExpirationTime("60s")
    .setIssuedAt()
    .sign(new TextEncoder().encode(TEST_IDENTITY_SECRET));
}

function makeApp() {
  return createRealtimeHttpApp({
    getConnectionStats: () => ({
      serverId: "srv_test",
      totalConnections: 2,
      uniqueUsers: 2,
      byUserType: { rider: 1, driver: 1 },
      uptime: 10,
    }),
    broadcastToUser: async () => {},
  });
}

class FakeRedis extends EventEmitter {
  sadd = vi.fn(async () => 1);
  srem = vi.fn(async () => 1);
  hset = vi.fn(async () => 1);
  expire = vi.fn(async () => 1);
  del = vi.fn(async () => 1);
  publish = vi.fn(async () => 1);
  pubsub = vi.fn(async () => ["user:1", 0]);
  subscribe = vi.fn(async () => 1);
  unsubscribe = vi.fn(async () => 1);
  psubscribe = vi.fn(async () => 1);
  quit = vi.fn(async () => "OK");
}

class FakeWs extends EventEmitter {
  readyState = 1; // WebSocket.OPEN
  sent: unknown[] = [];
  closedWith: { code?: number; reason?: string } | null = null;
  send = vi.fn((raw: string) => {
    this.sent.push(JSON.parse(raw));
  });
  close = vi.fn((code?: number, reason?: string) => {
    this.closedWith = { code, reason };
    this.readyState = 3;
    this.emit("close");
  });
}

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv.SERVICE_SECRET = process.env.SERVICE_SECRET;
  savedEnv.INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;
  savedEnv.JWT_SECRET = process.env.JWT_SECRET;
  savedEnv.UBI_IDENTITY_SECRET = process.env.UBI_IDENTITY_SECRET;
  delete process.env.SERVICE_SECRET;
  delete process.env.INTERNAL_SERVICE_KEY;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.UBI_IDENTITY_SECRET = TEST_IDENTITY_SECRET;
});

afterEach(() => {
  for (const key of [
    "SERVICE_SECRET",
    "INTERNAL_SERVICE_KEY",
    "JWT_SECRET",
    "UBI_IDENTITY_SECRET",
  ]) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("verifyServiceHmacToken", () => {
  it("accepts a correctly signed svc_ token", () => {
    const token = makeSvcToken("marketplace", SERVICE_SECRET);
    expect(verifyServiceHmacToken(token, SERVICE_SECRET)).toBe(true);
  });

  it("rejects a token signed with the wrong secret", () => {
    const token = makeSvcToken("marketplace", "wrong-secret");
    expect(verifyServiceHmacToken(token, SERVICE_SECRET)).toBe(false);
  });

  it("rejects malformed tokens", () => {
    expect(verifyServiceHmacToken("svc_only-two", SERVICE_SECRET)).toBe(false);
    expect(verifyServiceHmacToken("not-a-token", SERVICE_SECRET)).toBe(false);
  });
});

describe("POST /broadcast/user/:userId and GET /stats auth (P2-09)", () => {
  const body = JSON.stringify({
    type: "notification",
    payload: {
      id: "n1",
      title: "t",
      body: "b",
      priority: "normal",
      timestamp: 1,
    },
  });

  it("rejects an unauthenticated broadcast when SERVICE_SECRET is configured", async () => {
    process.env.SERVICE_SECRET = SERVICE_SECRET;
    const app = makeApp();

    const res = await app.request("/broadcast/user/usr_1", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("unauthorized");
  });

  it("rejects an unauthenticated GET /stats when INTERNAL_SERVICE_KEY is configured", async () => {
    process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;
    const app = makeApp();

    const res = await app.request("/stats");
    expect(res.status).toBe(401);

    const authed = await app.request("/stats", {
      headers: { "x-service-key": INTERNAL_KEY },
    });
    expect(authed.status).toBe(200);
    const stats = (await authed.json()) as { totalConnections: number };
    expect(stats.totalConnections).toBe(2);
  });

  it("rejects a broadcast with a forged svc_ token", async () => {
    process.env.SERVICE_SECRET = SERVICE_SECRET;
    const app = makeApp();

    const res = await app.request("/broadcast/user/usr_1", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${makeSvcToken("marketplace", "wrong-secret")}`,
      },
    });

    expect(res.status).toBe(401);
  });

  it("accepts a broadcast with a valid svc_ token", async () => {
    process.env.SERVICE_SECRET = SERVICE_SECRET;
    const app = makeApp();

    const res = await app.request("/broadcast/user/usr_1", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${makeSvcToken("marketplace", SERVICE_SECRET)}`,
      },
    });

    expect(res.status).toBe(200);
  });

  it("accepts a broadcast with a valid X-Service-Key", async () => {
    process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;
    const app = makeApp();

    const res = await app.request("/broadcast/user/usr_1", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-service-key": INTERNAL_KEY,
      },
    });

    expect(res.status).toBe(200);
  });

  it("rejects a wrong X-Service-Key", async () => {
    process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;
    const app = makeApp();

    const res = await app.request("/broadcast/user/usr_1", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-service-key": "wrong-key",
      },
    });

    expect(res.status).toBe(401);
  });

  it("allows requests when no secret is configured (dev mode)", async () => {
    const app = makeApp();

    const res = await app.request("/broadcast/user/usr_1", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(checkServiceAuth({}).unauthenticatedDev).toBe(true);
  });
});

describe("WebSocket upgrade role derivation, /v1/stream protocol, and bounded replay (P2-09, P2-16)", () => {
  it("rejects a rider token that asserts userType=driver with 4002", async () => {
    const riderToken = await signAccessJwt("usr_rider_1", "rider");
    const ws = new FakeWs();
    const handleConnection = vi.fn();
    const req = {
      url: `/ws?userType=driver&token=${encodeURIComponent(riderToken)}`,
      headers: { host: "rt.ubi.africa" },
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as IncomingMessage;

    await handleWebSocketUpgradeConnection(ws as never, req, {
      handleConnection,
      canAcceptUserConnection: () => true,
    });

    expect(ws.closedWith?.code).toBe(4002);
    expect(handleConnection).not.toHaveBeenCalled();
  });

  it("derives userType=rider on /v1/stream when userType query param is omitted (mobile-core)", async () => {
    const riderToken = await signAccessJwt("usr_rider_2", "rider");
    const ws = new FakeWs();
    const handleConnection = vi.fn(async () => "conn_1");
    const req = {
      url: `/v1/stream?channel=mp_request.req_1&lastSeq=5&token=${encodeURIComponent(riderToken)}`,
      headers: { host: "rt.ubi.africa" },
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as IncomingMessage;

    await handleWebSocketUpgradeConnection(ws as never, req, {
      handleConnection,
      canAcceptUserConnection: () => true,
    });

    expect(ws.closedWith).toBeNull();
    expect(handleConnection).toHaveBeenCalledWith(
      ws,
      "usr_rider_2",
      "rider",
      "unknown",
      "web",
      expect.objectContaining({
        channel: "mp_request.req_1",
        lastSeq: 5,
      }),
    );
  });

  it("accepts a gateway-signed x-ubi-identity header and derives userType=driver from modes", async () => {
    const idToken = await signGatewayIdentityJwt("drv_1", ["driver"]);
    const ws = new FakeWs();
    const handleConnection = vi.fn(async () => "conn_2");
    const req = {
      url: "/v1/stream?channel=mp_feed&lastSeq=0",
      headers: {
        host: "rt.ubi.africa",
        "x-ubi-identity": idToken,
      },
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as IncomingMessage;

    await handleWebSocketUpgradeConnection(ws as never, req, {
      handleConnection,
      canAcceptUserConnection: () => true,
    });

    expect(ws.closedWith).toBeNull();
    expect(handleConnection).toHaveBeenCalledWith(
      ws,
      "drv_1",
      "driver",
      "unknown",
      "web",
      expect.objectContaining({
        channel: "mp_feed",
        lastSeq: 0,
      }),
    );
  });

  it("replays missed events when lastSeq gap <= 50 and sends replay_overflow when gap > 50", async () => {
    const redis = new FakeRedis();
    const redisSub = new FakeRedis();
    const manager = new ConnectionManager("redis://localhost:6379", {
      redis: redis as never,
      redisSub: redisSub as never,
    });

    for (let seq = 1; seq <= 3; seq++) {
      await manager.broadcastToUser("usr_1", {
        type: "marketplace_event",
        seq,
        occurredAt: "2026-09-20T10:00:00Z",
        payload: {
          name: "mp.bid.submitted",
          subject: { type: "mp_bid", id: `bid_${seq}` },
          seq,
          occurredAt: "2026-09-20T10:00:00Z",
          data: { bidId: `bid_${seq}`, amountMinor: 250000 },
        },
      });
    }

    const wsReplay = new FakeWs();
    await manager.handleConnection(
      wsReplay as never,
      "usr_1",
      "rider",
      "dev_1",
      "ios",
      { lastSeq: 1 },
    );

    expect(wsReplay.sent).toHaveLength(2);
    expect((wsReplay.sent[0] as { seq: number }).seq).toBe(2);
    expect((wsReplay.sent[1] as { seq: number }).seq).toBe(3);

    // Push sequence past MAX_REPLAY_EVENTS (50)
    for (let seq = 4; seq <= 60; seq++) {
      await manager.broadcastToUser("usr_1", {
        type: "marketplace_event",
        seq,
        occurredAt: "2026-09-20T10:00:00Z",
        payload: {
          name: "mp.bid.submitted",
          subject: { type: "mp_bid", id: `bid_${seq}` },
          seq,
          occurredAt: "2026-09-20T10:00:00Z",
          data: { bidId: `bid_${seq}`, amountMinor: 250000 },
        },
      });
    }

    const wsOverflow = new FakeWs();
    await manager.handleConnection(
      wsOverflow as never,
      "usr_1",
      "rider",
      "dev_2",
      "ios",
      { lastSeq: 1 },
    );

    expect(wsOverflow.sent).toHaveLength(1);
    expect((wsOverflow.sent[0] as { type: string }).type).toBe(
      "replay_overflow",
    );

    await manager.cleanup();
  });
});
