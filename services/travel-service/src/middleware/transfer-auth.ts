/**
 * Who is calling an airport-transfer route, and in which city.
 *
 * The transfer routes are the only travel routes whose caller identity is
 * re-presented to another service with a SIGNATURE: travel-service signs the
 * ride-service identity context (lib/ride-context.ts) as the traveller, for
 * the city the transfer was created in. What it signs must therefore be what
 * the gateway proved — never a plain header that anyone on the service network
 * could set — so these routes use the same trust model as ask-service, the
 * other delegated signer (services/ask-service/src/middleware/auth.ts):
 *
 *   - `x-ubi-identity` — the gateway-signed HS256 context (lib/identity-
 *     context.ts) — is AUTHORITATIVE whenever it is present, in every
 *     environment: it verifies and its claims win, or the request is refused
 *     (401). A missing or misconfigured UBI_IDENTITY_SECRET is an outage (503),
 *     never a reason to trust an unsigned header.
 *   - In PRODUCTION the signed context is REQUIRED: the plain `X-User-ID` /
 *     `X-User-Role` mirrors are refused (401).
 *   - In development and tests (no gateway in front) the plain mirrors are
 *     read, as the rest of travel-service does.
 *
 * The city follows the same rule: the gateway's own city claim (and the
 * mirrors it writes from the verified token, `x-auth-city-id` /
 * `x-ubi-city-id`) wins; `X-City-ID` is client-declared context the gateway
 * passes through, so it must agree with a verified city and is accepted alone
 * only outside production.
 *
 * And the marketplace rule: an airport transfer becomes a marketplace request
 * on ride-service, which the gateway allows only for sessions holding
 * `mp:request` (limited mode strips it). travel-service reaches ride-service
 * without passing the gateway's `/v1/mp` rule, so it applies that rule itself
 * on every action that makes, changes or cancels a ride.
 */
import { ContractError } from "@ubi/contracts";

import {
  IDENTITY_HEADER,
  identityVerificationKeys,
  verifyIdentityContext,
  type VerifiedIdentity,
} from "../lib/identity-context";
import { logger } from "../lib/logger";
import { isProductionEnvironment } from "../lib/ride-context";

import type { Context, Next } from "hono";

declare module "hono" {
  interface ContextVariableMap {
    /** The verified gateway context; absent only on the dev/test header path. */
    identity: VerifiedIdentity | undefined;
  }
}

/** The scope a session needs to act in the negotiated-fare marketplace. */
export const MARKETPLACE_SCOPE = "mp:request";

function unauthorized(c: Context): Response {
  return c.json(
    { code: "unauthorized", message: "authentication required" },
    401,
  );
}

function presentHeader(c: Context, name: string): string | undefined {
  const value = c.req.header(name)?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

/**
 * Sets the actor (and the verified identity) from the gateway's signed context
 * when present — required in production — otherwise, outside production only,
 * from the plain mirrors.
 */
export async function verifiedGatewayAuth(
  c: Context,
  next: Next,
): Promise<void | Response> {
  const signed = presentHeader(c, IDENTITY_HEADER);
  if (signed !== undefined) {
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
    c.set("actor", { id: identity.userId, role: identity.role });
    c.set("identity", identity);
    await next();
    return;
  }
  if (isProductionEnvironment(process.env.NODE_ENV)) {
    // Fail closed: only the gateway-signed context authenticates here.
    return unauthorized(c);
  }
  const userId = presentHeader(c, "X-User-ID");
  const role = presentHeader(c, "X-User-Role");
  if (userId === undefined || role === undefined) {
    return unauthorized(c);
  }
  c.set("actor", { id: userId, role });
  c.set("identity", undefined);
  await next();
}

/**
 * The request's city — the city flags are evaluated in and every ride-service
 * call for a transfer created here is signed for. Verified sources win and
 * must agree; a declared city alone is accepted only outside production.
 */
export function verifiedCityOf(c: Context): string {
  const claimed = c.get("identity")?.cityId ?? undefined;
  const signed = presentHeader(c, "x-auth-city-id");
  const mirrored = presentHeader(c, "x-ubi-city-id");
  const declared = presentHeader(c, "X-City-ID");
  const verifiedSources = [claimed, signed, mirrored].filter(
    (value): value is string => value !== undefined,
  );
  const verified = verifiedSources[0];
  if (verifiedSources.some((value) => value !== verified)) {
    throw new ContractError(
      "forbidden",
      "the request carries two different verified cities",
      { reason: "city_mismatch" },
    );
  }
  if (verified !== undefined) {
    if (declared !== undefined && declared !== verified) {
      throw new ContractError(
        "forbidden",
        "the declared city does not match your verified city",
        { reason: "city_mismatch" },
      );
    }
    return verified;
  }
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

/**
 * Refuses a ride action the gateway's scopes do not allow. With a verified
 * context, only when the gateway granted `mp:request`; without one (the
 * dev/test header path, never production) the flags alone decide.
 */
export function assertMarketplaceAllowed(c: Context): void {
  const identity = c.get("identity");
  if (identity === undefined) {
    if (isProductionEnvironment(process.env.NODE_ENV)) {
      throw new ContractError("unauthorized", "authentication required");
    }
    return;
  }
  if (identity.scopes.includes(MARKETPLACE_SCOPE)) {
    return;
  }
  throw identity.modes.includes("limited")
    ? new ContractError(
        "limited_mode",
        "This device is not verified yet. Finish the security check to arrange an airport ride.",
        { modes: [...identity.modes] },
      )
    : new ContractError(
        "forbidden",
        "This action is not available for your account type",
        { required: [MARKETPLACE_SCOPE] },
      );
}
