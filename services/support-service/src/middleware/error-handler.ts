/**
 * One error shape for the whole service.
 *
 * Every failure leaves here as `{ code, message, details? }` with the canonical
 * code and the status the contract assigns it, so a client can branch on `code`
 * and never on a message (packages/contracts/src/errors.ts).
 */
import { ContractError } from "@ubi/contracts";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

import { logger } from "../lib/logger";
import { toContractError } from "../ops/errors";

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
    return c.json(validation.toBody(), validation.status as ContentfulStatusCode);
  }

  const contract = toContractError(error);
  if (contract.code === "internal_error") {
    // Only the unmapped case is logged as an error, and only the error object —
    // request bodies are never logged (CLAUDE.md #12).
    logger.error({ err: error }, "unhandled support-service error");
  }
  return c.json(contract.toBody(), contract.status as ContentfulStatusCode);
}
