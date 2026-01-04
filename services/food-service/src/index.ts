/**
 * UBI Food Service (UBI Bites)
 *
 * Handles food ordering operations including:
 * - Restaurant management and discovery
 * - Menu and item management
 * - Order processing and tracking
 * - Kitchen display system integration
 * - Delivery coordination
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import { disconnect as disconnectPrisma } from "./lib/prisma";
import { disconnect as disconnectRedis } from "./lib/redis";
import { errorHandler, rateLimit, serviceAuth } from "./middleware";
import { healthRoutes } from "./routes/health";
import { menuRoutes } from "./routes/menus";
import { orderRoutes } from "./routes/orders";
import { restaurantRoutes } from "./routes/restaurants";
import { reviewRoutes } from "./routes/reviews";
import { searchRoutes } from "./routes/search";

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
    origin: [
      "https://app.ubi.africa",
      "https://restaurant.ubi.africa",
      "https://admin.ubi.africa",
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
    ],
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

// Public routes with rate limiting
app.use("/restaurants/*", rateLimit());
app.use("/search/*", rateLimit("search"));

// Protected routes
app.use("/orders/*", serviceAuth);
app.use("/reviews/*", serviceAuth);

// API routes
app.route("/restaurants", restaurantRoutes);
app.route("/menus", menuRoutes);
app.route("/orders", orderRoutes);
app.route("/search", searchRoutes);
app.route("/reviews", reviewRoutes);

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
const port = Number.parseInt(process.env.PORT || "4004", 10);

console.log(`🍔 UBI Food Service starting on port ${port}`);

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
