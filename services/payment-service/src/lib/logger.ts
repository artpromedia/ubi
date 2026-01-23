/**
 * Structured Logger for Payment Service
 *
 * Uses pino for high-performance JSON logging.
 * Configured for production-ready logging with proper log levels.
 */

import pino from "pino";

const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const NODE_ENV = process.env.NODE_ENV || "development";

export const logger = pino({
  name: "payment-service",
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
    service: "payment-service",
    env: NODE_ENV,
  },

  // Redact sensitive fields
  redact: {
    paths: [
      "password",
      "token",
      "secret",
      "authorization",
      "apiKey",
      "api_key",
      "cardNumber",
      "cvv",
      "pin",
      "*.password",
      "*.token",
      "*.secret",
      "*.apiKey",
      "*.cardNumber",
      "*.cvv",
      "*.pin",
    ],
    censor: "[REDACTED]",
  },

  // Custom serializers
  serializers: {
    err: pino.stdSerializers.err,
    req: (req) => ({
      method: req.method,
      url: req.url,
      remoteAddress: req.socket?.remoteAddress,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },

  // Timestamp format
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Create child loggers for specific components
export const paymentLogger = logger.child({ component: "payment" });
export const walletLogger = logger.child({ component: "wallet" });
export const fraudLogger = logger.child({ component: "fraud" });
export const webhookLogger = logger.child({ component: "webhook" });
export const driverLogger = logger.child({ component: "driver" });

// Log unhandled errors
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled rejection");
});

export default logger;
