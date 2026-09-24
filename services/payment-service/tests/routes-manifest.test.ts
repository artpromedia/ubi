/**
 * Route manifest (G1 — gateway reachability).
 *
 * `tests/routes.manifest` is the durable record of every METHOD + Hono path
 * this service serves. The API gateway's contract test
 * (services/api-gateway/tests/route-contract.test.ts) reads it to prove every
 * gateway proxy rule for payment-service lands on a route that exists here.
 * The round-4 outage was a gateway that stripped `/v1` before forwarding to a
 * service that mounts `/v1/wallet` and `/v1/finance/*` — nothing in CI could
 * see it, because the gateway tests' fake upstream accepted any path.
 *
 * The manifest is read off the REAL app (src/index.ts, the same ROUTER_REGISTRY
 * production serves) with Hono's own route inspector; middleware entries
 * (`use()` guards, validators) are left out, so every line is a route a
 * request can actually terminate on. tests/routes-inventory.test.ts remains the
 * tripwire for WHICH prefixes may be mounted; this file records WHAT is served.
 *
 * Stale manifest → regenerate:
 *   UPDATE_ROUTE_MANIFEST=1 pnpm --filter @ubi/payment-service exec vitest run tests/routes-manifest.test.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { inspectRoutes } from "hono/dev";
import { describe, expect, it } from "vitest";

import app from "../src/index";

const MANIFEST_PATH = path.resolve(__dirname, "routes.manifest");
const REGENERATE =
  "UPDATE_ROUTE_MANIFEST=1 pnpm --filter @ubi/payment-service exec vitest run tests/routes-manifest.test.ts";
const HEADER = [
  "# payment-service route manifest: every METHOD + Hono path the production",
  "# app (src/index.ts ROUTER_REGISTRY) serves; middleware is left out.",
  "# GENERATED — do not edit by hand.",
  `# Regenerate: ${REGENERATE}`,
  "# Read by services/api-gateway/tests/route-contract.test.ts.",
];

function servedRoutes(): string[] {
  const lines = new Set<string>();
  for (const route of inspectRoutes(app)) {
    if (route.isMiddleware) {
      continue;
    }
    lines.add(`${route.method} ${route.path}`);
  }
  return [...lines].sort();
}

function render(routes: readonly string[]): string {
  return `${[...HEADER, ...routes].join("\n")}\n`;
}

function parse(manifest: string): string[] {
  return manifest
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

describe("payment-service route manifest", () => {
  it("matches the routes the real app serves", () => {
    const generated = render(servedRoutes());

    if (process.env.UPDATE_ROUTE_MANIFEST === "1") {
      writeFileSync(MANIFEST_PATH, generated);
      return;
    }

    let committed = "";
    try {
      committed = readFileSync(MANIFEST_PATH, "utf8");
    } catch {
      throw new Error(
        `tests/routes.manifest is missing — regenerate with ${REGENERATE}`,
      );
    }
    if (committed === generated) {
      return;
    }

    const want = new Set(parse(generated));
    const have = new Set(parse(committed));
    const added = [...want].filter((route) => !have.has(route));
    const removed = [...have].filter((route) => !want.has(route));
    throw new Error(
      [
        "tests/routes.manifest is stale: the app serves routes it does not list, or lists routes the app no longer serves.",
        `  served but not in the manifest: ${JSON.stringify(added)}`,
        `  in the manifest but not served: ${JSON.stringify(removed)}`,
        `Regenerate with ${REGENERATE}, then run the api-gateway route contract test (pnpm --filter @ubi/api-gateway test) — a gateway proxy rule that no longer reaches a route fails there.`,
      ].join("\n"),
    );
  });

  it("serves the families the gateway's payment-service proxy rules forward to", () => {
    // A truncated inspection (a registry entry dropped, a sub-router that
    // stopped registering) must not regenerate into a manifest that quietly
    // loses what the driver and rider apps call through the gateway.
    const routes = servedRoutes();
    for (const route of [
      "GET /v1/wallet",
      "GET /v1/wallet/mp/overview",
      "GET /health",
    ]) {
      expect(routes).toContain(route);
    }
    expect(routes.some((route) => route.includes(" /v1/finance/"))).toBe(true);
    // Nothing under a quarantined legacy prefix (routes-inventory.test.ts is
    // the tripwire; this keeps the manifest itself honest).
    expect(
      routes.filter((route) =>
        /^\w+ \/(wallets|payments|payouts|mobile-money|webhooks)(\/|$)/.test(
          route,
        ),
      ),
    ).toEqual([]);
  });
});
