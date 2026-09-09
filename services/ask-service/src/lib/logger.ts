/**
 * Structured logger for the ask service.
 *
 * CLAUDE.md #12 and rule #20: no PII, no card data, no PINs, no identity
 * documents, no precise addresses and no hidden model reasoning in logs. The
 * assistant handles free text a person typed, so the redaction list is broad and
 * the call sites log ids and counts, never the payloads themselves. Anything a
 * future call site might forget is censored here as a backstop.
 */
import { pino, stdSerializers } from "pino";

const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
const NODE_ENV = process.env.NODE_ENV ?? "development";

/** Field names that may never reach a log sink, at any nesting depth. */
const SENSITIVE_FIELDS = [
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
  "text",
  "message",
  "body",
  "prompt",
  "reasoning",
  "completion",
  "transcript",
  "pin",
  "pan",
  "cardNumber",
  "cvv",
  "proof",
  "token",
  "authorization",
  "secret",
  "apiKey",
] as const;

const redactPaths = SENSITIVE_FIELDS.flatMap((field) => [
  field,
  `*.${field}`,
  `*.*.${field}`,
]);

export const logger = pino({
  name: "ask-service",
  level: LOG_LEVEL,
  base: { service: "ask-service", env: NODE_ENV },
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

export const threadLogger = logger.child({ component: "threads" });
export const reviewLogger = logger.child({ component: "reviews" });
export const executionLogger = logger.child({ component: "executions" });
export const modelLogger = logger.child({ component: "model" });
export const toolLogger = logger.child({ component: "tools" });
export const dbLogger = logger.child({ component: "database" });
export const redisLogger = logger.child({ component: "redis" });

export default logger;
