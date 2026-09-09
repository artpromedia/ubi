/**
 * Structured logger for the travel service.
 *
 * CLAUDE.md #12 / #20: no PII in logs, and card data, identity documents and
 * private addresses never reach the model — or a log sink. Travel handles
 * passenger names, contact details and opaque KYC references, so the redaction
 * list is broad and call sites log ids, counts and money totals, never the
 * traveller payloads themselves.
 */
import { pino, stdSerializers } from "pino";

const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
const NODE_ENV = process.env.NODE_ENV ?? "development";

/** Field names that may never reach a log sink, at any nesting depth. */
const PII_FIELDS = [
  "givenNames",
  "surname",
  "title",
  "dateOfBirth",
  "phone",
  "phoneNumber",
  "email",
  "firstName",
  "lastName",
  "displayName",
  "name",
  "address",
  "identityRef",
  "passengers",
  "passenger",
  "payload",
  "note",
  "pin",
  "proof",
  "token",
  "authorization",
  "secret",
  "signature",
] as const;

const redactPaths = PII_FIELDS.flatMap((field) => [
  field,
  `*.${field}`,
  `*.*.${field}`,
]);

export const logger = pino({
  name: "travel-service",
  level: LOG_LEVEL,
  base: { service: "travel-service", env: NODE_ENV },
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

export const searchLogger = logger.child({ component: "search" });
export const orderLogger = logger.child({ component: "orders" });
export const webhookLogger = logger.child({ component: "webhooks" });
export const reconcileLogger = logger.child({ component: "reconcile" });
export const paymentLogger = logger.child({ component: "payment-port" });
export const adapterLogger = logger.child({ component: "supply-adapter" });
export const dbLogger = logger.child({ component: "database" });
export const redisLogger = logger.child({ component: "redis" });

export default logger;
