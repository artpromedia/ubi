/**
 * Route manifest (G1 — gateway reachability).
 *
 * `tests/routes.manifest` is the durable record of every METHOD + Hono path
 * fleet-service serves. The API gateway's contract test
 * (services/api-gateway/tests/route-contract.test.ts) reads it to prove every
 * gateway proxy rule for fleet-service lands on a route that exists here —
 * and that the service-to-service `/internal/fleet/*` routes are NOT
 * reachable through the client gateway.
 *
 * The manifest is read off the REAL app (src/index.ts `createApp`) with
 * Hono's own route inspector; middleware entries are left out. Building the
 * app touches neither the database nor the network.
 *
 * Stale manifest → regenerate:
 *   UPDATE_ROUTE_MANIFEST=1 pnpm --filter @ubi/fleet-service exec vitest run tests/routes-manifest.test.ts
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { inspectRoutes } from "hono/dev";
import { afterAll, describe, expect, it } from "vitest";

import { closeTestDb, testDb } from "./helpers";
import { createApp } from "../src/index";
import { createCityConfigProvider } from "../src/ops/config";
import { createHttpPinPort } from "../src/ports/pin-port";
import { createHttpRidePort } from "../src/ports/ride-port";

const MANIFEST_PATH = path.resolve(__dirname, "routes.manifest");
const REGENERATE =
  "UPDATE_ROUTE_MANIFEST=1 pnpm --filter @ubi/fleet-service exec vitest run tests/routes-manifest.test.ts";
const HEADER = [
  "# fleet-service route manifest: every METHOD + Hono path the production",
  "# app (src/index.ts createApp) serves; middleware is left out.",
  "# GENERATED — do not edit by hand.",
  `# Regenerate: ${REGENERATE}`,
  "# Read by services/api-gateway/tests/route-contract.test.ts.",
];

afterAll(closeTestDb);

function servedRoutes(): string[] {
  const db = testDb();
  const app = createApp({
    db,
    config: createCityConfigProvider(db),
    rides: createHttpRidePort({
      baseUrl: "http://ride.invalid",
      serviceKey: undefined,
    }),
    pins: createHttpPinPort({ baseUrl: "http://user.invalid" }),
    now: () => new Date(),
  });
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

describe("fleet-service route manifest", () => {
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

  it("serves the families the gateway's fleet-service rules forward to, and the internal routes", () => {
    const routes = servedRoutes();
    for (const route of [
      "POST /v1/fleets",
      "GET /v1/fleets/:id/calendar",
      "POST /v1/fleets/:id/maintenance:preview",
      "POST /v1/fleets/:id/assignments/propose",
      "POST /v1/fleet-offers/:offerId/sign",
      "POST /v1/fleet-offers/:offerId/decline",
      "GET /v1/drivers/me/fleet-offers",
      "GET /v1/drivers/me/fleet",
      "GET /v1/drivers/me/schedule",
      "POST /v1/drivers/me/availability:preview",
      "PUT /v1/drivers/me/availability",
      "GET /v1/drivers/me/conflicts/:conflictId",
      "GET /health",
    ]) {
      expect(routes).toContain(route);
    }
    // Service-to-service only: the gateway test pins these as its own 404.
    for (const route of [
      "GET /internal/fleet/drivers/:driverId/vehicle-at",
      "GET /internal/fleet/vehicles/:vehicleId",
      "GET /internal/fleet/settlement-inputs",
    ]) {
      expect(routes).toContain(route);
    }
  });
});
