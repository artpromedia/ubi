/**
 * The authorisation step every money instruction shares.
 *
 * The PIN is required for anything that sends money (slice 04 guards). A wrong
 * attempt is persisted in its own transaction so it survives the rollback of
 * whatever it was guarding - otherwise a failed transfer would hand an attacker
 * unlimited guesses.
 */
import { ContractError } from "@ubi/contracts";

import { publishEvent, writeAudit } from "./audit";
import type { WalletCityConfig } from "./city-config";
import type { WalletDeps } from "./context";
import { verifyPin } from "./pin";
import type { Actor } from "./types";
import type { WalletRecord } from "./wallets";

export async function verifyWalletPin(
  deps: WalletDeps,
  actor: Actor,
  wallet: WalletRecord,
  pin: string,
  config: WalletCityConfig,
  now: Date,
): Promise<void> {
  const verdict = await verifyPin(wallet, pin, config.city.maxPinAttempts, now);
  if (verdict.outcome === "ok") {
    if (wallet.pinFailedAttempts > 0) {
      await deps.db.wallet.update({
        where: { id: wallet.id },
        data: { pinFailedAttempts: 0 },
      });
    }
    return;
  }

  // A wrong PIN is persisted in its own transaction so the attempt survives the
  // failure of everything that follows.
  const lockedUntil = verdict.locked
    ? new Date(now.getTime() + config.policy.pinLockMinutes * 60_000)
    : null;

  await deps.db.$transaction(async (tx) => {
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        pinFailedAttempts: verdict.attempts,
        pinLockedUntil: lockedUntil,
      },
    });
    await writeAudit(tx, {
      actor,
      action: "wallet.pin.failed",
      subjectType: "wallet",
      subjectId: wallet.id,
      after: { attempts: verdict.attempts, locked: verdict.locked },
    });
    if (verdict.locked) {
      await publishEvent(tx, {
        name: "pin.locked",
        aggregateType: "wallet",
        aggregateId: wallet.id,
        fromVersion: null,
        toVersion: 1,
        actor,
        actorType: "rider",
        cityId: config.city.cityId,
        idempotencyKey: `pin.locked:${wallet.id}:${now.toISOString()}`,
        occurredAt: now,
        payload: {
          userId: actor.id,
          until: lockedUntil === null ? null : lockedUntil.toISOString(),
        },
      });
    }
  });

  if (verdict.locked) {
    throw new ContractError("pin_attempts_exhausted", "too many wrong PIN attempts", {
      until: lockedUntil?.toISOString() ?? null,
    });
  }
  throw new ContractError("wrong_pin", "that PIN is not right", {
    attemptsLeft: Math.max(0, config.city.maxPinAttempts - verdict.attempts),
  });
}
