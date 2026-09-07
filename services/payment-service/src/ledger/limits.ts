/**
 * KYC tier limits. The numbers are CBN-style daily and per-transfer caps and
 * they come from the city config's `kycTiers` — the wallet never carries a
 * limit of its own (CLAUDE.md #1).
 */
import {
  type CityConfig,
  ContractError,
  kycTier,
  type KycTier,
  type Money,
  money,
  subtractMoney,
} from "@ubi/contracts";

import { balanceOf, outboundToday } from "./balances";
import { dayWindow } from "./day-window";
import type { LedgerTx } from "./types";
import type { WalletRecord } from "./wallets";

export interface LimitStatus {
  readonly tier: KycTier;
  /** Sent out today already, on the owner's own instruction. */
  readonly usedToday: Money;
  /** What is left of the daily allowance. Never negative. */
  readonly remainingToday: Money;
  readonly singleTransfer: Money;
  readonly balanceCap: Money | null;
}

export async function limitStatus(
  tx: LedgerTx,
  wallet: WalletRecord,
  config: CityConfig,
  now: Date,
): Promise<LimitStatus> {
  const tier = kycTier(config, wallet.tier);
  const today = dayWindow(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: config.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now),
    config.timezone,
  );
  const used = await outboundToday(tx, wallet.id, wallet.currency, today);
  const remainingMinor = Math.max(0, tier.dailyOutMinor - used.amountMinor);
  return {
    tier,
    usedToday: used,
    remainingToday: money(remainingMinor, wallet.currency),
    singleTransfer: money(tier.singleTransferMinor, wallet.currency),
    balanceCap:
      tier.balanceCapMinor === null ? null : money(tier.balanceCapMinor, wallet.currency),
  };
}

/** Throws `limit_exceeded` when the amount breaches the single or daily cap. */
export function assertWithinLimits(status: LimitStatus, amount: Money): void {
  if (amount.amountMinor > status.singleTransfer.amountMinor) {
    throw new ContractError(
      "limit_exceeded",
      "that is more than a single transfer may carry on this tier",
      {
        tier: status.tier.tier,
        limitMinor: status.singleTransfer.amountMinor,
        amountMinor: amount.amountMinor,
      },
    );
  }
  if (amount.amountMinor > status.remainingToday.amountMinor) {
    throw new ContractError(
      "limit_exceeded",
      "that would take the wallet past its daily limit for this tier",
      {
        tier: status.tier.tier,
        remainingMinor: status.remainingToday.amountMinor,
        amountMinor: amount.amountMinor,
      },
    );
  }
}

/** A tier may also cap how much value the wallet is allowed to hold. */
export async function assertWithinBalanceCap(
  tx: LedgerTx,
  wallet: WalletRecord,
  incoming: Money,
  status: LimitStatus,
): Promise<void> {
  if (status.balanceCap === null) {
    return;
  }
  const balance = await balanceOf(tx, wallet.id, wallet.currency);
  if (balance.amountMinor + incoming.amountMinor > status.balanceCap.amountMinor) {
    throw new ContractError(
      "limit_exceeded",
      "that would take the wallet past the balance this tier may hold",
      {
        tier: status.tier.tier,
        capMinor: status.balanceCap.amountMinor,
        headroomMinor: subtractMoney(status.balanceCap, balance).amountMinor,
      },
    );
  }
}

export async function assertSufficientFunds(
  tx: LedgerTx,
  wallet: WalletRecord,
  amount: Money,
): Promise<Money> {
  const balance = await balanceOf(tx, wallet.id, wallet.currency);
  if (balance.amountMinor < amount.amountMinor) {
    throw new ContractError("insufficient_funds", "not enough money in the wallet", {
      balanceMinor: balance.amountMinor,
      requiredMinor: amount.amountMinor,
    });
  }
  return balance;
}
