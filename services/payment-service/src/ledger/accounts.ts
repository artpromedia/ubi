/**
 * The UBI chart of accounts.
 *
 * Accounts are a closed, typed set so no call site can invent a free-form
 * account string and quietly create an account nobody reconciles.
 *
 * ## Sign convention
 *
 * `amountMinor` is positive when value flows **into** the named account and
 * negative when it flows out. Every journal entry's lines sum to zero per
 * currency, so value is conserved and can only be moved, never created.
 *
 * A wallet's balance is the sum of every journal line carrying its `walletId`
 * (see `balances.ts`) — it is derived, never stored (CLAUDE.md #4).
 *
 * `account` classifies *what kind of flow* the line is; `walletId` says *whose
 * balance* it touches. A tip credited to a driver is `{ account: "tips",
 * walletId: driverWallet }` — it lands in the driver's balance like any other
 * line, and it stays queryable as a tip so "tips bypass commission" is provable
 * from the journal rather than from a comment.
 *
 * External-rail accounts (`psp_settlement`, `bank_settlement`, `cash_owed`,
 * `merchant_payable`) hold value that is in transit outside UBI's own books.
 * Their *net inflow* over a period — what the counterparty says it moved for us
 * — is `-SUM(lines)`, which is what `src/finance` reconciles against the
 * statement the counterparty sends.
 */

export const LEDGER_ACCOUNTS = [
  /** A user or driver wallet balance movement. Carries `walletId`. */
  "wallet",
  /** A tip. Commission is never computed on a line with this account. Carries `walletId`. */
  "tips",
  /** UBI's service fee revenue. */
  "ubi_commission",
  /** UBI's own operating float — the counterpart for promotional credit and write-offs. */
  "ubi_float",
  /** Value reserved against refunds that have been promised but not yet paid out. */
  "refund_reserve",
  /** One-Ticket / disruption coverage UBI has committed to a traveller. */
  "coverage",
  /** Cash a driver physically collected. Positive = cash sitting in the rail; negative = the rail owes UBI. */
  "cash_owed",
  /** Card / mobile-money value in transit at the payment service provider. */
  "psp_settlement",
  /** Value in transit at the bank (NIP payouts and their reversals). */
  "bank_settlement",
  /** Value UBI owes a merchant or hotel partner and has not yet paid out. */
  "merchant_payable",
] as const;

export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];

const ACCOUNT_SET: ReadonlySet<string> = new Set(LEDGER_ACCOUNTS);

export function isLedgerAccount(value: string): value is LedgerAccount {
  return ACCOUNT_SET.has(value);
}

/** Accounts whose lines land in a wallet balance and therefore require a `walletId`. */
export const WALLET_BEARING_ACCOUNTS: readonly LedgerAccount[] = ["wallet", "tips"];

export function isWalletBearing(account: LedgerAccount): boolean {
  return WALLET_BEARING_ACCOUNTS.includes(account);
}

/**
 * Every kind of entry the ledger can post. Closed so the statement, the limit
 * counters and the recon rails can all reason about entry kinds exhaustively.
 */
export const ENTRY_KINDS = [
  "p2p_transfer",
  "p2p_reversal",
  "request_payment",
  "topup",
  "nip_transfer",
  "nip_reversal",
  "ride_completion",
  "ride_completion_cash",
  "cash_settlement",
  "recon_adjustment",
  /** A typed support remedy: counter-lines that make a case good. */
  "remedy",
] as const;

export type EntryKind = (typeof ENTRY_KINDS)[number];

/**
 * Entry kinds that move money *out of a wallet on the owner's instruction* and
 * therefore count against the KYC tier's daily outbound limit. A ride fare is
 * deliberately not in this set: a tier limit is a transfer limit, not a
 * spending limit.
 */
export const OUTBOUND_LIMIT_KINDS: readonly EntryKind[] = [
  "p2p_transfer",
  "request_payment",
  "nip_transfer",
];
