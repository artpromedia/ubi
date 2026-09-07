/**
 * Authentication, the actor, and one error shape for the Bites routes.
 *
 * The gateway authenticates the caller and forwards who they are; this module
 * reads the actor from those headers and from nowhere else — a request body may
 * never name a user, a role or a city (CLAUDE.md #1). Every failure leaves as
 * `{ code, message, details? }` with the canonical code and its status, so a
 * client branches on `code`, never on a message.
 */
import { ZodError } from "zod";

import {
  ContractError,
  IDEMPOTENCY_HEADER,
  IdempotencyKeySchema,
} from "@ubi/contracts";

import { toContractError } from "./errors.js";
import { logger } from "./lib/logger.js";
import { isKnownRole } from "./roles.js";

import type { Actor } from "./lib/types.js";
import type { Context, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

declare module "hono" {
  interface ContextVariableMap {
    bitesActor: Actor;
  }
}

export async function gatewayAuth(c: Context, next: Next): Promise<void | Response> {
  const userId = c.req.header("X-User-ID");
  const role = c.req.header("X-User-Role");
  if (userId === undefined || userId.length === 0) {
    return c.json({ code: "unauthorized", message: "authentication required" }, 401);
  }
  if (role === undefined || !isKnownRole(role)) {
    return c.json(
      {
        code: "forbidden",
        message: "this role has no access to Bites",
        details: { role: role ?? null },
      },
      403,
    );
  }
  c.set("bitesActor", { id: userId, role });
  await next();
}

export function actorOf(c: Context): Actor {
  const actor = c.get("bitesActor");
  if (actor === undefined) {
    throw new ContractError("unauthorized", "authentication required");
  }
  return actor;
}

/**
 * The city the request belongs to. It arrives as a gateway header and is only
 * trusted once the config provider has proved the city exists and is live.
 */
export function cityOf(c: Context): string {
  const cityId = c.req.header("X-City-ID");
  if (cityId === undefined || cityId.length === 0) {
    throw new ContractError(
      "city_unsupported",
      "the request does not say which city it belongs to",
    );
  }
  return cityId;
}

export function idempotencyKeyOf(c: Context): string {
  const raw = c.req.header(IDEMPOTENCY_HEADER);
  const parsed = IdempotencyKeySchema.safeParse(raw);
  if (!parsed.success) {
    throw new ContractError(
      "validation_failed",
      `a valid ${IDEMPOTENCY_HEADER} header is required for this operation`,
    );
  }
  return parsed.data;
}

/** Ties an audit row and event back to the request that caused it. */
export function correlationIdOf(c: Context): string | null {
  return c.req.header("X-Request-ID") ?? null;
}

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

export function failure(c: Context, error: unknown): Response {
  if (error instanceof ZodError) {
    const validation = new ContractError("validation_failed", "the request is not valid", {
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return c.json(validation.toBody(), validation.status as ContentfulStatusCode);
  }
  const contract = toContractError(error);
  if (contract.code === "internal_error") {
    logger.error({ err: error }, "unhandled bites error");
  }
  return c.json(contract.toBody(), contract.status as ContentfulStatusCode);
}
