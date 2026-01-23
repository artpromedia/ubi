/**
 * Food Service Logger
 *
 * Structured logging using Pino via shared @ubi/logger package
 */

import { createChildLogger, createLogger, type Logger } from "@ubi/logger";

export const logger = createLogger({
  name: "food-service",
  level:
    (process.env.LOG_LEVEL as
      | "trace"
      | "debug"
      | "info"
      | "warn"
      | "error"
      | "fatal") || "info",
});

/**
 * Create a request-scoped logger
 */
export function createRequestLogger(
  requestId: string,
  path: string,
  method: string,
): Logger {
  return createChildLogger(logger, {
    requestId,
    path,
    method,
  });
}

/**
 * Database connection logger
 */
export const dbLogger = createChildLogger(logger, { component: "database" });

/**
 * Redis connection logger
 */
export const redisLogger = createChildLogger(logger, { component: "redis" });

/**
 * Order processing logger
 */
export const orderLogger = createChildLogger(logger, { component: "orders" });

/**
 * Restaurant management logger
 */
export const restaurantLogger = createChildLogger(logger, {
  component: "restaurants",
});

export default logger;
