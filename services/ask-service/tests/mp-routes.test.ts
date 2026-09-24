/**
 * The AI marketplace stages over the served HTTP routes (`/v1/ask/*`), the way
 * the rider app reaches them through the gateway: quote, a structured review,
 * the explicit confirm (with the echoed persisted scope/revision), the
 * execution status and its reconcile — each with its idempotency key and the
 * canonical error shapes the client branches on.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/index";
import {
  closeTestDb,
  FakeMarketplacePort,
  makeDeps,
  mpOffer,
  mpQuote,
  mpRequest,
  rider,
  seedCity,
  testDb,
  uid,
  type TestDeps,
} from "./helpers";

import type { Actor } from "../src/ops/types";

let cityId: string;
let actor: Actor;
let deps: TestDeps;
let marketplace: FakeMarketplacePort;

beforeAll(async () => {
  cityId = await seedCity(testDb(), { aiMarketplace: true });
  actor = rider();
  marketplace = new FakeMarketplacePort();
  deps = makeDeps(testDb(), { marketplace });
});

afterAll(async () => {
  await closeTestDb();
});

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-user-id": actor.id,
    "x-user-role": actor.role,
    "x-auth-city-id": cityId,
    ...extra,
  };
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await createApp(deps).request(path, {
    method,
    headers: headers(extra),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>,
  };
}

async function thread(): Promise<string> {
  const opened = await call("POST", "/v1/ask/threads", { source: "home" });
  expect(opened.status).toBe(201);
  return opened.json.id as string;
}

function seedOffer(price = 250_000): { requestId: string; bidId: string } {
  const request = mpRequest({ requesterId: actor.id, cityId, revision: 1 });
  const bidId = uid("bid");
  marketplace.seedRequest(request);
  marketplace.setOffers(request.requestId, [
    mpOffer({
      bidId,
      requestRevision: 1,
      amountMinor: price,
      totalMinor: price,
    }),
  ]);
  return { requestId: request.requestId, bidId };
}

describe("the marketplace stages over /v1/ask", () => {
  it("quotes with the server's Money, and commits nothing", async () => {
    marketplace.setQuote(mpQuote({ cityId, vehicleClass: "go" }));
    const quote = await call("POST", "/v1/ask/mp/quotes", {
      service: "ride",
      vehicleClass: "go",
      pickup: { lat: 6.5, lng: 3.35 },
      dropoff: { lat: 6.45, lng: 3.4 },
    });
    expect(quote.status).toBe(200);
    expect(quote.json).toMatchObject({
      suggested: { amountMinor: 200_000, currency: "NGN" },
      minimum: { amountMinor: 150_000, currency: "NGN" },
      maximum: { amountMinor: 400_000, currency: "NGN" },
    });
  });

  it("review → confirm (echoing the persisted scope) → execution status", async () => {
    const threadId = await thread();
    const { requestId, bidId } = seedOffer();
    const key = uid("rv");
    const created = await call(
      "POST",
      "/v1/ask/mp/reviews",
      { stage: "select", threadId, requestId, bidId },
      { "idempotency-key": key },
    );
    expect(created.status).toBe(201);
    const review = created.json as {
      id: string;
      termsVersion: string;
      marketplace: {
        scope: { fingerprint: string };
        selection: { requestRevision: number; bidId: string };
      };
    };
    // A replay of the create is the same review.
    const replay = await call(
      "POST",
      "/v1/ask/mp/reviews",
      { stage: "select", threadId, requestId, bidId },
      { "idempotency-key": key },
    );
    expect(replay.json.id).toBe(review.id);

    const confirmed = await call(
      "POST",
      `/v1/ask/reviews/${review.id}/confirm`,
      {
        termsVersion: review.termsVersion,
        assurance: { method: "pin", proof: "step-up-proof" },
        expect: {
          scopeFingerprint: review.marketplace.scope.fingerprint,
          requestRevision: review.marketplace.selection.requestRevision,
          bidId: review.marketplace.selection.bidId,
        },
      },
      { "idempotency-key": uid("cf") },
    );
    expect(confirmed.status).toBe(202);
    const executionId = confirmed.json.executionId as string;

    const status = await call("GET", `/v1/ask/executions/${executionId}`);
    expect(status.status).toBe(200);
    expect(status.json).toMatchObject({
      status: "confirmed",
      items: [{ kind: "mp_selection", state: "driver_confirmed" }],
      marketplace: { stage: "select", requestId, reconcilable: false },
    });
  });

  it("answers a changed offer with 409 and the fresh review", async () => {
    const threadId = await thread();
    const { requestId, bidId } = seedOffer();
    const created = await call(
      "POST",
      "/v1/ask/mp/reviews",
      { stage: "select", threadId, requestId, bidId },
      { "idempotency-key": uid("rv") },
    );
    marketplace.setOffers(requestId, [
      mpOffer({
        bidId,
        requestRevision: 1,
        amountMinor: 275_000,
        totalMinor: 275_000,
      }),
    ]);
    const confirmed = await call(
      "POST",
      `/v1/ask/reviews/${created.json.id as string}/confirm`,
      {
        termsVersion: created.json.termsVersion,
        assurance: { method: "pin", proof: "p" },
      },
      { "idempotency-key": uid("cf") },
    );
    expect(confirmed.status).toBe(409);
    expect(confirmed.json).toMatchObject({
      kind: "marketplace",
      status: "awaiting_confirmation",
      total: { amountMinor: 275_000, currency: "NGN" },
    });
  });

  it("hands off to the conventional flow when the offer is gone", async () => {
    const threadId = await thread();
    const { requestId, bidId } = seedOffer();
    const created = await call(
      "POST",
      "/v1/ask/mp/reviews",
      { stage: "select", threadId, requestId, bidId },
      { "idempotency-key": uid("rv") },
    );
    marketplace.setOffers(requestId, [
      mpOffer({ bidId, requestRevision: 1, withdrawn: true }),
    ]);
    const confirmed = await call(
      "POST",
      `/v1/ask/reviews/${created.json.id as string}/confirm`,
      {
        termsVersion: created.json.termsVersion,
        assurance: { method: "pin", proof: "p" },
      },
      { "idempotency-key": uid("cf") },
    );
    expect(confirmed.status).toBe(409);
    expect(confirmed.json).toMatchObject({
      code: "conflict",
      details: {
        reason: "offer_withdrawn",
        conventionalFlow: `ubi://marketplace/requests/${requestId}`,
      },
    });
  });

  it("requires an idempotency key on every state POST", async () => {
    const threadId = await thread();
    const { requestId, bidId } = seedOffer();
    const noKey = await call("POST", "/v1/ask/mp/reviews", {
      stage: "select",
      threadId,
      requestId,
      bidId,
    });
    expect(noKey.status).toBe(422);
    const reconcile = await call(
      "POST",
      `/v1/ask/executions/${uid("exec")}/reconcile`,
    );
    expect(reconcile.status).toBe(422);
  });

  it("reconciles a pending execution to its award", async () => {
    const threadId = await thread();
    const { requestId, bidId } = seedOffer();
    const created = await call(
      "POST",
      "/v1/ask/mp/reviews",
      { stage: "select", threadId, requestId, bidId },
      { "idempotency-key": uid("rv") },
    );
    marketplace.delayNextSelect = true;
    const confirmed = await call(
      "POST",
      `/v1/ask/reviews/${created.json.id as string}/confirm`,
      {
        termsVersion: created.json.termsVersion,
        assurance: { method: "pin", proof: "p" },
      },
      { "idempotency-key": uid("cf") },
    );
    const executionId = confirmed.json.executionId as string;
    const pending = await call("GET", `/v1/ask/executions/${executionId}`);
    expect(pending.json).toMatchObject({
      status: "processing",
      marketplace: { reconcilable: true },
    });

    marketplace.landDelayedAwards();
    const settled = await call(
      "POST",
      `/v1/ask/executions/${executionId}/reconcile`,
      undefined,
      { "idempotency-key": uid("rc") },
    );
    expect(settled.status).toBe(200);
    expect(settled.json).toMatchObject({
      status: "confirmed",
      items: [{ state: "driver_confirmed" }],
    });
  });

  it("does not let another user read or reconcile the execution", async () => {
    const threadId = await thread();
    const { requestId, bidId } = seedOffer();
    const created = await call(
      "POST",
      "/v1/ask/mp/reviews",
      { stage: "select", threadId, requestId, bidId },
      { "idempotency-key": uid("rv") },
    );
    const confirmed = await call(
      "POST",
      `/v1/ask/reviews/${created.json.id as string}/confirm`,
      {
        termsVersion: created.json.termsVersion,
        assurance: { method: "pin", proof: "p" },
      },
      { "idempotency-key": uid("cf") },
    );
    const executionId = confirmed.json.executionId as string;
    const intruder = { "x-user-id": uid("rider") };
    expect(
      (
        await call(
          "GET",
          `/v1/ask/executions/${executionId}`,
          undefined,
          intruder,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          "POST",
          `/v1/ask/executions/${executionId}/reconcile`,
          undefined,
          { ...intruder, "idempotency-key": uid("rc") },
        )
      ).status,
    ).toBe(404);
  });
});
