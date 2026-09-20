/**
 * Service-to-service authentication for gateway HTTP endpoints.
 *
 * POST /broadcast/user/:userId can push money-relevant messages (marketplace
 * bids, awards, commission holds) straight to a client, so it must not be
 * forgeable. Callers authenticate with either:
 *
 *   - `Authorization: Bearer svc_{serviceId}_{hmac}` where hmac is
 *     HMAC-SHA256(SERVICE_SECRET, "svc_" + serviceId) hex[0:32] — the same
 *     service-token format verified for WebSocket connections in auth.ts, or
 *   - `X-Service-Key: <key>` matching INTERNAL_SERVICE_KEY (or
 *     SERVICE_SECRET), mirroring notification-service's serviceAuth.
 *
 * When neither SERVICE_SECRET nor INTERNAL_SERVICE_KEY is configured (local
 * dev), requests pass but a warning is logged so the gap is visible.
 * Secrets are read at call time so tests and runtime reconfiguration behave
 * predictably.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { logger as rootLogger } from "./logger.js";

const logger = rootLogger.child({ component: "service-auth" });

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Verify an svc_{serviceId}_{hmac} token against the service secret. */
export function verifyServiceHmacToken(
  token: string,
  serviceSecret: string,
): boolean {
  const parts = token.split("_");
  if (parts.length !== 3 || parts[0] !== "svc") return false;

  const [, serviceId, providedHmac] = parts;
  if (!serviceId || !providedHmac) return false;

  const expectedHmac = createHmac("sha256", serviceSecret)
    .update(`svc_${serviceId}`)
    .digest("hex")
    .substring(0, 32);

  return safeEqual(providedHmac, expectedHmac);
}

export interface ServiceAuthResult {
  ok: boolean;
  /** True when no secret is configured and the request passed unauthenticated. */
  unauthenticatedDev?: boolean;
}

/**
 * Check a request's service credentials against the configured secrets.
 * Pure header logic, exported for tests; requireServiceAuth adapts it to Hono.
 */
export function checkServiceAuth(headers: {
  authorization?: string;
  serviceKey?: string;
}): ServiceAuthResult {
  const serviceSecret = process.env.SERVICE_SECRET;
  const internalKey = process.env.INTERNAL_SERVICE_KEY;

  if (!serviceSecret && !internalKey) {
    return { ok: true, unauthenticatedDev: true };
  }

  const bearer = headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  if (
    serviceSecret &&
    bearer.startsWith("svc_") &&
    verifyServiceHmacToken(bearer, serviceSecret)
  ) {
    return { ok: true };
  }

  const serviceKey = headers.serviceKey;
  if (serviceKey) {
    if (internalKey && safeEqual(serviceKey, internalKey)) return { ok: true };
    if (serviceSecret && safeEqual(serviceKey, serviceSecret)) {
      return { ok: true };
    }
  }

  return { ok: false };
}

/**
 * Hono middleware gating service-only endpoints (e.g. POST /broadcast/user).
 */
export async function requireServiceAuth(c: Context, next: Next) {
  const result = checkServiceAuth({
    authorization: c.req.header("authorization"),
    serviceKey: c.req.header("x-service-key"),
  });

  if (result.unauthenticatedDev) {
    logger.warn(
      { path: c.req.path },
      "Service endpoint called with no SERVICE_SECRET/INTERNAL_SERVICE_KEY configured — allowing unauthenticated request (dev only; set a secret in production)",
    );
    return next();
  }

  if (!result.ok) {
    logger.warn(
      { path: c.req.path },
      "Rejected unauthenticated service request",
    );
    return c.json(
      {
        error: {
          code: "unauthorized",
          message: "Valid service credentials required",
        },
      },
      401,
    );
  }

  return next();
}
