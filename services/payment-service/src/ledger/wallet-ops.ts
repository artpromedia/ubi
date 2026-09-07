/**
 * The wallet's own controls: the overview screen's numbers, the one-tap freeze
 * and the PIN reset with its cooling window.
 */
import { ContractError, type Money, money } from "@ubi/contracts";

import { publishEvent, writeAudit } from "./audit";
import { balanceOf } from "./balances";
import { limitStatus } from "./limits";
import { hashPin } from "./pin";
import { ensureWallet } from "./wallets";

import type { WalletDeps } from "./context";
import type { Actor } from "./types";

export interface WalletOverview {
  readonly walletId: string;
  readonly currency: string;
  readonly balance: Money;
  readonly tier: string;
  readonly limits: {
    readonly dailyOut: Money;
    readonly usedToday: Money;
    readonly remainingToday: Money;
    readonly singleTransfer: Money;
    readonly balanceCap: Money | null;
  };
  readonly safeMode: { readonly active: boolean; readonly until: string | null };
  readonly locked: boolean;
  readonly pinSet: boolean;
  readonly pinLockedUntil: string | null;
  readonly coolingUntil: string | null;
}

export async function walletOverview(
  deps: WalletDeps,
  actor: Actor,
  cityId: string,
): Promise<WalletOverview> {
  const now = deps.now();
  const config = await deps.config.load(cityId);
  const wallet = await deps.db.$transaction((tx) =>
    ensureWallet(tx, "user", actor.id, config.city),
  );
  const limits = await limitStatus(deps.db, wallet, config.city, now);
  const balance = await balanceOf(deps.db, wallet.id, wallet.currency);

  return {
    walletId: wallet.id,
    currency: wallet.currency,
    balance,
    tier: wallet.tier,
    limits: {
      dailyOut: money(limits.tier.dailyOutMinor, wallet.currency),
      usedToday: limits.usedToday,
      remainingToday: limits.remainingToday,
      singleTransfer: limits.singleTransfer,
      balanceCap: limits.balanceCap,
    },
    safeMode: {
      active: wallet.safeModeUntil !== null && wallet.safeModeUntil > now,
      until: wallet.safeModeUntil?.toISOString() ?? null,
    },
    locked: wallet.locked,
    pinSet: wallet.pinHash !== null,
    pinLockedUntil: wallet.pinLockedUntil?.toISOString() ?? null,
    coolingUntil: wallet.coolingUntil?.toISOString() ?? null,
  };
}

const OPS_ROLES: readonly string[] = ["ADMIN", "SUPER_ADMIN", "SUPPORT"];

export interface LockInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly locked: boolean;
  /** Whose wallet. Only an ops actor may name anyone but themselves. */
  readonly ownerId?: string | undefined;
  readonly reason?: string | undefined;
}

/**
 * One-tap freeze. The owner can lock; only an ops actor can unlock, so a
 * stolen session cannot undo the freeze it triggered.
 */
export async function setWalletLock(
  deps: WalletDeps,
  input: LockInput,
): Promise<{ readonly walletId: string; readonly locked: boolean }> {
  const isOps = OPS_ROLES.includes(input.actor.role);
  const ownerId = input.ownerId ?? input.actor.id;

  if (ownerId !== input.actor.id && !isOps) {
    throw new ContractError("forbidden", "that is not your wallet");
  }
  if (!input.locked && !isOps) {
    throw new ContractError(
      "forbidden",
      "unlocking a frozen wallet is done by UBI support, not in the app",
    );
  }

  const config = await deps.config.load(input.cityId);
  const wallet = await deps.db.$transaction((tx) =>
    ensureWallet(tx, "user", ownerId, config.city),
  );

  return deps.db.$transaction(async (tx) => {
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { locked: input.locked },
    });
    await writeAudit(tx, {
      actor: input.actor,
      action: input.locked ? "wallet.locked" : "wallet.unlocked",
      subjectType: "wallet",
      subjectId: wallet.id,
      before: { locked: wallet.locked },
      after: { locked: input.locked },
      reason: input.reason ?? null,
    });
    return { walletId: wallet.id, locked: input.locked };
  });
}

export interface PinResetInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly newPin: string;
  readonly stepUpChallengeId: string;
}

