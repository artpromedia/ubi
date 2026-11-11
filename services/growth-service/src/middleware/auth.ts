/**
 * Authentication, the actor, the city, and scope checks — for EVERY growth
 * route (CC-A12 / P2-10; docs/security/INTERNAL_IDENTITY.md).
 *
 * TRUST MODEL:
 *  - `x-ubi-identity` — the gateway-signed HS256 context — is REQUIRED and
 *    AUTHORITATIVE: it must verify with `UBI_IDENTITY_SECRET` (or
 *    `UBI_IDENTITY_SECRET_PREVIOUS`) and its claims (`sub`, `role`, `city`,
 *    `scp`) win over every plain mirror (`X-User-ID`, `X-User-Role`,
 *    `X-City-ID`), or the request is refused (401/403).
 *  - Plain `X-User-ID` / `X-User-Role` headers are NEVER trusted alone: a
 *    forged `X-User-ID` cannot impersonate a second person to approve a
 *    campaign (`approver != author`).
 *  - A missing or misconfigured `UBI_IDENTITY_SECRET` is an outage (503),
 *    never a reason to trust an unsigned header — and in production it is a
 *    refusal to boot (`index.ts`).
 */
import {
  ContractError,
  IDEMPOTENCY_HEADER,
  IdempotencyKeySchema,
} from "@ubi/contracts";

import { isProductionEnvironment } from "../lib/env";
import {
  IDENTITY_HEADER,
  identityVerificationKeys,
  verifyIdentityContext,
  type VerifiedIdentity,
} from "../lib/identity-context";
import { logger } from "../lib/logger";
import { isKnownRole } from "../ops/roles";

import type { Actor } from "../ops/types";
import type { Context, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

declare module "hono" {
  interface ContextVariableMap {
    actor: Actor;
    identity: VerifiedIdentity;
  }
}

function presentHeader(c: Context, name: string): string | undefined {
  const value = c.req.header(name)?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function unauthorized(c: Context): Response {
  return c.json(
    { code: "unauthorized", message: "authentication required" },
    401,
  );
}

function cityMismatch(message: string): ContractError {
  return new ContractError("forbidden", message, { reason: "city_mismatch" });
}

/**
 * The city the gateway vouched for, or undefined when it vouched for none.
 * Throws `forbidden` (reason `city_mismatch`) when the sources disagree.
 */
function verifiedCity(c: Context): string | undefined {
  const identity = c.get("identity");
  const signed = presentHeader(c, "x-auth-city-id");
  const mirrored = presentHeader(c, "x-ubi-city-id");
  const declared = presentHeader(c, "X-City-ID");
  const mirrors = [signed, mirrored].filter(
    (value): value is string => value !== undefined,
  );
  const verified = identity.cityId ?? undefined;
  if (verified !== undefined && mirrors.some((value) => value !== verified)) {
    throw cityMismatch("the request carries two different verified cities");
  }
  if (
    verified !== undefined &&
    declared !== undefined &&
    declared !== verified
  ) {
    throw cityMismatch("the declared city does not match your verified city");
  }
  return verified;
}

function assertGrowthScopes(c: Context, identity: VerifiedIdentity): void {
  const path = c.req.path;
  if (path.startsWith("/v1/growth")) {
    if (!identity.scopes.includes("growth:admin")) {
      throw new ContractError(
        "forbidden",
        "this request requires growth:admin scope",
        { reason: "missing_scope", requiredScopes: ["growth:admin"] },
      );
    }
    return;
  }
  if (path.startsWith("/v1/ai/marketing")) {
    if (
      identity.role !== "marketing_ai" &&
      !identity.scopes.includes("growth:admin")
    ) {
      throw new ContractError(
        "forbidden",
        "this request requires marketing or growth:admin authority",
        { reason: "missing_scope", requiredScopes: ["growth:admin"] },
      );
    }
    return;
  }
  if (
    !identity.scopes.includes("profile:read") &&
    !identity.scopes.includes("growth:read")
  ) {
    throw new ContractError(
      "forbidden",
      "this request requires profile:read scope",
      { reason: "missing_scope", requiredScopes: ["profile:read"] },
    );
  }
}

export async function gatewayAuth(
  c: Context,
  next: Next,
): Promise<void | Response> {
  const signed = presentHeader(c, IDENTITY_HEADER);
  if (signed === undefined) {
    return unauthorized(c);
  }

  let keys: readonly Buffer[];
  try {
    keys = identityVerificationKeys(process.env);
  } catch (error) {
    logger.error(
      { err: error },
      "the gateway identity cannot be verified: UBI_IDENTITY_SECRET is not usable",
    );
    return c.json(
      {
        code: "service_unavailable",
        message: "identity could not be verified; please try again",
      },
      503,
    );
  }

  let identity: VerifiedIdentity;
  try {
    identity = verifyIdentityContext(signed, keys);
  } catch {
    return unauthorized(c);
  }

  if (!isKnownRole(identity.role)) {
    return c.json(
      {
        code: "forbidden",
        message: "this role has no access to the growth service",
        details: { role: identity.role },
      },
      403,
    );
  }

  c.set("actor", { id: identity.userId, role: identity.role });
  c.set("identity", identity);

  try {
    verifiedCity(c);
    assertGrowthScopes(c, identity);
  } catch (error) {
    if (error instanceof ContractError) {
      return c.json(error.toBody(), error.status as ContentfulStatusCode);
    }
    throw error;
  }

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
 * The city the request belongs to: the verified city from `x-ubi-identity`
 * (or, outside production when the token is cityless, a declared `X-City-ID`).
 */
export function cityOf(c: Context): string {
  const verified = verifiedCity(c);
  if (verified !== undefined) {
    return verified;
  }
  const declared = presentHeader(c, "X-City-ID");
  if (
    declared !== undefined &&
    !isProductionEnvironment(process.env.NODE_ENV)
  ) {
    return declared;
  }
  throw new ContractError(
    "city_unsupported",
    "the request does not say which city it belongs to",
  );
}

export function optionalCityOf(c: Context): string | null {
  const verified = verifiedCity(c);
  if (verified !== undefined) {
    return verified;
  }
  if (!isProductionEnvironment(process.env.NODE_ENV)) {
    return presentHeader(c, "X-City-ID") ?? null;
  }
  return null;
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
  const identity = c.get("identity");
  return identity?.requestId ?? c.req.header("X-Request-ID") ?? null;
}
