/**
 * The consolidated period statement (A06 part C) — built from JOURNAL LINES,
 * never from a separately stored balance.
 *
 * A statement line is a `business_trip_commit` journal line on one of the
 * organization's budget wallets inside the city-local month; the amount comes
 * from that line, and the booking metadata (booking ref, cost centre,
 * traveller, booker, service, class, expense category, included taxes) from
 * the reservation the entry committed. `reconciliation` restates the same
 * month straight from the journal with an independent aggregate — the lines
 * must add up to it, and the tests hold them to it.
 *
 * Funding is from the journal too: top-ups into the organization wallet, and
 * allocations / returns between it and the budgets, in the month.
 *
 * Owners and admins only. Formats: `json` (the contract's
 * `BusinessStatementSchema`) and `csv` (`BUSINESS_STATEMENT_CSV_COLUMNS`,
 * integer minor units, one row per committed booking).
 */
import { ContractError, money } from "@ubi/contracts";

import { requireOrgRole } from "./authority";
import { findOrgWallet } from "./budgets";
import { ORG_ADMIN_ROLES, STATEMENT_CSV_COLUMNS } from "./model";
import { assertPeriod, cityTimezone, periodWindow } from "./ops";
import { taxLinesOf, type TaxLine } from "./reservations";
import { fromDbMinor, fromNullableDbMinor } from "../ledger/minor-units";

import type { WalletDeps } from "../ledger/context";
import type { Actor, LedgerTx } from "../ledger/types";

export const STATEMENT_FORMATS = ["json", "csv"] as const;
export type StatementFormat = (typeof STATEMENT_FORMATS)[number];

type MoneyView = { readonly amountMinor: number; readonly currency: string };

export type StatementLine = {
  readonly bookingRef: string;
  readonly reservationId: string;
  readonly journalEntryId: string;
  readonly committedAt: string;
  readonly costCentreId: string;
  readonly costCentreCode: string;
  readonly travellerId: string;
  readonly bookerId: string;
  readonly service: string;
  readonly vehicleClass: string;
  readonly expenseCategory: string | null;
  readonly gross: MoneyView;
  readonly taxes: readonly TaxLine[];
  readonly net: MoneyView;
};

export type BusinessStatement = {
  readonly organizationId: string;
  readonly period: string;
  readonly currency: string;
  readonly window: { readonly start: string; readonly end: string };
  readonly billing: {
    readonly name: string;
    readonly legalName: string | null;
    readonly taxId: string | null;
  };
  readonly lines: readonly StatementLine[];
  readonly totals: {
    readonly trips: number;
    readonly gross: MoneyView;
    readonly tax: MoneyView;
    readonly net: MoneyView;
    readonly taxByCode: ReadonlyArray<{
      readonly code: string;
      readonly amount: MoneyView;
    }>;
  };
  readonly byCostCentre: ReadonlyArray<{
    readonly costCentreId: string;
    readonly code: string;
    readonly trips: number;
    readonly gross: MoneyView;
  }>;
  readonly funding: {
    readonly toppedUp: MoneyView;
    readonly allocated: MoneyView;
    readonly returned: MoneyView;
  };
  readonly reconciliation: {
    readonly commitEntries: number;
    readonly journalCommittedMinor: number;
  };
};

/** −SUM(lines) of one entry kind on a set of wallets in the window. */
async function signedSum(
  tx: LedgerTx,
  walletIds: readonly string[],
  kind: string,
  window: { readonly start: Date; readonly end: Date },
  currency: string,
): Promise<number> {
  if (walletIds.length === 0) {
    return 0;
  }
  const result = await tx.journalLine.aggregate({
    _sum: { amountMinor: true },
    where: {
      walletId: { in: [...walletIds] },
      currency,
      entry: { kind, occurredAt: { gte: window.start, lt: window.end } },
    },
  });
  return fromNullableDbMinor(result._sum.amountMinor);
}

