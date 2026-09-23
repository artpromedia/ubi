/**
 * The deny-by-default `fleet` flag, checked for EVERY client route before the
 * route reads its body, its Idempotency-Key or its idempotency record.
 *
 * With the flag off in the caller's verified city a route answers the honest
 * 404 `feature_disabled` (CLAUDE.md #5, #8) — never a validation error, an
 * idempotency replay or a key-reuse 409 that would show the route exists and
 * processed the request. The flows re-check the flag themselves (defense in
 * depth); this gate only makes the answer the same whatever the request
 * carries. Runs after `gatewayAuth`, so the city is the one the gateway
 * vouched for.
 */
import { cityOf } from "./auth";
import { failure } from "./error-handler";
import { requireFleetEnabled } from "../ops/config";

import type { FleetDeps } from "../ops/context";
import type { Context, MiddlewareHandler, Next } from "hono";

export function fleetFlagGate(deps: FleetDeps): MiddlewareHandler {
  return async (c: Context, next: Next): Promise<void | Response> => {
    try {
      await requireFleetEnabled(deps.config, cityOf(c));
    } catch (error) {
      return failure(c, error);
    }
    await next();
    return undefined;
  };
}
