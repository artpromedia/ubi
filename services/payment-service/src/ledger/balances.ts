/**
 * Balances are derived from the journal. Nothing in this service stores a
 * balance as truth (CLAUDE.md #4) — `wallets` has no balance column, and the
 * database exposes the same derivation as the `wallet_balances` view.
 */
import { type Money, money } from "@ubi/contracts";

import { OUTBOUND_LIMIT_KINDS } from "./accounts";
import { fromDbMinor, fromNullableDbMinor } from "./minor-units";

import type { LedgerTx } from "./types";

/** Sum of every journal line carrying this wallet id, in the wallet's currency. */
export async function balanceOf(
  tx: LedgerTx,
  walletId: string,
  currency: string,
): Promise<Money> {
  const result = await tx.journalLine.aggregate({
    _sum: { amountMinor: true },
    where: { walletId, currency },
  });
  return money(fromNullableDbMinor(result._sum.amountMinor), currency);
}

/**
 * The same figure read back from the `wallet_balances` view. Used by the
 * invariant tests to prove the application's derivation and the database's
 * agree; production code reads `balanceOf`.
 */
export async function balanceFromView(
  tx: LedgerTx,
  walletId: string,
  currency: string,
): Promise<Money> {
  const rows = await tx.$queryRaw<Array<{ balance_minor: bigint }>>`
    SELECT balance_minor FROM wallet_balances WHERE wallet_id = ${walletId}
  `;
  const row = rows[0];
  return money(
    row === undefined ? 0 : fromDbMinor(row.balance_minor),
    currency,
  );
}

/**
 * The sum of marketplace commission holds still encumbering the wallet. A hold
 * is a table row, never a journal movement (the worked example: a 1 000.00
 * wallet with a 500.00 hold still *totals* 1 000.00 — only spendable drops), so
 * the journal-derived balance above stays untouched while a bid is live.
 * `capture_pending` still encumbers: the money is spoken for until the award
 * resolves one way or the other.
 */
export async function activeHoldsMinor(
  tx: LedgerTx,
  walletId: string,
  currency: string,
): Promise<Money> {
  const result = await tx.mpCommissionHold.aggregate({
    _sum: { amountMinor: true },
    where: {
      walletId,
      currency,
      state: { in: ["active", "capture_pending"] },
    },
  });
  return money(fromNullableDbMinor(result._sum.amountMinor), currency);
}

/**
 * The one spendable calculation (M04/D04): cleared journal balance minus
 * active holds. Every debit path checks this figure, not the raw balance.
 */
export async function spendableOf(
  tx: LedgerTx,
  walletId: string,
  currency: string,
): Promise<Money> {
  const balance = await balanceOf(tx, walletId, currency);
  const held = await activeHoldsMinor(tx, walletId, currency);
  return money(balance.amountMinor - held.amountMinor, currency);
}

/**
 * How much the owner has already moved out of the wallet today on their own
 * instruction — transfers, split-fare payments and NIP payouts. Ride fares are
 * excluded: a KYC tier caps transfers, not spending.
 */
export async function outboundToday(
  tx: LedgerTx,
  walletId: string,
  currency: string,
  window: { readonly start: Date; readonly end: Date },
): Promise<Money> {
  const result = await tx.journalLine.aggregate({
    _sum: { amountMinor: true },
    where: {
      walletId,
      currency,
      amountMinor: { lt: 0 },
      entry: {
        kind: { in: [...OUTBOUND_LIMIT_KINDS] },
        occurredAt: { gte: window.start, lt: window.end },
      },
    },
  });
  // Stored as negative movements; the limit is expressed as a positive amount.
  return money(-fromNullableDbMinor(result._sum.amountMinor), currency);
}
