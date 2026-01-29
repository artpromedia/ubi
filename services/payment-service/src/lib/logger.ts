/**
 * Structured Logger for Payment Service
 *
 * Uses pino for high-performance JSON logging.
 * Configured for production-ready logging with proper log levels.
 */

import { pino, stdSerializers } from "pino";

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
    err: stdSerializers.err,
    req: (req: {
      method?: string;
      url?: string;
      socket?: { remoteAddress?: string };
    }) => ({
      method: req.method,
      url: req.url,
      remoteAddress: req.socket?.remoteAddress,
    }),
    res: (res: { statusCode?: number }) => ({
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

// Additional component loggers
export const dbLogger = logger.child({ component: "database" });
export const redisLogger = logger.child({ component: "redis" });
export const momoLogger = logger.child({ component: "momo" });
export const mpesaLogger = logger.child({ component: "mpesa" });
export const paystackLogger = logger.child({ component: "paystack" });
export const payoutLogger = logger.child({ component: "payout" });
export const safetyLogger = logger.child({ component: "safety" });
export const bgCheckLogger = logger.child({ component: "background-check" });
export const reconciliationLogger = logger.child({
  component: "reconciliation",
});
export const jobsLogger = logger.child({ component: "jobs" });
export const verificationLogger = logger.child({ component: "verification" });
export const sosLogger = logger.child({ component: "sos" });
export const tripMonitorLogger = logger.child({ component: "trip-monitor" });
export const womenSafetyLogger = logger.child({ component: "women-safety" });
export const p2pLogger = logger.child({ component: "p2p" });
export const settlementLogger = logger.child({ component: "settlement" });
export const securityLogger = logger.child({ component: "security" });
export const notificationLogger = logger.child({ component: "notification" });
export const mobileMoneyLogger = logger.child({ component: "mobile-money" });
export const loanLogger = logger.child({ component: "loans" });
export const savingsLogger = logger.child({ component: "savings" });
export const billsLogger = logger.child({ component: "bills" });
export const cardsLogger = logger.child({ component: "cards" });
export const subscriptionLogger = logger.child({ component: "subscription" });
export const remittanceLogger = logger.child({ component: "remittance" });
export const splitFareLogger = logger.child({ component: "split-fare" });
export const vehicleFinancingLogger = logger.child({
  component: "vehicle-financing",
});
export const telebirrLogger = logger.child({ component: "telebirr" });
export const orangeMoneyLogger = logger.child({ component: "orange-money" });

// Log unhandled errors
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled rejection");
});

export default logger;
