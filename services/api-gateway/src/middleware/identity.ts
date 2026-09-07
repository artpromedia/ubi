/**
 * =====================================================================
 * CANONICAL INTERNAL IDENTITY HEADERS — the contract every UBI service,
 * including the Go ride-service, agrees on.
 * =====================================================================
 *
 * VERSION PREFIX. The gateway mounts `/v1`. `/api` is not a UBI prefix and is
 * not routed. Downstream services receive the path with `/v1` stripped, so
 * `POST /v1/devices/enroll` at the edge arrives at user-service as
 * `POST /devices/enroll`.
 *
 * AUTHORITATIVE (verify this, trust nothing else)
 *
 *   X-UBI-Identity        Compact HS256 JWS minted by the gateway, signed with
 *                         the internal secret UBI_IDENTITY_SECRET. Claims:
 *                           sub    user id
 *                           role   rider | driver | merchant | restaurant |
 *                                  admin | service
 *                           scp[]  effective scopes for THIS request
 *                           mod[]  active restriction modes: limited,
 *                                  wallet_safe
 *                           city   city / tenant scope, or null
 *                           tenant tenant id, or null
 *                           sid    session id, or null
 *                           dev    device id, or null
 *                           rid    request id (matches X-Request-ID)
 *                           iss    ubi-gateway
 *                           aud    ubi-internal
 *                           exp    now + 120s
 *                         A service that skips this signature has no identity.
 *
 * CONVENIENCE MIRRORS (derived from the JWS above; never trust them alone)
 *
 *   X-Auth-User-ID    /  X-User-ID        same value, two spellings, because
 *   X-Auth-User-Role  /  X-User-Role      the TypeScript services read the
 *                                         `x-auth-*` pair and the Go
 *                                         ride-service reads `X-User-*`. Both
 *                                         are emitted until every consumer
 *                                         verifies the JWS.
 *   X-Session-ID                          session id
 *   X-UBI-City-ID                         city / tenant scope
 *   X-UBI-Scopes                          space-separated effective scopes
 *   X-UBI-Modes                           space-separated restriction modes
 *   X-Request-ID                          request id, propagated end to end
 *
 * INBOUND FROM CLIENTS: every header above is STRIPPED from the incoming
 * request before routing. A client that sends `x-auth-user-id: <victim>` has
 * that header deleted from the request object itself, so no handler, and no
 * proxy that forwards headers wholesale, can ever observe the forged value.
 * `x-internal-service` is stripped for the same reason: user-service treats it
 * as a bypass of authentication.
 */
import { ContractError } from "@ubi/contracts";
import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";

import type { AuthContext } from "./auth";
import { authLogger } from "../lib/logger.js";
import { getIdentityStateStore } from "../lib/redis";
import { type IdentityContext, signIdentityContext } from "../identity/context";
import { readRiskState } from "../identity/state";
import {
  authorizeRequest,
  effectiveScopes,
  type IdentityMode,
} from "../identity/scopes";

export const IDENTITY_HEADER = "x-ubi-identity";
export const REQUEST_ID_HEADER = "x-request-id";

/** Exact header names the gateway owns end to end. */
export const RESERVED_IDENTITY_HEADERS: readonly string[] = [
  IDENTITY_HEADER,
  "x-auth-user-id",
  "x-auth-user-role",
  "x-auth-user-email",
  "x-user-id",
  "x-user-role",
  "x-user-email",
  "x-session-id",
  "x-ubi-city-id",
  "x-ubi-tenant-id",
  "x-ubi-scopes",
  "x-ubi-modes",
  "x-internal-service",
  "x-service-key",
];

/** Whole families the gateway owns, so a new claim header cannot be forged. */
const RESERVED_PREFIXES: readonly string[] = [
  "x-auth-",
  "x-ubi-",
  "x-user-",
  "x-internal-",
];

export function isReservedIdentityHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    RESERVED_IDENTITY_HEADERS.includes(lower) ||
    RESERVED_PREFIXES.some((prefix) => lower.startsWith(prefix))
  );
}

/**
 * Deletes every reserved header from the live request.
 *
 * This mutates `c.req.raw.headers` rather than filtering at the proxy, because
 * a filter is only as good as the next person who writes a route. Deleting
 * makes the forged value unobservable everywhere, including from
 * `c.req.header()` inside any handler.
 *
 * Must be mounted before authentication, and before anything that reads a
 * header.
 */
