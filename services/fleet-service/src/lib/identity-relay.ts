/**
 * The caller's gateway identity, relayed to user-service's wallet-PIN check.
 *
 * Signing a fleet offer needs the driver's wallet PIN, verified by
 * user-service's REAL check (services/user-service/src/identity/pin.ts
 * `verifyPin`, route POST /auth/pin/verify) with its attempt counter and
 * lockout. user-service trusts one caller identity: the gateway-signed
 * `x-ubi-identity` context. fleet-service cannot mint one — only the gateway
 * holds that role — and must never invent a substitute (a plain `X-User-ID`,
 * a service key standing in for the driver). What it CAN do is pass on,
 * unchanged, the context the driver's own request arrived with: the gateway
 * signed it for this request, fleet-service verified it (middleware/auth.ts),
 * and it names the same user, role, scopes, modes and city. This is the
 * ask → travel relay pattern (services/ask-service/src/lib/identity-relay.ts).
 *
 * `gatewayAuth` — and nothing else — establishes the relay for the lifetime
 * of one verified request. It rides an AsyncLocalStorage scope, so no request
 * body can reach it, no port signature carries a bearer credential through
 * the ops layer, and it is never persisted: the audit and outbox rows record
 * user-service's verification reference, never the context or the PIN.
 * Work with no inbound request (a sweep) finds NO relay, and the PIN port
 * refuses rather than falling back to anything weaker.
 *
 * The gateway's contexts live 120 seconds; a relayed context is sent as-is
 * and user-service checks its expiry, so a sign attempt after that window is
 * refused there (401) — nothing here re-signs or extends it.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { IDENTITY_HEADER } from "./identity-context";

/** The gateway-written city mirrors (services/api-gateway middleware/identity.ts). */
export const AUTH_CITY_HEADER = "x-auth-city-id";
export const UBI_CITY_HEADER = "x-ubi-city-id";
export const REQUEST_ID_HEADER = "x-request-id";

export type IdentityRelay =
  | {
      /** A verified gateway context: relayed byte for byte. */
      readonly kind: "signed";
      readonly token: string;
      readonly userId: string;
      readonly cityId: string | null;
      readonly requestId: string | null;
    }
  | {
      /** The documented unsigned development mode (never production). */
      readonly kind: "unsigned";
      readonly userId: string;
      readonly role: string;
      readonly cityId: string | null;
      readonly requestId: string | null;
    };

const relayScope = new AsyncLocalStorage<IdentityRelay>();

export function runWithIdentityRelay<T>(
  relay: IdentityRelay,
  work: () => T,
): T {
  return relayScope.run(relay, work);
}

export function currentIdentityRelay(): IdentityRelay | undefined {
  return relayScope.getStore();
}

/**
 * The headers that carry a SIGNED relay onward: the context itself, the two
 * city mirrors the gateway writes from its city claim (only when there is
 * one), and the request id. Nothing else.
 */
export function signedRelayHeaders(
  relay: Extract<IdentityRelay, { kind: "signed" }>,
): Record<string, string> {
  const headers: Record<string, string> = { [IDENTITY_HEADER]: relay.token };
  if (relay.cityId !== null) {
    headers[AUTH_CITY_HEADER] = relay.cityId;
    headers[UBI_CITY_HEADER] = relay.cityId;
  }
  if (relay.requestId !== null) {
    headers[REQUEST_ID_HEADER] = relay.requestId;
  }
  return headers;
}
