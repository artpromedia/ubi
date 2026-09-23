/**
 * UBI Payment Service
 *
 * Handles all payment operations including:
 * - Mobile Money (M-Pesa, MTN MoMo, Airtel Money)
 * - Card payments (via Paystack, Flutterwave)
 * - Wallet management
 * - Escrow for ride payments
 * - Driver earnings and payouts
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import { createRemedyRoutes } from "./finance/remedies";
import { createFinanceRoutes } from "./finance/routes";
import { createTravelPaymentRoutes } from "./finance/travel-routes";
import { walletDeps } from "./ledger/wiring";
import { analyticsService } from "./lib/analytics";
import { logger } from "./lib/logger";
import { disconnectPrisma } from "./lib/prisma";
import { disconnectRedis } from "./lib/redis";
import { errorHandler, paymentRateLimit, serviceAuth } from "./middleware";
import { adminRoutes } from "./routes/admin";
import fraudRoutes from "./routes/fraud";
import { healthRoutes } from "./routes/health";
import { createMpHoldRoutes } from "./routes/mp-holds";
import { safetyRoutes } from "./routes/safety";
import { createWalletV1Routes } from "./routes/wallet-v1";

// NOTE: The B2B (/b2b), loyalty (/loyalty) and driver-experience (/drivers)
// routes and their services are DEFERRED until Move is green and are
// quarantined out of the build (see tsconfig "exclude" and QUARANTINE.md).
// They are intentionally not imported or mounted here.
//
// SUPERSEDED by the canonical /v1 ledger and unmounted (see QUARANTINE.md):
// the OLD /wallets, /payments, /mobile-money, /payouts and /webhooks routes and
// their settlement/PSP services referenced Prisma models that do not exist. The
// live money path is /v1/wallet + /v1/finance. PSP card/mobile-money COLLECTION,
// bank PAYOUT batches and payment webhooks are deferred pending a canonical rebuild.

const app = new Hono();

// Global middleware
app.use("*", requestId());
app.use("*", honoLogger());
app.use("*", secureHeaders());
app.use("*", compress());

// CORS configuration
app.use(
  "*",
  cors({
    origin: (origin) => {
      const allowedOrigins = [
        "https://app.ubi.africa",
        "https://admin.ubi.africa",
      ];
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        /^http:\/\/localhost:\d+$/.test(origin)
      ) {
        return origin || "";
      }
      return "";
    },
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-ID",
      "X-User-ID",
      "X-Idempotency-Key",
    ],
    exposeHeaders: ["X-Request-ID"],
    credentials: true,
    maxAge: 600,
  }),
);

// Error handler
app.use("*", errorHandler);

// Service auth and rate limiting for internal routes
app.use("/fraud/*", paymentRateLimit);
app.use("/fraud/*", serviceAuth);
app.use("/safety/*", paymentRateLimit);
app.use("/safety/*", serviceAuth);
app.use("/admin/*", paymentRateLimit);
app.use("/admin/*", serviceAuth);
app.use("/v1/wallet/*", paymentRateLimit);
app.use("/v1/finance/*", paymentRateLimit);

// ===========================================
// ROUTER REGISTRY — the single place a router is mounted (G14).
//
// Every router this service serves is listed HERE, in mount order, and
// MOUNTED_ROUTE_PREFIXES below is exported as the allowlist that
// tests/routes-inventory.test.ts checks the live Hono route table against.
// A quarantined legacy router (the OLD /wallets, /payments, /payouts,
// /mobile-money, /webhooks, and the deferred /b2b, /loyalty, /drivers — see
// QUARANTINE.md) that is remounted, here or anywhere else, turns that test
// red: the inventory is the tripwire, so remounting is a reviewed decision,
// never an accident.
//
// Order notes: /v1/wallet/mp (marketplace commission holds, M04) mounts
// BEFORE the general wallet routes, because the wallet router guards
// everything under it with user session auth while the hold mutations are
// service-key calls from the award engine. /v1/finance/travel (supplier
// travel payments, P7) mounts BEFORE /v1/finance for the same reason: the
// recon router's `use("*")` admin-session guards cover every path under
// /v1/finance, while travel-service calls the travel endpoint with the
// internal service key. The route modules apply their own auth; the health
// routes are deliberately unauthenticated probes.
// ===========================================
const ledgerDeps = walletDeps();

const ROUTER_REGISTRY: ReadonlyArray<{
  readonly prefix: string;
  readonly router: Hono;
}> = [
  { prefix: "/health", router: healthRoutes },
  { prefix: "/fraud", router: fraudRoutes },
  { prefix: "/safety", router: safetyRoutes },
  { prefix: "/admin", router: adminRoutes },
  { prefix: "/v1/wallet/mp", router: createMpHoldRoutes(ledgerDeps) },
  { prefix: "/v1/wallet", router: createWalletV1Routes(ledgerDeps) },
  {
    prefix: "/v1/finance/travel",
    router: createTravelPaymentRoutes(ledgerDeps),
  },
  { prefix: "/v1/finance", router: createFinanceRoutes(ledgerDeps) },
  { prefix: "/v1/finance/remedies", router: createRemedyRoutes(ledgerDeps) },
];

for (const { prefix, router } of ROUTER_REGISTRY) {
  app.route(prefix, router);
}

/** The supported surface, exported for the route-inventory tripwire test. */
export const MOUNTED_ROUTE_PREFIXES: readonly string[] = ROUTER_REGISTRY.map(
  (entry) => entry.prefix,
);

// DEFERRED: /b2b and /drivers routes and the driver-experience services are
// quarantined until those features launch (see QUARANTINE.md). Not mounted,
// not imported — and the registry above plus tests/routes-inventory.test.ts
// keep it that way structurally.

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Resource not found",
      },
    },
    404,
  );
});

// Start server — not under test, where the app (and its route inventory) is
// imported for assertions without binding a port.
if (process.env.NODE_ENV !== "test") {
  const port = Number.parseInt(process.env.PORT || "4003", 10);

  logger.info({ port }, "UBI Payment Service starting");

  const server = serve({
    fetch: app.fetch,
    port,
  });

  // Graceful shutdown
  const shutdown = (signal: string): void => {
    logger.info({ signal }, "Shutdown signal received, closing gracefully...");

    server.close(async () => {
      logger.info("HTTP server closed");

      await Promise.all([
        disconnectPrisma(),
        disconnectRedis(),
        analyticsService.shutdown(),
      ]);

      logger.info("All connections closed");
      process.exit(0);
    });

    // Force shutdown after 30s
    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 30000);
  };

  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
}

export default app;
