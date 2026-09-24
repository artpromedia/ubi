/**
 * What the fleet settlement reads back from the journal — always DERIVED
 * from journal lines, never from a stored figure (CLAUDE.md #4).
 *
 *  - the carry-forward per fleet + driver + origin week: the sum of the
 *    `owed` memo lines on `fleet_remittance_carry` (src/ledger/accounts.ts);
 *  - a driver's NET for a window, the `percent_of_net` base: the driver
 *    wallet's earning lines less its commission lines, in the window.
 */
import { money } from "@ubi/contracts";

import {
  CARRY_ACCOUNT,
  carryFleetRef,
  carryOwedRef,
  carryPairPrefix,
  originOfOwedRef,
} from "./model";
import { fromNullableDbMinor } from "../ledger/minor-units";
import { likePrefixLiteral } from "../ledger/mp-amendment-refs";

import type { OriginBalance } from "./math";
import type { EntryKind } from "../ledger/accounts";
import type { JournalLineInput, LedgerTx } from "../ledger/types";

/** Every origin week with a nonzero carry for the pair, oldest first. */
export async function carryBalances(
  tx: LedgerTx,
  fleetId: string,
  driverId: string,
  currency: string,
): Promise<OriginBalance[]> {
  const rows = await tx.journalLine.groupBy({
    by: ["counterpartRef"],
    where: {
      account: CARRY_ACCOUNT,
      currency,
      counterpartRef: {
        startsWith: likePrefixLiteral(
          `${carryPairPrefix(fleetId, driverId)}owed:`,
        ),
      },
    },
    _sum: { amountMinor: true },
  });
  const balances: OriginBalance[] = [];
  for (const row of rows) {
    const origin =
      row.counterpartRef === null
        ? null
        : originOfOwedRef(fleetId, driverId, row.counterpartRef);
    const amountMinor = fromNullableDbMinor(row._sum.amountMinor);
    if (origin !== null && amountMinor !== 0) {
      balances.push({ origin, amountMinor });
    }
  }
  return balances.sort((a, b) => a.origin.localeCompare(b.origin));
}

/** The outstanding carry-forward the driver owes the fleet (signed). */
export async function carryTotalMinor(
  tx: LedgerTx,
  fleetId: string,
  driverId: string,
  currency: string,
): Promise<number> {
  const balances = await carryBalances(tx, fleetId, driverId, currency);
  return balances.reduce((sum, balance) => sum + balance.amountMinor, 0);
}

/**
 * The memo pair that moves one origin week's carry by `deltaMinor`
 * (positive: the driver owes more). The two lines are equal and opposite,
 * so the pair balances on its own and the account nets to zero.
 */
export function carryMemoLines(
  fleetId: string,
  driverId: string,
  originWeek: string,
  deltaMinor: number,
  currency: string,
): JournalLineInput[] {
  if (deltaMinor === 0) {
    return [];
  }
  return [
    {
      account: CARRY_ACCOUNT,
      amount: money(deltaMinor, currency),
      counterpartRef: carryOwedRef(fleetId, driverId, originWeek),
    },
    {
      account: CARRY_ACCOUNT,
      amount: money(-deltaMinor, currency),
      counterpartRef: carryFleetRef(fleetId, driverId, originWeek),
    },
  ];
}

/**
 * The `percent_of_net` base. EARNINGS: the full marketplace fare credited at
 * completion (`mp_ride_completion`), a business trip's payout
 * (`business_trip_payout`), a delivery return-leg fee
 * (`delivery_return_fee`) and a legacy ride completion (already net of its
 * fee). LESS the commission: the one capture at selection, amendment
 * increments, and back again for partial and full reversals. EXCLUDED on
 * purpose: tips (their own `tips` lines — a tip is the driver's alone),
 * promotional rebates and top-ups/transfers (not earnings), and cash fares,
 * which never enter UBI's books. Attribution is by entry time inside the
 * window.
 */
export const NET_EARNING_KINDS: readonly EntryKind[] = [
  "mp_ride_completion",
  "business_trip_payout",
  "delivery_return_fee",
  "ride_completion",
];

export const NET_COMMISSION_KINDS: readonly EntryKind[] = [
  "mp_commission_capture",
  "mp_commission_reversal",
  "mp_commission_delta_capture",
  "mp_commission_delta_refund",
];

export async function driverNetMinor(
  tx: LedgerTx,
  walletId: string,
  currency: string,
  window: { readonly start: Date; readonly end: Date },
): Promise<number> {
  if (window.end.getTime() <= window.start.getTime()) {
    return 0;
  }
  const result = await tx.journalLine.aggregate({
    _sum: { amountMinor: true },
    where: {
      walletId,
      currency,
      account: "wallet",
      entry: {
        kind: { in: [...NET_EARNING_KINDS, ...NET_COMMISSION_KINDS] },
        occurredAt: { gte: window.start, lt: window.end },
      },
    },
  });
  return fromNullableDbMinor(result._sum.amountMinor);
}
