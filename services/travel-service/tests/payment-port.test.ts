/**
 * The payment port against the REAL payment-service, on its DEFAULT path
 * (P7 / recheck T02: "a mocked payment port does not prove default service
 * integration works").
 *
 * payment-service is started as its own process (its real `src/index.ts`,
 * real router registry, real auth, real ledger) against the same Postgres
 * these tests use. Nothing here passes a `basePath` or sets
 * PAYMENT_TRAVEL_PATH: every call goes to `/v1/finance/travel/{op}` exactly
 * as production wiring sends it, authenticated only by the shared
 * INTERNAL_SERVICE_KEY. The traveller's opening balance is a funding journal
 * entry written here (a fixture, like a top-up); everything after it is
 * payment-service's own postings.
 *
 * Covered: the production wiring (`createDeps`) reaching the mounted route; a
 * travel checkout whose authorize and capture land on the canonical ledger;
 * a failed booking releasing the hold; refund and status over the port;
 * idempotent replay; the service-key guard.
 *
 * This file sets PAYMENT_SERVICE_URL / INTERNAL_SERVICE_KEY on purpose, so the
 * turbo env-declaration lint does not apply.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";

import Redis from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ContractError, money } from "@ubi/contracts";

import {
  closeTestDb,
  headers,
  idemKey,
  makeDeps,
  resetTravel,
  rider,
  seedCity,
  seedFlightSupplier,
  TEST_DATABASE_URL,
  testDb,
  uid,
} from "./helpers";

import {
  createHttpPayment,
  type HttpPaymentPort,
  type PaymentRequest,
} from "../src/ports/payment-port";

const PAYMENT_SERVICE_DIR = path.resolve(__dirname, "../../payment-service");
const TSX = path.resolve(__dirname, "../node_modules/.bin/tsx");
const SERVICE_KEY = "travel-payment-port-integration-key";
const REDIS_URL =
  process.env.PAYMENT_TEST_REDIS_URL ?? "redis://127.0.0.1:6379/15";

const db = testDb();
let child: ChildProcess | undefined;
let childOutput = "";
let baseUrl = "";
let port: HttpPaymentPort;
let appFactory: typeof import("../src/index").createApp;
const savedEnv: Record<string, string | undefined> = {
  PAYMENT_SERVICE_URL: undefined,
  PAYMENT_TRAVEL_PATH: undefined,
  INTERNAL_SERVICE_KEY: undefined,
};

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const found =
        typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        resolve(found);
      });
    });
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForHealth(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child === undefined || child.exitCode !== null) {
      throw new Error(
        `payment-service exited before it was healthy:\n${childOutput}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // not listening yet
    }
    await sleep(250);
  }
  throw new Error(`payment-service did not become healthy:\n${childOutput}`);
}

beforeAll(async () => {
  const listenPort = await freePort();
  baseUrl = `http://127.0.0.1:${listenPort}`;

  // The payment rate limiter keys service calls without X-Forwarded-For under
  // one bucket; start each run with it empty so reruns within a minute do not
  // inherit the previous run's count.
  const redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  await redis.connect();
  await redis.del("ratelimit:payment:unknown");
  await redis.quit();

  child = spawn(TSX, ["src/index.ts"], {
    cwd: PAYMENT_SERVICE_DIR,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(listenPort),
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL,
      INTERNAL_SERVICE_KEY: SERVICE_KEY,
      LOG_LEVEL: "error",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collect = (chunk: Buffer): void => {
    childOutput = (childOutput + chunk.toString()).slice(-8_000);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  await waitForHealth(60_000);

  // Production wiring, pointed at the running payment-service — and nothing
  // else: no PAYMENT_TRAVEL_PATH, so the port's default path is what runs.
  for (const name of Object.keys(savedEnv)) {
    savedEnv[name] = process.env[name];
  }
  process.env.PAYMENT_SERVICE_URL = baseUrl;
  process.env.INTERNAL_SERVICE_KEY = SERVICE_KEY;
  delete process.env.PAYMENT_TRAVEL_PATH;
  const wiring = await import("../src/wiring.js");
  port = wiring.createDeps().payment as HttpPaymentPort;
  appFactory = (await import("../src/index.js")).createApp;
}, 90_000);

afterAll(async () => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  if (child !== undefined && child.exitCode === null) {
    const running = child;
    const exited = new Promise((resolve) => {
      running.once("exit", resolve);
    });
    running.kill("SIGTERM");
    await Promise.race([exited, sleep(10_000)]);
    if (running.exitCode === null) {
      running.kill("SIGKILL");
    }
  }
  await closeTestDb();
});

/** A wallet with an opening balance, the way a top-up would leave it. */
async function fundTraveller(
  userId: string,
  amountMinor: number,
): Promise<string> {
  const walletId = uid("wal");
  await db.wallet.create({
    data: {
      id: walletId,
      ownerType: "user",
      ownerId: userId,
      currency: "NGN",
      tier: "tier1",
    },
  });
  await db.$transaction(async (tx) => {
    const entryId = uid("je");
    await tx.journalEntry.create({
      data: {
        id: entryId,
        kind: "topup",
        reference: `topup:${walletId}`,
        occurredAt: new Date(),
      },
    });
    await tx.journalLine.createMany({
      data: [
        {
          id: uid("jl"),
          entryId,
          account: "psp_settlement",
          walletId: null,
          amountMinor: BigInt(-amountMinor),
          currency: "NGN",
          counterpartRef: `wallet:${walletId}`,
        },
        {
          id: uid("jl"),
          entryId,
          account: "wallet",
          walletId,
          amountMinor: BigInt(amountMinor),
          currency: "NGN",
          counterpartRef: `topup:${walletId}`,
        },
      ],
    });
  });
  return walletId;
}

