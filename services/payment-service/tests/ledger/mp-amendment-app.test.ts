/**
 * The post-award amendment money routes are MOUNTED in the real service
 * (A02 item 5): requests go through `src/index.ts`'s app — global middleware,
 * the `/v1/wallet/*` rate limiter, the router registry and the internal
 * service-key guard — at exactly the paths ride-service will call.
 *
 * It proves: every new route exists under the two guarded families
 * (`/v1/wallet/mp/holds/*`, `/v1/wallet/mp/funding/*`), every one refuses a
 * request without the right X-Service-Key BEFORE touching money, and one
 * whole amendment lifecycle (increase, then decrease, then completion) runs
 * over HTTP with the documented wire shapes and status codes.
 *
 * The app reads its Prisma singleton and Redis client at import time, so the
 * module is imported only after DATABASE_URL points at the test database.
 * The rate limiter keys service calls by X-Forwarded-For; every request uses
 * its own address so a run never shares a bucket.
 *
 * This file sets INTERNAL_SERVICE_KEY / DATABASE_URL on purpose, so the turbo
 * env-declaration lint does not apply.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { commissionMinorFor, money } from "@ubi/contracts";
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
} from "./helpers";
import { balanceOf, spendableOf } from "../../src/ledger/balances";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import { ensureWallet } from "../../src/ledger/wallets";

import type { Hono } from "hono";

const INTERNAL_KEY = "mp-amendment-app-test-internal-key";
const db = testDb();
let app: Hono;
let disconnect: () => Promise<void>;
let savedKey: string | undefined;
let savedDatabaseUrl: string | undefined;

const createdWalletIds: string[] = [];

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
  // Earlier suites in this worker may have imported the app against
  // global-setup's DATABASE_URL, and src/lib/prisma caches its client on
  // globalThis outside production; drop it so this import uses the test DB.
  await dropCachedPrisma();
  const service = (await import("../../src/index.js")) as unknown as {
    default: Hono;
  };
  const prismaModule = await import("../../src/lib/prisma.js");
  const redisModule = await import("../../src/lib/redis.js");
  app = service.default;
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
  await db.mpCommissionHold.deleteMany({
    where: { walletId: { in: createdWalletIds } },
  });
  await db.mpRiderReservation.deleteMany({
    where: { walletId: { in: createdWalletIds } },
  });
  await disconnect();
  await dropCachedPrisma();
  await closeTestDb();
});

interface Party {
  readonly city: SeededCity;
  readonly userId: string;
  readonly walletId: string;
}

async function party(
  city: SeededCity,
  amountMinor: number,
  name: string,
): Promise<Party> {
  const user = await seedUser(db, name);
  const config = await createCityConfigProvider(db).load(city.cityId);
  const wallet = await db.$transaction((tx) =>
    ensureWallet(tx, "user", user.id, config.city),
  );
  createdWalletIds.push(wallet.id);
  if (amountMinor > 0) {
    await fundWallet(db, wallet.id, city.currency, amountMinor);
  }
  return { city, userId: user.id, walletId: wallet.id };
}

const ADDRESS_BASE = Math.floor(Math.random() * 200);
let addressCounter = 0;
function freshAddress(): string {
  addressCounter += 1;
  return `10.${ADDRESS_BASE}.${Math.floor(addressCounter / 250)}.${addressCounter % 250}`;
}

/** What ride-service's wallet port sends: service key + an Idempotency-Key. */
function serviceHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "content-type": "application/json",
    "Idempotency-Key": uid("idem"),
    "X-Service-Key": INTERNAL_KEY,
    "X-Forwarded-For": freshAddress(),
    ...extra,
  };
}

