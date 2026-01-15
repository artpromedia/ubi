/**
 * WebSocket Connection Manager
 * Handles connection lifecycle, subscriptions, and cross-server messaging
 */

import { WebSocket } from "ws";
import { Redis } from "ioredis";
import { nanoid } from "nanoid";
import type {
  WebSocketConnection,
  WebSocketMessage,
  UserType,
  ConnectionEvent,
} from "./types/index.js";

export class ConnectionManager {
  private connections = new Map<string, WebSocketConnection>();
  private userConnections = new Map<string, Set<string>>();
  private websockets = new Map<string, WebSocket>();
  private redis: Redis;
  private redisSub: Redis;
  private serverId: string;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
    this.redisSub = new Redis(redisUrl);
    this.serverId = nanoid();

    // Subscribe to global events
    this.setupRedisSubscriptions();

    // Cleanup on shutdown
    process.on("SIGTERM", () => this.cleanup());
    process.on("SIGINT", () => this.cleanup());
  }

  private setupRedisSubscriptions() {
    // Subscribe to all user channels this server handles
    this.redisSub.on("message", (channel: string, message: string) => {
      this.handleRedisMessage(channel, message);
    });

    // Pattern subscribe for user channels
    this.redisSub.psubscribe("user:*").catch((err: Error) => {
      console.error("Redis psubscribe error:", err);
    });
  }

  private handleRedisMessage(channel: string, message: string) {
    try {
      // Extract userId from channel (format: user:{userId})
      const userId = channel.split(":")[1];
      if (!userId) return;

      const parsedMessage = JSON.parse(message) as WebSocketMessage;

      // Send to all local connections for this user
      this.sendToUser(userId, parsedMessage);
    } catch (error) {
      console.error("Error handling Redis message:", error);
    }
  }

  async handleConnection(
    ws: WebSocket,
    userId: string,
    userType: UserType,
    deviceId: string,
    platform: "ios" | "android" | "web",
    metadata: Record<string, unknown> = {},
  ): Promise<string> {
    const connectionId = nanoid();

    const connection: WebSocketConnection = {
      id: connectionId,
      userId,
      userType,
      deviceId,
      platform,
      connectedAt: new Date(),
      lastHeartbeat: new Date(),
      subscriptions: new Set(),
      metadata,
    };

    // Store connection
    this.connections.set(connectionId, connection);
    this.websockets.set(connectionId, ws);

    // Track user's connections (supports multiple devices)
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    this.userConnections.get(userId)!.add(connectionId);

    // Register in Redis for cross-server messaging
    await this.redis.sadd(`user:${userId}:connections`, connectionId);
    await this.redis.hset(`connection:${connectionId}`, {
      serverId: this.serverId,
      userId,
      userType,
      deviceId,
      platform,
      connectedAt: connection.connectedAt.toISOString(),
    });
    await this.redis.expire(`connection:${connectionId}`, 7200); // 2 hour TTL

    // Subscribe to user's channel
    await this.subscribeToChannel(`user:${userId}`);

    // Setup WebSocket handlers
    this.setupWebSocketHandlers(ws, connectionId);

    // Emit connection event
    await this.emitConnectionEvent({
      type: "connect",
      connectionId,
      userId,
      userType,
      timestamp: new Date(),
    });

    console.log(
      `[${userType}] ${userId} connected (${connectionId}) on ${platform}`,
    );

    return connectionId;
  }

  private setupWebSocketHandlers(ws: WebSocket, connectionId: string) {
    ws.on("message", async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as WebSocketMessage;
        await this.handleMessage(connectionId, message);
      } catch (error) {
        console.error("Error parsing message:", error);
        this.sendError(
          connectionId,
          "INVALID_MESSAGE",
          "Failed to parse message",
        );
      }
    });

    ws.on("close", () => {
      this.handleDisconnection(connectionId);
    });

    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
      this.handleDisconnection(connectionId);
    });

    // Setup heartbeat
    this.startHeartbeat(connectionId);
  }

  private startHeartbeat(connectionId: string) {
    const interval = setInterval(() => {
      const connection = this.connections.get(connectionId);
      if (!connection) {
        clearInterval(interval);
        return;
      }

      // Check if connection is stale (no heartbeat for 60 seconds)
      const staleTimeout = 60000;
      if (Date.now() - connection.lastHeartbeat.getTime() > staleTimeout) {
        console.log(`Connection ${connectionId} stale, closing`);
        this.handleDisconnection(connectionId);
        clearInterval(interval);
        return;
      }

      // Send heartbeat
      this.send(connectionId, {
        type: "heartbeat",
        payload: { timestamp: Date.now() },
      });
    }, 30000); // Every 30 seconds

    // Store interval for cleanup
    (this.connections.get(connectionId) as any)._heartbeatInterval = interval;
  }

  private async handleMessage(connectionId: string, message: WebSocketMessage) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    switch (message.type) {
      case "heartbeat_ack":
        connection.lastHeartbeat = new Date();
        break;

      case "location_update":
        await this.handleLocationUpdate(connection, message.payload);
        break;

      case "dispatch_response":
        await this.handleDispatchResponse(connection, message.payload);
        break;

      default:
        console.warn(`Unhandled message type: ${message.type}`);
    }
  }

  private async handleLocationUpdate(
    connection: WebSocketConnection,
    payload: any,
  ) {
    if (connection.userType !== "driver") {
      this.sendError(
        connection.id,
        "INVALID_USER_TYPE",
        "Only drivers can send location updates",
      );
      return;
    }

    // Publish to Redis for other services
    await this.redis.publish(
      `driver:${connection.userId}:location`,
      JSON.stringify({
        driverId: connection.userId,
        ...payload,
        timestamp: Date.now(),
      }),
    );

    // Could also send to Kafka for processing/storage
  }

  private async handleDispatchResponse(
    connection: WebSocketConnection,
    payload: any,
  ) {
    if (connection.userType !== "driver") {
      this.sendError(
        connection.id,
        "INVALID_USER_TYPE",
        "Only drivers can respond to dispatches",
      );
      return;
    }

    // Store response in Redis for matching service
    await this.redis.setex(
      `dispatch:${payload.dispatchId}:response`,
      30, // 30 second TTL
      JSON.stringify({
        driverId: connection.userId,
        ...payload,
        timestamp: Date.now(),
      }),
    );

    // Publish event
    await this.redis.publish(
      `dispatch:${payload.dispatchId}:response`,
      JSON.stringify(payload),
    );
  }

  async handleDisconnection(connectionId: string) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    console.log(
      `[${connection.userType}] ${connection.userId} disconnected (${connectionId})`,
    );

    // Clear heartbeat
    const interval = (connection as any)._heartbeatInterval;
    if (interval) clearInterval(interval);

    // Remove from tracking
    this.connections.delete(connectionId);
    this.websockets.delete(connectionId);

    const userConns = this.userConnections.get(connection.userId);
    if (userConns) {
      userConns.delete(connectionId);
      if (userConns.size === 0) {
        this.userConnections.delete(connection.userId);
      }
    }

    // Remove from Redis
    await this.redis.srem(
      `user:${connection.userId}:connections`,
      connectionId,
    );
    await this.redis.del(`connection:${connectionId}`);

    // Unsubscribe if no more connections for this user on this server
    if (!userConns || userConns.size === 0) {
      await this.unsubscribeFromChannel(`user:${connection.userId}`);
    }

    // Emit disconnection event
    await this.emitConnectionEvent({
      type: "disconnect",
      connectionId,
      userId: connection.userId,
      userType: connection.userType,
      timestamp: new Date(),
    });
  }

  send(connectionId: string, message: WebSocketMessage) {
    const ws = this.websockets.get(connectionId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error("Error sending message:", error);
    }
  }

  sendToUser(userId: string, message: WebSocketMessage) {
    const connectionIds = this.userConnections.get(userId);
    if (!connectionIds) return;

    for (const connId of connectionIds) {
      this.send(connId, message);
    }
  }

  async broadcastToUser(userId: string, message: WebSocketMessage) {
    // Send to local connections
    this.sendToUser(userId, message);

    // Publish to Redis for other servers
    await this.redis.publish(`user:${userId}`, JSON.stringify(message));
  }

  sendError(connectionId: string, code: string, message: string) {
    this.send(connectionId, {
      type: "error",
      payload: { code, message },
    });
  }

  private async subscribeToChannel(channel: string) {
    // Check if already subscribed
    const subscribers = (await this.redis.pubsub("NUMSUB", channel)) as [
      string,
      number,
    ];
    if (subscribers[1] > 0) return;

    await this.redisSub.subscribe(channel);
  }

  private async unsubscribeFromChannel(channel: string) {
    await this.redisSub.unsubscribe(channel);
  }

  private async emitConnectionEvent(event: ConnectionEvent) {
    await this.redis.publish("events:connections", JSON.stringify(event));
  }

  getConnectionStats() {
    const statsByUserType: Record<string, number> = {};

    for (const conn of this.connections.values()) {
      statsByUserType[conn.userType] =
        (statsByUserType[conn.userType] || 0) + 1;
    }

    return {
      serverId: this.serverId,
      totalConnections: this.connections.size,
      uniqueUsers: this.userConnections.size,
      byUserType: statsByUserType,
      uptime: process.uptime(),
    };
  }

  private async cleanup() {
    console.log("Cleaning up connections...");

    // Close all WebSockets
    for (const [connId, ws] of this.websockets.entries()) {
      ws.close(1001, "Server shutting down");
      await this.handleDisconnection(connId);
    }

    // Close Redis connections
    await this.redis.quit();
    await this.redisSub.quit();

    console.log("Cleanup complete");
  }
}
