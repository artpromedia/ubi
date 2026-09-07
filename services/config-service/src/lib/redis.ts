/**
 * Redis client singleton plus the invalidation channel every reader subscribes
 * to. A cache is never authoritative: if Redis is unavailable the service still
 * answers from Postgres.
 */
import Redis from "ioredis";

import { cacheLogger } from "./logger";

/**
 * Published on every config activation and flag change. `@ubi/config-client`
 * subscribes to the same literal; it is duplicated rather than imported so the
 * service does not depend on its own client package.
 */
export const CONFIG_INVALIDATION_CHANNEL = "ubi.config.invalidate";

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

const globalForRedis = globalThis as unknown as { ubiConfigRedis?: Redis };

export const redis: Redis =
  globalForRedis.ubiConfigRedis ??
  new Redis(redisUrl, {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 50, 2000),
  });

redis.on("error", (err: unknown) => {
  cacheLogger.error({ err }, "redis client error");
});

if (process.env.NODE_ENV !== "production") {
  globalForRedis.ubiConfigRedis = redis;
}

export async function disconnectRedis(): Promise<void> {
  await redis.quit();
}

export async function checkRedisConnection(): Promise<boolean> {
  try {
    return (await redis.ping()) === "PONG";
  } catch {
    return false;
  }
}
