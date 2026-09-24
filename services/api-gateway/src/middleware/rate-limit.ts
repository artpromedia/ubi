/**
 * Rate Limiting Middleware
 *
 * Redis-backed rate limiting to protect the services behind the gateway from
 * abuse, with a budget per caller type (RATE_LIMITS) and more room for the
 * polling endpoints (ENDPOINT_OVERRIDES).
 *
 * WHO A REQUEST IS COUNTED AS (round 8, P0). This middleware used to run
 * BEFORE authMiddleware, so it never saw a verified caller: it keyed every
 * request on the leftmost X-Forwarded-For entry — which the client writes —
 * or on one shared "ip:unknown" bucket. Any client could mint a fresh bucket
 * per request, or spend someone else's. It also enforced one 100-point
 * limiter for everyone while advertising the per-type table in its headers,
 * and a Redis outage turned every request into a 429.
 *
 * app.ts now mounts it AFTER authMiddleware, and a request is counted as:
 *
 *  1. The verified caller — `c.get("auth")`, set only by authMiddleware from a
 *     token it verified (a user's JWT, or a registered service API key) — in
 *     that caller's type budget. Headers play no part.
 *  2. Otherwise (a public route, where authMiddleware verifies nothing) the
 *     client address, resolved by middleware/client-address.ts: the socket
 *     peer, or — only when the peer is a trusted proxy (GATEWAY_TRUSTED_PROXIES)
 *     — the right-most X-Forwarded-For hop that is not one. Always in the
 *     anonymous budget.
 *
 * A request authMiddleware refuses never reaches this middleware: it has cost
 * one signature check and is answered 401 without touching a downstream
 * service, so there is nothing left for a limit to protect.
 *
 * IN-PROCESS DISPATCH is not counted. `app.fetch(request)` with no
 * environment is code in this process, not a remote party (the route and
 * scope suites drive the app that way); every server adapter passes an
 * environment, so no request that arrived over the network is ever
 * classified in-process — see middleware/client-address.ts. The limiter's
 * network path is exercised over real TCP in tests/rate-limit.test.ts.
 *
 * NO DETERMINABLE ADDRESS. There is no shared "unknown" bucket. An
 * authenticated request needs no address: it is always counted as its
 * caller. An unauthenticated request on a connection whose peer cannot be
 * read — a socket already torn down, whose sender cannot read any reply — is
 * refused, 400 CLIENT_ADDRESS_UNAVAILABLE: letting it through uncounted would
 * forward a public call (an OTP send, a login) that no budget ever saw.
 *
 * REDIS UNAVAILABLE. The limiter fails OPEN, the house convention
 * (payment-service's limiter, ride-service's `AllowRate`): when Redis is not
 * connected, or the check errors or outlasts REDIS_CHECK_BUDGET_MS, the
 * request goes on uncounted and without X-RateLimit-* headers.
 * Authentication never fails open — it already ran, and the identity and
 * scope middleware after this one run exactly as they would otherwise. With
 * no REDIS_URL at all (development) the budgets are kept in process memory.
 */

import { createMiddleware } from "hono/factory";
import Redis from "ioredis";
import {
  RateLimiterMemory,
  RateLimiterRedis,
  RateLimiterRes,
  type RateLimiterAbstract,
} from "rate-limiter-flexible";

import { clientAddressOf, clientBucketOf } from "./client-address";
import { rateLimitLogger } from "../lib/logger.js";

import type { AuthContext } from "./auth";
import type { Context, Next } from "hono";

interface Budget {
  /** Names the bucket family; one limiter (and Redis key prefix) per name. */
  readonly name: string;
  readonly points: number;
  readonly duration: number;
}

// Rate limit configurations per caller type. `anonymous` is 100, not the 30
// this table once listed and never enforced: its buckets are per client
// ADDRESS, which everyone behind one carrier NAT shares, and no caller is
// limited more tightly than the single 100-point limiter this replaced.
const RATE_LIMITS: Readonly<
  Record<string, { points: number; duration: number }>
