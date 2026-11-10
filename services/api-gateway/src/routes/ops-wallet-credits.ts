/**
 * Audited operations driver wallet credit routes (DEC-6 = C, CC-B03).
 *
 * Served strictly by exact HTTP method + path (like `routes/config-admin.ts`),
 * NEVER by a `PROXY_RULES` wildcard. Every route here requires `finance:ops`
 * in `identity/scopes.ts` (held ONLY by `OPS_CREDIT_ROLES`: `finance_ops`,
 * `ops_admin`, `admin`, `super_admin`; never in `LIMITED_MODE_SCOPES`, and
 * excluded from `ROLE_SCOPES.service`).
 *
 * `payment-service` independently verifies the signed `x-ubi-identity` JWS and
 * enforces `OPS_CREDIT_ROLES`, non-`limited` mode, `ops_driver_wallet_credit`
 * flag, `Idempotency-Key`, city caps, and two-person approval (`approved_by <> created_by`).
 */
import { Hono, type Context } from "hono";

import { forwardToServicePath } from "./proxy";

export interface OpsWalletCreditRoute {
  readonly method: "GET" | "POST";
  /** Hono pattern under the gateway's `/v1` mount. */
  readonly pattern: string;
  /** Who calls it. */
  readonly source: string;
}

export const OPS_WALLET_CREDIT_ROUTES: readonly OpsWalletCreditRoute[] = [
  {
    method: "GET",
    pattern: "/ops/wallet-credits",
    source: "apps/admin-dashboard src/lib/ops-credits-api.ts (list queue)",
  },
  {
    method: "POST",
    pattern: "/ops/wallet-credits",
    source: "apps/admin-dashboard src/lib/ops-credits-api.ts (request credit)",
  },
  {
    method: "GET",
    pattern: "/ops/wallet-credits/:id{[A-Za-z0-9_-]+}",
    source: "apps/admin-dashboard src/lib/ops-credits-api.ts (credit detail)",
  },
  {
    method: "POST",
    pattern: "/ops/wallet-credits/:id{[A-Za-z0-9_-]+}/approve",
    source:
      "apps/admin-dashboard src/lib/ops-credits-api.ts (dual-approval post)",
  },
  {
    method: "POST",
    pattern: "/ops/wallet-credits/:id{[A-Za-z0-9_-]+}/reject",
    source: "apps/admin-dashboard src/lib/ops-credits-api.ts (reject pending)",
  },
  {
    method: "POST",
    pattern: "/ops/wallet-credits/:id{[A-Za-z0-9_-]+}/reverse",
    source:
      "apps/admin-dashboard src/lib/ops-credits-api.ts (reverse approved)",
  },
];

const opsWalletCreditRoutes = new Hono();

for (const route of OPS_WALLET_CREDIT_ROUTES) {
  const handler = async (c: Context): Promise<Response> => {
    const response = await forwardToServicePath(
      "payment-service",
      c.req.path,
      c,
    );
    return response;
  };
  if (route.method === "GET") {
    opsWalletCreditRoutes.get(route.pattern, handler);
  } else {
    opsWalletCreditRoutes.post(route.pattern, handler);
  }
}

export { opsWalletCreditRoutes };
