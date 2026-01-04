/**
 * Health Check Routes
 */

import { Hono } from 'hono';
import { checkPrismaConnection } from '../lib/prisma';
import { checkRedisConnection } from '../lib/redis';

const healthRoutes = new Hono();

/**
 * GET /health - Basic health check
 */
healthRoutes.get('/', (c) => {
  return c.json({
    status: 'ok',
    service: 'payment-service',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health/ready - Readiness check (includes dependencies)
 */
healthRoutes.get('/ready', async (c) => {
  const checks: Record<string, boolean> = {};
  
  // Check database
  checks.database = await checkPrismaConnection();
  
  // Check Redis
  checks.redis = await checkRedisConnection();
  
  const allHealthy = Object.values(checks).every(Boolean);
  
  return c.json({
    status: allHealthy ? 'ready' : 'degraded',
    service: 'payment-service',
    checks,
    timestamp: new Date().toISOString(),
  }, allHealthy ? 200 : 503);
});

/**
 * GET /health/live - Liveness check
 */
healthRoutes.get('/live', (c) => {
  return c.json({
    status: 'alive',
    service: 'payment-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

export { healthRoutes };
