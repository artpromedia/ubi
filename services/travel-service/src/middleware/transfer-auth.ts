/**
 * What the airport-transfer routes need beyond every other travel route.
 *
 * Every client and ops route already reads its caller from the gateway-signed
 * `x-ubi-identity` context (./auth.ts: required in production, claims beat
 * every plain mirror, a declared city that disagrees is refused). The transfer
 * routes are held to two further rules, because travel-service re-presents
 * their caller to ride-service under its OWN signature (lib/ride-context.ts):
 *
 *   - THE STRICT CITY (`verifiedCityOf`): a transfer is signed for a verified
 *     city, or — outside production only — a declared one. The ops-operator
 *     exception `cityOf` allows for console actions does not apply.
 *   - THE MARKETPLACE SCOPE (`assertMarketplaceAllowed`): an airport transfer
 *     becomes a marketplace request on ride-service, which the gateway allows
 *     only for sessions holding `mp:request` (limited mode strips it).
 *     travel-service reaches ride-service without passing the gateway's
 *     `/v1/mp` rule, so it applies that rule itself on every action that
 *     makes, changes or cancels a ride.
 *
 * `verifiedGatewayAuth` is the shared `gatewayAuth`, kept under the name the
 * transfer and flight-status routes were written against.
 */
import { ContractError } from "@ubi/contracts";

import { gatewayAuth, strictCityOf } from "./auth";
import { isProductionEnvironment } from "../lib/ride-context";

import type { Context } from "hono";

/** The scope a session needs to act in the negotiated-fare marketplace. */
export const MARKETPLACE_SCOPE = "mp:request";

/** The gateway-signed caller (./auth.ts); required in production. */
export const verifiedGatewayAuth = gatewayAuth;

/**
 * The request's city — the city flags are evaluated in and every ride-service
 * call for a transfer created here is signed for.
 */
export function verifiedCityOf(c: Context): string {
  return strictCityOf(c);
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
