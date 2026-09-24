/**
 * Business booking reservations (A06 part C) against real Postgres:
 * reserve / commit / release exactly once, concurrent reservations that can
 * never overspend a budget, idempotent replay and conflicting replay, refusal
 * (never deferral) without budget, policy and authority derived server-side,
 * the payer / passenger cancel rights, and the trail every op leaves.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BUSINESS_CANCEL_PARTIES,
  BUSINESS_REFUSAL_REASONS,
  BusinessOpResultSchema,
  BusinessPolicyCheckResultSchema,
  BudgetAccountViewSchema,
} from "../../../../packages/contracts/src/business-travel";
import {
  allocateBudget,
  budgetView,
  returnBudget,
  topUpOrganization,
} from "../../src/business/budgets";
import { CANCEL_PARTIES, REFUSAL_REASONS } from "../../src/business/model";
import {
  checkPolicy,
  commitBudget,
  includedTaxes,
  listMyBusinessBookings,
  listOrganizationBookings,
  releaseBudget,
  reservationStatus,
  reserveBudget,
} from "../../src/business/reservations";
import { buildStatement } from "../../src/business/statements";
import { balanceOf } from "../../src/ledger/balances";
import { fundWallet, seedUser } from "../ledger/helpers";
import {
  actorOf,
  addCostCentre,
  addMember,
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

import type { WalletDeps } from "../../src/ledger/context";

const db = testDb();
const NOW = new Date("2026-10-15T09:00:00.000Z");
const PERIOD = "2026-10";

afterAll(async () => {
  await closeTestDb();
});

/** Tops the organization up and allocates `amountMinor` to a cost centre. */
async function fund(
  deps: WalletDeps,
  cast: OrgCast,
  amountMinor: number,
  costCentreId = cast.costCentreId,
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
    { costCentreId, period: PERIOD, amountMinor },
    key(),
  );
  return allocated.result.budget.budgetId;
}

async function budgetOf(budgetId: string) {
  const account = await db.orgBudgetAccount.findUniqueOrThrow({
    where: { id: budgetId },
  });
  return BudgetAccountViewSchema.parse(await budgetView(db, account));
}

describe("the refusal and cancel vocabularies match the contract", () => {
  it("mirrors them exactly", () => {
    expect([...REFUSAL_REASONS]).toEqual([...BUSINESS_REFUSAL_REASONS]);
    expect([...CANCEL_PARTIES]).toEqual([...BUSINESS_CANCEL_PARTIES]);
  });
});