> = {
  anonymous: { points: 100, duration: 60 },
  rider: { points: 100, duration: 60 },
  driver: { points: 150, duration: 60 },
  restaurant: { points: 200, duration: 60 },
  merchant: { points: 200, duration: 60 },
  admin: { points: 500, duration: 60 },
  service: { points: 10000, duration: 60 },
};

// Higher limits for specific endpoints, each in a bucket of its own so a
// polling screen does not spend the caller's general budget.
const ENDPOINT_OVERRIDES: Record<string, { points: number; duration: number }> =
  {
    "/v1/rides/track": { points: 300, duration: 60 }, // Frequent polling for ride tracking
    "/v1/locations/autocomplete": { points: 200, duration: 60 }, // Autocomplete needs more calls
    "/v1/notifications": { points: 200, duration: 60 }, // Real-time notifications
  };

/**
 * The longest the limiter waits on Redis before failing open. A healthy
 * in-cluster round trip is about a millisecond; this bounds what a hung or
 * blackholed Redis can add to every request.
 */
const REDIS_CHECK_BUDGET_MS = 250;

/** At most one fail-open warning per interval: an outage is a line, not a flood. */
const FAIL_OPEN_LOG_INTERVAL_MS = 10_000;

/** Who a request is counted as. `key` never collides across kinds. */
export type RateLimitSubject =
  | { readonly kind: "caller"; readonly key: string; readonly type: string }
  | { readonly kind: "client"; readonly key: string }
  | { readonly kind: "in-process" }
  | { readonly kind: "unattributable" };

/**
 * Who this request is counted as. Reads only what authMiddleware verified and
 * the socket — never a header a client can write, unless a trusted proxy
 * forwarded it.
 */
export function rateLimitSubject(c: Context): RateLimitSubject {
  const address = clientAddressOf(c);
  if (address.connection === "in-process") {
    return { kind: "in-process" };
  }
  const auth = c.get("auth") as AuthContext | undefined;
  if (auth !== undefined) {
    return { kind: "caller", key: `user:${auth.userId}`, type: auth.role };
  }
  if (address.client !== undefined) {
    return { kind: "client", key: clientBucketOf(address.client) };
  }
  return { kind: "unattributable" };
}

/** The budget for a caller type on a path. An unknown type is anonymous. */
function budgetFor(type: string, path: string): Budget {
  const typeName = Object.hasOwn(RATE_LIMITS, type) ? type : "anonymous";
  const base = RATE_LIMITS[typeName] ?? { points: 100, duration: 60 };
  for (const [endpoint, override] of Object.entries(ENDPOINT_OVERRIDES)) {
    if (path.startsWith(endpoint)) {
      return {
        name: `${typeName}:${endpoint}`,
        points: Math.max(base.points, override.points),
        duration: override.duration,
      };
    }
  }
  return { name: typeName, points: base.points, duration: base.duration };
}

// ===========================================
// Store
// ===========================================

interface Store {
  readonly redis: Redis | undefined;
  readonly limiters: Map<string, RateLimiterAbstract>;
}

let store: Store | undefined;

function currentStore(): Store {
  if (store !== undefined) {
    return store;
  }
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl === undefined || redisUrl.length === 0) {
    rateLimitLogger.warn("REDIS_URL not set, using memory-based rate limiter");
    store = { redis: undefined, limiters: new Map() };
    return store;
  }
  const redis = new Redis(redisUrl, {
    // Fail fast, never queue behind an outage: the limiter fails open.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  redis.on("error", (err) => {
    noteFailOpen("redis connection error", err);
  });
  rateLimitLogger.info("Rate limiter initialized with Redis backend");
  store = { redis, limiters: new Map() };
  return store;
}

function limiterFor(budget: Budget): {
  limiter: RateLimiterAbstract;
  redis: Redis | undefined;
} {
  const { redis, limiters } = currentStore();
  let limiter = limiters.get(budget.name);
  if (limiter === undefined) {
    limiter =
      redis === undefined
        ? new RateLimiterMemory({
            keyPrefix: `ubi:ratelimit:${budget.name}`,
            points: budget.points,
            duration: budget.duration,
            blockDuration: budget.duration,
          })
        : new RateLimiterRedis({
            storeClient: redis,
            keyPrefix: `ubi:ratelimit:${budget.name}`,
            points: budget.points,
            duration: budget.duration,
            blockDuration: budget.duration, // Block for the window once exceeded
            rejectIfRedisNotReady: true,
          });
    limiters.set(budget.name, limiter);
  }
  return { limiter, redis };
}

