/**
 * Posting a completed ride into the ledger.
 *
 * The rules the board and slice 04 fix, encoded once:
 *  - the service fee is a percentage of the *commissionable* amount (fare plus
 *    wait fees) taken from city config, split with `splitPercent` so the
 *    remainder is an explicit line and not a rounding loss;
 *  - a tip bypasses commission entirely — it is computed on nothing and lands
 *    whole in the driver's wallet, on its own `tips` account so that is
 *    provable from the journal rather than from a comment;
 *  - a cash ride moves no wallet money for the fare: the driver already holds
 *    it, so the entry records what the driver owes UBI on the `cash_owed` rail,
 *    which is then netted against the driver's wallet at settlement.
 */
import {
  type CityConfig,
  ContractError,
  type Money,
  money,
  splitPercent,
} from "@ubi/contracts";

import { lockWallet } from "./context";
import { assertSufficientFunds } from "./limits";
import { postEntry } from "./post-entry";
import { requireWallet } from "./wallets";

import type { JournalLineInput, LedgerTx, PostedEntry } from "./types";

export type RidePaymentMethod = "wallet" | "cash";

export interface RideCompletionInput {
  readonly rideId: string;
  readonly method: RidePaymentMethod;
  /** Present for a wallet-paid ride. */
  readonly riderWalletId?: string | undefined;
  readonly driverWalletId: string;
  readonly fareMinor: number;
  readonly waitFeeMinor: number;
  readonly tipMinor: number;
  readonly occurredAt: Date;
  readonly idempotencyKey: string;
}

export interface RideCompletionBreakdown {
  readonly commissionable: Money;
  readonly serviceFee: Money;
  readonly driverShare: Money;
  readonly tip: Money;
  readonly cashOwed: Money;
}

export interface RideCompletionResult {
  readonly entry: PostedEntry;
  readonly breakdown: RideCompletionBreakdown;
}

export function breakdownFor(
  config: CityConfig,
  input: Pick<
    RideCompletionInput,
    "fareMinor" | "waitFeeMinor" | "tipMinor" | "method"
  >,
): RideCompletionBreakdown {
  const currency = config.currency;
  if (input.fareMinor < 0 || input.waitFeeMinor < 0 || input.tipMinor < 0) {
    throw new ContractError(
      "validation_failed",
      "ride amounts cannot be negative",
    );
  }

  const commissionable = money(input.fareMinor + input.waitFeeMinor, currency);
  // splitPercent hands back both halves, so nothing is lost to rounding: the
  // fee and the driver's share always add back up to the commissionable amount.
  const { part: serviceFee, remainder: driverShare } = splitPercent(
    commissionable,
    config.serviceFeePct,
  );
  const tip = money(input.tipMinor, currency);

  return {
    commissionable,
    serviceFee,
    driverShare,
    tip,
    cashOwed: input.method === "cash" ? serviceFee : money(0, currency),
  };
}

