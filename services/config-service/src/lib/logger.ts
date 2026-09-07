/**
 * Structured logger. Never log request bodies, config payloads keyed by a
 * person, or any contact detail — CLAUDE.md #7 (no PII in logs).
 */
import { pino, stdSerializers } from "pino";

import { NODE_ENV } from "./env";

export const logger = pino({
  name: "config-service",
  level: process.env.LOG_LEVEL ?? (NODE_ENV === "test" ? "silent" : "info"),
  base: { service: "config-service", env: NODE_ENV },
  redact: {
    paths: [
      "email",
      "phone",
      "name",
      "token",
      "authorization",
      "password",
      "*.email",
      "*.phone",
      "*.name",
      "*.token",
      "*.authorization",
    ],
    censor: "[REDACTED]",
  },
  serializers: { err: stdSerializers.err },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export const cacheLogger = logger.child({ component: "cache" });
export const configLogger = logger.child({ component: "config" });
export const flagLogger = logger.child({ component: "flags" });
export const seedLogger = logger.child({ component: "seed" });
