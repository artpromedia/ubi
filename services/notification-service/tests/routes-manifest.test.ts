/**
 * Route manifest (G1 / CC-B04 — gateway reachability).
 *
 * `tests/routes.manifest` is the durable record of every METHOD + Hono path
 * `notification-service` serves. `services/api-gateway/tests/route-contract.test.ts`
 * reads it to prove:
 *   1. Every client route forwarded to `notification-service` (`/v1/notifications/*`
 *      and the exact push device routes `/v1/push/devices`, `/v1/push/devices/:token`)
 *      lands on a route this service actually serves.
 *   2. Every service-to-service push route (`POST /api/v1/push/send`,
 *      `POST /api/v1/push/batch`, `POST /api/v1/push/topic`) exists here while
 *      answering the gateway's own 404.
 *
 * Stale manifest → regenerate:
 *   UPDATE_ROUTE_MANIFEST=1 pnpm --filter @ubi/notification-service exec vitest run tests/routes-manifest.test.ts
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { inspectRoutes } from "hono/dev";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Hono } from "hono";

const MANIFEST_PATH = path.resolve(__dirname, "routes.manifest");
const REGENERATE =
  "UPDATE_ROUTE_MANIFEST=1 pnpm --filter @ubi/notification-service exec vitest run tests/routes-manifest.test.ts";
const HEADER = [
  "# notification-service route manifest: every METHOD + Hono path the production",
  "# app (src/app.ts) serves; middleware is left out.",
  "# GENERATED — do not edit by hand.",
  `# Regenerate: ${REGENERATE}`,
  "# Read by services/api-gateway/tests/route-contract.test.ts.",
];

let app: Hono;
let cleanupRedis: (() => Promise<void>) | undefined;

beforeAll(async () => {
  process.env.LOG_LEVEL = "silent";
  const { createApp } = await import("../src/app.js");
  const { closeConnections } = await import("../src/lib/redis.js");
  app = createApp();
  cleanupRedis = closeConnections;
});

afterAll(async () => {
  if (cleanupRedis) {
    await cleanupRedis().catch(() => undefined);
  }
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

describe("notification-service route manifest", () => {
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
        `Regenerate with ${REGENERATE}, then run the api-gateway route contract test (pnpm --filter @ubi/api-gateway test).`,
      ].join("\n"),
    );
  });

  it("serves both client device routes and service-only push-send routes", () => {
    const routes = servedRoutes();
    for (const route of [
      "GET /health",
      "GET /api/v1/notifications",
      "POST /api/v1/push/devices",
      "DELETE /api/v1/push/devices",
      "DELETE /api/v1/push/devices/:token",
      "POST /api/v1/push/send",
      "POST /api/v1/push/batch",
      "POST /api/v1/push/topic",
    ]) {
      expect(routes).toContain(route);
    }
  });
});
