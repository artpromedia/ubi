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
import { logger } from "hono/logger";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

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
import { loyaltyRoutes } from "./routes/loyalty";
import { mobileMoneyRoutes } from "./routes/mobile-money";
import { paymentRoutes } from "./routes/payments";
import { payoutRoutes } from "./routes/payouts";
import { safetyRoutes } from "./routes/safety";
import { walletRoutes } from "./routes/wallet";
import { webhookRoutes } from "./routes/webhooks";

const app = new Hono();

// Global middleware
app.use("*", requestId());
app.use("*", logger());
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
  })
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
app.use("/loyalty/*", paymentRateLimit);
app.use("/loyalty/*", serviceAuth);
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
app.route("/loyalty", loyaltyRoutes);
app.route("/safety", safetyRoutes);
app.route("/admin", adminRoutes);

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
    404
  );
});

// Start server
const port = Number.parseInt(process.env.PORT || "4003", 10);

console.log(`💳 UBI Payment Service starting on port ${port}`);

const server = serve({
  fetch: app.fetch,
  port,
});

// Graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  server.close(async () => {
    console.log("HTTP server closed");

    await Promise.all([disconnectPrisma(), disconnectRedis()]);

    console.log("All connections closed");
    process.exit(0);
  });

  // Force shutdown after 30s
  setTimeout(() => {
    console.error("Forced shutdown after timeout");
    process.exit(1);
  }, 30000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
