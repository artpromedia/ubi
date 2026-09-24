/**
 * Redis unavailable: the payment limiter fails OPEN, the house convention
 * (ride-service's AllowRate, ask-service's withinRateLimit) — and
 * authentication does not (src/middleware/rate-limit.ts, "REDIS
 * UNAVAILABLE").
 *
 * The app's Redis client is pointed at a port this suite controls, so both
 * outages are real network conditions, not a stubbed client:
 *
 *  - nothing listening (connection refused): the client is never ready, and
 *    the limiter lets requests through without queueing a command;
 *  - a peer that completes ioredis's handshake (SELECT, CLIENT SETINFO, the
 *    INFO ready check) and then never answers — a hung or blackholed Redis.
 *    The client reports ready, the limiter's command hangs, and the request
 *    goes on once REDIS_CHECK_BUDGET_MS (250ms) has passed.
 *
 * In both, requests with no credential, a forged service key or a forged
 * identity are still refused by the routers, in production mode too.
 */
import net, { type AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { money } from "@ubi/contracts";

import {
  bootApp,
  call,
  fundedDriver,
  INTERNAL_KEY,
  signedIdentity,
  type BootedApp,
  type Driver,
  type Reply,
} from "./harness";
import { seedCity, testDb, uid, type SeededCity } from "../ledger/helpers";

const LIMIT = 30;
const db = testDb();
let redisPort: number;
let booted: BootedApp;
let city: SeededCity;
let party: Driver;
let hung: { server: net.Server; sockets: Set<net.Socket> } | undefined;

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** One RESP command off the front of `buffer`, or undefined if incomplete. */
function nextCommand(
  buffer: Buffer,
): { readonly args: string[]; readonly consumed: number } | undefined {
  let offset = 0;
  const line = (): string | undefined => {
    const end = buffer.indexOf("\r\n", offset);
    if (end === -1) {
      return undefined;
    }
    const text = buffer.toString("utf8", offset, end);
    offset = end + 2;
    return text;
  };
  const header = line();
  if (header === undefined) {
    return undefined;
  }
  if (!header.startsWith("*")) {
    return { args: header.split(" "), consumed: offset };
  }
  const args: string[] = [];
  for (let index = 0; index < Number(header.slice(1)); index += 1) {
    const size = line();
    if (size === undefined) {
      return undefined;
    }
    const length = Number(size.slice(1));
    if (buffer.length < offset + length + 2) {
      return undefined;
    }
    args.push(buffer.toString("utf8", offset, offset + length));
    offset += length + 2;
  }
  return { args, consumed: offset };
}

/** A Redis that shakes hands and then never answers another command. */
async function startHungRedis(port: number): Promise<void> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    let buffered = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      for (;;) {
        const command = nextCommand(buffered);
        if (command === undefined) {
          return;
        }
        buffered = buffered.subarray(command.consumed);
        const name = command.args[0]?.toUpperCase();
        if (name === "INFO") {
          const info = "# Server\r\nredis_version:7.2.0\r\nloading:0\r\n";
          socket.write(`$${Buffer.byteLength(info)}\r\n${info}\r\n`);
        } else if (name === "SELECT" || name === "CLIENT") {
          socket.write("+OK\r\n");
        }
        // Everything else — the limiter's MULTI/ZADD/EXEC — hangs forever.
      }
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  hung = { server, sockets };
}

