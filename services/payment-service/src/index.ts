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

import { analyticsService } from "./lib/analytics";
import { logger } from "./lib/logger";
import { disconnectPrisma } from "./lib/prisma";
import { disconnectRedis } from "./lib/redis";
import {
  errorHandler,
  paymentRateLimit,
  serviceAuth,
  webhookRateLimit,
} from "./middleware";
import { adminRoutes } from "./routes/admin";
import fraudRoutes from "./routes/fraud";
import { healthRoutes } from "./routes/health";
import { mobileMoneyRoutes } from "./routes/mobile-money";
import { paymentRoutes } from "./routes/payments";
import { payoutRoutes } from "./routes/payouts";
import { safetyRoutes } from "./routes/safety";
import { createFinanceRoutes } from "./finance/routes";
import { createRemedyRoutes } from "./finance/remedies";
import { walletDeps } from "./ledger/wiring";
import { createWalletV1Routes } from "./routes/wallet-v1";
import { walletRoutes } from "./routes/wallet";
import { webhookRoutes } from "./routes/webhooks";

// NOTE: The B2B (/b2b), loyalty (/loyalty) and driver-experience (/drivers)
// routes and their services are DEFERRED until Move is green and are
// quarantined out of the build (see tsconfig "exclude" and QUARANTINE.md).
// They are intentionally not imported or mounted here.

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

// Health check routes (no auth required)
app.route("/health", healthRoutes);

// Webhook routes (special auth via signature verification)
app.use("/webhooks/*", webhookRateLimit);
app.route("/webhooks", webhookRoutes);

// Service auth and rate limiting for internal routes
app.use("/wallets/*", paymentRateLimit);
app.use("/wallets/*", serviceAuth);
app.use("/payments/*", paymentRateLimit);
app.use("/payments/*", serviceAuth);
app.use("/mobile-money/*", paymentRateLimit);
app.use("/mobile-money/*", serviceAuth);
app.use("/payouts/*", paymentRateLimit);
app.use("/payouts/*", serviceAuth);
app.use("/fraud/*", paymentRateLimit);
app.use("/fraud/*", serviceAuth);
app.use("/safety/*", paymentRateLimit);
app.use("/safety/*", serviceAuth);
app.use("/admin/*", paymentRateLimit);
app.use("/admin/*", serviceAuth);

// API routes
app.route("/wallets", walletRoutes);
app.route("/payments", paymentRoutes);
app.route("/mobile-money", mobileMoneyRoutes);
app.route("/payouts", payoutRoutes);
app.route("/fraud", fraudRoutes);
app.route("/safety", safetyRoutes);
app.route("/admin", adminRoutes);

// Canonical wallet ledger (slice 04) and finance reconciliation (slice 11).
// These mount beside the older /wallets routes while those are retired; the
// route modules apply their own auth, so they are safe under any mount order.
const ledgerDeps = walletDeps();
app.use("/v1/wallet/*", paymentRateLimit);
app.route("/v1/wallet", createWalletV1Routes(ledgerDeps));
app.use("/v1/finance/*", paymentRateLimit);
app.route("/v1/finance", createFinanceRoutes(ledgerDeps));
// support-service posts typed remedies here; it decides whether a case
// deserves one, the ledger decides which accounts move.
app.route("/v1/finance/remedies", createRemedyRoutes(ledgerDeps));

// DEFERRED: /b2b and /drivers routes and the driver-experience services are
// quarantined until those features launch (see QUARANTINE.md). Not mounted.

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

// Start server
const port = Number.parseInt(process.env.PORT || "4003", 10);

logger.info({ port }, "UBI Payment Service starting");

const server = serve({
  fetch: app.fetch,
  port,
});

// Graceful shutdown
const shutdown = async (signal: string) => {
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

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
