/**
 * The grant port against the REAL user-service (round-2 follow-up: the port
 * did not match user-service's mounted /internal/grants API — path, body
 * shape, where the actor travels, the response envelope and the idempotency
 * key's form).
 *
 * user-service is started as its own process — its real `src/index.ts`, the
 * real route mount (`app.route("/", createGrantRoutes(...))`), the real
 * service-key check and the real mint, including its mandate binding — against
 * the same Postgres these tests use. The port is the PRODUCTION adapter
 * (`createHttpGrantPort`) on its DEFAULT path; nothing here writes a grant row
 * or answers a response by hand. user-service's own tests
 * (services/user-service/tests/mandates/grants.test.ts) pin the same contract
 * from its side.
 *
 * Covered: an attended mint and its idempotent replay; the whole travel
 * confirm and the whole marketplace selection confirm with user-service as the
 * minting authority; a mandate-bound mint (and user-service refusing a paused
 * mandate and another user's mandate); a replay under a reused key that
 * answers other terms; the service-key guard; and the local refusals that
 * never leave the service (no key, a broken mandate binding, an over-long
 * terms version).
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { authorizeNegotiation, fingerprintScope } from "../src/ops/marketplace";
import { confirmReview } from "../src/ops/reviews";
import { getExecution } from "../src/ops/executions";
import { handleMessage, openThread } from "../src/ops/threads";
import {
  createHttpGrantPort,
  wireGrantIdempotencyKey,
  type GrantMintRequest,
  type GrantPort,
} from "../src/ports/grant-port";
import {
  closeTestDb,
  FakeMarketplacePort,
  FakeTravelPort,
  makeDeps,
  mpOffer,
  mpRequest,
  offer,
  rider,
  seedCity,
  TEST_DATABASE_URL,
  testDb,
  uid,
} from "./helpers";
import { spawnService, type SpawnedService } from "./spawn";

import type { Actor } from "../src/ops/types";

const USER_SERVICE_DIR = path.resolve(__dirname, "../../user-service");
const SERVICE_KEY = "ask-grant-port-integration-service-key-0001";
const REDIS_URL = process.env.ASK_TEST_REDIS_URL ?? "redis://127.0.0.1:6379/4";

let userService: SpawnedService;
let port: GrantPort;
let cityId: string;
let actor: Actor;

beforeAll(async () => {
  userService = await spawnService({
    name: "user-service",
    command: path.join(USER_SERVICE_DIR, "node_modules", ".bin", "tsx"),
    args: ["src/index.ts"],
    cwd: USER_SERVICE_DIR,
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL,
      JWT_SECRET: "ask-grant-port-test-client-facing-secret-0001",
      UBI_IDENTITY_SECRET: "ask-grant-port-test-internal-identity-0001",
      AI_GRANTS_SERVICE_KEY: SERVICE_KEY,
      // The identity slice's policy client is built at boot; the grant
      // surface under test never calls it.
      CONFIG_SERVICE_URL: "http://127.0.0.1:9",
    },
    healthPath: "/health",
    readyTimeoutMs: 80_000,
  });
  port = createHttpGrantPort({
    baseUrl: userService.baseUrl,
    serviceKey: SERVICE_KEY,
  });
}, 90_000);

afterAll(async () => {
  await userService?.stop();
  await closeTestDb();
});

beforeEach(async () => {
  cityId = await seedCity(testDb(), { aiMarketplace: true });
  actor = rider();
});

function attended(overrides: Partial<GrantMintRequest> = {}): GrantMintRequest {
  return {
    actorId: actor.id,
    action: "ask.execute",
    resourceRef: uid("rvw"),
    termsVersion: "ask.review.v1:0123456789abcdef0123456789abcdef01234567",
    totalMinor: 4_500_000,
    currency: "NGN",
    assurance: "pin",
    assuranceProof: "step-up-proof",
    // A realistic scoped key: longer than user-service's 64-character limit,
    // which the port must digest rather than send raw.
    idempotencyKey: `ask.review.confirm:${actor.id}:${uid("client-key")}`,
    expiresAt: new Date(Date.now() + 5 * 60_000),
    cityId,
    ...overrides,
  };
}

async function seedMandate(userId: string, status = "active"): Promise<string> {
  const id = uid("mnd");
  await testDb().mandate.create({
    data: {
      id,
      userId,
      action: "marketplace.ride.select",
      title: "Commute",
      passengers: "self_only",
      categories: ["go"],
      providers: [],
      perRunCapMinor: BigInt(300_000),
      periodCapMinor: BigInt(3_000_000),
      periodRuns: 20,
      currency: "NGN",
      constraints: [] as never,
      status,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  return id;
}

describe("the production grant port against user-service's mounted route", () => {
  it("mints an attended grant, persisted by user-service exactly as asked", async () => {
    const request = attended();
    expect(request.idempotencyKey.length).toBeGreaterThan(64);

    const minted = await port.mint(request);

    const row = await testDb().actionGrant.findUnique({
      where: { id: minted.grantId },
    });
    expect(row).toMatchObject({
      actorId: actor.id,
      action: "ask.execute",
      resourceRef: request.resourceRef,
      termsVersion: request.termsVersion,
      currency: "NGN",
      assurance: "pin",
      mandateId: null,
      consumedAt: null,
    });
    expect(Number(row?.totalMinor)).toBe(4_500_000);
    // The key user-service stored is the port's digest of the scoped key.
    expect(row?.idempotencyKey).toBe(
      wireGrantIdempotencyKey(request.idempotencyKey),
    );
    expect(minted.assurance).toBe("pin");
  });

  it("replays the original grant for the same key — never a second authorisation", async () => {
    const request = attended();
    const first = await port.mint(request);
    const second = await port.mint(request);
    expect(second.grantId).toBe(first.grantId);
    expect(
      await testDb().actionGrant.count({ where: { actorId: actor.id } }),
    ).toBe(1);
  });

  it("refuses a replay under a reused key that answers OTHER terms", async () => {
    const request = attended();
    await port.mint(request);
    // user-service returns the ORIGINAL grant for the key; the port must not
    // act on authority for terms the user did not just confirm.
    await expect(
      port.mint({ ...request, totalMinor: 1 }),
    ).rejects.toMatchObject({
      code: "conflict",
      details: { reason: "grant_terms_mismatch" },
    });
  });

  it("mints a mandate grant bound to the actor's ACTIVE mandate", async () => {
    const mandateId = await seedMandate(actor.id);
    const minted = await port.mint(
      attended({
        action: "mp.negotiate",
        totalMinor: 250_000,
        assurance: "mandate",
        assuranceProof: `mandate:${mandateId}`,
        mandateId,
      }),
    );
    const row = await testDb().actionGrant.findUnique({
      where: { id: minted.grantId },
    });
    expect(row?.assurance).toBe("mandate");
    expect(row?.mandateId).toBe(mandateId);
  });

  it("is refused by user-service for a paused mandate or another user's mandate", async () => {
    const paused = await seedMandate(actor.id, "paused");
    await expect(
      port.mint(
        attended({
          action: "mp.negotiate",
          totalMinor: 250_000,
          assurance: "mandate",
          mandateId: paused,
        }),
      ),
    ).rejects.toMatchObject({
      code: "forbidden",
      details: { status: 403, upstreamReason: "mandate_paused" },
    });

    const strangers = await seedMandate(rider().id);
    await expect(
      port.mint(
        attended({
          action: "mp.negotiate",
          totalMinor: 250_000,
          assurance: "mandate",
          mandateId: strangers,
        }),
      ),
    ).rejects.toMatchObject({
      code: "forbidden",
      details: { upstreamReason: "mandate_not_found" },
    });
    expect(
      await testDb().actionGrant.count({ where: { actorId: actor.id } }),
    ).toBe(0);
  });

  it("maps a refused service key to an outage, never to the user's session", async () => {
    const wrongKey = createHttpGrantPort({
      baseUrl: userService.baseUrl,
      serviceKey: "not-the-configured-grants-service-key-000",
    });
    await expect(wrongKey.mint(attended())).rejects.toMatchObject({
      code: "service_unavailable",
      details: { reason: "grant_service_auth_refused", status: 401 },
    });
  });

  it("refuses locally — nothing sent — without a key, with a broken binding, or an over-long terms version", async () => {
    const noKey = createHttpGrantPort({ baseUrl: userService.baseUrl });
    await expect(noKey.mint(attended())).rejects.toMatchObject({
      details: { reason: "grant_service_key_missing" },
    });
    await expect(
      port.mint(attended({ assurance: "mandate", mandateId: undefined })),
    ).rejects.toMatchObject({ details: { reason: "mandate_binding_invalid" } });
    await expect(
      port.mint(attended({ termsVersion: "x".repeat(61) })),
    ).rejects.toMatchObject({ details: { reason: "grant_request_invalid" } });
    expect(
      await testDb().actionGrant.count({ where: { actorId: actor.id } }),
    ).toBe(0);
  });
});

describe("the Ask confirm paths with user-service as the minting authority", () => {
  it("a travel review confirm mints through user-service and consumes once", async () => {
    const travel = new FakeTravelPort();
    // Two offers: the review's own fingerprint outgrows the 60-character
    // grant terms column, which the confirm must digest, not truncate.
    const flightRef = uid("flight_offer");
    const stayRef = uid("stay_offer");
    travel.setOffer(offer({ offerRef: flightRef, priceMinor: 4_500_000 }));
    travel.setOffer(
      offer({ offerRef: stayRef, kind: "stay", priceMinor: 1_500_000 }),
    );
    const deps = makeDeps(testDb(), { travel, grants: port });
    const thread = await openThread(deps, {
      actor,
      cityId,
      source: "home",
      correlationId: null,
    });
    const turn = await handleMessage(deps, {
      actor,
      cityId,
      threadId: thread.id,
      text: `book @tool propose_transaction ${JSON.stringify({
        items: [{ offerRef: flightRef }, { offerRef: stayRef }],
        paymentMethodId: "pm_wallet",
      })}`,
      clarifications: null,
      correlationId: null,
    });
    const review = await testDb().askReview.findUniqueOrThrow({
      where: { id: turn.reviewId as string },
    });
    expect(review.termsVersion.length).toBeGreaterThan(60);

    const { executionId } = await confirmReview(deps, {
      actor,
      cityId,
      reviewId: review.id,
      termsVersion: review.termsVersion,
      assurance: { method: "pin", proof: "step-up-proof" },
      idempotencyKey: uid("confirm"),
      correlationId: null,
    });

    const execution = await getExecution(deps, actor, executionId);
    expect(execution.status).toBe("confirmed");
    const grant = await testDb().actionGrant.findFirstOrThrow({
      where: { actorId: actor.id, resourceRef: review.id },
    });
    expect(grant.termsVersion.length).toBeLessThanOrEqual(60);
    expect(grant.consumedAt).not.toBeNull();
    expect(Number(grant.totalMinor)).toBe(6_000_000);
  });

  it("a marketplace selection confirm mints a select-only grant capped at the approved price", async () => {
    const marketplace = new FakeMarketplacePort();
    const request = mpRequest({
      requesterId: actor.id,
      cityId,
      revision: 1,
    });
    const bidId = uid("bid");
    marketplace.seedRequest(request);
    marketplace.setOffers(request.requestId, [
      mpOffer({ bidId, requestRevision: 1, amountMinor: 250_000 }),
    ]);
    const deps = makeDeps(testDb(), { marketplace, grants: port });
    const thread = await openThread(deps, {
      actor,
      cityId,
      source: "home",
      correlationId: null,
    });
    const turn = await handleMessage(deps, {
      actor,
      cityId,
      threadId: thread.id,
      text: `pick it @tool mp.propose_selection ${JSON.stringify({ requestId: request.requestId, bidId })}`,
      clarifications: null,
      correlationId: null,
    });
    const review = await testDb().askReview.findUniqueOrThrow({
      where: { id: turn.reviewId as string },
    });

    const { executionId } = await confirmReview(deps, {
      actor,
      cityId,
      reviewId: review.id,
      termsVersion: review.termsVersion,
      assurance: { method: "pin", proof: "step-up-proof" },
      idempotencyKey: uid("confirm"),
      correlationId: null,
    });

    const execution = await getExecution(deps, actor, executionId);
    expect(execution.status).toBe("confirmed");
    expect(execution.items[0]?.state).toBe("driver_confirmed");
    expect(marketplace.awardsCreated).toBe(1);
    const grant = await testDb().actionGrant.findFirstOrThrow({
      where: { actorId: actor.id, action: "mp.negotiate" },
    });
    expect(Number(grant.totalMinor)).toBe(250_000);
    expect(grant.termsVersion).toBe(
      fingerprintScope({
        principalId: actor.id,
        actions: ["select"],
        service: "ride",
        cityId,
        currency: "NGN",
        maxSpendMinor: 250_000,
        vehicleClass: "go",
        quoteId: request.quoteId,
      }),
    );
    expect(grant.consumedAt).not.toBeNull();
  });

  it("an unattended negotiation mints through user-service only for an active mandate", async () => {
    const mandateId = await seedMandate(actor.id);
    const deps = makeDeps(testDb(), { grants: port });
    const scope = {
      principalId: actor.id,
      actions: ["select"] as const,
      service: "ride" as const,
      cityId,
      currency: "NGN",
      maxSpendMinor: 250_000,
      vehicleClass: "go",
      quoteId: uid("quote"),
    };
    const { grantId, unattended } = await authorizeNegotiation(deps, {
      actor,
      cityId,
      scope: { ...scope, actions: ["select"] },
      mandateId,
      idempotencyKey: uid("ik"),
    });
    expect(unattended).toBe(true);
    const row = await testDb().actionGrant.findUniqueOrThrow({
      where: { id: grantId },
    });
    expect(row.mandateId).toBe(mandateId);
    expect(row.assurance).toBe("mandate");
  });
});
