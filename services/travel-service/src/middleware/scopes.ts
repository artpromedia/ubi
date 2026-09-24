/**
 * The gateway's travel scopes, re-checked on the signed context (defense in
 * depth).
 *
 * The API gateway refuses a money-moving travel route to a session without
 * `travel:book` (services/api-gateway/src/identity/scopes.ts), and limited
 * mode — a new, unverified device — strips `travel:book` from every session.
 * That table is only as good as the path to this service: a caller who
 * reaches travel-service without passing it (ask-service relaying the user's
 * context, another internal hop, a future proxy rule) must not be able to
 * price a cart, authorize the wallet, cancel for a refund or switch for a
 * charge on a context that did not grant it.
 *
 * So every WRITE under `/v1/travel` is refused unless the verified context
 * carries `travel:book` and is not in limited mode. That covers today's five
 * money-moving routes — POST /carts, PUT /carts/:id/passengers,
 * POST /carts/:id/checkout, POST /orders/:id/cancel, POST /orders/:id/switch
 * — and, deny-by-default, any write added later. The two exceptions are the
 * searches, which are reads the gateway allows under `travel:read`
 * (limited mode keeps them), and the supplier webhooks, which never pass the
 * gateway-identity middleware at all (each supplier's own signature,
 * routes/webhooks.ts).
 *
 * Without a verified context — the documented unsigned development mode,
 * never production (./auth.ts refuses that path there) — the scopes are
 * unknown and the flags alone decide, exactly as for the transfer routes'
 * `mp:request` check (./transfer-auth.ts).
 */
import { ContractError } from "@ubi/contracts";

import type { Context } from "hono";

/** The scope a session needs to move travel money (gateway scopes.ts). */
export const TRAVEL_BOOK_SCOPE = "travel:book";

const TRAVEL_PREFIX = "/v1/travel/";
const WRITE_METHODS: ReadonlySet<string> = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

/** Writes that are reads in disguise: the gateway allows them on travel:read. */
const SEARCH_PATHS: ReadonlySet<string> = new Set([
  "/v1/travel/flights/searches",
  "/v1/travel/stays/searches",
]);

/** Supplier callbacks: their own signatures, never a gateway identity. */
const WEBHOOK_PREFIX = "/v1/travel/webhooks/";

/** Whether this method + path moves (or commits) travel money. */
export function requiresTravelBook(method: string, path: string): boolean {
  if (!WRITE_METHODS.has(method.toUpperCase())) {
    return false;
  }
  if (!path.startsWith(TRAVEL_PREFIX)) {
    return false;
  }
  if (SEARCH_PATHS.has(path) || path.startsWith(WEBHOOK_PREFIX)) {
    return false;
  }
  return true;
}

/**
 * Refuses a money-moving travel request the signed context does not allow.
 * Limited mode is refused as such (`limited_mode`, so the app can offer the
 * step-up) even if a context somehow carried the scope; otherwise a missing
 * scope is `forbidden` naming the scope required — the gateway's own codes.
 */
export function assertTravelBookAllowed(c: Context): void {
  if (!requiresTravelBook(c.req.method, c.req.path)) {
    return;
  }
  const identity = c.get("identity");
  if (identity === undefined) {
    // ./auth.ts has already refused an unsigned caller in production.
    return;
  }
  if (identity.modes.includes("limited")) {
    throw new ContractError(
      "limited_mode",
      "This device is not verified yet. Finish the security check to book, cancel or change travel.",
      { modes: [...identity.modes], required: [TRAVEL_BOOK_SCOPE] },
    );
  }
  if (!identity.scopes.includes(TRAVEL_BOOK_SCOPE)) {
    throw new ContractError(
      "forbidden",
      "This action is not available for your account type",
      { required: [TRAVEL_BOOK_SCOPE] },
    );
  }
}
