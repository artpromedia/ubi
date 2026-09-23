/**
 * Redis client singleton.
 *
 * Redis is coordination only: the lock that keeps two replicas from running
 * the same sweep at once (proposal expiry, maintenance clock, document
 * warnings, off-road integrity). Nothing this service must not lose lives in
 * Redis — every fleet fact is in Postgres, and every sweep is idempotent, so a
 * lost lock costs a duplicate read, never a duplicate effect.
 */
import Redis from "ioredis";

import { redisLogger } from "./logger";

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  retryStrategy(times: number) {
    return Math.min(times * 50, 2000);
  },
});

redis.on("error", (err: unknown) => {
  redisLogger.error({ err }, "redis client error");
});

export async function disconnectRedis(): Promise<void> {
  if (redis.status === "end") {
    return;
  }
  await redis.quit();
}

export async function checkRedisConnection(): Promise<boolean> {
  try {
    return (await redis.ping()) === "PONG";
  } catch (error) {
    redisLogger.error({ err: error }, "redis connection check failed");
    return false;
  }
}

/** Best-effort mutual exclusion for one sweep; null when another holds it. */
export async function withSweepLock<T>(
  client: Redis,
  key: string,
  ttlSeconds: number,
  work: () => Promise<T>,
): Promise<T | null> {
  const token = `${process.pid}:${Date.now()}`;
  let acquired = false;
  try {
    acquired = (await client.set(key, token, "EX", ttlSeconds, "NX")) === "OK";
  } catch (error) {
    redisLogger.warn({ err: error, key }, "sweep lock unavailable; skipping");
    return null;
  }
  if (!acquired) {
    return null;
  }
  try {
    return await work();
  } finally {
    const script =
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
    await client.eval(script, 1, key, token).catch((error: unknown) => {
      redisLogger.warn({ err: error, key }, "failed to release sweep lock");
    });
  }
}
