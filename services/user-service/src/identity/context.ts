/**
 * Verifying the gateway's signed identity context.
 *
 * The identity endpoints in this service do NOT trust `x-auth-user-id`. That
 * header is a convenience mirror; anyone who can reach this service on the
 * pod network could set it. They verify `x-ubi-identity`, the compact HS256
 * JWS the API gateway mints after validating the caller's token
 * (services/api-gateway/src/middleware/identity.ts holds the canonical header
 * contract and the claim names). Verification uses the internal secret
 * UBI_IDENTITY_SECRET, which is never a key a client can hold.
 *
 * There is no fallback. Missing context, bad signature, wrong issuer or an
 * expired context are all `unauthorized` — the service fails closed.
 */
import { ContractError } from "@ubi/contracts";
import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import * as jose from "jose";

export const IDENTITY_HEADER = "x-ubi-identity";

const ISSUER = "ubi-gateway";
const AUDIENCE = "ubi-internal";
const MIN_SECRET_LENGTH = 32;

export interface IdentityPrincipal {
  readonly userId: string;
  readonly role: string;
  readonly scopes: readonly string[];
  readonly modes: readonly string[];
  readonly cityId: string | null;
  readonly tenantId: string | null;
  readonly sessionId: string | null;
  readonly deviceId: string | null;
  readonly requestId: string;
}

function keyFrom(name: string): Uint8Array | undefined {
  const secret = process.env[name];
  if (secret === undefined || secret.length === 0) return undefined;
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`${name} must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (secret === process.env.JWT_SECRET) {
    throw new Error(
      `${name} must not equal JWT_SECRET — the internal context key may never be a key clients can hold`,
    );
  }
  return new TextEncoder().encode(secret);
}

function verificationKeys(): readonly Uint8Array[] {
  const current = keyFrom("UBI_IDENTITY_SECRET");
  if (current === undefined) {
    throw new Error("UBI_IDENTITY_SECRET environment variable is required");
  }
  const previous = keyFrom("UBI_IDENTITY_SECRET_PREVIOUS");
  return previous === undefined ? [current] : [current, previous];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function verifyIdentityContext(token: string): Promise<IdentityPrincipal> {
  for (const key of verificationKeys()) {
    try {
      const { payload } = await jose.jwtVerify(token, key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ["HS256"],
      });

      const userId = stringOrNull(payload.sub);
      const role = stringOrNull(payload.role);
      const requestId = stringOrNull(payload.rid);
      if (userId === null || role === null || requestId === null) break;

      return {
        userId,
        role,
        scopes: stringArray(payload.scp),
        modes: stringArray(payload.mod),
        cityId: stringOrNull(payload.city),
        tenantId: stringOrNull(payload.tenant),
        sessionId: stringOrNull(payload.sid),
        deviceId: stringOrNull(payload.dev),
        requestId,
      };
    } catch {
      // Try the previous key: a rotation may be in progress.
    }
  }
  throw new ContractError("unauthorized", "Internal identity context is missing or not trusted");
}

const IDENTITY_KEY = "identity";

/**
 * Requires a verified gateway identity. Everything downstream reads this.
 *
 * Answers with the canonical error body itself rather than throwing, because a
 * middleware runs outside the per-route `contractRoute` wrapper and an escaped
 * throw would surface as a 500 instead of a 401.
 */
export const requireIdentity = createMiddleware(async (c: Context, next: Next) => {
  const header = c.req.header(IDENTITY_HEADER);
  if (header === undefined || header.length === 0) {
    const error = new ContractError("unauthorized", "Authentication required");
    return c.json({ success: false, error: error.toBody() }, 401);
  }
  try {
    c.set(IDENTITY_KEY, await verifyIdentityContext(header));
  } catch (error) {
    if (error instanceof ContractError) {
      return c.json({ success: false, error: error.toBody() }, error.status as 401);
    }
    // A misconfigured secret is an outage, not a bad credential.
    return c.json(
      {
        success: false,
        error: {
          code: "service_unavailable",
          message: "Identity could not be verified. Please try again.",
        },
      },
      503,
    );
  }
  return next();
});

export function getIdentity(c: Context): IdentityPrincipal {
  const principal = c.get(IDENTITY_KEY) as IdentityPrincipal | undefined;
  if (principal === undefined) {
    throw new ContractError("unauthorized", "Authentication required");
  }
  return principal;
}

/**
 * Second line of defence behind the gateway matrix. The gateway decides first;
 * this service checks again, so a request that reached it another way is still
 * refused.
 */
export function requireScope(principal: IdentityPrincipal, scope: string): void {
  if (principal.scopes.includes(scope)) return;
  if (principal.modes.includes("wallet_safe")) {
    throw new ContractError(
      "safe_mode_active",
      "Your wallet is in safe mode. This action is paused until the hold lifts.",
      { required: scope },
    );
  }
  if (principal.modes.includes("limited")) {
    throw new ContractError(
      "limited_mode",
      "This device is not verified yet. Finish the security check to continue.",
      { required: scope },
    );
  }
  throw new ContractError("forbidden", "You don't have permission to perform this action", {
    required: scope,
  });
}
