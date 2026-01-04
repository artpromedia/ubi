/**
 * Health Check Routes
 */

import { Hono } from 'hono';
import { checkConnection as checkPrisma, prisma } from '../lib/prisma';
import { checkConnection as checkRedis, redis } from '../lib/redis';

const healthRoutes = new Hono();

/**
 * GET /health - Basic health check
 */
healthRoutes.get('/', (c) => {
  return c.json({
    status: 'healthy',
    service: 'food-service',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health/live - Liveness probe
 */
healthRoutes.get('/live', (c) => {
  return c.json({ status: 'alive' });
});

/**
 * GET /health/ready - Readiness probe
 */
healthRoutes.get('/ready', async (c) => {
  const checks = await Promise.allSettled([
    checkPrisma(),
    checkRedis(),
  ]);

  const [dbCheck, redisCheck] = checks;
  const isReady = dbCheck.status === 'fulfilled' && redisCheck.status === 'fulfilled';

  const response = {
    status: isReady ? 'ready' : 'not_ready',
    checks: {
      database: {
        status: dbCheck.status === 'fulfilled' ? 'healthy' : 'unhealthy',
        error: dbCheck.status === 'rejected' ? dbCheck.reason?.message : undefined,
      },
      redis: {
        status: redisCheck.status === 'fulfilled' ? 'healthy' : 'unhealthy',
        error: redisCheck.status === 'rejected' ? redisCheck.reason?.message : undefined,
      },
    },
    timestamp: new Date().toISOString(),
  };

  return c.json(response, isReady ? 200 : 503);
});

/**
 * GET /health/detailed - Detailed health check
 */
healthRoutes.get('/detailed', async (c) => {
  const startTime = Date.now();

  // Check database with timing
  const dbStart = Date.now();
  let dbStatus = 'healthy';
  let dbLatency = 0;
  let dbError: string | undefined;

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbLatency = Date.now() - dbStart;
  } catch (error: any) {
    dbStatus = 'unhealthy';
    dbError = error.message;
  }

  // Check Redis with timing
  const redisStart = Date.now();
  let redisStatus = 'healthy';
  let redisLatency = 0;
  let redisError: string | undefined;

  try {
    await redis.ping();
    redisLatency = Date.now() - redisStart;
  } catch (error: any) {
    redisStatus = 'unhealthy';
    redisError = error.message;
  }

  // Get service stats
  const restaurantCount = await prisma.restaurant.count().catch(() => 0);
  const orderCountToday = await prisma.order
    .count({
      where: {
        createdAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
      },
    })
    .catch(() => 0);

  const response = {
    status: dbStatus === 'healthy' && redisStatus === 'healthy' ? 'healthy' : 'degraded',
    service: 'food-service',
    version: process.env.SERVICE_VERSION || '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    responseTime: Date.now() - startTime,
    checks: {
      database: {
        status: dbStatus,
        latency: dbLatency,
        error: dbError,
      },
      redis: {
        status: redisStatus,
        latency: redisLatency,
        error: redisError,
      },
    },
    stats: {
      totalRestaurants: restaurantCount,
      ordersToday: orderCountToday,
    },
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      memoryUsage: process.memoryUsage(),
    },
  };

  return c.json(response);
});

export { healthRoutes };
