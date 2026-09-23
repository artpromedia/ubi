/**
 * Authentication and the actor.
 *
 * The API gateway authenticates the caller and forwards who they are. This
 * service reads the actor from the gateway's identity and from nowhere else: a
 * request body, a tool argument or model text may never name a user, a role or
 * a city (CLAUDE.md #1; rule #18 — actor, role and ownership come from the
 * gateway identity context, never from tool args or model output).
 *
 * TRUST MODEL (the same as payment-service's and user-service's; see
 * docs/security/INTERNAL_IDENTITY.md):
 *
 *   - `x-ubi-identity` — the gateway-signed HS256 context (lib/identity-
 *     context.ts) — is AUTHORITATIVE whenever it is present, in every
 *     environment: it verifies and its claims win, or the request is refused
 *     (401). There is no falling back to the plain headers under a bad one. A
 *     missing or misconfigured UBI_IDENTITY_SECRET is an outage (503), never a
 *     reason to trust an unsigned header.
 *   - In PRODUCTION the signed context is REQUIRED: the plain `X-User-ID` /
 *     `X-User-Role` mirrors are display data anyone on the service network
 *     could set, so a request without the context is refused (401).
 *   - In development and tests (no gateway in front) the plain mirrors are
 *     still read, as before.
 *
 * The verified context also carries the request's EFFECTIVE SCOPES — what the
 * gateway left after limited mode and wallet safe mode — so the marketplace
 * surfaces can refuse a session the gateway would have refused on `/v1/mp`
 * (`marketplaceAllowed`), even when the assistant reaches ride-service itself.
 *
 * RELAYED IDENTITY. `gatewayAuth` runs the rest of the request inside an
 * identity relay scope (lib/identity-relay.ts) built from the verified
 * context and the exact header it came in: the travel port presents that
 * same gateway-signed context to travel-service, which verifies it again. It
 * is established here and nowhere else — never from a body, a tool argument
 * or model output — and never persisted.
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
import {
  runWithIdentityRelay,
  type IdentityRelay,
} from "../lib/identity-relay";
import { logger } from "../lib/logger";
import { isProductionEnvironment } from "../lib/ride-context";
import { isAskRole, type Actor } from "../ops/types";

import type { Context, Next } from "hono";

declare module "hono" {
  interface ContextVariableMap {
    actor: Actor;
    /** The verified gateway context; absent only on the dev/test header path. */
    identity: VerifiedIdentity | undefined;
  }
}

/** The scope a session needs to act in the negotiated-fare marketplace. */
export const MARKETPLACE_SCOPE = "mp:request";

type Resolved =
  | {
      readonly kind: "ok";
      readonly actor: Actor;
      readonly identity?: VerifiedIdentity;
      /** The `x-ubi-identity` value the identity was verified from. */
      readonly token?: string;
    }
  | { readonly kind: "refused"; readonly response: Response };

function unauthorized(c: Context): Response {
  return c.json(
    { code: "unauthorized", message: "authentication required" },
    401,
  );
}

/**
 * Who is calling: from the verified context when present (required in
 * production), otherwise — outside production only — from the plain mirrors.
 */
function resolveCaller(c: Context): Resolved {
  const signed = c.req.header(IDENTITY_HEADER);
  if (signed !== undefined && signed.length > 0) {
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
    // Fail closed: only the gateway-signed context authenticates here.
    return { kind: "refused", response: unauthorized(c) };
  }
  const userId = c.req.header("X-User-ID");
  const role = c.req.header("X-User-Role");
  if (userId === undefined || userId.length === 0) {
    return { kind: "refused", response: unauthorized(c) };
  }
  return { kind: "ok", actor: { id: userId, role: role ?? "" } };
}

export async function gatewayAuth(
  c: Context,
  next: Next,
): Promise<void | Response> {
  const caller = resolveCaller(c);
  if (caller.kind === "refused") {
    return caller.response;
  }
  if (!isAskRole(caller.actor.role)) {
    // The assistant serves riders and drivers. Any other role gets no access;
    // saying so is clearer than a deny on every individual tool.
    return c.json(
      {
        code: "forbidden",
        message: "this role has no access to the assistant",
        details: {
          role: caller.actor.role.length > 0 ? caller.actor.role : null,
        },
      },
      403,
    );
  }
  c.set("actor", caller.actor);
  c.set("identity", caller.identity);
  await runWithIdentityRelay(relayFor(c, caller), next);
}

