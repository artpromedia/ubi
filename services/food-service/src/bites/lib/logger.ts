/**
 * Loggers for the Bites module.
 *
 * CLAUDE.md #12: no PII in logs. Call sites log ids, amounts and counts — never
 * a customer name, address, phone or the free text of an issue. These children
 * hang off the shared food-service logger so Bites logs carry the same service
 * name and redaction as the rest of the service.
 */
import { createChildLogger, type Logger } from "@ubi/logger";

import { logger as baseLogger } from "../../lib/logger.js";

export const logger: Logger = createChildLogger(baseLogger, {
  module: "bites",
});
export const orderLogger: Logger = createChildLogger(logger, {
  component: "orders",
});
export const merchantLogger: Logger = createChildLogger(logger, {
  component: "merchants",
});
export const paymentLogger: Logger = createChildLogger(logger, {
  component: "payment-port",
});

export default logger;
