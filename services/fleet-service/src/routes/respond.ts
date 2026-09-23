/**
 * The one way a fleet-service route answers.
 *
 * Every body is parsed through its contract schema (packages/contracts/src/
 * fleet.ts) on the way OUT. zod object parsing drops every key the schema
 * does not declare, so a field that is not part of the fleet contract — a
 * rider, a location, a fare, a driver's net — cannot reach a response even if
 * an upstream or a future row grew one. A body that does not satisfy its
 * schema is a server bug and answers 500, never a half-checked payload.
 *
 * State-changing requests go through `idempotentResponse`: the scoped
 * Idempotency-Key record answers a replay verbatim (ops/idempotency.ts).
 */
import { ContractError } from "@ubi/contracts";

import { actorOf, idempotencyKeyOf } from "../middleware/auth";
import { failure } from "../middleware/error-handler";
import { idempotent } from "../ops/idempotency";

import type { FleetDeps } from "../ops/context";
import type { JsonValue } from "../ops/types";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodType, ZodTypeDef } from "zod";

export function shape<T>(
  schema: ZodType<T, ZodTypeDef, unknown>,
  body: unknown,
): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ContractError(
      "internal_error",
      "the response did not match its contract",
      {
        issues: parsed.error.issues
          .slice(0, 5)
          .map((issue) => issue.path.join(".")),
      },
    );
  }
  return parsed.data;
}

export function respond<T>(
  c: Context,
  schema: ZodType<T, ZodTypeDef, unknown>,
  body: unknown,
  status: ContentfulStatusCode = 200,
): Response {
  return c.json(shape(schema, body) as never, status);
}

/** A route handler that answers every failure in the canonical error shape. */
export function route(
  work: (c: Context) => Promise<Response>,
): (c: Context) => Promise<Response> {
  return async (c: Context): Promise<Response> => {
    try {
      return await work(c);
    } catch (error) {
      return failure(c, error);
    }
  };
}

export async function idempotentResponse(
  c: Context,
  deps: FleetDeps,
  operation: string,
  payload: unknown,
  run: (scopedKey: string) => Promise<{ status: number; body: unknown }>,
): Promise<Response> {
  const key = idempotencyKeyOf(c);
  const actor = actorOf(c);
  const outcome = await idempotent(
    deps.db,
    { operation, actorId: actor.id, key, payload },
    async (scopedKey) => {
      const result = await run(scopedKey);
      return { status: result.status, body: result.body as JsonValue };
    },
  );
  return c.json(outcome.body as never, outcome.status as ContentfulStatusCode);
}

export async function jsonBody(c: Context): Promise<unknown> {
  try {
    return (await c.req.json()) as unknown;
  } catch {
    return {};
  }
}
