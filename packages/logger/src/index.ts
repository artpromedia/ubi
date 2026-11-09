import pino, {
  type DestinationStream,
  type Logger as PinoLogger,
  type LoggerOptions,
} from "pino";

export type LogLevel =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal"
  | "silent";

/**
 * Canonical PII and secret field paths redacted across every structured log
 * line emitted through `@ubi/logger`.
 */
export const DEFAULT_REDACT_PATHS = [
  "phone",
  "*.phone",
  "*.*.phone",
  "recipient",
  "*.recipient",
  "email",
  "*.email",
  "*.*.email",
  "otp",
  "*.otp",
  "*.*.otp",
  "code",
  "*.code",
  "*.*.code",
  "pin",
  "*.pin",
  "*.*.pin",
  "password",
  "*.password",
  "*.*.password",
  "passwordHash",
  "*.passwordHash",
  "token",
  "*.token",
  "*.*.token",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",
  "resetToken",
  "*.resetToken",
  "resetUrl",
  "*.resetUrl",
  "authorization",
  "*.authorization",
  "*.*.authorization",
  'headers["x-service-key"]',
  '*.headers["x-service-key"]',
  'headers["x-ubi-identity"]',
  '*.headers["x-ubi-identity"]',
  "serviceKey",
  "*.serviceKey",
  "apiKey",
  "*.apiKey",
  "secret",
  "*.secret",
] as const;

export const REDACTED_VALUE = "[REDACTED]";

export interface LoggerConfig {
  name: string;
  level?: LogLevel;
  pretty?: boolean;
  redactPaths?: readonly string[];
  destination?: DestinationStream;
}

/**
 * Create a structured logger instance with mandatory PII/secret redaction.
 */
export function createLogger(config: LoggerConfig): PinoLogger {
  const {
    name,
    level = "info",
    pretty = process.env.NODE_ENV !== "production" &&
      config.destination === undefined,
    redactPaths = [],
    destination,
  } = config;

  const paths = Array.from(new Set([...DEFAULT_REDACT_PATHS, ...redactPaths]));

  const options: LoggerOptions = {
    name,
    level,
    redact: {
      paths,
      censor: REDACTED_VALUE,
    },
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

  return destination ? pino(options, destination) : pino(options);
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
