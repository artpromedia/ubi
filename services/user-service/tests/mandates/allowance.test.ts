import "./setup-env";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../src/lib/prisma";
import {
  reserveAllowance,
  settleAllowance,
  type ReserveResult,
} from "../../src/mandates/allowance";
import { currentPeriodStart } from "../../src/mandates/mandates";
import {
  closeConnections,
  createHarness,
  type Harness,
  key,
  newUserId,
  patch,
  post,
  serviceHeaders,
  userHeaders,
} from "./harness";

/**
 * The canonical mandate period allowance (recheck A03 / P02): the
 * `mandate_allowance_reserve` / `mandate_allowance_settle` functions every
 * caller — these mandate runs and ask-service's marketplace selections — goes
 * through, plus the new marketplace mandate actions. Real Postgres, real route
 * handlers; the only thing supplied is the clock.
 */

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

interface MandateView {
  id: string;
  action: string;
  status: string;
  constraints: unknown;
}

const START = new Date("2026-09-09T10:00:00.000Z");
let harness: Harness;

beforeAll(() => {
  harness = createHarness(START);
});

afterAll(async () => {
  await closeConnections();
});

function marketplaceMandate(overrides: Record<string, unknown> = {}) {
  return {
    action: "marketplace.ride.select",
    title: "Book my commute",
    passengers: "self_only",
    categories: ["go"],
    perRunCap: { amountMinor: 300_000, currency: "NGN" },
    periodCap: {
      amount: { amountMinor: 1_000_000, currency: "NGN" },
      runs: 5,
      period: "month",
    },
    constraints: [
      { key: "time_window", mode: "allow", values: ["06:00-10:00"] },
      { key: "city", mode: "allow", values: ["LOS"] },
    ],
    expiresAt: "2027-03-01T00:00:00.000Z",
    assurance: { method: "pin", proof: "step-up" },
    ...overrides,
  };
}

async function createMandate(
  userId: string,
  overrides: Record<string, unknown> = {},
): Promise<MandateView> {
  const res = await post<Envelope<{ mandate: MandateView }>>(
    harness.app,
    "/mandates",
    await userHeaders({ userId }, key()),
    marketplaceMandate(overrides),
  );
  expect(res.status).toBe(201);
  return res.body.data?.mandate as MandateView;
}

async function reserve(
  mandateId: string,
  amountMinor: number,
  idempotencyKey = key("res"),
): Promise<ReserveResult> {
  return prisma.$transaction(async (tx) =>
    reserveAllowance(tx, {
      reservationId: key("mar"),
      idempotencyKey,
      mandateId,
      periodStart: currentPeriodStart(harness.now()),
      amountMinor,
      currency: "NGN",
      grantId: null,
      now: harness.now(),
    }),
  );
}

async function usage(
  mandateId: string,
): Promise<{ runs: number; amount: number }> {
  const row = await prisma.mandateAllowance.findFirst({ where: { mandateId } });
  return {
    runs: row?.runsUsed ?? 0,
    amount: Number(row?.amountUsedMinor ?? 0n),
  };
}

describe("marketplace mandate actions", () => {
  it("creates a marketplace mandate as a new action with typed constraint values", async () => {
    const mandate = await createMandate(newUserId());
    expect(mandate.action).toBe("marketplace.ride.select");
    expect(mandate.constraints).toEqual([
      { key: "time_window", mode: "allow", values: ["06:00-10:00"] },
      { key: "city", mode: "allow", values: ["LOS"] },
    ]);
  });

  it("refuses a time window the server could not enforce", async () => {
    const res = await post<Envelope<unknown>>(
      harness.app,
      "/mandates",
      await userHeaders({ userId: newUserId() }, key()),
      marketplaceMandate({
        constraints: [
          { key: "time_window", mode: "allow", values: ["25:00-26:00"] },
        ],
      }),
    );
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe("validation_failed");
  });

  it("the travel runner cannot run a marketplace mandate", async () => {
    const mandate = await createMandate(newUserId());
    const res = await post<
      Envelope<{ outcome: string; reasonCode: string | null }>
    >(
      harness.app,
      `/internal/mandates/${mandate.id}/run`,
      serviceHeaders(key()),
      {
        triggerRef: `trg_${key()}`,
        price: { amountMinor: 100_000, currency: "NGN" },
        resourceRef: `offer_${key()}`,
        termsVersion: "v1",
      },
    );
    expect(res.body.data?.outcome).toBe("blocked");
    expect(res.body.data?.reasonCode).toBe("action_not_allowed");
    expect(await usage(mandate.id)).toEqual({ runs: 0, amount: 0 });
  });
});

