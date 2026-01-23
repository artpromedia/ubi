/**
 * User Service Logger
 *
 * Structured logging using Pino via shared @ubi/logger package
 */

import { createChildLogger, createLogger, type Logger } from "@ubi/logger";

export const logger = createLogger({
  name: "user-service",
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
 * Auth module logger
 */
export const authLogger = createChildLogger(logger, { component: "auth" });

/**
 * Redis connection logger
 */
export const redisLogger = createChildLogger(logger, { component: "redis" });

/**
 * Session management logger
 */
export const sessionLogger = createChildLogger(logger, {
  component: "session",
});

export default logger;