export interface PinResetResult {
  readonly walletId: string;
  readonly coolingUntil: string;
  readonly coolingCap: Money;
}

/**
 * Resetting the PIN needs a passed step-up (slice 03 writes those rows), and it
 * starts a cooling window during which a large payment to a recipient the
 * wallet has never paid before is refused.
 */
export async function resetPin(
  deps: WalletDeps,
  input: PinResetInput,
): Promise<PinResetResult> {
  const now = deps.now();
  const config = await deps.config.loadForWallet(input.cityId);

  const challenge = await deps.db.stepUpChallenge.findUnique({
    where: { id: input.stepUpChallengeId },
  });
  if (
    challenge === null ||
    challenge.userId !== input.actor.id ||
    challenge.status !== "passed"
  ) {
    throw new ContractError(
      "step_up_required",
      "resetting a wallet PIN needs a passed identity step-up",
    );
  }
  const challengeAge = now.getTime() - challenge.createdAt.getTime();
  if (challengeAge > config.policy.pinResetCoolingMinutes * 60_000) {
    throw new ContractError("step_up_required", "that step-up is too old to reuse");
  }

  const wallet = await deps.db.$transaction((tx) =>
    ensureWallet(tx, "user", input.actor.id, config.city),
  );
  const pinHash = await hashPin(input.newPin);
  const coolingUntil = new Date(
    now.getTime() + config.policy.pinResetCoolingMinutes * 60_000,
  );

  return deps.db.$transaction(async (tx) => {
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        pinHash,
        pinFailedAttempts: 0,
        pinLockedUntil: null,
        coolingUntil,
      },
    });

    await writeAudit(tx, {
      actor: input.actor,
      action: "wallet.pin.rotated",
      subjectType: "wallet",
      subjectId: wallet.id,
      after: {
        coolingUntil: coolingUntil.toISOString(),
        stepUpChallengeId: challenge.id,
      },
    });

    await publishEvent(tx, {
      name: "pin.rotated",
      aggregateType: "wallet",
      aggregateId: wallet.id,
      fromVersion: null,
      toVersion: 1,
      actor: input.actor,
      actorType: "rider",
      cityId: input.cityId,
      idempotencyKey: `pin.rotated:${wallet.id}:${now.toISOString()}`,
      occurredAt: now,
      payload: { userId: input.actor.id },
    });

    await publishEvent(tx, {
      name: "cooling.started",
      aggregateType: "wallet",
      aggregateId: wallet.id,
      fromVersion: null,
      toVersion: 1,
      actor: input.actor,
      actorType: "rider",
      cityId: input.cityId,
      idempotencyKey: `cooling.started:${wallet.id}:${now.toISOString()}`,
      occurredAt: now,
      payload: {
        userId: input.actor.id,
        until: coolingUntil.toISOString(),
        capMinor: config.policy.pinResetCoolingCapMinor,
      },
    });

    return {
      walletId: wallet.id,
      coolingUntil: coolingUntil.toISOString(),
      coolingCap: money(config.policy.pinResetCoolingCapMinor, config.city.currency),
    };
  });
}

/** First-time PIN enrolment, allowed only while the wallet has no PIN. */
export async function setInitialPin(
  deps: WalletDeps,
  actor: Actor,
  cityId: string,
  pin: string,
): Promise<{ readonly walletId: string }> {
  const config = await deps.config.load(cityId);
  const wallet = await deps.db.$transaction((tx) =>
    ensureWallet(tx, "user", actor.id, config.city),
  );
  if (wallet.pinHash !== null) {
    throw new ContractError(
      "conflict",
      "this wallet already has a PIN; reset it with a step-up instead",
    );
  }
  const pinHash = await hashPin(pin);
  return deps.db.$transaction(async (tx) => {
    const updated = await tx.wallet.updateMany({
      where: { id: wallet.id, pinHash: null },
      data: { pinHash },
    });
    if (updated.count !== 1) {
      throw new ContractError("conflict", "this wallet already has a PIN");
    }
    await writeAudit(tx, {
      actor,
      action: "wallet.pin.enrolled",
      subjectType: "wallet",
      subjectId: wallet.id,
      after: { pinSet: true },
    });
    return { walletId: wallet.id };
  });
}
