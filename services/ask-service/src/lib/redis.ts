/**
 * Redis client singleton.
 *
 * Redis is used here only for short-lived coordination: per-user rate limiting
 * of the assistant (rule #18 — per-user limits) and provider-concurrency guards.
 * Nothing this service must not lose is kept here — threads, reviews, executions
 * and the ai_actions log all live in Postgres.
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
