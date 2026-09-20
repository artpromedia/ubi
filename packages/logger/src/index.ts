import pino, { type Logger as PinoLogger, type LoggerOptions } from "pino";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LoggerConfig {
  name: string;
  level?: LogLevel;
  pretty?: boolean;
}

/**
 * Create a structured logger instance
 */
export function createLogger(config: LoggerConfig): PinoLogger {
  const {
    name,
    level = "info",
    pretty = process.env.NODE_ENV !== "production",
  } = config;

  const options: LoggerOptions = {
    name,
    level,
    ...(pretty && {
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
    }),
  };

  return pino(options);
}

/**
 * Default logger instance
 */
export const logger = createLogger({
  name: "ubi",
  level: (process.env.LOG_LEVEL as LogLevel) || "info",
});

/**
 * Create a child logger with additional context
 */
export function createChildLogger(
  parent: PinoLogger,
  bindings: Record<string, unknown>,
): PinoLogger {
  return parent.child(bindings);
}

/**
 * Request logger middleware context
 */
export interface RequestLogContext {
  requestId: string;
  method: string;
  path: string;
  userId?: string;
  ip?: string;
}

/**
 * Create a request-scoped logger
 */
export function createRequestLogger(
  parent: PinoLogger,
  context: RequestLogContext,
): PinoLogger {
  return parent.child({
    requestId: context.requestId,
    method: context.method,
    path: context.path,
    ...(context.userId && { userId: context.userId }),
    ...(context.ip && { ip: context.ip }),
  });
}

// Re-export pino types
export type { PinoLogger as Logger };
export { pino };
