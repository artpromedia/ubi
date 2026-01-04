/**
 * Health Check Routes
 */

import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

const healthRoutes = new Hono();

/**
 * GET /health - Basic health check
 */
healthRoutes.get("/", (c) => {
  return c.json({
    status: "healthy",
    service: "notification-service",
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health/live - Liveness probe
 */
healthRoutes.get("/live", (c) => {
  return c.json({ status: "alive" });
});

/**
 * GET /health/ready - Readiness probe
 */
healthRoutes.get("/ready", async (c) => {
  const checks: Record<
    string,
    { status: string; latency?: number; error?: string }
  > = {};

  // Database check
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: "healthy", latency: Date.now() - dbStart };
  } catch (error) {
    checks.database = {
      status: "unhealthy",
      latency: Date.now() - dbStart,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }

  // Redis check
  const redisStart = Date.now();
  try {
    await redis.ping();
    checks.redis = { status: "healthy", latency: Date.now() - redisStart };
  } catch (error) {
    checks.redis = {
      status: "unhealthy",
      latency: Date.now() - redisStart,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }

  // Firebase check (just verify config exists)
  checks.firebase = {
    status: process.env.FIREBASE_SERVICE_ACCOUNT
      ? "configured"
      : "not_configured",
  };

  // SendGrid check
  checks.sendgrid = {
    status: process.env.SENDGRID_API_KEY ? "configured" : "not_configured",
  };

  // Twilio check
  checks.twilio = {
    status: process.env.TWILIO_ACCOUNT_SID ? "configured" : "not_configured",
  };

  // Africa's Talking check
  checks.africasTalking = {
    status: process.env.AFRICASTALKING_API_KEY
      ? "configured"
      : "not_configured",
  };

  const isHealthy =
    checks.database.status === "healthy" && checks.redis.status === "healthy";

  return c.json(
    {
      status: isHealthy ? "ready" : "not_ready",
      checks,
    },
    isHealthy ? 200 : 503
  );
});

/**
 * GET /health/detailed - Detailed health with stats
 */
healthRoutes.get("/detailed", async (c) => {
  const checks: Record<string, unknown> = {};

  // Database check with stats
  try {
    const [_dbPing, notificationStats] = await Promise.all([
      prisma.$queryRaw`SELECT 1`,
      prisma.notificationLog.groupBy({
        by: ["status"],
        _count: { status: true },
        where: {
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    const stats = notificationStats.reduce(
      (acc: Record<string, number>, s: (typeof notificationStats)[number]) => {
        acc[s.status.toLowerCase()] = s._count.status;
        return acc;
      },
      {} as Record<string, number>
    );

    checks.database = {
      status: "healthy",
      stats: {
        last24Hours: stats,
      },
    };
  } catch (error) {
    checks.database = {
      status: "unhealthy",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }

  // Redis check with stats
  try {
    const info = await redis.info("memory");
    checks.redis = {
      status: "healthy",
      memoryInfo: info.split("\n").slice(0, 5).join("\n"),
    };
  } catch (error) {
    checks.redis = {
      status: "unhealthy",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }

  // Channel stats
  try {
    const channelStats = await prisma.notificationLog.groupBy({
      by: ["channel"],
      _count: { channel: true },
      where: {
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });

    checks.channelStats = channelStats.reduce(
      (acc: Record<string, number>, s: (typeof channelStats)[number]) => {
        acc[s.channel.toLowerCase()] = s._count.channel;
        return acc;
      },
      {} as Record<string, number>
    );
  } catch {
    checks.channelStats = { error: "Failed to fetch" };
  }

  // Process info
  checks.process = {
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    nodeVersion: process.version,
  };

  // Provider status
  checks.providers = {
    firebase: {
      configured: !!process.env.FIREBASE_SERVICE_ACCOUNT,
      projectId: process.env.FIREBASE_PROJECT_ID || "not_set",
    },
    sendgrid: {
      configured: !!process.env.SENDGRID_API_KEY,
      fromEmail: process.env.SENDGRID_FROM_EMAIL || "not_set",
    },
    twilio: {
      configured: !!process.env.TWILIO_ACCOUNT_SID,
      fromNumber: process.env.TWILIO_FROM_NUMBER || "not_set",
    },
    africasTalking: {
      configured: !!process.env.AFRICASTALKING_API_KEY,
      username: process.env.AFRICASTALKING_USERNAME || "not_set",
    },
  };

  return c.json({
    status: "healthy",
    service: "notification-service",
    version: process.env.npm_package_version || "1.0.0",
    timestamp: new Date().toISOString(),
    checks,
  });
});

export { healthRoutes };