describe("reserve → commit, exactly once", () => {
  let cast: OrgCast;
  let deps: WalletDeps;
  let budgetId: string;
  beforeAll(async () => {
    cast = await seedOrganization(db);
    deps = depsAt(db, NOW);
    budgetId = await fund(deps, cast, 5_000_000);
  });

  it("reserves without moving money, then commits the ACTUAL amount in one entry and frees the rest", async () => {
    const terms = termsFor(cast, {
      amountMinor: 1_200_000,
      expenseCategory: "client visit",
    });
    const reserved = await reserveBudget(deps, terms, key("reserve"));
    BusinessOpResultSchema.parse({
      ...reserved.result,
      replayed: reserved.replayed,
    });
    expect(reserved.replayed).toBe(false);
    expect(reserved.result.reservation.state).toBe("reserved");
    expect(reserved.result.reservation.costCentreId).toBe(cast.costCentreId); // the traveller's default
    expect(reserved.result.reservation.policyVersion).toBe(3);
    expect(reserved.result.entryId).toBeNull();

    let budget = await budgetOf(budgetId);
    expect(budget.balance.amountMinor).toBe(5_000_000); // untouched
    expect(budget.reserved.amountMinor).toBe(1_200_000);
    expect(budget.available.amountMinor).toBe(3_800_000);

    const committed = await commitBudget(
      deps,
      { bookingRef: terms.bookingRef, actualMinor: 1_075_000, currency: "NGN" },
      key("commit"),
    );
    expect(committed.result.reservation.state).toBe("committed");
    expect(committed.result.reservation.committed?.amountMinor).toBe(1_075_000);
    // VAT 7.5% INCLUDED in the actual total: 1 075 000 × 750 / 10 750 = 75 000.
    expect(committed.result.reservation.taxes).toEqual([
      { code: "vat", rateBps: 750, amountMinor: 75_000 },
    ]);

    const lines = await db.journalLine.findMany({
      where: { entryId: committed.result.entryId ?? "" },
    });
    const entry = await db.journalEntry.findUniqueOrThrow({
      where: { id: committed.result.entryId ?? "" },
    });
    expect(entry.kind).toBe("business_trip_commit");
    expect(entry.reference).toBe(`business_booking:${terms.bookingRef}`);
    expect(
      lines.map((line) => [line.account, Number(line.amountMinor)]).sort(),
    ).toEqual(
      [
        ["business_clearing", 1_075_000],
        ["wallet", -1_075_000],
      ].sort(),
    );

    budget = await budgetOf(budgetId);
    expect(budget.balance.amountMinor).toBe(3_925_000);
    expect(budget.reserved.amountMinor).toBe(0);
    expect(budget.available.amountMinor).toBe(3_925_000); // the 125 000 unused is free again

    // A commit replay (any key, same terms) answers the original; nothing re-posts.
    const replay = await commitBudget(
      deps,
      { bookingRef: terms.bookingRef, actualMinor: 1_075_000, currency: "NGN" },
      key("commit"),
    );
    expect(replay.replayed).toBe(true);
    expect(replay.result.ref).toBe(committed.result.ref);
    expect(
      await db.journalEntry.count({
        where: { reference: `business_booking:${terms.bookingRef}` },
      }),
    ).toBe(1);

    // A second commit for another amount, or a release after commit: refused.
    const different = await refusalOf(
      commitBudget(
        deps,
        { bookingRef: terms.bookingRef, actualMinor: 900_000, currency: "NGN" },
        key(),
      ),
    );
    expect(different.code).toBe("conflict");
    const late = await refusalOf(
      releaseBudget(
        deps,
        {
          bookingRef: terms.bookingRef,
          cancelledBy: { party: "system", userId: null },
          reason: "no_award",
        },
        key(),
      ),
    );
    expect(late.code).toBe("illegal_transition");

    // No driver commission machinery was touched by any of it.
    expect(
      await db.journalLine.count({
        where: {
          entryId: committed.result.entryId ?? "",
          account: "ubi_commission",
        },
      }),
    ).toBe(0);
    expect(
      await db.mpCommissionHold.count({
        where: { requestRef: terms.bookingRef },
      }),
    ).toBe(0);

    // The trail: one op row per op, audit rows and outbox events for each.
    const ops = await db.orgBudgetOp.findMany({
      where: { reservationId: reserved.result.reservation.reservationId },
    });
    expect(ops.map((op) => op.op).sort()).toEqual(["commit", "reserve"]);
    const events = await db.outboxEvent.findMany({
      where: {
        aggregateType: "booking",
        aggregateId: reserved.result.reservation.reservationId,
      },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((event) => event.name)).toEqual([
      "transfer.held",
      "transfer.posted",
    ]);
    expect(
      events.every(
        (event) =>
          (event.payload as { kind?: string }).kind === "business_budget",
      ),
    ).toBe(true);
    const audits = await db.auditLog.findMany({
      where: {
        subjectType: "org_budget_reservation",
        subjectId: reserved.result.reservation.reservationId,
      },
    });
    expect(audits.map((audit) => audit.action).sort()).toEqual([
      "business.booking.committed",
      "business.booking.reserved",
    ]);
  });

  it("refuses a commit above the reservation — the budget was never asked for more", async () => {
    const terms = termsFor(cast, { amountMinor: 500_000 });
    await reserveBudget(deps, terms, key());
    const over = await refusalOf(
      commitBudget(
        deps,
        { bookingRef: terms.bookingRef, actualMinor: 500_001, currency: "NGN" },
        key(),
      ),
    );
    expect(over.code).toBe("conflict");
    const status = await reservationStatus(deps, terms.bookingRef);
    expect(status.reservation.state).toBe("reserved");
  });

  it("releases exactly once and gives the whole reservation back", async () => {
    const terms = termsFor(cast, { amountMinor: 700_000 });
    await reserveBudget(deps, terms, key());
    const before = await budgetOf(budgetId);
    const released = await releaseBudget(
      deps,
      {
        bookingRef: terms.bookingRef,
        cancelledBy: { party: "traveller", userId: cast.traveller.id },
        reason: "plans_changed",
      },
      key("rel"),
    );
    expect(released.result.reservation.state).toBe("released");
    expect(released.result.reservation.releasedBy).toBe("traveller");
    const after = await budgetOf(budgetId);
    expect(after.available.amountMinor).toBe(
      before.available.amountMinor + 700_000,
    );
    expect(after.balance.amountMinor).toBe(before.balance.amountMinor);

    const again = await releaseBudget(
      deps,
      {
        bookingRef: terms.bookingRef,
        cancelledBy: { party: "traveller", userId: cast.traveller.id },
        reason: "plans_changed",
      },
      key("rel"),
    );
    expect(again.replayed).toBe(true);
    const byOther = await refusalOf(
      releaseBudget(
        deps,
        {
          bookingRef: terms.bookingRef,
          cancelledBy: { party: "org_admin", userId: cast.admin.id },
          reason: "duplicate",
        },
        key(),
      ),
    );
    expect(byOther.code).toBe("illegal_transition");
    const commitAfter = await refusalOf(
      commitBudget(
        deps,
        { bookingRef: terms.bookingRef, actualMinor: 1, currency: "NGN" },
        key(),
      ),
    );
    expect(commitAfter.code).toBe("illegal_transition");
  });
});

describe("idempotency by key and by booking reference", () => {
  let cast: OrgCast;
  let deps: WalletDeps;
  beforeAll(async () => {
    cast = await seedOrganization(db);
    deps = depsAt(db, NOW);
    await fund(deps, cast, 3_000_000);
  });

  it("replays the same key, replays the same booking under a new key, and refuses different terms", async () => {
    const terms = termsFor(cast, { amountMinor: 400_000 });
    const idem = key();
    const first = await reserveBudget(deps, terms, idem);
    const sameKey = await reserveBudget(deps, terms, idem);
    expect(sameKey.replayed).toBe(true);
    expect(sameKey.result).toEqual(first.result);
    const sameBooking = await reserveBudget(deps, terms, key());
    expect(sameBooking.replayed).toBe(true);
    expect(sameBooking.result.ref).toBe(first.result.ref);

    const keyReuse = await refusalOf(
      reserveBudget(deps, { ...terms, amountMinor: 400_001 }, idem),
    );
    expect(keyReuse.code).toBe("idempotency_key_reuse");
    const bookingReuse = await refusalOf(
      reserveBudget(deps, { ...terms, amountMinor: 400_001 }, key()),
    );
    expect(bookingReuse.code).toBe("conflict");

    expect(
      await db.orgBudgetReservation.count({
        where: { bookingRef: terms.bookingRef },
      }),
    ).toBe(1);
    expect(
      await db.orgBudgetOp.count({
        where: {
          reservationId: first.result.reservation.reservationId,
          op: "reserve",
        },
      }),
    ).toBe(1);
  });

  it("collapses concurrent same-key reserves into one reservation with one answer", async () => {
    const terms = termsFor(cast, { amountMinor: 100_000 });
    const idem = key();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => reserveBudget(deps, terms, idem)),
    );
    expect(new Set(results.map((r) => r.result.ref)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(
      await db.orgBudgetReservation.count({
        where: { bookingRef: terms.bookingRef },
      }),
    ).toBe(1);
  });

  it("lets exactly one of a racing commit and release win", async () => {
    const terms = termsFor(cast, { amountMinor: 200_000 });
    await reserveBudget(deps, terms, key());
    const [commit, release] = await Promise.allSettled([
      commitBudget(
        deps,
        { bookingRef: terms.bookingRef, actualMinor: 150_000, currency: "NGN" },
        key(),
      ),
      releaseBudget(
        deps,
        {
          bookingRef: terms.bookingRef,
          cancelledBy: { party: "system", userId: null },
          reason: "no_award",
        },
        key(),
      ),
    ]);
    const winners = [commit, release].filter((r) => r.status === "fulfilled");
    expect(winners).toHaveLength(1);
    const row = await db.orgBudgetReservation.findUniqueOrThrow({
      where: { bookingRef: terms.bookingRef },
    });
    const entries = await db.journalEntry.count({
      where: { reference: `business_booking:${terms.bookingRef}` },
    });
    expect(entries).toBe(row.state === "committed" ? 1 : 0);
  });
});

describe("concurrent reservations never overspend a budget", () => {
  it("funds exactly as many bookings as the budget covers, and not one more", async () => {
    const cast = await seedOrganization(db);
    const deps = depsAt(db, NOW);
    const budgetId = await fund(deps, cast, 5_000_000);

    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        reserveBudget(deps, termsFor(cast, { amountMinor: 1_000_000 }), key()),
      ),
    );
    const funded = attempts.filter((a) => a.status === "fulfilled");
    const refused = attempts.filter(
      (a): a is PromiseRejectedResult => a.status === "rejected",
    );
    expect(funded).toHaveLength(5);
    expect(refused).toHaveLength(7);
    for (const rejection of refused) {
      const error = rejection.reason as {
        code?: string;
        details?: { reason?: string };
      };
      expect(error.code).toBe("insufficient_spendable");
      expect(error.details?.reason).toBe("budget_insufficient");
    }

    const budget = await budgetOf(budgetId);
    expect(budget.reserved.amountMinor).toBe(5_000_000);
    expect(budget.available.amountMinor).toBe(0);
    const rows = await db.orgBudgetReservation.findMany({
      where: { budgetAccountId: budgetId, state: "reserved" },
    });
    expect(rows).toHaveLength(5);
  });

  it("keeps a return and reservations racing for the same money from ever overdrawing", async () => {
    const cast = await seedOrganization(db);
    const deps = depsAt(db, NOW);
    const budgetId = await fund(deps, cast, 2_000_000);
    const racers = await Promise.allSettled([
      ...Array.from({ length: 4 }, () =>
        reserveBudget(deps, termsFor(cast, { amountMinor: 600_000 }), key()),
      ),
      returnBudget(
        deps,
        actorOf(cast.owner),
        cast.orgId,
        {
          costCentreId: cast.costCentreId,
          period: PERIOD,
          amountMinor: 900_000,
        },
        key(),
      ),
    ]);
    const budget = await budgetOf(budgetId);
    expect(budget.available.amountMinor).toBeGreaterThanOrEqual(0);
    expect(budget.balance.amountMinor).toBeGreaterThanOrEqual(
      budget.reserved.amountMinor,
    );
    const reservedTotal = await db.orgBudgetReservation.aggregate({
      _sum: { reservedMinor: true },
      where: { budgetAccountId: budgetId, state: "reserved" },
    });
    expect(Number(reservedTotal._sum.reservedMinor ?? 0n)).toBe(
      budget.reserved.amountMinor,
    );
    expect(
      racers.filter((r) => r.status === "fulfilled").length,
    ).toBeGreaterThan(0);
  });
});

