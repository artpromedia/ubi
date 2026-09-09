/**
 * A single-use action grant can be spent exactly once, only while unexpired
 * (CLAUDE.md #18). Consumption is a conditional UPDATE against real rows, so an
 * expired grant and a replayed grant are both rejected by the database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { consumeGrant, GrantConsumeError } from "../src/ops/grants";
import { closeTestDb, makeDeps, rider, testDb, uid, type TestDeps } from "./helpers";

import type { AskTx } from "../src/ops/types";

let deps: TestDeps;

beforeAll(() => {
  deps = makeDeps(testDb());
});

afterAll(async () => {
  await closeTestDb();
});

async function seedGrant(opts: {
  expiresAt: Date;
  consumedAt?: Date | null;
}): Promise<string> {
  const id = uid("grn");
  await deps.db.actionGrant.create({
    data: {
      id,
      actorId: rider().id,
      action: "ask.execute",
      resourceRef: uid("rvw"),
      termsVersion: "v1",
      totalMinor: BigInt(4_500_000),
      currency: "NGN",
      idempotencyKey: uid("ik"),
      assurance: "pin",
      expiresAt: opts.expiresAt,
      consumedAt: opts.consumedAt ?? null,
    },
  });
  return id;
}

describe("single-use grant consumption", () => {
  it("consumes an unexpired, unconsumed grant once", async () => {
    const now = new Date();
    const id = await seedGrant({ expiresAt: new Date(now.getTime() + 60_000) });
    await deps.db.$transaction(async (tx) => {
      await consumeGrant(tx as AskTx, id, now);
    });
    const row = await deps.db.actionGrant.findUnique({ where: { id } });
    expect(row?.consumedAt).not.toBeNull();
  });

  it("rejects a replayed (already-consumed) grant", async () => {
    const now = new Date();
    const id = await seedGrant({ expiresAt: new Date(now.getTime() + 60_000) });
    await deps.db.$transaction(async (tx) => {
      await consumeGrant(tx as AskTx, id, now);
    });
    await expect(
      deps.db.$transaction(async (tx) => {
        await consumeGrant(tx as AskTx, id, now);
      }),
    ).rejects.toBeInstanceOf(GrantConsumeError);
    try {
      await deps.db.$transaction(async (tx) => {
        await consumeGrant(tx as AskTx, id, now);
      });
    } catch (error) {
      expect((error as GrantConsumeError).reason).toBe("already_consumed");
    }
  });

  it("rejects an expired grant", async () => {
    const now = new Date();
    const id = await seedGrant({ expiresAt: new Date(now.getTime() - 1_000) });
    await expect(
      deps.db.$transaction(async (tx) => {
        await consumeGrant(tx as AskTx, id, now);
      }),
    ).rejects.toMatchObject({ reason: "expired" });
  });

  it("rejects a grant whose terms do not match the review", async () => {
    const now = new Date();
    const id = await seedGrant({ expiresAt: new Date(now.getTime() + 60_000) });
    await expect(
      deps.db.$transaction(async (tx) => {
        await consumeGrant(tx as AskTx, id, now, {
          totalMinor: 999,
          currency: "NGN",
          termsVersion: "v1",
        });
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
