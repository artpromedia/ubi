/**
 * The business RESERVE TOP-UP (round-7 follow-up) against real Postgres: an
 * ACTIVE reservation raised for an approved fare increase or paid waiting —
 * atomic against the budget's row lock (concurrent top-ups and new
 * reservations never overspend it), refused without available budget (no
 * credit), within the per-trip cap, exactly once per key and per reasonRef,
 * audited and evented.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  actorOf,
  closeTestDb,
  depsAt,
  key,
  refusalOf,
  seedOrganization,
  setBusinessTravel,
  termsFor,
  testDb,
  uid,
  type OrgCast,
} from "./fixtures";
import {
  BusinessOpResultSchema,
  BusinessReservationStatusSchema,
} from "../../../../packages/contracts/src/business-travel";
import {
  allocateBudget,
  budgetView,
  topUpOrganization,
} from "../../src/business/budgets";
import {
  commitBudget,
  increaseReservation,
  releaseBudget,
  reservationStatus,
  reserveBudget,
  type IncreaseInput,
} from "../../src/business/reservations";

import type { WalletDeps } from "../../src/ledger/context";

const db = testDb();
const NOW = new Date("2026-10-15T09:00:00.000Z");
const PERIOD = "2026-10";

afterAll(async () => {
  await closeTestDb();
});

async function fundedBudget(
  deps: WalletDeps,
  cast: OrgCast,
  amountMinor: number,
): Promise<string> {
  await topUpOrganization(
    deps,
    actorOf(cast.owner),
    cast.orgId,
    { methodId: "card", amountMinor },
    key(),
  );
  const allocated = await allocateBudget(
    deps,
    actorOf(cast.owner),
    cast.orgId,
    { costCentreId: cast.costCentreId, period: PERIOD, amountMinor },
    key(),
  );
  return allocated.result.budget.budgetId;
}

async function available(budgetId: string): Promise<number> {
  const account = await db.orgBudgetAccount.findUniqueOrThrow({
    where: { id: budgetId },
  });
  return (await budgetView(db, account)).available.amountMinor;
}

function increase(
  bookingRef: string,
  overrides: Partial<IncreaseInput> = {},
): IncreaseInput {
  return {
    bookingRef,
    amountMinor: 150_000,
    currency: "NGN",
    reason: "fare_increase",
    reasonRef: uid("amd"),
    ...overrides,
  };
}

describe("raising an active reservation", () => {
  let cast: OrgCast;
  let deps: WalletDeps;
  let budgetId: string;
  beforeAll(async () => {
    cast = await seedOrganization(db);
    deps = depsAt(db, NOW);
    budgetId = await fundedBudget(deps, cast, 1_000_000);
  });

  it("raises it under the budget lock, answers the op shape, and lets the trip commit the new total", async () => {
    const terms = termsFor(cast, { amountMinor: 400_000 });
    await reserveBudget(deps, terms, key("reserve"));
    expect(await available(budgetId)).toBe(600_000);

    const input = increase(terms.bookingRef, { reason: "paid_waiting" });
    const raised = await increaseReservation(deps, input, key("topup"));
    expect(raised.replayed).toBe(false);
    BusinessOpResultSchema.parse({ ...raised.result, replayed: false });
    expect(raised.result).toMatchObject({
      op: "reserve",
      entryId: null,
      amount: { amountMinor: 150_000, currency: "NGN" },
      increase: {
        reason: "paid_waiting",
        reasonRef: input.reasonRef,
        previousReserved: { amountMinor: 400_000, currency: "NGN" },
        reserved: { amountMinor: 550_000, currency: "NGN" },
      },
    });
    expect(raised.result.reservation.reserved.amountMinor).toBe(550_000);
    expect(await available(budgetId)).toBe(450_000);

    // Audited and evented, and listed on the reservation's status.
    const reservationId = raised.result.reservation.reservationId;
    expect(
      await db.auditLog.count({
        where: {
          subjectId: reservationId,
          action: "business.booking.reserve_increased",
        },
      }),
    ).toBe(1);
    const event = await db.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `business.reserve:${raised.result.ref}` },
    });
    expect(event.name).toBe("transfer.held");
    expect(event.payload).toMatchObject({
      kind: "business_budget",
      op: "reserve",
      increase: true,
      amountMinor: 150_000,
      reservedMinor: 550_000,
    });
    const status = BusinessReservationStatusSchema.parse(
      JSON.parse(
        JSON.stringify(await reservationStatus(deps, terms.bookingRef)),
      ),
    );
    expect(status.ops.map((op) => [op.op, op.amount.amountMinor])).toEqual([
      ["reserve", 400_000],
      ["reserve", 150_000],
    ]);

    // Never more than reserved; the new total commits.
    const over = await refusalOf(
      commitBudget(
        deps,
        { bookingRef: terms.bookingRef, actualMinor: 550_001, currency: "NGN" },
        key(),
      ),
    );
    expect(over.code).toBe("conflict");
    const committed = await commitBudget(
      deps,
      { bookingRef: terms.bookingRef, actualMinor: 550_000, currency: "NGN" },
      key("commit"),
    );
    expect(committed.result.reservation.committed?.amountMinor).toBe(550_000);
    expect(await available(budgetId)).toBe(450_000);
  });

  it("is exactly once per key and per reasonRef", async () => {
    const terms = termsFor(cast, { amountMinor: 100_000 });
    await reserveBudget(deps, terms, key("reserve"));
    const input = increase(terms.bookingRef, { amountMinor: 50_000 });
    const idem = key("topup");
    const first = await increaseReservation(deps, input, idem);
    const sameKey = await increaseReservation(deps, input, idem);
    expect(sameKey).toMatchObject({ replayed: true });
    expect(sameKey.result.ref).toBe(first.result.ref);
    // The same approval under another key: the original, not a second raise.
    const otherKey = await increaseReservation(deps, input, key("topup"));
    expect(otherKey.replayed).toBe(true);
    expect(otherKey.result.ref).toBe(first.result.ref);
    // The same approval with other terms, and a key reused for other terms.
    expect(
      (
        await refusalOf(
          increaseReservation(
            deps,
            { ...input, amountMinor: 60_000 },
            key("topup"),
          ),
        )
      ).code,
    ).toBe("conflict");
    expect(
      (
        await refusalOf(
          increaseReservation(
            deps,
            increase(terms.bookingRef, { amountMinor: 10_000 }),
            idem,
          ),
        )
      ).code,
    ).toBe("idempotency_key_reuse");
    const row = await db.orgBudgetReservation.findUniqueOrThrow({
      where: { bookingRef: terms.bookingRef },
    });
    expect(Number(row.reservedMinor)).toBe(150_000);
  });

  it("refuses — never credits — what the budget cannot cover, and what breaks the organization's policy", async () => {
    const small = await seedOrganization(db, {
      policy: {
        tripCapMinor: 300_000,
        allowedServices: ["ride"],
        allowedClasses: ["go"],
      },
    });
    const smallDeps = depsAt(db, NOW);
    const smallBudget = await fundedBudget(smallDeps, small, 260_000);
    const terms = termsFor(small, { amountMinor: 250_000 });
    await reserveBudget(smallDeps, terms, key("reserve"));

    // 10 000 available; 20 000 more stays under the 300 000 per-trip cap.
    const noBudget = await refusalOf(
      increaseReservation(
        smallDeps,
        increase(terms.bookingRef, { amountMinor: 20_000 }),
        key(),
      ),
    );
    expect(noBudget).toMatchObject({
      code: "insufficient_spendable",
      reason: "budget_insufficient",
    });
    const overCap = await refusalOf(
      increaseReservation(
        smallDeps,
        increase(terms.bookingRef, { amountMinor: 60_000 }),
        key(),
      ),
    );
    expect(overCap).toMatchObject({
      code: "limit_exceeded",
      reason: "trip_cap_exceeded",
    });
    const wrongCurrency = await refusalOf(
      increaseReservation(
        smallDeps,
        increase(terms.bookingRef, { amountMinor: 10_000, currency: "KES" }),
        key(),
      ),
    );
    expect(wrongCurrency.reason).toBe("currency_mismatch");
    expect(await available(smallBudget)).toBe(10_000);

    // Only an ACTIVE reservation grows.
    await releaseBudget(
      smallDeps,
      {
        bookingRef: terms.bookingRef,
        cancelledBy: { party: "system", userId: null },
        reason: "no_award",
      },
      key(),
    );
    expect(
      (
        await refusalOf(
          increaseReservation(
            smallDeps,
            increase(terms.bookingRef, { amountMinor: 10_000 }),
            key(),
          ),
        )
      ).code,
    ).toBe("illegal_transition");
    expect(
      (
        await refusalOf(
          increaseReservation(smallDeps, increase(uid("nothing")), key()),
        )
      ).code,
    ).toBe("not_found");
  });

  it("is deny-by-default: business_travel off refuses a top-up (it is new spend)", async () => {
    const off = await seedOrganization(db);
    const offDeps = depsAt(db, NOW);
    await fundedBudget(offDeps, off, 500_000);
    const terms = termsFor(off, { amountMinor: 100_000 });
    await reserveBudget(offDeps, terms, key("reserve"));
    await setBusinessTravel(db, off.city.cityId, false);
    const refused = await refusalOf(
      increaseReservation(offDeps, increase(terms.bookingRef), key()),
    );
    expect(refused.code).toBe("feature_disabled");
  });
});

describe("under concurrency the budget is never overspent", () => {
  it("serializes top-ups and new reservations on the budget row lock", async () => {
    const cast = await seedOrganization(db);
    const deps = depsAt(db, NOW);
    const budgetId = await fundedBudget(deps, cast, 1_000_000);
    const terms = termsFor(cast, { amountMinor: 400_000 });
    await reserveBudget(deps, terms, key("reserve"));

    // 600 000 available; 8 top-ups and 2 new bookings of 150 000 each race.
    const attempts = [
      ...Array.from({ length: 8 }, async () => {
        const outcome = await increaseReservation(
          deps,
          increase(terms.bookingRef),
          key("topup"),
        );
        return outcome;
      }),
      ...Array.from({ length: 2 }, async () => {
        const outcome = await reserveBudget(
          deps,
          termsFor(cast, { amountMinor: 150_000 }),
          key("reserve"),
        );
        return outcome;
      }),
    ];
    const settled = await Promise.allSettled(attempts);
    const won = settled.filter((outcome) => outcome.status === "fulfilled");
    const lost = settled.filter((outcome) => outcome.status === "rejected");
    expect(won).toHaveLength(4);
    for (const outcome of lost) {
      expect((outcome as PromiseRejectedResult).reason).toMatchObject({
        code: "insufficient_spendable",
        details: { reason: "budget_insufficient" },
      });
    }
    expect(await available(budgetId)).toBe(0);
    const reserved = await db.orgBudgetReservation.aggregate({
      _sum: { reservedMinor: true },
      where: { budgetAccountId: budgetId, state: "reserved" },
    });
    expect(Number(reserved._sum.reservedMinor)).toBe(1_000_000);
  });
});
