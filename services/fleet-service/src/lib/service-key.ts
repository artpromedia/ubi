/**
 * Service-to-service authentication for the internal routes.
 *
 * Every internal route takes `X-Service-Key`. fleet-service ACCEPTS
 *   - FLEET_SERVICE_KEY          from ride-service (contract A routes 8, 9);
 *   - FLEET_PAYMENT_SERVICE_KEY  from payment-service (contract B);
 * and PRESENTS FLEET_RIDE_SERVICE_KEY to ride-service (contract A 1-7).
 * Each is at least 32 characters, compared as fixed-length digests in
 * constant time, and a missing or short key CLOSES the route (503) — it never
 * opens it. The gateway proxies none of /internal/fleet.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import { logger } from "./logger";

import type { Context, MiddlewareHandler } from "hono";

export const SERVICE_KEY_HEADER = "X-Service-Key";
export const MIN_SERVICE_KEY_LENGTH = 32;

export const FLEET_SERVICE_KEY_ENV = "FLEET_SERVICE_KEY";
export const FLEET_PAYMENT_SERVICE_KEY_ENV = "FLEET_PAYMENT_SERVICE_KEY";
export const FLEET_RIDE_SERVICE_KEY_ENV = "FLEET_RIDE_SERVICE_KEY";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time equality of a presented key with the configured one. */
export function serviceKeyMatches(
  presented: string | undefined,
  configured: string,
): boolean {
  if (presented === undefined || presented.length === 0) {
    return false;
  }
  return timingSafeEqual(digest(presented), digest(configured));
}

/** The configured key, or undefined when it is missing or too short. */
export function usableKey(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const value = env[name];
  return value !== undefined && value.length >= MIN_SERVICE_KEY_LENGTH
    ? value
    : undefined;
}

/** Middleware: the request must present the key named by `envName`. */
export function requireServiceKey(envName: string): MiddlewareHandler {
  return async (c: Context, next) => {
    const configured = usableKey(process.env, envName);
    if (configured === undefined) {
      logger.error(
        `${envName} is not set (or shorter than ${MIN_SERVICE_KEY_LENGTH} characters): the internal route is closed`,
      );
      return c.json(
        {
          code: "service_unavailable",
          message: "this internal route is not configured",
        },
        503,
      );
    }
    if (!serviceKeyMatches(c.req.header(SERVICE_KEY_HEADER), configured)) {
      return c.json(
        { code: "unauthorized", message: "service authentication required" },
        401,
      );
    }
    await next();
    return undefined;
  };
}
