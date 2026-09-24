/**
 * The AI marketplace connected to the Ask lifecycle (recheck A01 / P01): the
 * structured proposal, the explicit confirm, the execution status and the
 * reconciliation of an ambiguous outcome — driven through the real ops, the
 * real database (reviews, grants, execution intents, ai_actions, outbox) and
 * the faithful marketplace fake. tests/grant-port-user-service.test.ts runs
 * the same confirm with the REAL user-service minting the grant.
 *
 * What it proves:
 *   - mp.propose_selection persists a STRUCTURED review: request id +
 *     revision, bid id + version, the price, the driver commission shown
 *     separately (never guessed), the offer expiry, the exact action and the
 *     server-derived scope — not free text;
 *   - the confirm re-validates it live: a re-priced / revised / withdrawn
 *     offer or a closed request never mints a grant; a changed offer returns a
 *     fresh review to confirm (409);
 *   - publishing never awards, and its grant can never select;
 *   - selecting runs under a select-only grant capped at the approved price;
 *     the request snapshot is re-checked BEFORE the single-use grant is spent;
 *   - an ambiguous outcome stays `processing` and a reconcile settles the SAME
 *     execution under the SAME key: exactly one award, one grant consumption;
 *   - cross-user and cross-city requests are refused before anything runs;
 *   - cancel reaches only a request the assistant published;
 *   - the flags stay deny-by-default.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ContractError } from "@ubi/contracts";

import {
  authorizeNegotiation,
  selectOffer,
  type MarketplaceGrantScope,
} from "../src/ops/marketplace";
import {
  cancelMarketplaceRequest,
  createMarketplaceReview,
  reconcileMarketplaceExecution,
} from "../src/ops/mp-lifecycle";
import { getExecution } from "../src/ops/executions";
import {
  confirmReview,
  getReview,
  TermsChangedError,
} from "../src/ops/reviews";
import { handleMessage, openThread } from "../src/ops/threads";
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

import type { MpOffer, MpRequest } from "../src/ports/marketplace-port";
import type { Actor } from "../src/ops/types";

const PRICE = 250_000;

let clock: Date;
let cityId: string;
let actor: Actor;

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  clock = new Date();
  cityId = await seedCity(testDb(), { aiMarketplace: true });
  actor = rider();
});

function advance(seconds: number): void {
  clock = new Date(clock.getTime() + seconds * 1000);
}

interface World {
  readonly deps: TestDeps;
  readonly mp: FakeMarketplacePort;
  readonly request: MpRequest;
  readonly bidId: string;
  readonly threadId: string;
}

async function world(
  options: { readonly city?: string; readonly owner?: Actor } = {},
): Promise<World> {
  const mp = new FakeMarketplacePort();
  mp.now = () => clock;
  const request = mpRequest({
    requesterId: (options.owner ?? actor).id,
    cityId: options.city ?? cityId,
    revision: 1,
    expiresAt: new Date(clock.getTime() + 15 * 60_000).toISOString(),
  });
  const bidId = uid("bid");
  mp.seedRequest(request);
  mp.setOffers(request.requestId, [
    mpOffer({
      bidId,
      requestRevision: 1,
      amountMinor: PRICE,
      totalMinor: PRICE,
      expiresAt: new Date(clock.getTime() + 10 * 60_000).toISOString(),
    }),
  ]);
  const deps = makeDeps(testDb(), { marketplace: mp, now: () => clock });
  const thread = await openThread(deps, {
    actor,
    cityId,
    source: "home",
    correlationId: null,
  });
  return { deps, mp, request, bidId, threadId: thread.id };
}

async function propose(w: World, bidId = w.bidId) {
  return handleMessage(w.deps, {
    actor,
    cityId,
    threadId: w.threadId,
    text: `take that one @tool mp.propose_selection ${JSON.stringify({
      requestId: w.request.requestId,
      bidId,
    })}`,
    clarifications: null,
    correlationId: null,
  });
}

async function proposedReview(w: World) {
  const turn = await propose(w);
  expect(turn.reviewId).not.toBeNull();
  return getReview(w.deps, actor, turn.reviewId as string);
}

async function confirm(
  w: World,
  review: { id: string; termsVersion: string },
  key = uid("confirm"),
  extra: { expect?: { scopeFingerprint?: string } } = {},
) {
  return confirmReview(w.deps, {
    actor,
    cityId,
    reviewId: review.id,
    termsVersion: review.termsVersion,
    assurance: { method: "pin", proof: "step-up-proof" },
    idempotencyKey: key,
    correlationId: null,
    ...extra,
  });
}

function replaceOffer(w: World, overrides: Partial<MpOffer>): void {
  w.mp.setOffers(w.request.requestId, [
    mpOffer({
      bidId: w.bidId,
      requestRevision: 1,
      amountMinor: PRICE,
      totalMinor: PRICE,
      expiresAt: new Date(clock.getTime() + 10 * 60_000).toISOString(),
      ...overrides,
    }),
  ]);
}

async function grantsOf(actorId: string) {
  return testDb().actionGrant.findMany({ where: { actorId } });
}

// ---------------------------------------------------------------------------
// The structured proposal
// ---------------------------------------------------------------------------

describe("mp.propose_selection returns a structured, persisted review", () => {
  it("persists the server-derived scope, revision, price, commission and action", async () => {
    const w = await world();
    const turn = await propose(w);

    const ready = turn.events.find((event) => event.type === "review_ready");
    expect(ready).toMatchObject({
      type: "review_ready",
      reviewKind: "marketplace",
      totals: { amountMinor: PRICE, currency: "NGN" },
    });

    const row = await testDb().askReview.findUniqueOrThrow({
      where: { id: turn.reviewId as string },
    });
    expect(row.status).toBe("awaiting_confirmation");
    expect(row.grantId).toBeNull();
    expect(row.termsVersion.length).toBeLessThanOrEqual(60);
    // Never outlives the offer it reviews.
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(
      clock.getTime() + 10 * 60_000,
    );

    const view = await getReview(w.deps, actor, row.id);
    expect(view.kind).toBe("marketplace");
    expect(view.marketplace).toMatchObject({
      stage: "select",
      action: "mp.select",
      statement: "I can't set prices or book without your OK.",
      awardsNothing: false,
      price: { amountMinor: PRICE, currency: "NGN" },
      scope: {
        actions: ["select"],
        service: "ride",
        cityId,
        // The cap IS the approved price.
        cap: { amountMinor: PRICE, currency: "NGN" },
        vehicleClass: "go",
        quoteId: w.request.quoteId,
      },
      selection: {
        requestId: w.request.requestId,
        requestRevision: 1,
        bidId: w.bidId,
        bidVersion: 1,
        bidAmount: { amountMinor: PRICE, currency: "NGN" },
        commission: {
          payer: "driver",
          addedToYourPrice: false,
          // Unknown before the award, and never computed here.
          amount: null,
        },
      },
      conventionalFlow: `ubi://marketplace/requests/${w.request.requestId}`,
    });
    // The model's words are not the proposal: no free-text-only result.
    expect(view.items[0]?.price).toEqual({
      amountMinor: PRICE,
      currency: "NGN",
    });
    // Nothing was authorised or awarded by proposing.
    expect(await grantsOf(actor.id)).toHaveLength(0);
    expect(w.mp.selectCalls).toHaveLength(0);
  });

  it("proposes nothing for another user's request, a withdrawn offer or a closed request", async () => {
    const stranger = await world({ owner: rider() });
    const turn = await propose(stranger);
    expect(turn.reviewId).toBeNull();

    const withdrawn = await world();
    replaceOffer(withdrawn, { withdrawn: true });
    expect((await propose(withdrawn)).reviewId).toBeNull();

    const closed = await world();
    closed.mp.seedRequest({ ...closed.request, state: "cancelled" });
    expect((await propose(closed)).reviewId).toBeNull();
    expect(await grantsOf(actor.id)).toHaveLength(0);
  });

  it("stays off when ai_marketplace is off (deny by default)", async () => {
    const off = await seedCity(testDb());
    const w = await world({ city: off });
    const thread = await openThread(w.deps, {
      actor,
      cityId: off,
      source: "home",
      correlationId: null,
    });
    const turn = await handleMessage(w.deps, {
      actor,
      cityId: off,
      threadId: thread.id,
      text: `@tool mp.propose_selection ${JSON.stringify({ requestId: w.request.requestId, bidId: w.bidId })}`,
      clarifications: null,
      correlationId: null,
    });
    expect(turn.reviewId).toBeNull();
    await expect(
      createMarketplaceReview(w.deps, {
        actor,
        cityId: off,
        threadId: thread.id,
        request: {
          stage: "select",
          requestId: w.request.requestId,
          bidId: w.bidId,
        },
        idempotencyKey: uid("rv"),
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "feature_disabled", status: 404 });
  });
});

// ---------------------------------------------------------------------------
// Confirm → select
// ---------------------------------------------------------------------------

describe("confirming a selection review", () => {
  it("mints a select-only grant at the approved price and awards exactly once", async () => {
    const w = await world();
    const review = await proposedReview(w);
    const key = uid("confirm");

    const { executionId } = await confirm(w, review, key);

    const execution = await getExecution(w.deps, actor, executionId);
    expect(execution.status).toBe("confirmed");
    expect(execution.items).toHaveLength(1);
    expect(execution.items[0]).toMatchObject({
      kind: "mp_selection",
      state: "driver_confirmed",
      orderId: w.request.requestId,
      fare: { amountMinor: PRICE, currency: "NGN" },
      // The driver's commission, from the award, shown on its own.
      commission: { amountMinor: 25_000, currency: "NGN" },
    });
    expect(execution.marketplace).toMatchObject({
      stage: "select",
      requestId: w.request.requestId,
      intent: { status: "awarded", attempts: 1 },
      reconcilable: false,
    });
    expect(w.mp.awardsCreated).toBe(1);
    expect(w.mp.selectCalls).toHaveLength(1);
    const grants = await grantsOf(actor.id);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ action: "mp.negotiate" });
    expect(Number(grants[0]?.totalMinor)).toBe(PRICE);
    expect(grants[0]?.consumedAt).not.toBeNull();

    // A replayed confirm is the same execution: nothing new is minted or sent.
    const replay = await confirm(w, review, key);
    expect(replay.executionId).toBe(executionId);
    expect(await grantsOf(actor.id)).toHaveLength(1);
    expect(w.mp.selectCalls).toHaveLength(1);
  });

  it("returns a FRESH review when the offer re-priced, and mints nothing", async () => {
    const w = await world();
    const review = await proposedReview(w);
    replaceOffer(w, { amountMinor: 260_000, totalMinor: 260_000 });

    let thrown: unknown;
    try {
      await confirm(w, review);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TermsChangedError);
    const fresh = (thrown as TermsChangedError).review;
    expect(fresh.id).not.toBe(review.id);
    expect(fresh.marketplace?.price.amountMinor).toBe(260_000);
    expect(
      (await testDb().askReview.findUniqueOrThrow({ where: { id: review.id } }))
        .status,
    ).toBe("superseded");
    expect(await grantsOf(actor.id)).toHaveLength(0);
    expect(w.mp.selectCalls).toHaveLength(0);

    // The fresh review confirms at the new price.
    const { executionId } = await confirm(w, fresh);
    expect((await getExecution(w.deps, actor, executionId)).status).toBe(
      "confirmed",
    );
    expect(w.mp.awardsCreated).toBe(1);
  });

  it("treats a request revision or a bid edit as a changed offer", async () => {
    const w = await world();
    const review = await proposedReview(w);
    replaceOffer(w, { bidVersion: 2 });
    await expect(confirm(w, review)).rejects.toBeInstanceOf(TermsChangedError);

    const revised = await world();
    const before = await proposedReview(revised);
    revised.mp.seedRequest({ ...revised.request, revision: 2 });
    revised.mp.setOffers(revised.request.requestId, [
      mpOffer({
        bidId: revised.bidId,
        requestRevision: 2,
        amountMinor: PRICE,
        totalMinor: PRICE,
        expiresAt: new Date(clock.getTime() + 10 * 60_000).toISOString(),
      }),
    ]);
    await expect(confirm(revised, before)).rejects.toBeInstanceOf(
      TermsChangedError,
    );
    expect(await grantsOf(actor.id)).toHaveLength(0);
  });

  it("refuses a confirm whose echoed scope is not the persisted one", async () => {
    const w = await world();
    const review = await proposedReview(w);
    await expect(
      confirm(w, review, uid("confirm"), {
        expect: { scopeFingerprint: "mp.scope.v2:forged" },
      }),
    ).rejects.toBeInstanceOf(TermsChangedError);
    expect(await grantsOf(actor.id)).toHaveLength(0);
  });

  it("hands off to the conventional flow when the offer is gone — nothing minted", async () => {
    const w = await world();
    const review = await proposedReview(w);
    replaceOffer(w, { withdrawn: true });
    await expect(confirm(w, review)).rejects.toMatchObject({
      code: "conflict",
      details: {
        reason: "offer_withdrawn",
        conventionalFlow: `ubi://marketplace/requests/${w.request.requestId}`,
      },
    });

    const closed = await world();
    const closedReview = await proposedReview(closed);
    closed.mp.seedRequest({ ...closed.request, state: "expired" });
    await expect(confirm(closed, closedReview)).rejects.toMatchObject({
      code: "request_closed",
      details: { conventionalFlow: expect.stringContaining("ubi://") },
    });
    expect(await grantsOf(actor.id)).toHaveLength(0);
  });

  it("is refused for another user's review and from another city", async () => {
    const w = await world();
    const review = await proposedReview(w);
    await expect(
      confirmReview(w.deps, {
        actor: rider(),
        cityId,
        reviewId: review.id,
        termsVersion: review.termsVersion,
        assurance: { method: "pin", proof: "p" },
        idempotencyKey: uid("confirm"),
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    const otherCity = await seedCity(testDb(), { aiMarketplace: true });
    await expect(
      confirmReview(w.deps, {
        actor,
        cityId: otherCity,
        reviewId: review.id,
        termsVersion: review.termsVersion,
        assurance: { method: "pin", proof: "p" },
        idempotencyKey: uid("confirm"),
        correlationId: null,
      }),
    ).rejects.toMatchObject({
      code: "forbidden",
      details: { reason: "city_mismatch" },
    });
    expect(await grantsOf(actor.id)).toHaveLength(0);
    expect(w.mp.selectCalls).toHaveLength(0);
  });

  it("stops at the kill switch: ai_transactions off refuses the confirm", async () => {
    const w = await world();
    const review = await proposedReview(w);
    await testDb().flagRule.updateMany({
      where: { cityId, flagKey: "ai_transactions" },
      data: { enabled: false },
    });
    await expect(confirm(w, review)).rejects.toMatchObject({
      code: "feature_disabled",
    });
    expect(await grantsOf(actor.id)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The request snapshot is re-checked BEFORE the grant is spent
// ---------------------------------------------------------------------------

describe("selectOffer refuses an unselectable request before spending the grant", () => {
  async function attendedGrant(w: World): Promise<{
    grantId: string;
    scope: MarketplaceGrantScope;
  }> {
    const scope: MarketplaceGrantScope = {
      principalId: actor.id,
      actions: ["select"],
      service: "ride",
      cityId,
      currency: "NGN",
      maxSpendMinor: PRICE,
      vehicleClass: "go",
      quoteId: w.request.quoteId,
    };
    const { grantId } = await authorizeNegotiation(w.deps, {
      actor,
      cityId,
      scope,
      assurance: { method: "pin", proof: "p" },
      idempotencyKey: uid("ik"),
    });
    return { grantId, scope };
  }

  it.each([
    ["cancelled", "request_closed"],
    ["expired", "request_closed"],
    ["awarded", "request_closed"],
    ["award_pending", "award_unresolved"],
  ])("a %s request", async (state, code) => {
    const w = await world();
    const { grantId, scope } = await attendedGrant(w);
    w.mp.seedRequest({ ...w.request, state });
    await expect(
      selectOffer(w.deps, {
        actor,
        cityId,
        grantId,
        scope,
        requestId: w.request.requestId,
        bidId: w.bidId,
        expectedRequestRevision: 1,
        expectedFareMinor: PRICE,
      }),
    ).rejects.toMatchObject({ code });
    const grant = await testDb().actionGrant.findUniqueOrThrow({
      where: { id: grantId },
    });
    // The single-use grant is still whole; no intent, no call, no award.
    expect(grant.consumedAt).toBeNull();
    expect(await testDb().askMpExecution.count({ where: { grantId } })).toBe(0);
    expect(w.mp.selectCalls).toHaveLength(0);
  });

  it("a request that expired by the clock, or already carries an award", async () => {
    const w = await world();
    const { grantId, scope } = await attendedGrant(w);
    w.mp.seedRequest({
      ...w.request,
      expiresAt: new Date(clock.getTime() - 1_000).toISOString(),
    });
    await expect(
      selectOffer(w.deps, {
        actor,
        cityId,
        grantId,
        scope,
        requestId: w.request.requestId,
        bidId: w.bidId,
        expectedRequestRevision: 1,
        expectedFareMinor: PRICE,
      }),
    ).rejects.toMatchObject({ code: "request_closed" });
    expect(
      (await testDb().actionGrant.findUniqueOrThrow({ where: { id: grantId } }))
        .consumedAt,
    ).toBeNull();
  });

  it("an offer placed on an earlier revision", async () => {
    const w = await world();
    const { grantId, scope } = await attendedGrant(w);
    w.mp.seedRequest({ ...w.request, revision: 2 });
    await expect(
      selectOffer(w.deps, {
        actor,
        cityId,
        grantId,
        scope,
        requestId: w.request.requestId,
        bidId: w.bidId,
        expectedRequestRevision: 1,
        expectedFareMinor: PRICE,
      }),
    ).rejects.toMatchObject({
      code: "version_conflict",
      details: { reason: "offer_revision_stale" },
    });
    expect(
      (await testDb().actionGrant.findUniqueOrThrow({ where: { id: grantId } }))
        .consumedAt,
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Ambiguous outcomes and reconciliation
// ---------------------------------------------------------------------------

describe("execution status and reconciliation", () => {
  it("a delayed award stays processing, then reconciles to ONE award", async () => {
    const w = await world();
    const review = await proposedReview(w);
    w.mp.delayNextSelect = true;

    const { executionId } = await confirm(w, review);
    const pending = await getExecution(w.deps, actor, executionId);
    expect(pending.status).toBe("processing");
    expect(pending.items[0]?.state).toBe("unknown_reconciling");
    expect(pending.marketplace).toMatchObject({
      intent: { status: "pending" },
      reconcilable: true,
    });

    // The award's answer finally arrives; the user checks again.
    w.mp.landDelayedAwards();
    await reconcileMarketplaceExecution(w.deps, {
      actor,
      cityId,
      executionId,
      correlationId: null,
    });
    const settled = await getExecution(w.deps, actor, executionId);
    expect(settled.status).toBe("confirmed");
    expect(settled.items[0]?.state).toBe("driver_confirmed");
    expect(settled.marketplace?.intent?.status).toBe("awarded");

    // Exactly one award, one selection sent, one grant spent.
    expect(w.mp.awardsCreated).toBe(1);
    expect(w.mp.selectCalls).toHaveLength(1);
    const grants = await grantsOf(actor.id);
    expect(grants).toHaveLength(1);
    expect(
      await testDb().askMpExecution.count({
        where: { grantId: grants[0]?.id },
      }),
    ).toBe(1);

    // A second reconcile of a settled execution changes nothing.
    await reconcileMarketplaceExecution(w.deps, {
      actor,
      cityId,
      executionId,
      correlationId: null,
    });
    expect(w.mp.selectCalls).toHaveLength(1);
  });

  it("a lost selection is re-sent under the SAME key only after its lease", async () => {
    const w = await world();
    const review = await proposedReview(w);
    w.mp.loseNextSelect = true;

    const { executionId } = await confirm(w, review);
    expect((await getExecution(w.deps, actor, executionId)).status).toBe(
      "processing",
    );

    // Inside the in-flight lease: query only, never a second send.
    await reconcileMarketplaceExecution(w.deps, {
      actor,
      cityId,
      executionId,
      correlationId: null,
    });
    expect(w.mp.selectCalls).toHaveLength(1);
    expect((await getExecution(w.deps, actor, executionId)).status).toBe(
      "processing",
    );

    advance(w.deps.limits.selectLeaseSeconds + 1);
    await reconcileMarketplaceExecution(w.deps, {
      actor,
      cityId,
      executionId,
      correlationId: null,
    });
    const settled = await getExecution(w.deps, actor, executionId);
    expect(settled.status).toBe("confirmed");
    expect(w.mp.selectCalls).toHaveLength(2);
    expect(w.mp.selectCalls[1]?.idempotencyKey).toBe(
      w.mp.selectCalls[0]?.idempotencyKey,
    );
    expect(w.mp.awardsCreated).toBe(1);
    expect(settled.marketplace?.intent?.attempts).toBe(2);
  });

  it("a definitive refusal fails the execution and says nothing was charged", async () => {
    const w = await world();
    const review = await proposedReview(w);
    w.mp.refuseNextSelect = new ContractError(
      "bid_not_live",
      "this offer is no longer live",
    );
    const { executionId } = await confirm(w, review);
    const execution = await getExecution(w.deps, actor, executionId);
    expect(execution.status).toBe("failed");
    expect(execution.items[0]).toMatchObject({
      state: "failed",
      reasonCode: "bid_not_live",
    });
    expect(execution.items[0]?.detail).toContain("nothing was charged");
    expect(w.mp.awardsCreated).toBe(0);
  });

  it("is refused for another user's execution and from another city", async () => {
    const w = await world();
    const review = await proposedReview(w);
    w.mp.delayNextSelect = true;
    const { executionId } = await confirm(w, review);

    await expect(
      reconcileMarketplaceExecution(w.deps, {
        actor: rider(),
        cityId,
        executionId,
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    const otherCity = await seedCity(testDb(), { aiMarketplace: true });
    await expect(
      reconcileMarketplaceExecution(w.deps, {
        actor,
        cityId: otherCity,
        executionId,
        correlationId: null,
      }),
    ).rejects.toMatchObject({
      code: "forbidden",
      details: { reason: "city_mismatch" },
    });
    // Still pending — neither refusal touched it.
    expect((await getExecution(w.deps, actor, executionId)).status).toBe(
      "processing",
    );
  });
});

// ---------------------------------------------------------------------------
// Publish (prepare) and cancel
// ---------------------------------------------------------------------------

describe("publishing and cancelling through Ask", () => {
  async function publishReview(w: World) {
    const quote = mpQuote({ cityId, currency: "NGN", vehicleClass: "go" });
    w.mp.setQuote(quote);
    const review = await createMarketplaceReview(w.deps, {
      actor,
      cityId,
      threadId: w.threadId,
      request: {
        stage: "publish",
        quote: {
          service: "ride",
          vehicleClass: "go",
          pickupLat: 6.5,
          pickupLng: 3.35,
          dropoffLat: 6.45,
          dropoffLng: 3.4,
        },
        requestedFare: { amountMinor: 210_000, currency: "NGN" },
        paymentMethodId: "pm_wallet",
      },
      idempotencyKey: uid("rv"),
      correlationId: null,
    });
    return { review, quote };
  }

  it("publishes inside the server's bounds and awards nothing", async () => {
    const w = await world();
    const { review, quote } = await publishReview(w);
    expect(review.marketplace).toMatchObject({
      stage: "publish",
      action: "mp.prepare",
      awardsNothing: true,
      scope: { actions: ["prepare"], quoteId: quote.quoteId },
      publish: {
        bounds: {
          minimum: { amountMinor: quote.minimumFareMinor },
          maximum: { amountMinor: quote.maximumFareMinor },
        },
      },
    });

    const { executionId } = await confirm(w, review);
    const execution = await getExecution(w.deps, actor, executionId);
    expect(execution.status).toBe("confirmed");
    expect(execution.items[0]).toMatchObject({
      kind: "mp_publish",
      state: "published",
    });
    expect(execution.items[0]?.orderId).toBeTruthy();
    expect(w.mp.prepareCalls).toHaveLength(1);
    expect(w.mp.prepareCalls[0]?.requestedFareMinor).toBe(210_000);
    // Publishing never awards, never selects, and spends no grant.
    expect(w.mp.selectCalls).toHaveLength(0);
    expect(w.mp.awardsCreated).toBe(0);
    const [grant] = await grantsOf(actor.id);
    expect(grant?.consumedAt).toBeNull();
  });

  it("an unanswered publish is re-sent under the same key — and never claimed unpublished once its grant lapses", async () => {
    const w = await world();
    const { review } = await publishReview(w);
    w.mp.failNextPrepare = new ContractError(
      "service_unavailable",
      "the marketplace is not available right now",
    );
    const { executionId } = await confirm(w, review);
    const pending = await getExecution(w.deps, actor, executionId);
    expect(pending.status).toBe("processing");
    expect(pending.items[0]?.state).toBe("unknown_reconciling");

    // Within the grant's life the reconcile re-sends the SAME publish key.
    await reconcileMarketplaceExecution(w.deps, {
      actor,
      cityId,
      executionId,
      correlationId: null,
    });
    const published = await getExecution(w.deps, actor, executionId);
    expect(published.items[0]?.state).toBe("published");
    expect(w.mp.prepareCalls).toHaveLength(2);
    expect(w.mp.prepareCalls[1]?.idempotencyKey).toBe(
      w.mp.prepareCalls[0]?.idempotencyKey,
    );

    // Past the grant's life an unanswered publish cannot be re-sent: the
    // outcome is stated as unknown, never as "not published".
    const later = await world();
    const second = await publishReview(later);
    later.mp.failNextPrepare = new ContractError(
      "service_unavailable",
      "the marketplace is not available right now",
    );
    const lapsed = await confirm(later, second.review);
    advance(later.deps.limits.grantTtlSeconds + 1);
    await reconcileMarketplaceExecution(later.deps, {
      actor,
      cityId,
      executionId: lapsed.executionId,
      correlationId: null,
    });
    const unknown = await getExecution(later.deps, actor, lapsed.executionId);
    expect(unknown.status).toBe("failed");
    expect(unknown.items[0]?.reasonCode).toBe("publish_outcome_unknown");
  });

  it("the publish grant can never select", async () => {
    const w = await world();
    const { review } = await publishReview(w);
    const { executionId } = await confirm(w, review);
    const requestId = (await getExecution(w.deps, actor, executionId)).items[0]
      ?.orderId as string;
    const stored = await testDb().askReview.findUniqueOrThrow({
      where: { id: review.id },
    });
    const scope = (stored.items as unknown as { scope: MarketplaceGrantScope })
      .scope;
    await expect(
      selectOffer(w.deps, {
        actor,
        cityId,
        grantId: stored.grantId as string,
        scope,
        requestId,
        bidId: uid("bid"),
        expectedRequestRevision: 0,
        expectedFareMinor: 210_000,
      }),
    ).rejects.toMatchObject({
      code: "forbidden",
      details: { reason: "action_not_in_scope" },
    });
    expect(w.mp.selectCalls).toHaveLength(0);
  });

  it("refuses a fare outside the server's bounds", async () => {
    const w = await world();
    const quote = mpQuote({ cityId, currency: "NGN", vehicleClass: "go" });
    w.mp.setQuote(quote);
    await expect(
      createMarketplaceReview(w.deps, {
        actor,
        cityId,
        threadId: w.threadId,
        request: {
          stage: "publish",
          quote: {
            service: "ride",
            vehicleClass: "go",
            pickupLat: 6.5,
            pickupLng: 3.35,
            dropoffLat: 6.45,
            dropoffLng: 3.4,
          },
          requestedFare: {
            amountMinor: quote.maximumFareMinor + 1,
            currency: "NGN",
          },
          paymentMethodId: "pm_wallet",
        },
        idempotencyKey: uid("rv"),
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "fare_out_of_bounds" });
  });

  it("cancels a request the assistant published — with its own cancel-only grant", async () => {
    const w = await world();
    const { review } = await publishReview(w);
    const { executionId } = await confirm(w, review);
    const requestId = (await getExecution(w.deps, actor, executionId)).items[0]
      ?.orderId as string;

    const result = await cancelMarketplaceRequest(w.deps, {
      actor,
      cityId,
      requestId,
      assurance: { method: "pin", proof: "step-up-proof" },
      idempotencyKey: uid("cancel"),
      correlationId: null,
    });
    expect(result.state).toBe("cancelled");
    const execution = await getExecution(w.deps, actor, executionId);
    expect(execution.items[0]?.state).toBe("cancelled");
    // The per-order state change commits with its outbox event.
    const updates = await testDb().outboxEvent.findMany({
      where: {
        aggregateId: executionId,
        name: "ask.execution.item.updated",
      },
    });
    expect(
      updates.some(
        (event) =>
          (event.payload as { state?: string }).state === "cancelled" &&
          (event.payload as { orderId?: string }).orderId === requestId,
      ),
    ).toBe(true);
    const cancelGrant = (await grantsOf(actor.id)).find(
      (grant) => Number(grant.totalMinor) === 0,
    );
    expect(cancelGrant).toBeDefined();
  });

  it("refuses to cancel a request the assistant did not publish", async () => {
    const w = await world();
    await expect(
      cancelMarketplaceRequest(w.deps, {
        actor,
        cityId,
        requestId: w.request.requestId,
        assurance: { method: "pin", proof: "p" },
        idempotencyKey: uid("cancel"),
        correlationId: null,
      }),
    ).rejects.toMatchObject({
      code: "forbidden",
      details: { reason: "not_published_by_assistant" },
    });
    expect(await grantsOf(actor.id)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Verifier: one approval runs once, whatever the client sends
// ---------------------------------------------------------------------------

describe("a review is executed at most once", () => {
  async function publishReviewFor(w: World) {
    w.mp.setQuote(mpQuote({ cityId, currency: "NGN", vehicleClass: "go" }));
    return createMarketplaceReview(w.deps, {
      actor,
      cityId,
      threadId: w.threadId,
      request: {
        stage: "publish",
        quote: {
          service: "ride",
          vehicleClass: "go",
          pickupLat: 6.5,
          pickupLng: 3.35,
          dropoffLat: 6.45,
          dropoffLng: 3.4,
        },
        requestedFare: null,
        paymentMethodId: "pm_wallet",
      },
      idempotencyKey: uid("rv"),
      correlationId: null,
    });
  }

  it("two racing approvals under different keys start exactly one execution", async () => {
    const w = await world();
    const review = await publishReviewFor(w);

    const results = await Promise.allSettled([
      confirm(w, review, uid("confirm-a")),
      confirm(w, review, uid("confirm-b")),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: "conflict" });
    expect(
      await testDb().askExecution.count({ where: { reviewId: review.id } }),
    ).toBe(1);
    // Only the winner reached the marketplace.
    expect(w.mp.prepareCalls).toHaveLength(1);
  });

  it("a confirm key reused for a different review is refused, not replayed", async () => {
    const w = await world();
    const first = await proposedReview(w);
    const key = uid("confirm");
    const { executionId } = await confirm(w, first, key);

    const other = await world();
    const second = await publishReviewFor(other);
    await expect(confirm(other, second, key)).rejects.toMatchObject({
      code: "idempotency_key_reuse",
    });
    // The original execution is untouched and nothing new ran.
    expect(
      await testDb().askExecution.count({ where: { reviewId: second.id } }),
    ).toBe(0);
    expect(other.mp.prepareCalls).toHaveLength(0);
    const replay = await confirm(w, first, key);
    expect(replay.executionId).toBe(executionId);
  });
});
