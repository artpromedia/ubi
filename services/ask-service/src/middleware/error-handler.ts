/**
 * One error shape for the whole service.
 *
 * Every failure leaves here as `{ code, message, details? }` with the canonical
 * code and the status the contract assigns it, so a client can branch on `code`
 * and never on a message (packages/contracts/src/errors.ts).
 */
import { ZodError } from "zod";

import { ContractError } from "@ubi/contracts";

import { logger } from "../lib/logger";
import { toContractError } from "../ops/errors";

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function failure(c: Context, error: unknown): Response {
  if (error instanceof ZodError) {
    const validation = new ContractError(
      "validation_failed",
      "the request is not valid",
      {
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    );
    return c.json(
      validation.toBody(),
      validation.status as ContentfulStatusCode,
    );
  }

  const contract = toContractError(error);
  if (contract.code === "internal_error") {
    // Only the unmapped case is logged, and only the error object — request
    // bodies and model text are never logged (CLAUDE.md #12, rule #20).
    logger.error({ err: error }, "unhandled ask-service error");
  }
  return c.json(contract.toBody(), contract.status as ContentfulStatusCode);
}
