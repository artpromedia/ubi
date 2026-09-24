/**
 * Route manifest (G1 — gateway reachability).
 *
 * `tests/routes.manifest` is the durable record of every METHOD + Hono path
 * this service serves. The API gateway's contract test
 * (services/api-gateway/tests/route-contract.test.ts) reads it to prove every
 * gateway proxy rule for user-service lands on a route that exists here —
 * the business-travel `/organizations…` family among them. Until this file,
 * user-service's gateway paths were "checked by hand against the route
 * modules", which is how a rule can point at nothing without CI noticing.
 *
 * The manifest is read off the REAL app — src/index.ts's default export, the
 * same Hono app production serves, with every router mounted in production
 * order — using Hono's own route inspector; middleware entries (`use()`
 * guards such as the service-auth and signed-identity checks) are left out,
 * so every line is a route a request can actually terminate on. Importing
 * src/index.ts also starts its HTTP listener, so PORT is set to 0 first (an
 * ephemeral port nothing talks to); building the routes touches neither the
 * database nor Redis.
 *
 * Stale manifest → regenerate:
 *   UPDATE_ROUTE_MANIFEST=1 pnpm --filter @ubi/user-service exec vitest run tests/routes-manifest.test.ts
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { inspectRoutes } from "hono/dev";
import { beforeAll, describe, expect, it } from "vitest";

import type { Hono } from "hono";

const MANIFEST_PATH = path.resolve(__dirname, "routes.manifest");
const REGENERATE =
  "UPDATE_ROUTE_MANIFEST=1 pnpm --filter @ubi/user-service exec vitest run tests/routes-manifest.test.ts";
const HEADER = [
  "# user-service route manifest: every METHOD + Hono path the production",
  "# app (src/index.ts) serves; middleware is left out.",
  "# GENERATED — do not edit by hand.",
  `# Regenerate: ${REGENERATE}`,
  "# Read by services/api-gateway/tests/route-contract.test.ts.",
];

let app: Hono;

beforeAll(async () => {
  // src/index.ts reads these at import time: an ephemeral listener, the city
  // config endpoint the identity deps insist on (never called here), and the
  // test database / Redis the rest of the suite uses (never queried here).
  process.env.PORT = "0";
  process.env.LOG_LEVEL = "silent";
  process.env.CONFIG_SERVICE_URL ??= "http://config-service.invalid";
  if (process.env.IDENTITY_TEST_DATABASE_URL !== undefined) {
    process.env.DATABASE_URL = process.env.IDENTITY_TEST_DATABASE_URL;
  }
  if (process.env.IDENTITY_TEST_REDIS_URL !== undefined) {
    process.env.REDIS_URL = process.env.IDENTITY_TEST_REDIS_URL;
  }
  // src/index.ts is a CommonJS module whose default export is the app.
  const loaded = (await import("../src/index.js")) as unknown as {
    readonly default: Hono;
  };
  app = loaded.default;
});

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

describe("user-service route manifest", () => {
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

  it("serves the families the gateway's user-service proxy rules forward to", () => {
    // A truncated inspection (a router that stopped registering, a mount
    // dropped from src/index.ts) must not regenerate into a manifest that
    // quietly loses what the apps call through the gateway.
    const routes = servedRoutes();
    for (const route of [
      "GET /health",
      "GET /users/me",
      "POST /devices/enroll",
      "GET /mandates",
      "GET /organizations",
      "POST /organizations",
      "GET /organizations/:orgId",
      "PUT /organizations/:orgId/policy",
      "POST /organizations/invitations/:invitationId/accept",
    ]) {
      expect(routes).toContain(route);
    }
    expect(routes.some((route) => route.startsWith("POST /auth/"))).toBe(true);
    // The service-key surfaces exist (so the gateway test can pin that no
    // rule reaches them) and are never under a client family.
    expect(routes.some((route) => route.includes(" /internal/"))).toBe(true);
  });
});
