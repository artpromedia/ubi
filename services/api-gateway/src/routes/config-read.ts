/**
 * Read-only config routes — the app-facing GET config family (`profile:read`).
 *
 * The apps read deny-by-default flags and their city's active config through
 * the gateway (`packages/mobile-core` `src/flags.ts` and `src/config.ts`; the
 * admin dashboard's policy page reads the same city config).
 *
 * Why this is not a `PROXY_RULES` wildcard: `config-service` also serves admin
 * flag flips (`PUT /v1/flags/{key}`), the city list, change requests and their
 * dual-approval / rejection, city status changes, and config history. Those
 * admin routes are mounted separately by exact method + path in
 * `routes/config-admin.ts` behind `config:admin` (DEC-1 = A, CC-B01). Every
 * unrouted path or method under `/v1/config` or `/v1/flags` (such as
 * `GET /v1/flags` or `DELETE /v1/flags/{key}`) answers the gateway's own 404
 * (`tests/route-contract.test.ts` pins both sides against `config-service`'s
 * route manifest).
 *
 * Identity, rate limiting and scope enforcement are the same as for every
 * proxied request: these routes are mounted on the authenticated `/v1` app
 * after the identity middleware, and `forwardToServicePath` (`routes/proxy.ts`)
 * forwards the signed `x-ubi-identity` JWS so `config-service` evaluates flags
 * for the caller and refuses a `userId` query naming somebody else.
 */
import { Hono, type Context } from "hono";

import { forwardToServicePath } from "./proxy";

export interface ConfigReadRoute {
  /** Hono pattern under the gateway's `/v1` mount. GET (and so HEAD) only. */
  readonly pattern: string;
  /**
   * config-service's own path for this route. Absent: the gateway path
   * unchanged (config-service mounts `/v1/config` itself).
   */
  readonly downstream?: string;
  /** Who calls it. */
  readonly source: string;
}

export const CONFIG_READ_ROUTES: readonly ConfigReadRoute[] = [
  // Evaluated flags for the caller in a city (`?cityId=`). The app-facing path
  // is /v1/config/flags; config-service serves it as GET /v1/flags, whose PUT
  // sibling (the flag flip) is exactly what must not be reachable.
  {
    pattern: "/config/flags",
    downstream: "/v1/flags",
    source: "packages/mobile-core src/flags.ts",
  },
  // The city's active config version. The id is constrained here so that
  // `/config/cities/LOS/history` (admin-only) never matches.
  {
    pattern: "/config/cities/:cityId{[A-Za-z0-9_-]+}",
    source: "packages/mobile-core src/config.ts",
  },
];

const configReadRoutes = new Hono();

for (const route of CONFIG_READ_ROUTES) {
  configReadRoutes.get(route.pattern, async (c: Context): Promise<Response> => {
    const response = await forwardToServicePath(
      "config-service",
      route.downstream ?? c.req.path,
      c,
    );
    return response;
  });
}

export { configReadRoutes };
