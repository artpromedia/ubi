/**
 * Authentication and the actor.
 *
 * The API gateway authenticates the caller and forwards who they are. This
 * service reads the actor from those headers and from nowhere else: a request
 * body may not name a user, a role or a city (CLAUDE.md #1 — the server is
 * authoritative).
 */
import {
  ContractError,
  IDEMPOTENCY_HEADER,
  IdempotencyKeySchema,
} from "@ubi/contracts";

import type { Actor } from "../ops/types";
import type { Context, Next } from "hono";

declare module "hono" {
  interface ContextVariableMap {
    actor: Actor;
  }
}

export async function gatewayAuth(
  c: Context,
  next: Next,
): Promise<void | Response> {
  const userId = c.req.header("X-User-ID");
  const role = c.req.header("X-User-Role");
  if (userId === undefined || userId.length === 0) {
    return c.json(
      { code: "unauthorized", message: "authentication required" },
      401,
    );
  }
  if (role === undefined || role.length === 0) {
    return c.json(
      { code: "unauthorized", message: "authentication required" },
      401,
    );
  }
  c.set("actor", { id: userId, role });
  await next();
}

export function actorOf(c: Context): Actor {
  const actor = c.get("actor");
  if (actor === undefined) {
    throw new ContractError("unauthorized", "authentication required");
  }
  return actor;
}

/** The city the request belongs to; it arrives as a gateway header. */
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

/** Ties an event back to the request that caused it. */
export function correlationIdOf(c: Context): string | null {
  return c.req.header("X-Request-ID") ?? null;
}
