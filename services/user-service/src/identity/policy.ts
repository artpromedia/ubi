/**
 * Identity policy for a city.
 *
 * `maxPinAttempts` comes from CITY CONFIG (CLAUDE.md #1) — it is the number the
 * ops console can change per city, and this service never guesses it. If the
 * config service cannot be reached, `forCity` REJECTS: a PIN attempt is money
 * movement, and money movement fails closed rather than falling back to a
 * constant.
 *
 * The remaining numbers are the security timings slice 03 specifies. They are
 * NOT money and not market-specific, so they are stated here once rather than
 * scattered through the module. `CityConfigSchema` in @ubi/contracts has no
 * fields for them yet — when it gains them, `forCity` should read them the same
 * way it reads `maxPinAttempts` and these constants should disappear.
 */
import type { CityConfig } from "@ubi/contracts";
import { ContractError } from "@ubi/contracts";

/** Slice 03: "SIM-swap webhook → wallet.safe_mode(24h)". */
export const SAFE_MODE_HOURS = 24;

/** Slice 03: "POST /v1/wallet/pin/reset (after biometric step-up) → cooling {2h,...}". */
export const PIN_COOLING_HOURS = 2;

/** How long a PIN lock holds before a reset is even offered. */
export const PIN_LOCK_MINUTES = 30;

/** Slice 03: "reminders at 30/14/7/1 days". Descending, so the sweep is ordered. */
export const DOCUMENT_REMINDER_DAYS: readonly number[] = [30, 14, 7, 1];

/** A step-up challenge a user never answers must not stay open forever. */
export const STEP_UP_TTL_MINUTES = 15;

/**
 * NIN face-match score at or above which a selfie step-up passes. Scores are
 * stored; images never are (CLAUDE.md #6).
 */
export const FACE_MATCH_THRESHOLD = 0.82;

/** OTP hardening: short life, few attempts, and a resend the user cannot spam. */
export const OTP_TTL_SECONDS = 300;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_MAX_SENDS_PER_HOUR = 5;
export const OTP_DIGITS = 6;

export interface IdentityPolicy {
  readonly cityId: string;
  readonly configVersion: number;
  /** From city config. */
  readonly maxPinAttempts: number;
  readonly pinLockMs: number;
  readonly coolingMs: number;
  readonly safeModeMs: number;
  readonly stepUpTtlMs: number;
  readonly documentReminderDays: readonly number[];
  readonly faceMatchThreshold: number;
  readonly otpTtlSeconds: number;
  readonly otpMaxAttempts: number;
  readonly otpResendCooldownSeconds: number;
  readonly otpMaxSendsPerHour: number;
}

/** The slice of ConfigClient this module needs. Injectable, so tests need no HTTP. */
export interface CityConfigSource {
  getCityConfig(cityId: string): Promise<CityConfig>;
}

export interface PolicyProvider {
  forCity(cityId: string | null): Promise<IdentityPolicy>;
}

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export function policyFromCityConfig(config: CityConfig): IdentityPolicy {
  return {
    cityId: config.cityId,
    configVersion: config.version,
    maxPinAttempts: config.maxPinAttempts,
    pinLockMs: PIN_LOCK_MINUTES * MINUTE_MS,
    coolingMs: PIN_COOLING_HOURS * HOUR_MS,
    safeModeMs: SAFE_MODE_HOURS * HOUR_MS,
    stepUpTtlMs: STEP_UP_TTL_MINUTES * MINUTE_MS,
    documentReminderDays: DOCUMENT_REMINDER_DAYS,
    faceMatchThreshold: FACE_MATCH_THRESHOLD,
    otpTtlSeconds: OTP_TTL_SECONDS,
    otpMaxAttempts: OTP_MAX_ATTEMPTS,
    otpResendCooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    otpMaxSendsPerHour: OTP_MAX_SENDS_PER_HOUR,
  };
}

/**
 * Resolves the city to read policy for. The signed identity context carries it
 * when the session is bound to one city; otherwise the deployment says which
 * city this instance serves. Neither is a code constant, and when neither is
 * present the request is refused rather than defaulted into a market.
 */
export function resolveCityId(contextCityId: string | null): string {
  if (contextCityId !== null && contextCityId.length > 0) return contextCityId;
  const configured = process.env.IDENTITY_DEFAULT_CITY_ID;
  if (configured !== undefined && configured.length > 0) return configured;
  throw new ContractError(
    "city_unsupported",
    "This request is not scoped to a city, so no policy could be applied",
  );
}

export function createPolicyProvider(source: CityConfigSource): PolicyProvider {
  return {
    async forCity(cityId: string | null): Promise<IdentityPolicy> {
      return policyFromCityConfig(await source.getCityConfig(resolveCityId(cityId)));
    },
  };
}
