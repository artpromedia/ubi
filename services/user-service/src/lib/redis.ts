/**
 * Redis Client Instance
 *
 * Singleton pattern for Redis connection.
 * Used for caching, sessions, and rate limiting.
 */

import Redis from "ioredis";
import { redisLogger } from "./logger.js";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    if (times > 3) {
      redisLogger.error("Redis connection failed after 3 retries");
      return null;
    }
    return Math.min(times * 200, 2000);
  },
  reconnectOnError: (err) => {
    const targetErrors = ["READONLY", "ECONNRESET", "ETIMEDOUT"];
    return targetErrors.some((e) => err.message.includes(e));
  },
});

redis.on("connect", () => {
  redisLogger.info("Redis connected");
});

redis.on("error", (err) => {
  redisLogger.error({ err }, "Redis error");
});

redis.on("close", () => {
  redisLogger.warn("Redis connection closed");
});

// Graceful shutdown
process.on("beforeExit", async () => {
  await redis.quit();
});

/**
 * Get or set cached value with optional TTL
 */
export async function getOrSet<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlSeconds: number = 300,
): Promise<T> {
  const cached = await redis.get(key);
  if (cached) {
    return JSON.parse(cached) as T;
  }

  const value = await fetchFn();
  await redis.setex(key, ttlSeconds, JSON.stringify(value));
  return value;
}

/**
 * Invalidate cache by pattern
 */
export async function invalidatePattern(pattern: string): Promise<number> {
  const keys = await redis.keys(pattern);
  if (keys.length > 0) {
    return redis.del(...keys);
  }
  return 0;
}
