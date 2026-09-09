/**
 * Redis client singleton.
 *
 * Redis is used here for short-lived coordination only — the lock that stops two
 * workers from expiring the same reservations or exhausting the same budget at
 * once. Nothing this service must not lose lives in Redis: campaigns, budgets,
 * reservations, referrals and incentive postings are all in Postgres.
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
    const pong = await redis.ping();
    return pong === "PONG";
  } catch (error) {
    redisLogger.error({ err: error }, "redis connection check failed");
    return false;
  }
}

/**
 * Best-effort mutual exclusion for the periodic sweeps (reservation expiry,
 * budget exhaustion). A lost lock only means a duplicate sweep attempt, never a
 * lost fact — every sweep step is itself idempotent against Postgres.
 */
export async function withSweepLock<T>(
  key: string,
  ttlSeconds: number,
  work: () => Promise<T>,
): Promise<T | null> {
  const token = `${process.pid}:${Date.now()}`;
  let acquired = false;
  try {
    acquired = (await redis.set(key, token, "EX", ttlSeconds, "NX")) === "OK";
  } catch (error) {
    redisLogger.warn(
      { err: error, key },
      "sweep lock unavailable; skipping sweep",
    );
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
    await redis.eval(script, 1, key, token).catch((error: unknown) => {
      redisLogger.warn({ err: error, key }, "failed to release sweep lock");
    });
  }
}
