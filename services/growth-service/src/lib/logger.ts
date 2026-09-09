/**
 * Structured logger for the growth service.
 *
 * CLAUDE.md #12: no PII in logs. This service handles referral relationships,
 * campaign audiences and abuse signals, so the redaction list is broad and the
 * call sites log ids, amounts and counts — never names, contact details or the
 * free-text copy a marketer typed. Anything that could name a person is censored
 * even if a future call site forgets.
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
  "initials",
  "address",
  "copy",
  "text",
  "message",
  "body",
  "note",
  "reason",
  "payload",
  "token",
  "code",
  "authorization",
  "secret",
] as const;

const redactPaths = PII_FIELDS.flatMap((field) => [
  field,
  `*.${field}`,
  `*.*.${field}`,
]);

export const logger = pino({
  name: "growth-service",
  level: LOG_LEVEL,
  base: { service: "growth-service", env: NODE_ENV },
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

export const campaignLogger = logger.child({ component: "campaigns" });
export const promotionLogger = logger.child({ component: "promotions" });
export const referralLogger = logger.child({ component: "referrals" });
export const incentiveLogger = logger.child({ component: "incentives" });
export const ledgerLogger = logger.child({ component: "ledger-port" });
export const dbLogger = logger.child({ component: "database" });
export const redisLogger = logger.child({ component: "redis" });

export default logger;
