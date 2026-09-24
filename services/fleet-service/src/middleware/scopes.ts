/**
 * The gateway's fleet scopes, re-checked on the signed context (defense in
 * depth: a caller that reaches fleet-service without passing the gateway's
 * scope table gains nothing).
 *
 *   /v1/fleets/*                 GET → fleet:read;  every write → fleet:manage
 *   /v1/fleet-offers/*           fleet:driver
 *   /v1/drivers/me/fleet…, /schedule, /availability…, /conflicts/…,
 *   /vehicle-issues              fleet:driver
 *
 * Limited mode (a new, unverified device) keeps none of them: fleet reads are
 * other people's operations, and every driver-side action commits the
 * driver's time or terms. Authority INSIDE a fleet (owner / manager /
 * read-only) is fleet-service's own staff check (ops/roles.ts); these scopes
 * only decide whether the session may ask. Without a verified context (the
 * unsigned development mode, never production) the scopes are unknown and the
 * staff check alone decides.
 */
import { ContractError } from "@ubi/contracts";

import type { Context } from "hono";

const WRITE_METHODS: ReadonlySet<string> = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

const DRIVER_PREFIXES = [
  "/v1/fleet-offers",
  "/v1/drivers/me/fleet",
  "/v1/drivers/me/schedule",
  "/v1/drivers/me/availability",
  "/v1/drivers/me/conflicts",
  "/v1/drivers/me/vehicle-issues",
] as const;

/** The scope a client request to fleet-service needs, or null for none. */
export function requiredFleetScope(
  method: string,
  path: string,
): string | null {
  if (path === "/v1/fleets" || path.startsWith("/v1/fleets/")) {
    return WRITE_METHODS.has(method.toUpperCase())
      ? "fleet:manage"
      : "fleet:read";
  }
  if (
    DRIVER_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix))
  ) {
    return "fleet:driver";
  }
  return null;
}

export function assertFleetScopes(c: Context): void {
  const required = requiredFleetScope(c.req.method, c.req.path);
  if (required === null) {
    return;
  }
  const identity = c.get("identity");
  if (identity === undefined) {
    return;
  }
  if (identity.modes.includes("limited")) {
    throw new ContractError(
      "limited_mode",
      "This device is not verified yet. Finish the security check to use fleet tools.",
      { modes: [...identity.modes], required: [required] },
    );
  }
  if (!identity.scopes.includes(required)) {
    throw new ContractError(
      "forbidden",
      "This action is not available for your account type",
      { required: [required] },
    );
  }
}