export const stripInboundIdentityHeaders = createMiddleware(
  async (c: Context, next: Next) => {
    const headers = c.req.raw.headers;
    const forged: string[] = [];

    for (const name of [...headers.keys()]) {
      if (!isReservedIdentityHeader(name)) continue;
      forged.push(name);
      headers.delete(name);
    }

    if (forged.length > 0) {
      // Header NAMES only — the values are attacker-controlled and may carry PII.
      authLogger.warn(
        { path: c.req.path, method: c.req.method, strippedHeaders: forged },
        "Stripped reserved identity headers from an inbound client request",
      );
    }

    return next();
  },
);

/**
 * A client may propose a request id for correlation, but only a short, boring
 * one: it ends up in log lines and in the signed context, and neither should
 * carry whatever a caller felt like sending.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{8,64}$/;

export function safeRequestId(proposed: string | undefined): string {
  return proposed !== undefined && REQUEST_ID_PATTERN.test(proposed)
    ? proposed
    : crypto.randomUUID();
}

function modesFor(
  auth: AuthContext,
  safeMode: boolean,
): readonly IdentityMode[] {
  const modes: IdentityMode[] = [];
  if (auth.mode === "limited") modes.push("limited");
  if (safeMode) modes.push("wallet_safe");
  return modes;
}

/**
 * Builds, signs and installs the identity context.
 *
 * Runs after authentication. Everything it writes is derived from the validated
 * token plus server-side risk state; nothing is copied from the client.
 */
export const identityContextMiddleware = createMiddleware(
  async (c: Context, next: Next) => {
    const auth = c.get("auth") as AuthContext | undefined;
    if (auth === undefined) {
      // Public route: no identity to mint. The strip middleware already removed
      // anything the client tried to supply.
      return next();
    }

    const requestId = safeRequestId(c.req.header(REQUEST_ID_HEADER));
    const risk = await readRiskState(getIdentityStateStore(), auth.userId);
    const modes = modesFor(auth, risk.safeMode);

    const scopes = effectiveScopes({
      role: auth.role,
      tokenScopes: auth.scopes,
      modes,
    });

    const context: IdentityContext = {
      userId: auth.userId,
      role: auth.role,
      scopes,
      modes,
      cityId: auth.cityId,
      tenantId: auth.tenantId,
      sessionId: auth.sessionId,
      deviceId: auth.deviceId,
      requestId,
    };

    let signed: string;
    try {
      signed = await signIdentityContext(context);
    } catch (error) {
      authLogger.error(
        { err: error, path: c.req.path },
        "Could not sign the internal identity context",
      );
      const failure = new ContractError(
        "service_unavailable",
        "Identity could not be established. Please try again.",
      );
      return c.json({ success: false, error: failure.toBody() }, 503);
    }

    c.set("identity", context);
    c.set("identityToken", signed);
    c.set("riskDegraded", risk.degraded);

    // Install the authoritative values on the request itself, so any consumer —
    // including a proxy that forwards headers wholesale — sees only these.
    const headers = c.req.raw.headers;
    headers.set(IDENTITY_HEADER, signed);
    headers.set("x-auth-user-id", context.userId);
    headers.set("x-auth-user-role", context.role);
    headers.set("x-user-id", context.userId);
    headers.set("x-user-role", context.role);
    headers.set(REQUEST_ID_HEADER, requestId);
    headers.set("x-ubi-scopes", context.scopes.join(" "));
    headers.set("x-ubi-modes", context.modes.join(" "));
    if (context.sessionId !== null)
      headers.set("x-session-id", context.sessionId);
    if (context.cityId !== null) headers.set("x-ubi-city-id", context.cityId);
    if (context.tenantId !== null)
      headers.set("x-ubi-tenant-id", context.tenantId);

    c.header(REQUEST_ID_HEADER, requestId);

    return next();
  },
);

/**
 * Enforces the scope matrix. Deny-by-default inside a restricted mode: see
 * `identity/scopes.ts` for what limited mode and wallet safe mode take away.
 */
export const scopeEnforcementMiddleware = createMiddleware(
  async (c: Context, next: Next) => {
    const identity = c.get("identity") as IdentityContext | undefined;
    if (identity === undefined) return next();

    try {
      authorizeRequest({
        path: c.req.path,
        method: c.req.method,
        role: identity.role,
        modes: identity.modes,
        scopes: identity.scopes,
      });
    } catch (error) {
      if (error instanceof ContractError) {
        const degraded = c.get("riskDegraded") === true;
        authLogger.warn(
          {
            path: c.req.path,
            method: c.req.method,
            code: error.code,
            modes: identity.modes,
            riskStateDegraded: degraded,
          },
          "Request denied by the gateway scope matrix",
        );
        return c.json(
          { success: false, error: error.toBody() },
          error.status as 403,
        );
      }
      throw error;
    }

    return next();
  },
);
