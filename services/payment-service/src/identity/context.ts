/**
 * Verifying the gateway's signed identity context.
 *
 * `serviceAuth` (../middleware/auth.ts) does NOT trust `X-User-ID` alone in
 * production. That header, like every other `x-auth-*`/`x-user-*` mirror, is
 * a convenience copy the gateway also emits; anyone who can reach this
 * service on the pod network could set it directly (see the C03 review and
 * docs/security/INTERNAL_IDENTITY.md — the same class of gap the ride-service
 * G03 fix and user-service's `src/identity/context.ts` closed). Production
 * traffic must instead present `x-ubi-identity`, the compact HS256 JWS the
 * API gateway mints after validating the caller's token
 * (services/api-gateway/src/middleware/identity.ts holds the canonical header
 * contract and the claim names). Verification uses the internal secret
 * `UBI_IDENTITY_SECRET` — the SAME env var and claim shape user-service
 * verifies with — which is never a key a client can hold.
 *
 * There is no fallback: a missing context, a bad signature, the wrong issuer
 * or an expired context are all refused. A misconfigured or absent
 * verification secret is an outage (503), never a reason to trust an
 * unsigned header.
 */
import * as jose from "jose";

import { ContractError } from "@ubi/contracts";

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
  if (secret === undefined || secret.length === 0) {
    return undefined;
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`${name} must be at least ${MIN_SECRET_LENGTH} characters`);
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
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export async function verifyIdentityContext(
  token: string,
): Promise<IdentityPrincipal> {
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
      if (userId === null || role === null || requestId === null) {
        break;
      }

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
  throw new ContractError(
    "unauthorized",
    "Internal identity context is missing or not trusted",
  );
}
