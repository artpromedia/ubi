/**
 * Authentication and the actor.
 *
 * The API gateway authenticates the caller and forwards who they are. This
 * service reads the actor from those headers and from nowhere else: a request
 * body, a tool argument or model text may never name a user, a role or a city
 * (CLAUDE.md #1; rule #18 — actor, role and ownership come from the gateway
 * identity context, never from tool args or model output).
 */
import {
  ContractError,
  IDEMPOTENCY_HEADER,
  IdempotencyKeySchema,
} from "@ubi/contracts";

import { isAskRole } from "../ops/types";

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
  if (role === undefined || !isAskRole(role)) {
    // The assistant serves riders and drivers. Any other role gets no access;
    // saying so is clearer than a deny on every individual tool.
    return c.json(
      {
        code: "forbidden",
        message: "this role has no access to the assistant",
        details: { role: role ?? null },
      },
      403,
    );
  }
  c.set("actor", { id: userId, role });
  await next();
}

/** Ops endpoints (`/v1/ops/ai/*`) are admin-only; end-user roles never reach them. */
export async function adminAuth(
  c: Context,
  next: Next,
): Promise<void | Response> {
  const userId = c.req.header("X-User-ID");
  const role = c.req.header("X-User-Role");
  const ADMIN_ROLES = ["ops_admin", "ai_ops", "growth_admin"];
  if (userId === undefined || userId.length === 0) {
    return c.json(
      { code: "unauthorized", message: "authentication required" },
      401,
    );
  }
  if (role === undefined || !ADMIN_ROLES.includes(role)) {
    return c.json(
      { code: "forbidden", message: "admin access required" },
      403,
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

/** The city the request belongs to, from the gateway header. */
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

/** Ties an ai_actions row back to the request that caused it. */
export function correlationIdOf(c: Context): string | null {
  return c.req.header("X-Request-ID") ?? null;
}
