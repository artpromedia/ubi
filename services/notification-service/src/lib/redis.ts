/**
 * Redis Client with Pub/Sub Support
 */

import Redis from "ioredis";
import { redisLogger } from "./logger.js";

// Create Redis clients
export const redis = new Redis(
  process.env.REDIS_URL || "redis://localhost:6379",
  {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      const delay = Math.min(times * 100, 3000);
      return delay;
    },
  },
);

// Separate client for subscriptions (Redis requires separate connections for pub/sub)
export const subscriber = new Redis(
  process.env.REDIS_URL || "redis://localhost:6379",
  {
    maxRetriesPerRequest: 3,
  },
);

// Event handlers
redis.on("error", (error) => {
  redisLogger.error({ err: error }, "Redis error");
});

redis.on("connect", () => {
  redisLogger.info("Redis connected");
});

subscriber.on("error", (error) => {
  redisLogger.error({ err: error }, "Redis subscriber error");
});

// ============================================
// Cache Helpers
// ============================================

export const cache = {
  /**
   * Get cached value
   */
  async get<T>(key: string): Promise<T | null> {
    const value = await redis.get(key);
    if (!value) return null;

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  },

  /**
   * Set cached value
   */
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const serialized =
      typeof value === "string" ? value : JSON.stringify(value);

    if (ttlSeconds) {
      await redis.set(key, serialized, "EX", ttlSeconds);
    } else {
      await redis.set(key, serialized);
    }
  },

  /**
   * Delete cached value
   */
  async delete(key: string): Promise<void> {
    await redis.del(key);
  },

  /**
   * Get or set cached value
   */
  async getOrSet<T>(
    key: string,
    fn: () => Promise<T>,
    ttlSeconds: number,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const value = await fn();
    await this.set(key, value, ttlSeconds);
    return value;
  },

  /**
   * Increment counter
   */
  async increment(key: string, by = 1): Promise<number> {
    return redis.incrby(key, by);
  },

  /**
   * Set expiry on key
   */
  async expire(key: string, ttlSeconds: number): Promise<void> {
    await redis.expire(key, ttlSeconds);
  },

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    const result = await redis.exists(key);
    return result === 1;
  },
};

// ============================================
// Pub/Sub Helpers
// ============================================

type EventHandler = (data: unknown) => void | Promise<void>;
const handlers = new Map<string, Set<EventHandler>>();

/**
 * Subscribe to event channel
 */
export async function subscribeToChannel(channel: string): Promise<void> {
  await subscriber.subscribe(channel);
}

/**
 * Register event handler
 */
export function onEvent(event: string, handler: EventHandler): void {
  if (!handlers.has(event)) {
    handlers.set(event, new Set());
  }
  handlers.get(event)!.add(handler);
}

/**
 * Publish event
 */
export async function publishEvent(
  event: string,
  data: unknown,
): Promise<number> {
  const message = JSON.stringify({ event, data, timestamp: Date.now() });
  return redis.publish("notifications", message);
}

// Handle incoming messages
subscriber.on("message", (_channel, message) => {
  try {
    const { event, data } = JSON.parse(message);
    const eventHandlers = handlers.get(event);

    if (eventHandlers) {
      eventHandlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          redisLogger.error({ err: error, event }, "Error in event handler");
        }
      });
    }
  } catch (error) {
    redisLogger.error({ err: error }, "Error processing pub/sub message");
  }
});

// ============================================
// Rate Limiting
// ============================================

export class RateLimiter {
  private keyPrefix: string;
  private limit: number;
  private windowSeconds: number;

  constructor(options: {
    keyPrefix: string;
    limit: number;
    windowSeconds: number;
  }) {
    this.keyPrefix = options.keyPrefix;
    this.limit = options.limit;
    this.windowSeconds = options.windowSeconds;
  }

  /**
   * Check if action is allowed
   */
  async isAllowed(
    identifier: string,
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const key = `${this.keyPrefix}:${identifier}`;
    const now = Date.now();
    const windowStart = now - this.windowSeconds * 1000;

    // Remove old entries
    await redis.zremrangebyscore(key, 0, windowStart);

    // Count entries in window
    const count = await redis.zcard(key);

    if (count >= this.limit) {
      const oldestEntry = await redis.zrange(key, 0, 0, "WITHSCORES");
      const resetAt =
        oldestEntry.length >= 2 && oldestEntry[1]
          ? Number.parseInt(oldestEntry[1], 10) + this.windowSeconds * 1000
          : now + this.windowSeconds * 1000;

      return {
        allowed: false,
        remaining: 0,
        resetAt,
      };
    }

    // Add new entry
    await redis.zadd(key, now, `${now}-${Math.random()}`);
    await redis.expire(key, this.windowSeconds);

    return {
      allowed: true,
      remaining: this.limit - count - 1,
      resetAt: now + this.windowSeconds * 1000,
    };
  }

  /**
   * Get current count
   */
  async getCount(identifier: string): Promise<number> {
    const key = `${this.keyPrefix}:${identifier}`;
    const windowStart = Date.now() - this.windowSeconds * 1000;

    await redis.zremrangebyscore(key, 0, windowStart);
    return redis.zcard(key);
  }

  /**
   * Reset rate limit
   */
  async reset(identifier: string): Promise<void> {
    const key = `${this.keyPrefix}:${identifier}`;
    await redis.del(key);
  }
}

// ============================================
// OTP Storage
// ============================================

export const otpStore = {
  /**
   * Store OTP
   */
  async set(
    identifier: string,
    otp: string,
    ttlSeconds: number = 600,
  ): Promise<void> {
    const key = `otp:${identifier}`;
    await redis.set(key, otp, "EX", ttlSeconds);
  },

  /**
   * Get OTP
   */
  async get(identifier: string): Promise<string | null> {
    const key = `otp:${identifier}`;
    return redis.get(key);
  },

  /**
   * Delete OTP
   */
  async delete(identifier: string): Promise<void> {
    const key = `otp:${identifier}`;
    await redis.del(key);
  },

  /**
   * Increment failed attempts
   */
  async incrementFailedAttempts(identifier: string): Promise<number> {
    const key = `otp:attempts:${identifier}`;
    const count = await redis.incr(key);

    // Set expiry on first attempt
    if (count === 1) {
      await redis.expire(key, 1800); // 30 minutes
    }

    return count;
  },

  /**
   * Get failed attempts count
   */
  async getFailedAttempts(identifier: string): Promise<number> {
    const key = `otp:attempts:${identifier}`;
    const count = await redis.get(key);
    return count ? Number.parseInt(count, 10) : 0;
  },

  /**
   * Reset failed attempts
   */
  async resetFailedAttempts(identifier: string): Promise<void> {
    const key = `otp:attempts:${identifier}`;
    await redis.del(key);
  },

  /**
   * Lock user after too many attempts
   */
  async lockUser(identifier: string, ttlSeconds: number = 1800): Promise<void> {
    const key = `otp:locked:${identifier}`;
    await redis.set(key, "1", "EX", ttlSeconds);
  },

  /**
   * Check if user is locked
   */
  async isLocked(identifier: string): Promise<boolean> {
    const key = `otp:locked:${identifier}`;
    const locked = await redis.get(key);
    return locked === "1";
  },
};

// ============================================
// Cleanup
// ============================================

export async function closeConnections(): Promise<void> {
  await redis.quit();
  await subscriber.quit();
}
