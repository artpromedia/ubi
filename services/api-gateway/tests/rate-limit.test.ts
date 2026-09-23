import "./env";

/**
 * The gateway limiter counts WHO the caller is — the verified caller, or on a
 * public route the client address the gateway itself resolved — never what a
 * client wrote in X-Forwarded-For, and never one shared bucket (round 8, P0:
 * src/middleware/rate-limit.ts, src/middleware/client-address.ts).
 *
 * The defect this pins: the limiter ran BEFORE authMiddleware and keyed every
 * request on the leftmost X-Forwarded-For entry (else X-Real-IP, else the
 * literal "unknown"). A client minted a fresh bucket per request by rotating
 * the header, the trip link keyed the same way, and the proxy passed the
 * client's X-Forwarded-For / X-Real-IP to every downstream service as fact.
 *
 * Every request here goes through the REAL app (createApp) served by
 * @hono/node-server on a real TCP port, into real Redis (GATEWAY_TEST_REDIS_URL,
 * default logical db 6), and on to a recording upstream. Distinct client
 * addresses are real, not headers: Linux routes all of 127.0.0.0/8 to
 * loopback, so a request bound to `localAddress: 127.0.0.21` reaches the
 * gateway from peer 127.0.0.21 — exactly what the limiter reads off the
 * socket in production. Buckets are cleared before each test.
 */
import http from "node:http";
import net, { type AddressInfo } from "node:net";

import { serve } from "@hono/node-server";
import Redis from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { setIdentityStateStore } from "../src/lib/redis";
import { TRUSTED_PROXIES_ENV } from "../src/middleware/client-address";
import { resetRateLimiter } from "../src/middleware/rate-limit";
import {
  TRIP_ACCESS_RATE_LIMIT,
  resetTripAccessLimiter,
} from "../src/routes/trip-access";
import {
  clientToken,
  openRiskStore,
  startUpstream,
  type Upstream,
} from "./helpers";

const REDIS_URL =
  process.env.GATEWAY_TEST_REDIS_URL ?? "redis://127.0.0.1:6379/6";
const SERVICE_KEY = "ubi_sk_ride_ratelimitsuitekey0001";
const ANONYMOUS_LIMIT = 100;
const RIDER_LIMIT = 100;
const TRIP_TOKEN = "uta_RateLimitSuiteToken_0123456789";

const app = createApp("test");
let server: ReturnType<typeof serve>;
let port = 0;
let upstream: Upstream;
let redis: Redis;
const saved = new Map<string, string | undefined>();

