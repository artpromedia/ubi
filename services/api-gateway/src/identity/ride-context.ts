/**
 * HMAC parity with the Go ride-service.
 *
 * The ride-service verifies a second, lighter signature besides the JWS: an
 * HMAC-SHA256 over the canonical payload
 *
 *   ubi.internal.v1|<userId>|<role>|<cityId>|<issuedAt unix seconds>
 *
 * carried in `x-auth-signature` / `x-auth-issued-at` and keyed by
 * RIDE_INTERNAL_CONTEXT_SECRET (services/ride-service/internal/handler/
 * identity.go is the counterpart definition — the two files must agree, and
 * tests/ride-signature.test.ts pins a shared fixture so a drift turns a test
 * red on either side).
 *
 * The secret is a comma-separated key list: every key verifies on the
 * ride-service side, the FIRST key signs here, so a rotation has no flag day
 * (set `new,old` everywhere, roll pods, then drop `old`). It is read per call,
 * not at import, so a rotation needs no gateway restart.
 *
 * When the variable is unset the gateway sends no HMAC headers at all; the
 * ride-service then only accepts that in development — its production boot
 * fails closed without the secret (docs/security/INTERNAL_IDENTITY.md).
 */
import { createHmac } from "node:crypto";

export const RIDE_CONTEXT_VERSION = "ubi.internal.v1";

export const RIDE_SIGNATURE_HEADER = "x-auth-signature";
export const RIDE_ISSUED_AT_HEADER = "x-auth-issued-at";
export const RIDE_CITY_HEADER = "x-auth-city-id";

function readSecret(name: string): string {
  return process.env[name] ?? "";
}

/** Every configured key, current first. Empty when the secret is unset. */
export function rideContextKeys(): readonly string[] {
  return readSecret("RIDE_INTERNAL_CONTEXT_SECRET")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** The exact canonical payload the ride-service reconstructs and verifies. */
export function rideContextPayload(
  userId: string,
  role: string,
  cityId: string,
  issuedAtSeconds: number,
): string {
  return [
    RIDE_CONTEXT_VERSION,
    userId,
    role,
    cityId,
    String(issuedAtSeconds),
  ].join("|");
}

/** base64url (no padding) HMAC-SHA256 — the ride-service's encoding. */
export function signRideContext(
  key: string,
  userId: string,
  role: string,
  cityId: string,
  issuedAtSeconds: number,
): string {
  return createHmac("sha256", key)
    .update(rideContextPayload(userId, role, cityId, issuedAtSeconds))
    .digest("base64url");
}
