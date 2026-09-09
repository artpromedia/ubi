/**
 * Strict tool schemas reject bad input before the tool runs, and the rejection
 * is logged. A valid call produces a live card; nothing about the schema comes
 * from the model (rule #18).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { handleMessage, openThread } from "../src/ops/threads";
import {
  closeTestDb,
  makeDeps,
  rider,
  seedCity,
  testDb,
  type TestDeps,
} from "./helpers";

import type { Actor } from "../src/ops/types";

let deps: TestDeps;
let cityId: string;
let actor: Actor;
let threadId: string;

beforeAll(async () => {
  const db = testDb();
  deps = makeDeps(db);
  cityId = await seedCity(db);
  actor = rider();
  const thread = await openThread(deps, {
    actor,
    cityId,
    source: "home",
    correlationId: null,
  });
  threadId = thread.id;
});

afterAll(async () => {
  await closeTestDb();
});

describe("strict tool schemas", () => {
  it("rejects a ride.quote missing a required field and logs it as blocked", async () => {
    const result = await handleMessage(deps, {
      actor,
      cityId,
      threadId,
      text: 'quote a ride @tool ride.quote {"pickupRef":"home"}',
      clarifications: null,
      correlationId: null,
    });

    // No card was produced from a rejected call.
    expect(result.events.some((event) => event.type === "card")).toBe(false);

    const blocked = await deps.db.aiAction.findMany({
      where: { threadId, tool: "ride.quote", reasonCode: "schema_rejected" },
    });
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.outcome).toBe("blocked");
  });

  it("accepts a well-formed ride.quote and emits a live ride_quote card", async () => {
    const result = await handleMessage(deps, {
      actor,
      cityId,
      threadId,
      text: 'quote it @tool ride.quote {"pickupRef":"home","dropoffRef":"work"}',
      clarifications: null,
      correlationId: null,
    });

    const cardEvent = result.events.find((event) => event.type === "card");
    expect(cardEvent).toBeDefined();
    if (cardEvent?.type === "card") {
      expect(cardEvent.card.kind).toBe("ride_quote");
      expect(cardEvent.card.status).toBe("live");
      expect(cardEvent.card.price?.amountMinor).toBe(250_000);
      // The model never sees or computes the price; the server does.
    }
  });

  it("rejects unknown keys (additionalProperties=false)", async () => {
    await handleMessage(deps, {
      actor,
      cityId,
      threadId,
      text: 'x @tool ride.quote {"pickupRef":"home","dropoffRef":"work","overridePriceMinor":1}',
      clarifications: null,
      correlationId: null,
    });
    const blocked = await deps.db.aiAction.findMany({
      where: { threadId, tool: "ride.quote", reasonCode: "schema_rejected" },
    });
    // The first test plus this one: at least two schema rejections recorded.
    expect(blocked.length).toBeGreaterThanOrEqual(2);
  });
});