interface Reply {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

/** One request over a fresh TCP connection from the given local address. */
function send(options: {
  readonly from: string;
  readonly path: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}): Promise<Reply> {
  return new Promise((resolve, reject) => {
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
    if (options.body !== undefined) {
      request.write(options.body);
    }
    request.end();
  });
}

function errorCode(reply: Reply): string | undefined {
  try {
    return (JSON.parse(reply.body) as { error?: { code?: string } }).error
      ?.code;
  } catch {
    return undefined;
  }
}

async function bearer(sub: string, role = "rider"): Promise<string> {
  return `Bearer ${await clientToken({ sub, role })}`;
}

async function clearBuckets(): Promise<void> {
  const keys = await redis.keys("ubi:ratelimit:*");
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

/**
 * The limiter connects lazily and fails open until its client is ready; wait
 * until a throwaway caller is counted, so every test starts counted.
 */
async function untilCounted(): Promise<void> {
  const authorization = await bearer("usr_warmup");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const reply = await send({
      from: "127.0.0.2",
      path: "/v1/users/me",
      headers: { authorization },
    });
    if (reply.headers["x-ratelimit-limit"] !== undefined) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("the rate limiter never connected to Redis");
}

/**
 * The trip link's limiter answers from its in-memory insurance limiter until
 * its own Redis client connects; wait until Redis holds a trip-link bucket.
 */
async function untilTripLinkCounted(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await send({
      from: "127.0.0.3",
      path: "/v1/mp/trip-access",
      headers: { "x-trip-access-token": TRIP_TOKEN },
    });
    if ((await redis.exists("ubi:ratelimit:trip-access:ip:127.0.0.3")) === 1) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("the trip-link limiter never connected to Redis");
}

/**
 * One RESP command (an array of bulk strings, as ioredis writes every
 * command) from the front of `buffer`, or undefined while it is incomplete.
 */
function parseRespCommand(
  buffer: Buffer,
): { readonly args: string[]; readonly consumed: number } | undefined {
  const lineEnd = (from: number): number => buffer.indexOf("\r\n", from);
  let end = lineEnd(0);
  if (end === -1 || buffer[0] !== 0x2a /* '*' */) {
    return undefined;
  }
  const count = Number(buffer.subarray(1, end).toString());
  let offset = end + 2;
  const args: string[] = [];
  for (let index = 0; index < count; index += 1) {
    end = lineEnd(offset);
    if (end === -1) {
      return undefined;
    }
    const length = Number(buffer.subarray(offset + 1, end).toString());
    const start = end + 2;
    if (buffer.length < start + length + 2) {
      return undefined;
    }
    args.push(buffer.subarray(start, start + length).toString());
    offset = start + length + 2;
  }
  return { args, consumed: offset };
}

/** An ephemeral port nothing listens on. */
async function closedPort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => {
    probe.listen(0, "127.0.0.1", resolve);
  });
  const { port: free } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => {
    probe.close(() => resolve());
  });
  return free;
}

beforeAll(async () => {
  for (const name of [
    "REDIS_URL",
    "VALID_SERVICE_API_KEYS",
    TRUSTED_PROXIES_ENV,
  ]) {
    saved.set(name, process.env[name]);
  }
  process.env.REDIS_URL = REDIS_URL;
  process.env.VALID_SERVICE_API_KEYS = SERVICE_KEY;
  delete process.env[TRUSTED_PROXIES_ENV];
  resetRateLimiter();
  resetTripAccessLimiter();

  upstream = await startUpstream();
  for (const name of [
    "USER_SERVICE_URL",
    "RIDE_SERVICE_URL",
    "PAYMENT_SERVICE_URL",
    "NOTIFICATION_SERVICE_URL",
    "ASK_SERVICE_URL",
    "TRAVEL_SERVICE_URL",
  ]) {
    process.env[name] = upstream.url;
  }
  setIdentityStateStore(openRiskStore);

  redis = new Redis(REDIS_URL);
  server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const started = serve(
      { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
      () => resolve(started),
    );
  });
  port = (server.address() as AddressInfo).port;
  await untilCounted();
  await untilTripLinkCounted();
});

beforeEach(async () => {
  delete process.env[TRUSTED_PROXIES_ENV];
  setIdentityStateStore(openRiskStore);
  await clearBuckets();
  upstream.received.length = 0;
});

