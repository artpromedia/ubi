/**
 * Route manifest (G1 — gateway reachability, CC-A12 / P2-10).
 *
 * `tests/routes.manifest` is the durable record of every METHOD + Hono path
 * growth-service serves. The API gateway's contract test
 * (services/api-gateway/tests/route-contract.test.ts) reads it to prove every
 * gateway proxy rule for growth-service lands on a route that exists here —
 * and that `/v1/ai/marketing/*` stays unproxied at the client gateway.
 *
 * Stale manifest → regenerate:
 *   UPDATE_ROUTE_MANIFEST=1 pnpm --filter @ubi/growth-service exec vitest run tests/routes-manifest.test.ts
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
  "UPDATE_ROUTE_MANIFEST=1 pnpm --filter @ubi/growth-service exec vitest run tests/routes-manifest.test.ts";
const HEADER = [
  "# growth-service route manifest: every METHOD + Hono path the production",
  "# app (src/index.ts createApp) serves; middleware is left out.",
  "# GENERATED — do not edit by hand.",
  `# Regenerate: ${REGENERATE}`,
  "# Read by services/api-gateway/tests/route-contract.test.ts.",
];

afterAll(closeTestDb);

function servedRoutes(): string[] {
  const db = testDb();
  const app = createApp(makeDeps(db));
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

describe("growth-service route manifest", () => {
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

  it("serves the families the gateway's growth-service rules forward to", () => {
    const routes = servedRoutes();
    for (const route of [
      "GET /v1/benefits",
      "GET /v1/benefits/changes/:changeId",
      "GET /v1/referrals",
      "POST /v1/referrals/share",
      "GET /v1/referrals/:id",
      "POST /v1/attribution/claim",
      "GET /v1/driver/incentives",
      "GET /v1/driver/incentives/:id",
      "GET /v1/driver/statements/:periodId",
      "GET /v1/growth/campaigns",
      "POST /v1/growth/campaigns",
      "GET /v1/growth/campaigns/:id",
      "POST /v1/growth/campaigns/:id/versions/:v/simulate",
      "POST /v1/growth/campaigns/:id/versions/:v/submit",
      "POST /v1/growth/campaigns/:id/actions",
      "GET /v1/growth/campaigns/:id/versions/:v/outcome",
      "GET /v1/growth/commission-incentives/live",
      "GET /v1/growth/referrals/review-queue",
      "POST /v1/growth/referrals/review-queue/:caseId/decision",
      "GET /v1/growth/recon/:date",
      "POST /v1/ai/marketing/threads/:threadId/messages",
      "GET /health",
    ]) {
      expect(routes).toContain(route);
    }
  });
});
