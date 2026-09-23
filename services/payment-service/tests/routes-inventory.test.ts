/**
 * Route-inventory tripwire (G14).
 *
 * The OLD payment surfaces — /wallets, /payments, /payouts, /mobile-money,
 * /webhooks, plus the deferred /b2b, /loyalty and /drivers — are quarantined
 * out of the build and unmounted (QUARANTINE.md). Several of them carried
 * fail-OPEN service-key checks (`serviceKey !== process.env.INTERNAL_SERVICE_KEY`
 * passes when both are undefined), so remounting one may never happen by
 * accident.
 *
 * src/index.ts therefore mounts every router through ONE explicit registry and
 * exports MOUNTED_ROUTE_PREFIXES. This test pins that allowlist and checks the
 * live Hono route table against it: a new mount, or a resurrected legacy
 * mount, fails here first and has to be a reviewed decision.
 */
import { describe, expect, it } from "vitest";

import app, { MOUNTED_ROUTE_PREFIXES } from "../src/index";

/** The supported surface. Changing this list IS the review. */
const ALLOWED_ROUTE_PREFIXES = [
  "/health",
  "/fraud",
  "/safety",
  "/admin",
  "/v1/wallet/mp",
  "/v1/wallet",
  // Supplier travel payments (P7/T02) — service-key, canonical ledger;
  // mounted ahead of /v1/finance so the recon admin guards do not shadow it.
  "/v1/finance/travel",
  "/v1/finance",
  "/v1/finance/remedies",
] as const;

/**
 * The quarantined prefixes, enumerated from QUARANTINE.md:
 * - superseded by the canonical /v1 ledger: the OLD /wallets route
 *   (src/routes/wallet.ts), /payments, /payouts, /mobile-money, /webhooks;
 * - deferred until after launch: /b2b, /loyalty, /drivers.
 */
const QUARANTINED_ROUTE_PREFIXES = [
  "/wallets",
  "/payments",
  "/payouts",
  "/mobile-money",
  "/webhooks",
  "/b2b",
  "/loyalty",
  "/drivers",
] as const;

function underPrefix(path: string, prefix: string): boolean {
  return (
    path === prefix || path === `${prefix}/*` || path.startsWith(`${prefix}/`)
  );
}

/** Concrete registered paths, with global middleware wildcards left out. */
function registeredPaths(): string[] {
  return app.routes
    .map((route) => route.path)
    .filter((path) => path !== "*" && path !== "/*");
}

describe("payment-service route inventory", () => {
  it("exports the explicit registry the routers are mounted from", () => {
    expect([...MOUNTED_ROUTE_PREFIXES]).toEqual([...ALLOWED_ROUTE_PREFIXES]);
  });

  it("exposes NO route under any quarantined legacy prefix", () => {
    const offenders = registeredPaths().filter((path) =>
      QUARANTINED_ROUTE_PREFIXES.some((prefix) => underPrefix(path, prefix)),
    );
    expect(offenders).toEqual([]);
  });

  it("registers every route under the explicit allowlist", () => {
    const strays = registeredPaths().filter(
      (path) =>
        !ALLOWED_ROUTE_PREFIXES.some((prefix) => underPrefix(path, prefix)),
    );
    expect(strays).toEqual([]);
  });

  it("actually mounts the supported surface (the allowlist is not vacuous)", () => {
    const paths = registeredPaths();
    for (const prefix of ALLOWED_ROUTE_PREFIXES) {
      expect(
        paths.some((path) => underPrefix(path, prefix)),
        `expected at least one route under ${prefix}`,
      ).toBe(true);
    }
  });

  it("mounts the post-award amendment money routes inside the service-key families", () => {
    // A02 item 5: commission deltas live under /v1/wallet/mp/holds and rider
    // funding amendments under /v1/wallet/mp/funding — the two prefixes the
    // router guards with internalServiceAuth and the gateway restricts to
    // admin:all. A move out of either family must be a reviewed decision.
    const paths = app.routes.map((route) => `${route.method} ${route.path}`);
    const amendmentRoutes = [
      "POST /v1/wallet/mp/holds/:id/amendments/:amendmentId/reserve",
      "POST /v1/wallet/mp/holds/:id/amendments/:amendmentId/capture",
      "POST /v1/wallet/mp/holds/:id/amendments/:amendmentId/release",
      "POST /v1/wallet/mp/holds/:id/amendments/:amendmentId/refund",
      "POST /v1/wallet/mp/funding/top-up",
      "POST /v1/wallet/mp/funding/top-up/commit",
      "POST /v1/wallet/mp/funding/top-up/release",
      "POST /v1/wallet/mp/funding/partial-release",
    ];
    for (const route of amendmentRoutes) {
      expect(paths).toContain(route);
    }
    const guards = app.routes
      .filter((route) => route.method === "ALL")
      .map((route) => route.path);
    expect(guards).toContain("/v1/wallet/mp/holds/*");
    expect(guards).toContain("/v1/wallet/mp/funding/*");
  });

  it.each([
    ["GET", "/wallets"],
    ["GET", "/wallets/balance"],
    ["POST", "/payments/initiate"],
    ["GET", "/payouts"],
    ["POST", "/mobile-money/collect"],
    ["POST", "/webhooks/paystack"],
    ["GET", "/b2b/accounts"],
    ["GET", "/loyalty/points"],
    ["GET", "/drivers/earnings"],
  ])("answers 404 for the quarantined %s %s", async (method, path) => {
    const response = await app.fetch(
      new Request(`http://payment-service.test${path}`, { method }),
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as {
      error?: { code?: string };
    };
    expect(body.error?.code).toBe("NOT_FOUND");
  });
});
