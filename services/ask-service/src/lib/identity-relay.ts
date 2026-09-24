/**
 * The caller's gateway identity, relayed to the services the assistant calls
 * AS the user (today: travel-service).
 *
 * travel-service trusts one caller identity: the gateway-signed
 * `x-ubi-identity` context, required in production (services/travel-service/
 * src/middleware/auth.ts). ask-service cannot mint one — only the gateway
 * holds that role — and must never invent a substitute (a plain
 * `X-User-ID`, a service key standing in for a user). What it CAN do is pass
 * on, unchanged, the context the user's own request arrived with: the gateway
 * signed it for this request, ask-service verified it (middleware/auth.ts),
 * and it names the same user, role, scopes, modes and city the assistant is
 * acting for.
 *
 * WHERE IT COMES FROM. `gatewayAuth` — and nothing else — establishes the
 * relay for the lifetime of one verified request, from the verified context
 * and the header it was read from. It rides an AsyncLocalStorage scope, so:
 *   - no model output or tool argument can reach it (they are plain data and
 *     never touch this module), and no port signature has to carry a bearer
 *     credential through the ops layer;
 *   - it is never persisted: the Actor, the review, the execution and the
 *     outbox/audit rows the ops layer writes never see it;
 *   - work with no inbound request (a background sweep) finds NO relay, and
 *     the travel port then refuses a request-scoped call in production
 *     rather than falling back to anything weaker. Background reads use
 *     travel-service's separate service-key surface instead.
 *
 * HOW LONG IT IS GOOD FOR. The gateway's contexts live 120 seconds
 * (services/api-gateway/src/identity/context.ts). A relayed context is sent
 * as-is and travel-service checks its expiry, so a call made after that
 * window is refused there (401) — the assistant reports it and the user asks
 * again; nothing re-signs or extends it.
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
      /** The `x-ubi-identity` value exactly as the gateway sent it. */
      readonly token: string;
      readonly userId: string;
      readonly role: string;
      /** The context's verified city claim (the mirrors equal it). */
      readonly cityId: string | null;
      readonly requestId: string | null;
    }
  | {
      /**
       * The documented unsigned development mode (no gateway in front; never
       * production — middleware/auth.ts refuses it there).
       */
      readonly kind: "unsigned";
      readonly userId: string;
      readonly role: string;
      readonly cityId: string | null;
      readonly requestId: string | null;
    };

const relayScope = new AsyncLocalStorage<IdentityRelay>();

/** Runs `work` with `relay` as the current request's identity. */
export function runWithIdentityRelay<T>(
  relay: IdentityRelay,
  work: () => T,
): T {
  return relayScope.run(relay, work);
}

/** The identity of the request this code is running for, if any. */
export function currentIdentityRelay(): IdentityRelay | undefined {
  return relayScope.getStore();
}

/**
 * The headers that carry a SIGNED relay onward: the context itself, the two
 * city mirrors the gateway writes from its city claim (only when there is
 * one — the gateway writes none for a city-less token, and travel-service
 * refuses a mirror beside a city-less context), and the request id for
 * correlation. Nothing else: no plain identity mirror, no service key.
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
