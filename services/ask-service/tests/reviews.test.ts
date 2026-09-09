/**
 * Reviews and executions end to end: a proposed transaction becomes a review the
 * user confirms; confirming mints a single-use grant and runs the execution; a
 * material change returns a fresh review (409); an expired review is refused
 * (410); a partial outcome stays partly_booked (rule #18, #25).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getExecution } from "../src/ops/executions";
import {
  confirmReview,
  getReview,
  ReviewExpiredError,
  TermsChangedError,
} from "../src/ops/reviews";
import { handleMessage, openThread } from "../src/ops/threads";
import {
  closeTestDb,
  FakeTravelPort,
  makeDeps,
  offer,
  rider,
  seedCity,
  testDb,
  uid,
  type TestDeps,
} from "./helpers";

import type { Actor } from "../src/ops/types";

let cityId: string;
let actor: Actor;

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  cityId = await seedCity(testDb());
  actor = rider();
});

async function propose(
  deps: TestDeps,
  offerRefs: string[],
): Promise<{ threadId: string; reviewId: string }> {
  const thread = await openThread(deps, {
    actor,
    cityId,
    source: "home",
    correlationId: null,
  });
  const items = offerRefs.map((ref) => ({ offerRef: ref }));
  const result = await handleMessage(deps, {
    actor,
    cityId,
    threadId: thread.id,
    text: `book @tool propose_transaction ${JSON.stringify({ items, paymentMethodId: "pm_wallet" })}`,
    clarifications: null,
    correlationId: null,
  });
  expect(result.reviewId).not.toBeNull();
  expect(result.events.some((e) => e.type === "review_ready")).toBe(true);
  return { threadId: thread.id, reviewId: result.reviewId as string };
}

describe("review confirm happy path", () => {
  it("mints a grant, runs the execution and consumes the grant once", async () => {
    const db = testDb();
    const travel = new FakeTravelPort();
    travel.setOffer(offer({ offerRef: "off1", priceMinor: 4_500_000, termsVersion: "v1" }));
    const deps = makeDeps(db, { travel });

    const { reviewId } = await propose(deps, ["off1"]);
    const review = await getReview(deps, actor, reviewId);
    expect(review.status).toBe("awaiting_confirmation");
    expect(review.termsVersion).toBe("off1:v1");
    expect(review.total.amountMinor).toBe(4_500_000);

    const idempotencyKey = uid("ik");
    const confirmed = await confirmReview(deps, {
      actor,
      cityId,
      reviewId,
      termsVersion: "off1:v1",
      assurance: { method: "pin", proof: uid("proof") },
      idempotencyKey,
      correlationId: null,
    });

    const execution = await getExecution(deps, actor, confirmed.executionId);
    expect(execution.status).toBe("confirmed");
    expect(execution.items).toHaveLength(1);
    expect(execution.items[0]?.state).toBe("confirmed");

    // Exactly one grant minted, consumed, and one booking made under it.
    expect(deps.grants.minted).toHaveLength(1);
    expect(travel.booked).toHaveLength(1);
    expect(travel.booked[0]?.grantId).toBeDefined();
    const grants = await db.actionGrant.findMany({ where: { actorId: actor.id } });
    expect(grants).toHaveLength(1);
    expect(grants[0]?.consumedAt).not.toBeNull();

    const reviewAfter = await db.askReview.findUnique({ where: { id: reviewId } });
    expect(reviewAfter?.status).toBe("executing");
    expect(reviewAfter?.grantId).toBe(grants[0]?.id);
  });

  it("replays confirm on the same Idempotency-Key without a second grant or booking", async () => {
    const db = testDb();
    const travel = new FakeTravelPort();
    travel.setOffer(offer({ offerRef: "off1", termsVersion: "v1" }));
    const deps = makeDeps(db, { travel });
    const { reviewId } = await propose(deps, ["off1"]);
    const idempotencyKey = uid("ik");
    const first = await confirmReview(deps, {
      actor,
      cityId,
      reviewId,
      termsVersion: "off1:v1",
      assurance: { method: "pin", proof: uid("p") },
      idempotencyKey,
      correlationId: null,
    });
    const second = await confirmReview(deps, {
      actor,
      cityId,
      reviewId,
      termsVersion: "off1:v1",
      assurance: { method: "pin", proof: uid("p") },
      idempotencyKey,
      correlationId: null,
    });
    expect(second.executionId).toBe(first.executionId);
    expect(deps.grants.minted).toHaveLength(1);
    expect(travel.booked).toHaveLength(1);
  });
});

describe("material change", () => {
  it("returns a fresh review (409) when the offer re-prices before confirm", async () => {
    const db = testDb();
    const travel = new FakeTravelPort();
    travel.setOffer(offer({ offerRef: "off1", priceMinor: 4_500_000, termsVersion: "v1" }));
    const deps = makeDeps(db, { travel });
    const { reviewId } = await propose(deps, ["off1"]);

    // The airline re-priced: same ref, new terms version and price.
    travel.setOffer(offer({ offerRef: "off1", priceMinor: 5_000_000, termsVersion: "v2" }));

    let thrown: unknown;
    try {
      await confirmReview(deps, {
        actor,
        cityId,
        reviewId,
        termsVersion: "off1:v1",
        assurance: { method: "pin", proof: uid("p") },
        idempotencyKey: uid("ik"),
        correlationId: null,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TermsChangedError);
    if (thrown instanceof TermsChangedError) {
      expect(thrown.review.termsVersion).toBe("off1:v2");
      expect(thrown.review.total.amountMinor).toBe(5_000_000);
      expect(thrown.review.status).toBe("awaiting_confirmation");
    }
    // The stale review is superseded; no grant was minted, nothing booked.
    const stale = await db.askReview.findUnique({ where: { id: reviewId } });
    expect(stale?.status).toBe("superseded");
    expect(deps.grants.minted).toHaveLength(0);
    expect(travel.booked).toHaveLength(0);
  });

  it("returns a fresh review (409) when the client confirms a stale terms version", async () => {
    const db = testDb();
    const travel = new FakeTravelPort();
    travel.setOffer(offer({ offerRef: "off1", termsVersion: "v1" }));
    const deps = makeDeps(db, { travel });
    const { reviewId } = await propose(deps, ["off1"]);
    await expect(
      confirmReview(deps, {
        actor,
        cityId,
        reviewId,
        termsVersion: "off1:OLD",
        assurance: { method: "pin", proof: uid("p") },
        idempotencyKey: uid("ik"),
        correlationId: null,
      }),
    ).rejects.toBeInstanceOf(TermsChangedError);
  });
});

describe("expiry", () => {
  it("refuses an expired review with 410 semantics", async () => {
    const db = testDb();
    const travel = new FakeTravelPort();
    travel.setOffer(offer({ offerRef: "off1", termsVersion: "v1" }));
    const base = new Date("2026-09-09T10:00:00Z");
    let clock = base;
    const deps = makeDeps(db, { travel, now: () => clock });
    const { reviewId } = await propose(deps, ["off1"]);

    clock = new Date(base.getTime() + (deps.limits.reviewTtlSeconds + 5) * 1000);
    await expect(getReview(deps, actor, reviewId)).rejects.toBeInstanceOf(
      ReviewExpiredError,
    );
    await expect(
      confirmReview(deps, {
        actor,
        cityId,
        reviewId,
        termsVersion: "off1:v1",
        assurance: { method: "pin", proof: uid("p") },
        idempotencyKey: uid("ik"),
        correlationId: null,
      }),
    ).rejects.toBeInstanceOf(ReviewExpiredError);
    const row = await db.askReview.findUnique({ where: { id: reviewId } });
    expect(row?.status).toBe("expired");
  });
});

describe("partial outcome", () => {
  it("is partly_booked, never coerced to confirmed", async () => {
    const db = testDb();
    const travel = new FakeTravelPort();
    travel.setOffer(
      offer({ offerRef: "flight1", kind: "flight", priceMinor: 4_000_000, termsVersion: "v1" }),
      { state: "confirmed" },
    );
    travel.setOffer(
      offer({ offerRef: "stay1", kind: "stay", priceMinor: 2_000_000, termsVersion: "v1" }),
      { state: "failed_released" },
    );
    const deps = makeDeps(db, { travel });
    const { reviewId } = await propose(deps, ["flight1", "stay1"]);
    const confirmed = await confirmReview(deps, {
      actor,
      cityId,
      reviewId,
      termsVersion: "flight1:v1|stay1:v1",
      assurance: { method: "pin", proof: uid("p") },
      idempotencyKey: uid("ik"),
      correlationId: null,
    });
    const execution = await getExecution(deps, actor, confirmed.executionId);
    expect(execution.status).toBe("partly_booked");
    expect(execution.items).toHaveLength(2);
    const states = execution.items.map((i) => i.state).sort();
    expect(states).toEqual(["confirmed", "failed_released"]);
  });
});