async function until(
  condition: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("condition not met in time");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

beforeAll(async () => {
  redisPort = await freePort();
  booted = await bootApp({ redisUrl: `redis://127.0.0.1:${redisPort}/7` });
  city = await seedCity(db);
  party = await fundedDriver(city, 1_000_00);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await db.mpCommissionHold.deleteMany({ where: { walletId: party.walletId } });
  await booted.close();
  if (hung !== undefined) {
    for (const socket of hung.sockets) {
      socket.destroy();
    }
    const { server } = hung;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function overview(headers: Record<string, string>): Promise<Reply> {
  return call(booted.port, {
    path: `/v1/wallet/mp/overview?cityId=${city.cityId}`,
    from: "127.0.0.1",
    headers,
  });
}

async function reserve(key: string): Promise<Reply> {
  return call(booted.port, {
    method: "POST",
    path: "/v1/wallet/mp/holds/reserve",
    from: "127.0.0.1",
    headers: { "X-Service-Key": key, "Idempotency-Key": uid("idem") },
    body: {
      driverId: party.userId,
      bidId: uid("bid"),
      requestId: uid("req"),
      amountMinor: money(1_00, city.currency),
      baseMinor: money(10_00, city.currency),
      policyVersion: 1,
      cityId: city.cityId,
    },
  });
}

/** Authentication is enforced exactly as it is with the limiter healthy. */
async function expectAuthenticationEnforced(): Promise<void> {
  for (let index = 0; index < LIMIT + 5; index += 1) {
    const anonymous = await overview({});
    expect(anonymous.status).toBe(401);
  }
  const forgedIdentity = await overview({
    "x-ubi-identity": await signedIdentity(
      party.userId,
      "not-the-gateway-secret-but-long-enough-000000",
    ),
  });
  expect(forgedIdentity.status).toBe(401);
  const forgedKey = await reserve("forged-service-key");
  expect(forgedKey.status, forgedKey.text).toBe(403);
  const noKey = await call(booted.port, {
    method: "POST",
    path: "/v1/finance/travel/authorize",
    from: "127.0.0.1",
    body: {},
  });
  expect(noKey.status).toBe(403);

  vi.stubEnv("NODE_ENV", "production");
  try {
    // Production trusts only the signed context: a bare mirror is refused.
    const mirror = await overview({
      "X-User-ID": party.userId,
      "X-User-Role": "driver",
    });
    expect(mirror.status).toBe(401);
    const signed = await overview({
      "x-ubi-identity": await signedIdentity(party.userId),
    });
    expect(signed.status, signed.text).toBe(200);
  } finally {
    vi.unstubAllEnvs();
  }

  const genuine = await reserve(INTERNAL_KEY);
  expect(genuine.status, genuine.text).toBe(201);
}

describe("with Redis refusing connections", () => {
  it("fails open: an identity far past its limit is served, uncounted and without X-RateLimit headers, at once", async () => {
    expect(booted.redis.status).not.toBe("ready");
    const identity = { "x-ubi-identity": await signedIdentity(party.userId) };
    const replies: Reply[] = [];
    for (let index = 0; index < LIMIT + 15; index += 1) {
      replies.push(await overview(identity));
    }
    for (const reply of replies) {
      expect(reply.status, reply.text).toBe(200);
      expect(reply.headers["x-ratelimit-limit"]).toBeUndefined();
    }
    // No request waited on the outage (the client's own retries run to
    // seconds): the limiter never queued a command behind it.
    expect(Math.max(...replies.map((reply) => reply.elapsedMs))).toBeLessThan(
      1_000,
    );
  });

  it("never fails authentication open", async () => {
    await expectAuthenticationEnforced();
  });
});

describe("with Redis accepting connections but never answering", () => {
  beforeAll(async () => {
    await startHungRedis(redisPort);
    // ioredis reconnects on its own backoff (capped at 2s) and passes the
    // ready check against the hung peer.
    await until(() => booted.redis.status === "ready", 15_000);
  });

  it("fails open once the 250ms budget passes, instead of holding the request on the hung command", async () => {
    const identity = { "x-ubi-identity": await signedIdentity(party.userId) };
    for (let index = 0; index < 5; index += 1) {
      const reply = await overview(identity);
      expect(reply.status, reply.text).toBe(200);
      expect(reply.headers["x-ratelimit-limit"]).toBeUndefined();
      // It did wait on Redis (the budget path, not the not-ready shortcut)…
      expect(reply.elapsedMs).toBeGreaterThanOrEqual(240);
      // …but only for the budget.
      expect(reply.elapsedMs).toBeLessThan(2_000);
    }
    expect(booted.redis.status).toBe("ready");
  });

  it("never fails authentication open", async () => {
    await expectAuthenticationEnforced();
  });
});
