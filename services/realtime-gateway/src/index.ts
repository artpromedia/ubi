/**
 * Real-Time Gateway Server
 * Main entry point for WebSocket connections
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import { ConnectionManager } from "./connection-manager.js";
import type { UserType } from "./types/index.js";

const app = new Hono();
const port = Number.parseInt(process.env.PORT || "4010", 10);
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

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

console.log(`🚀 Real-Time Gateway HTTP server running on port ${port}`);

// Create WebSocket server on same port
const wss = new WebSocketServer({
  server: server as any,
  path: "/ws",
});

console.log(`🔌 WebSocket server ready at ws://localhost:${port}/ws`);

// Handle WebSocket connections
wss.on("connection", async (ws, req) => {
  console.log("New WebSocket connection attempt");

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
    ws.close(4001, "Missing authentication token");
    return;
  }

  if (
    !userType ||
    !["rider", "driver", "restaurant", "delivery_partner"].includes(userType)
  ) {
    ws.close(4002, "Invalid or missing userType");
    return;
  }

  try {
    // Verify token and get userId (you'd integrate with your auth service)
    const userId = await verifyToken(token);

    if (!userId) {
      ws.close(4003, "Invalid authentication token");
      return;
    }

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
      }
    );

    console.log(`✅ Connection established: ${connectionId}`);
  } catch (error) {
    console.error("Connection error:", error);
    ws.close(4000, "Internal server error");
  }
});

wss.on("error", (error) => {
  console.error("WebSocket server error:", error);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, closing server...");
  wss.close(() => {
    console.log("WebSocket server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received, closing server...");
  wss.close(() => {
    console.log("WebSocket server closed");
    process.exit(0);
  });
});

/**
 * Verify JWT token and extract userId
 * TODO: Integrate with your auth service
 */
async function verifyToken(token: string): Promise<string | null> {
  // Mock implementation - replace with actual JWT verification
  // This should call your user-service or decode a JWT
  try {
    // For development, extract userId from token
    // In production, verify signature and decode properly
    const decoded = Buffer.from(token.split(".")[1] || "", "base64").toString();
    const payload = JSON.parse(decoded);
    return payload.userId || payload.sub;
  } catch {
    return null;
  }
}