afterAll(async () => {
  await clearBuckets();
  resetRateLimiter();
  resetTripAccessLimiter();
  setIdentityStateStore(undefined);
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  await upstream.close();
  redis.disconnect();
  for (const [name, value] of saved) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe("the gateway limiter keys the verified caller", () => {
  it("limits a flooding user without touching another user or a service caller on the same address", async () => {
    const flooder = await bearer("usr_flooder");
    for (let i = 0; i < RIDER_LIMIT; i += 1) {
      const reply = await send({
        from: "127.0.0.21",
        path: "/v1/users/me",
        // Rotating the forwarded address buys nothing: the bucket is the user.
        headers: {
          authorization: flooder,
          "x-forwarded-for": `198.51.100.${i % 250}`,
        },
      });
      expect(reply.status, `call ${i + 1}`).toBe(200);
      expect(reply.headers["x-ratelimit-limit"]).toBe(String(RIDER_LIMIT));
    }
    expect(upstream.received).toHaveLength(RIDER_LIMIT);

    const limited = await send({
      from: "127.0.0.21",
      path: "/v1/users/me",
      headers: { authorization: flooder, "x-forwarded-for": "192.0.2.77" },
    });
    expect(limited.status).toBe(429);
    expect(errorCode(limited)).toBe("RATE_LIMIT_EXCEEDED");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(upstream.received).toHaveLength(RIDER_LIMIT);

    // Moving to another address does not escape it either.
    const elsewhere = await send({
      from: "127.0.0.22",
      path: "/v1/users/me",
      headers: { authorization: flooder },
    });
    expect(elsewhere.status).toBe(429);

    // Another rider on the flooder's own address is untouched…
    const neighbour = await send({
      from: "127.0.0.21",
      path: "/v1/users/me",
      headers: { authorization: await bearer("usr_neighbour") },
    });
    expect(neighbour.status).toBe(200);
    expect(neighbour.headers["x-ratelimit-remaining"]).toBe(
      String(RIDER_LIMIT - 1),
    );

    // …and so is a service caller.
    const service = await send({
      from: "127.0.0.21",
      path: "/v1/users/me",
      headers: { authorization: `Bearer ${SERVICE_KEY}` },
    });
    expect(service.status).toBe(200);
    expect(service.headers["x-ratelimit-limit"]).toBe("10000");
  });

  it("gives each caller type its own budget", async () => {
    const driver = await send({
      from: "127.0.0.23",
      path: "/v1/users/me",
      headers: { authorization: await bearer("usr_driver_budget", "driver") },
    });
    expect(driver.status).toBe(200);
    expect(driver.headers["x-ratelimit-limit"]).toBe("150");

    const admin = await send({
      from: "127.0.0.23",
      path: "/v1/users/me",
      headers: { authorization: await bearer("usr_admin_budget", "admin") },
    });
    expect(admin.headers["x-ratelimit-limit"]).toBe("500");

    const anonymous = await send({
      from: "127.0.0.23",
      method: "POST",
      path: "/v1/auth/login",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(anonymous.status).toBe(200);
    expect(anonymous.headers["x-ratelimit-limit"]).toBe(
      String(ANONYMOUS_LIMIT),
    );
  });
});

describe("unauthenticated callers are keyed by the address the gateway resolved", () => {
  it("counts a spoofed X-Forwarded-For from an untrusted peer as the peer: no fresh buckets", async () => {
    for (let i = 0; i < ANONYMOUS_LIMIT; i += 1) {
      const reply = await send({
        from: "127.0.0.31",
        method: "POST",
        path: "/v1/auth/login",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": `198.51.100.${i % 250}, 203.0.113.${i % 250}`,
          "x-real-ip": `192.0.2.${i % 250}`,
          "true-client-ip": "192.0.2.254",
        },
        body: "{}",
      });
      expect(reply.status, `call ${i + 1}`).toBe(200);
    }
    const limited = await send({
      from: "127.0.0.31",
      method: "POST",
      path: "/v1/auth/login",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "198.51.100.251",
      },
      body: "{}",
    });
    expect(limited.status).toBe(429);
    expect(errorCode(limited)).toBe("RATE_LIMIT_EXCEEDED");

    // Downstream sees the address the gateway saw, never the client's claims.
    expect(upstream.received).toHaveLength(ANONYMOUS_LIMIT);
    for (const arrived of upstream.received) {
      expect(arrived.headers["x-forwarded-for"]).toBe("127.0.0.31");
      expect(arrived.headers["x-real-ip"]).toBe("127.0.0.31");
      expect(arrived.headers["true-client-ip"]).toBeUndefined();
    }

    // Another client is untouched.
    const other = await send({
      from: "127.0.0.32",
      method: "POST",
      path: "/v1/auth/login",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(other.status).toBe(200);
  });

  it("with the ingress trusted, keys the client it forwarded and ignores what the client prepended", async () => {
    process.env[TRUSTED_PROXIES_ENV] = "127.0.0.40";
    for (let i = 0; i < ANONYMOUS_LIMIT; i += 1) {
      const reply = await send({
        from: "127.0.0.40",
        method: "POST",
        path: "/v1/auth/otp",
        headers: {
          "content-type": "application/json",
          // What Caddy sends: whatever the client wrote, then the peer it saw.
          "x-forwarded-for": `10.9.${i % 250}.1, 203.0.113.7`,
        },
        body: "{}",
      });
      expect(reply.status, `call ${i + 1}`).toBe(200);
    }
    for (const arrived of upstream.received) {
      expect(arrived.headers["x-forwarded-for"]).toBe(
        "203.0.113.7, 127.0.0.40",
      );
      expect(arrived.headers["x-real-ip"]).toBe("203.0.113.7");
    }
    const limited = await send({
      from: "127.0.0.40",
      method: "POST",
      path: "/v1/auth/otp",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "10.200.0.1, 203.0.113.7",
      },
      body: "{}",
    });
    expect(limited.status).toBe(429);

    // A second client behind the same ingress has its own budget…
    const neighbour = await send({
      from: "127.0.0.40",
      method: "POST",
      path: "/v1/auth/otp",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.8",
      },
      body: "{}",
    });
    expect(neighbour.status).toBe(200);

    // …and a peer that is not the ingress is its own client, whatever it says.
    upstream.received.length = 0;
    const direct = await send({
      from: "127.0.0.41",
      method: "POST",
      path: "/v1/auth/otp",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.7",
      },
      body: "{}",
    });
    expect(direct.status).toBe(200);
    expect(upstream.received[0]?.headers["x-forwarded-for"]).toBe("127.0.0.41");
  });

  it("walks past every trusted hop, reads X-Real-IP only when the chain names no client, and counts a malformed chain as the proxy", async () => {
    process.env[TRUSTED_PROXIES_ENV] = "127.0.0.40, 10.0.0.0/8";
    const login = (from: string, headers: Record<string, string>) =>
      send({
        from,
        method: "POST",
        path: "/v1/auth/login",
        headers: { "content-type": "application/json", ...headers },
        body: "{}",
      });

    await login("127.0.0.40", {
      "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.1.2.3",
    });
    expect(upstream.received.at(-1)?.headers["x-forwarded-for"]).toBe(
      "203.0.113.9, 10.1.2.3, 127.0.0.40",
    );
    expect(upstream.received.at(-1)?.headers["x-real-ip"]).toBe("203.0.113.9");

    await login("127.0.0.40", { "x-real-ip": "203.0.113.11" });
    expect(upstream.received.at(-1)?.headers["x-forwarded-for"]).toBe(
      "203.0.113.11, 127.0.0.40",
    );

    await login("127.0.0.40", {
      "x-forwarded-for": "10.3.3.3",
      "x-real-ip": "203.0.113.12",
    });
    expect(upstream.received.at(-1)?.headers["x-real-ip"]).toBe("203.0.113.12");

    // Garbage before a client is reached: nobody to attribute, so the proxy
    // itself is counted — never a fresh bucket per garbage value.
    await login("127.0.0.40", {
      "x-forwarded-for": "203.0.113.10, not-an-address",
    });
    expect(upstream.received.at(-1)?.headers["x-forwarded-for"]).toBe(
      "127.0.0.40",
    );
    expect(upstream.received.at(-1)?.headers["x-real-ip"]).toBe("127.0.0.40");
  });

  it("counts an IPv6 client per /64, so rotating through its block mints nothing", async () => {
    process.env[TRUSTED_PROXIES_ENV] = "127.0.0.40";
    for (let i = 0; i < ANONYMOUS_LIMIT; i += 1) {
      const reply = await send({
        from: "127.0.0.40",
        method: "POST",
        path: "/v1/auth/login",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": `2001:db8:1:2:${(i + 1).toString(16)}::1`,
        },
        body: "{}",
      });
      expect(reply.status, `call ${i + 1}`).toBe(200);
    }
    const sameBlock = await send({
      from: "127.0.0.40",
      method: "POST",
      path: "/v1/auth/login",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "2001:DB8:1:2:ffff:ffff:ffff:ffff",
      },
      body: "{}",
    });
    expect(sameBlock.status).toBe(429);

    const otherBlock = await send({
      from: "127.0.0.40",
      method: "POST",
      path: "/v1/auth/login",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "2001:db8:1:3::1",
      },
      body: "{}",
    });
    expect(otherBlock.status).toBe(200);
  });
});

