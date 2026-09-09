/**
 * Feature flags deny by default and are evaluated server-side per city
 * (CLAUDE.md #5). `ai_assistant` off makes the assistant invisible (404). With
 * the assistant on but `ai_transactions` off, a proposal creates no review — the
 * assistant is honestly unavailable for booking, never faked.
 */
import { afterAll, describe, expect, it } from "vitest";

import { handleMessage, openThread } from "../src/ops/threads";
import {
  closeTestDb,
  FakeTravelPort,
  makeDeps,
  offer,
  rider,
  seedCity,
  testDb,
} from "./helpers";

afterAll(async () => {
  await closeTestDb();
});

describe("assistant flag", () => {
  it("hides the assistant (feature_disabled) when ai_assistant is off", async () => {
    const db = testDb();
    const deps = makeDeps(db);
    const cityId = await seedCity(db, { aiAssistant: false });
    await expect(
      openThread(deps, { actor: rider(), cityId, source: "home", correlationId: null }),
    ).rejects.toMatchObject({ code: "feature_disabled", status: 404 });
  });
});

describe("transactions flag", () => {
  it("creates no review when ai_transactions is off", async () => {
    const db = testDb();
    const travel = new FakeTravelPort();
    travel.setOffer(offer({ offerRef: "off1", termsVersion: "v1" }));
    const deps = makeDeps(db, { travel });
    const cityId = await seedCity(db, {
      aiAssistant: true,
      aiTransactions: false,
    });
    const actor = rider();
    const thread = await openThread(deps, {
      actor,
      cityId,
      source: "home",
      correlationId: null,
    });
    const result = await handleMessage(deps, {
      actor,
      cityId,
      threadId: thread.id,
      text: 'book @tool propose_transaction {"items":[{"offerRef":"off1"}],"paymentMethodId":"pm1"}',
      clarifications: null,
      correlationId: null,
    });
    expect(result.reviewId).toBeNull();
    expect(result.events.some((e) => e.type === "review_ready")).toBe(false);
    const reviews = await db.askReview.findMany({ where: { threadId: thread.id } });
    expect(reviews).toHaveLength(0);
  });
});
