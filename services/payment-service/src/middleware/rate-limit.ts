/**
 * Rate Limit Middleware
 */

import { Context, Next } from "hono";
import { rateLimiter } from "../lib/redis";

interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  keyPrefix?: string;
}

/**
 * Create rate limit middleware
 */
export function rateLimit(options: RateLimitOptions) {
  return async (c: Context, next: Next): Promise<void | Response> => {
    const { limit, windowSeconds, keyPrefix = "global" } = options;

    // Get identifier (user ID or IP)
    const userId = c.get("userId");
    const ip =
      c.req.header("X-Forwarded-For")?.split(",")[0] ||
      c.req.header("X-Real-IP") ||
      "unknown";

    const identifier = userId || ip;
    const key = `${keyPrefix}:${identifier}`;

    const result = await rateLimiter.check(key, limit, windowSeconds);

    // Set rate limit headers
    c.header("X-RateLimit-Limit", limit.toString());
    c.header("X-RateLimit-Remaining", result.remaining.toString());
    c.header("X-RateLimit-Reset", result.resetIn.toString());

    if (!result.allowed) {
      return c.json(
        {
          success: false,
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests",
            details: {
              limit,
              remaining: result.remaining,
              resetIn: result.resetIn,
            },
          },
        },
        429
      );
    }

    await next();
  };
}

// Pre-configured rate limiters
export const standardRateLimit = rateLimit({
  limit: 100,
  windowSeconds: 60,
  keyPrefix: "standard",
});

export const strictRateLimit = rateLimit({
  limit: 10,
  windowSeconds: 60,
  keyPrefix: "strict",
});

export const paymentRateLimit = rateLimit({
  limit: 30,
  windowSeconds: 60,
  keyPrefix: "payment",
});

export const webhookRateLimit = rateLimit({
  limit: 1000,
  windowSeconds: 60,
  keyPrefix: "webhook",
});
