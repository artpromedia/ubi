/**
 * Verifying the API gateway's signed identity context (`x-ubi-identity`).
 *
 * Every authenticated food-service route reads its caller from this signed
 * context (`bites/middleware.ts`, `middleware/auth.ts`, and `routes/{menus,restaurants}.ts`):
 * plain `X-User-ID` and `X-User-Role` headers are never trusted alone (CC-A12).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { ContractError } from "@ubi/contracts";

import { isProductionEnvironment } from "./env.js";

import type { Context } from "hono";

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

export function assertIdentityConfigured(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  try {
    identityVerificationKeys(env);
    return true;
  } catch (error) {
    if (isProductionEnvironment(env.NODE_ENV)) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}: in production food-service authenticates routes with the gateway-signed identity context and never falls back to plain headers`,
      );
    }
    return false;
  }
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

/**
 * Resolves the caller's userId from the verified `x-ubi-identity` header (or
 * pre-set Hono `userId` variable), refusing plain `X-User-ID` spoofing.
 */
export function verifiedCallerUserId(c: Context): string | undefined {
  const fromContext = c.get("userId");
  if (typeof fromContext === "string" && fromContext.length > 0) {
    return fromContext;
  }
  const rawContext = c.req.header(IDENTITY_HEADER)?.trim();
  if (rawContext !== undefined && rawContext.length > 0) {
    try {
      const verified = verifyIdentityContext(
        rawContext,
        identityVerificationKeys(),
      );
      return verified.userId;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export interface SignIdentityInput {
  readonly userId: string;
  readonly role: string;
  readonly cityId?: string | null;
  readonly scopes?: readonly string[];
  readonly modes?: readonly string[];
  readonly requestId?: string;
  readonly secret: string;
  readonly now?: Date;
  readonly ttlSeconds?: number;
}

export function signIdentityContext(input: SignIdentityInput): string {
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "ubi-id+jwt" }),
    "utf8",
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: input.userId,
      role: input.role,
      scp: input.scopes ?? [],
      mod: input.modes ?? [],
      city: input.cityId ?? null,
      rid: input.requestId ?? "req_test",
      iat: nowSeconds,
      nbf: nowSeconds,
      exp: nowSeconds + (input.ttlSeconds ?? 60),
    }),
    "utf8",
  ).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const sig = createHmac("sha256", Buffer.from(input.secret, "utf8"))
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${sig}`;
}
