/**
 * Notification Service - UBI Africa
 * Push, SMS, Email, In-App Notifications
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";

import { logger } from "./lib/logger.js";
import { disconnect as disconnectPrisma } from "./lib/prisma";
import {
  closeConnections as closeRedis,
  onEvent,
  subscribeToChannel,
} from "./lib/redis";
import { startMarketplacePush } from "./marketplace/consumer.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { emailRoutes } from "./routes/email";
import { healthRoutes } from "./routes/health";
import { inAppRoutes } from "./routes/in-app";
import { preferencesRoutes } from "./routes/preferences";
import { pushRoutes } from "./routes/push";
import { smsRoutes } from "./routes/sms";
import { templatesRoutes } from "./routes/templates";
import { startTripAccessSms } from "./trip-access/consumer.js";

const app = new Hono();

// Global middleware
app.use("*", cors());
app.use("*", honoLogger());
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

const port = Number.parseInt(process.env.PORT || "4006", 10);

// Start server
const server = serve({
  fetch: app.fetch,
  port,
});

logger.info({ port }, "Notification Service starting");

// Subscribe to events from other services
async function subscribeToEvents() {
  try {
    await subscribeToChannel("notifications");
    await subscribeToChannel("rides");
    await subscribeToChannel("food");
    await subscribeToChannel("deliveries");
    await subscribeToChannel("payments");

    // Handle ride events
    onEvent("ride:completed", (data) => {
      logger.debug({ event: "ride:completed", data }, "Event received");
      // Trigger receipt email, rating request, etc.
    });

    onEvent("ride:driver_arrived", (data) => {
      logger.debug({ event: "ride:driver_arrived", data }, "Event received");
      // Send push notification to rider
    });

    // Handle food order events
    onEvent("food:order_ready", (data) => {
      logger.debug({ event: "food:order_ready", data }, "Event received");
      // Notify customer
    });

    // Handle delivery events
    onEvent("delivery:picked_up", (data) => {
      logger.debug({ event: "delivery:picked_up", data }, "Event received");
      // Notify sender and recipient
    });

    // Handle payment events
    onEvent("payment:successful", (data) => {
      logger.debug({ event: "payment:successful", data }, "Event received");
      // Send receipt email
    });

    onEvent("payment:failed", (data) => {
      logger.debug({ event: "payment:failed", data }, "Event received");
      // Notify user
    });

    logger.info("Event subscriptions active");
  } catch (error) {
    logger.error({ err: error }, "Failed to subscribe to events");
  }
}

void subscribeToEvents();

// Durable outbox push (G10): subscribe to the mp.* outbox stream (plus
// trip_access.declined, reservation.* and shipment.return_proposed) and
// deliver per-viewer hint pushes to FCM with dedupe, retry/backoff, DLQ, token
// rotation, per-user preferences and an SMS fallback for time-critical
// events. Also recognizes the dedicated settlement event (mp.settlement.posted,
// G15). This is separate from the legacy channel subscriptions above.
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
let marketplacePush: { stop: () => Promise<void> } | null = null;
startMarketplacePush(redisUrl)
  .then((handle) => {
    marketplacePush = handle;
  })
  .catch((error) => {
    logger.error({ err: error }, "Failed to start marketplace push consumer");
  });

// Passenger trip-link SMS (TRIP-LINK SEALED DELIVERY CONTRACT): fails closed —
// without TRIP_ACCESS_DELIVERY_KEY/_KID and PASSENGER_TRIP_LINK_BASE_URL it is
// not started (an alert is logged) and never sends.
let tripAccessSms: { stop: () => Promise<void> } | null = null;
startTripAccessSms({ redisUrl, env: process.env })
  .then((handle) => {
    tripAccessSms = handle;
  })
  .catch((error) => {
    logger.error(
      { err: error instanceof Error ? error.message : "start failed" },
      "Failed to start passenger trip link SMS consumer",
    );
  });

// Graceful shutdown
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function shutdown() {
  logger.info("Shutting down...");

  await Promise.all([
    marketplacePush?.stop() ?? Promise.resolve(),
    tripAccessSms?.stop() ?? Promise.resolve(),
    closeRedis(),
    disconnectPrisma(),
  ]);

  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });

  // Force exit after 10s
  setTimeout(() => {
    logger.error("Forced shutdown");
    process.exit(1);
  }, 10000);
}

export default app;
