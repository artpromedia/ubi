/**
 * Prefunded organization money and cost-centre budgets on the canonical
 * ledger (A06 part C): top-ups through the wallet top-up rail, allocations
 * and returns as journal entries, balances derived from journal lines, no
 * overdraft anywhere, idempotency, authority and deny-by-default.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BUSINESS_LEDGER,
  BudgetAccountViewSchema,
  OrgFundingViewSchema,
} from "../../../../packages/contracts/src/business-travel";
import {
  allocateBudget,
  fundingView,
  listBudgets,
  returnBudget,
  topUpOrganization,
} from "../../src/business/budgets";
import {
  BUDGET_WALLET_OWNER,
  ORG_WALLET_OWNER,
} from "../../src/business/model";
import { balanceOf } from "../../src/ledger/balances";
import {
  actorOf,
  closeTestDb,
  depsAt,
  key,
  RecordingTopupRail,
  refusalOf,
  seedOrganization,
  setBusinessTravel,
  testDb,
  type OrgCast,
} from "./fixtures";

const db = testDb();
const NOW = new Date("2026-10-15T09:00:00.000Z");
const PERIOD = "2026-10";

afterAll(async () => {
  await closeTestDb();
});

describe("the ledger vocabulary matches the contract", () => {
  it("uses the contract's owner types, clearing account and entry kinds", () => {
    expect(ORG_WALLET_OWNER).toBe(BUSINESS_LEDGER.organizationWalletOwnerType);
    expect(BUDGET_WALLET_OWNER).toBe(BUSINESS_LEDGER.budgetWalletOwnerType);
  });
});

describe("organization top-up through the wallet top-up rail", () => {
  let cast: OrgCast;
  beforeAll(async () => {
    cast = await seedOrganization(db);
  });

  it("captures at the rail, then posts psp_settlement → organization wallet and records the top-up", async () => {
    const rail = new RecordingTopupRail();
    const deps = depsAt(db, NOW, rail);
    const idem = key();
    const outcome = await topUpOrganization(
      deps,
      actorOf(cast.admin),
      cast.orgId,
      { methodId: "card", amountMinor: 10_000_000 },
      idem,
    );
    expect(outcome.replayed).toBe(false);
    expect(rail.captures).toHaveLength(1);
    expect(outcome.result.amount).toEqual({
      amountMinor: 10_000_000,
      currency: "NGN",
    });
    expect(outcome.result.unallocated.amountMinor).toBe(10_000_000);

    const wallet = await db.wallet.findUniqueOrThrow({
      where: {
        ownerType_ownerId_currency: {
          ownerType: "organization",
          ownerId: cast.orgId,
          currency: "NGN",
        },
      },
    });
    const lines = await db.journalLine.findMany({
      where: { entryId: outcome.result.entryId },
    });
    expect(
      lines
        .map((line) => [line.account, line.walletId, Number(line.amountMinor)])
        .sort(),
    ).toEqual(
      [
        ["psp_settlement", null, -10_000_000],
        ["wallet", wallet.id, 10_000_000],
      ].sort(),
    );
    const topup = await db.topup.findUniqueOrThrow({
      where: { id: outcome.result.topupId },
    });
    expect(topup.walletId).toBe(wallet.id);
    expect(topup.status).toBe("captured");

    // Replay: same result, no second capture or entry.
    const replay = await topUpOrganization(
      deps,
      actorOf(cast.admin),
      cast.orgId,
      { methodId: "card", amountMinor: 10_000_000 },
      idem,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.result.ref).toBe(outcome.result.ref);
    expect(rail.captures).toHaveLength(1);

    // Same key, different money: refused.
    const reuse = await refusalOf(
      topUpOrganization(
        deps,
        actorOf(cast.admin),
        cast.orgId,
        { methodId: "card", amountMinor: 1 },
        idem,
      ),
    );
    expect(reuse.code).toBe("idempotency_key_reuse");

    const audit = await db.auditLog.findFirstOrThrow({
      where: {
        subjectType: "wallet",
        subjectId: wallet.id,
        action: "business.organization.topped_up",
      },
    });
    expect(audit.actorId).toBe(cast.admin.id);
    const event = await db.outboxEvent.findFirstOrThrow({
      where: {
        aggregateType: "wallet",
        aggregateId: wallet.id,
        name: "topup.captured",
      },
    });
    expect(event.payload).toMatchObject({
      kind: "business_budget",
      op: "topup",
      organizationId: cast.orgId,
    });
  });

  it("lets only owners and admins top up; outsiders cannot see the organization", async () => {
    const deps = depsAt(db, NOW);
    for (const [user, code] of [
      [cast.booker, "forbidden"],
      [cast.traveller, "forbidden"],
      [cast.outsider, "not_found"],
    ] as const) {
      const refused = await refusalOf(
        topUpOrganization(
          deps,
          actorOf(user),
          cast.orgId,
          { methodId: "card", amountMinor: 1_000 },
          key(),
        ),
      );
      expect(refused.code).toBe(code);
    }
  });

  it("records nothing when the rail refuses the capture", async () => {
    const failing = new RecordingTopupRail(true);
    const deps = depsAt(db, NOW, failing);
    const before = await db.topup.count();
    await expect(
      topUpOrganization(
        deps,
        actorOf(cast.owner),
        cast.orgId,
        { methodId: "card", amountMinor: 5_000 },
        key(),
      ),
    ).rejects.toThrow("rail refused the capture");
    expect(await db.topup.count()).toBe(before);
    expect(
      await db.orgBudgetOp.count({
        where: { organizationId: cast.orgId, op: "topup", amountMinor: 5_000n },
      }),
    ).toBe(0);
  });

  it("is deny-by-default: business_travel off refuses a NEW top-up", async () => {
    const off = await seedOrganization(db);
    await setBusinessTravel(db, off.city.cityId, false);
    const refused = await refusalOf(
      topUpOrganization(
        depsAt(db, NOW),
        actorOf(off.owner),
        off.orgId,
        { methodId: "card", amountMinor: 1_000 },
        key(),
      ),
    );
    expect(refused.code).toBe("feature_disabled");
    expect(refused.reason).toBe("feature_disabled");
  });
});

describe("allocation and return", () => {
  let cast: OrgCast;
  beforeAll(async () => {
    cast = await seedOrganization(db);
    await topUpOrganization(
      depsAt(db, NOW),
      actorOf(cast.owner),
      cast.orgId,
      { methodId: "card", amountMinor: 3_000_000 },
      key(),
    );
  });

  it("moves prefunded money into a cost centre's monthly budget wallet with a journal entry", async () => {
    const deps = depsAt(db, NOW);
    const idem = key();
    const outcome = await allocateBudget(
      deps,
      actorOf(cast.admin),
      cast.orgId,
      {
        costCentreId: cast.costCentreId,
        period: PERIOD,
        amountMinor: 2_000_000,
      },
      idem,
    );
    const budget = BudgetAccountViewSchema.parse(outcome.result.budget);
    expect(budget.balance.amountMinor).toBe(2_000_000);
    expect(budget.available.amountMinor).toBe(2_000_000);
    expect(budget.reserved.amountMinor).toBe(0);
    expect(outcome.result.unallocated.amountMinor).toBe(1_000_000);

    const account = await db.orgBudgetAccount.findUniqueOrThrow({
      where: { id: budget.budgetId },
    });
    const wallet = await db.wallet.findUniqueOrThrow({
      where: { id: account.walletId },
    });
    expect(wallet.ownerType).toBe("org_budget");
    expect((await balanceOf(db, wallet.id, "NGN")).amountMinor).toBe(2_000_000);
    const entry = await db.journalEntry.findUniqueOrThrow({
      where: { id: outcome.result.entryId },
    });
    expect(entry.kind).toBe(BUSINESS_LEDGER.entryKinds.allocate);

    const replay = await allocateBudget(
      deps,
      actorOf(cast.admin),
      cast.orgId,
      {
        costCentreId: cast.costCentreId,
        period: PERIOD,
        amountMinor: 2_000_000,
      },
      idem,
    );
    expect(replay.replayed).toBe(true);
    expect(
      await db.journalEntry.count({
        where: { reference: `business_budget:${account.id}` },
      }),
    ).toBe(1);
  });

  it("refuses to allocate more than the organization has — there is no overdraft", async () => {
    const refused = await refusalOf(
      allocateBudget(
        depsAt(db, NOW),
        actorOf(cast.owner),
        cast.orgId,
        {
          costCentreId: cast.otherCostCentreId,
          period: PERIOD,
          amountMinor: 1_000_001,
        },
        key(),
      ),
    );
    expect(refused.code).toBe("insufficient_spendable");
    expect(refused.reason).toBe("organization_funds_insufficient");
  });

  it("refuses a past month, a foreign cost centre and a non-admin", async () => {
    const deps = depsAt(db, NOW);
    const past = await refusalOf(
      allocateBudget(
        deps,
        actorOf(cast.owner),
        cast.orgId,
        { costCentreId: cast.costCentreId, period: "2026-09", amountMinor: 1 },
        key(),
      ),
    );
    expect(past.code).toBe("validation_failed");
    const other = await seedOrganization(db, { city: cast.city });
    const foreign = await refusalOf(
      allocateBudget(
        deps,
        actorOf(cast.owner),
        cast.orgId,
        { costCentreId: other.costCentreId, period: PERIOD, amountMinor: 1 },
        key(),
      ),
    );
    expect(foreign.reason).toBe("cost_centre_invalid");
    const booker = await refusalOf(
      allocateBudget(
        deps,
        actorOf(cast.booker),
        cast.orgId,
        { costCentreId: cast.costCentreId, period: PERIOD, amountMinor: 1 },
        key(),
      ),
    );
    expect(booker.code).toBe("forbidden");
  });

  it("returns only what is available, back to the organization wallet", async () => {
    const deps = depsAt(db, NOW);
    const back = await returnBudget(
      deps,
      actorOf(cast.admin),
      cast.orgId,
      { costCentreId: cast.costCentreId, period: PERIOD, amountMinor: 500_000 },
      key(),
    );
    expect(back.result.budget.balance.amountMinor).toBe(1_500_000);
    expect(back.result.unallocated.amountMinor).toBe(1_500_000);
    const tooMuch = await refusalOf(
      returnBudget(
        deps,
        actorOf(cast.admin),
        cast.orgId,
        {
          costCentreId: cast.costCentreId,
          period: PERIOD,
          amountMinor: 1_500_001,
        },
        key(),
      ),
    );
    expect(tooMuch.reason).toBe("budget_insufficient");
  });

  it("shows owners the funding view and bookers only budget availability", async () => {
    const deps = depsAt(db, NOW);
    const funding = OrgFundingViewSchema.parse(
      await fundingView(deps, actorOf(cast.owner), cast.orgId),
    );
    expect(funding.unallocated.amountMinor).toBe(1_500_000);
    expect(funding.budgets).toHaveLength(1);
    expect(
      (await refusalOf(fundingView(deps, actorOf(cast.booker), cast.orgId)))
        .code,
    ).toBe("forbidden");

    const budgets = await listBudgets(
      deps,
      actorOf(cast.booker),
      cast.orgId,
      PERIOD,
    );
    expect(budgets.map((b) => b.available.amountMinor)).toEqual([1_500_000]);
    expect(
      (
        await refusalOf(
          listBudgets(deps, actorOf(cast.traveller), cast.orgId, PERIOD),
        )
      ).code,
    ).toBe("forbidden");
    expect(
      (
        await refusalOf(
          listBudgets(deps, actorOf(cast.outsider), cast.orgId, PERIOD),
        )
      ).code,
    ).toBe("not_found");
  });

  it("never blocks returning money when the flag is switched off", async () => {
    const deps = depsAt(db, NOW);
    await setBusinessTravel(db, cast.city.cityId, false);
    try {
      const refused = await refusalOf(
        allocateBudget(
          deps,
          actorOf(cast.owner),
          cast.orgId,
          { costCentreId: cast.costCentreId, period: PERIOD, amountMinor: 1 },
          key(),
        ),
      );
      expect(refused.code).toBe("feature_disabled");
      const back = await returnBudget(
        deps,
        actorOf(cast.owner),
        cast.orgId,
        { costCentreId: cast.costCentreId, period: PERIOD, amountMinor: 100 },
        key(),
      );
      expect(back.replayed).toBe(false);
    } finally {
      await setBusinessTravel(db, cast.city.cityId, true);
    }
  });

  it("serializes concurrent allocations on the organization wallet: never allocates money it does not have", async () => {
    const lean = await seedOrganization(db);
    const deps = depsAt(db, NOW);
    await topUpOrganization(
      deps,
      actorOf(lean.owner),
      lean.orgId,
      { methodId: "card", amountMinor: 1_000_000 },
      key(),
    );
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        allocateBudget(
          deps,
          actorOf(lean.owner),
          lean.orgId,
          {
            costCentreId:
              index % 2 === 0 ? lean.costCentreId : lean.otherCostCentreId,
            period: PERIOD,
            amountMinor: 300_000,
          },
          key(),
        ),
      ),
    );
    const ok = results.filter((result) => result.status === "fulfilled");
    expect(ok).toHaveLength(3);
    const funding = await fundingView(deps, actorOf(lean.owner), lean.orgId);
    expect(funding.unallocated.amountMinor).toBe(100_000);
    expect(
      funding.budgets.reduce((sum, b) => sum + b.balance.amountMinor, 0),
    ).toBe(900_000);
  });
});
