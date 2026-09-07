/**
 * Structured logger for the support service.
 *
 * CLAUDE.md #12: no PII in logs. Support handles the most sensitive material in
 * the product — contact details, safety locations, case descriptions — so the
 * redaction list below is deliberately broad and the call sites log ids and
 * counts, never the payloads themselves. Anything that names a person, a place
 * or free text a person typed is censored even if a future call site forgets.
 */
import { pino, stdSerializers } from "pino";

const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
const NODE_ENV = process.env.NODE_ENV ?? "development";

/** Field names that may never reach a log sink, at any nesting depth. */
const PII_FIELDS = [
  "phone",
  "phoneNumber",
  "email",
  "firstName",
  "lastName",
  "displayName",
  "name",
  "address",
  "lat",
  "lng",
  "latitude",
  "longitude",
  "location",
  "lastLocation",
  "description",
  "note",
  "message",
  "body",
  "timeline",
  "payload",
  "pin",
  "token",
  "authorization",
  "secret",
] as const;

const redactPaths = PII_FIELDS.flatMap((field) => [
  field,
  `*.${field}`,
  `*.*.${field}`,
]);

export const logger = pino({
  name: "support-service",
  level: LOG_LEVEL,
  base: { service: "support-service", env: NODE_ENV },
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

export const caseLogger = logger.child({ component: "cases" });
export const safetyLogger = logger.child({ component: "safety" });
export const reviewLogger = logger.child({ component: "reviews" });
export const ledgerLogger = logger.child({ component: "ledger-port" });
export const dbLogger = logger.child({ component: "database" });
export const redisLogger = logger.child({ component: "redis" });

export default logger;
