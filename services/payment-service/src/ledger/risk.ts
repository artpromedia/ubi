/**
 * Transfer risk: velocity and new-recipient checks.
 *
 * A risky transfer is *held* for a human, never silently posted and never
 * silently dropped (slice 04, board 7e). The thresholds come from the city's
 * `walletPolicy`, so a market can tune them without a deploy and every change
 * goes through config approval.
 */

import { fromDbMinor } from "./minor-units";

import type { WalletPolicy } from "./city-config";
import type { LedgerTx } from "./types";
import type { Money } from "@ubi/contracts";

export const RISK_REASONS = ["new_recipient", "velocity_count", "velocity_amount"] as const;
export type RiskReason = (typeof RISK_REASONS)[number];

export type RiskVerdict =
  | { readonly hold: false; readonly newRecipient: boolean }
  | { readonly hold: true; readonly newRecipient: boolean; readonly reason: RiskReason };

/** True when this wallet has never successfully paid the recipient before. */
export async function isNewRecipient(
  tx: LedgerTx,
  fromWalletId: string,
  toWalletId: string,
): Promise<boolean> {
  const previous = await tx.transfer.findFirst({
    where: { fromWallet: fromWalletId, toWallet: toWalletId, status: "posted" },
    select: { id: true },
  });
  return previous === null;
}

export interface RiskInput {
  readonly fromWalletId: string;
  readonly toWalletId: string;
  readonly amount: Money;
  readonly policy: WalletPolicy;
  readonly now: Date;
}

export async function evaluateTransferRisk(
  tx: LedgerTx,
  input: RiskInput,
): Promise<RiskVerdict> {
  const newRecipient = await isNewRecipient(tx, input.fromWalletId, input.toWalletId);

  if (newRecipient && input.amount.amountMinor > input.policy.newRecipientHoldAboveMinor) {
    return { hold: true, newRecipient, reason: "new_recipient" };
  }

  const since = new Date(
    input.now.getTime() - input.policy.velocityWindowMinutes * 60_000,
  );
  const recent = await tx.transfer.aggregate({
    _count: { _all: true },
    _sum: { amountMinor: true },
    where: {
      fromWallet: input.fromWalletId,
      status: { in: ["posted", "held_risk"] },
      createdAt: { gte: since },
    },
  });

  const count = recent._count._all;
  const spent =
    recent._sum.amountMinor === null ? 0 : fromDbMinor(recent._sum.amountMinor);

  if (count + 1 > input.policy.velocityMaxTransfers) {
    return { hold: true, newRecipient, reason: "velocity_count" };
  }
  if (spent + input.amount.amountMinor > input.policy.velocityMaxAmountMinor) {
    return { hold: true, newRecipient, reason: "velocity_amount" };
  }

  return { hold: false, newRecipient };
}
