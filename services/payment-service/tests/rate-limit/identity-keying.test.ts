/**
 * The payment limiter counts an AUTHENTICATED identity, never a shared bucket
 * (round 7, P0 — src/middleware/rate-limit.ts).
 *
 * The defect this pins: `paymentRateLimit` ran before the routers
 * authenticate, so it never saw a userId; service callers send no forwarded
 * header, so every service money call platform-wide — the commission reserve
 * on each bid, the capture at award, releases, travel authorize/capture —
 * shared `ratelimit:payment:unknown` at 30 a minute, and bids, awards and
 * captures were refused 429 at trivial load.
 *
 * Every request here goes through the real app over real TCP (harness.ts),
 * into real Redis and the suite's own Postgres. Buckets are cleared before
 * each test so reruns inside the limiter window stay independent.
 *
 * This file sets PAYMENT_TRUSTED_PROXIES on purpose, so the turbo
 * env-declaration lint does not apply.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { money } from "@ubi/contracts";

import {
  bootApp,
  call,
  clearPaymentBuckets,
  fundedDriver,
  inWaves,
  INTERNAL_KEY,
  signedIdentity,
  type BootedApp,
  type Driver,
  type Reply,
} from "./harness";
import { seedCity, testDb, uid, type SeededCity } from "../ledger/helpers";

const LIMIT = 30;
const db = testDb();
let booted: BootedApp;
let city: SeededCity;
const createdWalletIds: string[] = [];
const createdOrderIds: string[] = [];

beforeAll(async () => {
  booted = await bootApp();
  // The limiter fails open until the client is ready; start counted.
  await booted.redis.ping();
  city = await seedCity(db, { flags: { flights_booking: true } });
});

beforeEach(async () => {
  delete process.env.PAYMENT_TRUSTED_PROXIES;
  await clearPaymentBuckets(booted.redis);
});

afterAll(async () => {
  delete process.env.PAYMENT_TRUSTED_PROXIES;
  await clearPaymentBuckets(booted.redis);
  await booted.redis.del("ratelimit:payment:unknown");
  await db.mpCommissionHold.deleteMany({
    where: { walletId: { in: createdWalletIds } },
  });
  const items = await db.travelPaymentItem.findMany({
    where: { orderId: { in: createdOrderIds } },
    select: { id: true },
  });
  await db.travelPaymentOp.deleteMany({
    where: { itemId: { in: items.map((item) => item.id) } },
  });
  await db.travelPaymentItem.deleteMany({
    where: { id: { in: items.map((item) => item.id) } },
  });
  await booted.close();
});

async function driver(amountMinor = 1_000_00): Promise<Driver> {
  const created = await fundedDriver(city, amountMinor);
  createdWalletIds.push(created.walletId);
  return created;
}

/** Exactly what ride-service's wallet port sends: the key, and nothing else. */
function serviceHeaders(key = INTERNAL_KEY): Record<string, string> {
  return { "X-Service-Key": key, "Idempotency-Key": uid("idem") };
}

function reserveBody(party: Driver): Record<string, unknown> {
  return {
    driverId: party.userId,
    bidId: uid("bid"),
    requestId: uid("req"),
    amountMinor: money(1_00, city.currency),
    baseMinor: money(10_00, city.currency),
    policyVersion: 1,
    cityId: city.cityId,
  };
}

async function reserve(
  from: string,
  party: Driver,
  key = INTERNAL_KEY,
): Promise<Reply> {
  return call(booted.port, {
    method: "POST",
    path: "/v1/wallet/mp/holds/reserve",
    from,
    headers: serviceHeaders(key),
    body: reserveBody(party),
  });
}

/** The driver-facing overview: user-authenticated (serviceAuth). */
async function overview(
  from: string,
  headers: Record<string, string>,
): Promise<Reply> {
  return call(booted.port, {
    path: `/v1/wallet/mp/overview?cityId=${city.cityId}`,
    from,
    headers,
  });
}

async function bucketSize(key: string): Promise<number> {
  return booted.redis.zcard(`ratelimit:payment:${key}`);
}

