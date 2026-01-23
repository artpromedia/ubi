/**
 * Real-Time Gateway Server
 * Main entry point for WebSocket connections
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import { ConnectionManager } from "./connection-manager.js";
import { isTokenExpired, verifyToken } from "./lib/auth.js";
import { logger, wsLogger } from "./lib/logger.js";
import type { UserType } from "./types/index.js";

const app = new Hono();
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
}

// Initialize connection manager
const connectionManager = new ConnectionManager(redisUrl);

// Health check
app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    service: "realtime-gateway",
    timestamp: new Date().toISOString(),
  });
});

// Connection stats endpoint
app.get("/stats", (c) => {
  const stats = connectionManager.getConnectionStats();
  return c.json(stats);
});

// Broadcast endpoint for other services
app.post("/broadcast/user/:userId", async (c) => {
  const userId = c.req.param("userId");
  const message = await c.req.json();

  await connectionManager.broadcastToUser(userId, message);

  return c.json({ success: true });
});

// Start HTTP server
const server = serve({
  fetch: app.fetch,
  port,
});

logger.info({ port }, "Real-Time Gateway HTTP server started");

// Create WebSocket server on same port
const wss = new WebSocketServer({
  server: server as any,
  path: "/ws",
});

logger.info({ port, path: "/ws" }, "WebSocket server ready");

// Handle WebSocket connections
wss.on("connection", async (ws, req) => {
  const requestId = crypto.randomUUID().substring(0, 8);
  wsLogger.debug({ requestId }, "New WebSocket connection attempt");

  // Extract auth and metadata from query params or headers
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const token =
    url.searchParams.get("token") ||
    req.headers.authorization?.replace("Bearer ", "");
  const userType = url.searchParams.get("userType") as UserType;
  const deviceId = url.searchParams.get("deviceId") || "unknown";
  const platform =
    (url.searchParams.get("platform") as "ios" | "android" | "web") || "web";

  if (!token) {
    wsLogger.warn({ requestId }, "Connection rejected: missing token");
    ws.close(4001, "Missing authentication token");
    return;
  }

  // Quick check for expired token before full verification
  if (isTokenExpired(token)) {
    wsLogger.warn({ requestId }, "Connection rejected: expired token");
    ws.close(4003, "Token expired");
    return;
  }

  if (
    !userType ||
    !["rider", "driver", "restaurant", "delivery_partner"].includes(userType)
  ) {
    wsLogger.warn(
      { requestId, userType },
      "Connection rejected: invalid userType",
    );
    ws.close(4002, "Invalid or missing userType");
    return;
  }

  try {
    // Verify token cryptographically
    const authResult = await verifyToken(token);

    if (!authResult.valid || !authResult.userId) {
      wsLogger.warn(
        { requestId, error: authResult.error },
        "Connection rejected: token verification failed",
      );
      ws.close(4003, authResult.error || "Invalid authentication token");
      return;
    }

    const userId = authResult.userId;

    // Register connection
    const connectionId = await connectionManager.handleConnection(
      ws,
      userId,
      userType,
      deviceId,
      platform,
      {
        ip: req.socket.remoteAddress,
        userAgent: req.headers["user-agent"],
      },
    );

    wsLogger.info(
      {
        requestId,
        connectionId,
        userId,
        userType,
        platform,
      },
      "Connection established",
    );
  } catch (error) {
    wsLogger.error({ requestId, error }, "Connection error");
    ws.close(4000, "Internal server error");
  }
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

  // Clean up connection manager
  await connectionManager.cleanup();

  clearTimeout(shutdownTimeout);
  logger.info("Graceful shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
