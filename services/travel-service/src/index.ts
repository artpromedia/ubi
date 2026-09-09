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
 *    and deduped supplier webhooks, settlement differences, commercial rates and
 *    linked airport ride reservations.
 *
 * The double-entry ledger is NOT here: travel money moves through a typed
 * PaymentPort HTTP call to payment-service.
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import { logger } from "./lib/logger";
import { disconnectPrisma } from "./lib/prisma";
import { disconnectRedis } from "./lib/redis";
import { healthRoutes } from "./routes/health";
import { createOpsRoutes } from "./routes/ops";
import { createReservationRoutes } from "./routes/reservations";
import { createTravelRoutes } from "./routes/travel";
import { createWebhookRoutes } from "./routes/webhooks";
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
  app.route("/v1/reservations", createReservationRoutes(deps));
  app.route("/v1/ops/travel", createOpsRoutes(deps));

  return app;
}

if (process.env.NODE_ENV !== "test") {
  const app = createApp(createDeps());
  const server = serve({ fetch: app.fetch, port: PORT });
  logger.info({ port: PORT }, "travel-service listening");

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "shutting down");
    server.close();
    void Promise.allSettled([disconnectPrisma(), disconnectRedis()]).then(() => {
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
}
