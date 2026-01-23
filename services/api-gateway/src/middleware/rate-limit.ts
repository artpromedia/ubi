/**
 * Rate Limiting Middleware
 *
 * Redis-backed rate limiting to protect API from abuse.
 * Different limits for different user types and endpoints.
 */

import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import Redis from "ioredis";
import {
  RateLimiterMemory,
  RateLimiterRedis,
  type RateLimiterAbstract,
} from "rate-limiter-flexible";
import { rateLimitLogger } from "../lib/logger.js";

// Initialize Redis connection
let redis: Redis | null = null;
let rateLimiter: RateLimiterAbstract;

const initializeRateLimiter = () => {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    try {
      redis = new Redis(redisUrl);

      rateLimiter = new RateLimiterRedis({
        storeClient: redis,
        keyPrefix: "ubi:ratelimit",
        points: 100, // Number of requests
        duration: 60, // Per 60 seconds
        blockDuration: 60, // Block for 60 seconds if exceeded
      });

      rateLimitLogger.info("Rate limiter initialized with Redis backend");
    } catch {
      rateLimitLogger.warn(
        "Failed to connect to Redis, using memory-based rate limiter",
      );
      rateLimiter = new RateLimiterMemory({
        points: 100,
        duration: 60,
      });
    }
  } else {
    rateLimitLogger.warn("REDIS_URL not set, using memory-based rate limiter");
    rateLimiter = new RateLimiterMemory({
      points: 100,
      duration: 60,
    });
  }
};

// Initialize on module load
initializeRateLimiter();

// Rate limit configurations per user type
const RATE_LIMITS = {
  anonymous: { points: 30, duration: 60 },
  rider: { points: 100, duration: 60 },
  driver: { points: 150, duration: 60 },
  restaurant: { points: 200, duration: 60 },
  merchant: { points: 200, duration: 60 },
  admin: { points: 500, duration: 60 },
  service: { points: 10000, duration: 60 },
};

// Higher limits for specific endpoints
const ENDPOINT_OVERRIDES: Record<string, { points: number; duration: number }> =
  {
    "/v1/rides/track": { points: 300, duration: 60 }, // Frequent polling for ride tracking
    "/v1/locations/autocomplete": { points: 200, duration: 60 }, // Autocomplete needs more calls
    "/v1/notifications": { points: 200, duration: 60 }, // Real-time notifications
  };

export const rateLimitMiddleware = createMiddleware(
  async (c: Context, next: Next) => {
    const auth = c.get("auth") as
      | { userId?: string; role?: string }
      | undefined;
    const path = c.req.path;
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0] ||
      c.req.header("x-real-ip") ||
      "unknown";

    // Determine rate limit key
    const key = auth?.userId || `ip:${ip}`;
    const role = (auth?.role as keyof typeof RATE_LIMITS) || "anonymous";

    // Get rate limit config
    let config = RATE_LIMITS[role] || RATE_LIMITS.anonymous;

    // Check for endpoint-specific overrides
    for (const [endpoint, override] of Object.entries(ENDPOINT_OVERRIDES)) {
      if (path.startsWith(endpoint)) {
        config = {
          points: Math.max(config.points, override.points),
          duration: override.duration,
        };
        break;
      }
    }

    try {
      const result = await rateLimiter.consume(key, 1);

      // Add rate limit headers
      c.header("X-RateLimit-Limit", String(config.points));
      c.header("X-RateLimit-Remaining", String(result.remainingPoints));
      c.header(
        "X-RateLimit-Reset",
        String(Math.ceil(result.msBeforeNext / 1000)),
      );

      return next();
    } catch (rejRes) {
      // Rate limit exceeded
      const retryAfter = Math.ceil(
        (rejRes as { msBeforeNext: number }).msBeforeNext / 1000,
      );

      c.header("X-RateLimit-Limit", String(config.points));
      c.header("X-RateLimit-Remaining", "0");
      c.header("X-RateLimit-Reset", String(retryAfter));
      c.header("Retry-After", String(retryAfter));

      return c.json(
        {
          success: false,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests. Please try again later.",
            retryAfter,
          },
        },
        429,
      );
    }
  },
);

// Cleanup on process exit
process.on("SIGTERM", () => {
  redis?.disconnect();
});
