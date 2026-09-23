/**
 * UBI Travel Service (slice NEW-02 — supplier-adapter flights and stays).
 *
 * Owns:
 *  - flight and stay searches behind FlightSupplyAdapter / StaySupplyAdapter,
 *    where every promise on an offer is an adapter capability record;
 *  - carts and a checkout that revalidates every item and creates PER-ITEM
 *    orders with no atomicity across suppliers;
 *  - the explicit order ladder (payment_authorized → submitted → supplier_pending
 *    → confirmed → ticketed | failed_released | unknown_reconciling), resolved
 *    from unknown ONLY by a lookup on UBI's own reference;
 *  - refunds, disruptions and ₦0 switching (only under a funded rule), verified
 *    and deduped supplier webhooks, settlement differences, commercial rates;
 *  - airport transfers: intents linked to a flight order, made into Book for
 *    Later scheduled ride requests on ride-service (signed as the traveller)
 *    and `awarded` only once ride-service reports a requester-approved award.
 *
 * The double-entry ledger is NOT here: travel money moves through a typed
 * PaymentPort HTTP call to payment-service.
 *
 * Every client and ops route reads its caller, role and city from the API
 * gateway's signed `x-ubi-identity` context (middleware/auth.ts); production
 * refuses to boot without UBI_IDENTITY_SECRET and never falls back to plain
 * headers. Supplier webhooks keep their own per-supplier signatures and are
 * never forwarded by the gateway (suppliers call this service directly).
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import { assertProductionSupplyConfig } from "./adapters/production-guard";
import { assertIdentityConfigured } from "./lib/identity-context";
import { logger } from "./lib/logger";
import { disconnectPrisma } from "./lib/prisma";
import { disconnectRedis } from "./lib/redis";
import { healthRoutes } from "./routes/health";
import { createOpsRoutes } from "./routes/ops";
import { createReservationRoutes } from "./routes/reservations";
import { createTravelRoutes } from "./routes/travel";
import { createWebhookRoutes } from "./routes/webhooks";
import { startTransferWorker } from "./transfer-worker";
import { createDeps } from "./wiring";

import type { TravelDeps } from "./ops/context";

const PORT = Number.parseInt(process.env.PORT ?? "4012", 10);

export function createApp(deps: TravelDeps): Hono {
  const app = new Hono();

  app.use("*", requestId());
  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: (origin) => {
        const allowed = ["https://admin.ubi.africa", "https://app.ubi.africa"];
        if (
          !origin ||
          allowed.includes(origin) ||
          /^http:\/\/localhost:\d+$/.test(origin)
        ) {
          return origin || "";
        }
        return "";
      },
      allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "Idempotency-Key",
        "X-Request-ID",
        "X-User-ID",
        "X-User-Role",
        "X-City-ID",
        "X-Signature",
      ],
      credentials: true,
      maxAge: 600,
    }),
  );

  app.route("/health", healthRoutes);
  app.route("/v1/travel/webhooks", createWebhookRoutes(deps));
  app.route("/v1/travel", createTravelRoutes(deps));
  // Airport transfers: every route behind the deny-by-default `reservations`
  // flag for the request's city (checked per request in the router).
  app.route("/v1/reservations", createReservationRoutes(deps));
  app.route("/v1/ops/travel", createOpsRoutes(deps));

  return app;
}

async function main(): Promise<void> {
  let deps: TravelDeps;
  // Production configuration never authenticates a caller it cannot verify,
  // never serves a test-only supply adapter, and never calls ride-service
  // without a signing key: refuse to boot rather than trust a plain identity
  // header, let a fixture catalog take a real booking or let a traveller's
  // airport ride go out unsigned.
  try {
    if (!assertIdentityConfigured(process.env)) {
      logger.warn(
        "UBI_IDENTITY_SECRET is not set: routes read the plain X-User-ID / X-User-Role headers and answer a signed gateway context 503 (development only)",
      );
    }
    deps = createDeps();
    await assertProductionSupplyConfig(deps.db);
  } catch (error) {
    logger.fatal(
      { err: error },
      "refusing to start: unsafe identity, supplier or ride-context configuration",
    );
    process.stderr.write(
      `travel-service refusing to start: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    await disconnectPrisma().catch(() => undefined);
    process.exit(1);
  }
  const app = createApp(deps);
  const server = serve({ fetch: app.fetch, port: PORT });
  logger.info({ port: PORT }, "travel-service listening");
  const transferWorker = startTransferWorker(deps);

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "shutting down");
    transferWorker.stop();
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
