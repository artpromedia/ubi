/**
 * Identity comes from the gateway, never from the request body or query
 * (CLAUDE.md: server is authoritative). A client cannot name itself as the
 * author of a change request, cannot approve as somebody else, and cannot ask
 * for another user's flag evaluation.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import { ContractError } from "@ubi/contracts";

import { internalServiceKey } from "../lib/env";
import {
  IDENTITY_HEADER,
  identityVerificationKeys,
  verifyIdentityContext,
} from "../lib/identity-context";

import type { Context } from "hono";

export interface Actor {
  readonly id: string;
  readonly role: string;
  readonly scopes?: readonly string[];
  readonly modes?: readonly string[];
  readonly verified?: boolean;
}

/** Roles allowed to propose, approve or flip config and flags. */
export const CONFIG_ADMIN_ROLES: ReadonlySet<string> = new Set([
  "config_admin",
  "ops_admin",
  "admin",
  "super_admin",
]);

const USER_ID_HEADER = "x-user-id";
const USER_ROLE_HEADER = "x-user-role";
const SERVICE_KEY_HEADER = "x-service-key";
const MIN_INTERNAL_KEY_LEN = 32;

function isProductionRuntime(): boolean {
  return (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

function verifyPresentedIdentity(token: string): Actor {
  let keys: readonly Buffer[];
  try {
    keys = identityVerificationKeys();
  } catch {
    throw new ContractError(
      "service_unavailable",
      "identity verification is not configured",
    );
  }
  const identity = verifyIdentityContext(token, keys);
  return {
    id: identity.userId,
    role: identity.role,
    scopes: identity.scopes,
    modes: identity.modes,
    verified: true,
  };
}

export function actorFrom(c: Context): Actor {
  const signedToken = c.req.header(IDENTITY_HEADER)?.trim();
  if (signedToken !== undefined && signedToken !== "") {
    return verifyPresentedIdentity(signedToken);
  }

  if (isProductionRuntime()) {
    throw new ContractError(
      "unauthorized",
      "signed gateway identity context required",
    );
  }

  const id = c.req.header(USER_ID_HEADER);
  if (id === undefined || id.trim() === "") {
    throw new ContractError("unauthorized", "authentication required");
  }
  const role = (c.req.header(USER_ROLE_HEADER) ?? "").trim().toLowerCase();
  return { id: id.trim(), role, verified: false };
}

export function requireConfigAdmin(c: Context): Actor {
  const actor = actorFrom(c);
  if (!CONFIG_ADMIN_ROLES.has(actor.role)) {
    throw new ContractError(
      "forbidden",
      "config administration requires an admin role",
      {
        requiredRoles: [...CONFIG_ADMIN_ROLES],
      },
    );
  }
  if (actor.verified === true) {
    if (actor.modes?.includes("limited") === true) {
      throw new ContractError(
        "limited_mode",
        "config administration is not available on an unverified device",
      );
    }
    if (actor.scopes?.includes("config:admin") !== true) {
      throw new ContractError(
        "forbidden",
        "config administration requires config:admin scope",
        {
          requiredScopes: ["config:admin"],
        },
      );
    }
  }
  return actor;
}

export function requireChangeRequestRejector(
  c: Context,
  authorId: string,
): Actor {
  const actor = actorFrom(c);
  if (actor.verified === true && actor.modes?.includes("limited") === true) {
    throw new ContractError(
      "limited_mode",
      "config administration is not available on an unverified device",
    );
  }
  if (actor.id !== authorId && !CONFIG_ADMIN_ROLES.has(actor.role)) {
    throw new ContractError(
      "forbidden",
      "only the author or a config admin may reject a change request",
      {
        requiredRoles: [...CONFIG_ADMIN_ROLES],
      },
    );
  }
  if (
    actor.verified === true &&
    actor.id !== authorId &&
    actor.scopes?.includes("config:admin") !== true
  ) {
    throw new ContractError(
      "forbidden",
      "config administration requires config:admin scope",
      {
        requiredScopes: ["config:admin"],
      },
    );
  }
  return actor;
}

function isInternalCaller(c: Context): boolean {
  const expected = internalServiceKey();
  if (expected === undefined) {
    return false;
  }
  if (isProductionRuntime() && expected.length < MIN_INTERNAL_KEY_LEN) {
    return false;
  }
  const presented = c.req.header(SERVICE_KEY_HEADER);
  if (presented === undefined || presented === "") {
    return false;
  }
  const left = createHash("sha256").update(presented, "utf8").digest();
  const right = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(left, right);
}

/**
 * Resolve which user a flag evaluation is for.
 *
 * - An authenticated caller is always evaluated as itself. A `userId` query
 *   parameter that disagrees with the authenticated identity is refused rather
 *   than silently ignored.
 * - A trusted service (shared internal key) may evaluate on behalf of a user,
 *   because it has already authenticated that user itself.
 * - Anyone else gets a city-only evaluation; the supplied `userId` is dropped.
 */
export function effectiveUserId(
  c: Context,
  requestedUserId: string | undefined,
): string | undefined {
  const signedToken = c.req.header(IDENTITY_HEADER)?.trim();
  if (signedToken !== undefined && signedToken !== "") {
    const actor = verifyPresentedIdentity(signedToken);
    if (
      requestedUserId !== undefined &&
      requestedUserId !== "" &&
      requestedUserId !== actor.id
    ) {
      throw new ContractError(
        "forbidden",
        "cannot evaluate flags for another user",
      );
    }
    return actor.id;
  }

  if (!isProductionRuntime()) {
    const headerUserId = c.req.header(USER_ID_HEADER)?.trim();
    if (headerUserId !== undefined && headerUserId !== "") {
      if (
        requestedUserId !== undefined &&
        requestedUserId !== "" &&
        requestedUserId !== headerUserId
      ) {
        throw new ContractError(
          "forbidden",
          "cannot evaluate flags for another user",
        );
      }
      return headerUserId;
    }
  }

  if (
    isInternalCaller(c) &&
    requestedUserId !== undefined &&
    requestedUserId !== ""
  ) {
    return requestedUserId;
  }
  return undefined;
}