/**
 * The identity this request relays to travel-service. A verified context is
 * relayed as the exact token the gateway signed, with its own city claim and
 * request id (the city mirrors the gateway wrote carry that same claim, so
 * they are re-derived from it rather than copied from a header). Outside
 * production, a request on the documented unsigned path relays its plain
 * caller and declared city instead; production never gets here without a
 * verified context (`resolveCaller`).
 */
function relayFor(
  c: Context,
  caller: Extract<Resolved, { kind: "ok" }>,
): IdentityRelay {
  if (caller.identity !== undefined && caller.token !== undefined) {
    return {
      kind: "signed",
      token: caller.token,
      userId: caller.identity.userId,
      role: caller.identity.role,
      cityId: caller.identity.cityId,
      requestId: caller.identity.requestId,
    };
  }
  return {
    kind: "unsigned",
    userId: caller.actor.id,
    role: caller.actor.role,
    cityId:
      presentHeader(c, "x-auth-city-id") ??
      presentHeader(c, "x-ubi-city-id") ??
      presentHeader(c, "X-City-ID") ??
      null,
    requestId: presentHeader(c, "X-Request-ID") ?? null,
  };
}

/** Ops endpoints (`/v1/ops/ai/*`) are admin-only; end-user roles never reach them. */
export async function adminAuth(
  c: Context,
  next: Next,
): Promise<void | Response> {
  const caller = resolveCaller(c);
  if (caller.kind === "refused") {
    return caller.response;
  }
  const ADMIN_ROLES = ["ops_admin", "ai_ops", "growth_admin"];
  if (!ADMIN_ROLES.includes(caller.actor.role)) {
    return c.json({ code: "forbidden", message: "admin access required" }, 403);
  }
  c.set("actor", caller.actor);
  c.set("identity", caller.identity);
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
 * Whether this request may act in the negotiated-fare marketplace. With a
 * verified context, only when the gateway granted `mp:request` — limited mode
 * strips it, exactly as it denies `/v1/mp` at the edge. Without one (the dev/
 * test header path, never production) the scopes are unknown and the service
 * flags alone decide.
 */
export function marketplaceAllowed(c: Context): boolean {
  const identity = c.get("identity");
  if (identity === undefined) {
    return !isProductionEnvironment(process.env.NODE_ENV);
  }
  return identity.scopes.includes(MARKETPLACE_SCOPE);
}

/** Refuses a marketplace action the gateway's scopes do not allow. */
export function assertMarketplaceAllowed(c: Context): void {
  if (!marketplaceAllowed(c)) {
    const modes = c.get("identity")?.modes ?? [];
    throw modes.includes("limited")
      ? new ContractError(
          "limited_mode",
          "This device is not verified yet. Finish the security check to use the marketplace.",
          { modes: [...modes] },
        )
      : new ContractError(
          "forbidden",
          "This action is not available for your account type",
          { required: [MARKETPLACE_SCOPE] },
        );
  }
}

function presentHeader(c: Context, name: string): string | undefined {
  const value = c.req.header(name)?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

/**
 * The city the request belongs to — the city grants are scoped to, flags are
 * evaluated in, and the delegated identity to ride-service is signed for.
 *
 * The AUTHORITATIVE source is the gateway's own city claim: the `city` of the
 * verified `x-ubi-identity` context, and its header mirrors `x-auth-city-id`
 * (the value the gateway signs for ride-service) and `x-ubi-city-id`. The
 * gateway deletes all of them from every inbound client request and writes
 * them from the verified token (services/api-gateway/src/middleware/
 * identity.ts). `X-City-ID`, by contrast, is client-declared context the
 * gateway passes through untouched, so:
 *   - when a verified city exists, every mirror and any declared city must
 *     agree with it — a different one is refused rather than trusted;
 *   - a declared city alone is accepted only outside production (no gateway in
 *     front, e.g. local development and tests) — in production the assistant
 *     never acts in a city the gateway did not vouch for.
 * A tool argument or model output can never name a city at all (rule #18).
 */
export function cityOf(c: Context): string {
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
