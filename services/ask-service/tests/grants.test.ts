/**
 * A single-use action grant can be spent exactly once, only while unexpired
 * (CLAUDE.md #18). Consumption is a conditional UPDATE against real rows, so an
 * expired grant and a replayed grant are both rejected by the database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { consumeGrant, GrantConsumeError } from "../src/ops/grants";
import {
  createHttpGrantPort,
  type GrantMintRequest,
} from "../src/ports/grant-port";
import {
  closeTestDb,
  makeDeps,
  rider,
  testDb,
  uid,
  type TestDeps,
} from "./helpers";

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

describe("the mint carries the originating mandate (recheck A03 / P02)", () => {
  // The full round trip against the REAL user-service is
  // tests/grant-port-user-service.test.ts. Here: what the production port puts
  // on the wire, captured before any answer.
  function capture(): {
    calls: { headers: Record<string, string>; body: Record<string, unknown> }[];
    fetchImpl: typeof fetch;
  } {
    const calls: {
      headers: Record<string, string>;
      body: Record<string, unknown>;
    }[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls.push({
        headers: { ...(init?.headers as Record<string, string>) },
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      // user-service's refusal envelope for a key it does not accept.
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "unauthorized", message: "Authentication required" },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  function mintRequest(
    overrides: Partial<GrantMintRequest> = {},
  ): GrantMintRequest {
    return {
      actorId: rider().id,
      action: "mp.negotiate",
      resourceRef: uid("mpq"),
      termsVersion: "mp.scope.v2:0123456789abcdef0123456789abcdef01234567",
      totalMinor: 300_000,
      currency: "NGN",
      assurance: "mandate",
      assuranceProof: "mandate:mnd_1",
      mandateId: "mnd_1",
      idempotencyKey: `mp.authorize:${rider().id}:${uid("ik")}`,
      expiresAt: new Date(Date.now() + 60_000),
      cityId: uid("city"),
      ...overrides,
    };
  }

  it("sends user-service's mint body: the actor in the body, the total as Money, the mandate binding, no nulls", async () => {
    const { calls, fetchImpl } = capture();
    const port = createHttpGrantPort({
      baseUrl: "http://user",
      serviceKey: "grants-service-key",
      fetchImpl,
    });
    const request = mintRequest();
    await expect(port.mint(request)).rejects.toMatchObject({
      code: "service_unavailable",
      details: { reason: "grant_service_auth_refused" },
    });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.body).toEqual({
      actorId: request.actorId,
      action: "mp.negotiate",
      resourceRef: request.resourceRef,
      termsVersion: request.termsVersion,
      total: { amountMinor: 300_000, currency: "NGN" },
      assurance: "mandate",
      mandateId: "mnd_1",
      expiresAt: request.expiresAt.toISOString(),
    });
    expect(call?.headers["x-service-key"]).toBe("grants-service-key");
    const key = call?.headers["idempotency-key"] ?? "";
    expect(key.length).toBeLessThanOrEqual(64);
    expect(key).toMatch(/^[A-Za-z0-9_.:-]+$/);
  });

  it("refuses, before any call, a mandate grant without its mandate", async () => {
    const { calls, fetchImpl } = capture();
    const port = createHttpGrantPort({
      baseUrl: "http://user",
      serviceKey: "grants-service-key",
      fetchImpl,
    });
    await expect(
      port.mint(mintRequest({ mandateId: undefined })),
    ).rejects.toMatchObject({ details: { reason: "mandate_binding_invalid" } });
    await expect(
      port.mint(mintRequest({ assurance: "pin", assuranceProof: "p" })),
    ).rejects.toMatchObject({ details: { reason: "mandate_binding_invalid" } });
    expect(calls).toHaveLength(0);
  });
});
