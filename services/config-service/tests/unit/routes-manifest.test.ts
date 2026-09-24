/**
 * Route manifest (gateway reachability).
 *
 * `tests/routes.manifest` is the durable record of every METHOD + Hono path
 * config-service serves. The API gateway's contract test
 * (services/api-gateway/tests/route-contract.test.ts) reads it to prove the
 * gateway's read-only config routes (services/api-gateway/src/routes/
 * config-read.ts) land on routes that exist here — and that the write and
 * admin routes (flag flips, change requests, city status, history) are NOT
 * reachable through the client gateway.
 *
 * The manifest is read off the REAL app (src/app.ts `buildApp`) with Hono's
 * own route inspector; middleware entries are left out. Building the app
 * touches neither the database nor the network.
 *
 * Stale manifest → regenerate:
 *   UPDATE_ROUTE_MANIFEST=1 pnpm --filter @ubi/config-service exec vitest run tests/unit/routes-manifest.test.ts
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { inspectRoutes } from "hono/dev";
import { describe, expect, it } from "vitest";

import { buildApp } from "@/app";

const MANIFEST_PATH = path.resolve(__dirname, "..", "routes.manifest");
const REGENERATE =
  "UPDATE_ROUTE_MANIFEST=1 pnpm --filter @ubi/config-service exec vitest run tests/unit/routes-manifest.test.ts";
const HEADER = [
  "# config-service route manifest: every METHOD + Hono path the production",
  "# app (src/app.ts buildApp) serves; middleware is left out.",
  "# GENERATED — do not edit by hand.",
  `# Regenerate: ${REGENERATE}`,
  "# Read by services/api-gateway/tests/route-contract.test.ts.",
];

function servedRoutes(): string[] {
  const lines = new Set<string>();
  for (const route of inspectRoutes(buildApp())) {
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

describe("config-service route manifest", () => {
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
    throw new Error(
      [
        "tests/routes.manifest is stale.",
        `  served but not in the manifest: ${JSON.stringify([...want].filter((route) => !have.has(route)))}`,
        `  in the manifest but not served: ${JSON.stringify([...have].filter((route) => !want.has(route)))}`,
        `Regenerate with ${REGENERATE}, then run the api-gateway route contract test.`,
      ].join("\n"),
    );
  });

  it("serves the reads the gateway forwards and the admin routes it never does", () => {
    const routes = servedRoutes();
    for (const route of [
      "GET /v1/flags",
      "GET /v1/config/cities",
      "GET /v1/config/cities/:cityId",
      "PUT /v1/flags/:key",
      "POST /v1/config/cities/status",
      "GET /v1/config/cities/:cityId/history",
      "POST /v1/config/change-requests",
      "POST /v1/config/change-requests/:id/approve",
    ]) {
      expect(routes, route).toContain(route);
    }
  });
});
