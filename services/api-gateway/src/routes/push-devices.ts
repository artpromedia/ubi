/**
 * Exact push device registration routes (CC-B04 / P1-13).
 *
 * Served strictly by exact HTTP method + path (like `routes/config-read.ts`
 * and `routes/ops-wallet-credits.ts`), NEVER by a `/push/*` wildcard:
 * `notification-service` also mounts service-only `POST /api/v1/push/send`,
 * `POST /api/v1/push/batch`, and `POST /api/v1/push/topic`, which must never be
 * reachable from the client gateway.
 *
 * Every route here is gated by `profile:read` in `identity/scopes.ts` (held by
 * every authenticated role and kept in `LIMITED_MODE_SCOPES` so an unverified
 * device still receives ride and security notifications), and forwards the
 * gateway-signed `x-ubi-identity` context to `notification-service`, which
 * binds the token strictly to `sub`.
 */
import { Hono, type Context } from "hono";

import { forwardToServicePath } from "./proxy";

export interface PushDeviceRoute {
  readonly method: "POST" | "DELETE";
  /** Hono pattern under the gateway's `/v1` mount. */
  readonly pattern: string;
  /** Who calls it. */
  readonly source: string;
}

export const PUSH_DEVICE_ROUTES: readonly PushDeviceRoute[] = [
  {
    method: "POST",
    pattern: "/push/devices",
    source:
      "packages/mobile-core src/push.ts (rider-mobile & driver-mobile post-login FCM registration)",
  },
  {
    method: "DELETE",
    pattern: "/push/devices",
    source:
      "packages/mobile-core src/push.ts (rider-mobile & driver-mobile logout FCM unregistration)",
  },
  {
    method: "DELETE",
    pattern: "/push/devices/:token{[^/]+}",
    source:
      "packages/mobile-core src/push.ts (URL-encoded token path unregistration)",
  },
];

const pushDeviceRoutes = new Hono();

for (const route of PUSH_DEVICE_ROUTES) {
  const handler = async (c: Context): Promise<Response> => {
    const downstream = c.req.path.replace(/^\/v1(?=\/|$)/, "/api/v1");
    const response = await forwardToServicePath(
      "notification-service",
      downstream,
      c,
    );
    return response;
  };
  if (route.method === "POST") {
    pushDeviceRoutes.post(route.pattern, handler);
  } else {
    pushDeviceRoutes.delete(route.pattern, handler);
  }
}

export { pushDeviceRoutes };
