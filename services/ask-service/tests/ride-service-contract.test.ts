/**
 * Ask → ride-service, end to end, against the REAL processes (recheck P01:
 * "contract tests using the actual HTTP routes and auth middleware: Ask →
 * ride-service with signing enabled; cross-user/city denial;
 * publish/select/cancel; changed offer; retry after timeout; exactly one
 * funding/commission outcome").
 *
 * ride-service is built from source (`go build ./cmd/server`) and started as
 * its own process with RIDE_INTERNAL_CONTEXT_SECRET set — so every call must
 * carry the HMAC-signed delegated identity — and RIDE_MIGRATE_ON_BOOT applying
 * its schema to this test database. Its money ports are the REAL
 * payment-service (`tsx src/index.ts`) on the same database: the driver's
 * commission hold, the rider's funding authorization and the commission
 * capture are payment-service's own postings. ask-service drives everything
 * through its production marketplace port and its real ops; only the model is
 * absent (the proposals are created through the same op the tool uses) and
 * the grant is minted by the test grant port (the real user-service mint is
 * covered by tests/grant-port-user-service.test.ts).
 *
 * The one injected fault is at the client transport: a selection whose
 * RESPONSE is lost after ride-service committed it — the realistic ambiguous
 * timeout — so the retry must reconcile the same execution against the real
 * award, never select or charge twice.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { delegatedIdentityHeaders } from "../src/lib/ride-context";
import { getExecution } from "../src/ops/executions";
import {
  cancelMarketplaceRequest,
  createMarketplaceReview,
  reconcileMarketplaceExecution,
} from "../src/ops/mp-lifecycle";
import { confirmReview, TermsChangedError } from "../src/ops/reviews";
import { openThread } from "../src/ops/threads";
import { createHttpMarketplacePort } from "../src/ports/marketplace-port";
import {
  closeTestDb,
  makeDeps,
  TEST_DATABASE_URL,
  testDb,
  uid,
  type TestDeps,
} from "./helpers";
import {
  contractCityId,
  fundWallet,
  seedMarketplaceCity,
} from "./ride-contract-fixtures";
import { spawnService, type SpawnedService } from "./spawn";

import type { Actor } from "../src/ops/types";

const RIDE_DIR = path.resolve(__dirname, "../../ride-service");
const PAYMENT_DIR = path.resolve(__dirname, "../../payment-service");
const SIGNING_KEY = "ask-ride-contract-internal-context-secret-0001";
const SERVICE_KEY = "ask-ride-contract-internal-service-key-00001";
const REDIS_URL = process.env.ASK_TEST_REDIS_URL ?? "redis://127.0.0.1:6379/4";
const PICKUP = { lat: 6.5244, lng: 3.3792 };
const DROPOFF = { lat: 6.5694, lng: 3.3792 };

let buildDir: string;
let payment: SpawnedService;
let ride: SpawnedService;

function goDatabaseUrl(): string {
  const url = new URL(TEST_DATABASE_URL);
  url.searchParams.set("sslmode", "disable");
  return url.toString();
}

beforeAll(async () => {
  buildDir = mkdtempSync(path.join(tmpdir(), "ask-ride-contract-"));
  const binary = path.join(buildDir, "ride-server");
  // Built from the checked-out source, every run: the contract is with THIS
  // ride-service, not a cached artifact.
  execFileSync("go", ["build", "-o", binary, "./cmd/server"], {
    cwd: RIDE_DIR,
    stdio: "pipe",
  });

  payment = await spawnService({
    name: "payment-service",
    command: path.join(PAYMENT_DIR, "node_modules", ".bin", "tsx"),
    args: ["src/index.ts"],
    cwd: PAYMENT_DIR,
    env: {
      NODE_ENV: "development",
      LOG_LEVEL: "error",
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL,
      INTERNAL_SERVICE_KEY: SERVICE_KEY,
    },
    healthPath: "/health",
    readyTimeoutMs: 80_000,
  });

  ride = await spawnService({
    name: "ride-service",
    command: binary,
    args: [],
    cwd: RIDE_DIR,
    env: {
      NODE_ENV: "development",
      DATABASE_URL: goDatabaseUrl(),
      REDIS_URL,
      RIDE_QUOTE_SIGNING_SECRET: "ask-ride-contract-quote-signing-secret-01",
      // Signing ENABLED: an unsigned or wrongly-signed identity is refused.
      RIDE_INTERNAL_CONTEXT_SECRET: SIGNING_KEY,
      RIDE_MIGRATE_ON_BOOT: "true",
      PAYMENT_SERVICE_URL: payment.baseUrl,
      INTERNAL_SERVICE_KEY: SERVICE_KEY,
    },
    healthPath: "/health/ready",
    readyTimeoutMs: 60_000,
  });
}, 240_000);

afterAll(async () => {
  await ride?.stop();
  await payment?.stop();
  if (buildDir !== undefined) {
    rmSync(buildDir, { recursive: true, force: true });
  }
  await closeTestDb();
});

// ---------------------------------------------------------------------------
// Direct calls AS a user — the driver's side of the marketplace
// ---------------------------------------------------------------------------

interface Party {
  readonly actor: Actor;
  readonly cityId: string;
}

async function rideCall(
  who: Party,
  method: "GET" | "POST",
  pathname: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${ride.baseUrl}${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...extraHeaders,
      ...delegatedIdentityHeaders(
        [SIGNING_KEY],
        { userId: who.actor.id, role: who.actor.role, cityId: who.cityId },
        new Date(),
      ),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    json:
      text.length === 0 ? {} : (JSON.parse(text) as Record<string, unknown>),
  };
}

function expectStatus(
  result: { status: number; json: unknown },
  status: number,
): void {
  if (result.status !== status) {
    throw new Error(
      `expected ${status}, got ${result.status}: ${JSON.stringify(result.json)}`,
    );
  }
}

/** Online, parked near the pickup with a full dwell history, eligible to bid. */
async function parkDriver(driver: Party): Promise<void> {
  expectStatus(
    await rideCall(driver, "POST", "/v1/drivers/me/status", {
      online: true,
      filters: { vehicleClasses: ["go"] },
    }),
    200,
  );
  const now = Date.now();
  const points = [90, 60, 30, 1].map((ago, index) => ({
    seq: index + 1,
    lat: PICKUP.lat + 0.001,
    lng: PICKUP.lng,
    accuracyMeters: 8,
    speedMetersPerSecond: 0,
    recordedAt: new Date(now - ago * 1000).toISOString(),
  }));
  expectStatus(
    await rideCall(driver, "POST", "/v1/drivers/me/locations", { points }),
    200,
  );
  expectStatus(await rideCall(driver, "POST", "/v1/mp/driver/parked"), 200);
}

