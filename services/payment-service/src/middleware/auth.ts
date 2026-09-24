/**
 * Service Auth Middleware
 *
 * Extracts user information from API Gateway headers.
 *
 * TRUST MODEL (see docs/security/INTERNAL_IDENTITY.md and the C03 review that
 * closed this gap — the same class as the ride-service G03 fix):
 *
 * - If the caller presents `x-ubi-identity` (the gateway-signed HS256 JWS,
 *   verified with UBI_IDENTITY_SECRET by ../identity/context.ts), it is
 *   verified and its claims win — in every environment. A JWS that fails to
 *   verify is refused outright; there is no falling back to the plain
 *   headers underneath it.
 *
 * - In PRODUCTION the JWS is required: the plain `X-User-ID` mirror is
 *   display data, not authentication, because anyone with service-network
 *   access could set it. A request with no JWS is refused (401); a request
 *   with a JWS the service cannot verify because UBI_IDENTITY_SECRET is
 *   unset or misconfigured is a 503 (an outage, never a reason to trust an
 *   unsigned header).
 *
 * - In development/test this middleware keeps its historical behavior when
 *   no JWS is presented: it trusts the plain `X-User-*` headers the gateway
 *   forwards.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { ContractError } from "@ubi/contracts";

import { IDENTITY_HEADER, verifyIdentityContext } from "../identity/context";

import type { Context, Next } from "hono";

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    userEmail?: string;
    userRole?: string;
    sessionId?: string;
  }
}

function unauthorized(c: Context): Response {
  return c.json(
    {
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required",
      },
    },
    401,
  );
}

function identityServiceUnavailable(c: Context): Response {
  return c.json(
    {
      success: false,
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Identity could not be verified. Please try again.",
      },
    },
    503,
  );
}

/**
 * Service authentication middleware
 * Extracts user info from API Gateway forwarded headers
 */
export async function serviceAuth(
  c: Context,
  next: Next,
): Promise<void | Response> {
  const signed = c.req.header(IDENTITY_HEADER);
  if (signed !== undefined && signed.length > 0) {
    // A JWS was presented: it is authoritative in every environment. It
    // either verifies and wins, or the request is refused — never a silent
    // fall-through to the plain headers below.
    try {
      const principal = await verifyIdentityContext(signed);
      c.set("userId", principal.userId);
      c.set("userRole", principal.role);
      if (principal.sessionId !== null) {
        c.set("sessionId", principal.sessionId);
      }
    } catch (error) {
      if (error instanceof ContractError) {
        return unauthorized(c);
      }
      // A misconfigured UBI_IDENTITY_SECRET is an outage, not a credential
      // problem — and never a reason to fall back to unsigned trust.
      return identityServiceUnavailable(c);
    }
    await next();
    return;
  }

  if (process.env.NODE_ENV === "production") {
    // Fail closed: only the gateway-signed context authenticates in
    // production. The bare X-User-ID mirror is refused outright.
    return unauthorized(c);
  }

  // Development / test: historical header-trusting behavior, unchanged.
  const userId = c.req.header("X-User-ID");
  const userEmail = c.req.header("X-User-Email");
  const userRole = c.req.header("X-User-Role");
  const sessionId = c.req.header("X-Session-ID");

  if (!userId) {
    return unauthorized(c);
  }

  // Set context variables
  c.set("userId", userId);
  if (userEmail) {
    c.set("userEmail", userEmail);
  }
  if (userRole) {
    c.set("userRole", userRole);
  }
  if (sessionId) {
    c.set("sessionId", sessionId);
  }

  await next();
}

/**
 * Optional auth middleware
 * Extracts user info if available, but doesn't require it
 */
export async function optionalAuth(c: Context, next: Next) {
  const userId = c.req.header("X-User-ID");
  const userEmail = c.req.header("X-User-Email");
  const userRole = c.req.header("X-User-Role");
  const sessionId = c.req.header("X-Session-ID");

  if (userId) {
    c.set("userId", userId);
    if (userEmail) {
      c.set("userEmail", userEmail);
    }
    if (userRole) {
      c.set("userRole", userRole);
    }
    if (sessionId) {
      c.set("sessionId", sessionId);
    }
  }

  await next();
}

/** The header a service-to-service caller presents the internal key in. */
export const SERVICE_KEY_HEADER = "X-Service-Key";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Whether `presented` is the internal service key — THE service-key check.
 *
 * `internalServiceAuth` refuses with it and the rate limiter
 * (./rate-limit.ts) exempts service traffic with it, so the limiter can never
 * wave through a key the routers would refuse.
 *
 * Fails CLOSED: an unset or empty INTERNAL_SERVICE_KEY matches nothing, and a
 * missing or empty header never matches. The comparison is constant-time:
 * both sides are hashed to fixed-length SHA-256 digests before
 * `timingSafeEqual`, so neither the time taken nor an early exit on a length
 * mismatch says anything about the key.
 */
export function isValidServiceKey(presented: string | undefined): boolean {
  const expected = process.env.INTERNAL_SERVICE_KEY;
  if (
    expected === undefined ||
    expected.length === 0 ||
    presented === undefined ||
    presented.length === 0
  ) {
    return false;
  }
  return timingSafeEqual(digest(presented), digest(expected));
}

/**
 * Internal service auth middleware
 * For service-to-service communication
 *
 * Fails CLOSED: when INTERNAL_SERVICE_KEY is unset or empty, every request is
 * refused. The old `serviceKey !== process.env.INTERNAL_SERVICE_KEY` guard
 * accepted a request that simply omitted the header in a mis-provisioned
 * deployment (`undefined !== undefined` is false), which silently exposed the
 * marketplace hold/capture/reverse money endpoints without any credential.
 */
export async function internalServiceAuth(
  c: Context,
  next: Next,
): Promise<void | Response> {
  if (!isValidServiceKey(c.req.header(SERVICE_KEY_HEADER))) {
    return c.json(
      {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Internal endpoint",
        },
      },
      403,
    );
  }

  await next();
}

/**
 * Admin auth middleware
 */
export async function adminAuth(
  c: Context,
  next: Next,
): Promise<void | Response> {
  const userRole = c.req.header("X-User-Role");

  if (!userRole || !["ADMIN", "SUPER_ADMIN"].includes(userRole)) {
    return c.json(
      {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Admin access required",
        },
      },
      403,
    );
  }

  await next();
}
