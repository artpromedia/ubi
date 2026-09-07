/**
 * HTTP plumbing shared by the identity routes.
 *
 * Handlers throw `ContractError` from @ubi/contracts; `contractRoute` turns
 * that into the canonical body `{ code, message, details }` with the status the
 * contract assigns. Clients branch on `code`, never on message text, so copy
 * can change without changing behaviour.
 */
import { ContractError, IDEMPOTENCY_HEADER, IdempotencyKeySchema } from "@ubi/contracts";
import type { Context } from "hono";
import { z } from "zod";

import { authLogger } from "../lib/logger.js";

export type IdentityHandler = (c: Context) => Promise<Response>;

export function contractRoute(handler: IdentityHandler): IdentityHandler {
  return async (c: Context): Promise<Response> => {
    try {
      return await handler(c);
    } catch (error) {
      if (error instanceof ContractError) {
        return c.json({ success: false, error: error.toBody() }, error.status as 400);
      }
      if (error instanceof z.ZodError) {
        return c.json(
          {
            success: false,
            error: {
              code: "validation_failed",
              message: "Request validation failed",
              details: {
                issues: error.errors.map((issue) => ({
                  path: issue.path.join("."),
                  message: issue.message,
                })),
              },
            },
          },
          422,
        );
      }
      // Path and status only. Nothing from the request body reaches the log.
      authLogger.error(
        { err: error, path: c.req.path, method: c.req.method },
        "Identity request failed",
      );
      return c.json(
        {
          success: false,
          error: { code: "internal_error", message: "An unexpected error occurred" },
        },
        500,
      );
    }
  };
}

export function ok(c: Context, data: unknown, status: 200 | 201 = 200): Response {
  return c.json({ success: true, data }, status);
}

/** Every mutating POST carries one (CLAUDE.md #3). */
export function requireIdempotencyKey(c: Context): string {
  const raw = c.req.header(IDEMPOTENCY_HEADER);
  if (raw === undefined) {
    throw new ContractError(
      "validation_failed",
      `${IDEMPOTENCY_HEADER} header is required`,
    );
  }
  const parsed = IdempotencyKeySchema.safeParse(raw);
  if (!parsed.success) {
    throw new ContractError("validation_failed", "Idempotency-Key is not in a usable form");
  }
  return parsed.data;
}

export async function parseBody<Out>(
  c: Context,
  schema: z.ZodType<Out, z.ZodTypeDef, unknown>,
): Promise<Out> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ContractError("validation_failed", "Request body must be JSON");
  }
  return schema.parse(raw);
}
