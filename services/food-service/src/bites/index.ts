/**
 * Bites module entrypoint (slice 05).
 *
 * `src/index.ts` mounts the four sub-apps this file exposes and starts the
 * issue-sweep. Everything the module needs is injected through `BitesDeps`, so
 * the same routes run against the real singletons in production and against a
 * real, isolated database with a fake payment service in the tests.
 */
import { createBitesDeps } from "./wiring.js";
import {
  createCartRoutes,
  createDiscoveryRoutes,
  createMerchantRoutes,
  createOrderRoutes,
} from "./routes.js";
import { sweepDueIssues } from "./services/orders.js";

import type { BitesDeps } from "./context.js";
import type { Hono } from "hono";

export { createBitesDeps } from "./wiring.js";
export {
  createCartRoutes,
  createDiscoveryRoutes,
  createMerchantRoutes,
  createOrderRoutes,
} from "./routes.js";
export { sweepDueIssues } from "./services/orders.js";
export type { BitesDeps } from "./context.js";

export interface BitesModule {
  readonly deps: BitesDeps;
  readonly discovery: Hono;
  readonly merchants: Hono;
  readonly carts: Hono;
  readonly orders: Hono;
}

/** Builds the module's four sub-apps from a set of dependencies. */
export function createBitesModule(deps: BitesDeps = createBitesDeps()): BitesModule {
  return {
    deps,
    discovery: createDiscoveryRoutes(deps),
    merchants: createMerchantRoutes(deps),
    carts: createCartRoutes(deps),
    orders: createOrderRoutes(deps),
  };
}

/**
 * Starts the background sweep that auto-accepts issues whose merchant-response
 * window has passed and refunds them (slice 05). The interval is unref'd so it
 * never keeps the process alive on its own.
 */
export function startIssueSweep(
  deps: BitesDeps,
  intervalMs = Number.parseInt(process.env.BITES_ISSUE_SWEEP_INTERVAL_MS ?? "60000", 10),
): NodeJS.Timeout {
  const timer = setInterval(() => {
    void sweepDueIssues(deps).catch(() => {
      // sweepDueIssues logs its own failures; never let a rejection escape here.
    });
  }, intervalMs);
  timer.unref();
  return timer;
}