async function post(
  path: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.fetch(
    new Request(`http://payment-service.test/v1/wallet/mp${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

const AMENDMENT_ROUTES = [
  "/holds/:id/amendments/:amendmentId/reserve",
  "/holds/:id/amendments/:amendmentId/capture",
  "/holds/:id/amendments/:amendmentId/release",
  "/holds/:id/amendments/:amendmentId/refund",
  "/funding/top-up",
  "/funding/top-up/commit",
  "/funding/top-up/release",
  "/funding/partial-release",
] as const;

describe("amendment money routes in the real app", () => {
  it("are registered under the guarded /v1/wallet/mp families", () => {
    const paths = app.routes.map((route) => `${route.method} ${route.path}`);
    for (const route of AMENDMENT_ROUTES) {
      expect(paths).toContain(`POST /v1/wallet/mp${route}`);
    }
  });

  it("refuse every call without — or with the wrong — X-Service-Key, before touching money", async () => {
    const city = await seedCity(db);
    const driver = await party(city, 1_000_00, "Driver");
    const eventsBefore = await db.outboxEvent.count();
    const body = {
      awardId: uid("awd"),
      amendmentId: uid("amd"),
      requesterId: driver.userId,
      paymentMethodId: "wallet",
      priorTotalMinor: money(500_00, city.currency),
      newTotalMinor: money(600_00, city.currency),
      newBaseMinor: money(6_000_00, city.currency),
      priorAmountMinor: 5_000_00,
      newAmountMinor: 6_000_00,
      currency: city.currency,
      cityId: city.cityId,
      reason: "probe",
    };
    for (const route of AMENDMENT_ROUTES) {
      const path = route
        .replace(":id", uid("mph"))
        .replace(":amendmentId", uid("amd"));
      const noKey = await post(
        path,
        {
          "content-type": "application/json",
          "Idempotency-Key": uid("idem"),
          "X-Forwarded-For": freshAddress(),
        },
        body,
      );
      expect(noKey.status, `${route} without a key`).toBe(403);
      const wrongKey = await post(
        path,
        serviceHeaders({ "X-Service-Key": "not-the-key" }),
        body,
      );
      expect(wrongKey.status, `${route} with the wrong key`).toBe(403);
    }
    expect(await db.outboxEvent.count()).toBe(eventsBefore);
  });

  it("runs an increase, a decrease and completion over HTTP with the documented shapes", async () => {
    const city = await seedCity(db);
    const driver = await party(city, 1_000_00, "Driver");
    const rider = await party(city, 10_000_00, "Rider");
    const currency = city.currency;
    const awardId = uid("awd");
    const requestId = uid("mpr");

    // The award as ride-service builds it today: a bid hold captured at
    // selection, and the rider's funding authorized for the selected fare.
    const reserve = await post("/holds/reserve", serviceHeaders(), {
      driverId: driver.userId,
      bidId: uid("bid"),
      requestId,
      amountMinor: money(500_00, currency),
      baseMinor: money(5_000_00, currency),
      policyVersion: 1,
      cityId: city.cityId,
    });
    expect(reserve.status, await reserve.clone().text()).toBe(201);
    const { reservationId } = await json<{ reservationId: string }>(reserve);
    const capture = await post(
      `/holds/${reservationId}/capture`,
      serviceHeaders(),
      { awardId, expectedAmountMinor: money(500_00, currency) },
    );
    expect(capture.status, await capture.clone().text()).toBe(200);
    const { receiptId } = await json<{ receiptId: string }>(capture);
    const authorize = await post("/funding/authorize", serviceHeaders(), {
      requesterId: rider.userId,
      requestId,
      awardId,
      paymentMethodId: "wallet",
      amountMinor: 5_000_00,
      currency,
      cityId: city.cityId,
    });
    expect(authorize.status, await authorize.clone().text()).toBe(200);

    // ── Amendment A: 5,000.00 → 6,000.00 ──
    const a = uid("amd");
    const deltaTerms = {
      awardId,
      priorTotalMinor: money(500_00, currency),
      newTotalMinor: money(commissionMinorFor(6_000_00), currency),
      newBaseMinor: money(6_000_00, currency),
    };
    const reserveDelta = await post(
      `/holds/${reservationId}/amendments/${a}/reserve`,
      serviceHeaders(),
      deltaTerms,
    );
    expect(reserveDelta.status, await reserveDelta.clone().text()).toBe(201);
    const reserved = await json<Record<string, unknown>>(reserveDelta);
    expect(reserved).toMatchObject({
      reservationId,
      amendmentId: a,
      awardId,
      direction: "increase",
      state: "active",
      deltaMinor: money(100_00, currency),
      priorTotalMinor: money(500_00, currency),
      newTotalMinor: money(600_00, currency),
      originalReceiptId: receiptId,
    });
    const reserveReplay = await post(
      `/holds/${reservationId}/amendments/${a}/reserve`,
      serviceHeaders(),
      deltaTerms,
    );
    expect(reserveReplay.status).toBe(200);
    expect(await json<Record<string, unknown>>(reserveReplay)).toEqual(
      reserved,
    );

    const topUp = await post("/funding/top-up", serviceHeaders(), {
      requesterId: rider.userId,
      awardId,
      amendmentId: a,
      paymentMethodId: "wallet",
      priorAmountMinor: 5_000_00,
      newAmountMinor: 6_000_00,
      currency,
      cityId: city.cityId,
    });
    expect(topUp.status, await topUp.clone().text()).toBe(201);
    expect(await json<Record<string, unknown>>(topUp)).toMatchObject({
      kind: "top_up",
      secured: true,
      status: "reserved",
      deltaMinor: 1_000_00,
    });

    const commit = await post("/funding/top-up/commit", serviceHeaders(), {
      awardId,
      amendmentId: a,
      newAmountMinor: 6_000_00,
    });
    expect(commit.status, await commit.clone().text()).toBe(200);
    const captureDelta = await post(
      `/holds/${reservationId}/amendments/${a}/capture`,
      serviceHeaders(),
      { awardId, newTotalMinor: money(600_00, currency) },
    );
    expect(captureDelta.status, await captureDelta.clone().text()).toBe(200);
    expect(await json<Record<string, unknown>>(captureDelta)).toMatchObject({
      state: "captured",
      receiptId: expect.stringMatching(/^mcr/),
      journalEntryId: expect.any(String),
    });
    expect(await balanceOf(db, driver.walletId, currency)).toEqual(
      money(400_00, currency),
    );

    // ── Amendment B: 6,000.00 → 5,500.00, refused first on stale terms ──
    // (a caller that missed amendment A's capture and believes 580.00).
    const b = uid("amd");
    const stale = await post(
      `/holds/${reservationId}/amendments/${b}/refund`,
      serviceHeaders(),
      {
        awardId,
        priorTotalMinor: money(580_00, currency),
        newTotalMinor: money(550_00, currency),
        newBaseMinor: money(5_500_00, currency),
      },
    );
    expect(stale.status).toBe(409);
    expect(await json<Record<string, unknown>>(stale)).toMatchObject({
      code: "version_conflict",
      details: {
        refreshedTerms: { capturedTotalMinor: money(600_00, currency) },
      },
    });
    const mixed = await post(
      `/holds/${reservationId}/amendments/${b}/refund`,
      serviceHeaders(),
      {
        awardId,
        priorTotalMinor: money(600_00, currency),
        newTotalMinor: money(550_00, "KES"),
        newBaseMinor: money(5_500_00, currency),
      },
    );
    expect(mixed.status).toBe(422);
    const noIdempotencyKey = await post(
      `/holds/${reservationId}/amendments/${b}/refund`,
      {
        "content-type": "application/json",
        "X-Service-Key": INTERNAL_KEY,
        "X-Forwarded-For": freshAddress(),
      },
      {
        awardId,
        priorTotalMinor: money(600_00, currency),
        newTotalMinor: money(550_00, currency),
        newBaseMinor: money(5_500_00, currency),
      },
    );
    expect(noIdempotencyKey.status).toBe(422);

    const refund = await post(
      `/holds/${reservationId}/amendments/${b}/refund`,
      serviceHeaders(),
      {
        awardId,
        priorTotalMinor: money(600_00, currency),
        newTotalMinor: money(550_00, currency),
        newBaseMinor: money(5_500_00, currency),
      },
    );
    expect(refund.status, await refund.clone().text()).toBe(201);
    expect(await json<Record<string, unknown>>(refund)).toMatchObject({
      direction: "decrease",
      state: "refunded",
      deltaMinor: money(50_00, currency),
    });
    const partial = await post("/funding/partial-release", serviceHeaders(), {
      requesterId: rider.userId,
      awardId,
      amendmentId: b,
      paymentMethodId: "wallet",
      priorAmountMinor: 6_000_00,
      newAmountMinor: 5_500_00,
      currency,
      cityId: city.cityId,
    });
    expect(partial.status, await partial.clone().text()).toBe(201);
    expect(await balanceOf(db, driver.walletId, currency)).toEqual(
      money(450_00, currency),
    );
    expect(await spendableOf(db, rider.walletId, currency)).toEqual(
      money(4_500_00, currency),
    );

    // A rejected amendment C releases what it reserved on both sides.
    const c = uid("amd");
    const cReserve = await post(
      `/holds/${reservationId}/amendments/${c}/reserve`,
      serviceHeaders(),
      {
        awardId,
        priorTotalMinor: money(550_00, currency),
        newTotalMinor: money(700_00, currency),
        newBaseMinor: money(7_000_00, currency),
      },
    );
    expect(cReserve.status).toBe(201);
    const cTopUp = await post("/funding/top-up", serviceHeaders(), {
      requesterId: rider.userId,
      awardId,
      amendmentId: c,
      paymentMethodId: "wallet",
      priorAmountMinor: 5_500_00,
      newAmountMinor: 7_000_00,
      currency,
      cityId: city.cityId,
    });
    expect(cTopUp.status).toBe(201);
    const cRelease = await post(
      `/holds/${reservationId}/amendments/${c}/release`,
      serviceHeaders(),
      { awardId, reason: "driver_declined" },
    );
    expect(cRelease.status).toBe(200);
    expect(await json<Record<string, unknown>>(cRelease)).toMatchObject({
      state: "released",
    });
    const cFundingRelease = await post(
      "/funding/top-up/release",
      serviceHeaders(),
      { awardId, amendmentId: c, reason: "driver_declined" },
    );
    expect(cFundingRelease.status).toBe(200);
    expect(await spendableOf(db, driver.walletId, currency)).toEqual(
      money(450_00, currency),
    );

    // Completion at the final fare consumes exactly the committed funding.
    const settle = await post("/settlements", serviceHeaders(), {
      awardId,
      executionRef: { service: "ride", id: uid("ride") },
      requesterId: rider.userId,
      driverId: driver.userId,
      fareMinor: money(5_500_00, currency),
      method: "wallet",
      cityId: city.cityId,
    });
    expect(settle.status, await settle.clone().text()).toBe(200);
    expect(await balanceOf(db, rider.walletId, currency)).toEqual(
      money(4_500_00, currency),
    );
    expect(await spendableOf(db, rider.walletId, currency)).toEqual(
      money(4_500_00, currency),
    );
    // Driver: 1,000.00 − 550.00 commission (exactly 10% of 5,500.00) +
    // the full 5,500.00 fare.
    expect(await balanceOf(db, driver.walletId, currency)).toEqual(
      money(1_000_00 - commissionMinorFor(5_500_00) + 5_500_00, currency),
    );
  });
});
