/**
 * Notification Service - UBI Africa
 * Push, SMS, Email, In-App Notifications
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";

import { disconnect as disconnectPrisma } from "./lib/prisma";
import {
  closeConnections as closeRedis,
  onEvent,
  subscribeToChannel,
} from "./lib/redis";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { emailRoutes } from "./routes/email";
import { healthRoutes } from "./routes/health";
import { inAppRoutes } from "./routes/in-app";
import { preferencesRoutes } from "./routes/preferences";
import { pushRoutes } from "./routes/push";
import { smsRoutes } from "./routes/sms";
import { templatesRoutes } from "./routes/templates";

const app = new Hono();

// Global middleware
app.use("*", cors());
app.use("*", logger());
app.use("*", secureHeaders());
app.use("*", compress());

// Error handling
app.onError(errorHandler);

// Health check routes
app.route("/health", healthRoutes);

// API routes
app.route("/api/v1/push", pushRoutes);
app.route("/api/v1/sms", smsRoutes);
app.route("/api/v1/email", emailRoutes);
app.route("/api/v1/notifications", inAppRoutes);
app.route("/api/v1/templates", templatesRoutes);
app.route("/api/v1/preferences", preferencesRoutes);

// 404 handler
app.notFound(notFoundHandler);

const port = parseInt(process.env.PORT || "4006", 10);

// Start server
const server = serve({
  fetch: app.fetch,
  port,
});

console.log(`[Notification Service] Running on port ${port}`);

// Subscribe to events from other services
async function subscribeToEvents() {
  try {
    await subscribeToChannel("notifications");
    await subscribeToChannel("rides");
    await subscribeToChannel("food");
    await subscribeToChannel("deliveries");
    await subscribeToChannel("payments");

    // Handle ride events
    onEvent("ride:completed", async (data) => {
      console.log("[Event] Ride completed:", data);
      // Trigger receipt email, rating request, etc.
    });

    onEvent("ride:driver_arrived", async (data) => {
      console.log("[Event] Driver arrived:", data);
      // Send push notification to rider
    });

    // Handle food order events
    onEvent("food:order_ready", async (data) => {
      console.log("[Event] Food order ready:", data);
      // Notify customer
    });

    // Handle delivery events
    onEvent("delivery:picked_up", async (data) => {
      console.log("[Event] Delivery picked up:", data);
      // Notify sender and recipient
    });

    // Handle payment events
    onEvent("payment:successful", async (data) => {
      console.log("[Event] Payment successful:", data);
      // Send receipt email
    });

    onEvent("payment:failed", async (data) => {
      console.log("[Event] Payment failed:", data);
      // Notify user
    });

    console.log("[Notification Service] Event subscriptions active");
  } catch (error) {
    console.error(
      "[Notification Service] Failed to subscribe to events:",
      error,
    );
  }
}

subscribeToEvents();

// Graceful shutdown
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function shutdown() {
  console.log("\n[Notification Service] Shutting down...");

  await Promise.all([closeRedis(), disconnectPrisma()]);

  server.close(() => {
    console.log("[Notification Service] Server closed");
    process.exit(0);
  });

  // Force exit after 10s
  setTimeout(() => {
    console.error("[Notification Service] Forced shutdown");
    process.exit(1);
  }, 10000);
}

export default app;