describe("no budget, no booking — refused, never deferred", () => {
  it("refuses a cost centre with no budget for the period even when the organization wallet has money", async () => {
    const cast = await seedOrganization(db);
    const deps = depsAt(db, NOW);
    await topUpOrganization(
      deps,
      actorOf(cast.owner),
      cast.orgId,
      { methodId: "card", amountMinor: 9_000_000 },
      key(),
    );
    const terms = termsFor(cast, { amountMinor: 100_000 });
    const refused = await refusalOf(reserveBudget(deps, terms, key()));
    expect(refused.code).toBe("insufficient_spendable");
    expect(refused.reason).toBe("no_budget_for_period");
    expect(
      await db.orgBudgetReservation.count({
        where: { bookingRef: terms.bookingRef },
      }),
    ).toBe(0);
  });

  it("refuses a booking the budget cannot cover and records nothing", async () => {
    const cast = await seedOrganization(db);
    const deps = depsAt(db, NOW);
    await fund(deps, cast, 300_000);
    const terms = termsFor(cast, { amountMinor: 300_001 });
    const refused = await refusalOf(reserveBudget(deps, terms, key()));
    expect(refused.reason).toBe("budget_insufficient");
    expect(refused.details).toMatchObject({
      availableMinor: 300_000,
      requiredMinor: 300_001,
    });
    expect(
      await db.orgBudgetReservation.count({
        where: { bookingRef: terms.bookingRef },
      }),
    ).toBe(0);
    expect(
      await db.orgBudgetOp.count({
        where: { organizationId: cast.orgId, op: "reserve" },
      }),
    ).toBe(0);
  });
});

