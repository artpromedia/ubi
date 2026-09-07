/**
 * Wallet PIN handling.
 *
 * The PIN is never stored, logged or returned — only a salted scrypt digest is
 * kept, and comparison is constant time. Attempt counting and lockout live on
 * the wallet row so they survive a restart and cannot be reset by retrying
 * against another instance. The attempt ceiling comes from city config.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { ContractError } from "@ubi/contracts";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const PIN_PATTERN = /^\d{4,6}$/;

export function assertPinShape(pin: string): void {
  if (!PIN_PATTERN.test(pin)) {
    throw new ContractError("validation_failed", "PIN must be 4 to 6 digits");
  }
}

export async function hashPin(pin: string): Promise<string> {
  assertPinShape(pin);
  const salt = randomBytes(16).toString("hex");
  const digest = await scrypt(pin, salt, KEY_LENGTH);
  return `scrypt:${salt}:${digest.toString("hex")}`;
}

async function digestMatches(pin: string, stored: string): Promise<boolean> {
  const [algorithm, salt, expected] = stored.split(":");
  if (algorithm !== "scrypt" || salt === undefined || expected === undefined) {
    return false;
  }
  const actual = await scrypt(pin, salt, KEY_LENGTH);
  const expectedBuffer = Buffer.from(expected, "hex");
  if (expectedBuffer.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(actual, expectedBuffer);
}

export interface PinState {
  readonly pinHash: string | null;
  readonly pinFailedAttempts: number;
  readonly pinLockedUntil: Date | null;
}

export type PinVerdict =
  | { readonly outcome: "ok" }
  | { readonly outcome: "wrong"; readonly attempts: number; readonly locked: boolean };

/**
 * Verifies a PIN against a wallet's stored state. The caller persists the
 * returned attempt count in the same transaction that acts on the verdict, so
 * a failed attempt is never lost.
 */
export async function verifyPin(
  state: PinState,
  pin: string,
  maxAttempts: number,
  now: Date,
): Promise<PinVerdict> {
  if (state.pinLockedUntil !== null && state.pinLockedUntil > now) {
    throw new ContractError("pin_locked", "wallet PIN is locked", {
      until: state.pinLockedUntil.toISOString(),
    });
  }
  if (state.pinHash === null) {
    throw new ContractError("pin_not_verified", "this wallet has no PIN set");
  }
  assertPinShape(pin);

  if (await digestMatches(pin, state.pinHash)) {
    return { outcome: "ok" };
  }

  const attempts = state.pinFailedAttempts + 1;
  return { outcome: "wrong", attempts, locked: attempts >= maxAttempts };
}
