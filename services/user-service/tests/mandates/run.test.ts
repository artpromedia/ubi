import "./setup-env";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../src/lib/prisma";
import {
  closeConnections,
  createHarness,
  type Harness,
  key,
  newUserId,
  outboxNames,
  patch,
  post,
  serviceHeaders,
  userHeaders,
} from "./harness";

interface MandateView {
  id: string;
  status: string;
}

interface RunResult {
  outcome: "executed" | "blocked";
  reasonCode: string | null;
  replayed: boolean;
  execution: { id: string; outcome: string; reasonCode: string | null };
  grant: { id: string; total: { amountMinor: number; currency: string } } | null;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

const START = new Date("2026-09-09T10:00:00.000Z");
let harness: Harness;

beforeAll(() => {
  harness = createHarness(START);
});

afterAll(async () => {
  await closeConnections();
});

function mandateBody(overrides: Record<string, unknown> = {}) {
  return {
    action: "flight.rebook_on_cancel",
    title: "Rebook if my flight is cancelled",
    passengers: "self_only",
    categories: ["economy"],
    providers: ["ubi_air"],
    perRunCap: { amountMinor: 300_000, currency: "NGN" },
    periodCap: {
      amount: { amountMinor: 3_000_000, currency: "NGN" },
      runs: 20,
      period: "month",
    },
    constraints: [{ key: "lands_after_23_00", mode: "always_ask" }],
    expiresAt: "2027-03-01T00:00:00.000Z",
    assurance: { method: "pin", proof: "step-up" },
    ...overrides,
  };
}

async function createMandate(
  userId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await post<Envelope<{ mandate: MandateView }>>(
    harness.app,
    "/mandates",
    await userHeaders({ userId }, key()),
    mandateBody(overrides),
  );
  expect(res.status).toBe(201);
  return res.body.data?.mandate.id as string;
}

function runBody(overrides: Record<string, unknown> = {}) {
  return {
    triggerRef: `trg_${key()}`,
    price: { amountMinor: 120_000, currency: "NGN" },
    resourceRef: `offer_${key()}`,
    termsVersion: "air_terms_v2",
    triggeredBy: "travel-service",
    ...overrides,
  };
}

async function run(
  mandateId: string,
  overrides: Record<string, unknown> = {},
): Promise<Envelope<RunResult>> {
  const res = await post<Envelope<RunResult>>(
    harness.app,
    `/internal/mandates/${mandateId}/run`,
    serviceHeaders(key()),
    runBody(overrides),
  );
  return res.body;
}

async function allowance(mandateId: string) {
  return prisma.mandateAllowance.findFirst({ where: { mandateId } });
}

describe("mandate run — executed path", () => {
  it("reserves allowance, mints a grant and records an execution", async () => {
    const userId = newUserId();
    const mandateId = await createMandate(userId);

    const result = await run(mandateId, {
      price: { amountMinor: 120_000, currency: "NGN" },
    });
    expect(result.data?.outcome).toBe("executed");
    expect(result.data?.grant).not.toBeNull();
    expect(result.data?.grant?.total).toEqual({
      amountMinor: 120_000,
      currency: "NGN",
    });

    const row = await allowance(mandateId);
    expect(Number(row?.amountUsedMinor)).toBe(120_000);
    expect(row?.runsUsed).toBe(1);

    const grantId = result.data?.grant?.id as string;
    const grant = await prisma.actionGrant.findUniqueOrThrow({
      where: { id: grantId },
    });
    expect(grant.assurance).toBe("mandate");
    expect(grant.mandateId).toBe(mandateId);

    // The minted grant is a real, consumable single-use authorisation.
    const consume = await post<Envelope<{ replayed: boolean }>>(
      harness.app,
      `/internal/grants/${grantId}/consume`,
      serviceHeaders(key()),
      { resultRef: "pnr_ABC" },
    );
    expect(consume.status).toBe(200);

    const names = await outboxNames(userId);
    expect(names).toEqual(
      expect.arrayContaining([
        "action_grant.minted",
        "mandate.run.evaluated",
        "mandate.run.executed",
      ]),
    );
  });

  it("replays the same trigger without reserving twice", async () => {
    const userId = newUserId();
    const mandateId = await createMandate(userId);
    const triggerRef = `trg_${key()}`;

    const first = await run(mandateId, { triggerRef });
    const replay = await run(mandateId, { triggerRef });

    expect(first.data?.outcome).toBe("executed");
    expect(replay.data?.replayed).toBe(true);
    expect(replay.data?.execution.id).toBe(first.data?.execution.id);

    const row = await allowance(mandateId);
    expect(row?.runsUsed).toBe(1);
  });
});

describe("mandate run — blocked paths", () => {
  it("blocks a price above the per-run cap", async () => {
    const userId = newUserId();
    const mandateId = await createMandate(userId);
    const result = await run(mandateId, {
      price: { amountMinor: 500_000, currency: "NGN" },
    });
    expect(result.data?.outcome).toBe("blocked");
    expect(result.data?.reasonCode).toBe("price_above_cap");
    // Nothing reserved on a block.
    expect(await allowance(mandateId)).toBeNull();
  });

  it("blocks when a variance ceiling is exceeded", async () => {
    const userId = newUserId();
    const mandateId = await createMandate(userId, {
      maxPriceVariance: { amountMinor: 10_000, currency: "NGN" },
    });
    const result = await run(mandateId, {
      price: { amountMinor: 120_000, currency: "NGN" },
      referenceMinor: 100_000,
    });
    expect(result.data?.outcome).toBe("blocked");
    expect(result.data?.reasonCode).toBe("price_above_cap");
  });

  it("blocks when a constraint says to ask the human", async () => {
    const userId = newUserId();
    const mandateId = await createMandate(userId);
    const result = await run(mandateId, {
      conditions: ["lands_after_23_00"],
    });
    expect(result.data?.outcome).toBe("blocked");
    expect(result.data?.reasonCode).toBe("constraint_ask");
  });

  it("revoke stops a subsequent run", async () => {
    const userId = newUserId();
    const mandateId = await createMandate(userId);

    const revoke = await patch<Envelope<{ mandate: MandateView }>>(
      harness.app,
      `/mandates/${mandateId}`,
      await userHeaders({ userId }, key()),
      { op: "revoke", assurance: { method: "pin", proof: "p" } },
    );
    expect(revoke.body.data?.mandate.status).toBe("revoked");

    const result = await run(mandateId);
    expect(result.data?.outcome).toBe("blocked");
    expect(result.data?.reasonCode).toBe("mandate_revoked");
  });

  it("a paused mandate blocks its runs", async () => {
    const userId = newUserId();
    const mandateId = await createMandate(userId);
    await patch(
      harness.app,
      `/mandates/${mandateId}`,
      await userHeaders({ userId }, key()),
      { op: "pause" },
    );
    const result = await run(mandateId);
    expect(result.data?.outcome).toBe("blocked");
    expect(result.data?.reasonCode).toBe("mandate_paused");
  });

  it("blocks and reason=allowance_exhausted once the run count is spent", async () => {
    const userId = newUserId();
    const mandateId = await createMandate(userId, {
      periodCap: {
        amount: { amountMinor: 10_000_000, currency: "NGN" },
        runs: 2,
        period: "month",
      },
    });

    const a = await run(mandateId);
    const b = await run(mandateId);
    const c = await run(mandateId);

    expect(a.data?.outcome).toBe("executed");
    expect(b.data?.outcome).toBe("executed");
    expect(c.data?.outcome).toBe("blocked");
    expect(c.data?.reasonCode).toBe("allowance_exhausted");
  });
});

describe("mandate run — concurrent reservation is atomic", () => {
  it("never exceeds the period RUN COUNT under parallel runs", async () => {
    const userId = newUserId();
    const runs = 5;
    const mandateId = await createMandate(userId, {
      periodCap: {
        amount: { amountMinor: 100_000_000, currency: "NGN" },
        runs,
        period: "month",
      },
    });

    const attempts = 12;
    const results = await Promise.all(
      Array.from({ length: attempts }, () =>
        run(mandateId, {
          price: { amountMinor: 100_000, currency: "NGN" },
        }),
      ),
    );

    const executed = results.filter((r) => r.data?.outcome === "executed");
    const blocked = results.filter((r) => r.data?.outcome === "blocked");
    expect(executed.length).toBe(runs);
    expect(blocked.length).toBe(attempts - runs);
    expect(
      blocked.every((r) => r.data?.reasonCode === "allowance_exhausted"),
    ).toBe(true);

    const row = await allowance(mandateId);
    expect(row?.runsUsed).toBe(runs);
    expect(Number(row?.amountUsedMinor)).toBe(runs * 100_000);

    const executedCount = await prisma.mandateExecution.count({
      where: { mandateId, outcome: "executed" },
    });
    expect(executedCount).toBe(runs);
  });

  it("never exceeds the period AMOUNT cap under parallel runs", async () => {
    const userId = newUserId();
    const periodCapMinor = 500_000;
    const price = 100_000;
    const mandateId = await createMandate(userId, {
      periodCap: {
        amount: { amountMinor: periodCapMinor, currency: "NGN" },
        runs: 100,
        period: "month",
      },
    });

    const attempts = 12;
    const results = await Promise.all(
      Array.from({ length: attempts }, () =>
        run(mandateId, { price: { amountMinor: price, currency: "NGN" } }),
      ),
    );

    const executed = results.filter((r) => r.data?.outcome === "executed");
    expect(executed.length).toBe(periodCapMinor / price);

    const row = await allowance(mandateId);
    // The hard invariant: reserved total can never exceed the cap.
    expect(Number(row?.amountUsedMinor)).toBeLessThanOrEqual(periodCapMinor);
    expect(Number(row?.amountUsedMinor)).toBe(periodCapMinor);
  });
});