describe("policy and authority are derived server-side", () => {
  let cast: OrgCast;
  let deps: WalletDeps;
  beforeAll(async () => {
    cast = await seedOrganization(db, {
      policy: {
        tripCapMinor: 1_000_000,
        allowedServices: ["ride"],
        allowedClasses: ["go"],
      },
    });
    deps = depsAt(db, NOW);
    await fund(deps, cast, 5_000_000);
    await fund(deps, cast, 1_000_000, cast.otherCostCentreId);
  });

  it.each([
    [
      "a service the policy does not allow",
      { service: "delivery" },
      "forbidden",
      "service_not_allowed",
    ],
    [
      "a vehicle class the policy does not allow",
      { vehicleClass: "comfort" },
      "forbidden",
      "class_not_allowed",
    ],
    [
      "an amount above the per-trip cap",
      { amountMinor: 1_000_001 },
      "limit_exceeded",
      "trip_cap_exceeded",
    ],
    [
      "another currency",
      { currency: "KES" },
      "validation_failed",
      "currency_mismatch",
    ],
  ])("refuses %s", async (_label, overrides, code, reason) => {
    const refused = await refusalOf(
      reserveBudget(deps, termsFor(cast, overrides), key()),
    );
    expect(refused.code).toBe(code);
    expect(refused.reason).toBe(reason);
  });

  it("lets a traveller book only for themselves, and bookers and admins for any member", async () => {
    const forOther = await refusalOf(
      reserveBudget(
        deps,
        termsFor(cast, {
          bookerId: cast.traveller.id,
          travellerId: cast.booker.id,
          costCentreId: cast.costCentreId,
        }),
        key(),
      ),
    );
    expect(forOther.reason).toBe("booker_not_authorized");

    const self = await reserveBudget(
      deps,
      termsFor(cast, {
        bookerId: cast.traveller.id,
        travellerId: cast.traveller.id,
        amountMinor: 100_000,
      }),
      key(),
    );
    expect(self.result.reservation.bookerId).toBe(cast.traveller.id);

    const byAdmin = await reserveBudget(
      deps,
      termsFor(cast, { bookerId: cast.admin.id, amountMinor: 100_000 }),
      key(),
    );
    expect(byAdmin.result.reservation.state).toBe("reserved");

    const outsider = await refusalOf(
      reserveBudget(
        deps,
        termsFor(cast, { bookerId: cast.outsider.id }),
        key(),
      ),
    );
    expect(outsider.reason).toBe("booker_not_authorized");
    const outsiderTraveller = await refusalOf(
      reserveBudget(
        deps,
        termsFor(cast, {
          travellerId: cast.outsider.id,
          costCentreId: cast.costCentreId,
        }),
        key(),
      ),
    );
    expect(outsiderTraveller.reason).toBe("traveller_not_member");
  });

  it("stops a removed booker at the next reservation", async () => {
    await db.organizationMember.updateMany({
      where: { organizationId: cast.orgId, userId: cast.booker.id },
      data: { status: "removed", removedAt: NOW },
    });
    try {
      const refused = await refusalOf(
        reserveBudget(deps, termsFor(cast, { amountMinor: 100_000 }), key()),
      );
      expect(refused.reason).toBe("booker_not_authorized");
    } finally {
      await db.organizationMember.updateMany({
        where: { organizationId: cast.orgId, userId: cast.booker.id },
        data: { status: "active", removedAt: null },
      });
    }
  });

  it("charges the named cost centre, and refuses an archived or foreign one", async () => {
    const named = await reserveBudget(
      deps,
      termsFor(cast, {
        costCentreId: cast.otherCostCentreId,
        amountMinor: 100_000,
      }),
      key(),
    );
    expect(named.result.reservation.costCentreId).toBe(cast.otherCostCentreId);

    const archived = await addCostCentre(db, cast.orgId, "OLD");
    await db.organizationCostCentre.update({
      where: { id: archived },
      data: { status: "archived" },
    });
    const refusedArchived = await refusalOf(
      reserveBudget(deps, termsFor(cast, { costCentreId: archived }), key()),
    );
    expect(refusedArchived.reason).toBe("cost_centre_invalid");

    const other = await seedOrganization(db, { city: cast.city });
    const refusedForeign = await refusalOf(
      reserveBudget(
        deps,
        termsFor(cast, { costCentreId: other.costCentreId }),
        key(),
      ),
    );
    expect(refusedForeign.reason).toBe("cost_centre_invalid");
  });

  it("answers a read-only policy check with every reason at once", async () => {
    const verdict = BusinessPolicyCheckResultSchema.parse(
      await checkPolicy(
        deps,
        termsFor(cast, {
          service: "delivery",
          vehicleClass: "xl",
          amountMinor: 2_000_000,
        }),
      ),
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.reasons).toEqual([
      "service_not_allowed",
      "class_not_allowed",
      "trip_cap_exceeded",
    ]);
    const fine = BusinessPolicyCheckResultSchema.parse(
      await checkPolicy(deps, termsFor(cast, { amountMinor: 100_000 })),
    );
    expect(fine).toMatchObject({
      allowed: true,
      reasons: [],
      costCentreId: cast.costCentreId,
      policyVersion: 3,
    });
    expect(fine.available?.amountMinor).toBeGreaterThan(0);
  });

  it("refuses everything for a suspended organization", async () => {
    const suspended = await seedOrganization(db, { status: "suspended" });
    const refused = await refusalOf(
      reserveBudget(depsAt(db, NOW), termsFor(suspended), key()),
    );
    expect(refused.reason).toBe("organization_not_active");
  });
});

