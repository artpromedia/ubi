/**
 * Prisma Client Singleton with Performance Optimizations
 *
 * Features:
 * - Query logging with timing in development
 * - Connection pool configuration via environment
 * - Slow query detection and logging
 * - Metrics collection for query performance
 */

import { PrismaClient } from "@prisma/client";
import { dbLogger, perfLogger } from "./logger.js";
import { DATABASE_POOL_CONFIG, performanceMonitor } from "./performance.js";

const SLOW_QUERY_THRESHOLD_MS = Number.parseInt(
  process.env.SLOW_QUERY_THRESHOLD_MS || "500",
  10,
);

// Type for the extended Prisma client
type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedPrismaClient | undefined;
};

/**
 * Create Prisma client with performance monitoring
 * Uses Prisma Client Extensions (replaces deprecated $use middleware)
 */
function createPrismaClient() {
  const baseClient = new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? [
            { emit: "event", level: "query" },
            { emit: "stdout", level: "error" },
            { emit: "stdout", level: "warn" },
          ]
        : [
            { emit: "event", level: "query" },
            { emit: "stdout", level: "error" },
          ],
    // Connection pool settings are configured via DATABASE_URL or env vars
    // Example: postgresql://user:pass@host:5432/db?connection_limit=25&pool_timeout=10
  });

  // Log query events in development
  if (process.env.NODE_ENV === "development") {
    baseClient.$on(
      "query" as never,
      (e: { query: string; params: string; duration: number }) => {
        if (e.duration > 100) {
          dbLogger.debug(
            {
              query: e.query.slice(0, 200),
              params: e.params?.slice(0, 100),
              duration: e.duration,
            },
            "Prisma query",
          );
        }
      },
    );
  }

  // Use Prisma Client Extensions for query timing (replaces deprecated $use middleware)
  const client = baseClient.$extends({
    query: {
      $allOperations: async ({ operation, model, args, query }) => {
        const startTime = Date.now();
        const result = await query(args);
        const duration = Date.now() - startTime;

        // Record query timing metrics
        const operationName = `${model || "unknown"}.${operation}`;
        performanceMonitor.recordTiming("prisma.query", duration, {
          model: model || "unknown",
          action: operation,
        });

        // Log slow queries
        if (duration > SLOW_QUERY_THRESHOLD_MS) {
          perfLogger.warn(
            {
              model: model || "unknown",
              action: operation,
              duration,
              threshold: SLOW_QUERY_THRESHOLD_MS,
            },
            `Slow query detected: ${operationName} took ${duration}ms`,
          );
        }

        // Debug logging in development
        if (process.env.NODE_ENV === "development" && duration > 100) {
          dbLogger.debug(
            { operation: operationName, duration },
            `Query ${operationName} completed in ${duration}ms`,
          );
        }

        return result;
      },
    },
  });

  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Graceful shutdown
 */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  dbLogger.info("Prisma disconnected");
}

/**
 * Health check with connection pool info
 */
export async function checkPrismaConnection(): Promise<{
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}> {
  const startTime = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - startTime;

    await performanceMonitor.recordTiming("prisma.healthcheck", latencyMs);

    return { healthy: true, latencyMs };
  } catch (error) {
    dbLogger.error({ err: error }, "Prisma connection check failed");
    return {
      healthy: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get connection pool statistics (estimated)
 */
export function getPoolConfig() {
  return {
    connectionLimit: DATABASE_POOL_CONFIG.connectionLimit,
    minConnections: DATABASE_POOL_CONFIG.minConnections,
    connectionTimeoutMs: DATABASE_POOL_CONFIG.connectionTimeoutMs,
    idleTimeoutMs: DATABASE_POOL_CONFIG.idleTimeoutMs,
  };
}
