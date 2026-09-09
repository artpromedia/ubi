/**
 * The AI action log and the ops views. Every assistant action is logged; the ops
 * read is admin-only and itself audited; the daily metrics roll up with "unsafe
 * actions = 0" as a property computed from real transactional rows, not a
 * hard-coded zero (migration 012, rule #21).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getMetrics, listActions, rollupDailyMetrics } from "../src/ops/ai-log";
import { confirmReview } from "../src/ops/reviews";
import { handleMessage, openThread } from "../src/ops/threads";
import {
  admin,
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

let deps: TestDeps;
let cityId: string;
let actor: Actor;

beforeAll(async () => {
  const db = testDb();
  const travel = new FakeTravelPort();
  travel.setOffer(offer({ offerRef: "off1", termsVersion: "v1", priceMinor: 3_000_000 }));
  deps = makeDeps(db, { travel });
  cityId = await seedCity(db);
  actor = rider();

  // Produce a spread of actions: a read tool, a refusal, and a full confirm+run.
  const thread = await openThread(deps, { actor, cityId, source: "home", correlationId: null });
  await handleMessage(deps, {
    actor,
    cityId,
    threadId: thread.id,
    text: 'quote @tool ride.quote {"pickupRef":"a","dropoffRef":"b"}',
    clarifications: null,
    correlationId: null,
  });
  await handleMessage(deps, {
    actor,
    cityId,
    threadId: thread.id,
    text: 'p2p @tool p2p.send {}',
    clarifications: null,
    correlationId: null,
  });
  const proposal = await handleMessage(deps, {
    actor,
    cityId,
    threadId: thread.id,
    text: 'book @tool propose_transaction {"items":[{"offerRef":"off1"}],"paymentMethodId":"pm1"}',
    clarifications: null,
    correlationId: null,
  });
  await confirmReview(deps, {
    actor,
    cityId,
    reviewId: proposal.reviewId as string,
    termsVersion: "off1:v1",
    assurance: { method: "pin", proof: uid("p") },
    idempotencyKey: uid("ik"),
    correlationId: null,
  });
});

afterAll(async () => {
  await closeTestDb();
});

describe("ai action log ops views", () => {
  it("lists actions for an admin and audits the access", async () => {
    const before = await deps.db.aiActionAccessLog.count();
    const actions = await listActions(deps, admin(), { since: null, limit: 500 });
    expect(actions.length).toBeGreaterThan(0);
    // The log carries model, prompt version and auth kind, never raw prompts.
    const withModel = actions.find((a) => a.model !== undefined);
    expect(withModel?.model).toBe("Qwen/Qwen3-30B-A3B-Instruct-2507");
    const refused = actions.find((a) => a.outcome === "refused");
    expect(refused).toBeDefined();
    const confirm = actions.find((a) => a.action === "review.confirm");
    expect(confirm?.authKind).toBe("grant");
    const after = await deps.db.aiActionAccessLog.count();
    expect(after).toBe(before + 1);
  });

  it("rolls up daily metrics with unsafe actions = 0", async () => {
    const written = await rollupDailyMetrics(deps, deps.now());
    expect(written).toBeGreaterThan(0);
    const metrics = await getMetrics(deps, admin(), { sinceDay: null });
    expect(metrics.unsafeActionsTotal).toBe(0);
    const model = metrics.models.find(
      (m) => m.model === "Qwen/Qwen3-30B-A3B-Instruct-2507",
    );
    expect(model).toBeDefined();
    expect(model?.tasks ?? 0).toBeGreaterThan(0);
    expect(model?.unsafeActions).toBe(0);
    // A transactional action (review.confirm / execution.run) ran under a grant,
    // so it is counted as a task but contributes zero unsafe actions.
    expect((model?.success ?? 0)).toBeGreaterThan(0);
  });
});
