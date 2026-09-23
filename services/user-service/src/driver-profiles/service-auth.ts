/**
 * Authenticating the machine callers of the driver-profile read model.
 *
 * Only ride-service and ask-service may resolve driver profiles, and each one
 * presents ITS OWN key: `x-service-name` names the caller and `x-service-key`
 * must match that caller's secret (`DRIVER_PROFILE_RIDE_SERVICE_KEY`,
 * `DRIVER_PROFILE_ASK_SERVICE_KEY`). A service that is not on the list has no
 * key to present, one caller's key does not open the door for another, and a
 * leaked key can be rotated without touching the other caller.
 *
 * Like the grant and identity-job surfaces this FAILS CLOSED: with no caller
 * key configured the endpoint refuses every call rather than waving it
 * through. The comparison is constant-time. The gateway strips
 * `x-service-key` and every `x-internal-*` header from client requests and
 * never forwards `/internal/*`, so these credentials cannot arrive from the
 * internet — and a gateway-signed USER identity, however privileged, is never
 * accepted here: an end user cannot enumerate drivers.
 */
import { timingSafeEqual } from "node:crypto";

import { ContractError } from "@ubi/contracts";

export const SERVICE_NAME_HEADER = "x-service-name";
export const SERVICE_KEY_HEADER = "x-service-key";

const MIN_SECRET_LENGTH = 32;

/** Mirrors `DRIVER_PROFILE_CALLERS` in @ubi/contracts (driver-profile.ts). */
const CALLER_KEY_ENV = {
  "ride-service": "DRIVER_PROFILE_RIDE_SERVICE_KEY",
  "ask-service": "DRIVER_PROFILE_ASK_SERVICE_KEY",
} as const;

export type DriverProfileCaller = keyof typeof CALLER_KEY_ENV;

function isCaller(name: string): name is DriverProfileCaller {
  return Object.prototype.hasOwnProperty.call(CALLER_KEY_ENV, name);
}

function configuredKey(caller: DriverProfileCaller): string | undefined {
  const secret = process.env[CALLER_KEY_ENV[caller]];
  if (secret === undefined || secret.length < MIN_SECRET_LENGTH) {
    return undefined;
  }
  return secret;
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Returns the authenticated caller, or throws. Every failure a caller could
 * probe with (unknown name, missing key, wrong key, a key configured for a
 * different caller) answers the same `unauthorized`.
 */
export function requireDriverProfileCaller(
  name: string | undefined,
  presented: string | undefined,
): DriverProfileCaller {
  const anyConfigured = (Object.keys(CALLER_KEY_ENV) as DriverProfileCaller[])
    .map(configuredKey)
    .some((secret) => secret !== undefined);
  if (!anyConfigured) {
    throw new ContractError(
      "service_unavailable",
      "Driver profiles are not configured on this deployment",
    );
  }

  const caller = name?.trim().toLowerCase() ?? "";
  if (!isCaller(caller)) {
    throw new ContractError("unauthorized", "Authentication required");
  }
  const secret = configuredKey(caller);
  if (
    secret === undefined ||
    presented === undefined ||
    !equal(secret, presented)
  ) {
    throw new ContractError("unauthorized", "Authentication required");
  }
  return caller;
}