async function bid(
  driver: Party,
  requestId: string,
  amountMinor: number,
): Promise<string> {
  const result = await rideCall(
    driver,
    "POST",
    "/v1/mp/bids",
    {
      requestId,
      requestRevision: 1,
      amountMinor: { amountMinor, currency: "NGN" },
      slot: "current",
      availabilityEpoch: 0,
    },
    { "idempotency-key": `bid-${randomUUID()}` },
  );
  expectStatus(result, 201);
  return result.json.bidId as string;
}

// ---------------------------------------------------------------------------
// The rider's side — through ask-service
// ---------------------------------------------------------------------------

interface Rider extends Party {
  readonly deps: TestDeps;
  readonly threadId: string;
  /** Loses the RESPONSE of the next select after ride-service handled it. */
  loseNextSelectResponse: boolean;
  /** Fails this many award reads in transit (the network, not the server). */
  failNextAwardQueries: number;
  readonly selectRequests: string[];
}

async function riderIn(
  cityId: string,
  actor: Actor = { id: randomUUID(), role: "rider" },
): Promise<Rider> {
  const state = {
    loseNextSelectResponse: false,
    failNextAwardQueries: 0,
    selectRequests: [] as string[],
  };
  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    if (
      url.endsWith("/award") &&
      (init?.method ?? "GET") === "GET" &&
      state.failNextAwardQueries > 0
    ) {
      state.failNextAwardQueries -= 1;
      throw new TypeError("fetch failed: the connection was reset");
    }
    const response = await fetch(input, init);
    if (url.endsWith("/select") && init?.method === "POST") {
      const headers = new Headers(init.headers);
      state.selectRequests.push(headers.get("idempotency-key") ?? "");
      if (state.loseNextSelectResponse) {
        state.loseNextSelectResponse = false;
        await response.text();
        // ride-service committed the selection; the answer never arrives.
        throw Object.assign(new Error("the response was lost"), {
          name: "AbortError",
        });
      }
    }
    return response;
  };
  const deps = makeDeps(testDb(), {
    marketplace: createHttpMarketplacePort({
      baseUrl: ride.baseUrl,
      signingKeys: [SIGNING_KEY],
      fetchImpl: transport,
    }),
  });
  const thread = await openThread(deps, {
    actor,
    cityId,
    source: "home",
    correlationId: null,
  });
  // The rider funds the award from the wallet (payment-service reserves it).
  if ((await testDb().wallet.count({ where: { ownerId: actor.id } })) === 0) {
    await fundWallet(testDb(), actor.id, 5_000_000);
  }
  return Object.assign(state, {
    actor,
    cityId,
    deps,
    threadId: thread.id,
  }) as Rider;
}

