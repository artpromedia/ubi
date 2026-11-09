/**
 * Verifies the API gateway's signed identity context (`x-ubi-identity`).
 *
 * Every admin route on config-service (`PUT /v1/flags/:key`,
 * `POST /v1/config/cities/status`, `GET /v1/config/cities/:cityId/history`,
 * `GET|POST /v1/config/change-requests`, and `POST .../:id/{approve,reject}`)
 * authenticates its caller from this compact HS256 JWS when presented, and
 * requires it unconditionally in production (never falling back to plain
 * `x-user-id` / `x-user-role` mirrors).
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
  readonly scopes: readonly string[];
  readonly modes: readonly string[];
  readonly cityId: string | null;
  readonly requestId: string;
}

function isProductionEnv(nodeEnv: string | undefined): boolean {
  return (nodeEnv ?? "").trim().toLowerCase() === "production";
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

/**
 * Boot-time check. In production a missing or short `UBI_IDENTITY_SECRET`
 * throws so config-service refuses to boot without verifiable gateway identity.
 */
export function assertIdentityConfigured(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  try {
    identityVerificationKeys(env);
    return true;
  } catch (error) {
    if (isProductionEnv(env["NODE_ENV"])) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}: in production config-service requires UBI_IDENTITY_SECRET and never trusts unsigned identity headers`,
      );
    }
    return false;
  }
}

function untrusted(): ContractError {
  return new ContractError(
    "unauthorized",
    "internal identity context is missing or not trusted",
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
  if (header["alg"] !== "HS256") {
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
  const audience = claims["aud"];
  const audienceOk = Array.isArray(audience)
    ? audience.includes(AUDIENCE)
    : audience === AUDIENCE;
  if (
    claims["iss"] !== ISSUER ||
    !audienceOk ||
    typeof claims["exp"] !== "number" ||
    claims["exp"] <= nowSeconds ||
    (typeof claims["nbf"] === "number" && claims["nbf"] > nowSeconds)
  ) {
    throw untrusted();
  }

  const userId = stringOrNull(claims["sub"]);
  const role = stringOrNull(claims["role"]);
  const requestId = stringOrNull(claims["rid"]);
  if (userId === null || role === null || requestId === null) {
    throw untrusted();
  }
  return {
    userId,
    role: role.toLowerCase(),
    scopes: stringArray(claims["scp"]),
    modes: stringArray(claims["mod"]),
    cityId: stringOrNull(claims["city"]),
    requestId,
  };
}
