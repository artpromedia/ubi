/**
 * Every failure leaves this service as a canonical error body
 * ({ code, message, details }) with the status `@ubi/contracts` assigns to that
 * code. Clients branch on `code`, never on message text.
 */
import { ContractError, type ErrorBody } from "@ubi/contracts";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

import { logger } from "../lib/logger";

function bodyFor(error: unknown): { body: ErrorBody; status: number } {
  if (error instanceof ContractError) {
    return { body: error.toBody(), status: error.status };
  }
  if (error instanceof ZodError) {
    const validation = new ContractError("validation_failed", "request failed validation", {
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return { body: validation.toBody(), status: validation.status };
  }
  const internal = new ContractError("internal_error", "an unexpected error occurred");
  return { body: internal.toBody(), status: internal.status };
}

export function errorHandler(error: unknown, c: Context): Response {
  const { body, status } = bodyFor(error);
  if (status >= 500) {
    logger.error({ err: error, path: c.req.path, code: body.code }, "request failed");
  } else {
    logger.info({ path: c.req.path, code: body.code, status }, "request rejected");
  }
  return c.json(body, status as ContentfulStatusCode);
}