describe("there is no shared fallback bucket", () => {
  it("refuses an unauthenticated request whose peer cannot be read, and still counts an authenticated one as its caller", async () => {
    // A connection whose peer cannot be read — what a torn-down socket
    // presents to getConnInfo.
    const torn = { incoming: { socket: {} }, outgoing: {} };

    const anonymous = await app.fetch(
      new Request("http://gateway.test/v1/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.50",
        },
        body: "{}",
      }),
      torn,
    );
    expect(anonymous.status).toBe(400);
    expect(
      ((await anonymous.json()) as { error: { code: string } }).error.code,
    ).toBe("CLIENT_ADDRESS_UNAVAILABLE");
    expect(upstream.received).toHaveLength(0);

    const signedIn = await app.fetch(
      new Request("http://gateway.test/v1/users/me", {
        headers: { authorization: await bearer("usr_torn_socket") },
      }),
      torn,
    );
    expect(signedIn.status).toBe(200);
    expect(signedIn.headers.get("x-ratelimit-remaining")).toBe(
      String(RIDER_LIMIT - 1),
    );

    // The trip link refuses it too.
    const tripLink = await app.fetch(
      new Request("http://gateway.test/v1/mp/trip-access", {
        headers: { "x-trip-access-token": TRIP_TOKEN },
      }),
      torn,
    );
    expect(tripLink.status).toBe(400);
    expect(upstream.received).toHaveLength(1);
  });

  it("writes no bucket that is not a caller or an address", async () => {
    await send({
      from: "127.0.0.35",
      method: "POST",
      path: "/v1/auth/login",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await send({
      from: "127.0.0.35",
      path: "/v1/users/me",
      headers: { authorization: await bearer("usr_bucket_names") },
    });
    const keys = (await redis.keys("ubi:ratelimit:*")).sort();
    expect(keys).toEqual([
      "ubi:ratelimit:anonymous:ip:127.0.0.35",
      "ubi:ratelimit:rider:user:usr_bucket_names",
    ]);
    expect(await redis.keys("*unknown*")).toEqual([]);
  });
});