function expectRateLimited(reply: Reply): void {
  expect(reply.status, reply.text).toBe(429);
  expect(reply.body).toEqual({
    success: false,
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests",
      details: {
        limit: LIMIT,
        remaining: 0,
        resetIn: expect.any(Number) as number,
      },
    },
  });
  expect(reply.headers["x-ratelimit-limit"]).toBe(String(LIMIT));
  expect(reply.headers["x-ratelimit-remaining"]).toBe("0");
  expect(Number(reply.headers["x-ratelimit-reset"])).toBeGreaterThan(0);
}

describe("service callers holding the internal key", () => {
  it("are never 429'd: 200 rapid marketplace money calls — reserve at bid, capture at award, release the losers", async () => {
    const drivers = await Promise.all([driver(), driver(), driver(), driver()]);
    // One pod, no forwarded header: the exact shape of ride-service's port.
    const from = "127.0.0.1";

    const bids = Array.from({ length: 100 }, (_, index) => drivers[index % 4]!);
    const reserves = await inWaves(bids, 25, async (party) =>
      reserve(from, party),
    );
    const holdIds = reserves.map((reply) => {
      expect(reply.status, reply.text).toBe(201);
      return reply.body.reservationId as string;
    });

    const settle = await inWaves(
      holdIds.map((id, index) => ({ id, index })),
      25,
      async ({ id, index }) =>
        index % 2 === 0
          ? call(booted.port, {
              method: "POST",
              path: `/v1/wallet/mp/holds/${id}/capture`,
              from,
              headers: serviceHeaders(),
              body: {
                awardId: uid("awd"),
                expectedAmountMinor: money(1_00, city.currency),
              },
            })
          : call(booted.port, {
              method: "POST",
              path: `/v1/wallet/mp/holds/${id}/release`,
              from,
              headers: serviceHeaders(),
            }),
    );

    const all = [...reserves, ...settle];
    expect(all).toHaveLength(200);
    expect(all.filter((reply) => reply.status === 429)).toEqual([]);
    for (const reply of settle) {
      expect(reply.status, reply.text).toBe(200);
    }
    // The money really moved: 50 captured, 50 released, all 100 accounted.
    const holds = await db.mpCommissionHold.findMany({
      where: { id: { in: holdIds } },
      select: { state: true },
    });
    const byState: Record<string, number> = {};
    for (const hold of holds) {
      byState[hold.state] = (byState[hold.state] ?? 0) + 1;
    }
    expect(byState).toEqual({ captured: 50, released: 50 });
    // Nothing was counted for them — not the peer, not the legacy key.
    expect(await bucketSize("ip:127.0.0.1")).toBe(0);
    expect(await bucketSize("unknown")).toBe(0);
  });

  it("still succeed while the legacy shared key ratelimit:payment:unknown is saturated", async () => {
    const now = Date.now();
    const flood: (string | number)[] = [];
    for (let index = 0; index < 500; index += 1) {
      flood.push(now, `flood-${index}`);
    }
    await booted.redis.zadd("ratelimit:payment:unknown", ...flood);
    await booted.redis.expire("ratelimit:payment:unknown", 60);

    // In-process calls with no socket, no key and no identity are what the
    // old limiter poured into that key; they now reach authentication.
    for (let index = 0; index < LIMIT + 10; index += 1) {
      const response = await booted.app.fetch(
        new Request(
          `http://payment-service.test/v1/wallet/mp/overview?cityId=${city.cityId}`,
        ),
      );
      expect(response.status).toBe(401);
    }

    // Travel checkout and a marketplace bid, service key only.
    const traveller = await driver(500_000);
    const orderId = uid("tord");
    createdOrderIds.push(orderId);
    const travel = {
      orderId,
      userId: traveller.userId,
      amountMinor: 200_000,
      currency: city.currency,
      reason: "travel flight hold",
    };
    // What travel-service's payment port sends.
    const travelHeaders = (): Record<string, string> => ({
      "X-Service-Key": INTERNAL_KEY,
      "Idempotency-Key": `travel.checkout:${uid("cart")}:${traveller.userId}:${uid("k")}:0:auth`,
      "X-City-ID": city.cityId,
      "X-User-ID": traveller.userId,
      "X-User-Role": "rider",
    });
    for (const [op, reason] of [
      ["authorize", "travel flight hold"],
      ["capture", "travel flight capture"],
    ] as const) {
      const reply = await call(booted.port, {
        method: "POST",
        path: `/v1/finance/travel/${op}`,
        from: "127.0.0.1",
        headers: travelHeaders(),
        body: { ...travel, reason },
      });
      expect(reply.status, `${op}: ${reply.text}`).toBe(201);
    }
    const bid = await reserve("127.0.0.1", await driver());
    expect(bid.status, bid.text).toBe(201);
    expect(await booted.redis.zcard("ratelimit:payment:unknown")).toBe(500);
  });
});

