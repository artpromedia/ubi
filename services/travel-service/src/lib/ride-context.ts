/**
 * The delegated identity travel-service presents to ride-service.
 *
 * ride-service trusts no caller identity it cannot verify. Behind its identity
 * middleware (services/ride-service/internal/handler/identity.go) every request
 * names its caller in `x-auth-user-id` / `x-auth-user-role` / `x-auth-city-id`
 * and, whenever RIDE_INTERNAL_CONTEXT_SECRET is configured (always, in
 * production), proves it with an HMAC-SHA256 over the canonical payload
 *
 *   ubi.internal.v1|<userId>|<role>|<cityId>|<issuedAt unix seconds>
 *
 * encoded base64url WITHOUT padding in `x-auth-signature`, with the timestamp in
 * `x-auth-issued-at`. ride-service accepts a timestamp within its max age
 * (RIDE_INTERNAL_CONTEXT_MAX_AGE_MS, default 5 minutes) on EITHER side of its
 * clock, so every call here is signed afresh at send time.
 *
 * The API gateway and ask-service are the other signers
 * (services/api-gateway/src/identity/ride-context.ts,
 * services/ask-service/src/lib/ride-context.ts). `rideContextPayload` and
 * `signRideContext` below are a byte-identical port of theirs — same payload,
 * same encoding, same key-list rule — and tests/ride-context.test.ts pins the
 * gateway's parity fixture plus the vectors ride-service's own verifier accepts
 * (internal/handler/ask_delegation_test.go, read and compared field by field),
 * so a drift on any side turns a test red instead of turning production
 * traffic into 401s.
 *
 * What travel-service may sign is NARROWER than what the gateway may: only the
 * traveller who owns an airport transfer, as a `rider` (the requester of the
 * scheduled ride), in the city the transfer was created in. The principal is
 * built from the trusted gateway request context at creation (and read back
 * from the transfer row the worker acts on) — never from a request body, a
 * supplier event or a flight status payload. Never a service, admin, ops or
 * driver principal.
 *
 * RIDE_INTERNAL_CONTEXT_SECRET is the same comma-separated key list the gateway
 * and ride-service read: every listed key verifies on the ride-service side, the
 * FIRST key signs here, so a rotation has no flag day. In production an empty
 * list is a boot error (`loadRideContextKeys`), matching ride-service's own
 * fail-closed boot; in development the identity headers go unsigned, which
 * ride-service accepts only outside production.
 */
import { createHmac } from "node:crypto";

import { ContractError } from "@ubi/contracts";

export const RIDE_CONTEXT_VERSION = "ubi.internal.v1";
export const RIDE_CONTEXT_SECRET_ENV = "RIDE_INTERNAL_CONTEXT_SECRET";

export const RIDE_USER_HEADER = "x-auth-user-id";
export const RIDE_ROLE_HEADER = "x-auth-user-role";
export const RIDE_CITY_HEADER = "x-auth-city-id";
export const RIDE_ISSUED_AT_HEADER = "x-auth-issued-at";
export const RIDE_SIGNATURE_HEADER = "x-auth-signature";

/** The only role travel-service ever presents: the requester of the ride. */
export const DELEGATED_RIDE_ROLE = "rider";

/** Every configured key, current first. Empty when the secret is unset. */
export function parseRideContextKeys(
  raw: string | undefined,
): readonly string[] {
  return (raw ?? "")
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

/**
 * "Real riders, real money". Both spellings deployments use are covered, as in
 * ride-service's `isProductionEnvironment`, so a shorthand cannot dodge the
 * fail-closed rule.
 */
export function isProductionEnvironment(nodeEnv: string | undefined): boolean {
  const normalized = (nodeEnv ?? "").trim().toLowerCase();
  return normalized === "production" || normalized === "prod";
}

/**
 * Reads the signing key list for the process. In production a missing (or
 * blank) secret is a refusal to start: without it travel-service could only
 * reach ride-service unsigned, which production ride-service refuses anyway —
 * failing at boot makes the misconfiguration loud instead of a stream of 401s
 * on travellers' airport rides.
 */
export function loadRideContextKeys(
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  const keys = parseRideContextKeys(env[RIDE_CONTEXT_SECRET_ENV]);
  if (keys.length === 0 && isProductionEnvironment(env.NODE_ENV)) {
    throw new Error(
      `${RIDE_CONTEXT_SECRET_ENV} must be set in production: without it travel-service cannot present a signed traveller identity to ride-service`,
    );
  }
  return keys;
}

/** Who a ride-service call is made AS: the transfer's traveller, as a rider. */
export interface RidePrincipal {
  readonly userId: string;
  readonly cityId: string;
}

/**
 * Visible ASCII with no `|`: the separator must not appear inside a field (the
 * canonical payload would stop being unambiguous), and ride-service trims header
 * values before verifying, so padded or whitespace-bearing values could never
 * verify anyway.
 */
const SIGNABLE_FIELD = /^[\x21-\x7b\x7d\x7e]+$/;

function assertSignable(principal: RidePrincipal): void {
  if (
    !SIGNABLE_FIELD.test(principal.userId) ||
    !SIGNABLE_FIELD.test(principal.cityId)
  ) {
    throw new ContractError(
      "forbidden",
      "the traveller identity cannot be presented to the ride marketplace",
      { reason: "principal_not_signable" },
    );
  }
}

/**
 * The identity headers for ONE ride-service call, as the traveller (role
 * `rider`), signed with the first key and stamped with `now`. With no key
 * configured (development only — production refuses to boot that way) the
 * identity headers are sent unsigned, exactly as the gateway does.
 */
export function riderIdentityHeaders(
  keys: readonly string[],
  principal: RidePrincipal,
  now: Date,
): Record<string, string> {
  assertSignable(principal);
  const headers: Record<string, string> = {
    [RIDE_USER_HEADER]: principal.userId,
    [RIDE_ROLE_HEADER]: DELEGATED_RIDE_ROLE,
    [RIDE_CITY_HEADER]: principal.cityId,
  };
  const signingKey = keys[0];
  if (signingKey !== undefined) {
    const issuedAt = Math.floor(now.getTime() / 1000);
    headers[RIDE_ISSUED_AT_HEADER] = String(issuedAt);
    headers[RIDE_SIGNATURE_HEADER] = signRideContext(
      signingKey,
      principal.userId,
      DELEGATED_RIDE_ROLE,
      principal.cityId,
      issuedAt,
    );
  }
  return headers;
}
