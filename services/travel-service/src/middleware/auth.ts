/**
 * Authentication, the actor and the city — for EVERY client and ops route.
 *
 * The API gateway authenticates the caller and forwards who they are. This
 * service reads the actor from the gateway's identity and from nowhere else: a
 * request body may not name a user, a role or a city (CLAUDE.md #1 — the server
 * is authoritative).
 *
 * TRUST MODEL (the same as ask-service's, payment-service's and user-service's;
 * see docs/security/INTERNAL_IDENTITY.md):
 *
 *   - `x-ubi-identity` — the gateway-signed HS256 context (lib/identity-
 *     context.ts) — is AUTHORITATIVE whenever it is present, in every
 *     environment: it verifies and its claims win over every plain mirror, or
 *     the request is refused (401). There is no falling back to the plain
 *     headers under a bad one. A missing or misconfigured UBI_IDENTITY_SECRET
 *     is an outage (503), never a reason to trust an unsigned header — and in
 *     production it is a refusal to boot (index.ts).
 *   - In PRODUCTION the signed context is REQUIRED: the plain `X-User-ID` /
 *     `X-User-Role` mirrors are display data anyone on the service network
 *     could set, so a request without the context is refused (401).
 *   - In development and tests (no gateway in front) the plain mirrors are
 *     still read: the documented UNSIGNED DEVELOPMENT MODE. It is decided by
 *     NODE_ENV alone (`production` / `prod` are production), exactly as
 *     ask-service decides it.
 *
 * THE CITY follows the same rule (`cityOf`). The gateway's own city claim —
 * the `city` of the verified context, and the mirrors it writes from it,
 * `x-auth-city-id` / `x-ubi-city-id` — is authoritative; the gateway deletes
 * all of them from every inbound client request. `X-City-ID` is client-
 * declared context the gateway passes through untouched, so a declared city
 * that disagrees with the verified one is refused (403, reason
 * `city_mismatch`) on EVERY route, reads included, before any handler runs.
 *
 * Ops console routes (`/v1/ops/travel/*`) check the ops role on the actor this
 * middleware sets — so in production the role that opens the console is the
 * signed one, never a mirror (routes/ops.ts, ops/roles.ts). An operator whose
 * signed context is bound to no city may declare the console action's city,
 * but only a SUPPORTED one, and the request then records it as
 * operator-declared with the operator's id (./operator-city.ts,
 * `cityProvenanceOf`).
 *
 * THE SCOPES the gateway signed are re-checked here too, not only at the
 * edge: every money-moving write under `/v1/travel` (carts, passengers,
 * checkout, cancel, switch) needs `travel:book` on the verified context and
 * is refused in limited mode (./scopes.ts) — a caller that reaches this
 * service without passing the gateway's scope table gains nothing.
 *
 * Service-to-service routes do NOT use this middleware: supplier webhooks
 * (`/v1/travel/webhooks/:supplierId`) are authenticated by each supplier's own
 * signature over the raw body (routes/webhooks.ts), and the gateway never
 * forwards them.
 */
import {
  ContractError,
  IDEMPOTENCY_HEADER,
  IdempotencyKeySchema,
} from "@ubi/contracts";

import {
  checkOperatorDeclaredCity,
  type CityWithProvenance,
} from "./operator-city";
import { assertTravelBookAllowed } from "./scopes";
import {
  IDENTITY_HEADER,
  identityVerificationKeys,
  verifyIdentityContext,
  type VerifiedIdentity,
} from "../lib/identity-context";
import { logger } from "../lib/logger";
import { isProductionEnvironment } from "../lib/ride-context";

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
    }
  | { readonly kind: "refused"; readonly response: Response };

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
 * Who is calling: from the verified context when present (required in
 * production), otherwise — outside production only — from the plain mirrors.
 */
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
      };
    } catch {
      return { kind: "refused", response: unauthorized(c) };
    }
  }
  if (isProductionEnvironment(process.env.NODE_ENV)) {
    // Fail closed: only the gateway-signed context authenticates here.
    return { kind: "refused", response: unauthorized(c) };
  }
  const userId = presentHeader(c, "X-User-ID");
  const role = presentHeader(c, "X-User-Role");
  if (userId === undefined || role === undefined) {
    return { kind: "refused", response: unauthorized(c) };
  }
  return { kind: "ok", actor: { id: userId, role } };
}

/**
 * Sets the actor (and the verified identity) for the request, and — before
 * any handler runs — refuses a request whose cities disagree, an unbound
 * operator's declared city that UBI does not operate in, and a money-moving
 * travel write the signed scopes do not allow.
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
    await checkOperatorDeclaredCity(c);
    assertTravelBookAllowed(c);
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

function cityMismatch(message: string): ContractError {
  return new ContractError("forbidden", message, { reason: "city_mismatch" });
}

/**
 * The city the gateway vouched for, or undefined when it vouched for none.
 * Throws `forbidden` (reason `city_mismatch`) when the sources disagree.
 *
 * With a verified context its claim is the verified city; the header mirrors
 * the gateway writes from that claim must equal it, and since the gateway
 * writes them only from a non-null claim, a mirror beside a city-less context
 * did not come from the gateway and is refused too. Without a context (the
 * dev/test header path only) the mirrors are the verified sources, as in
 * ask-service. Either way a declared `X-City-ID` must agree.
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

function cityUnsupported(): ContractError {
  return new ContractError(
    "city_unsupported",
    "the request does not say which city it belongs to",
  );
}

/**
 * The city the request belongs to — the city flags are evaluated in and every
 * order, refund and outbox event is recorded for.
 *
 *   - A verified city wins (a declared one must agree — `gatewayAuth` has
 *     already refused a disagreement).
 *   - Without one, a declared `X-City-ID` is accepted outside production (no
 *     gateway in front).
 *   - In production it is accepted only from a verified OPS operator whose
 *     signed context is bound to no city — the operating city of a console
 *     action, as payment-service's finance console reads it — and only once
 *     `gatewayAuth` has checked that it is a supported city
 *     (./operator-city.ts). An operator already holds every city; a
 *     traveller never names a city the gateway did not vouch for.
 */
export function cityOf(c: Context): string {
  return cityProvenanceOf(c).cityId;
}

/**
 * The request's city together with whose word it rests on — what a console
 * write records so an operator-declared city is never presented as
 * gateway-verified. Same acceptance rules as `cityOf`.
 */
export function cityProvenanceOf(c: Context): CityWithProvenance {
  const verified = verifiedCity(c);
  if (verified !== undefined) {
    return { cityId: verified, provenance: "verified", declaredBy: null };
  }
  const declared = presentHeader(c, "X-City-ID");
  if (declared === undefined) {
    throw cityUnsupported();
  }
  const operator = c.get("operatorCity");
  if (operator !== undefined && operator.cityId === declared) {
    return {
      cityId: declared,
      provenance: "operator_declared",
      declaredBy: operator.operatorId,
    };
  }
  if (!isProductionEnvironment(process.env.NODE_ENV)) {
    return {
      cityId: declared,
      provenance: "declared_unverified",
      declaredBy: null,
    };
  }
  throw cityUnsupported();
}

/**
 * The strict city: what travel-service may SIGN a ride-service identity for
 * (airport transfers). A verified city, or — outside production only — a
 * declared one. No operator exception: the city is re-presented to another
 * service under travel-service's own signature.
 */
export function strictCityOf(c: Context): string {
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
  throw cityUnsupported();
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
