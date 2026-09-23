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
  /**
   * Traveller money captured for a supplier travel order item (flight/stay)
   * and not yet settled onward to the supplier or refunded back. Dedicated to
   * travel: supplier inventory never touches `ubi_commission`, a marketplace
   * commission hold or a ride account (finance/travel.ts).
   */
  "travel_clearing",
  /**
   * An organization's committed business-trip spend (A06 part C): value a
   * budget wallet has paid for a completed booking and that the trip's
   * settlement has not yet paid onward to the driver. Keyed by booking
   * reference in `counterpartRef`, so recon can prove it nets to zero per
   * booking (src/business).
   */
  "business_clearing",
] as const;

export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];

const ACCOUNT_SET: ReadonlySet<string> = new Set(LEDGER_ACCOUNTS);

export function isLedgerAccount(value: string): value is LedgerAccount {
  return ACCOUNT_SET.has(value);
}

/** Accounts whose lines land in a wallet balance and therefore require a `walletId`. */
export const WALLET_BEARING_ACCOUNTS: readonly LedgerAccount[] = [
  "wallet",
  "tips",
];

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
  /** The single 10% marketplace commission debit, captured at selection (M04). */
  "mp_commission_capture",
  /** Linked compensation for a captured marketplace commission — never an edit. */
  "mp_commission_reversal",
  /**
   * A post-award amendment's commission INCREMENT (fare raised): only the
   * difference, linked to the award's capture — the fee is never re-charged.
   */
  "mp_commission_delta_capture",
  /**
   * A post-award amendment's commission DECREMENT (fare lowered): a linked
   * partial reversal back to the driver, never more than captured to date.
   */
  "mp_commission_delta_refund",
  /** Negotiated-fare completion: full fare to the driver, fee already captured (M06). */
  "mp_ride_completion",
  "mp_ride_completion_cash",
  "cash_settlement",
  "recon_adjustment",
  /** A typed support remedy: counter-lines that make a case good. */
  "remedy",
  /** The one capture of a travel order item: traveller wallet → travel_clearing. */
  "travel_capture",
  /** A full or partial travel refund, linked to its capture entry — never an edit. */
  "travel_refund",
  /**
   * The one capture of a delivery return-leg fee: sender wallet → the driver's
   * wallet, whole (finance/delivery-returns.ts). A new charge for a new leg —
   * never the award's 10% commission, which is captured once at selection.
   */
  "delivery_return_fee",
  /**
   * Business travel (A06 part C, src/business): an admin moves prefunded
   * organization money into a cost centre's monthly budget wallet, and back.
   * Neither is a spend; both are wallet-to-wallet inside one organization.
   */
  "business_budget_allocation",
  "business_budget_return",
  /**
   * The one commit of a business booking's ACTUAL amount at completion:
   * budget wallet → `business_clearing`. Never more than was reserved, never
   * posted twice for a booking (its idempotency key names the reservation).
   */
  "business_trip_commit",
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
