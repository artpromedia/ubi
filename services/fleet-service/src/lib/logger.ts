/**
 * Structured logger for fleet-service.
 *
 * CLAUDE.md #12: no PII in logs. fleet-service handles driver PINs in transit
 * (relayed to user-service, never stored), driver names and free-text
 * maintenance notes, so the redaction list is broad and call sites log ids,
 * counts and codes — never request bodies.
 */
import { pino, stdSerializers } from "pino";

const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
const NODE_ENV = process.env.NODE_ENV ?? "development";

/** Field names that may never reach a log sink, at any nesting depth. */
const PII_FIELDS = [
  "pin",
  "firstName",
  "lastName",
  "displayName",
  "driverDisplayName",
  "name",
  "phone",
  "email",
  "note",
  "payload",
  "token",
  "authorization",
  "secret",
  "serviceKey",
] as const;

const redactPaths = PII_FIELDS.flatMap((field) => [
  field,
  `*.${field}`,
  `*.*.${field}`,
]);

export const logger = pino({
  name: "fleet-service",
  level: LOG_LEVEL,
  base: { service: "fleet-service", env: NODE_ENV },
  redact: { paths: redactPaths, censor: "[REDACTED]" },
  serializers: {
    err: stdSerializers.err,
    req: (req: { method?: string; url?: string }) => ({
      method: req.method,
      url: req.url,
    }),
    res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export const dbLogger = logger.child({ component: "database" });
export const redisLogger = logger.child({ component: "redis" });
export const rideLogger = logger.child({ component: "ride-port" });
export const pinLogger = logger.child({ component: "pin-port" });
export const workerLogger = logger.child({ component: "worker" });

export default logger;
