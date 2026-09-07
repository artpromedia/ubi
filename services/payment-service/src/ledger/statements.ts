/**
 * Wallet statements, computed from the journal.
 *
 * Opening, in, out and closing are all derived from the same lines the balance
 * is derived from, so a statement can never disagree with the wallet. Every row
 * carries its counterpartRef, which is what makes a line traceable back to the
 * ride, request or bank instruction that caused it.
 */
import { ContractError, type Money, money } from "@ubi/contracts";

import { rangeWindow } from "./day-window";
import { fromDbMinor } from "./minor-units";
import { ensureWallet } from "./wallets";
import { generateId } from "../lib/utils";


import type { WalletDeps } from "./context";
import type { LedgerTx ,Actor } from "./types";


export const STATEMENT_FORMATS = ["json"] as const;
export type StatementFormat = (typeof STATEMENT_FORMATS)[number];

export interface StatementLine {
  readonly entryId: string;
  readonly lineId: string;
  readonly kind: string;
  readonly account: string;
  readonly description: string | null;
  readonly counterpartRef: string | null;
  readonly amountMinor: number;
  readonly runningBalanceMinor: number;
  readonly occurredAt: string;
}

export interface Statement {
  readonly walletId: string;
  readonly currency: string;
  readonly from: string;
  readonly to: string;
  readonly opening: Money;
  readonly in: Money;
  readonly out: Money;
  readonly closing: Money;
  readonly lines: readonly StatementLine[];
}

export interface StatementInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly from: string;
  readonly to: string;
  readonly format: string;
}

export async function buildStatement(
  deps: WalletDeps,
  input: StatementInput,
): Promise<Statement> {
  if (!(STATEMENT_FORMATS as readonly string[]).includes(input.format)) {
    throw new ContractError(
      "validation_failed",
      "that statement format is not available yet",
      { requested: input.format, supported: STATEMENT_FORMATS },
    );
  }

  const config = await deps.config.load(input.cityId);
  const window = rangeWindow(input.from, input.to, config.city.timezone);

  const wallet = await deps.db.$transaction((tx) =>
    ensureWallet(tx, "user", input.actor.id, config.city),
  );

  return deps.db.$transaction(async (tx) => {
    const statement = await computeStatement(tx, {
      walletId: wallet.id,
      currency: wallet.currency,
      from: input.from,
      to: input.to,
      start: window.start,
      end: window.end,
    });

    // The statement row is a record of what was produced; the journal stays the
    // only source of truth, and re-running recomputes rather than trusts it.
    await tx.walletStatement.upsert({
      where: {
        walletId_periodStart_periodEnd: {
          walletId: wallet.id,
          periodStart: new Date(`${input.from}T00:00:00.000Z`),
          periodEnd: new Date(`${input.to}T00:00:00.000Z`),
        },
      },
      create: {
        id: generateId("stm"),
        walletId: wallet.id,
        periodStart: new Date(`${input.from}T00:00:00.000Z`),
        periodEnd: new Date(`${input.to}T00:00:00.000Z`),
        openingMinor: BigInt(statement.opening.amountMinor),
        inMinor: BigInt(statement.in.amountMinor),
        outMinor: BigInt(statement.out.amountMinor),
        closingMinor: BigInt(statement.closing.amountMinor),
        currency: wallet.currency,
      },
      update: {
        openingMinor: BigInt(statement.opening.amountMinor),
        inMinor: BigInt(statement.in.amountMinor),
        outMinor: BigInt(statement.out.amountMinor),
        closingMinor: BigInt(statement.closing.amountMinor),
      },
    });

    return statement;
  });
}

interface ComputeInput {
  readonly walletId: string;
  readonly currency: string;
  readonly from: string;
  readonly to: string;
  readonly start: Date;
  readonly end: Date;
}

export async function computeStatement(
  tx: LedgerTx,
  input: ComputeInput,
): Promise<Statement> {
  const openingAggregate = await tx.journalLine.aggregate({
    _sum: { amountMinor: true },
    where: {
      walletId: input.walletId,
      currency: input.currency,
      entry: { occurredAt: { lt: input.start } },
    },
  });
  const openingMinor =
    openingAggregate._sum.amountMinor === null
      ? 0
      : fromDbMinor(openingAggregate._sum.amountMinor);

  const rows = await tx.journalLine.findMany({
    where: {
      walletId: input.walletId,
      currency: input.currency,
      entry: { occurredAt: { gte: input.start, lt: input.end } },
    },
    include: { entry: true },
    orderBy: [{ entry: { occurredAt: "asc" } }, { id: "asc" }],
  });

  let running = openingMinor;
  let inMinor = 0;
  let outMinor = 0;
  const lines: StatementLine[] = rows.map((row) => {
    const amountMinor = fromDbMinor(row.amountMinor);
    running += amountMinor;
    if (amountMinor >= 0) {
      inMinor += amountMinor;
    } else {
      outMinor += amountMinor;
    }
    return {
      entryId: row.entryId,
      lineId: row.id,
      kind: row.entry.kind,
      account: row.account,
      description: row.entry.description,
      counterpartRef: row.counterpartRef,
      amountMinor,
      runningBalanceMinor: running,
      occurredAt: row.entry.occurredAt.toISOString(),
    };
  });

  return {
    walletId: input.walletId,
    currency: input.currency,
    from: input.from,
    to: input.to,
    opening: money(openingMinor, input.currency),
    in: money(inMinor, input.currency),
    out: money(outMinor, input.currency),
    closing: money(running, input.currency),
    lines,
  };
}