async function publish(rider: Rider): Promise<string> {
  const review = await createMarketplaceReview(rider.deps, {
    actor: rider.actor,
    cityId: rider.cityId,
    threadId: rider.threadId,
    request: {
      stage: "publish",
      quote: {
        service: "ride",
        vehicleClass: "go",
        pickupLat: PICKUP.lat,
        pickupLng: PICKUP.lng,
        dropoffLat: DROPOFF.lat,
        dropoffLng: DROPOFF.lng,
      },
      requestedFare: null,
      paymentMethodId: "wallet",
    },
    idempotencyKey: uid("rv"),
    correlationId: null,
  });
  const { executionId } = await confirmReview(rider.deps, {
    actor: rider.actor,
    cityId: rider.cityId,
    reviewId: review.id,
    termsVersion: review.termsVersion,
    assurance: { method: "pin", proof: "step-up-proof" },
    idempotencyKey: uid("cf"),
    correlationId: null,
  });
  const execution = await getExecution(rider.deps, rider.actor, executionId);
  expect(execution.items[0]?.state).toBe("published");
  return execution.items[0]?.orderId as string;
}

async function proposeSelection(
  rider: Rider,
  requestId: string,
  bidId: string,
) {
  return createMarketplaceReview(rider.deps, {
    actor: rider.actor,
    cityId: rider.cityId,
    threadId: rider.threadId,
    request: { stage: "select", requestId, bidId },
    idempotencyKey: uid("rv"),
    correlationId: null,
  });
}

async function approve(
  rider: Rider,
  review: { id: string; termsVersion: string },
): Promise<string> {
  const { executionId } = await confirmReview(rider.deps, {
    actor: rider.actor,
    cityId: rider.cityId,
    reviewId: review.id,
    termsVersion: review.termsVersion,
    assurance: { method: "pin", proof: "step-up-proof" },
    idempotencyKey: uid("cf"),
    correlationId: null,
  });
  return executionId;
}

async function moneyOutcomes(requestId: string) {
  const holds = await testDb().mpCommissionHold.findMany({
    where: { requestRef: requestId },
  });
  const fundings = await testDb().mpRiderReservation.findMany({
    where: { requestId },
  });
  return { holds, fundings };
}

async function marketplaceCity(
  options: { revisionCooldownSec?: number } = {},
): Promise<string> {
  const cityId = contractCityId();
  await seedMarketplaceCity(testDb(), cityId, options);
  return cityId;
}

async function awardCount(requestId: string): Promise<number> {
  const rows = await testDb().$queryRawUnsafe<{ count: bigint }[]>(
    "SELECT count(*)::bigint AS count FROM mp.awards WHERE request_id = $1::uuid",
    requestId,
  );
  return Number(rows[0]?.count ?? 0n);
}

async function requestState(rider: Party, requestId: string): Promise<string> {
  const snapshot = await rideCall(rider, "GET", `/v1/mp/requests/${requestId}`);
  expectStatus(snapshot, 200);
  return (snapshot.json.request as { state: string }).state;
}

async function driverIn(cityId: string): Promise<Party> {
  const driver: Party = {
    actor: { id: randomUUID(), role: "driver" },
    cityId,
  };
  // The commission hold is reserved from the driver's wallet at bid time.
  await fundWallet(testDb(), driver.actor.id, 2_000_000);
  await parkDriver(driver);
  return driver;
}

// ---------------------------------------------------------------------------

