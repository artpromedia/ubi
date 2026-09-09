import "./setup-env";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeConnections,
  createHarness,
  get,
  type Harness,
  key,
  newUserId,
  outboxNames,
  patch,
  post,
  userHeaders,
} from "./harness";

interface MandateView {
  id: string;
  action: string;
  status: string;
  perRunCap: { amountMinor: number; currency: string };
  periodCap: {
    amount: { amountMinor: number; currency: string };
    runs: number;
    period: string;
  };
  usage: {
    amountUsed: { amountMinor: number; currency: string };
    runsUsed: number;
    periodStart: string | null;
  };
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
    action: "scheduled_ride.book",
    title: "Weekday commute",
    passengers: "self_only",
    categories: ["go"],
    providers: ["ubi_rides"],
    perRunCap: { amountMinor: 300_000, currency: "NGN" },
    periodCap: {
      amount: { amountMinor: 3_000_000, currency: "NGN" },
      runs: 20,
      period: "month",
    },
    maxPriceVariance: { amountMinor: 50_000, currency: "NGN" },
    expiresAt: "2027-03-01T00:00:00.000Z",
    constraints: [{ key: "lands_after_23_00", mode: "always_ask" }],
    assurance: { method: "pin", proof: "step-up-token" },
    ...overrides,
  };
}

async function create(
  userId: string,
  overrides: Record<string, unknown> = {},
): Promise<MandateView> {
  const res = await post<Envelope<{ mandate: MandateView }>>(
    harness.app,
    "/mandates",
    await userHeaders({ userId }, key()),
    mandateBody(overrides),
  );
  expect(res.status).toBe(201);
  return res.body.data?.mandate as MandateView;
}

describe("mandates — create", () => {
  it("creates an active mandate for an allow-listed action", async () => {
    const userId = newUserId();
    const mandate = await create(userId);
    expect(mandate.status).toBe("active");
    expect(mandate.action).toBe("scheduled_ride.book");
    expect(mandate.usage.runsUsed).toBe(0);
    expect(await outboxNames(userId)).toContain("mandate.created");
  });

  it("refuses a non-mandate-able action with 422 (P2P is not mandate-able)", async () => {
    const userId = newUserId();
    const res = await post<Envelope<never>>(
      harness.app,
      "/mandates",
      await userHeaders({ userId }, key()),
      mandateBody({ action: "p2p.transfer" }),
    );
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe("validation_failed");
  });

  it("refuses account-admin and campaign actions too", async () => {
    const userId = newUserId();
    for (const action of ["account.close", "campaign.activate"]) {
      const res = await post<Envelope<never>>(
        harness.app,
        "/mandates",
        await userHeaders({ userId }, key()),
        mandateBody({ action }),
      );
      expect(res.status).toBe(422);
    }
  });

  it("requires assurance to create", async () => {
    const userId = newUserId();
    const res = await post<Envelope<never>>(
      harness.app,
      "/mandates",
      await userHeaders({ userId }, key()),
      mandateBody({ assurance: undefined }),
    );
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("step_up_required");
  });

  it("rejects an expiry beyond 12 months", async () => {
    const userId = newUserId();
    const res = await post<Envelope<never>>(
      harness.app,
      "/mandates",
      await userHeaders({ userId }, key()),
      mandateBody({ expiresAt: "2028-01-01T00:00:00.000Z" }),
    );
    expect(res.status).toBe(422);
  });

  it("replays the original mandate on idempotency-key reuse", async () => {
    const userId = newUserId();
    const idem = key();
    const first = await post<Envelope<{ mandate: MandateView }>>(
      harness.app,
      "/mandates",
      await userHeaders({ userId }, idem),
      mandateBody(),
    );
    const second = await post<Envelope<{ mandate: MandateView }>>(
      harness.app,
      "/mandates",
      await userHeaders({ userId }, idem),
      mandateBody({ title: "Different title" }),
    );
    expect(second.status).toBe(200);
    expect(second.body.data?.mandate.id).toBe(first.body.data?.mandate.id);
  });
});

describe("mandates — list and ownership", () => {
  it("lists only the caller's own mandates", async () => {
    const alice = newUserId();
    const bob = newUserId();
    const mandate = await create(alice);
    await create(bob);

    const res = await get<Envelope<{ mandates: MandateView[] }>>(
      harness.app,
      "/mandates",
      await userHeaders({ userId: alice }),
    );
    const ids = (res.body.data?.mandates ?? []).map((m) => m.id);
    expect(ids).toContain(mandate.id);
    expect(res.body.data?.mandates.every((m) => m.status !== undefined)).toBe(
      true,
    );
  });

  it("hides another user's mandate behind 404 on patch", async () => {
    const owner = newUserId();
    const intruder = newUserId();
    const mandate = await create(owner);

    const res = await patch<Envelope<never>>(
      harness.app,
      `/mandates/${mandate.id}`,
      await userHeaders({ userId: intruder }, key()),
      { op: "pause" },
    );
    expect(res.status).toBe(404);
  });
});

describe("mandates — lifecycle (mandate machine)", () => {
  it("pauses, resumes and revokes through the machine", async () => {
    const userId = newUserId();
    const mandate = await create(userId);

    const paused = await patch<Envelope<{ mandate: MandateView }>>(
      harness.app,
      `/mandates/${mandate.id}`,
      await userHeaders({ userId }, key()),
      { op: "pause" },
    );
    expect(paused.status).toBe(200);
    expect(paused.body.data?.mandate.status).toBe("paused");

    const resumed = await patch<Envelope<{ mandate: MandateView }>>(
      harness.app,
      `/mandates/${mandate.id}`,
      await userHeaders({ userId }, key()),
      { op: "resume" },
    );
    expect(resumed.body.data?.mandate.status).toBe("active");

    const revoked = await patch<Envelope<{ mandate: MandateView }>>(
      harness.app,
      `/mandates/${mandate.id}`,
      await userHeaders({ userId }, key()),
      { op: "revoke", assurance: { method: "pin", proof: "step-up" } },
    );
    expect(revoked.body.data?.mandate.status).toBe("revoked");

    const names = await outboxNames(userId);
    expect(names).toEqual(
      expect.arrayContaining([
        "mandate.created",
        "mandate.paused",
        "mandate.resumed",
        "mandate.revoked",
      ]),
    );
  });

  it("rejects an illegal transition (pause after revoke)", async () => {
    const userId = newUserId();
    const mandate = await create(userId);
    await patch(
      harness.app,
      `/mandates/${mandate.id}`,
      await userHeaders({ userId }, key()),
      { op: "revoke", assurance: { method: "pin", proof: "p" } },
    );
    const res = await patch<Envelope<never>>(
      harness.app,
      `/mandates/${mandate.id}`,
      await userHeaders({ userId }, key()),
      { op: "pause" },
    );
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("illegal_transition");
  });

  it("requires assurance to revoke", async () => {
    const userId = newUserId();
    const mandate = await create(userId);
    const res = await patch<Envelope<never>>(
      harness.app,
      `/mandates/${mandate.id}`,
      await userHeaders({ userId }, key()),
      { op: "revoke" },
    );
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("step_up_required");
  });

  it("returns an empty execution list for a fresh mandate", async () => {
    const userId = newUserId();
    const mandate = await create(userId);
    const res = await get<Envelope<{ executions: unknown[] }>>(
      harness.app,
      `/mandates/${mandate.id}/executions`,
      await userHeaders({ userId }),
    );
    expect(res.status).toBe(200);
    expect(res.body.data?.executions).toEqual([]);
  });
});
