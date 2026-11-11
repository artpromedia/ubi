/**
 * Testable HTTP + WebSocket server wiring for Real-Time Gateway.
 */

import type { IncomingMessage } from "node:http";
import { Hono } from "hono";
import type { WebSocket } from "ws";
import type { ConnectionManager } from "./connection-manager.js";
import {
  deriveUserTypeFromRole,
  isTokenExpired,
  verifyIdentityToken,
  verifyToken,
} from "./lib/auth.js";
import { wsLogger } from "./lib/logger.js";
import { requireServiceAuth } from "./lib/service-auth.js";
import type { UserType } from "./types/index.js";

const VALID_USER_TYPES: ReadonlySet<string> = new Set([
  "rider",
  "driver",
  "restaurant",
  "delivery_partner",
]);

export const SUPPORTED_WS_PATHS: ReadonlySet<string> = new Set([
  "/ws",
  "/v1/stream",
]);

export function createRealtimeHttpApp(
  connectionManager: Pick<
    ConnectionManager,
    "getConnectionStats" | "broadcastToUser"
  >,
): Hono {
  const app = new Hono();

  // Health check (public for Caddy / container probes)
  app.get("/health", (c) => {
    return c.json({
      status: "healthy",
      service: "realtime-gateway",
      timestamp: new Date().toISOString(),
    });
  });

  // Connection stats endpoint — service/ops authenticated (P2-09)
  app.get("/stats", requireServiceAuth, (c) => {
    const stats = connectionManager.getConnectionStats();
    return c.json(stats);
  });

  // Broadcast endpoint for other services.
  app.post("/broadcast/user/:userId", requireServiceAuth, async (c) => {
    const userId = c.req.param("userId");
    const message = await c.req.json();

    await connectionManager.broadcastToUser(userId, message);

    return c.json({ success: true });
  });

  return app;
}

export async function handleWebSocketUpgradeConnection(
  ws: WebSocket,
  req: IncomingMessage,
  connectionManager: Pick<
    ConnectionManager,
    "handleConnection" | "canAcceptUserConnection"
  >,
): Promise<void> {
  const requestId = crypto.randomUUID().substring(0, 8);
  wsLogger.debug({ requestId }, "New WebSocket connection attempt");

  const url = new URL(
    req.url || "",
    `http://${req.headers.host || "localhost"}`,
  );
  if (!SUPPORTED_WS_PATHS.has(url.pathname)) {
    wsLogger.warn(
      { requestId, path: url.pathname },
      "Unsupported WebSocket path",
    );
    ws.close(4004, "Unsupported WebSocket path");
    return;
  }

  const rawIdentityHeader = req.headers["x-ubi-identity"];
  const identityHeader = Array.isArray(rawIdentityHeader)
    ? rawIdentityHeader[0]
    : rawIdentityHeader;
  const bearerOrQueryToken =
    url.searchParams.get("token") ||
    req.headers.authorization?.replace(/^Bearer\s+/i, "");

  const token = identityHeader?.trim() || bearerOrQueryToken?.trim();
  if (!token) {
    wsLogger.warn({ requestId }, "Connection rejected: missing token");
    ws.close(4001, "Missing authentication token");
    return;
  }

  // Quick check for expired token before full verification (except svc_ tokens)
  if (!token.startsWith("svc_") && isTokenExpired(token)) {
    wsLogger.warn({ requestId }, "Connection rejected: expired token");
    ws.close(4003, "Token expired");
    return;
  }

  try {
    const authResult = identityHeader?.trim()
      ? await verifyIdentityToken(identityHeader.trim())
      : await verifyToken(token);

    if (!authResult.valid || !authResult.userId) {
      wsLogger.warn(
        { requestId, error: authResult.error },
        "Connection rejected: token verification failed",
      );
      ws.close(4003, authResult.error || "Invalid authentication token");
      return;
    }

    const derivedUserType = deriveUserTypeFromRole(
      authResult.payload?.role,
      authResult.payload?.modes,
    );
    const requestedUserType = url.searchParams.get("userType");

    if (
      requestedUserType !== null &&
      requestedUserType.length > 0 &&
      !VALID_USER_TYPES.has(requestedUserType)
    ) {
      wsLogger.warn(
        { requestId, requestedUserType },
        "Connection rejected: invalid userType",
      );
      ws.close(4002, "Invalid or missing userType");
      return;
    }

    if (
      requestedUserType &&
      derivedUserType &&
      requestedUserType !== derivedUserType
    ) {
      wsLogger.warn(
        { requestId, requestedUserType, derivedUserType },
        "Connection rejected: client userType contradicts token role",
      );
      ws.close(4002, "Role mismatch for userType");
      return;
    }

    const userType: UserType | null =
      derivedUserType ??
      (requestedUserType && VALID_USER_TYPES.has(requestedUserType)
        ? (requestedUserType as UserType)
        : null);

    if (!userType) {
      wsLogger.warn(
        { requestId, role: authResult.payload?.role },
        "Connection rejected: unable to derive userType from token",
      );
      ws.close(4002, "Invalid or missing userType");
      return;
    }

    const userId = authResult.userId;

    if (
      typeof connectionManager.canAcceptUserConnection === "function" &&
      !connectionManager.canAcceptUserConnection(userId)
    ) {
      wsLogger.warn(
        { requestId, userId },
        "Connection rejected: per-user connection limit reached",
      );
      ws.close(4008, "Too many concurrent connections");
      return;
    }

    const deviceId = url.searchParams.get("deviceId") || "unknown";
    const platform =
      (url.searchParams.get("platform") as "ios" | "android" | "web") || "web";
    const channel = url.searchParams.get("channel") || undefined;
    const rawLastSeq = url.searchParams.get("lastSeq");
    const parsedLastSeq =
      rawLastSeq !== null && /^\d+$/.test(rawLastSeq)
        ? Number.parseInt(rawLastSeq, 10)
        : undefined;

    const connectionId = await connectionManager.handleConnection(
      ws,
      userId,
      userType,
      deviceId,
      platform,
      {
        ip: req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
        ...(channel !== undefined ? { channel } : {}),
        ...(parsedLastSeq !== undefined ? { lastSeq: parsedLastSeq } : {}),
      },
    );

    wsLogger.info(
      {
        requestId,
        connectionId,
        userId,
        userType,
        platform,
        path: url.pathname,
      },
      "Connection established",
    );
  } catch (error) {
    wsLogger.error({ requestId, error }, "Connection error");
    ws.close(4000, "Internal server error");
  }
}
