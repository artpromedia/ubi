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

import { postEntry } from "./post-entry";
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
  input: Pick<RideCompletionInput, "fareMinor" | "waitFeeMinor" | "tipMinor" | "method">,
): RideCompletionBreakdown {
  const currency = config.currency;
  if (input.fareMinor < 0 || input.waitFeeMinor < 0 || input.tipMinor < 0) {
    throw new ContractError("validation_failed", "ride amounts cannot be negative");
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
    if (breakdown.commissionable.amountMinor === 0 && breakdown.tip.amountMinor === 0) {
      throw new ContractError("validation_failed", "a ride entry must move something", {
        rideId: input.rideId,
      });
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
    throw new ContractError("validation_failed", "a settlement must move a positive amount");
  }
  return postEntry(tx, {
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
}
