/**
 * Structured Logger for Real-Time Gateway
 *
 * Uses pino for high-performance JSON logging.
 * Configured for production-ready logging with proper log levels.
 */

import { pino, type LoggerOptions } from "pino";

const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const NODE_ENV = process.env.NODE_ENV || "development";

const options: LoggerOptions = {
  name: "realtime-gateway",
  level: LOG_LEVEL,

  // Pretty print in development
  transport:
    NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        }
      : undefined,

  // Base context included in all logs
  base: {
    service: "realtime-gateway",
    env: NODE_ENV,
  },

  // Redact sensitive fields
  redact: {
    paths: [
      "token",
      "password",
      "secret",
      "authorization",
      "*.token",
      "*.password",
    ],
    censor: "[REDACTED]",
  },

  // Custom serializers
  serializers: {
    err: pino.stdSerializers.err,
    req: (req: {
      method?: string;
      url?: string;
      socket?: { remoteAddress?: string };
    }) => ({
      method: req.method,
      url: req.url,
      remoteAddress: req.socket?.remoteAddress,
    }),
  },

  // Timestamp format
  timestamp: pino.stdTimeFunctions.isoTime,
};

export const logger = pino(options);

// Create child loggers for specific components
export const connectionLogger = logger.child({
  component: "connection-manager",
});
export const authLogger = logger.child({ component: "auth" });
export const wsLogger = logger.child({ component: "websocket" });

// Log unhandled errors
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled rejection");
});

export default logger;