describe("the passenger trip link keys the same resolved address", () => {
  it("counts a spoofed X-Forwarded-For as the peer, forwards only that address, and leaves other clients alone", async () => {
    for (let i = 0; i < TRIP_ACCESS_RATE_LIMIT.points; i += 1) {
      const reply = await send({
        from: "127.0.0.51",
        path: "/v1/mp/trip-access",
        headers: {
          "x-trip-access-token": TRIP_TOKEN,
          "x-forwarded-for": `198.51.100.${i}`,
        },
      });
      expect(reply.status, `call ${i + 1}`).toBe(200);
    }
    for (const arrived of upstream.received) {
      expect(arrived.headers["x-forwarded-for"]).toBe("127.0.0.51");
    }
    const limited = await send({
      from: "127.0.0.51",
      path: "/v1/mp/trip-access/pin",
      headers: {
        "x-trip-access-token": "uta_a_different_guess",
        "x-forwarded-for": "198.51.100.200",
      },
    });
    expect(limited.status).toBe(429);
    expect(errorCode(limited)).toBe("RATE_LIMIT_EXCEEDED");
    expect(upstream.received).toHaveLength(TRIP_ACCESS_RATE_LIMIT.points);

    const other = await send({
      from: "127.0.0.52",
      path: "/v1/mp/trip-access",
      headers: { "x-trip-access-token": TRIP_TOKEN },
    });
    expect(other.status).toBe(200);
  });

  it("behind the trusted ingress, keys and forwards the passenger's own address", async () => {
    process.env[TRUSTED_PROXIES_ENV] = "127.0.0.40";
    const reply = await send({
      from: "127.0.0.40",
      path: "/v1/mp/trip-access",
      headers: {
        "x-trip-access-token": TRIP_TOKEN,
        "x-forwarded-for": "6.6.6.6, 203.0.113.20",
      },
    });
    expect(reply.status).toBe(200);
    expect(upstream.received[0]?.headers["x-forwarded-for"]).toBe(
      "203.0.113.20",
    );
    expect(await redis.keys("ubi:ratelimit:trip-access:*")).toEqual([
      "ubi:ratelimit:trip-access:ip:203.0.113.20",
    ]);
  });
});

