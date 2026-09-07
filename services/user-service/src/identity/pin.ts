/**
 * Wallet PIN: attempts, lockout, reset and the cooling window.
 *
 * `maxPinAttempts` comes from CITY CONFIG, not from a constant here — the
 * number in the slice ("lock after 5") is Lagos's current value, not a rule of
 * the code. The counter, the lock and the cooling window live on the `wallets`
 * row, which is the same row the money-moving service reads inside its own
 * transaction; there is no cache pretending to be the truth.
 *
 * RESET NEEDS BIOMETRIC STEP-UP. A reset consumes a `step_up_challenges` row
 * that PASSED with `selfie_nin` — an SMS code is refused outright, because the
 * phone is exactly what an attacker takes first. After a reset the wallet
 * enters a cooling window during which the money service applies the tighter
 * new-recipient rules.
 */
import { ContractError } from "@ubi/contracts";
import bcrypt from "bcrypt";
import { z } from "zod";

import { writeAudit } from "./audit";
import { actorTypeFor, auditRevision } from "./common";
import type { IdentityDeps } from "./deps";
import { writeOutboxEvent } from "./outbox";
import { assertNotInSafeMode } from "./safe-mode";

const BCRYPT_ROUNDS = 12;

export const PinSchema = z.string().regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits");

export const VerifyPinSchema = z.object({ pin: PinSchema });

export const ResetPinSchema = z.object({
  /** A step-up challenge that already PASSED with a biometric method. */
  challengeId: z.string().min(1).max(64),
  newPin: PinSchema,
});

export interface PinContext {
  readonly userId: string;
  readonly role: string;
  readonly cityId: string | null;
}

export interface PinState {
  readonly locked: boolean;
  readonly lockedUntil: Date | null;
  readonly attemptsRemaining: number;
  readonly coolingUntil: Date | null;
}

interface WalletRow {
  readonly id: string;
  readonly pinHash: string | null;
  readonly pinFailedAttempts: number;
  readonly pinLockedUntil: Date | null;
  readonly coolingUntil: Date | null;
}

async function walletsFor(deps: IdentityDeps, userId: string): Promise<readonly WalletRow[]> {
  const wallets = await deps.prisma.wallet.findMany({
    where: { ownerId: userId },
    select: {
      id: true,
      pinHash: true,
      pinFailedAttempts: true,
      pinLockedUntil: true,
      coolingUntil: true,
    },
    orderBy: { id: "asc" },
  });
  if (wallets.length === 0) {
    throw new ContractError("not_found", "You don't have a wallet yet");
  }
  return wallets;
}

function worst(wallets: readonly WalletRow[]): WalletRow {
  const [first, ...rest] = wallets;
  if (first === undefined) throw new ContractError("not_found", "You don't have a wallet yet");
  return rest.reduce(
    (acc, candidate) => (candidate.pinFailedAttempts > acc.pinFailedAttempts ? candidate : acc),
    first,
  );
}

export async function pinState(deps: IdentityDeps, context: PinContext): Promise<PinState> {
  const now = deps.now();
  const policy = await deps.policy.forCity(context.cityId);
  const wallet = worst(await walletsFor(deps, context.userId));
  const locked = wallet.pinLockedUntil !== null && wallet.pinLockedUntil.getTime() > now.getTime();
  return {
    locked,
    lockedUntil: locked ? wallet.pinLockedUntil : null,
    attemptsRemaining: Math.max(0, policy.maxPinAttempts - wallet.pinFailedAttempts),
    coolingUntil:
      wallet.coolingUntil !== null && wallet.coolingUntil.getTime() > now.getTime()
        ? wallet.coolingUntil
        : null,
  };
}

export interface VerifyPinResult {
  readonly verified: true;
  readonly coolingUntil: Date | null;
}

/**
 * One PIN attempt. A wrong PIN increments the counter for every wallet the user
 * owns; reaching the configured limit locks them all and emits `pin.locked`.
 */
export async function verifyPin(
  deps: IdentityDeps,
  context: PinContext,
  pin: string,
): Promise<VerifyPinResult> {
  const now = deps.now();
  const policy = await deps.policy.forCity(context.cityId);
  const wallets = await walletsFor(deps, context.userId);
  const reference = worst(wallets);

  if (reference.pinLockedUntil !== null && reference.pinLockedUntil.getTime() > now.getTime()) {
    throw new ContractError(
      "pin_locked",
      "Your PIN is locked. Reset it with a selfie check to unlock your wallet.",
      { lockedUntil: reference.pinLockedUntil.toISOString() },
    );
  }

  if (reference.pinHash === null) {
    throw new ContractError("pin_not_verified", "Set a wallet PIN before using it");
  }

  const matches = await bcrypt.compare(pin, reference.pinHash);
  if (matches) {
    await deps.prisma.wallet.updateMany({
      where: { ownerId: context.userId },
      data: { pinFailedAttempts: 0, pinLockedUntil: null },
    });
    return {
      verified: true,
      coolingUntil:
        reference.coolingUntil !== null && reference.coolingUntil.getTime() > now.getTime()
          ? reference.coolingUntil
          : null,
    };
  }

  const attempts = reference.pinFailedAttempts + 1;
  const willLock = attempts >= policy.maxPinAttempts;
  const lockedUntil = willLock ? new Date(now.getTime() + policy.pinLockMs) : null;

  await deps.prisma.$transaction(async (tx) => {
    await tx.wallet.updateMany({
      where: { ownerId: context.userId },
      data: {
        pinFailedAttempts: attempts,
        ...(lockedUntil === null ? {} : { pinLockedUntil: lockedUntil }),
      },
    });

    if (!willLock) return;

    const revision = await auditRevision(tx, "user", context.userId);
    await writeAudit(tx, {
      actorId: context.userId,
      actorRole: context.role,
      action: "pin.locked",
      subjectType: "user",
      subjectId: context.userId,
      after: { attempts, lockedUntil: lockedUntil?.toISOString() ?? null },
      reason: "max_pin_attempts_reached",
    });

    await writeOutboxEvent(tx, {
      name: "pin.locked",
      subjectType: "user",
      subjectId: context.userId,
      actorType: actorTypeFor(context.role),
      actorId: context.userId,
      idempotencyKey: `pin.locked:${context.userId}:${now.toISOString()}`,
      fromVersion: revision,
      toVersion: revision + 1,
      cityId: policy.cityId,
      payload: {
        userId: context.userId,
        until: lockedUntil?.toISOString() ?? null,
        // No cap is emitted: city config carries no cooling-window cap field,
        // and this service will not invent a money amount (CLAUDE.md #1).
        capMinor: null,
        attempts,
      },
      occurredAt: now,
    });
  });

  if (willLock) {
    throw new ContractError(
      "pin_locked",
      "Your PIN is locked after too many wrong tries. Reset it with a selfie check.",
      { lockedUntil: lockedUntil?.toISOString() ?? null, attempts },
    );
  }

  throw new ContractError("wrong_pin", "That PIN is not right", {
    attemptsRemaining: Math.max(0, policy.maxPinAttempts - attempts),
  });
}

