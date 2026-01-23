/**
 * Redis Client
 */

import Redis from "ioredis";
import { redisLogger } from "./logger.js";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  reconnectOnError(err) {
    const targetError = "READONLY";
    if (err.message.includes(targetError)) {
      return true;
    }
    return false;
  },
});

redis.on("error", (err) => {
  redisLogger.error({ err }, "Redis client error");
});

redis.on("connect", () => {
  redisLogger.info("Redis client connected");
});

/**
 * Graceful shutdown
 */
export async function disconnectRedis(): Promise<void> {
  await redis.quit();
}

/**
 * Health check
 */
export async function checkRedisConnection(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === "PONG";
  } catch (error) {
    redisLogger.error({ err: error }, "Redis connection check failed");
    return false;
  }
}

/**
 * Distributed Lock Helper
 *
 * Implements a simple Redis-based distributed lock
 */
export class DistributedLock {
  private readonly prefix = "lock:";
  private readonly defaultTtl = 30; // seconds

  async acquire(
    key: string,
    ttl: number = this.defaultTtl,
  ): Promise<string | null> {
    const lockKey = this.prefix + key;
    const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const result = await redis.set(lockKey, lockValue, "EX", ttl, "NX");

    if (result === "OK") {
      return lockValue;
    }

    return null;
  }

  async release(key: string, lockValue: string): Promise<boolean> {
    const lockKey = this.prefix + key;

    // Use Lua script to ensure atomic check-and-delete
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    const result = await redis.eval(script, 1, lockKey, lockValue);
    return result === 1;
  }

  async extend(
    key: string,
    lockValue: string,
    ttl: number = this.defaultTtl,
  ): Promise<boolean> {
    const lockKey = this.prefix + key;

    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("expire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;

    const result = await redis.eval(script, 1, lockKey, lockValue, ttl);
    return result === 1;
  }

  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    options: { ttl?: number; retries?: number; retryDelay?: number } = {},
  ): Promise<T> {
    const { ttl = this.defaultTtl, retries = 3, retryDelay = 100 } = options;

    let lockValue: string | null = null;
    let attempts = 0;

    while (attempts < retries) {
      lockValue = await this.acquire(key, ttl);
      if (lockValue) break;

      attempts++;
      await new Promise((resolve) =>
        setTimeout(resolve, retryDelay * attempts),
      );
    }

    if (!lockValue) {
      throw new Error(`Failed to acquire lock for key: ${key}`);
    }

    try {
      return await fn();
    } finally {
      await this.release(key, lockValue);
    }
  }
}

export const distributedLock = new DistributedLock();

/**
 * Cache Helper
 */
export class CacheHelper {
  private readonly prefix: string;
  private readonly defaultTtl: number;

  constructor(prefix: string = "cache:", defaultTtl: number = 300) {
    this.prefix = prefix;
    this.defaultTtl = defaultTtl;
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await redis.get(this.prefix + key);
    if (!value) return null;

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    const serialized =
      typeof value === "string" ? value : JSON.stringify(value);
    await redis.setex(this.prefix + key, ttl || this.defaultTtl, serialized);
  }

  async del(key: string): Promise<void> {
    await redis.del(this.prefix + key);
  }

  async getOrSet<T>(
    key: string,
    fn: () => Promise<T>,
    ttl?: number,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const value = await fn();
    await this.set(key, value, ttl);
    return value;
  }

  async invalidatePattern(pattern: string): Promise<number> {
    const keys = await redis.keys(this.prefix + pattern);
    if (keys.length === 0) return 0;

    return redis.del(...keys);
  }
}

export const cache = new CacheHelper();

/**
 * Rate Limiter Helper
 */
export class RateLimiter {
  private readonly prefix = "ratelimit:";

  async check(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
    const fullKey = this.prefix + key;
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    // Remove old entries and count current
    const multi = redis.multi();
    multi.zremrangebyscore(fullKey, 0, windowStart);
    multi.zadd(fullKey, now, `${now}-${Math.random()}`);
    multi.zcard(fullKey);
    multi.pttl(fullKey);

    const results = await multi.exec();

    if (!results) {
      return { allowed: false, remaining: 0, resetIn: windowSeconds };
    }

    const count = (results[2]?.[1] as number) || 0;
    const ttl = (results[3]?.[1] as number) || 0;

    // Set expiry if not set
    if (ttl === -1) {
      await redis.expire(fullKey, windowSeconds);
    }

    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);
    const resetIn = Math.ceil((ttl > 0 ? ttl : windowSeconds * 1000) / 1000);

    if (!allowed) {
      // Remove the request we just added
      await redis.zremrangebyscore(fullKey, now, now);
    }

    return { allowed, remaining, resetIn };
  }
}

export const rateLimiter = new RateLimiter();
