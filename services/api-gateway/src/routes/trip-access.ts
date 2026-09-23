/**
 * The passenger trip link — the ONLY gateway routes that forward without a
 * user identity.
 *
 * Book for another adult (A06 part B): the requester books a ride for a
 * passenger who is not a UBI user, and the passenger follows a link carrying
 * a scoped, expiring, revocable trip access token. ride-service serves the
 * link at exactly these three paths, OUTSIDE its identity middleware, and
 * authenticates each call by the token in `X-Trip-Access-Token` alone
 * (services/ride-service/internal/handler/marketplace_guest.go):
 *
 *   GET  /v1/mp/trip-access          the trip view
 *   GET  /v1/mp/trip-access/pin      the pickup PIN
 *   POST /v1/mp/trip-access/decline  the passenger declines (Idempotency-Key)
 *
 * The rest of `/v1/mp` requires a bearer token like every gateway route, so
 * these are matched EXACTLY (method and path, no prefix, no trailing slash)
 * and mounted ahead of the authenticated `/v1` group in app.ts. Anything else
 * under `/v1/mp/trip-access…` falls through to that group and needs a token.
 *
 * What crosses the wire is built from nothing, not filtered from the request:
 *
 *   x-trip-access-token  the passenger's token (bounded, URL-safe charset);
 *   idempotency-key      on the decline only — ride-service requires it;
 *   x-request-id         the gateway's own (a proposed one only if it is a
 *                        short, boring id);
 *   x-forwarded-for      the ONE client address the gateway rate-limited on,
 *                        so ride-service's own per-client limit sees the
 *                        passenger rather than the gateway.
 *
 * No Authorization, no `x-ubi-identity`, no `x-auth-*` / `x-user-*` mirror, no
 * city, no scopes and no body cross: a passenger is not a UBI user, and a
 * gateway identity would grant nothing at ride-service anyway. The global
 * strip middleware (middleware/identity.ts) has already deleted every reserved
 * identity header from the inbound request before this runs.
 *
 * Every call is rate limited per client address HERE, before anything is
 * forwarded (ride-service limits per client and per token again, before it
 * looks the token up). Answers are never cached: `Cache-Control: no-store`
 * and `Referrer-Policy: no-referrer` go back to the client whatever
 * ride-service says.
 */
import { Hono, type Context } from "hono";
import Redis from "ioredis";
import {
  RateLimiterMemory,
  RateLimiterRedis,
  type RateLimiterAbstract,
} from "rate-limiter-flexible";

import { downstreamPath, serviceBaseUrl, type ProxyRule } from "./proxy-map";
import { proxyLogger, rateLimitLogger } from "../lib/logger.js";
import { REQUEST_ID_HEADER, safeRequestId } from "../middleware/identity";

/** The header ride-service authenticates a trip-link call by. */
export const TRIP_ACCESS_TOKEN_HEADER = "x-trip-access-token";

/** The three public trip-link routes, exactly as ride-service serves them. */
export const TRIP_ACCESS_ROUTES: readonly {
  readonly method: "GET" | "POST";
  readonly path: string;
}[] = [
  { method: "GET", path: "/v1/mp/trip-access" },
  { method: "GET", path: "/v1/mp/trip-access/pin" },
  { method: "POST", path: "/v1/mp/trip-access/decline" },
];

/** The rule the trip link forwards under: ride-service, which mounts /v1. */
const TRIP_ACCESS_RULE: ProxyRule = {
  pattern: "/mp/trip-access",
  service: "ride-service",
};

/** Per client address, per window — below ride-service's own 60/min. */
export const TRIP_ACCESS_RATE_LIMIT = { points: 30, duration: 60 } as const;

/** "uta_" + base64url today; anything else is not worth a hop. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const REQUEST_TIMEOUT = Number.parseInt(
  process.env.PROXY_TIMEOUT || "30000",
  10,
);

let limiter: RateLimiterAbstract | undefined;

function tripAccessLimiter(): RateLimiterAbstract {
  if (limiter !== undefined) {
    return limiter;
  }
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl !== undefined && redisUrl.length > 0) {
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    client.on("error", (err) => {
      rateLimitLogger.error({ err }, "Trip-link rate limiter Redis error");
    });
    limiter = new RateLimiterRedis({
      storeClient: client,
      keyPrefix: "ubi:ratelimit:trip-access",
      points: TRIP_ACCESS_RATE_LIMIT.points,
      duration: TRIP_ACCESS_RATE_LIMIT.duration,
      blockDuration: TRIP_ACCESS_RATE_LIMIT.duration,
      // A Redis outage must not open the link to unlimited guessing: fall
      // back to a per-process limit of the same size.
      insuranceLimiter: new RateLimiterMemory({
        points: TRIP_ACCESS_RATE_LIMIT.points,
        duration: TRIP_ACCESS_RATE_LIMIT.duration,
      }),
    });
  } else {
    limiter = new RateLimiterMemory({
      points: TRIP_ACCESS_RATE_LIMIT.points,
      duration: TRIP_ACCESS_RATE_LIMIT.duration,
    });
  }
  return limiter;
}

/** Test seam: forget the limiter so a test starts with a fresh budget. */
export function resetTripAccessLimiter(): void {
  limiter = undefined;
}