describe("the payer / passenger cancel rights", () => {
  let cast: OrgCast;
  let deps: WalletDeps;
  let secondBooker: { id: string };
  beforeAll(async () => {
    cast = await seedOrganization(db);
    deps = depsAt(db, NOW);
    await fund(deps, cast, 5_000_000);
    secondBooker = await seedUser(db, "Kemi");
    await addMember(db, cast.orgId, secondBooker.id, "booker");
  });

  async function booked(): Promise<string> {
    const terms = termsFor(cast, { amountMinor: 100_000 });
    await reserveBudget(deps, terms, key());
    return terms.bookingRef;
  }

  it.each([
    ["the traveller", "traveller", "traveller", true],
    ["the booker who made it", "booker", "booker", true],
    ["an org admin", "org_admin", "admin", true],
    ["an org owner", "org_admin", "owner", true],
    ["another booker", "booker", "secondBooker", false],
    ["a booker claiming to be the traveller", "traveller", "booker", false],
    ["a traveller claiming admin rights", "org_admin", "traveller", false],
    ["an outsider claiming admin rights", "org_admin", "outsider", false],
  ] as const)(
    "%s, cancelling as %s — allowed: %s",
    async (_label, party, who, allowed) => {
      const bookingRef = await booked();
      const userId =
        who === "secondBooker"
          ? secondBooker.id
          : (cast[who] as { id: string }).id;
      const attempt = releaseBudget(
        deps,
        { bookingRef, cancelledBy: { party, userId }, reason: "cancelled" },
        key(),
      );
      if (allowed) {
        const released = await attempt;
        expect(released.result.reservation.releasedBy).toBe(party);
      } else {
        const refused = await refusalOf(attempt);
        expect(refused.code).toBe("forbidden");
        expect(refused.reason).toBe("cancel_not_permitted");
      }
    },
  );

  it("keeps the passenger's right to cancel after they leave the organization, and ends the booker's with removal", async () => {
    const first = await booked();
    const second = await booked();
    await db.organizationMember.updateMany({
      where: {
        organizationId: cast.orgId,
        userId: { in: [cast.traveller.id, cast.booker.id] },
      },
      data: { status: "removed", removedAt: NOW },
    });
    try {
      const byBooker = await refusalOf(
        releaseBudget(
          deps,
          {
            bookingRef: first,
            cancelledBy: { party: "booker", userId: cast.booker.id },
            reason: "cancelled",
          },
          key(),
        ),
      );
      expect(byBooker.reason).toBe("cancel_not_permitted");
      const byTraveller = await releaseBudget(
        deps,
        {
          bookingRef: second,
          cancelledBy: { party: "traveller", userId: cast.traveller.id },
          reason: "cancelled",
        },
        key(),
      );
      expect(byTraveller.result.reservation.state).toBe("released");
    } finally {
      await db.organizationMember.updateMany({
        where: {
          organizationId: cast.orgId,
          userId: { in: [cast.traveller.id, cast.booker.id] },
        },
        data: { status: "active", removedAt: null },
      });
    }
  });

  it("requires a system release to name no user, and every other party to name one", async () => {
    const bookingRef = await booked();
    expect(
      (
        await refusalOf(
          releaseBudget(
            deps,
            {
              bookingRef,
              cancelledBy: { party: "system", userId: cast.admin.id },
              reason: "no_award",
            },
            key(),
          ),
        )
      ).code,
    ).toBe("validation_failed");
    expect(
      (
        await refusalOf(
          releaseBudget(
            deps,
            {
              bookingRef,
              cancelledBy: { party: "traveller", userId: null },
              reason: "cancelled",
            },
            key(),
          ),
        )
      ).code,
    ).toBe("validation_failed");
  });
});

