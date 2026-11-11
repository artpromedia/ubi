/**
 * Authentication and the actor.
 *
 * The API gateway authenticates the caller and signs `x-ubi-identity`. This
 * service verifies that signed context and reads the actor and city from it:
 * plain `X-User-ID` and `X-User-Role` headers are never trusted alone (CC-A12).
 */
import {
  ContractError,
  IDEMPOTENCY_HEADER,
  IdempotencyKeySchema,
} from "@ubi/contracts";

import {
  IDENTITY_HEADER,
  identityVerificationKeys,
  verifyIdentityContext,
  type VerifiedIdentity,
} from "../lib/identity-context";
import { isKnownRole } from "../ops/roles";

import type { Actor } from "../ops/types";
import type { Context, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

declare module "hono" {
  interface ContextVariableMap {
    actor: Actor;
    identity: VerifiedIdentity;
    verifiedCityId: string | null;
  }
}

function resolveCity(c: Context, identity: VerifiedIdentity): string | null {
  const tokenCity = identity.cityId;
  const gatewayCity =
    c.req.header("x-ubi-city-id")?.trim() ||
    c.req.header("x-auth-city-id")?.trim() ||
    null;
  const declaredCity = c.req.header("X-City-ID")?.trim() || null;

  if (tokenCity !== null) {
    if (gatewayCity !== null && gatewayCity !== tokenCity) {
      throw new ContractError(
        "forbidden",
        "Gateway city header does not match token city",
        { reason: "city_mismatch" },
      );
    }
    if (declaredCity !== null && declaredCity !== tokenCity) {
      throw new ContractError(
        "forbidden",
        "X-City-ID does not match the authenticated session city",
        { reason: "city_mismatch" },
      );
    }
    return tokenCity;
  }
  return gatewayCity ?? declaredCity;
}

export async function gatewayAuth(
  c: Context,
  next: Next,
): Promise<void | Response> {
  const rawContext = c.req.header(IDENTITY_HEADER)?.trim();
  if (rawContext === undefined || rawContext.length === 0) {
    return c.json(
      { code: "unauthorized", message: "authentication required" },
      401,
    );
  }

  let identity: VerifiedIdentity;
  let cityId: string | null;
  try {
    identity = verifyIdentityContext(rawContext, identityVerificationKeys());
    cityId = resolveCity(c, identity);
  } catch (error) {
    if (error instanceof ContractError) {
      return c.json(error.toBody(), error.status as ContentfulStatusCode);
    }
    return c.json(
      { code: "unauthorized", message: "authentication required" },
      401,
    );
  }

  const normalizedRole = identity.role.toLowerCase();
  if (!isKnownRole(normalizedRole)) {
    return c.json(
      {
        code: "forbidden",
        message: "this role has no access to the support service",
        details: { role: identity.role },
      },
      403,
    );
  }

  c.set("identity", identity);
  c.set("verifiedCityId", cityId);
  c.set("actor", { id: identity.userId, role: normalizedRole });
  await next();
}

export function actorOf(c: Context): Actor {
  const actor = c.get("actor");
  if (actor === undefined) {
    throw new ContractError("unauthorized", "authentication required");
  }
  return actor;
}

/**
 * The city the request belongs to, resolved from the verified identity context
 * (and only accepted from `X-City-ID` when the token is cross-city or agrees).
 */
export function cityOf(c: Context): string {
  const cityId = c.get("verifiedCityId") ?? c.req.header("X-City-ID");
  if (cityId === undefined || cityId === null || cityId.length === 0) {
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

/** Ties an audit row back to the request that caused it. */
export function correlationIdOf(c: Context): string | null {
  return c.req.header("X-Request-ID") ?? c.get("identity")?.requestId ?? null;
}
