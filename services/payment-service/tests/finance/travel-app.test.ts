/**
 * The travel payment endpoint is MOUNTED in the real service (P7 / recheck
 * T02): requests go through `src/index.ts`'s app — global middleware, the
 * `/v1/finance/*` rate limiter, the router registry — at exactly the paths
 * travel-service's payment port calls by default
 * (`/v1/finance/travel/{op}`), with the service key and nothing else.
 *
 * It also pins the mount ORDER: the `/v1/finance` recon router guards every
 * path under /v1/finance with an admin session (`use("*")`), so if the travel
 * router were mounted after it, the travel-service's service-key call would
 * be refused as a non-admin. And it proves the recon surface was not loosened
 * by the new mount.
 *
 * The app reads its Prisma singleton and Redis client at import time, so the
 * module is imported only after DATABASE_URL points at the test database. The
 * rate limiter keys service calls by X-Forwarded-For; each run uses its own
 * address so reruns within a minute do not share a bucket.
 *
 * This file sets INTERNAL_SERVICE_KEY / DATABASE_URL on purpose, so the turbo
 * env-declaration lint does not apply.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeTestDb,
  fundWallet,
  seedCity,
  seedUser,
  testDb,
  TEST_DATABASE_URL,
  uid,
  type SeededCity,
} from "../ledger/helpers";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import { ensureWallet } from "../../src/ledger/wallets";

import type { Hono } from "hono";

const INTERNAL_KEY = "travel-app-test-internal-key";
const FORWARDED_FOR = `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

const db = testDb();
let app: Hono;
let mounted: readonly string[];
let disconnect: () => Promise<void>;
let savedKey: string | undefined;
let savedDatabaseUrl: string | undefined;

const createdOrderIds: string[] = [];

async function dropCachedPrisma(): Promise<void> {
  const holder = globalThis as {
    prisma?: { $disconnect(): Promise<void> };
  };
  if (holder.prisma !== undefined) {
    await holder.prisma.$disconnect().catch(() => undefined);
    delete holder.prisma;
  }
}

beforeAll(async () => {
  savedKey = process.env.INTERNAL_SERVICE_KEY;
  savedDatabaseUrl = process.env.DATABASE_URL;
  process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  // Earlier suites in this worker import the app with global-setup's
  // DATABASE_URL, and src/lib/prisma caches its client on globalThis outside
  // production; drop that cache so this import builds a client on the test DB.
  await dropCachedPrisma();
  // vitest loads the module as ESM; the cast states that runtime shape (the
  // CJS-interop typing tsc infers for a dynamic import is not it).
  const service = (await import("../../src/index.js")) as unknown as {
    default: Hono;
    MOUNTED_ROUTE_PREFIXES: readonly string[];
  };
  const prismaModule = await import("../../src/lib/prisma.js");
  const redisModule = await import("../../src/lib/redis.js");
  app = service.default;
  mounted = service.MOUNTED_ROUTE_PREFIXES;
  disconnect = async () => {
    await prismaModule.disconnectPrisma();
    await redisModule.disconnectRedis();
  };
});

afterAll(async () => {
  if (savedKey === undefined) {
    delete process.env.INTERNAL_SERVICE_KEY;
  } else {
    process.env.INTERNAL_SERVICE_KEY = savedKey;
  }
  if (savedDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = savedDatabaseUrl;
  }
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
  await disconnect();
  await dropCachedPrisma();
  await closeTestDb();
});

interface Traveller {
  readonly city: SeededCity;
  readonly userId: string;
  readonly walletId: string;
}

async function fundedTraveller(amountMinor: number): Promise<Traveller> {
  const city = await seedCity(db, { flags: { flights_booking: true } });
  const user = await seedUser(db, "Traveller");
  const config = await createCityConfigProvider(db).load(city.cityId);
  const wallet = await db.$transaction(async (tx) => {
    const created = await ensureWallet(tx, "user", user.id, config.city);
    return created;
  });
  if (amountMinor > 0) {
    await fundWallet(db, wallet.id, city.currency, amountMinor);
  }
  return { city, userId: user.id, walletId: wallet.id };
}

/** Exactly what travel-service's port sends: service key, scoped key, city, actor mirrors. */
function portHeaders(
  traveller: Traveller,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "content-type": "application/json",
    "idempotency-key": `travel.checkout:${uid("cart")}:${traveller.userId}:${uid("k")}:0:auth`,
    "X-City-ID": traveller.city.cityId,
    "X-User-ID": traveller.userId,
    "X-User-Role": "rider",
    "X-Service-Key": INTERNAL_KEY,
    "X-Forwarded-For": FORWARDED_FOR,
    ...extra,
  };
}