async function balanceOf(walletId: string): Promise<number> {
  const result = await db.journalLine.aggregate({
    _sum: { amountMinor: true },
    where: { walletId },
  });
  return Number(result._sum.amountMinor ?? 0n);
}

function request(
  cityId: string,
  userId: string,
  orderId: string,
  amountMinor: number,
  idempotencyKey: string,
): PaymentRequest {
  return {
    orderId,
    userId,
    amount: money(amountMinor, "NGN"),
    cityId,
    reason: "travel flight item",
    idempotencyKey,
    actor: { id: userId, role: "rider" },
  };
}

describe("the payment port's default path reaches the mounted payment-service route", () => {
  it("runs authorize → capture → refund → status over the production wiring", async () => {
    const cityId = await seedCity(db);
    const userId = uid("traveller");
    const walletId = await fundTraveller(userId, 1_000_000);
    const orderId = uid("tord");
    const authKey = `${orderId}:auth`;

    const auth = await port.authorize(
      request(cityId, userId, orderId, 600_000, authKey),
    );
    expect(auth.ref).toMatch(/^tpo_/);
    expect(auth.entryId).toBeNull();
    expect(auth.replayed).toBe(false);
    expect(auth.amount).toEqual(money(600_000, "NGN"));
    expect(await balanceOf(walletId)).toBe(1_000_000);

    // A retry with the same key answers the original authorization.
    const replay = await port.authorize(
      request(cityId, userId, orderId, 600_000, authKey),
    );
    expect(replay.replayed).toBe(true);
    expect(replay.ref).toBe(auth.ref);

    const capture = await port.capture(
      request(cityId, userId, orderId, 600_000, `${orderId}:cap`),
    );
    expect(capture.entryId).not.toBeNull();
    expect(await balanceOf(walletId)).toBe(400_000);

    const refund = await port.refund(
      request(
        cityId,
        userId,
        orderId,
        200_000,
        `travel.refund:${uid("rf")}:payout`,
      ),
    );
    expect(refund.entryId).not.toBeNull();
    expect(refund.amount).toEqual(money(200_000, "NGN"));
    expect(await balanceOf(walletId)).toBe(600_000);

    const status = await port.status(orderId);
    expect(status?.item.state).toBe("partially_refunded");
    expect(status?.item.captureEntryId).toBe(capture.entryId);
    expect(status?.item.refundable.amountMinor).toBe(400_000);
    expect(status?.ops.map((op) => op.op)).toEqual([
      "authorize",
      "capture",
      "refund",
    ]);
    expect(status?.ops[0]?.clientKey).toBe(authKey);

    const captureEntry = await db.journalEntry.findUnique({
      where: { id: capture.entryId ?? "" },
      include: { lines: true },
    });
    expect(captureEntry?.kind).toBe("travel_capture");
    expect(
      captureEntry?.lines
        .map((line) => [line.account, Number(line.amountMinor)])
        .sort(),
    ).toEqual([
      ["travel_clearing", 600_000],
      ["wallet", -600_000],
    ]);

    expect(await port.status(uid("unknown-order"))).toBeNull();
  });

  it("surfaces payment-service's refusals as ContractErrors (illegal transition, wrong service key)", async () => {
    const cityId = await seedCity(db);
    const userId = uid("traveller");
    await fundTraveller(userId, 500_000);
    const orderId = uid("tord");

    await port.authorize(
      request(cityId, userId, orderId, 100_000, `${orderId}:auth`),
    );
    await port.release(
      request(cityId, userId, orderId, 100_000, `${orderId}:rel`),
    );
    const late = await port
      .capture(request(cityId, userId, orderId, 100_000, `${orderId}:cap`))
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(late).toBeInstanceOf(ContractError);
    expect((late as ContractError).details).toMatchObject({
      status: 409,
      paymentCode: "illegal_transition",
    });

    const unkeyed = createHttpPayment({ baseUrl, serviceKey: "not-the-key" });
    const refused = await unkeyed
      .authorize(
        request(cityId, userId, uid("tord"), 10_000, `${uid("k")}:auth`),
      )
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(refused).toBeInstanceOf(ContractError);
    expect((refused as ContractError).details).toMatchObject({ status: 403 });
  });
});

