/**
 * Admin config & feature-flag routes (DEC-1 = A, CC-B01).
 *
 * Served strictly by exact HTTP method + path (like `routes/config-read.ts`),
 * NEVER by a `PROXY_RULES` wildcard. Every route here requires `config:admin`
 * in `identity/scopes.ts` (held ONLY by `CONFIG_ADMIN_ROLES`: `config_admin`,
 * `ops_admin`, `admin`, `super_admin`; never in `LIMITED_MODE_SCOPES`; and
 * excluded from `SAFE_MODE_DENIED_SCOPES` so the `marketplace_rides` kill
 * switch keeps working when Redis is unreachable).
 *
 * `config-service` independently verifies the signed `x-ubi-identity` JWS and
 * enforces `CONFIG_ADMIN_ROLES`, `config:admin`, non-`limited` mode,
 * `Idempotency-Key`, and 2-approver dual approval on city config patches.
 */
import { Hono, type Context } from "hono";

import { forwardToServicePath } from "./proxy";

export interface ConfigAdminRoute {
  readonly method: "GET" | "POST" | "PUT";
  /** Hono pattern under the gateway's `/v1` mount. */
  readonly pattern: string;
  /**
   * `config-service`'s own path for this route. Absent: the gateway path
   * unchanged (`config-service` mounts `/v1/config` and `/v1/flags` itself).
   */
  readonly downstream?: string;
  /** Who calls it. */
  readonly source: string;
}

export const CONFIG_ADMIN_ROUTES: readonly ConfigAdminRoute[] = [
  {
    method: "PUT",
    pattern: "/flags/:key{[A-Za-z0-9_.-]+}",
    source:
      "apps/admin-dashboard src/lib/marketplace-api.ts (kill switch & flags)",
  },
  {
    method: "GET",
    pattern: "/config/cities",
    source: "apps/admin-dashboard city config & status console",
  },
  {
    method: "GET",
    pattern: "/config/cities/:cityId{[A-Za-z0-9_-]+}/history",
    source: "apps/admin-dashboard src/lib/marketplace-api.ts",
  },
  {
    method: "POST",
    pattern: "/config/cities/status",
    source: "apps/admin-dashboard city launch status console",
  },
  {
    method: "GET",
    pattern: "/config/change-requests",
    source: "apps/admin-dashboard src/lib/marketplace-api.ts (pending queue)",
  },
  {
    method: "POST",
    pattern: "/config/change-requests",
    source: "apps/admin-dashboard src/lib/marketplace-api.ts",
  },
  {
    method: "POST",
    pattern: "/config/change-requests/:id{[A-Za-z0-9_-]+}/approve",
    source: "apps/admin-dashboard src/lib/marketplace-api.ts",
  },
  {
    method: "POST",
    pattern: "/config/change-requests/:id{[A-Za-z0-9_-]+}/reject",
    source: "apps/admin-dashboard src/lib/marketplace-api.ts",
  },
];

const configAdminRoutes = new Hono();

for (const route of CONFIG_ADMIN_ROUTES) {
  const handler = async (c: Context): Promise<Response> => {
    const response = await forwardToServicePath(
      "config-service",
      route.downstream ?? c.req.path,
      c,
    );
    return response;
  };
  if (route.method === "GET") {
    configAdminRoutes.get(route.pattern, handler);
  } else if (route.method === "POST") {
    configAdminRoutes.post(route.pattern, handler);
  } else {
    configAdminRoutes.put(route.pattern, handler);
  }
}

export { configAdminRoutes };
