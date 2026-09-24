/**
 * The order of a turn's ai_actions rows survives the round trip.
 *
 * auditedTransaction writes every row a unit of work describes, one after
 * another, inside one transaction. Left to the column default, each row's
 * `at` is a millisecond-resolution "now", so rows written within the same
 * millisecond tie; their ids are random, and a read ordered by `at` returns
 * them in an arbitrary order (CI's model evaluation read a turn that ran
 * review_offers, search, select back as review_offers, select, search). Each
 * row now gets its own strictly increasing timestamp in the order it was
 * produced. Freezing the clock makes every row land in the same millisecond,
 * which is exactly the tie the default could not break.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { closeTestDb, testDb, uid } from "./helpers";
import { auditedTransaction, type AiActionInput } from "../src/ops/audit";

afterAll(closeTestDb);
afterEach(() => {
  vi.restoreAllMocks();
});

function action(actorRef: string, tool: string): AiActionInput {
  return {
    actorKind: "rider",
    actorRef,
    threadId: null,
    action: "tool.call",
    tool,
    authKind: "read_only",
    outcome: "done",
  };
}

describe("auditedTransaction", () => {
  it("writes a unit of work's ai_actions with distinct, increasing timestamps in the order produced", async () => {
    const db = testDb();
    const actorRef = uid("usr_audit_order");
    const tools = [
      "mp.review_offers",
      "flight.search",
      "mp.select",
      "stay.search",
      "booking.status",
    ];

    const frozen = Date.UTC(2026, 8, 24, 12, 0, 0);
    vi.spyOn(Date, "now").mockReturnValue(frozen);

    // eslint-disable-next-line require-await -- auditedTransaction's callback is async by contract; this one only describes the rows
    await auditedTransaction(db, async () => ({
      result: null,
      aiActions: tools.map((tool) => action(actorRef, tool)),
    }));

    const rows = await db.aiAction.findMany({
      where: { actorRef },
      orderBy: { at: "asc" },
    });
    expect(rows.map((row) => row.tool)).toEqual(tools);
    // One millisecond apart from the moment of writing, in production order.
    expect(rows.map((row) => row.at.getTime() - frozen)).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });
});
