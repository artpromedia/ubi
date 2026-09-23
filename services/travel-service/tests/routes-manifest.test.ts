/**
 * Route manifest (G1 — gateway reachability).
 *
 * `tests/routes.manifest` is the durable record of every METHOD + Hono path
 * this service serves. The API gateway's contract test
 * (services/api-gateway/tests/route-contract.test.ts) reads it to prove every
 * gateway proxy rule for travel-service lands on a route that exists here —
 * and that the supplier webhook route below is NOT reachable through the
 * client gateway. Until round 6 no gateway rule reached travel-service at all:
 * `/v1/travel`, `/v1/reservations` and `/v1/ops/travel` answered the gateway's
 * own 404 to every client.
 *
 * The manifest is read off the REAL app (src/index.ts `createApp`, the same
 * router production serves) with Hono's own route inspector; middleware
 * entries (`use()` guards, the identity middleware) are left out, so every
 * line is a route a request can actually terminate on. Building the app
 * touches neither the database nor the network.
 *
 * Stale manifest → regenerate:
 *   UPDATE_ROUTE_MANIFEST=1 pnpm --filter @ubi/travel-service exec vitest run tests/routes-manifest.test.ts
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { inspectRoutes } from "hono/dev";
import { afterAll, describe, expect, it } from "vitest";

import { closeTestDb, makeDeps, testDb } from "./helpers";
import { createApp } from "../src/index";

const MANIFEST_PATH = path.resolve(__dirname, "routes.manifest");
const REGENERATE =
  "UPDATE_ROUTE_MANIFEST=1 pnpm --filter @ubi/travel-service exec vitest run tests/routes-manifest.test.ts";
const HEADER = [
  "# travel-service route manifest: every METHOD + Hono path the production",
  "# app (src/index.ts createApp) serves; middleware is left out.",
  "# GENERATED — do not edit by hand.",
  `# Regenerate: ${REGENERATE}`,
  "# Read by services/api-gateway/tests/route-contract.test.ts.",
];

afterAll(closeTestDb);

function servedRoutes(): string[] {
  const app = createApp(makeDeps(testDb()).deps);
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

describe("travel-service route manifest", () => {
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

  it("serves the families the gateway's travel-service proxy rules forward to", () => {
    // A truncated inspection (a router dropped from createApp, a sub-router
    // that stopped registering) must not regenerate into a manifest that
    // quietly loses what the rider app, the web app and the admin console
    // call through the gateway.
    const routes = servedRoutes();
    for (const route of [
      "POST /v1/travel/flights/searches",
      "POST /v1/travel/carts/:id/checkout",
      "GET /v1/travel/orders/:id",
      "GET /v1/travel/trips/:id",
      "POST /v1/reservations",
      "GET /v1/reservations",
      "GET /v1/ops/travel/exceptions",
      "GET /health",
    ]) {
      expect(routes).toContain(route);
    }
    // The supplier callback is served here — and only here: the gateway
    // test pins that no client proxy rule reaches it.
    expect(routes).toContain("POST /v1/travel/webhooks/:supplierId");
  });
});