describe("a gateway identity", () => {
  it("over its limit gets 429 — and another identity, the same client address and service calls are unaffected", async () => {
    const alice = await driver();
    const bob = await driver();
    const from = "127.0.0.1";
    const asAlice = { "x-ubi-identity": await signedIdentity(alice.userId) };

    for (let index = 0; index < LIMIT; index += 1) {
      const reply = await overview(from, asAlice);
      expect(reply.status, reply.text).toBe(200);
      expect(reply.headers["x-ratelimit-remaining"]).toBe(
        String(LIMIT - index - 1),
      );
    }
    expectRateLimited(await overview(from, asAlice));
    expect(await bucketSize(`user:${alice.userId}`)).toBe(LIMIT);

    // Bob, from the very same socket address, has his own bucket.
    const asBob = { "x-ubi-identity": await signedIdentity(bob.userId) };
    const bobReply = await overview(from, asBob);
    expect(bobReply.status, bobReply.text).toBe(200);
    expect(bobReply.headers["x-ratelimit-remaining"]).toBe(String(LIMIT - 1));

    // The address's own bucket is separate from both users'.
    const anonymous = await overview(from, {});
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers["x-ratelimit-remaining"]).toBe(String(LIMIT - 1));

    // And service traffic is not throttled at all.
    const bid = await reserve(from, alice);
    expect(bid.status, bid.text).toBe(201);
    expect(bid.headers["x-ratelimit-limit"]).toBeUndefined();
  });

  it("that does not verify is refused and counted against its sender's address, never the user it names", async () => {
    const victim = await driver();
    const forged = {
      "x-ubi-identity": await signedIdentity(
        victim.userId,
        "not-the-gateway-secret-but-long-enough-000000",
      ),
    };
    const from = "127.0.0.5";
    for (let index = 0; index < LIMIT; index += 1) {
      const reply = await overview(from, forged);
      expect(reply.status, reply.text).toBe(401);
    }
    expectRateLimited(await overview(from, forged));
    expect(await bucketSize("ip:127.0.0.5")).toBe(LIMIT);
    expect(await bucketSize(`user:${victim.userId}`)).toBe(0);

    // The victim's real session, even from the attacker's address, is fine.
    const real = await overview(from, {
      "x-ubi-identity": await signedIdentity(victim.userId),
    });
    expect(real.status, real.text).toBe(200);
  });
});

describe("a forged service key", () => {
  it("is refused by the router and counted per client — it never buys the service exemption", async () => {
    const party = await driver();
    const from = "127.0.0.4";
    const holdsBefore = await db.mpCommissionHold.count({
      where: { walletId: party.walletId },
    });
    for (let index = 0; index < LIMIT; index += 1) {
      const reply = await reserve(from, party, "forged-service-key");
      expect(reply.status, reply.text).toBe(403);
      expect(reply.headers["x-ratelimit-remaining"]).toBe(
        String(LIMIT - index - 1),
      );
    }
    expectRateLimited(await reserve(from, party, "forged-service-key"));
    // The same address is now limited on every payment family, travel included.
    expectRateLimited(
      await call(booted.port, {
        method: "POST",
        path: "/v1/finance/travel/authorize",
        from,
        headers: serviceHeaders(`${INTERNAL_KEY}-but-longer`),
        body: {},
      }),
    );
    expect(await bucketSize("ip:127.0.0.4")).toBe(LIMIT);
    expect(
      await db.mpCommissionHold.count({ where: { walletId: party.walletId } }),
    ).toBe(holdsBefore);

    // The real key from that same address is served.
    const genuine = await reserve(from, party);
    expect(genuine.status, genuine.text).toBe(201);
  });
});

