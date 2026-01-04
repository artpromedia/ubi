/**
 * Rate Limiting Middleware
 */

import { Context, Next } from "hono";
import { RateLimiter } from "../lib/redis";

// Pre-configured rate limiters
const limiters: Record<string, RateLimiter> = {
  default: new RateLimiter("default", 100, 60), // 100 req/min
  search: new RateLimiter("search", 60, 60), // 60 req/min
  orders: new RateLimiter("orders", 30, 60), // 30 req/min
  reviews: new RateLimiter("reviews", 10, 60), // 10 req/min
  strict: new RateLimiter("strict", 10, 60), // 10 req/min
};

/**
 * Create rate limiter middleware
 */
export function rateLimit(limiterName: keyof typeof limiters = "default") {
  return async (c: Context, next: Next): Promise<void | Response> => {
    const limiter = limiters[limiterName] ?? limiters.default!;

    // Use user ID if authenticated, otherwise use IP
    const userId = c.get("userId") as string | undefined;
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0] ||
      c.req.header("x-real-ip") ||
      "unknown";

    const identifier = userId || ip;

    const result = await limiter.check(identifier);

    // Set rate limit headers
    c.header("X-RateLimit-Limit", limiter["limit"].toString());
    c.header("X-RateLimit-Remaining", result.remaining.toString());
    c.header("X-RateLimit-Reset", result.resetAt.toISOString());

    if (!result.allowed) {
      c.header(
        "Retry-After",
        Math.ceil((result.resetAt.getTime() - Date.now()) / 1000).toString()
      );

      return c.json(
        {
          success: false,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests, please try again later",
            retryAfter: result.resetAt.toISOString(),
          },
        },
        429
      );
    }

    await next();
  };
}

/**
 * Dynamic rate limiter factory
 */
export function createRateLimiter(
  prefix: string,
  limit: number,
  windowSeconds: number
) {
  const limiter = new RateLimiter(prefix, limit, windowSeconds);

  return async (c: Context, next: Next): Promise<void | Response> => {
    const userId = c.get("userId") as string | undefined;
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0] ||
      c.req.header("x-real-ip") ||
      "unknown";

    const identifier = userId || ip;
    const result = await limiter.check(identifier);

    c.header("X-RateLimit-Limit", limit.toString());
    c.header("X-RateLimit-Remaining", result.remaining.toString());
    c.header("X-RateLimit-Reset", result.resetAt.toISOString());

    if (!result.allowed) {
      c.header(
        "Retry-After",
        Math.ceil((result.resetAt.getTime() - Date.now()) / 1000).toString()
      );

      return c.json(
        {
          success: false,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests",
            retryAfter: result.resetAt.toISOString(),
          },
        },
        429
      );
    }

    await next();
  };
}
