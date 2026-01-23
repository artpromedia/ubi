/**
 * API Gateway Logger
 *
 * Structured logging using Pino via shared @ubi/logger package
 */

import { createChildLogger, createLogger, type Logger } from "@ubi/logger";

export const logger = createLogger({
  name: "api-gateway",
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
 * Middleware logger for auth events
 */
export const authLogger = createChildLogger(logger, { component: "auth" });

/**
 * Middleware logger for rate limiting events
 */
export const rateLimitLogger = createChildLogger(logger, {
  component: "rate-limit",
});

/**
 * Proxy logger for service routing
 */
export const proxyLogger = createChildLogger(logger, { component: "proxy" });

export default logger;