export async function postRideCompletion(
  tx: LedgerTx,
  config: CityConfig,
  input: RideCompletionInput,
): Promise<RideCompletionResult> {
  const currency = config.currency;
  const breakdown = breakdownFor(config, input);
  const ref = `ride:${input.rideId}`;
  const lines: JournalLineInput[] = [];

  if (input.method === "wallet") {
    if (input.riderWalletId === undefined) {
      throw new ContractError(
        "validation_failed",
        "a wallet-paid ride needs the rider's wallet",
        { rideId: input.rideId },
      );
    }
    if (
      breakdown.commissionable.amountMinor === 0 &&
      breakdown.tip.amountMinor === 0
    ) {
      throw new ContractError(
        "validation_failed",
        "a ride entry must move something",
        {
          rideId: input.rideId,
        },
      );
    }

    if (breakdown.commissionable.amountMinor > 0) {
      lines.push(
        {
          account: "wallet",
          walletId: input.riderWalletId,
          amount: money(-breakdown.commissionable.amountMinor, currency),
          counterpartRef: `${ref}:fare`,
        },
        {
          account: "ubi_commission",
          amount: breakdown.serviceFee,
          counterpartRef: `${ref}:service_fee`,
        },
        {
          account: "wallet",
          walletId: input.driverWalletId,
          amount: breakdown.driverShare,
          counterpartRef: `${ref}:driver_share`,
        },
      );
    }

    if (breakdown.tip.amountMinor > 0) {
      lines.push(
        {
          account: "tips",
          walletId: input.riderWalletId,
          amount: money(-breakdown.tip.amountMinor, currency),
          counterpartRef: `${ref}:tip`,
        },
        {
          account: "tips",
          walletId: input.driverWalletId,
          amount: breakdown.tip,
          counterpartRef: `${ref}:tip`,
        },
      );
    }
  } else {
    // Cash: the rider handed the driver the fare, the wait fee and any tip.
    // The tip never entered UBI's custody, so there is nothing to post for it —
    // and nothing to take a commission on. What the ledger records is the
    // commission the driver now owes, sitting on the cash rail.
    if (breakdown.serviceFee.amountMinor === 0) {
      throw new ContractError(
        "validation_failed",
        "a cash ride with no commission has nothing to post",
        { rideId: input.rideId },
      );
    }
    lines.push(
      {
        account: "cash_owed",
        amount: money(-breakdown.serviceFee.amountMinor, currency),
        counterpartRef: `${ref}:cash_collected`,
      },
      {
        account: "ubi_commission",
        amount: breakdown.serviceFee,
        counterpartRef: `${ref}:service_fee`,
      },
    );
  }

  const entry = await postEntry(tx, {
    kind: input.method === "cash" ? "ride_completion_cash" : "ride_completion",
    reference: ref,
    occurredAt: input.occurredAt,
    idempotencyKey: input.idempotencyKey,
    description: `ride ${input.method} settlement`,
    lines,
  });

  return { entry, breakdown };
}

// ── Marketplace settlement mode (M06) ──────────────────────────────────────

export interface MarketplaceCompletionInput {
  readonly rideId: string;
  readonly awardId: string;
  readonly method: RidePaymentMethod;
  /** Present for a wallet-paid trip; absent for cash. */
  readonly riderWalletId?: string | undefined;
  readonly driverWalletId: string;
  readonly fareMinor: number;
  readonly tipMinor?: number | undefined;
  readonly currency: string;
  readonly occurredAt: Date;
  readonly idempotencyKey: string;
}

export interface MarketplaceCompletionResult {
  /** Null for a cash trip with no wallet movement — nothing was posted. */
  readonly entry: PostedEntry | null;
}

/**
 * Completion posting for a NEGOTIATED-FARE (marketplace) trip.
 *
 * The 10% commission was already captured at selection (`captureHold`, entry
 * kind `mp_commission_capture`), so completion must NOT charge it again:
 *  - wallet trip: debit the rider the fare, credit the driver the FULL fare —
 *    no `ubi_commission` line here, ever. Tips bypass commission and post on
 *    their own `tips` lines;
 *  - cash trip (worked example section 3): the driver already collected the
 *    fare in cash and UBI's fee left their wallet at selection, so there is
 *    no `cash_owed` to record for the fee — posting one would charge the 10%
 *    a second time. With no wallet tip either, there is nothing to post at
 *    all, and this function honestly posts nothing.
 *
 * Unlike the legacy `postRideCompletion` (deliberately untouched), the rider
 * debit here is guarded: the caller's transaction takes the wallet row lock
 * and the spendable check (balance minus active bid holds) before any line is
 * written, so a completion cannot race the rider's wallet negative.
 */
