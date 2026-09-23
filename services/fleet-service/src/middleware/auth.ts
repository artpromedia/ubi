/**
 * Authentication, the actor and the city — for EVERY fleet client route.
 *
 * TRUST MODEL (travel-service's and ask-service's; docs/security/
 * INTERNAL_IDENTITY.md):
 *   - `x-ubi-identity` — the gateway-signed HS256 context — is AUTHORITATIVE
 *     whenever it is present, in every environment: it verifies and its
 *     claims win over every plain mirror, or the request is refused (401).
 *     A missing or misconfigured UBI_IDENTITY_SECRET is an outage (503),
 *     never a reason to trust an unsigned header — and in production it is a
 *     refusal to boot (index.ts).
 *   - In PRODUCTION the signed context is REQUIRED.
 *   - In development and tests (no gateway in front) the plain `X-User-ID` /
 *     `X-User-Role` mirrors are read: the documented UNSIGNED DEVELOPMENT
 *     MODE, decided by NODE_ENV alone.
 *
 * THE CITY: the verified context's city claim, and the mirrors the gateway
 * writes from it (`x-auth-city-id`, `x-ubi-city-id`), are authoritative; a
 * client-declared `X-City-ID` that disagrees is refused (403 `city_mismatch`)
 * before any handler runs. The city decides the `fleet` flag, the currency
 * and the remittance cap — so a fleet request never runs on a city the
 * gateway did not vouch for (production accepts no declared-only city).
 *
 * THE SCOPES the gateway signed are re-checked (./scopes.ts), and the
 * verified context is made available to the PIN relay for the lifetime of
 * this request only (lib/identity-relay.ts).
 */
import {
  ContractError,
  IDEMPOTENCY_HEADER,
  IdempotencyKeySchema,
} from "@ubi/contracts";

import { assertFleetScopes } from "./scopes";
import { isProductionEnvironment } from "../lib/env";
import {
  IDENTITY_HEADER,
  identityVerificationKeys,
  verifyIdentityContext,
  type VerifiedIdentity,
} from "../lib/identity-context";
import {
  runWithIdentityRelay,
  type IdentityRelay,
} from "../lib/identity-relay";
import { logger } from "../lib/logger";

import type { Actor } from "../ops/types";
import type { Context, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

declare module "hono" {
  interface ContextVariableMap {
    actor: Actor;
    /** The verified gateway context; absent only on the dev/test header path. */
    identity: VerifiedIdentity | undefined;
  }
}

type Resolved =
  | {
      readonly kind: "ok";
      readonly actor: Actor;
      readonly identity?: VerifiedIdentity;
      readonly token?: string;
    }
  | { readonly kind: "refused"; readonly response: Response };

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

function resolveCaller(c: Context): Resolved {
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
      return {
        kind: "refused",
        response: c.json(
          {
            code: "service_unavailable",
            message: "identity could not be verified; please try again",
          },
          503,
        ),
      };
    }
    try {
      const identity = verifyIdentityContext(signed, keys);
      return {
        kind: "ok",
        actor: { id: identity.userId, role: identity.role },
        identity,
        token: signed,
      };
    } catch {
      return { kind: "refused", response: unauthorized(c) };
    }
  }
  if (isProductionEnvironment(process.env.NODE_ENV)) {
    return { kind: "refused", response: unauthorized(c) };
  }
  const userId = presentHeader(c, "X-User-ID");
  const role = presentHeader(c, "X-User-Role");
  if (userId === undefined || role === undefined) {
    return { kind: "refused", response: unauthorized(c) };
  }
  return { kind: "ok", actor: { id: userId, role } };
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
  const verified =
    identity === undefined ? mirrors[0] : (identity.cityId ?? undefined);
  if (mirrors.some((value) => value !== verified)) {
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

/**
 * Sets the actor and the verified identity, refuses a request whose cities
 * disagree or whose signed scopes do not allow it, and runs the rest of the
 * request inside the identity-relay scope.
 */
export async function gatewayAuth(
  c: Context,
  next: Next,
): Promise<void | Response> {
  const caller = resolveCaller(c);
  if (caller.kind === "refused") {
    return caller.response;
  }
  c.set("actor", caller.actor);
  c.set("identity", caller.identity);
  try {
    verifiedCity(c);
    assertFleetScopes(c);
  } catch (error) {
    if (error instanceof ContractError) {
      return c.json(error.toBody(), error.status as ContentfulStatusCode);
    }
    throw error;
  }
  const relay: IdentityRelay =
    caller.identity !== undefined && caller.token !== undefined
      ? {
          kind: "signed",
          token: caller.token,
          userId: caller.identity.userId,
          cityId: caller.identity.cityId,
          requestId: caller.identity.requestId,
        }
      : {
          kind: "unsigned",
          userId: caller.actor.id,
          role: caller.actor.role,
          cityId: presentHeader(c, "X-City-ID") ?? null,
          requestId: presentHeader(c, "X-Request-ID") ?? null,
        };
  await runWithIdentityRelay(relay, async () => {
    await next();
  });
  return undefined;
}

export function actorOf(c: Context): Actor {
  const actor = c.get("actor");
  if (actor === undefined) {
    throw new ContractError("unauthorized", "authentication required");
  }
  return actor;
}

/**
 * The request's city: the verified one, or — outside production only, with
 * no gateway in front — a declared `X-City-ID`.
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

export function correlationIdOf(c: Context): string | null {
  return c.req.header("X-Request-ID") ?? null;
}
