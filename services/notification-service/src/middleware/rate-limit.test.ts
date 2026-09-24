/**
 * The notification limiter counts WHO the caller is — a verified user, else
 * the client address it resolved itself — never what a caller wrote in a
 * forwarding header, never one shared "unknown" bucket, and never a service
 * holding the internal key (src/middleware/rate-limit.ts, round 8 P0).
 *
 * The defect this pins: the key was `userId || X-Forwarded-For || X-Real-IP ||
 * "unknown"` and getClientIP took the leftmost X-Forwarded-For entry. Mounted
 * before `auth`, userId was never set, so every caller keyed on a header it
 * wrote — a fresh bucket per request — and every service call, which sends
 * none, shared "unknown".
 *
 * The limiter runs in a real Hono app with the REAL `auth` / `serviceAuth`
 * guards and error handler, served by @hono/node-server on a real TCP port,
 * into real Redis (NOTIFY_TEST_REDIS_URL, db 6 for this suite's runs).
 * Distinct client addresses are real: Linux routes all of 127.0.0.0/8 to
 * loopback, so a request bound to `localAddress: 127.0.0.21` arrives from
 * peer 127.0.0.21 — what the limiter reads off the socket in production.
 *
 * This file sets JWT_SECRET / INTERNAL_SERVICE_KEY / REDIS_URL and
 * NOTIFICATION_TRUSTED_PROXIES on purpose, so the turbo env-declaration lint
 * does not apply.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { randomBytes } from "node:crypto";
import http from "node:http";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import Redis from "ioredis";
import { sign } from "jsonwebtoken";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { AddressInfo } from "node:net";

// src/lib/redis connects at import: point it at the test Redis first.
const env = vi.hoisted(() => {
  const saved = {
    REDIS_URL: process.env.REDIS_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    INTERNAL_SERVICE_KEY: process.env.INTERNAL_SERVICE_KEY,
    NOTIFICATION_TRUSTED_PROXIES: process.env.NOTIFICATION_TRUSTED_PROXIES,
  };
  const redisUrl =
    process.env.NOTIFY_TEST_REDIS_URL ?? "redis://127.0.0.1:6379/5";
  process.env.REDIS_URL = redisUrl;
  process.env.JWT_SECRET = "notification-rate-limit-suite-jwt-secret";
  process.env.INTERNAL_SERVICE_KEY = "notification-rate-limit-suite-key-0001";
  delete process.env.NOTIFICATION_TRUSTED_PROXIES;
  return { saved, redisUrl };
});

const { auth, serviceAuth } = await import("./auth");
const { errorHandler } = await import("./error-handler");
const { closeConnections, redis: serviceRedis } = await import("../lib/redis");
const { TRUSTED_PROXIES_ENV, getClientIP, rateLimit } =
  await import("./rate-limit");

const LIMIT = 5;
const PREFIX = `ratelimit:rl-suite-${randomBytes(4).toString("hex")}`;
const SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY ?? "";

const app = new Hono();
app.onError(errorHandler);
app.use(
  "/limited/*",
  rateLimit({ keyPrefix: PREFIX, limit: LIMIT, windowSeconds: 60 }),
);
app.get("/limited/me", auth, (c) => c.json({ userId: c.get("userId") }));
app.post("/limited/internal", serviceAuth, (c) => c.json({ ok: true }));
app.get("/limited/client", (c) => c.json({ client: getClientIP(c) ?? null }));

let server: ReturnType<typeof serve>;
let port = 0;
let redis: Redis;

interface Reply {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

async function send(options: {
  readonly from: string;
  readonly path: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
}): Promise<Reply> {
  const reply = await new Promise<Reply>((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        localAddress: options.from,
        method: options.method ?? "GET",
        path: options.path,
        headers: options.headers,
        agent: false,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body,
          });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
  return reply;
}

function bearer(sub: string): string {
  return `Bearer ${sign({ sub, role: "rider", type: "access" }, process.env.JWT_SECRET ?? "")}`;
}

function clientOf(reply: Reply): string | null {
  return (JSON.parse(reply.body) as { client: string | null }).client;
}

async function clearBuckets(): Promise<void> {
  const keys = await redis.keys(`${PREFIX}:*`);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

async function untilReady(): Promise<void> {
  for (
    let attempt = 0;
    attempt < 200 && serviceRedis.status !== "ready";
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(serviceRedis.status).toBe("ready");
}

beforeAll(async () => {
  redis = new Redis(env.redisUrl);
  server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const started = serve(
      { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
      () => resolve(started),
    );
  });
  port = (server.address() as AddressInfo).port;
  await untilReady();
});

beforeEach(async () => {
  delete process.env[TRUSTED_PROXIES_ENV];
  await clearBuckets();
});

afterAll(async () => {
  await clearBuckets();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  redis.disconnect();
  await closeConnections();
  for (const [name, value] of Object.entries(env.saved)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe("the notification limiter keys a verified caller", () => {
  it("limits a flooding user without touching another user or a service on the same address", async () => {
    const flooder = bearer("usr_flooder");
    for (let i = 0; i < LIMIT; i += 1) {
      const reply = await send({
        from: "127.0.0.21",
        path: "/limited/me",
        headers: {
          authorization: flooder,
          "x-forwarded-for": `198.51.100.${i}`,
        },
      });
      expect(reply.status, `call ${i + 1}`).toBe(200);
      expect(reply.headers["x-ratelimit-limit"]).toBe(String(LIMIT));
    }
    const limited = await send({
      from: "127.0.0.21",
      path: "/limited/me",
      headers: { authorization: flooder, "x-forwarded-for": "198.51.100.99" },
    });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    // Another address does not escape it: the bucket is the user.
    expect(
      (
        await send({
          from: "127.0.0.22",
          path: "/limited/me",
          headers: { authorization: flooder },
        })
      ).status,
    ).toBe(429);

    const neighbour = await send({
      from: "127.0.0.21",
      path: "/limited/me",
      headers: { authorization: bearer("usr_neighbour") },
    });
    expect(neighbour.status).toBe(200);
    expect(JSON.parse(neighbour.body)).toEqual({ userId: "usr_neighbour" });

    // A service holding the internal key is never throttled here.
    for (let i = 0; i < LIMIT * 3; i += 1) {
      const service = await send({
        from: "127.0.0.21",
        method: "POST",
        path: "/limited/internal",
        headers: {
          "x-service-key": SERVICE_KEY,
          "x-service-name": "ride-service",
        },
      });
      expect(service.status, `service call ${i + 1}`).toBe(200);
      expect(service.headers["x-ratelimit-limit"]).toBeUndefined();
    }
  });

  it("counts a forged service key or token against its sender, and the guard still refuses it", async () => {
    for (let i = 0; i < LIMIT; i += 1) {
      const forged = await send({
        from: "127.0.0.23",
        method: "POST",
        path: "/limited/internal",
        headers: {
          "x-service-key": `forged-${i}`,
          "x-service-name": "ride-service",
        },
      });
      expect(forged.status, `forged call ${i + 1}`).toBe(401);
    }
    const badToken = await send({
      from: "127.0.0.23",
      path: "/limited/me",
      headers: { authorization: "Bearer not.a.token" },
    });
    expect(badToken.status).toBe(429);

    // The service's own calls, from anywhere, are untouched.
    const real = await send({
      from: "127.0.0.23",
      method: "POST",
      path: "/limited/internal",
      headers: {
        "x-service-key": SERVICE_KEY,
        "x-service-name": "ride-service",
      },
    });
    expect(real.status).toBe(200);
  });
});

describe("everyone else is keyed by the address the service resolved", () => {
  it("counts a spoofed X-Forwarded-For from an untrusted peer as the peer: no fresh buckets", async () => {
    for (let i = 0; i < LIMIT; i += 1) {
      const reply = await send({
        from: "127.0.0.31",
        path: "/limited/client",
        headers: {
          "x-forwarded-for": `198.51.100.${i}, 203.0.113.${i}`,
          "x-real-ip": `192.0.2.${i}`,
          "cf-connecting-ip": `192.0.2.${100 + i}`,
        },
      });
      expect(reply.status, `call ${i + 1}`).toBe(200);
      expect(clientOf(reply)).toBe("127.0.0.31");
    }
    const limited = await send({
      from: "127.0.0.31",
      path: "/limited/client",
      headers: { "x-forwarded-for": "198.51.100.200" },
    });
    expect(limited.status).toBe(429);
    const other = await send({ from: "127.0.0.32", path: "/limited/client" });
    expect(other.status).toBe(200);
  });

  it("with the proxy trusted, keys the client it forwarded and ignores what the client prepended", async () => {
    process.env[TRUSTED_PROXIES_ENV] = "127.0.0.40, 10.0.0.0/8";
    for (let i = 0; i < LIMIT; i += 1) {
      const reply = await send({
        from: "127.0.0.40",
        path: "/limited/client",
        headers: { "x-forwarded-for": `6.6.6.${i}, 203.0.113.7, 10.1.2.3` },
      });
      expect(reply.status, `call ${i + 1}`).toBe(200);
      expect(clientOf(reply)).toBe("203.0.113.7");
    }
    const limited = await send({
      from: "127.0.0.40",
      path: "/limited/client",
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    expect(limited.status).toBe(429);

    const neighbour = await send({
      from: "127.0.0.40",
      path: "/limited/client",
      headers: { "x-forwarded-for": "203.0.113.8" },
    });
    expect(clientOf(neighbour)).toBe("203.0.113.8");

    const cases: [string, Record<string, string>, string][] = [
      ["127.0.0.40", { "x-real-ip": "203.0.113.11" }, "203.0.113.11"],
      [
        "127.0.0.40",
        { "x-forwarded-for": "203.0.113.12, garbage" },
        "127.0.0.40",
      ],
      ["127.0.0.41", { "x-forwarded-for": "203.0.113.13" }, "127.0.0.41"],
    ];
    for (const [from, headers, want] of cases) {
      expect(
        clientOf(await send({ from, path: "/limited/client", headers })),
      ).toBe(want);
    }
  });

  it("counts an IPv6 client per /64", async () => {
    process.env[TRUSTED_PROXIES_ENV] = "127.0.0.40";
    for (let i = 1; i <= LIMIT; i += 1) {
      const reply = await send({
        from: "127.0.0.40",
        path: "/limited/client",
        headers: { "x-forwarded-for": `2001:db8:1:2:${i.toString(16)}::1` },
      });
      expect(reply.status).toBe(200);
    }
    const sameBlock = await send({
      from: "127.0.0.40",
      path: "/limited/client",
      headers: { "x-forwarded-for": "2001:db8:1:2:ffff::9" },
    });
    expect(sameBlock.status).toBe(429);
    const otherBlock = await send({
      from: "127.0.0.40",
      path: "/limited/client",
      headers: { "x-forwarded-for": "2001:db8:1:3::1" },
    });
    expect(otherBlock.status).toBe(200);
  });
});

describe("there is no shared fallback bucket", () => {
  it("never counts a request it cannot attribute, and never writes an 'unknown' key", async () => {
    // In-process dispatch: no peer address, no identity, no service key.
    for (let i = 0; i < LIMIT * 3; i += 1) {
      const response = await app.fetch(
        new Request("http://notification.test/limited/client", {
          headers: { "x-forwarded-for": "203.0.113.50" },
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ client: null });
    }
    // A verified user is still counted without any address.
    const token = bearer("usr_in_process");
    const counted = await app.fetch(
      new Request("http://notification.test/limited/me", {
        headers: { authorization: token },
      }),
    );
    expect(counted.headers.get("x-ratelimit-remaining")).toBe(
      String(LIMIT - 1),
    );

    await send({ from: "127.0.0.35", path: "/limited/client" });
    const keys = (await redis.keys(`${PREFIX}:*`)).sort();
    expect(keys).toEqual([
      `${PREFIX}:ip:127.0.0.35`,
      `${PREFIX}:user:usr_in_process`,
    ]);
    expect(await redis.keys(`${PREFIX}:*unknown*`)).toEqual([]);
  });
});

describe("when Redis is unavailable", () => {
  it("fails open, and authentication still holds", async () => {
    serviceRedis.disconnect();
    try {
      const rider = bearer("usr_outage");
      for (let i = 0; i < LIMIT * 3; i += 1) {
        const reply = await send({
          from: "127.0.0.71",
          path: "/limited/me",
          headers: { authorization: rider },
        });
        expect(reply.status, `call ${i + 1}`).toBe(200);
        expect(reply.headers["x-ratelimit-limit"]).toBeUndefined();
      }
      expect(
        (await send({ from: "127.0.0.71", path: "/limited/me" })).status,
      ).toBe(401);
      expect(
        (
          await send({
            from: "127.0.0.71",
            path: "/limited/me",
            headers: { authorization: "Bearer not.a.token" },
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await send({
            from: "127.0.0.71",
            method: "POST",
            path: "/limited/internal",
            headers: {
              "x-service-key": "forged",
              "x-service-name": "ride-service",
            },
          })
        ).status,
      ).toBe(401);
    } finally {
      await serviceRedis.connect();
      await untilReady();
    }
  });
});
