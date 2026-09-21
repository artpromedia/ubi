/**
 * Service Authentication Middleware
 *
 * Validates requests from API Gateway with user context headers.
 *
 * TRUST MODEL (see docs/security/INTERNAL_IDENTITY.md):
 *
 * - In development this middleware keeps its historical behavior: it trusts
 *   the plain `x-auth-*` mirrors the gateway forwards, plus the
 *   `x-internal-service` escape hatch.
 *
 * - In PRODUCTION the mirrors are display data, not authentication. The
 *   caller must present the gateway-signed `x-ubi-identity` context (HS256
 *   JWS, verified with UBI_IDENTITY_SECRET by ../identity/context.ts), and
 *   the request's identity comes from the VERIFIED claims — never from a
 *   header anyone on the pod network could set. The unauthenticated
 *   `x-internal-service: true` bypass is refused outright: the gateway strips
 *   that header from client traffic and no service in this repository sends
 *   it, so in production it can only be an attacker.
 */
import { createMiddleware } from "hono/factory";

import { ContractError } from "@ubi/contracts";

import { IDENTITY_HEADER, verifyIdentityContext } from "../identity/context";

import type { Context, Next } from "hono";

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

export const serviceAuthMiddleware = createMiddleware(
  async (c: Context, next: Next) => {
    // Public endpoints don't require auth
    const path = c.req.path;
    const publicPaths = ["/health", "/docs"];
    if (publicPaths.some((p) => path.startsWith(p))) {
      await next();
      return;
    }

    if (process.env.NODE_ENV === "production") {
      // Fail closed: only the gateway-signed context authenticates.
      const signed = c.req.header(IDENTITY_HEADER);
      if (signed === undefined || signed.length === 0) {
        return unauthorized(c);
      }
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
      await next();
      return;
    }

    // Development / test: historical header-trusting behavior.
    const userId = c.req.header("x-auth-user-id");
    const userRole = c.req.header("x-auth-user-role");

    // Allow internal service calls (no auth headers = trusted internal call)
    const isInternalCall = c.req.header("x-internal-service") === "true";

    // For external requests, require auth context from gateway
    if (!isInternalCall && !userId) {
      return unauthorized(c);
    }

    // Add auth context to request for downstream handlers
    c.set("userId", userId);
    c.set("userRole", userRole);

    await next();
    return;
  },
);