/** The one client address this request is limited (and forwarded) as. */
function clientAddress(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded !== undefined && forwarded.length > 0) {
    return forwarded;
  }
  const real = c.req.header("x-real-ip")?.trim();
  return real !== undefined && real.length > 0 ? real : "unknown";
}

function noStore(c: Context): void {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
}

async function forwardTripAccess(
  c: Context,
  method: "GET" | "POST",
): Promise<Response> {
  noStore(c);
  const client = clientAddress(c);

  try {
    const result = await tripAccessLimiter().consume(client, 1);
    c.header("X-RateLimit-Limit", String(TRIP_ACCESS_RATE_LIMIT.points));
    c.header("X-RateLimit-Remaining", String(result.remainingPoints));
  } catch (rejection) {
    const retryAfter = Math.max(
      1,
      Math.ceil(
        ((rejection as { msBeforeNext?: number }).msBeforeNext ?? 60_000) /
          1000,
      ),
    );
    c.header("X-RateLimit-Limit", String(TRIP_ACCESS_RATE_LIMIT.points));
    c.header("X-RateLimit-Remaining", "0");
    c.header("Retry-After", String(retryAfter));
    return c.json(
      {
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests for this trip link. Try again shortly.",
          retryAfter,
        },
      },
      429,
    );
  }

  const token = c.req.header(TRIP_ACCESS_TOKEN_HEADER)?.trim() ?? "";
  if (!TOKEN_PATTERN.test(token)) {
    return c.json(
      {
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "This trip link is not valid.",
        },
      },
      401,
    );
  }

  const requestId = safeRequestId(c.req.header(REQUEST_ID_HEADER));
  const headers = new Headers();
  headers.set(TRIP_ACCESS_TOKEN_HEADER, token);
  headers.set(REQUEST_ID_HEADER, requestId);
  headers.set("x-forwarded-for", client);
  headers.set("accept", "application/json");
  if (method === "POST") {
    const idempotencyKey = c.req.header("idempotency-key");
    if (idempotencyKey !== undefined && idempotencyKey.length > 0) {
      headers.set("idempotency-key", idempotencyKey);
    }
  }

  const target = `${serviceBaseUrl(TRIP_ACCESS_RULE.service)}${downstreamPath(TRIP_ACCESS_RULE, c.req.path)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT);
  try {
    const response = await fetch(target, {
      method,
      headers,
      signal: controller.signal,
    });
    c.header(REQUEST_ID_HEADER, requestId);
    const contentType = response.headers.get("content-type");
    if (contentType !== null) {
      c.header("content-type", contentType);
    }
    // ride-service already answers no-store; restate it so a downstream
    // header change can never make a trip link cacheable.
    noStore(c);
    const body = await response.text();
    if (body.length === 0) {
      return c.body(null, response.status as 204);
    }
    return c.body(body, response.status as 200);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return c.json(
        {
          success: false,
          error: {
            code: "GATEWAY_TIMEOUT",
            message: "The request took too long to process",
          },
        },
        504,
      );
    }
    proxyLogger.error(
      { err: error, serviceName: TRIP_ACCESS_RULE.service },
      "Trip-link proxy error",
    );
    return c.json(
      {
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: `Unable to reach ${TRIP_ACCESS_RULE.service}`,
        },
      },
      503,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The public trip-link router. app.ts mounts it at the root, ahead of the
 * authenticated `/v1` group, so these three method + path pairs never reach
 * the auth, identity or scope middleware.
 */
export const tripAccessRoutes = new Hono();

for (const route of TRIP_ACCESS_ROUTES) {
  const handler = async (c: Context): Promise<Response> => {
    const response = await forwardTripAccess(c, route.method);
    return response;
  };
  if (route.method === "GET") {
    tripAccessRoutes.get(route.path, handler);
  } else {
    tripAccessRoutes.post(route.path, handler);
  }
}
