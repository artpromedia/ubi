/**
 * Performance Metrics API
 *
 * Exposes endpoints for monitoring and performance metrics collection.
 * Provides data for dashboards and alerting systems.
 */

import { Hono } from "hono";

import { perfLogger } from "../lib/logger.js";
import { performanceMonitor, providerHealthCache } from "../lib/performance.js";
import { checkPrismaConnection, getPoolConfig } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";

export const metricsRouter = new Hono();

/**
 * GET /metrics
 * Returns current performance metrics
 */
metricsRouter.get("/", async (c) => {
  const [
    walletBalanceStats,
    paymentProcessStats,
    providerHealths,
    cacheHitRate,
    dbHealth,
  ] = await Promise.all([
    performanceMonitor.getTimingStats("wallet.getBalance"),
    performanceMonitor.getTimingStats("payment.process"),
    providerHealthCache.getAll(),
    performanceMonitor.getCacheHitRate("wallet_balance"),
    checkPrismaConnection(),
  ]);

  // Check Redis health
  let redisHealthy = false;
  let redisLatencyMs = 0;
  try {
    const start = Date.now();
    await redis.ping();
    redisLatencyMs = Date.now() - start;
    redisHealthy = true;
  } catch (error) {
    perfLogger.error({ err: error }, "Redis health check failed");
  }

  return c.json({
    timestamp: new Date().toISOString(),
    service: "payment-service",

    // System health
    health: {
      database: {
        healthy: dbHealth.healthy,
        latencyMs: dbHealth.latencyMs,
      },
      redis: {
        healthy: redisHealthy,
        latencyMs: redisLatencyMs,
      },
    },

    // Database pool config
    databasePool: getPoolConfig(),

    // Performance stats
    performance: {
      walletBalance: walletBalanceStats,
      paymentProcess: paymentProcessStats,
    },

    // Cache metrics
    cache: {
      walletBalance: {
        hitRate: Math.round(cacheHitRate * 100) / 100,
        hitRatePercent: `${Math.round(cacheHitRate * 100)}%`,
      },
    },

    // Provider health
    providers: providerHealths.map((p) => ({
      provider: p.provider,
      isHealthy: p.isHealthy,
      latencyMs: p.latencyMs,
      successRate: `${Math.round(p.successRate * 100)}%`,
      lastChecked: p.lastChecked,
    })),
  });
});

/**
 * GET /metrics/timing/:operation
 * Returns detailed timing stats for a specific operation
 */
metricsRouter.get("/timing/:operation", async (c) => {
  const operation = c.req.param("operation");
  const stats = await performanceMonitor.getTimingStats(operation);

  return c.json({
    operation,
    timestamp: new Date().toISOString(),
    stats,
  });
});

/**
 * GET /metrics/providers
 * Returns provider health metrics
 */
metricsRouter.get("/providers", async (c) => {
  const providers = [
    "mpesa",
    "mtn_momo",
    "airtel_money",
    "paystack",
    "flutterwave",
    "telebirr",
    "orange_money",
  ];

  const providerMetrics = await Promise.all(
    providers.map(async (provider) => {
      const [health, latency, successRate] = await Promise.all([
        providerHealthCache.get(provider),
        providerHealthCache.getAverageLatency(provider),
        providerHealthCache.getSuccessRate(provider),
      ]);

      return {
        provider,
        health: health
          ? {
              isHealthy: health.isHealthy,
              latencyMs: health.latencyMs,
              lastChecked: health.lastChecked,
              errorMessage: health.errorMessage,
            }
          : null,
        averageLatencyMs: latency,
        successRate: `${Math.round(successRate * 100)}%`,
      };
    }),
  );

  return c.json({
    timestamp: new Date().toISOString(),
    providers: providerMetrics,
  });
});

/**
 * GET /metrics/counters
 * Returns daily counter metrics
 */
metricsRouter.get("/counters", async (c) => {
  const counters = [
    "payment.initiated",
    "payment.completed",
    "payment.failed",
    "wallet.topup",
    "wallet.withdrawal",
    "fraud.flagged",
    "fraud.blocked",
  ];

  const counterValues = await Promise.all(
    counters.map(async (name) => ({
      name,
      value: await performanceMonitor.getCounter(name),
    })),
  );

  return c.json({
    timestamp: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
    counters: Object.fromEntries(counterValues.map((c) => [c.name, c.value])),
  });
});

/**
 * POST /metrics/counter/:name
 * Increment a counter (for testing/manual use)
 */
metricsRouter.post("/counter/:name", async (c) => {
  const name = c.req.param("name");
  const body = await c.req.json().catch(() => ({}));
  const value = body.value || 1;

  await performanceMonitor.incrementCounter(name, value);

  return c.json({
    success: true,
    counter: name,
    incrementedBy: value,
  });
});

/**
 * GET /metrics/health
 * Lightweight health check endpoint
 */
metricsRouter.get("/health", async (c) => {
  const dbHealth = await checkPrismaConnection();

  let redisHealthy = false;
  try {
    await redis.ping();
    redisHealthy = true;
  } catch {
    // Redis unhealthy
  }

  const isHealthy = dbHealth.healthy && redisHealthy;

  return c.json(
    {
      status: isHealthy ? "healthy" : "unhealthy",
      database: dbHealth.healthy ? "connected" : "disconnected",
      redis: redisHealthy ? "connected" : "disconnected",
      timestamp: new Date().toISOString(),
    },
    isHealthy ? 200 : 503,
  );
});