export async function postMarketplaceCompletion(
  tx: LedgerTx,
  input: MarketplaceCompletionInput,
): Promise<MarketplaceCompletionResult> {
  const currency = input.currency;
  const tipMinor = input.tipMinor ?? 0;
  if (
    !Number.isInteger(input.fareMinor) ||
    !Number.isInteger(tipMinor) ||
    input.fareMinor < 0 ||
    tipMinor < 0
  ) {
    throw new ContractError(
      "validation_failed",
      "marketplace completion amounts must be nonnegative integer minor units",
      { rideId: input.rideId },
    );
  }

  const ref = `mp_ride:${input.rideId}`;
  const lines: JournalLineInput[] = [];

  if (input.method === "wallet") {
    if (input.riderWalletId === undefined) {
      throw new ContractError(
        "validation_failed",
        "a wallet-paid trip needs the rider's wallet",
        { rideId: input.rideId },
      );
    }
    if (input.fareMinor === 0 && tipMinor === 0) {
      throw new ContractError(
        "validation_failed",
        "a wallet completion must move something",
        { rideId: input.rideId },
      );
    }

    // Guard the rider debit: lock, then spend against spendable funds.
    await lockWallet(tx, input.riderWalletId);
    const riderWallet = await requireWallet(tx, input.riderWalletId);
    await assertSufficientFunds(
      tx,
      riderWallet,
      money(input.fareMinor + tipMinor, currency),
    );

    if (input.fareMinor > 0) {
      lines.push(
        {
          account: "wallet",
          walletId: input.riderWalletId,
          amount: money(-input.fareMinor, currency),
          counterpartRef: `${ref}:fare`,
        },
        {
          // The FULL fare: the 10% fee already left this driver's wallet at
          // selection (award:<id> capture entry) — no commission line here.
          account: "wallet",
          walletId: input.driverWalletId,
          amount: money(input.fareMinor, currency),
          counterpartRef: `${ref}:driver_share`,
        },
      );
    }
    if (tipMinor > 0) {
      lines.push(
        {
          account: "tips",
          walletId: input.riderWalletId,
          amount: money(-tipMinor, currency),
          counterpartRef: `${ref}:tip`,
        },
        {
          account: "tips",
          walletId: input.driverWalletId,
          amount: money(tipMinor, currency),
          counterpartRef: `${ref}:tip`,
        },
      );
    }

    const entry = await postEntry(tx, {
      kind: "mp_ride_completion",
      reference: ref,
      occurredAt: input.occurredAt,
      idempotencyKey: input.idempotencyKey,
      description: "marketplace trip settlement (fee captured at selection)",
      lines,
    });
    return { entry };
  }

  // Cash trip. The rider handed the driver the fare (and any tip) directly,
  // and UBI's 10% was captured from the driver's wallet at selection — the
  // worked example, section 3: posting a cash_owed fee here would take the
  // commission twice. A wallet tip is the only value that can still cross
  // UBI's books on a cash marketplace trip.
  if (tipMinor > 0 && input.riderWalletId !== undefined) {
    await lockWallet(tx, input.riderWalletId);
    const riderWallet = await requireWallet(tx, input.riderWalletId);
    await assertSufficientFunds(tx, riderWallet, money(tipMinor, currency));
    const entry = await postEntry(tx, {
      kind: "mp_ride_completion_cash",
      reference: ref,
      occurredAt: input.occurredAt,
      idempotencyKey: input.idempotencyKey,
      description: "marketplace cash trip: wallet tip only (fee captured at selection)",
      lines: [
        {
          account: "tips",
          walletId: input.riderWalletId,
          amount: money(-tipMinor, currency),
          counterpartRef: `${ref}:tip`,
        },
        {
          account: "tips",
          walletId: input.driverWalletId,
          amount: money(tipMinor, currency),
          counterpartRef: `${ref}:tip`,
        },
      ],
    });
    return { entry };
  }

  return { entry: null };
}

export interface CashSettlementInput {
  readonly driverWalletId: string;
  readonly amount: Money;
  readonly reference: string;
  readonly occurredAt: Date;
  readonly idempotencyKey: string;
}

/**
 * Netting: the driver settles the cash they owe out of their wallet balance.
 * The cash rail returns to zero and the driver's balance drops by what they
 * collected on UBI's behalf.
 */
export async function postCashSettlement(
  tx: LedgerTx,
  input: CashSettlementInput,
): Promise<PostedEntry> {
  if (input.amount.amountMinor <= 0) {
    throw new ContractError(
      "validation_failed",
      "a settlement must move a positive amount",
    );
  }
  const entry = await postEntry(tx, {
    kind: "cash_settlement",
    reference: input.reference,
    occurredAt: input.occurredAt,
    idempotencyKey: input.idempotencyKey,
    description: "driver cash owed netted against wallet",
    lines: [
      {
        account: "wallet",
        walletId: input.driverWalletId,
        amount: money(-input.amount.amountMinor, input.amount.currency),
        counterpartRef: `${input.reference}:cash_owed`,
      },
      {
        account: "cash_owed",
        amount: input.amount,
        counterpartRef: `wallet:${input.driverWalletId}`,
      },
    ],
  });
  return entry;
}