async function post(
  path: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.fetch(
    new Request(`http://payment-service.test${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

describe("/v1/finance/travel in the real app", () => {
  it("is in the router registry, ahead of the /v1/finance recon router", () => {
    const travel = mounted.indexOf("/v1/finance/travel");
    const finance = mounted.indexOf("/v1/finance");
    expect(travel).toBeGreaterThanOrEqual(0);
    expect(travel).toBeLessThan(finance);
    const paths = app.routes.map((route) => `${route.method} ${route.path}`);
    for (const op of ["authorize", "capture", "release", "refund"]) {
      expect(paths).toContain(`POST /v1/finance/travel/${op}`);
    }
    expect(paths).toContain("GET /v1/finance/travel/orders/:orderId");
  });

  it("serves the port's default paths with the service key alone — authorize, capture, refund, status", async () => {
    const traveller = await fundedTraveller(500_000);
    const orderId = uid("tord");
    createdOrderIds.push(orderId);
    const body = {
      orderId,
      userId: traveller.userId,
      amountMinor: 200_000,
      currency: traveller.city.currency,
      reason: "travel flight hold",
    };

    const auth = await post(
      "/v1/finance/travel/authorize",
      portHeaders(traveller),
      body,
    );
    expect(auth.status, await auth.clone().text()).toBe(201);
    const authBody = (await auth.json()) as { ref: string; state: string };
    expect(authBody.state).toBe("authorized");
    expect(authBody.ref).toMatch(/^tpo_/);

    const capture = await post(
      "/v1/finance/travel/capture",
      portHeaders(traveller),
      { ...body, reason: "travel flight capture" },
    );
    expect(capture.status, await capture.clone().text()).toBe(201);
    const captureBody = (await capture.json()) as { entryId: string };

    const refund = await post(
      "/v1/finance/travel/refund",
      portHeaders(traveller),
      { ...body, amountMinor: 50_000, reason: "travel refund rf_app" },
    );
    expect(refund.status, await refund.clone().text()).toBe(201);

    const status = await app.fetch(
      new Request(
        `http://payment-service.test/v1/finance/travel/orders/${orderId}`,
        {
          headers: portHeaders(traveller),
        },
      ),
    );
    expect(status.status).toBe(200);
    const statusBody = (await status.json()) as {
      item: {
        state: string;
        captureEntryId: string;
        refundable: { amountMinor: number };
      };
    };
    expect(statusBody.item.state).toBe("partially_refunded");
    expect(statusBody.item.captureEntryId).toBe(captureBody.entryId);
    expect(statusBody.item.refundable.amountMinor).toBe(150_000);

    const entry = await db.journalEntry.findUnique({
      where: { id: captureBody.entryId },
      include: { lines: true },
    });
    expect(entry?.kind).toBe("travel_capture");
  });

  it("refuses the same call without the service key (403) — the admin session guards are not the gate", async () => {
    const traveller = await fundedTraveller(100_000);
    const { "X-Service-Key": _dropped, ...withoutKey } = portHeaders(traveller);
    void _dropped;
    const response = await post(
      "/v1/finance/travel/authorize",
      { ...withoutKey, "X-User-Role": "ADMIN" },
      {
        orderId: uid("tord"),
        userId: traveller.userId,
        amountMinor: 10_000,
        currency: traveller.city.currency,
      },
    );
    expect(response.status).toBe(403);
  });

  it("leaves the recon surface admin-only: a service key is not an admin session", async () => {
    const traveller = await fundedTraveller(0);
    const response = await app.fetch(
      new Request("http://payment-service.test/v1/finance/recon/2026-09-22", {
        headers: {
          "X-Service-Key": INTERNAL_KEY,
          "X-City-ID": traveller.city.cityId,
          "X-User-ID": traveller.userId,
          "X-User-Role": "rider",
          "X-Forwarded-For": FORWARDED_FOR,
        },
      }),
    );
    expect(response.status).toBe(403);
  });
});