describe("the canonical allowance mechanism", () => {
  it("reserve → commit counts the run and returns the unspent part of the hold", async () => {
    const mandate = await createMandate(newUserId());
    const held = await reserve(mandate.id, 250_000);
    expect(held.outcome).toBe("reserved");
    expect(await usage(mandate.id)).toEqual({ runs: 1, amount: 250_000 });

    const settled = await prisma.$transaction(async (tx) =>
      settleAllowance(tx, {
        reservationId: held.reservationId as string,
        action: "commit",
        actualMinor: 200_000,
        resultRef: "award_1",
        now: harness.now(),
      }),
    );
    expect(settled).toBe("committed");
    expect(await usage(mandate.id)).toEqual({ runs: 1, amount: 200_000 });

    // Exactly once: a replayed settlement adjusts nothing.
    const replay = await prisma.$transaction(async (tx) =>
      settleAllowance(tx, {
        reservationId: held.reservationId as string,
        action: "release",
        now: harness.now(),
      }),
    );
    expect(replay).toBe("already_committed");
    expect(await usage(mandate.id)).toEqual({ runs: 1, amount: 200_000 });
    const row = await prisma.mandateAllowanceReservation.findUniqueOrThrow({
      where: { id: held.reservationId as string },
    });
    expect(row).toMatchObject({
      status: "committed",
      reservedMinor: 250_000n,
      committedMinor: 200_000n,
      resultRef: "award_1",
    });
  });

  it("release returns both the budget and the run, once", async () => {
    const mandate = await createMandate(newUserId());
    const held = await reserve(mandate.id, 250_000);
    const released = await prisma.$transaction(async (tx) =>
      settleAllowance(tx, {
        reservationId: held.reservationId as string,
        action: "release",
        reasonCode: "bid_not_live",
        now: harness.now(),
      }),
    );
    expect(released).toBe("released");
    expect(await usage(mandate.id)).toEqual({ runs: 0, amount: 0 });
    const again = await prisma.$transaction(async (tx) =>
      settleAllowance(tx, {
        reservationId: held.reservationId as string,
        action: "release",
        now: harness.now(),
      }),
    );
    expect(again).toBe("already_released");
    expect(await usage(mandate.id)).toEqual({ runs: 0, amount: 0 });
  });

  it("a replayed reservation key returns the original hold, never a second", async () => {
    const mandate = await createMandate(newUserId());
    const idem = key("res");
    const first = await reserve(mandate.id, 100_000, idem);
    const replay = await reserve(mandate.id, 100_000, idem);
    expect(replay).toEqual({
      outcome: "replayed",
      reservationId: first.reservationId,
    });
    expect(await usage(mandate.id)).toEqual({ runs: 1, amount: 100_000 });
  });

  it("re-checks status, expiry, currency and the per-run cap under the mandate lock", async () => {
    const userId = newUserId();
    const mandate = await createMandate(userId);
    expect((await reserve(mandate.id, 300_001)).outcome).toBe(
      "price_above_cap",
    );
    const kes = await prisma.$transaction(async (tx) =>
      reserveAllowance(tx, {
        reservationId: key("mar"),
        idempotencyKey: key("res"),
        mandateId: mandate.id,
        periodStart: currentPeriodStart(harness.now()),
        amountMinor: 1_000,
        currency: "KES",
        grantId: null,
        now: harness.now(),
      }),
    );
    expect(kes.outcome).toBe("currency_mismatch");

    const paused = await patch<Envelope<MandateView>>(
      harness.app,
      `/mandates/${mandate.id}`,
      await userHeaders({ userId }, key()),
      { op: "pause" },
    );
    expect(paused.status).toBe(200);
    expect((await reserve(mandate.id, 1_000)).outcome).toBe("mandate_paused");

    expect(await usage(mandate.id)).toEqual({ runs: 0, amount: 0 });

    // Still "active" on paper but past its expiry at the moment of reserving.
    const lapsed = await createMandate(newUserId());
    const after = new Date("2027-03-02T00:00:00.000Z");
    const late = await prisma.$transaction(async (tx) =>
      reserveAllowance(tx, {
        reservationId: key("mar"),
        idempotencyKey: key("res"),
        mandateId: lapsed.id,
        periodStart: currentPeriodStart(after),
        amountMinor: 1_000,
        currency: "NGN",
        grantId: null,
        now: after,
      }),
    );
    expect(late.outcome).toBe("mandate_expired");
    expect(await usage(lapsed.id)).toEqual({ runs: 0, amount: 0 });
  });

  it("concurrent reservations never exceed the run count or the period cap", async () => {
    const byRuns = await createMandate(newUserId());
    const runResults = await Promise.all(
      Array.from({ length: 12 }, () => reserve(byRuns.id, 10_000)),
    );
    expect(runResults.filter((r) => r.outcome === "reserved")).toHaveLength(5);
    expect(
      runResults.filter((r) => r.outcome === "allowance_exhausted"),
    ).toHaveLength(7);
    expect(await usage(byRuns.id)).toEqual({ runs: 5, amount: 50_000 });

    // 1_000_000 cap / 300_000 each: three fit, the rest do not.
    const byBudget = await createMandate(newUserId(), {
      periodCap: {
        amount: { amountMinor: 1_000_000, currency: "NGN" },
        runs: 50,
        period: "month",
      },
    });
    const budgetResults = await Promise.all(
      Array.from({ length: 10 }, () => reserve(byBudget.id, 300_000)),
    );
    expect(budgetResults.filter((r) => r.outcome === "reserved")).toHaveLength(
      3,
    );
    expect(await usage(byBudget.id)).toEqual({ runs: 3, amount: 900_000 });
  });
});

