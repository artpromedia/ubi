/**
 * One error shape for the whole service: `{ code, message, details? }` with
 * the canonical (or fleet) code and its status, so a client branches on
 * `code`, never on a message.
 */
import { ZodError } from "zod";

import { ContractError } from "@ubi/contracts";

import { logger } from "../lib/logger";
import { FleetError, toContractError } from "../ops/errors";
import { RideUnavailableError } from "../ports/ride-port";

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
  if (error instanceof FleetError) {
    return c.json(error.toBody(), error.status as ContentfulStatusCode);
  }
  if (error instanceof RideUnavailableError) {
    const unavailable = new ContractError(
      "service_unavailable",
      "the booking calendar is unavailable right now; nothing was changed. Please try again.",
      { dependency: "ride-service", operation: error.operation },
    );
    return c.json(unavailable.toBody(), 503);
  }
  const contract = toContractError(error);
  if (contract.code === "internal_error") {
    // The error object only — request bodies are never logged (CLAUDE.md #12).
    logger.error({ err: error }, "unhandled fleet-service error");
  }
  return c.json(contract.toBody(), contract.status as ContentfulStatusCode);
}
