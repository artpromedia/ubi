/**
 * Redis Client with Cache and Pub/Sub Helpers
 */

import Redis from "ioredis";

// Main Redis client
export const redis = new Redis(
  process.env.REDIS_URL || "redis://localhost:6379",
  {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    reconnectOnError(err) {
      const targetError = "READONLY";
      return err.message.includes(targetError);
    },
  }
);

// Subscriber client for pub/sub
export const subscriber = new Redis(
  process.env.REDIS_URL || "redis://localhost:6379",
  {
    maxRetriesPerRequest: 3,
  }
);

redis.on("connect", () => {
  console.log("[Redis] Connected to Redis");
});

redis.on("error", (err) => {
  console.error("[Redis] Connection error:", err);
});

/**
 * Check Redis connection
 */
export async function checkConnection(): Promise<boolean> {
  try {
    const result = await redis.ping();
    return result === "PONG";
  } catch (error) {
    console.error("[Redis] Connection check failed:", error);
    throw error;
  }
}

/**
 * Disconnect from Redis
 */
export async function disconnect(): Promise<void> {
  await redis.quit();
  await subscriber.quit();
  console.log("[Redis] Disconnected");
}

// ============================================
// Cache Helper
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
      return value as unknown as T;
    }
  },

  /**
   * Set cached value with optional TTL
   */
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const serialized =
      typeof value === "string" ? value : JSON.stringify(value);
    if (ttlSeconds) {
      await redis.setex(key, ttlSeconds, serialized);
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
   * Delete multiple keys by pattern
   */
  async deletePattern(pattern: string): Promise<void> {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  },

  /**
   * Get or set with callback
   */
  async getOrSet<T>(
    key: string,
    callback: () => Promise<T>,
    ttlSeconds = 300
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await callback();
    await this.set(key, value, ttlSeconds);
    return value;
  },

  /**
   * Increment counter
   */
  async increment(key: string, amount = 1): Promise<number> {
    return redis.incrby(key, amount);
  },

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    return (await redis.exists(key)) === 1;
  },

  /**
   * Set expiry on existing key
   */
  async expire(key: string, ttlSeconds: number): Promise<void> {
    await redis.expire(key, ttlSeconds);
  },
};

// ============================================
// Distributed Lock
// ============================================

export class DistributedLock {
  private readonly key: string;
  private readonly ttl: number;
  private readonly lockValue: string;

  constructor(resource: string, ttlMs = 10000) {
    this.key = `lock:${resource}`;
    this.ttl = Math.ceil(ttlMs / 1000);
    this.lockValue = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  async acquire(): Promise<boolean> {
    const result = await redis.set(
      this.key,
      this.lockValue,
      "EX",
      this.ttl,
      "NX"
    );
    return result === "OK";
  }

  async release(): Promise<void> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await redis.eval(script, 1, this.key, this.lockValue);
  }

  async extend(ttlMs: number): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("expire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;
    const result = await redis.eval(
      script,
      1,
      this.key,
      this.lockValue,
      Math.ceil(ttlMs / 1000)
    );
    return result === 1;
  }
}

/**
 * Execute with lock
 */
export async function withLock<T>(
  resource: string,
  callback: () => Promise<T>,
  ttlMs = 10000
): Promise<T> {
  const lock = new DistributedLock(resource, ttlMs);
  const acquired = await lock.acquire();

  if (!acquired) {
    throw new Error(`Could not acquire lock for ${resource}`);
  }

  try {
    return await callback();
  } finally {
    await lock.release();
  }
}

// ============================================
// Rate Limiter
// ============================================

export class RateLimiter {
  private readonly prefix: string;
  private readonly limit: number;
  private readonly windowSeconds: number;

  constructor(prefix: string, limit: number, windowSeconds: number) {
    this.prefix = prefix;
    this.limit = limit;
    this.windowSeconds = windowSeconds;
  }

  async check(identifier: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: Date;
  }> {
    const key = `ratelimit:${this.prefix}:${identifier}`;
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - this.windowSeconds;

    // Use Redis sorted set for sliding window
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zcard(key);
    pipeline.zadd(key, now.toString(), `${now}-${Math.random()}`);
    pipeline.expire(key, this.windowSeconds);

    const results = await pipeline.exec();
    const count = (results?.[1]?.[1] as number) || 0;

    const allowed = count < this.limit;
    const remaining = Math.max(0, this.limit - count - 1);
    const resetAt = new Date((now + this.windowSeconds) * 1000);

    return { allowed, remaining, resetAt };
  }
}

// Pre-configured rate limiters
export const rateLimiters = {
  orderCreate: new RateLimiter("order:create", 10, 60), // 10 orders per minute
  search: new RateLimiter("search", 60, 60), // 60 searches per minute
  review: new RateLimiter("review", 5, 3600), // 5 reviews per hour
};

// ============================================
// Pub/Sub Helpers
// ============================================

export const pubsub = {
  /**
   * Publish message to channel
   */
  async publish(channel: string, message: any): Promise<void> {
    const data =
      typeof message === "string" ? message : JSON.stringify(message);
    await redis.publish(channel, data);
  },

  /**
   * Subscribe to channel
   */
  async subscribe(
    channel: string,
    handler: (message: any) => void
  ): Promise<void> {
    await subscriber.subscribe(channel);
    subscriber.on("message", (ch, message) => {
      if (ch === channel) {
        try {
          handler(JSON.parse(message));
        } catch {
          handler(message);
        }
      }
    });
  },

  /**
   * Unsubscribe from channel
   */
  async unsubscribe(channel: string): Promise<void> {
    await subscriber.unsubscribe(channel);
  },
};

export default redis;
