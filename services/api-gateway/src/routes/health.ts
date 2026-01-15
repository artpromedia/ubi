/**
 * Health Check Routes
 *
 * Provides health check endpoints for Kubernetes probes
 * and monitoring systems.
 */

import { Hono } from "hono";
import Redis from "ioredis";

const healthRoutes = new Hono();

// Service version from package.json
const VERSION = process.env.npm_package_version || "0.0.1";

interface HealthCheck {
  status: "healthy" | "unhealthy" | "degraded";
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    name: string;
    status: "pass" | "fail" | "warn";
    duration?: number;
    message?: string;
  }[];
}

/**
 * Liveness probe - Kubernetes uses this to know if the container should be restarted
 * Should return 200 as long as the process is running
 */
healthRoutes.get("/live", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * Readiness probe - Kubernetes uses this to know if the container can accept traffic
 * Should return 200 only when all dependencies are available
 */
healthRoutes.get("/ready", async (c) => {
  const checks: HealthCheck["checks"] = [];
  let overallStatus: HealthCheck["status"] = "healthy";

  // Check Redis connection
  const redisCheck = await checkRedis();
  checks.push(redisCheck);
  if (redisCheck.status === "fail") {
    overallStatus = "unhealthy";
  } else if (redisCheck.status === "warn") {
    overallStatus = overallStatus === "healthy" ? "degraded" : overallStatus;
  }

  const response: HealthCheck = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: VERSION,
    uptime: process.uptime(),
    checks,
  };

  const statusCode = overallStatus === "healthy" ? 200 : overallStatus === "degraded" ? 200 : 503;
  return c.json(response, statusCode);
});

/**
 * Detailed health check - For monitoring dashboards
 */
healthRoutes.get("/", async (c) => {
  const checks: HealthCheck["checks"] = [];
  let overallStatus: HealthCheck["status"] = "healthy";

  // Check Redis
  const redisCheck = await checkRedis();
  checks.push(redisCheck);
  if (redisCheck.status === "fail") {
    overallStatus = "unhealthy";
  }

  // Check memory usage
  const memoryCheck = checkMemory();
  checks.push(memoryCheck);
  if (memoryCheck.status === "fail") {
    overallStatus = "unhealthy";
  } else if (memoryCheck.status === "warn") {
    overallStatus = overallStatus === "healthy" ? "degraded" : overallStatus;
  }

  // Check event loop lag
  const eventLoopCheck = await checkEventLoopLag();
  checks.push(eventLoopCheck);
  if (eventLoopCheck.status === "fail") {
    overallStatus = overallStatus === "healthy" ? "degraded" : overallStatus;
  }

  const response: HealthCheck = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: VERSION,
    uptime: process.uptime(),
    checks,
  };

  return c.json(response);
});

// Helper functions

async function checkRedis(): Promise<HealthCheck["checks"][0]> {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    return {
      name: "redis",
      status: "warn",
      message: "Redis not configured, using memory-based rate limiting",
    };
  }

  const start = Date.now();
  try {
    const redis = new Redis(redisUrl, { lazyConnect: true, connectTimeout: 5000 });
    await redis.ping();
    redis.disconnect();

    return {
      name: "redis",
      status: "pass",
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      name: "redis",
      status: "fail",
      duration: Date.now() - start,
      message: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

function checkMemory(): HealthCheck["checks"][0] {
  const used = process.memoryUsage();
  const heapUsedPercent = (used.heapUsed / used.heapTotal) * 100;

  if (heapUsedPercent > 90) {
    return {
      name: "memory",
      status: "fail",
      message: `Heap usage critical: ${heapUsedPercent.toFixed(1)}%`,
    };
  }

  if (heapUsedPercent > 70) {
    return {
      name: "memory",
      status: "warn",
      message: `Heap usage high: ${heapUsedPercent.toFixed(1)}%`,
    };
  }

  return {
    name: "memory",
    status: "pass",
    message: `Heap usage: ${heapUsedPercent.toFixed(1)}%`,
  };
}

async function checkEventLoopLag(): Promise<HealthCheck["checks"][0]> {
  return await new Promise((resolve) => {
    const start = Date.now();
    setImmediate(() => {
      const lag = Date.now() - start;

      if (lag > 100) {
        resolve({
          name: "event_loop",
          status: "fail",
          duration: lag,
          message: `Event loop lag too high: ${lag}ms`,
        });
      } else if (lag > 50) {
        resolve({
          name: "event_loop",
          status: "warn",
          duration: lag,
          message: `Event loop lag elevated: ${lag}ms`,
        });
      } else {
        resolve({
          name: "event_loop",
          status: "pass",
          duration: lag,
        });
      }
    });
  });
}

export { healthRoutes };