describe("mandate runs go through the canonical mechanism", () => {
  it("a run records a reservation committed at its price and tied to its grant", async () => {
    const userId = newUserId();
    const res = await post<Envelope<{ mandate: MandateView }>>(
      harness.app,
      "/mandates",
      await userHeaders({ userId }, key()),
      {
        action: "flight.rebook_on_cancel",
        title: "Rebook if my flight is cancelled",
        passengers: "self_only",
        categories: ["economy"],
        perRunCap: { amountMinor: 300_000, currency: "NGN" },
        periodCap: {
          amount: { amountMinor: 3_000_000, currency: "NGN" },
          runs: 20,
          period: "month",
        },
        constraints: [],
        expiresAt: "2027-03-01T00:00:00.000Z",
        assurance: { method: "pin", proof: "step-up" },
      },
    );
    const mandateId = res.body.data?.mandate.id as string;
    const run = await post<
      Envelope<{ outcome: string; grant: { id: string } | null }>
    >(
      harness.app,
      `/internal/mandates/${mandateId}/run`,
      serviceHeaders(key()),
      {
        triggerRef: `trg_${key()}`,
        price: { amountMinor: 120_000, currency: "NGN" },
        resourceRef: `offer_${key()}`,
        termsVersion: "air_terms_v2",
      },
    );
    expect(run.body.data?.outcome).toBe("executed");
    const grantId = run.body.data?.grant?.id;
    const reservations = await prisma.mandateAllowanceReservation.findMany({
      where: { mandateId },
    });
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({
      status: "committed",
      grantId,
      resultRef: grantId,
      reservedMinor: 120_000n,
      committedMinor: 120_000n,
    });
    expect(await usage(mandateId)).toEqual({ runs: 1, amount: 120_000 });
  });
});
