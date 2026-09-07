/**
 * Wallet lookup, provisioning and the guards that run before any money moves.
 *
 * A wallet is identified by (ownerType, ownerId, currency). The currency comes
 * from city config, so a wallet is always denominated in a currency the city
 * actually operates in — there is no default and no NGN literal anywhere here.
 */
import { type CityConfig, ContractError, type KycTier } from "@ubi/contracts";

import { generateId } from "../lib/utils";

import type { LedgerTx } from "./types";

export type WalletOwnerType = "user" | "driver" | "merchant" | "fleet";

export interface WalletRecord {
  readonly id: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly currency: string;
  readonly tier: string;
  readonly safeModeUntil: Date | null;
  readonly locked: boolean;
  readonly pinHash: string | null;
  readonly pinFailedAttempts: number;
  readonly pinLockedUntil: Date | null;
  readonly coolingUntil: Date | null;
  readonly version: number;
}

/** The most restrictive tier the city defines — where a brand new wallet starts. */
export function entryTier(config: CityConfig): KycTier {
  const [first, ...rest] = config.kycTiers;
  if (first === undefined) {
    throw new ContractError("config_unavailable", "city config defines no KYC tiers", {
      cityId: config.cityId,
    });
  }
  return rest.reduce(
    (lowest, candidate) =>
      candidate.dailyOutMinor < lowest.dailyOutMinor ? candidate : lowest,
    first,
  );
}

export async function findWallet(
  tx: LedgerTx,
  ownerType: WalletOwnerType,
  ownerId: string,
  currency: string,
): Promise<WalletRecord | null> {
  return tx.wallet.findUnique({
    where: { ownerType_ownerId_currency: { ownerType, ownerId, currency } },
  });
}

/**
 * Returns the owner's wallet, creating it on first use. Provisioning is
 * idempotent under a race: the unique key on (ownerType, ownerId, currency)
 * decides, and the loser re-reads the winner's row.
 */
export async function ensureWallet(
  tx: LedgerTx,
  ownerType: WalletOwnerType,
  ownerId: string,
  config: CityConfig,
): Promise<WalletRecord> {
  const currency = config.currency;
  const existing = await findWallet(tx, ownerType, ownerId, currency);
  if (existing !== null) {
    return existing;
  }
  return tx.wallet.upsert({
    where: { ownerType_ownerId_currency: { ownerType, ownerId, currency } },
    create: {
      id: generateId("wal"),
      ownerType,
      ownerId,
      currency,
      tier: entryTier(config).tier,
    },
    update: {},
  });
}

export async function requireWallet(
  tx: LedgerTx,
  walletId: string,
): Promise<WalletRecord> {
  const wallet = await tx.wallet.findUnique({ where: { id: walletId } });
  if (wallet === null) {
    throw new ContractError("not_found", "wallet not found", { walletId });
  }
  return wallet;
}

/** One-tap freeze. Unlocking is a human, audited action — never self-service. */
export function assertNotLocked(wallet: WalletRecord): void {
  if (wallet.locked) {
    throw new ContractError("wallet_locked", "this wallet is frozen", {
      walletId: wallet.id,
    });
  }
}

/**
 * Safe mode is entered after a device change or a failed step-up. It blocks
 * peer-to-peer movement entirely for its duration — it does not merely lower a
 * limit (slice 03 → slice 04 hand-off).
 */
export function assertNotSafeMode(wallet: WalletRecord, now: Date): void {
  if (wallet.safeModeUntil !== null && wallet.safeModeUntil > now) {
    throw new ContractError("safe_mode_active", "wallet is in safe mode", {
      until: wallet.safeModeUntil.toISOString(),
    });
  }
}

/**
 * The cooling window after a PIN reset. It does not block everything — it caps
 * what may be sent to a recipient the wallet has never paid before.
 */
export function assertOutsideCoolingCap(
  wallet: WalletRecord,
  now: Date,
  isNewRecipient: boolean,
  amountMinor: number,
  capMinor: number,
): void {
  if (wallet.coolingUntil === null || wallet.coolingUntil <= now) {
    return;
  }
  if (isNewRecipient && amountMinor > capMinor) {
    throw new ContractError(
      "cooling_period",
      "a cooling window is in force after the recent PIN reset",
      { until: wallet.coolingUntil.toISOString(), capMinor },
    );
  }
}
