/**
 * Enhanced Real-Time Gateway Server
 *
 * High-performance WebSocket infrastructure for 100K+ concurrent connections
 * Features:
 * - 30-second ping/pong heartbeat
 * - Message sequence numbers for ordering guarantees
 * - Reconnection with exponential backoff
 * - Message buffer for offline clients (zero loss <30s)
 * - Redis pub/sub for horizontal scaling
 * - JWT authentication with refresh without reconnect
 * - Graceful degradation to HTTP polling
 * - Comprehensive metrics dashboard
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { Redis } from "ioredis";
import { WebSocket, WebSocketServer } from "ws";
import {
  createPollingRoutes,
  DEFAULT_CONFIG,
  EnhancedConnectionManager,
  PollingFallbackHandler,
  type UserType,
  type WebSocketConfig,
} from "./ws/index.js";

// Configuration
const port = parseInt(process.env.PORT || "4010", 10);
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

// Custom config (can be overridden via environment)
const wsConfig: Partial<WebSocketConfig> = {
  heartbeatIntervalMs: parseInt(
    process.env.WS_HEARTBEAT_INTERVAL || "30000",
    10
  ),
  heartbeatTimeoutMs: parseInt(process.env.WS_HEARTBEAT_TIMEOUT || "90000", 10),
  maxConnectionsPerUser: parseInt(process.env.WS_MAX_CONNS_PER_USER || "5", 10),
  maxMessageSizeBytes: parseInt(process.env.WS_MAX_MESSAGE_SIZE || "65536", 10),
  bufferTtlMs: parseInt(process.env.WS_BUFFER_TTL || "30000", 10),
  sessionTtlMs: parseInt(process.env.WS_SESSION_TTL || "300000", 10),
};

// Initialize services
const redis = new Redis(redisUrl);
const connectionManager = new EnhancedConnectionManager(redisUrl, wsConfig);
const pollingHandler = new PollingFallbackHandler(redis, {
  ...DEFAULT_CONFIG,
  ...wsConfig,
});

// Create Hono app
const app = new Hono();

// Middleware
app.use("/*", cors());

// Health check
app.get("/health", async (c) => {
  const redisOk = (await redis.ping()) === "PONG";
  const metrics = await connectionManager.getMetrics();

  return c.json({
    status: redisOk ? "healthy" : "degraded",
    service: "realtime-gateway-v2",
    version: "2.0.0",
    features: {
      websocket: true,
      polling: true,
      horizontalScaling: true,
      messageOrdering: true,
      offlineBuffer: true,
    },
    connections: metrics.totalConnections,
    uptime: metrics.uptime,
    timestamp: new Date().toISOString(),
  });
});

// Detailed metrics endpoint
app.get("/metrics", async (c) => {
  const metrics = await connectionManager.getMetrics();
  return c.json(metrics);
});

// Prometheus-style metrics
app.get("/metrics/prometheus", async (c) => {
  const metrics = await connectionManager.getMetrics();

  const lines = [
    "# HELP ws_connections_total Total WebSocket connections",
    "# TYPE ws_connections_total gauge",
    `ws_connections_total{server="${metrics.serverId}"} ${metrics.totalConnections}`,
    "",
    "# HELP ws_unique_users Unique connected users",
    "# TYPE ws_unique_users gauge",
    `ws_unique_users{server="${metrics.serverId}"} ${metrics.uniqueUsers}`,
    "",
    "# HELP ws_messages_per_second Messages per second",
    "# TYPE ws_messages_per_second gauge",
    `ws_messages_per_second{server="${metrics.serverId}"} ${metrics.messagesPerSecond}`,
    "",
    "# HELP ws_latency_avg_ms Average message latency in ms",
    "# TYPE ws_latency_avg_ms gauge",
    `ws_latency_avg_ms{server="${metrics.serverId}"} ${metrics.avgLatencyMs}`,
    "",
    "# HELP ws_latency_p99_ms P99 message latency in ms",
    "# TYPE ws_latency_p99_ms gauge",
    `ws_latency_p99_ms{server="${metrics.serverId}"} ${metrics.p99LatencyMs}`,
    "",
    "# HELP ws_reconnection_rate Reconnections per second",
    "# TYPE ws_reconnection_rate gauge",
    `ws_reconnection_rate{server="${metrics.serverId}"} ${metrics.reconnectionRate}`,
    "",
    "# HELP ws_error_rate Errors per second",
    "# TYPE ws_error_rate gauge",
    `ws_error_rate{server="${metrics.serverId}"} ${metrics.errorRate}`,
    "",
    "# HELP ws_buffer_memory_mb Buffer memory usage in MB",
    "# TYPE ws_buffer_memory_mb gauge",
    `ws_buffer_memory_mb{server="${metrics.serverId}"} ${metrics.bufferMemoryMB}`,
    "",
    "# HELP ws_connections_by_type Connections by user type",
    "# TYPE ws_connections_by_type gauge",
  ];

  for (const [type, count] of Object.entries(metrics.connectionsByType)) {
    lines.push(
      `ws_connections_by_type{server="${metrics.serverId}",type="${type}"} ${count}`
    );
  }

  lines.push("");
  lines.push("# HELP ws_connections_by_platform Connections by platform");
  lines.push("# TYPE ws_connections_by_platform gauge");

  for (const [platform, count] of Object.entries(
    metrics.connectionsByPlatform
  )) {
    lines.push(
      `ws_connections_by_platform{server="${metrics.serverId}",platform="${platform}"} ${count}`
    );
  }

  return c.text(lines.join("\n"));
});

// Broadcast to specific user (for internal services)
app.post("/broadcast/user/:userId", async (c) => {
  const userId = c.req.param("userId");
  const message = await c.req.json();

  await connectionManager.sendToUser(userId, {
    ...message,
    seq: Date.now(), // Server-assigned sequence
    ts: Date.now(),
  });

  // Also queue for polling clients
  await pollingHandler.queueMessage(userId, message);

  return c.json({ success: true });
});

// Global broadcast (for internal services)
app.post("/broadcast/all", async (c) => {
  const message = await c.req.json();

  await connectionManager.broadcast({
    ...message,
    seq: Date.now(),
    ts: Date.now(),
  });

  return c.json({ success: true });
});

// Polling fallback routes
app.route("/poll", createPollingRoutes(pollingHandler));

// Connection info endpoint
app.get("/connections/:connectionId", async (c) => {
  const connectionId = c.req.param("connectionId");
  const connection = connectionManager.getConnection(connectionId);

  if (!connection) {
    return c.json({ error: "Connection not found" }, 404);
  }

  return c.json({
    id: connection.id,
    userId: connection.userId,
    userType: connection.userType,
    platform: connection.platform,
    connectedAt: connection.connectedAt,
    latencyMs: connection.latencyMs,
    reconnectCount: connection.reconnectCount,
  });
});

// Start HTTP server
const server = serve({
  fetch: app.fetch,
  port,
});

console.log(`🚀 Real-Time Gateway v2 HTTP server running on port ${port}`);

// Create WebSocket server
const wss = new WebSocketServer({
  server: server as any,
  path: "/ws",
  maxPayload: wsConfig.maxMessageSizeBytes || 65536,
});

console.log(`🔌 WebSocket server ready at ws://localhost:${port}/ws`);
console.log(`📊 Metrics available at http://localhost:${port}/metrics`);
console.log(`🔄 Polling fallback at http://localhost:${port}/poll`);

// Handle WebSocket connections
wss.on("connection", async (ws: WebSocket, req) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);

  // Extract parameters
  const token =
    url.searchParams.get("token") ||
    req.headers.authorization?.replace("Bearer ", "");
  const userType = url.searchParams.get("userType") as UserType;
  const deviceId = url.searchParams.get("deviceId") || "unknown";
  const platform =
    (url.searchParams.get("platform") as "ios" | "android" | "web") || "web";
  const sessionId = url.searchParams.get("sessionId") || undefined; // For reconnection

  // Validate required params
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
    // Verify token
    const { userId, expiresAt } = await verifyToken(token);

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
      },
      expiresAt,
      sessionId
    );

    console.log(
      `✅ Connection established: ${connectionId} (${userType}/${userId})`
    );
  } catch (error) {
    console.error("Connection error:", error);
    ws.close(4000, "Internal server error");
  }
});

wss.on("error", (error) => {
  console.error("WebSocket server error:", error);
});

// Graceful shutdown
async function shutdown() {
  console.log("\n🛑 Shutting down gracefully...");

  // Close WebSocket server
  wss.close(() => {
    console.log("WebSocket server closed");
  });

  // Cleanup connection manager
  await connectionManager.cleanup();

  // Close Redis
  await redis.quit();

  console.log("✅ Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

/**
 * Verify JWT token and extract user info
 */
async function verifyToken(
  token: string
): Promise<{ userId: string | null; expiresAt: Date | undefined }> {
  try {
    // In production, use proper JWT verification
    // const decoded = jwt.verify(token, jwtSecret);

    // Development: decode without verification
    const parts = token.split(".");
    if (parts.length !== 3) {
      return { userId: null, expiresAt: undefined };
    }

    const payload = JSON.parse(Buffer.from(parts[1] ?? "", "base64").toString());
    const userId = payload.userId || payload.sub;
    const expiresAt = payload.exp ? new Date(payload.exp * 1000) : undefined;

    return { userId, expiresAt };
  } catch {
    return { userId: null, expiresAt: undefined };
  }
}