export async function buildStatement(
  deps: WalletDeps,
  actor: Actor,
  orgId: string,
  period: string,
): Promise<BusinessStatement> {
  assertPeriod(period);
  const { org } = await requireOrgRole(
    deps.db,
    orgId,
    actor.id,
    ORG_ADMIN_ROLES,
  );
  const window = periodWindow(period, await cityTimezone(deps.db, org.cityId));
  const currency = org.currency;

  return deps.db.$transaction(async (tx) => {
    const accounts = await tx.orgBudgetAccount.findMany({
      where: { organizationId: orgId },
      select: { walletId: true },
    });
    const budgetWallets = accounts.map((account) => account.walletId);

    // The source of truth for every amount: the commit lines themselves.
    const commitLines =
      budgetWallets.length === 0
        ? []
        : await tx.journalLine.findMany({
            where: {
              walletId: { in: budgetWallets },
              currency,
              entry: {
                kind: "business_trip_commit",
                occurredAt: { gte: window.start, lt: window.end },
              },
            },
            include: { entry: true },
            orderBy: [{ entry: { occurredAt: "asc" } }, { id: "asc" }],
          });
    const entryIds = commitLines.map((line) => line.entryId);
    const reservations =
      entryIds.length === 0
        ? []
        : await tx.orgBudgetReservation.findMany({
            where: { commitEntryId: { in: entryIds } },
          });
    const byEntry = new Map(
      reservations.map((row) => [row.commitEntryId ?? "", row]),
    );
    const costCentres = await tx.organizationCostCentre.findMany({
      where: { organizationId: orgId },
      select: { id: true, code: true },
    });
    const codeOf = new Map(costCentres.map((row) => [row.id, row.code]));

    const lines: StatementLine[] = commitLines.map((line) => {
      const reservation = byEntry.get(line.entryId);
      if (reservation === undefined) {
        throw new ContractError(
          "internal_error",
          "a business commit entry has no reservation behind it",
          { entryId: line.entryId },
        );
      }
      const gross = -fromDbMinor(line.amountMinor);
      const taxes = taxLinesOf(reservation.taxLines);
      const tax = taxes.reduce((sum, item) => sum + item.amountMinor, 0);
      return {
        bookingRef: reservation.bookingRef,
        reservationId: reservation.id,
        journalEntryId: line.entryId,
        committedAt: line.entry.occurredAt.toISOString(),
        costCentreId: reservation.costCentreId,
        costCentreCode: codeOf.get(reservation.costCentreId) ?? "",
        travellerId: reservation.travellerId,
        bookerId: reservation.bookerId,
        service: reservation.service,
        vehicleClass: reservation.vehicleClass,
        expenseCategory: reservation.expenseCategory,
        gross: money(gross, currency),
        taxes,
        net: money(gross - tax, currency),
      };
    });

    const grossTotal = lines.reduce(
      (sum, line) => sum + line.gross.amountMinor,
      0,
    );
    const taxTotals = new Map<string, number>();
    for (const line of lines) {
      for (const item of line.taxes) {
        taxTotals.set(
          item.code,
          (taxTotals.get(item.code) ?? 0) + item.amountMinor,
        );
      }
    }
    const taxTotal = [...taxTotals.values()].reduce(
      (sum, value) => sum + value,
      0,
    );

    const centres = new Map<
      string,
      { code: string; trips: number; gross: number }
    >();
    for (const line of lines) {
      const bucket = centres.get(line.costCentreId) ?? {
        code: line.costCentreCode,
        trips: 0,
        gross: 0,
      };
      bucket.trips += 1;
      bucket.gross += line.gross.amountMinor;
      centres.set(line.costCentreId, bucket);
    }

    // Independent restatement of the month from the journal.
    const journalCommitted = -(await signedSum(
      tx,
      budgetWallets,
      "business_trip_commit",
      window,
      currency,
    ));
    const orgWallet = await findOrgWallet(tx, org);
    const orgWallets = orgWallet === null ? [] : [orgWallet.id];

    return {
      organizationId: orgId,
      period,
      currency,
      window: {
        start: window.start.toISOString(),
        end: window.end.toISOString(),
      },
      billing: { name: org.name, legalName: org.legalName, taxId: org.taxId },
      lines,
      totals: {
        trips: lines.length,
        gross: money(grossTotal, currency),
        tax: money(taxTotal, currency),
        net: money(grossTotal - taxTotal, currency),
        taxByCode: [...taxTotals.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([code, amount]) => ({ code, amount: money(amount, currency) })),
      },
      byCostCentre: [...centres.entries()]
        .sort(([, a], [, b]) => a.code.localeCompare(b.code))
        .map(([costCentreId, bucket]) => ({
          costCentreId,
          code: bucket.code,
          trips: bucket.trips,
          gross: money(bucket.gross, currency),
        })),
      funding: {
        toppedUp: money(
          await signedSum(tx, orgWallets, "topup", window, currency),
          currency,
        ),
        allocated: money(
          -(await signedSum(
            tx,
            orgWallets,
            "business_budget_allocation",
            window,
            currency,
          )),
          currency,
        ),
        returned: money(
          await signedSum(
            tx,
            orgWallets,
            "business_budget_return",
            window,
            currency,
          ),
          currency,
        ),
      },
      reconciliation: {
        commitEntries: new Set(entryIds).size,
        journalCommittedMinor: journalCommitted,
      },
    };
  });
}

function csvField(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One row per committed booking, `STATEMENT_CSV_COLUMNS` in order. */
export function statementCsv(statement: BusinessStatement): string {
  const rows = statement.lines.map((line) => {
    const tax = line.taxes.reduce((sum, item) => sum + item.amountMinor, 0);
    return [
      line.bookingRef,
      line.committedAt,
      line.costCentreCode,
      line.travellerId,
      line.bookerId,
      line.service,
      line.vehicleClass,
      line.expenseCategory,
      line.gross.amountMinor,
      tax,
      line.net.amountMinor,
      line.gross.currency,
      line.journalEntryId,
    ]
      .map(csvField)
      .join(",");
  });
  return `${[STATEMENT_CSV_COLUMNS.join(","), ...rows].join("\r\n")}\r\n`;
}
