/**
 * Notification Service Logger
 *
 * Structured logging using Pino via shared @ubi/logger package
 */

import { createChildLogger, createLogger, type Logger } from "@ubi/logger";

export const logger = createLogger({
  name: "notification-service",
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
 * Firebase/Push notification logger
 */
export const pushLogger = createChildLogger(logger, { component: "push" });

/**
 * SMS provider logger
 */
export const smsLogger = createChildLogger(logger, { component: "sms" });

/**
 * Email provider logger
 */
export const emailLogger = createChildLogger(logger, { component: "email" });

/**
 * Redis connection logger
 */
export const redisLogger = createChildLogger(logger, { component: "redis" });

/**
 * Template processing logger
 */
export const templateLogger = createChildLogger(logger, {
  component: "templates",
});

/**
 * Database connection logger
 */
export const dbLogger = createChildLogger(logger, { component: "database" });

/**
 * Authentication logger
 */
export const authLogger = createChildLogger(logger, { component: "auth" });

export default logger;