describe("Ask → ride-service with signing enabled", () => {
  it("ride-service refuses an unsigned or wrongly-signed identity", async () => {
    const cityId = await marketplaceCity();
    const actor = randomUUID();
    const unsigned = await fetch(`${ride.baseUrl}/v1/mp/quote?service=ride`, {
      headers: {
        "x-auth-user-id": actor,
        "x-auth-user-role": "rider",
        "x-auth-city-id": cityId,
      },
    });
    expect(unsigned.status).toBe(401);
    const wrongKey = await fetch(`${ride.baseUrl}/v1/mp/quote?service=ride`, {
      headers: delegatedIdentityHeaders(
        ["not-the-ride-service-key-at-all-000000"],
        { userId: actor, role: "rider", cityId },
        new Date(),
      ),
    });
    expect(wrongKey.status).toBe(401);
  });

  it("quote → publish → select: one award, one commission capture, one funding", async () => {
    const cityId = await marketplaceCity();
    const rider = await riderIn(cityId);
    const driver = await driverIn(cityId);

    const requestId = await publish(rider);
    // Publishing awarded nothing.
    expect(
      (await rideCall(rider, "GET", `/v1/mp/requests/${requestId}/award`))
        .status,
    ).toBe(404);

    const bidId = await bid(driver, requestId, 90_000);
    const review = await proposeSelection(rider, requestId, bidId);
    expect(review.marketplace?.price).toEqual({
      amountMinor: 90_000,
      currency: "NGN",
    });
    expect(review.marketplace?.selection?.commission.amount).toBeNull();

    const executionId = await approve(rider, review);
    const execution = await getExecution(rider.deps, rider.actor, executionId);
    expect(["confirmed", "processing"]).toContain(execution.status);
    const award = await rideCall(
      rider,
      "GET",
      `/v1/mp/requests/${requestId}/award`,
    );
    expectStatus(award, 200);
    expect(award.json.bidId).toBe(bidId);
    expect(execution.items[0]?.supplierRef).toBe(award.json.awardId);
    // The commission the driver pays is the server's number, shown on its own.
    expect(execution.items[0]?.commission).toEqual(award.json.commissionMinor);
    expect(rider.selectRequests).toHaveLength(1);

    // Exactly one funding and one commission outcome.
    expect(await awardCount(requestId)).toBe(1);
    const outcomes = await moneyOutcomes(requestId);
    expect(outcomes.holds).toHaveLength(1);
    expect(outcomes.holds[0]).toMatchObject({
      state: "captured",
      awardRef: award.json.awardId,
    });
    expect(Number(outcomes.holds[0]?.amountMinor)).toBe(9_000);
    expect(outcomes.fundings).toHaveLength(1);
    expect(outcomes.fundings[0]?.awardId).toBe(award.json.awardId);
    expect(Number(outcomes.fundings[0]?.amountMinor)).toBe(90_000);
  });

  it("a changed offer is never selected: the rider gets the fresh terms", async () => {
    const cityId = await marketplaceCity({ revisionCooldownSec: 1 });
    const rider = await riderIn(cityId);
    const driver = await driverIn(cityId);
    const requestId = await publish(rider);
    const bidId = await bid(driver, requestId, 90_000);
    const review = await proposeSelection(rider, requestId, bidId);

    // The driver re-prices after the rider reviewed the offer.
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expectStatus(
      await rideCall(
        driver,
        "POST",
        `/v1/mp/bids/${bidId}/revise`,
        {
          amountMinor: { amountMinor: 95_000, currency: "NGN" },
          expectedVersion: 1,
        },
        { "idempotency-key": `revise-${randomUUID()}` },
      ),
      200,
    );

    let thrown: unknown;
    try {
      await approve(rider, review);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TermsChangedError);
    const fresh = (thrown as TermsChangedError).review;
    expect(fresh.marketplace?.price.amountMinor).toBe(95_000);
    // Nothing was sent, awarded or captured on the stale terms.
    expect(rider.selectRequests).toHaveLength(0);
    expect(await awardCount(requestId)).toBe(0);

    await approve(rider, fresh);
    expect(await awardCount(requestId)).toBe(1);
    const outcomes = await moneyOutcomes(requestId);
    expect(outcomes.holds.map((h) => h.state)).toEqual(["captured"]);
    expect(Number(outcomes.holds[0]?.amountMinor)).toBe(9_500);
    expect(outcomes.fundings).toHaveLength(1);
  }, 60_000);

  it("a lost selection response is reconciled — one award, one commission, one funding", async () => {
    const cityId = await marketplaceCity();
    const rider = await riderIn(cityId);
    const driver = await driverIn(cityId);
    const requestId = await publish(rider);
    const bidId = await bid(driver, requestId, 90_000);
    const review = await proposeSelection(rider, requestId, bidId);

    // ride-service commits the award, but its answer is lost and the
    // immediate award read fails too: the outcome is genuinely unknown.
    rider.loseNextSelectResponse = true;
    rider.failNextAwardQueries = 1;
    const executionId = await approve(rider, review);
    const pending = await getExecution(rider.deps, rider.actor, executionId);
    expect(pending.status).toBe("processing");
    expect(pending.items[0]?.state).toBe("unknown_reconciling");
    expect(pending.marketplace?.intent?.status).toBe("pending");
    // It really is awarded upstream.
    expect(await awardCount(requestId)).toBe(1);

    // The retry reconciles THE SAME execution: it queries, finds the award,
    // and never sends a second selection.
    await reconcileMarketplaceExecution(rider.deps, {
      actor: rider.actor,
      cityId,
      executionId,
      correlationId: null,
    });
    const settled = await getExecution(rider.deps, rider.actor, executionId);
    expect(settled.status).toBe("confirmed");
    expect(settled.items[0]?.state).toBe("driver_confirmed");
    expect(rider.selectRequests).toHaveLength(1);
    expect(await awardCount(requestId)).toBe(1);
    const outcomes = await moneyOutcomes(requestId);
    expect(outcomes.holds.map((h) => h.state)).toEqual(["captured"]);
    expect(outcomes.fundings).toHaveLength(1);
  });

  it("refuses another user's request and another city's session", async () => {
    const cityId = await marketplaceCity();
    const owner = await riderIn(cityId);
    const driver = await driverIn(cityId);
    const requestId = await publish(owner);
    const bidId = await bid(driver, requestId, 90_000);

    // Another rider in the same city: ride-service does not disclose it.
    const stranger = await riderIn(cityId);
    await expect(
      proposeSelection(stranger, requestId, bidId),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(
      (
        await rideCall(
          stranger,
          "POST",
          `/v1/mp/requests/${requestId}/select`,
          {
            bidId,
            requestVersion: 1,
            bidVersion: 1,
          },
          { "idempotency-key": `sel-${randomUUID()}` },
        )
      ).status,
    ).toBe(404);

    // The owner, from a session in another city: refused before any selection.
    const otherCity = await marketplaceCity();
    const elsewhere = await riderIn(otherCity, owner.actor);
    await expect(
      proposeSelection(elsewhere, requestId, bidId),
    ).rejects.toMatchObject({
      code: "forbidden",
      details: { reason: "city_mismatch" },
    });
    const review = await proposeSelection(owner, requestId, bidId);
    await expect(
      confirmReview(elsewhere.deps, {
        actor: owner.actor,
        cityId: otherCity,
        reviewId: review.id,
        termsVersion: review.termsVersion,
        assurance: { method: "pin", proof: "p" },
        idempotencyKey: uid("cf"),
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(owner.selectRequests).toHaveLength(0);
    expect(elsewhere.selectRequests).toHaveLength(0);
    expect(await awardCount(requestId)).toBe(0);
  });

  it("cancels only what the assistant published, and a closed request spends no grant", async () => {
    const cityId = await marketplaceCity();
    const rider = await riderIn(cityId);
    const driver = await driverIn(cityId);
    const requestId = await publish(rider);
    const bidId = await bid(driver, requestId, 90_000);
    const review = await proposeSelection(rider, requestId, bidId);

    const cancelled = await cancelMarketplaceRequest(rider.deps, {
      actor: rider.actor,
      cityId,
      requestId,
      assurance: { method: "pin", proof: "step-up-proof" },
      idempotencyKey: uid("cancel"),
      correlationId: null,
    });
    expect(cancelled.state).toBe("cancelled");
    expect(await requestState(rider, requestId)).toBe("cancelled");

    // The selection reviewed before the cancel can no longer run: refused
    // before any grant is spent, with the conventional flow to go to.
    await expect(approve(rider, review)).rejects.toMatchObject({
      code: "request_closed",
      details: { conventionalFlow: `ubi://marketplace/requests/${requestId}` },
    });
    expect(rider.selectRequests).toHaveLength(0);
    expect(await awardCount(requestId)).toBe(0);
    expect(
      await testDb().actionGrant.count({
        where: { actorId: rider.actor.id, consumedAt: { not: null } },
      }),
    ).toBe(0);

    // A request the rider published themselves is beyond the assistant.
    const quote = await rideCall(
      rider,
      "GET",
      `/v1/mp/quote?service=ride&vehicleClass=go&pickupLat=${PICKUP.lat}&pickupLng=${PICKUP.lng}&dropoffLat=${DROPOFF.lat}&dropoffLng=${DROPOFF.lng}`,
    );
    expectStatus(quote, 200);
    const own = await rideCall(
      rider,
      "POST",
      "/v1/mp/requests",
      {
        quoteId: quote.json.quoteId,
        requestedFareMinor: quote.json.suggestedFareMinor,
        paymentMethodId: "wallet",
      },
      { "idempotency-key": `pub-${randomUUID()}` },
    );
    expectStatus(own, 201);
    const ownId = own.json.requestId as string;
    await expect(
      cancelMarketplaceRequest(rider.deps, {
        actor: rider.actor,
        cityId,
        requestId: ownId,
        assurance: { method: "pin", proof: "p" },
        idempotencyKey: uid("cancel"),
        correlationId: null,
      }),
    ).rejects.toMatchObject({
      details: { reason: "not_published_by_assistant" },
    });
    expect(await requestState(rider, ownId)).toBe("open");
  });
});