describe("client addresses", () => {
  it("rotating X-Forwarded-For / X-Real-IP without a trusted proxy mints no fresh buckets", async () => {
    const from = "127.0.0.2";
    for (let index = 0; index < LIMIT; index += 1) {
      const reply = await overview(from, {
        "X-Forwarded-For": `203.0.113.${index + 1}`,
        "X-Real-IP": `198.51.100.${index + 1}`,
      });
      expect(reply.status, reply.text).toBe(401);
    }
    expectRateLimited(
      await overview(from, {
        "X-Forwarded-For": "203.0.113.200",
        "X-Real-IP": "198.51.100.200",
      }),
    );
    expect(await bucketSize("ip:127.0.0.2")).toBe(LIMIT);
    const spoofed = await booted.redis.keys("ratelimit:payment:ip:203.0.113.*");
    const spoofedReal = await booted.redis.keys(
      "ratelimit:payment:ip:198.51.100.*",
    );
    expect([...spoofed, ...spoofedReal]).toEqual([]);

    // A different real peer is its own client.
    const other = await overview("127.0.0.6", {});
    expect(other.status).toBe(401);
  });

  it("honours the forwarded client only from a trusted proxy, walking X-Forwarded-For from the right", async () => {
    process.env.PAYMENT_TRUSTED_PROXIES = "10.0.0.0/8, 127.0.0.3/32";
    const proxy = "127.0.0.3";
    const viaProxy = async (
      forwarded: Record<string, string>,
    ): Promise<Reply> => overview(proxy, forwarded);

    // The ingress appended the real client on the right; the gateway (a
    // trusted 10.x hop) forwarded it on.
    for (let index = 0; index < LIMIT; index += 1) {
      const reply = await viaProxy({
        "X-Forwarded-For": "198.51.100.7, 10.1.2.3",
      });
      expect(reply.status, reply.text).toBe(401);
    }
    expectRateLimited(await viaProxy({ "X-Forwarded-For": "198.51.100.7" }));
    expect(await bucketSize("ip:198.51.100.7")).toBe(LIMIT);
    expect(await bucketSize("ip:127.0.0.3")).toBe(0);

    // A different client behind the same proxy is unaffected…
    const neighbour = await viaProxy({ "X-Forwarded-For": "198.51.100.8" });
    expect(neighbour.status).toBe(401);
    // …and the limited client cannot escape by prepending a fake hop.
    expectRateLimited(
      await viaProxy({ "X-Forwarded-For": "203.0.113.99, 198.51.100.7" }),
    );
    // X-Real-IP only when the chain names no client.
    expectRateLimited(await viaProxy({ "X-Real-IP": "198.51.100.7" }));
    expect(
      (
        await viaProxy({
          "X-Forwarded-For": "10.9.9.9",
          "X-Real-IP": "198.51.100.9",
        })
      ).status,
    ).toBe(401);
    expect(await bucketSize("ip:198.51.100.9")).toBe(1);

    // A trusted proxy that forwards nothing usable is counted as itself.
    await viaProxy({});
    await viaProxy({ "X-Forwarded-For": "not-an-address" });
    expect(await bucketSize("ip:127.0.0.3")).toBe(2);

    // An untrusted peer's forwarding headers are ignored outright.
    await overview("127.0.0.8", { "X-Forwarded-For": "198.51.100.10" });
    expect(await bucketSize("ip:127.0.0.8")).toBe(1);
    expect(await bucketSize("ip:198.51.100.10")).toBe(0);
  });

  it("counts an IPv6 client per /64, so rotating inside its block mints nothing", async () => {
    process.env.PAYMENT_TRUSTED_PROXIES = "127.0.0.3";
    for (let index = 0; index < LIMIT; index += 1) {
      const reply = await overview("127.0.0.3", {
        "X-Forwarded-For": `2001:db8:1:2::${(index + 1).toString(16)}`,
      });
      expect(reply.status, reply.text).toBe(401);
    }
    expectRateLimited(
      await overview("127.0.0.3", {
        "X-Forwarded-For": "[2001:db8:1:2:ffff:ffff:ffff:fffe]:443",
      }),
    );
    expect(await bucketSize("ip6:2001:db8:1:2::/64")).toBe(LIMIT);
    const nextBlock = await overview("127.0.0.3", {
      "X-Forwarded-For": "2001:db8:1:3::1",
    });
    expect(nextBlock.status).toBe(401);
    expect(await bucketSize("ip6:2001:db8:1:3::/64")).toBe(1);
  });
});