describe("the kill switch stops new bookings but never strands money", () => {
  it("refuses a new reservation, and still commits and releases existing ones", async () => {
    const cast = await seedOrganization(db);
    const deps = depsAt(db, NOW);
    await fund(deps, cast, 2_000_000);
    const toCommit = termsFor(cast, { amountMinor: 300_000 });
    const toRelease = termsFor(cast, { amountMinor: 300_000 });
    await reserveBudget(deps, toCommit, key());
    await reserveBudget(deps, toRelease, key());

    await setBusinessTravel(db, cast.city.cityId, false);
    const refused = await refusalOf(reserveBudget(deps, termsFor(cast), key()));
    expect(refused.code).toBe("feature_disabled");
    const verdict = await checkPolicy(deps, termsFor(cast, { amountMinor: 1 }));
    expect(verdict.reasons).toContain("feature_disabled");

    const committed = await commitBudget(
      deps,
      {
        bookingRef: toCommit.bookingRef,
        actualMinor: 300_000,
        currency: "NGN",
      },
      key(),
    );
    expect(committed.result.reservation.state).toBe("committed");
    const released = await releaseBudget(
      deps,
      {
        bookingRef: toRelease.bookingRef,
        cancelledBy: { party: "system", userId: null },
        reason: "kill_switch",
      },
      key(),
    );
    expect(released.result.reservation.state).toBe("released");
  });
});

