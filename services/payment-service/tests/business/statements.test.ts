/**
 * The consolidated period statement (A06 part C) reconciles with the journal:
 * every line is a commit journal line, the totals equal an independent SQL
 * sum over journal_lines, VAT is itemised from the configured rates, and the
 * CSV export carries exactly the contract's columns.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BUSINESS_STATEMENT_CSV_COLUMNS,
  BusinessStatementSchema,
} from "../../../../packages/contracts/src/business-travel";
import {
  allocateBudget,
  returnBudget,
  topUpOrganization,
} from "../../src/business/budgets";
import { STATEMENT_CSV_COLUMNS } from "../../src/business/model";
import {
  commitBudget,
  includedTaxes,
  releaseBudget,
  reserveBudget,
} from "../../src/business/reservations";
import { buildStatement, statementCsv } from "../../src/business/statements";
import { balanceOf } from "../../src/ledger/balances";
import {
  actorOf,
  closeTestDb,
  depsAt,
  key,
  refusalOf,
  seedOrganization,
  termsFor,
  testDb,
  uid,
  type OrgCast,
} from "./fixtures";

const db = testDb();
const OCTOBER = new Date("2026-10-15T09:00:00.000Z");
const NOVEMBER = new Date("2026-11-03T09:00:00.000Z");

afterAll(async () => {
  await closeTestDb();
});

/** Minimal RFC 4180 reader — enough to prove quoting round-trips. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\r") {
      // part of \r\n
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  return rows;
}

describe("the statement reconciles with the journal", () => {
  let cast: OrgCast;
  const committedInOctober: Array<{
    bookingRef: string;
    actual: number;
    costCentre: string;
  }> = [];
  let lateBookingRef: string;

  beforeAll(async () => {
    cast = await seedOrganization(db);
    const october = depsAt(db, OCTOBER);
    await topUpOrganization(
      october,
      actorOf(cast.owner),
      cast.orgId,
      { methodId: "card", amountMinor: 8_000_000 },
      key(),
    );
    await allocateBudget(
      october,
      actorOf(cast.owner),
      cast.orgId,
      {
        costCentreId: cast.costCentreId,
        period: "2026-10",
        amountMinor: 4_000_000,
      },
      key(),
    );
    await allocateBudget(
      october,
      actorOf(cast.owner),
      cast.orgId,
      {
        costCentreId: cast.otherCostCentreId,
        period: "2026-10",
        amountMinor: 3_000_000,
      },
      key(),
    );
    await returnBudget(
      october,
      actorOf(cast.owner),
      cast.orgId,
      {
        costCentreId: cast.otherCostCentreId,
        period: "2026-10",
        amountMinor: 500_000,
      },
      key(),
    );

    // One booking ref carries a comma and quotes, so the CSV must quote it.
    const plan: Array<[string, number, number, string | undefined, string]> = [
      [cast.costCentreId, 1_200_000, 1_075_000, "client visit", uid("award")],
      [cast.costCentreId, 800_000, 800_000, undefined, uid("award")],
      [
        cast.otherCostCentreId,
        600_000,
        537_500,
        "sales roadshow",
        `award "q",${uid("x")}`,
      ],
    ];
    for (const [costCentreId, reserve, actual, category, bookingRef] of plan) {
      const terms = termsFor(cast, {
        bookingRef,
        costCentreId,
        amountMinor: reserve,
        expenseCategory: category,
      });
      await reserveBudget(october, terms, key());
      await commitBudget(
        october,
        { bookingRef: terms.bookingRef, actualMinor: actual, currency: "NGN" },
        key(),
      );
      committedInOctober.push({
        bookingRef: terms.bookingRef,
        actual,
        costCentre: costCentreId,
      });
    }
    // Released and still-reserved bookings are not spend: never on a statement.
    const released = termsFor(cast, { amountMinor: 250_000 });
    await reserveBudget(october, released, key());
    await releaseBudget(
      october,
      {
        bookingRef: released.bookingRef,
        cancelledBy: { party: "booker", userId: cast.booker.id },
        reason: "cancelled",
      },
      key(),
    );
    await reserveBudget(
      october,
      termsFor(cast, { amountMinor: 150_000 }),
      key(),
    );

    // Reserved in October, completed in November: November's statement.
    const late = termsFor(cast, { amountMinor: 300_000 });
    await reserveBudget(october, late, key());
    await commitBudget(
      depsAt(db, NOVEMBER),
      { bookingRef: late.bookingRef, actualMinor: 215_000, currency: "NGN" },
      key(),
    );
    lateBookingRef = late.bookingRef;
  });

  it("totals equal an independent SQL sum of the commit lines, line by line", async () => {
    const statement = BusinessStatementSchema.parse(
      await buildStatement(
        depsAt(db, NOVEMBER),
        actorOf(cast.admin),
        cast.orgId,
        "2026-10",
      ),
    );
    expect(statement.lines.map((line) => line.bookingRef).sort()).toEqual(
      committedInOctober.map((item) => item.bookingRef).sort(),
    );
    const expectedGross = committedInOctober.reduce(
      (sum, item) => sum + item.actual,
      0,
    );
    expect(statement.totals.gross.amountMinor).toBe(expectedGross);
    expect(statement.totals.trips).toBe(3);

    const [sql] = await db.$queryRaw<
      Array<{ committed: bigint | null; entries: bigint }>
    >`
      SELECT -SUM(jl.amount_minor) AS committed, COUNT(DISTINCT je.id) AS entries
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      JOIN org_budget_accounts oba ON oba.wallet_id = jl.wallet_id
      WHERE oba.organization_id = ${cast.orgId}
        AND je.kind = 'business_trip_commit'
        AND je.occurred_at >= ${new Date(statement.window.start)}
        AND je.occurred_at < ${new Date(statement.window.end)}
    `;
    expect(Number(sql?.committed ?? 0n)).toBe(
      statement.totals.gross.amountMinor,
    );
    expect(Number(sql?.entries ?? 0n)).toBe(statement.lines.length);
    expect(statement.reconciliation).toEqual({
      commitEntries: 3,
      journalCommittedMinor: expectedGross,
    });

    for (const line of statement.lines) {
      const entryLines = await db.journalLine.findMany({
        where: { entryId: line.journalEntryId },
      });
      const clearing = entryLines.find(
        (row) => row.account === "business_clearing",
      );
      expect(Number(clearing?.amountMinor)).toBe(line.gross.amountMinor);
      expect(clearing?.counterpartRef).toBe(
        `business_booking:${line.bookingRef}`,
      );
      expect(line.taxes).toEqual(
        includedTaxes({ vat: 7.5 }, line.gross.amountMinor),
      );
      expect(line.net.amountMinor).toBe(
        line.gross.amountMinor -
          line.taxes.reduce((sum, tax) => sum + tax.amountMinor, 0),
      );
    }
    expect(statement.totals.taxByCode).toEqual([
      { code: "vat", amount: statement.totals.tax },
    ]);
    // 1 075 000 → 75 000; 800 000 → 55 814; 537 500 → 37 500.
    expect(statement.totals.tax.amountMinor).toBe(75_000 + 55_814 + 37_500);

    expect(statement.byCostCentre).toEqual([
      {
        costCentreId: cast.costCentreId,
        code: "ENG",
        trips: 2,
        gross: { amountMinor: 1_875_000, currency: "NGN" },
      },
      {
        costCentreId: cast.otherCostCentreId,
        code: "SALES",
        trips: 1,
        gross: { amountMinor: 537_500, currency: "NGN" },
      },
    ]);
    expect(statement.funding).toEqual({
      toppedUp: { amountMinor: 8_000_000, currency: "NGN" },
      allocated: { amountMinor: 7_000_000, currency: "NGN" },
      returned: { amountMinor: 500_000, currency: "NGN" },
    });
    expect(statement.billing).toMatchObject({
      legalName: "Acme Logistics Ltd",
      taxId: "TIN-123456",
    });
    expect(statement.lines.map((line) => line.bookingRef)).not.toContain(
      lateBookingRef,
    );
  });

  it("files a booking under the month it was COMPLETED in", async () => {
    const november = await buildStatement(
      depsAt(db, NOVEMBER),
      actorOf(cast.owner),
      cast.orgId,
      "2026-11",
    );
    expect(november.lines.map((line) => line.bookingRef)).toEqual([
      lateBookingRef,
    ]);
    expect(november.totals.gross.amountMinor).toBe(215_000);
    expect(november.funding.toppedUp.amountMinor).toBe(0);
  });

  it("keeps every budget wallet's journal balance equal to allocated − returned − committed", async () => {
    const accounts = await db.orgBudgetAccount.findMany({
      where: { organizationId: cast.orgId },
    });
    for (const account of accounts) {
      const [row] = await db.$queryRaw<
        Array<{
          allocated: bigint | null;
          returned: bigint | null;
          committed: bigint | null;
        }>
      >`
        SELECT
          SUM(CASE WHEN je.kind = 'business_budget_allocation' THEN jl.amount_minor END) AS allocated,
          -SUM(CASE WHEN je.kind = 'business_budget_return' THEN jl.amount_minor END) AS returned,
          -SUM(CASE WHEN je.kind = 'business_trip_commit' THEN jl.amount_minor END) AS committed
        FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
        WHERE jl.wallet_id = ${account.walletId}
      `;
      const expected =
        Number(row?.allocated ?? 0n) -
        Number(row?.returned ?? 0n) -
        Number(row?.committed ?? 0n);
      expect((await balanceOf(db, account.walletId, "NGN")).amountMinor).toBe(
        expected,
      );
      const committed = await db.orgBudgetReservation.aggregate({
        _sum: { committedMinor: true },
        where: { budgetAccountId: account.id, state: "committed" },
      });
      expect(Number(committed._sum.committedMinor ?? 0n)).toBe(
        Number(row?.committed ?? 0n),
      );
    }
  });

  it("exports the contract's CSV columns, one quoted-safe row per committed booking", async () => {
    expect([...STATEMENT_CSV_COLUMNS]).toEqual([
      ...BUSINESS_STATEMENT_CSV_COLUMNS,
    ]);
    const statement = await buildStatement(
      depsAt(db, NOVEMBER),
      actorOf(cast.admin),
      cast.orgId,
      "2026-10",
    );
    const rows = parseCsv(statementCsv(statement));
    expect(rows[0]).toEqual([...BUSINESS_STATEMENT_CSV_COLUMNS]);
    const body = rows.slice(1);
    expect(body).toHaveLength(statement.lines.length);
    const column = (name: (typeof BUSINESS_STATEMENT_CSV_COLUMNS)[number]) =>
      BUSINESS_STATEMENT_CSV_COLUMNS.indexOf(name);
    for (const [index, row] of body.entries()) {
      const line = statement.lines[index];
      expect(row[column("booking_ref")]).toBe(line?.bookingRef);
      expect(Number(row[column("gross_minor")])).toBe(line?.gross.amountMinor);
      expect(Number(row[column("gross_minor")])).toBe(
        Number(row[column("tax_minor")]) + Number(row[column("net_minor")]),
      );
      expect(row[column("journal_entry_id")]).toBe(line?.journalEntryId);
      expect(row[column("currency")]).toBe("NGN");
    }
    expect(body.map((row) => row[column("expense_category")]).sort()).toEqual([
      "",
      "client visit",
      "sales roadshow",
    ]);
    expect(body.map((row) => row[column("booking_ref")])).toEqual(
      expect.arrayContaining([expect.stringMatching(/^award "q",/)]),
    );
    const csvGross = body.reduce(
      (sum, row) => sum + Number(row[column("gross_minor")]),
      0,
    );
    expect(csvGross).toBe(statement.reconciliation.journalCommittedMinor);
  });

  it("is for owners and admins only, and refuses a malformed period", async () => {
    const deps = depsAt(db, NOVEMBER);
    expect(
      (
        await refusalOf(
          buildStatement(deps, actorOf(cast.booker), cast.orgId, "2026-10"),
        )
      ).code,
    ).toBe("forbidden");
    expect(
      (
        await refusalOf(
          buildStatement(deps, actorOf(cast.traveller), cast.orgId, "2026-10"),
        )
      ).code,
    ).toBe("forbidden");
    expect(
      (
        await refusalOf(
          buildStatement(deps, actorOf(cast.outsider), cast.orgId, "2026-10"),
        )
      ).code,
    ).toBe("not_found");
    expect(
      (
        await refusalOf(
          buildStatement(deps, actorOf(cast.owner), cast.orgId, "2026-13"),
        )
      ).code,
    ).toBe("validation_failed");
  });
});