describe("when Redis is unavailable", () => {
  async function withRedisAt(url: string, run: () => Promise<void>) {
    process.env.REDIS_URL = url;
    resetRateLimiter();
    try {
      await run();
    } finally {
      process.env.REDIS_URL = REDIS_URL;
      resetRateLimiter();
      await untilCounted();
    }
  }

  async function failsOpenAndStillAuthenticates(from: string): Promise<void> {
    const rider = await bearer(`usr_outage_${from}`);
    for (let i = 0; i < RIDER_LIMIT + 20; i += 1) {
      const reply = await send({
        from,
        path: "/v1/users/me",
        headers: { authorization: rider },
      });
      expect(reply.status, `call ${i + 1}`).toBe(200);
      expect(reply.headers["x-ratelimit-limit"]).toBeUndefined();
    }
    const publicCall = await send({
      from,
      method: "POST",
      path: "/v1/auth/login",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(publicCall.status).toBe(200);

    upstream.received.length = 0;
    const noToken = await send({ from, path: "/v1/users/me" });
    expect(noToken.status).toBe(401);
    expect(errorCode(noToken)).toBe("UNAUTHORIZED");
    const forged = await send({
      from,
      path: "/v1/users/me",
      headers: { authorization: "Bearer not.a.token" },
    });
    expect(forged.status).toBe(401);
    expect(errorCode(forged)).toBe("INVALID_TOKEN");
    expect(upstream.received).toHaveLength(0);
  }

  it("fails open when nothing listens, and authentication still holds", async () => {
    const port = await closedPort();
    await withRedisAt(`redis://127.0.0.1:${port}/6`, () =>
      failsOpenAndStillAuthenticates("127.0.0.71"),
    );
  });

  it("fails open when Redis accepts connections but never answers", async () => {
    const sockets = new Set<net.Socket>();
    const blackhole = net.createServer((socket) => {
      sockets.add(socket);
    });
    await new Promise<void>((resolve) => {
      blackhole.listen(0, "127.0.0.1", resolve);
    });
    const { port: silent } = blackhole.address() as AddressInfo;
    try {
      await withRedisAt(`redis://127.0.0.1:${silent}/6`, async () => {
        const started = Date.now();
        await failsOpenAndStillAuthenticates("127.0.0.72");
        // Never waits behind the hung store for long.
        expect(Date.now() - started).toBeLessThan(10_000);
      });
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => {
        blackhole.close(() => resolve());
      });
    }
  });

  // The two tests above never get past the "not ready" check: the store
  // never completes its handshake. These two reach a READY store and send the
  // check, so the error and time-budget branches are what answer.

  it("fails open when a ready Redis answers the check with an error", async () => {
    // A key of the wrong type makes the limiter's INCRBY fail inside the real
    // Redis (WRONGTYPE): the store is up, the check itself errors.
    const sub = "usr_store_error";
    await redis.hset(`ubi:ratelimit:rider:user:${sub}`, "occupied", "1");
    const rider = await bearer(sub);
    for (let i = 0; i < RIDER_LIMIT + 5; i += 1) {
      const reply = await send({
        from: "127.0.0.73",
        path: "/v1/users/me",
        headers: { authorization: rider },
      });
      expect(reply.status, `call ${i + 1}`).toBe(200);
      expect(reply.headers["x-ratelimit-limit"]).toBeUndefined();
    }
    // Everyone else is still counted, and authentication still holds.
    const neighbour = await send({
      from: "127.0.0.73",
      path: "/v1/users/me",
      headers: { authorization: await bearer("usr_store_error_neighbour") },
    });
    expect(neighbour.status).toBe(200);
    expect(neighbour.headers["x-ratelimit-limit"]).toBe(String(RIDER_LIMIT));
    upstream.received.length = 0;
    const noToken = await send({ from: "127.0.0.73", path: "/v1/users/me" });
    expect(noToken.status).toBe(401);
    expect(upstream.received).toHaveLength(0);
  });

  it("fails open within its time budget when a ready Redis takes the check but never answers it", async () => {
    // Completes the ioredis handshake (SELECT, INFO, CLIENT SETINFO), then
    // swallows every limiter script call.
    const commands: string[] = [];
    const sockets = new Set<net.Socket>();
    const stalled = net.createServer((socket) => {
      sockets.add(socket);
      let pending = Buffer.alloc(0);
      socket.on("data", (chunk: Buffer) => {
        pending = Buffer.concat([pending, chunk]);
        for (
          let parsed = parseRespCommand(pending);
          parsed !== undefined;
          parsed = parseRespCommand(pending)
        ) {
          pending = pending.subarray(parsed.consumed);
          const name = (parsed.args[0] ?? "").toUpperCase();
          commands.push(name);
          if (name === "EVALSHA" || name === "EVAL") {
            continue;
          }
          if (name === "INFO") {
            const info = "# Server\r\nredis_version:7.2.0\r\nloading:0\r\n";
            socket.write(`$${Buffer.byteLength(info)}\r\n${info}\r\n`);
            continue;
          }
          socket.write("+OK\r\n");
        }
      });
    });
    await new Promise<void>((resolve) => {
      stalled.listen(0, "127.0.0.1", resolve);
    });
    const { port: stalledPort } = stalled.address() as AddressInfo;
    const checks = (): number =>
      commands.filter((name) => name === "EVALSHA" || name === "EVAL").length;
    try {
      await withRedisAt(`redis://127.0.0.1:${stalledPort}/6`, async () => {
        const rider = await bearer("usr_stalled_store");
        const call = () =>
          send({
            from: "127.0.0.74",
            path: "/v1/users/me",
            headers: { authorization: rider },
          });
        // The limiter connects lazily: call until a check reaches the store.
        for (let attempt = 0; attempt < 100 && checks() === 0; attempt += 1) {
          expect((await call()).status).toBe(200);
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(checks()).toBeGreaterThan(0);

        for (let i = 0; i < 3; i += 1) {
          const before = checks();
          const started = Date.now();
          const reply = await call();
          // It asked the store, got no answer, and went on uncounted.
          expect(checks()).toBe(before + 1);
          expect(reply.status, `call ${i + 1}`).toBe(200);
          expect(reply.headers["x-ratelimit-limit"]).toBeUndefined();
          expect(Date.now() - started).toBeLessThan(2_000);
        }

        upstream.received.length = 0;
        const forged = await send({
          from: "127.0.0.74",
          path: "/v1/users/me",
          headers: { authorization: "Bearer not.a.token" },
        });
        expect(forged.status).toBe(401);
        expect(upstream.received).toHaveLength(0);
      });
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => {
        stalled.close(() => resolve());
      });
    }
  });
});
