/**
 * Identity comes from the gateway, never from the request body or query
 * (CLAUDE.md: server is authoritative). A client cannot name itself as the
 * author of a change request, cannot approve as somebody else, and cannot ask
 * for another user's flag evaluation.
 */
import { ContractError } from "@ubi/contracts";
import type { Context } from "hono";

import { internalServiceKey } from "../lib/env";

export interface Actor {
  readonly id: string;
  readonly role: string;
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

export function actorFrom(c: Context): Actor {
  const id = c.req.header(USER_ID_HEADER);
  if (id === undefined || id.trim() === "") {
    throw new ContractError("unauthorized", "authentication required");
  }
  const role = (c.req.header(USER_ROLE_HEADER) ?? "").trim().toLowerCase();
  return { id: id.trim(), role };
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
  return actor;
}

function isInternalCaller(c: Context): boolean {
  const expected = internalServiceKey();
  if (expected === undefined) return false;
  return c.req.header(SERVICE_KEY_HEADER) === expected;
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
  if (
    isInternalCaller(c) &&
    requestedUserId !== undefined &&
    requestedUserId !== ""
  ) {
    return requestedUserId;
  }
  return undefined;
}