describe("a paused city never strands money", () => {
  it("refuses new bookings but still commits (with VAT), releases, returns and reports", async () => {
    const cast = await seedOrganization(db);
    const deps = depsAt(db, NOW);
    await fund(deps, cast, 2_000_000);
    const toCommit = termsFor(cast, { amountMinor: 1_075_000 });
    const toRelease = termsFor(cast, { amountMinor: 200_000 });
    await reserveBudget(deps, toCommit, key());
    await reserveBudget(deps, toRelease, key());

    await db.city.update({
      where: { id: cast.city.cityId },
      data: { active: false, status: "paused" },
    });
    try {
      const refused = await refusalOf(
        reserveBudget(deps, termsFor(cast), key()),
      );
      expect(refused.code).toBe("city_unsupported");

      const committed = await commitBudget(
        deps,
        {
          bookingRef: toCommit.bookingRef,
          actualMinor: 1_075_000,
          currency: "NGN",
        },
        key(),
      );
      expect(committed.result.reservation.taxes).toEqual([
        { code: "vat", rateBps: 750, amountMinor: 75_000 },
      ]);
      const released = await releaseBudget(
        deps,
        {
          bookingRef: toRelease.bookingRef,
          cancelledBy: { party: "system", userId: null },
          reason: "city_paused",
        },
        key(),
      );
      expect(released.result.reservation.state).toBe("released");
      const back = await returnBudget(
        deps,
        actorOf(cast.owner),
        cast.orgId,
        {
          costCentreId: cast.costCentreId,
          period: PERIOD,
          amountMinor: 925_000,
        },
        key(),
      );
      expect(back.result.budget.balance.amountMinor).toBe(0);
      const statement = await buildStatement(
        deps,
        actorOf(cast.admin),
        cast.orgId,
        PERIOD,
      );
      expect(statement.totals.gross.amountMinor).toBe(1_075_000);
    } finally {
      await db.city.update({
        where: { id: cast.city.cityId },
        data: { active: true, status: "active" },
      });
    }
  });
});

