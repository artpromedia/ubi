/**
 * Verifying the API gateway's signed identity context (`x-ubi-identity`).
 *
 * Airport transfers make travel-service a SIGNER of the ride-service identity
 * (./ride-context.ts): what it signs must itself be proven, or anyone who can
 * reach travel-service on the service network could have it mint a signed
 * traveller identity for any user id and any city. So the transfer routes read
 * the caller from the gateway's signed context, exactly as ask-service — the
 * other delegated signer — does (services/ask-service/src/lib/identity-
 * context.ts is the source of this port; payment-service and user-service
 * verify the same claims with the same secret).
 *
 * The gateway validates the client's bearer token and mints a short-lived
 * compact HS256 JWS naming WHO the caller is (sub, role), WHAT this request may
 * do (scp — the effective scopes after limited mode / wallet safe mode), which
 * restriction modes are active (mod) and WHERE it is scoped (city), signed with
 * the INTERNAL secret UBI_IDENTITY_SECRET (never a key a client holds;
 * services/api-gateway/src/identity/context.ts is the issuer).
 *
 * The header must say HS256 (anything else — `none` included — is refused), the
 * HMAC over `<header>.<payload>` must match one configured key in constant time,
 * and the issuer, audience and expiry must hold. Every failure is the same
 * `unauthorized`, so a probe learns nothing. The previous key
 * (UBI_IDENTITY_SECRET_PREVIOUS) also verifies, so the gateway can rotate with
 * no flag day.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { ContractError } from "@ubi/contracts";

export const IDENTITY_HEADER = "x-ubi-identity";

const ISSUER = "ubi-gateway";
const AUDIENCE = "ubi-internal";
const MIN_SECRET_LENGTH = 32;

export interface VerifiedIdentity {
  readonly userId: string;
  readonly role: string;
  /** The effective scopes the gateway granted THIS request. */
  readonly scopes: readonly string[];
  /** Active restriction modes (`limited`, `wallet_safe`). */
  readonly modes: readonly string[];
  /** The token's city, or null when the caller is not bound to one. */
  readonly cityId: string | null;
  readonly requestId: string;
}

function keyFrom(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): Buffer | undefined {
  const secret = env[name];
  if (secret === undefined || secret.length === 0) {
    return undefined;
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`${name} must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  return Buffer.from(secret, "utf8");
}

/**
 * The verification keys, current first. Throws (a configuration error, which
 * the caller answers as an outage — never as a reason to trust an unsigned
 * header) when the current secret is missing or too short.
 */
export function identityVerificationKeys(
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly Buffer[] {
  const current = keyFrom(env, "UBI_IDENTITY_SECRET");
  if (current === undefined) {
    throw new Error("UBI_IDENTITY_SECRET environment variable is required");
  }
  const previous = keyFrom(env, "UBI_IDENTITY_SECRET_PREVIOUS");
  return previous === undefined ? [current] : [current, previous];
}

function untrusted(): ContractError {
  return new ContractError(
    "unauthorized",
    "Internal identity context is missing or not trusted",
  );
}

function decodeSegment(segment: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw untrusted();
  }
  return Buffer.from(segment, "base64url");
}

function parseJson(segment: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(decodeSegment(segment).toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw untrusted();
    }
    return value as Record<string, unknown>;
  } catch {
    throw untrusted();
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** Verifies a context and returns its claims, or throws `unauthorized`. */
export function verifyIdentityContext(
  token: string,
  keys: readonly Buffer[],
  now: Date = new Date(),
): VerifiedIdentity {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw untrusted();
  }
  const [headerPart, payloadPart, signaturePart] = parts as [
    string,
    string,
    string,
  ];
  const header = parseJson(headerPart);
  if (header.alg !== "HS256") {
    throw untrusted();
  }
  const presented = decodeSegment(signaturePart);
  const signingInput = `${headerPart}.${payloadPart}`;
  const verified = keys.some((key) => {
    const expected = createHmac("sha256", key).update(signingInput).digest();
    return (
      expected.length === presented.length &&
      timingSafeEqual(expected, presented)
    );
  });
  if (!verified) {
    throw untrusted();
  }

  const claims = parseJson(payloadPart);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const audience = claims.aud;
  const audienceOk = Array.isArray(audience)
    ? audience.includes(AUDIENCE)
    : audience === AUDIENCE;
  if (
    claims.iss !== ISSUER ||
    !audienceOk ||
    typeof claims.exp !== "number" ||
    claims.exp <= nowSeconds ||
    (typeof claims.nbf === "number" && claims.nbf > nowSeconds)
  ) {
    throw untrusted();
  }

  const userId = stringOrNull(claims.sub);
  const role = stringOrNull(claims.role);
  const requestId = stringOrNull(claims.rid);
  if (userId === null || role === null || requestId === null) {
    throw untrusted();
  }
  return {
    userId,
    role,
    scopes: stringArray(claims.scp),
    modes: stringArray(claims.mod),
    cityId: stringOrNull(claims.city),
    requestId,
  };
}
