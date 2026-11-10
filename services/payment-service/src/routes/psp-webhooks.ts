/**
 * `/v1/psp/webhooks` — Payment Service Provider supplier webhook ingress
 * (CC-B03, DEC-6 Part A).
 *
 * Supplier webhooks are NEVER proxied through `api-gateway` (pinned in
 * `services/api-gateway/tests/route-contract.test.ts` as `SERVICE_ONLY_ROUTES`
 * and routed directly via `{$WEBHOOKS_DOMAIN:hooks.ubi.africa}` in
 * `infrastructure/hetzner/caddy/Caddyfile` with internal identity headers
 * stripped).
 *
 * Authentication is strictly cryptographic HMAC-SHA512 over the exact raw
 * UTF-8 request bytes (`x-paystack-signature`) before JSON parsing.
 */
import { Hono, type Context } from "hono";

import { ContractError } from "@ubi/contracts";

import { handlePaystackWebhook } from "../ledger/paystack";
import { walletLogger } from "../lib/logger";

import type { WalletDeps } from "../ledger/context";

function fail(c: Context, error: unknown): Response {
  if (error instanceof ContractError) {
    return c.json(error.toBody(), error.status as 200);
  }
  walletLogger.error({ err: error }, "unhandled PSP webhook error");
  return c.json(
    {
      code: "internal_error",
      message: "something went wrong handling that webhook",
    },
    500,
  );
}

export function createPspWebhookRoutes(deps: WalletDeps): Hono {
  const routes = new Hono();

  routes.post("/paystack", async (c) => {
    try {
      const rawBody = await c.req.text();
      const signature = c.req.header("x-paystack-signature");
      const outcome = await handlePaystackWebhook(deps, rawBody, signature);
      c.header("Cache-Control", "no-store");
      return c.json(outcome, 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  return routes;
}