/**
 * Test seam: disconnect and forget the store, so the next request builds one
 * from the current REDIS_URL with every budget fresh.
 */
export function resetRateLimiter(): void {
  store?.redis?.disconnect();
  store = undefined;
}

// ===========================================
// Redis, within a budget
// ===========================================

let lastFailOpenLogAt = 0;

function noteFailOpen(reason: string, error?: unknown): void {
  const now = Date.now();
  if (now - lastFailOpenLogAt < FAIL_OPEN_LOG_INTERVAL_MS) {
    return;
  }
  lastFailOpenLogAt = now;
  rateLimitLogger.warn(
    { reason, err: error },
    "rate limiter unavailable; failing open (authentication is still enforced)",
  );
}

type Verdict =
  | { readonly allowed: true; readonly result: RateLimiterRes }
  | { readonly allowed: false; readonly result: RateLimiterRes }
  | undefined;

/** One point from `key`'s bucket, or undefined when the store cannot answer. */
async function consumeWithinBudget(
  budget: Budget,
  key: string,
): Promise<Verdict> {
  const { limiter, redis } = limiterFor(budget);
  if (redis !== undefined && redis.status !== "ready") {
    // Down or reconnecting: do not wait behind the outage.
    noteFailOpen(`redis is ${redis.status}`);
    return undefined;
  }
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), REDIS_CHECK_BUDGET_MS);
  });
  const consumed = limiter.consume(key, 1).then(
    (result): Verdict => ({ allowed: true, result }),
    (rejection: unknown): Verdict => {
      // rate-limiter-flexible rejects with a RateLimiterRes when the budget
      // is spent, and with an Error when the store failed.
      if (rejection instanceof RateLimiterRes) {
        return { allowed: false, result: rejection };
      }
      noteFailOpen("rate limit check failed", rejection);
      return undefined;
    },
  );
  try {
    const verdict = await Promise.race([consumed, timeout]);
    if (verdict === undefined && redis !== undefined) {
      noteFailOpen(`no answer within ${REDIS_CHECK_BUDGET_MS}ms`);
    }
    return verdict;
  } finally {
    clearTimeout(timer);
  }
}

// ===========================================
// Middleware
// ===========================================

export const rateLimitMiddleware = createMiddleware(
  async (c: Context, next: Next) => {
    const subject = rateLimitSubject(c);
    if (subject.kind === "in-process") {
      return next();
    }
    if (subject.kind === "unattributable") {
      return c.json(
        {
          success: false,
          error: {
            code: "CLIENT_ADDRESS_UNAVAILABLE",
            message: "The client address of this connection is unavailable.",
          },
        },
        400,
      );
    }

    const budget = budgetFor(
      subject.kind === "caller" ? subject.type : "anonymous",
      c.req.path,
    );
    const verdict = await consumeWithinBudget(budget, subject.key);
    if (verdict === undefined) {
      // Fail open; authentication already ran and scope enforcement follows.
      return next();
    }

    const resetIn = Math.max(1, Math.ceil(verdict.result.msBeforeNext / 1000));
    c.header("X-RateLimit-Limit", String(budget.points));
    c.header("X-RateLimit-Remaining", String(verdict.result.remainingPoints));
    c.header("X-RateLimit-Reset", String(resetIn));

    if (!verdict.allowed) {
      c.header("X-RateLimit-Remaining", "0");
      c.header("Retry-After", String(resetIn));
      return c.json(
        {
          success: false,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests. Please try again later.",
            retryAfter: resetIn,
          },
        },
        429,
      );
    }

    return next();
  },
);

// Cleanup on process exit
process.on("SIGTERM", () => {
  store?.redis?.disconnect();
});
