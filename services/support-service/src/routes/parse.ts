import { ContractError } from "@ubi/contracts";

import type { Context } from "hono";
import type { z } from "zod";

/**
 * Body parsing. A body that does not match the schema is a 422 with the failing
 * paths — the typed remedies, the six review queues and the four decisions are
 * all zod enums, so anything outside those closed sets is refused here before it
 * reaches a handler.
 */
export async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const body: unknown = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ContractError("validation_failed", "the request body is not valid", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

export function parseLimit(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ContractError("validation_failed", "limit must be a positive integer");
  }
  return Math.min(value, max);
}
