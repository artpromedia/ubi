/**
 * Hardened phone OTP.
 *
 * What this does that the legacy `/auth/login/otp` and `/auth/verify-otp` in
 * routes/auth.ts do not:
 *
 *   - the code is HASHED AT REST (scrypt). Redis holds a hash, never the code,
 *     so a dump of the cache does not hand over live codes.
 *   - the cache KEY is a hash of the phone number, so the key space carries no
 *     PII either, and no log line ever contains the code or the number.
 *   - attempts are counted against the CODE, and exhausting them destroys it,
 *     rather than leaving a code alive to be guessed again after the counter
 *     resets.
 *   - a resend cooldown, on top of the hourly send cap.
 *   - a failed hand-off to the notification service DELETES the code and
 *     reports the failure, instead of silently leaving a code the user never
 *     received (honest unavailability).
 *
 * WHAT AN OTP BUYS. Possession of a phone number, and nothing more. It never
 * trusts a device, never lifts limited mode, never lifts safe mode and never
 * unlocks money — see `step-up.ts` and `pin.ts`, which refuse it explicitly.
 */
import { ContractError } from "@ubi/contracts";
import { createHash, randomInt } from "node:crypto";
import { z } from "zod";

import type { IdentityDeps } from "./deps";
import { hashSecret, verifySecret } from "./secret-hash";

export const OTP_PURPOSES = ["login", "verification"] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

export const RequestOtpSchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{7,14}$/, "phone must be in E.164 form"),
  purpose: z.enum(OTP_PURPOSES).default("login"),
});

export const VerifyOtpSchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{7,14}$/, "phone must be in E.164 form"),
  code: z.string().regex(/^\d{4,8}$/),
});

/** Keys are derived, so nothing readable about a person sits in the cache. */
function phoneKey(phone: string): string {
  const pepper = process.env.IDENTITY_OTP_PEPPER ?? "";
  return createHash("sha256").update(`${pepper}:${phone}`).digest("base64url").slice(0, 32);
}

const codeKey = (id: string): string => `ubi:identity:otp:${id}`;
const cooldownKey = (id: string): string => `ubi:identity:otp:cooldown:${id}`;
const sendsKey = (id: string): string => `ubi:identity:otp:sends:${id}`;

interface StoredOtp {
  readonly hash: string;
  readonly purpose: OtpPurpose;
  readonly attempts: number;
}

function generateCode(digits: number): string {
  const max = 10 ** digits;
  return String(randomInt(0, max)).padStart(digits, "0");
}

export interface RequestOtpResult {
  readonly expiresInSeconds: number;
  readonly resendAfterSeconds: number;
}

export async function requestOtp(
  deps: IdentityDeps,
  input: z.infer<typeof RequestOtpSchema>,
  userId?: string,
): Promise<RequestOtpResult> {
  const policy = await deps.policy.forCity(null);
  const id = phoneKey(input.phone);

  const cooling = await deps.cache.ttl(cooldownKey(id));
  if (cooling > 0) {
    throw new ContractError("rate_limited", "Wait a moment before asking for another code", {
      retryAfterSeconds: cooling,
    });
  }

  const sends = await deps.cache.incr(sendsKey(id));
  if (sends === 1) await deps.cache.expire(sendsKey(id), 3600);
  if (sends > policy.otpMaxSendsPerHour) {
    throw new ContractError("rate_limited", "Too many codes requested. Try again later.");
  }

  const code = generateCode(6);
  const stored: StoredOtp = {
    hash: await hashSecret(code),
    purpose: input.purpose,
    attempts: 0,
  };
  await deps.cache.set(codeKey(id), JSON.stringify(stored), "EX", policy.otpTtlSeconds);
  await deps.cache.set(
    cooldownKey(id),
    "1",
    "EX",
    policy.otpResendCooldownSeconds,
  );

  try {
    await deps.notifier.sendSms({
      ...(userId === undefined ? {} : { userId }),
      phone: input.phone,
      message: `Your UBI code is ${code}. It expires in ${Math.round(
        policy.otpTtlSeconds / 60,
      )} minutes. UBI will never ask you for it.`,
    });
  } catch {
    // A code the user never received must not stay valid.
    await deps.cache.del(codeKey(id));
    throw new ContractError(
      "service_unavailable",
      "We couldn't send your code right now. Please try again shortly.",
    );
  }

  return {
    expiresInSeconds: policy.otpTtlSeconds,
    resendAfterSeconds: policy.otpResendCooldownSeconds,
  };
}

export interface VerifyOtpResult {
  readonly verified: true;
  readonly purpose: OtpPurpose;
  /**
   * Stated in the result so no caller can forget it: an OTP proves the phone,
   * not the person or the device.
   */
  readonly grantsMoneyAccess: false;
}

export async function verifyOtp(
  deps: IdentityDeps,
  input: z.infer<typeof VerifyOtpSchema>,
): Promise<VerifyOtpResult> {
  const policy = await deps.policy.forCity(null);
  const id = phoneKey(input.phone);

  const raw = await deps.cache.get(codeKey(id));
  if (raw === null) {
    throw new ContractError("unauthorized", "That code has expired. Ask for a new one.");
  }

  let stored: StoredOtp;
  try {
    stored = JSON.parse(raw) as StoredOtp;
  } catch {
    await deps.cache.del(codeKey(id));
    throw new ContractError("unauthorized", "That code has expired. Ask for a new one.");
  }

  const matches = await verifySecret(input.code, stored.hash);
  if (!matches) {
    const attempts = stored.attempts + 1;
    if (attempts >= policy.otpMaxAttempts) {
      await deps.cache.del(codeKey(id));
      throw new ContractError(
        "rate_limited",
        "Too many wrong tries. Ask for a new code.",
      );
    }
    const remainingTtl = await deps.cache.ttl(codeKey(id));
    await deps.cache.set(
      codeKey(id),
      JSON.stringify({ ...stored, attempts }),
      "EX",
      remainingTtl > 0 ? remainingTtl : policy.otpTtlSeconds,
    );
    throw new ContractError("unauthorized", "That code is not right", {
      attemptsRemaining: policy.otpMaxAttempts - attempts,
    });
  }

  await deps.cache.del(codeKey(id), cooldownKey(id), sendsKey(id));
  return { verified: true, purpose: stored.purpose, grantsMoneyAccess: false };
}
