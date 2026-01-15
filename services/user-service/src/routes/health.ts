/**
 * Health Check Routes
 *
 * Provides health endpoints for Kubernetes probes and monitoring.
 */

import { Hono } from "hono";

import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

const healthRoutes = new Hono();

const startTime = Date.now();

/**
 * GET /health/live
 * Kubernetes liveness probe
 * Returns 200 if the service is running
 */
healthRoutes.get("/live", (c) => {
  return c.json({ status: "ok" });
});

/**
 * GET /health/ready
 * Kubernetes readiness probe
 * Returns 200 if the service is ready to accept traffic
 */
healthRoutes.get("/ready", async (c) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;

    // Check Redis connection
    await redis.ping();

    return c.json({ status: "ready" });
  } catch (error) {
    return c.json({ status: "not ready", error: String(error) }, 503);
  }
});

/**
 * GET /health
 * Detailed health check with dependency status
 */
healthRoutes.get("/", async (c) => {
  const checks: Record<
    string,
    { status: string; latency?: number; error?: string }
  > = {};

  // Check PostgreSQL
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: "up", latency: Date.now() - dbStart };
  } catch (error) {
    checks.database = { status: "down", error: String(error) };
  }

  // Check Redis
  try {
    const redisStart = Date.now();
    await redis.ping();
    checks.redis = { status: "up", latency: Date.now() - redisStart };
  } catch (error) {
    checks.redis = { status: "down", error: String(error) };
  }

  // Overall status
  const isHealthy = Object.values(checks).every(
    (check) => check.status === "up",
  );

  return c.json(
    {
      status: isHealthy ? "healthy" : "degraded",
      version: process.env.npm_package_version || "0.0.1",
      service: "user-service",
      uptime: Math.floor((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString(),
      checks,
    },
    isHealthy ? 200 : 503,
  );
});

export { healthRoutes };
