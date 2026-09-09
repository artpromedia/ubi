/**
 * Out-of-scope requests (P2P, account admin, campaign/budget/flag changes) are
 * refused with a deep link to the conventional flow and logged (rule #19). The
 * model has no tool for them; naming one is a refusal, not an action.
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

beforeAll(async () => {
  const db = testDb();
  deps = makeDeps(db);
  cityId = await seedCity(db);
  actor = rider();
});

afterAll(async () => {
  await closeTestDb();
});

async function refuse(text: string): Promise<{ threadId: string; events: import("../src/ai/events").AskEvent[] }> {
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
    text,
    clarifications: null,
    correlationId: null,
  });
  return { threadId: thread.id, events: [...result.events] };
}

describe("out-of-scope is refused and logged", () => {
  it("refuses a P2P transfer with a deep link", async () => {
    const { threadId, events } = await refuse('send money @tool p2p.send {"to":"x","amountMinor":1000}');
    const refused = events.find((e) => e.type === "refused");
    expect(refused).toBeDefined();
    if (refused?.type === "refused") {
      expect(refused.policy).toBe("p2p_out_of_scope");
      expect(refused.deepLink).toBe("ubi://wallet/send");
    }
    const logged = await deps.db.aiAction.findFirst({
      where: { threadId, action: "tool.refused", tool: "p2p.send" },
    });
    expect(logged?.outcome).toBe("refused");
    expect(logged?.reasonCode).toBe("p2p_out_of_scope");
    // No review, no grant, nothing booked.
    const reviews = await deps.db.askReview.findMany({ where: { threadId } });
    expect(reviews).toHaveLength(0);
  });

  it("refuses a campaign activation as out of scope", async () => {
    const { threadId, events } = await refuse('boost @tool campaign.activate {}');
    expect(events.some((e) => e.type === "refused")).toBe(true);
    const logged = await deps.db.aiAction.findFirst({
      where: { threadId, action: "tool.refused", tool: "campaign.activate" },
    });
    expect(logged?.reasonCode).toBe("campaign_out_of_scope");
  });

  it("refuses a feature-flag change as out of scope", async () => {
    const { events } = await refuse('turn on @tool flag.change {}');
    const refused = events.find((e) => e.type === "refused");
    expect(refused?.type === "refused" && refused.policy).toBe("flag_out_of_scope");
  });
});
