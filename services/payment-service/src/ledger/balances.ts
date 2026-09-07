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
  return money(row === undefined ? 0 : fromDbMinor(row.balance_minor), currency);
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