describe("who sees which bookings", () => {
  it("shows admins every business booking, bookers their own, travellers only their own — and nothing personal", async () => {
    const cast = await seedOrganization(db);
    const deps = depsAt(db, NOW);
    await fund(deps, cast, 3_000_000);
    const byBooker = await reserveBudget(
      deps,
      termsFor(cast, { amountMinor: 100_000 }),
      key(),
    );
    const byAdmin = await reserveBudget(
      deps,
      termsFor(cast, { bookerId: cast.admin.id, amountMinor: 100_000 }),
      key(),
    );

    // The traveller's PERSONAL activity: their own wallet, funded and spent on
    // a personal travel item — never part of the organization's view.
    const personal = await db.wallet.create({
      data: {
        id: uid("wal"),
        ownerType: "user",
        ownerId: cast.traveller.id,
        currency: "NGN",
        tier: "tier1",
      },
    });
    await fundWallet(db, personal.id, "NGN", 777_777);

    const adminView = await listOrganizationBookings(
      deps,
      actorOf(cast.admin),
      cast.orgId,
      PERIOD,
    );
    expect(adminView.map((b) => b.bookingRef).sort()).toEqual(
      [
        byBooker.result.reservation.bookingRef,
        byAdmin.result.reservation.bookingRef,
      ].sort(),
    );
    const serialized = JSON.stringify(adminView);
    expect(serialized).not.toContain(personal.id);
    expect(serialized).not.toContain("777777");

    const bookerView = await listOrganizationBookings(
      deps,
      actorOf(cast.booker),
      cast.orgId,
      undefined,
    );
    expect(bookerView.map((b) => b.bookingRef)).toEqual([
      byBooker.result.reservation.bookingRef,
    ]);

    expect(
      (
        await refusalOf(
          listOrganizationBookings(
            deps,
            actorOf(cast.traveller),
            cast.orgId,
            undefined,
          ),
        )
      ).code,
    ).toBe("forbidden");
    expect(
      (
        await refusalOf(
          listOrganizationBookings(
            deps,
            actorOf(cast.outsider),
            cast.orgId,
            undefined,
          ),
        )
      ).code,
    ).toBe("not_found");

    const mine = await listMyBusinessBookings(deps, actorOf(cast.traveller));
    expect(mine.map((b) => b.bookingRef).sort()).toEqual(
      [
        byBooker.result.reservation.bookingRef,
        byAdmin.result.reservation.bookingRef,
      ].sort(),
    );
    expect(await listMyBusinessBookings(deps, actorOf(cast.admin))).toEqual([]);
  });
});

describe("included taxes", () => {
  it("itemises configured rates inside the total, half-up, and nothing when none is configured", () => {
    expect(includedTaxes({ vat: 7.5 }, 1_075_000)).toEqual([
      { code: "vat", rateBps: 750, amountMinor: 75_000 },
    ]);
    expect(includedTaxes({ vat: 7.5 }, 1)).toEqual([
      { code: "vat", rateBps: 750, amountMinor: 0 },
    ]);
    expect(includedTaxes({ vat: 7.5 }, 15)).toEqual([
      { code: "vat", rateBps: 750, amountMinor: 1 },
    ]);
    expect(includedTaxes({}, 1_000_000)).toEqual([]);
    expect(includedTaxes({ vat: 0, bogus: 150 }, 1_000_000)).toEqual([]);
    // Large totals stay exact (BigInt arithmetic).
    expect(
      includedTaxes({ vat: 7.5 }, 9_007_199_254_740_991)[0]?.amountMinor,
    ).toBe(628_409_250_330_767);
  });

  it("leaves the organization wallet balance derivable from the journal at every step", async () => {
    const cast = await seedOrganization(db);
    const deps = depsAt(db, NOW);
    await fund(deps, cast, 1_000_000);
    const orgWallet = await db.wallet.findUniqueOrThrow({
      where: {
        ownerType_ownerId_currency: {
          ownerType: "organization",
          ownerId: cast.orgId,
          currency: "NGN",
        },
      },
    });
    expect((await balanceOf(db, orgWallet.id, "NGN")).amountMinor).toBe(0);
  });
});
