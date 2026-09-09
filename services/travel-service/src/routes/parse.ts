/**
 * Body parsing helpers. Every body is validated with zod at the edge, so an
 * unexpected shape is refused with 422 and the failing path rather than reaching
 * a handler.
 */
import { ContractError } from "@ubi/contracts";

import type { Context } from "hono";
import type { z } from "zod";

export async function parseBody<T>(
  c: Context,
  schema: z.ZodType<T>,
): Promise<T> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ContractError("validation_failed", "a JSON body is required");
  }
  return schema.parse(body);
}
