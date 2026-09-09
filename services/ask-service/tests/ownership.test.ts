/**
 * Ownership comes from the gateway context, never from a tool argument. A user
 * cannot read another user's trip, order or execution by naming its id
 * (rule #18).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ContractError } from "@ubi/contracts";

import { handleMessage, openThread } from "../src/ops/threads";
import { getExecution } from "../src/ops/executions";
import { confirmReview } from "../src/ops/reviews";
import {
  closeTestDb,
  FakeRidePort,
  makeDeps,
  rider,
  seedCity,
  testDb,
  uid,
  type TestDeps,
} from "./helpers";

import type { Actor } from "../src/ops/types";

let deps: TestDeps;
let cityId: string;
let owner: Actor;
let attacker: Actor;
let ride: FakeRidePort;
const victimTrip = "trip_victim";

beforeAll(async () => {
  const db = testDb();
  ride = new FakeRidePort();
  deps = makeDeps(db, { ride });
  cityId = await seedCity(db);
  owner = rider();
  attacker = rider();
  ride.setTrip(victimTrip, { ownerId: owner.id, state: "in_progress", driverEtaMinutes: 2 });
});

afterAll(async () => {
  await closeTestDb();
});

async function ask(actor: Actor, text: string): Promise<string> {
  const thread = await openThread(deps, {
    actor,
    cityId,
    source: "home",
    correlationId: null,
  });
  await handleMessage(deps, {
    actor,
    cityId,
    threadId: thread.id,
    text,
    clarifications: null,
    correlationId: null,
  });
  return thread.id;
}

describe("ownership from context", () => {
  it("lets the owner read their own trip", async () => {
    const threadId = await ask(
      owner,
      `status @tool ride.status {"tripId":"${victimTrip}"}`,
    );
    const action = await deps.db.aiAction.findFirst({
      where: { threadId, tool: "ride.status" },
    });
    expect(action?.outcome).toBe("done");
    expect(action?.reasonCode).toBeNull();
  });

  it("denies another user reading that same trip id", async () => {
    const threadId = await ask(
      attacker,
      `status @tool ride.status {"tripId":"${victimTrip}"}`,
    );
    const action = await deps.db.aiAction.findFirst({
      where: { threadId, tool: "ride.status" },
    });
    // The trip id is the victim's, but the actor is the attacker → denied.
    expect(action?.outcome).toBe("blocked");
    expect(action?.reasonCode).toBe("ownership_denied");
  });

  it("hides another user's execution behind not_found", async () => {
    // Owner creates a real execution.
    const travel = deps.travel;
    travel.setOffer(
      { offerRef: "own_off", kind: "flight", title: "T", detail: null, priceMinor: 1000, currency: "NGN", termsVersion: "v1", terms: [] },
      { state: "confirmed" },
    );
    const thread = await openThread(deps, { actor: owner, cityId, source: "home", correlationId: null });
    const msg = await handleMessage(deps, {
      actor: owner,
      cityId,
      threadId: thread.id,
      text: 'book @tool propose_transaction {"items":[{"offerRef":"own_off"}],"paymentMethodId":"pm1"}',
      clarifications: null,
      correlationId: null,
    });
    const reviewId = msg.reviewId;
    expect(reviewId).not.toBeNull();
    const confirmed = await confirmReview(deps, {
      actor: owner,
      cityId,
      reviewId: reviewId as string,
      termsVersion: "own_off:v1",
      assurance: { method: "pin", proof: uid("proof") },
      idempotencyKey: uid("ik"),
      correlationId: null,
    });

    await expect(
      getExecution(deps, attacker, confirmed.executionId),
    ).rejects.toMatchObject({ code: "not_found" });
    // Sanity: the owner can read it.
    const view = await getExecution(deps, owner, confirmed.executionId);
    expect(view.id).toBe(confirmed.executionId);
    expect(ContractError).toBeDefined();
  });
});
