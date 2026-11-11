/**
 * Authentication, the actor, and one error shape for the Bites routes.
 *
 * The gateway authenticates the caller and signs `x-ubi-identity`; this module
 * verifies that signed context and reads the actor and city from it — plain
 * `X-User-ID` and `X-User-Role` headers are never trusted alone (CC-A12).
 */
import { ZodError, type z } from "zod";

import {
  ContractError,
  IDEMPOTENCY_HEADER,
  IdempotencyKeySchema,
} from "@ubi/contracts";

import { toContractError } from "./errors.js";
import { logger } from "./lib/logger.js";
import { isKnownRole } from "./roles.js";
import {
  IDENTITY_HEADER,
  identityVerificationKeys,
  verifyIdentityContext,
  type VerifiedIdentity,
} from "../lib/identity-context.js";

import type { Actor } from "./lib/types.js";
import type { Context, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

declare module "hono" {
  interface ContextVariableMap {
    bitesActor: Actor;
    bitesIdentity: VerifiedIdentity;
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
        message: "this role has no access to Bites",
        details: { role: identity.role },
      },
      403,
    );
  }
  c.set("bitesIdentity", identity);
  c.set("verifiedCityId", cityId);
  c.set("bitesActor", { id: identity.userId, role: normalizedRole });
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
 * The city the request belongs to. It arrives from the verified identity context
 * (or on public discovery routes as a gateway header) and is only trusted once
 * the config provider has proved the city exists and is live.
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

/** Ties an audit row and event back to the request that caused it. */
export function correlationIdOf(c: Context): string | null {
  return (
    c.req.header("X-Request-ID") ?? c.get("bitesIdentity")?.requestId ?? null
  );
}

export async function parseBody<T>(
  c: Context,
  schema: z.ZodType<T>,
): Promise<T> {
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

export function parseLimit(
  raw: string | undefined,
  fallback: number,
  max: number,
): number {
  if (raw === undefined) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ContractError(
      "validation_failed",
      "limit must be a positive integer",
    );
  }
  return Math.min(value, max);
}

export function failure(c: Context, error: unknown): Response {
  if (error instanceof ZodError) {
    const validation = new ContractError(
      "validation_failed",
      "the request is not valid",
      {
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    );
    return c.json(
      validation.toBody(),
      validation.status as ContentfulStatusCode,
    );
  }
  const contract = toContractError(error);
  if (contract.code === "internal_error") {
    logger.error({ err: error }, "unhandled bites error");
  }
  return c.json(contract.toBody(), contract.status as ContentfulStatusCode);
}