export interface ResetPinResult {
  readonly rotated: true;
  readonly coolingUntil: Date;
}

/**
 * Sets a new PIN after a biometric step-up and starts the cooling window.
 *
 * The challenge must be the caller's own, must have PASSED, must have used a
 * biometric method, and must be recent. An `sms_otp` challenge is refused with
 * `step_up_required` — SMS alone never unlocks money.
 */
export async function resetPin(
  deps: IdentityDeps,
  context: PinContext,
  input: z.infer<typeof ResetPinSchema>,
): Promise<ResetPinResult> {
  const now = deps.now();
  const policy = await deps.policy.forCity(context.cityId);

  // A hold placed after a SIM swap is not lifted by resetting the PIN.
  await assertNotInSafeMode(deps, context.userId, "wallet.pin.reset");

  const challenge = await deps.prisma.stepUpChallenge.findUnique({
    where: { id: input.challengeId },
  });
  if (challenge === null || challenge.userId !== context.userId) {
    throw new ContractError("step_up_required", "Finish the selfie check before resetting your PIN");
  }
  if (challenge.method === "sms_otp") {
    throw new ContractError(
      "step_up_required",
      "An SMS code is not enough to reset your PIN. Use the selfie check.",
      { allowedMethods: ["selfie_nin"] },
    );
  }
  if (challenge.method !== "selfie_nin") {
    throw new ContractError(
      "step_up_required",
      "Resetting a PIN needs the selfie check.",
      { allowedMethods: ["selfie_nin"] },
    );
  }
  if (challenge.status !== "passed" || challenge.resolvedAt === null) {
    throw new ContractError("step_up_required", "That selfie check has not passed");
  }
  if (now.getTime() - challenge.resolvedAt.getTime() > policy.stepUpTtlMs) {
    throw new ContractError("step_up_required", "That selfie check is too old. Do it again.");
  }

  await walletsFor(deps, context.userId);
  const pinHash = await bcrypt.hash(input.newPin, BCRYPT_ROUNDS);
  const coolingUntil = new Date(now.getTime() + policy.coolingMs);

  await deps.prisma.$transaction(async (tx) => {
    // Consume the challenge so one selfie cannot reset the PIN twice.
    const consumed = await tx.stepUpChallenge.updateMany({
      where: { id: challenge.id, status: "passed" },
      data: { status: "consumed" },
    });
    if (consumed.count === 0) {
      throw new ContractError("step_up_required", "That selfie check has already been used");
    }

    await tx.wallet.updateMany({
      where: { ownerId: context.userId },
      data: {
        pinHash,
        pinFailedAttempts: 0,
        pinLockedUntil: null,
        coolingUntil,
        version: { increment: 1 },
      },
    });

    const revision = await auditRevision(tx, "user", context.userId);
    await writeAudit(tx, {
      actorId: context.userId,
      actorRole: context.role,
      action: "pin.rotated",
      subjectType: "user",
      subjectId: context.userId,
      // The PIN itself never appears here, hashed or otherwise.
      after: { challengeId: challenge.id, coolingUntil: coolingUntil.toISOString() },
      reason: "biometric_step_up",
    });

    await writeOutboxEvent(tx, {
      name: "pin.rotated",
      subjectType: "user",
      subjectId: context.userId,
      actorType: actorTypeFor(context.role),
      actorId: context.userId,
      idempotencyKey: `pin.rotated:${challenge.id}`,
      fromVersion: revision,
      toVersion: revision + 1,
      cityId: policy.cityId,
      payload: { userId: context.userId, until: coolingUntil.toISOString(), capMinor: null },
      occurredAt: now,
    });

    await writeOutboxEvent(tx, {
      name: "cooling.started",
      subjectType: "user",
      subjectId: context.userId,
      actorType: actorTypeFor(context.role),
      actorId: context.userId,
      idempotencyKey: `cooling.started:${challenge.id}`,
      fromVersion: revision,
      toVersion: revision + 1,
      cityId: policy.cityId,
      payload: { userId: context.userId, until: coolingUntil.toISOString(), capMinor: null },
      occurredAt: now,
    });
  });

  return { rotated: true, coolingUntil };
}
