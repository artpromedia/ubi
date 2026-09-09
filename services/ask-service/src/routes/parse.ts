/**
 * Body parsing. A body that does not match the schema is a 422 with the failing
 * paths. Every request schema here is closed — the model never widens it.
 */
import { ContractError } from "@ubi/contracts";

import type { Context } from "hono";
import type { z } from "zod";

export async function parseBody<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
): Promise<z.output<S>> {
  const body: unknown = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ContractError(
      "validation_failed",
      "the request body is not valid",
      {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    );
  }
  return parsed.data;
}

/** Optional body: an empty/absent body is accepted and yields the schema default. */
export async function parseOptionalBody<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
): Promise<z.output<S>> {
  const raw: unknown = await c.req.json().catch(() => ({}));
  const body = raw === undefined || raw === null ? {} : raw;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ContractError(
      "validation_failed",
      "the request body is not valid",
      {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    );
  }
  return parsed.data;
}
