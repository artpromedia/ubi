/**
 * UBI Fleet Service (addendum A05 — fleet availability, maintenance and
 * assignments; handoff FL-1, FL-3, FL-5, FL-7, FL-9 and the fleet side of
 * FL-2 / FL-6 / FL-8).
 *
 * Owns fleets and staff roles, fleet vehicles, the assignment HISTORY with
 * PIN-signed terms versions, maintenance blocks and off-road reports,
 * driver-authored availability, the conflict centre and the server-composed
 * fleet calendar and driver schedule. It does NOT own bookings or the
 * vehicle occupancy ledger (ride-service, internal contract A) or any money
 * (payment-service settles remittance from internal contract B).
 *
 * Every client route reads its caller, role and city from the API gateway's
 * signed `x-ubi-identity` context (middleware/auth.ts) and is gated by the
 * deny-by-default `fleet` flag; production refuses to boot without
 * UBI_IDENTITY_SECRET and never falls back to plain headers. The internal
 * routes take service keys only and are never proxied by the gateway.
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import { assertIdentityConfigured } from "./lib/identity-context";
import { logger } from "./lib/logger";
import { disconnectPrisma } from "./lib/prisma";
import { disconnectRedis, redis } from "./lib/redis";
import { startOutboxRelay } from "./outbox-runner";
import {
  createDriverFleetRoutes,
  createFleetOfferRoutes,
} from "./routes/driver";
import { createFleetRoutes } from "./routes/fleets";
import { healthRoutes } from "./routes/health";
import { createInternalRoutes } from "./routes/internal";
import { createDeps } from "./wiring";
import { startWorker } from "./worker";

import type { FleetDeps } from "./ops/context";

/** 4015: the first port no service in services/* or the gateway registry uses. */
const PORT = Number.parseInt(process.env.PORT ?? "4015", 10);

export function createApp(deps: FleetDeps): Hono {
  const app = new Hono();
  app.use("*", requestId());
  app.use("*", secureHeaders());

  app.route("/health", healthRoutes);
  app.route("/v1/fleets", createFleetRoutes(deps));
  app.route("/v1/fleet-offers", createFleetOfferRoutes(deps));
  app.route("/v1/drivers/me", createDriverFleetRoutes(deps));
  // Service-to-service only (contract A routes 8-9, contract B).
  app.route("/internal/fleet", createInternalRoutes(deps));
  return app;
}

async function main(): Promise<void> {
  let deps: FleetDeps;
  try {
    if (!assertIdentityConfigured(process.env)) {
      logger.warn(
        "UBI_IDENTITY_SECRET is not set: routes read the plain X-User-ID / X-User-Role headers and answer a signed gateway context 503 (development only)",
      );
    }
    deps = createDeps();
  } catch (error) {
    logger.fatal(
      { err: error },
      "refusing to start: unsafe identity configuration",
    );
    process.stderr.write(
      `fleet-service refusing to start: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    await disconnectPrisma().catch(() => undefined);
    process.exit(1);
  }
  const app = createApp(deps);
  const server = serve({ fetch: app.fetch, port: PORT });
  logger.info({ port: PORT }, "fleet-service listening");
  const relay = startOutboxRelay();
  const worker = startWorker(deps, redis);

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "shutting down");
    worker.stop();
    void relay.stop?.();
    server.close();
    void Promise.allSettled([disconnectPrisma(), disconnectRedis()]).then(
      () => {
        process.exit(0);
      },
    );
  };
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
}

if (process.env.NODE_ENV !== "test") {
  void main();
}
