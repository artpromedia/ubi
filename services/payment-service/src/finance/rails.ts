/**
 * Reconciliation rails.
 *
 * Each rail pairs a set of ledger accounts with the external party that reports
 * on them. The rail's *ledger* figure is the net inflow UBI's own books say
 * moved over that rail in the day:
 *
 *     ledgerMinor = -SUM(amount_minor on the rail's accounts)
 *
 * because value flowing *out of* a rail account is value the rail delivered to
 * us (see the sign convention in `src/ledger/accounts.ts`). The rail's
 * *external* figure is what the counterparty's own statement says. They should
 * agree; the difference is a break that a named human owns to a deadline.
 */
import type { LedgerAccount } from "../ledger/accounts";

export const RECON_RAILS = [
  /** Card and mobile-money settlement files from the PSP. */
  "psp_settlement",
  /** Bank statements for NIP payouts and their returns. */
  "nip",
  /** Cash acknowledgements from drivers who collected fares in cash. */
  "driver_cash",
  /** Payout runs to merchants and hotel partners. */
  "merchant_payout",
  /** One-Ticket disruption coverage and the reclaims against it. */
  "coverage",
] as const;

export type ReconRailName = (typeof RECON_RAILS)[number];

const RAIL_SET: ReadonlySet<string> = new Set(RECON_RAILS);

export function isReconRail(value: string): value is ReconRailName {
  return RAIL_SET.has(value);
}

export const RAIL_ACCOUNTS: Readonly<
  Record<ReconRailName, readonly LedgerAccount[]>
> = {
  psp_settlement: ["psp_settlement"],
  nip: ["bank_settlement"],
  driver_cash: ["cash_owed"],
  merchant_payout: ["merchant_payable"],
  coverage: ["coverage"],
};

export const RAIL_STATUSES = ["balanced", "break"] as const;
export type RailStatus = (typeof RAIL_STATUSES)[number];

export const RUN_STATUSES = ["open", "closed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * How a break was put to rest. An adjustment moved the ledger, so the diff it
 * explains has already gone; an explanation leaves the diff standing but
 * attaches the case that accounts for it. The two are told apart by the prefix
 * on `resolution_ref`, because `recon_breaks` has no column for the distinction.
 */
export const RESOLUTION_PREFIXES = {
  adjustment: "entry:",
  explanation: "case:",
} as const;

export function isExplanation(resolutionRef: string | null): boolean {
  return (
    resolutionRef !== null &&
    resolutionRef.startsWith(RESOLUTION_PREFIXES.explanation)
  );
}
