/**
 * Real-Time Gateway Server
 * Main entry point for WebSocket connections (/ws and /v1/stream)
 */

import { serve } from "@hono/node-server";
import { Redis } from "ioredis";
import { WebSocketServer } from "ws";
import type { OutboxSubscription } from "@ubi/outbox";
import { ConnectionManager } from "./connection-manager.js";
import { logger, wsLogger } from "./lib/logger.js";
import { subscribeMarketplaceEvents } from "./marketplace-events.js";
import {
  SUPPORTED_WS_PATHS,
  createRealtimeHttpApp,
  handleWebSocketUpgradeConnection,
} from "./server.js";

const port = Number.parseInt(process.env.PORT || "4010", 10);
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

// Validate critical environment variables in production
if (process.env.NODE_ENV === "production") {
  if (
    !process.env.JWT_SECRET ||
    process.env.JWT_SECRET.includes("dev-secret")
  ) {
    logger.fatal("JWT_SECRET must be set to a secure value in production");
    process.exit(1);
  }
  if (
    !process.env.UBI_IDENTITY_SECRET ||
    process.env.UBI_IDENTITY_SECRET.length < 32
  ) {
    logger.fatal("UBI_IDENTITY_SECRET must be set (>= 32 chars) in production");
    process.exit(1);
  }
}

// Initialize connection manager
const connectionManager = new ConnectionManager(redisUrl);
const app = createRealtimeHttpApp(connectionManager);

// Subscribe to marketplace outbox events (event:mp.*) for realtime fan-out.
// Dedicated connection: subscribeOutbox puts it in subscriber mode.
const marketplaceRedis = new Redis(redisUrl);
let marketplaceSubscription: OutboxSubscription | null = null;
subscribeMarketplaceEvents(marketplaceRedis, connectionManager)
  .then((subscription) => {
    marketplaceSubscription = subscription;
  })
  .catch((err) => {
    logger.error({ err }, "Failed to subscribe to marketplace outbox events");
  });

// Start HTTP server
const server = serve({
  fetch: app.fetch,
  port,
});

logger.info({ port }, "Real-Time Gateway HTTP server started");

// Create WebSocket server on same port (accepts both /ws and /v1/stream)
const wss = new WebSocketServer({
  server: server as any,
});

logger.info({ port, paths: [...SUPPORTED_WS_PATHS] }, "WebSocket server ready");

wss.on("connection", async (ws, req) => {
  await handleWebSocketUpgradeConnection(ws, req, connectionManager);
});

wss.on("error", (error) => {
  wsLogger.error({ error }, "WebSocket server error");
});

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  logger.info({ signal }, "Shutdown signal received, closing connections...");

  // Close WebSocket server (stops accepting new connections)
  wss.close(() => {
    logger.info("WebSocket server closed");
  });

  // Allow existing connections to finish (with timeout)
  const shutdownTimeout = setTimeout(() => {
    logger.warn("Shutdown timeout reached, forcing exit");
    process.exit(1);
  }, 10000);

  // Stop marketplace outbox subscription
  try {
    await marketplaceSubscription?.stop();
    await marketplaceRedis.quit();
  } catch (err) {
    logger.warn({ err }, "Error stopping marketplace subscription");
  }

  // Clean up connection manager
  await connectionManager.cleanup();

  clearTimeout(shutdownTimeout);
  logger.info("Graceful shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