describe("travel checkout over the real payment-service", () => {
  // One enabled flight supplier per test: the checkout picks the first one.
  beforeEach(async () => {
    await resetTravel(db);
  });

  it("authorizes and captures a confirmed booking on the canonical ledger", async () => {
    const cityId = await seedCity(db);
    await seedFlightSupplier(db, {
      control: {
        "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" },
      },
    });
    const actor = rider();
    const walletId = await fundTraveller(actor.id, 20_000_000);
    const { deps } = makeDeps(db, { payment: port });
    const server = appFactory(deps);

    const cartRes = await server.request("/v1/travel/carts", {
      method: "POST",
      headers: headers(actor, cityId, { "Idempotency-Key": idemKey() }),
      body: JSON.stringify({
        items: [
          { kind: "flight", offerRef: "AP-P4-7120", fareFamilyId: "saver" },
        ],
      }),
    });
    expect(cartRes.status).toBe(201);
    const cart = (await cartRes.json()) as { id: string };

    const checkoutRes = await server.request(
      `/v1/travel/carts/${cart.id}/checkout`,
      {
        method: "POST",
        headers: headers(actor, cityId, { "Idempotency-Key": idemKey() }),
        body: JSON.stringify({
          paymentMethodId: "wallet",
          grantId: "grant_test",
        }),
      },
    );
    expect(checkoutRes.status, await checkoutRes.clone().text()).toBe(202);
    const checkout = (await checkoutRes.json()) as {
      orders: Array<{ id: string; state: string }>;
    };
    const orderId = checkout.orders[0]?.id ?? "";
    expect(checkout.orders[0]?.state).toBe("confirmed");

    const status = await port.status(orderId);
    expect(status?.item.state).toBe("captured");
    expect(status?.item.captured.amountMinor).toBe(14_850_000);
    expect(status?.ops.map((op) => op.op)).toEqual(["authorize", "capture"]);
    expect(await balanceOf(walletId)).toBe(20_000_000 - 14_850_000);

    const order = await db.travelOrder.findUnique({ where: { id: orderId } });
    expect(Number(order?.chargedMinor ?? 0)).toBe(14_850_000);
  });

  it("releases the hold when the supplier rejects the booking", async () => {
    const cityId = await seedCity(db);
    await seedFlightSupplier(db, {
      control: { "AP-P4-7120#saver": { bookOutcome: "failed" } },
    });
    const actor = rider();
    const walletId = await fundTraveller(actor.id, 20_000_000);
    const { deps } = makeDeps(db, { payment: port });
    const server = appFactory(deps);

    const cartRes = await server.request("/v1/travel/carts", {
      method: "POST",
      headers: headers(actor, cityId, { "Idempotency-Key": idemKey() }),
      body: JSON.stringify({
        items: [
          { kind: "flight", offerRef: "AP-P4-7120", fareFamilyId: "saver" },
        ],
      }),
    });
    const cart = (await cartRes.json()) as { id: string };
    const checkoutRes = await server.request(
      `/v1/travel/carts/${cart.id}/checkout`,
      {
        method: "POST",
        headers: headers(actor, cityId, { "Idempotency-Key": idemKey() }),
        body: JSON.stringify({
          paymentMethodId: "wallet",
          grantId: "grant_test",
        }),
      },
    );
    expect(checkoutRes.status, await checkoutRes.clone().text()).toBe(202);
    const checkout = (await checkoutRes.json()) as {
      orders: Array<{ id: string; state: string }>;
    };
    expect(checkout.orders[0]?.state).toBe("failed_released");

    const status = await port.status(checkout.orders[0]?.id ?? "");
    expect(status?.item.state).toBe("released");
    expect(status?.ops.map((op) => op.op)).toEqual(["authorize", "release"]);
    expect(await balanceOf(walletId)).toBe(20_000_000);
  });
});
