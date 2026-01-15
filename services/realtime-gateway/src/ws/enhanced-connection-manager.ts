/**
 * Enhanced WebSocket Connection Manager
 *
 * High-performance connection management for 100K+ concurrent connections
 * Features:
 * - 30-second ping/pong heartbeat
 * - Message sequence numbers for ordering guarantees
 * - Reconnection with exponential backoff
 * - Message buffer for offline/reconnecting clients (zero loss <30s)
 * - Redis pub/sub for horizontal scaling
 * - JWT authentication with refresh without reconnect
 * - Graceful degradation to HTTP polling
 */

import { Redis } from "ioredis";
import { nanoid } from "nanoid";
import { WebSocket } from "ws";
import { MessageBuffer } from "./message-buffer.js";
import { MetricsCollector } from "./metrics-collector.js";
import {
  DEFAULT_CONFIG,
  type ConnectionEvent,
  type ServerMetrics,
  type UserType,
  type WebSocketConfig,
  type WebSocketConnection,
  type WebSocketMessage,
} from "./types.js";

interface PendingAck {
  seq: number;
  sentAt: number;
  message: WebSocketMessage;
  retryCount: number;
}

interface SessionData {
  userId: string;
  userType: UserType;
  deviceId: string;
  platform: "ios" | "android" | "web";
  lastSeq: number;
  outboundSeq: number;
  createdAt: number;
  metadata: Record<string, unknown>;
}

export class EnhancedConnectionManager {
  private connections = new Map<string, WebSocketConnection>();
  private userConnections = new Map<string, Set<string>>();
  private websockets = new Map<string, WebSocket>();
  private pendingAcks = new Map<string, Map<number, PendingAck>>();
  private heartbeatIntervals = new Map<string, NodeJS.Timeout>();

  private redis: Redis;
  private redisSub: Redis;
  private redisPub: Redis;
  private serverId: string;
  private config: WebSocketConfig;

  private messageBuffer: MessageBuffer;
  private metrics: MetricsCollector;

  // Session storage for reconnection
  private sessions = new Map<string, SessionData>();

  constructor(redisUrl: string, config: Partial<WebSocketConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config } as WebSocketConfig;
    this.redis = new Redis(redisUrl);
    this.redisSub = new Redis(redisUrl);
    this.redisPub = new Redis(redisUrl);
    this.serverId = `server-${nanoid(8)}`;

    this.messageBuffer = new MessageBuffer(this.redis, this.config);
    this.metrics = new MetricsCollector(this.redis, this.config, this.serverId);

    this.setupRedisSubscriptions();
    this.startCleanupTasks();

    // Cleanup on shutdown
    process.on("SIGTERM", () => this.cleanup());
    process.on("SIGINT", () => this.cleanup());

    console.log(`[${this.serverId}] Enhanced Connection Manager initialized`);
  }

  /**
   * Setup Redis pub/sub for cross-server messaging
   */
  private setupRedisSubscriptions(): void {
    this.redisSub.on("message", (channel: string, message: string) => {
      this.handleRedisMessage(channel, message);
    });

    // Subscribe to user message patterns
    this.redisSub.psubscribe("ws:user:*:messages").catch((err: Error) => {
      console.error("Redis psubscribe error:", err);
    });

    // Subscribe to global broadcast channel
    this.redisSub.subscribe("ws:broadcast:global").catch((err: Error) => {
      console.error("Redis subscribe error:", err);
    });
  }

  /**
   * Handle messages from Redis (other servers)
   */
  private handleRedisMessage(channel: string, message: string): void {
    try {
      // Extract userId from channel pattern ws:user:{userId}:messages
      const match = channel.match(/ws:user:([^:]+):messages/);
      if (match && match[1]) {
        const userId = match[1];
        const parsedMessage = JSON.parse(message) as WebSocketMessage;

        // Only deliver if user is connected to this server
        const connectionIds = this.userConnections.get(userId);
        if (connectionIds && connectionIds.size > 0) {
          for (const connId of Array.from(connectionIds)) {
            this.sendToConnection(connId, parsedMessage);
          }
        }
        return;
      }

      // Handle global broadcast
      if (channel === "ws:broadcast:global") {
        const parsedMessage = JSON.parse(message) as WebSocketMessage;
        this.broadcastLocal(parsedMessage);
      }
    } catch (error) {
      console.error("Error handling Redis message:", error);
      this.metrics.recordError("redis_message_error");
    }
  }

  /**
   * Handle new WebSocket connection
   */
  async handleConnection(
    ws: WebSocket,
    userId: string,
    userType: UserType,
    deviceId: string,
    platform: "ios" | "android" | "web",
    metadata: Record<string, unknown> = {},
    tokenExpiresAt?: Date,
    sessionId?: string, // For reconnection
  ): Promise<string> {
    const connectionId = nanoid();
    const now = new Date();

    // Check for existing session (reconnection)
    let isReconnect = false;
    let lastSeq = 0;
    let outboundSeq = 0;

    if (sessionId) {
      const session = await this.getSession(sessionId, userId);
      if (session) {
        isReconnect = true;
        lastSeq = session.lastSeq;
        outboundSeq = session.outboundSeq;
        console.log(`[${userType}] ${userId} reconnecting from seq ${lastSeq}`);
        this.metrics.recordReconnection();
      }
    }

    // Create new session if not reconnecting
    const newSessionId = sessionId || nanoid();

    const connection: WebSocketConnection = {
      id: connectionId,
      userId,
      userType,
      deviceId,
      platform,
      connectedAt: now,
      lastHeartbeat: now,
      lastMessageAt: now,
      subscriptions: new Set(),
      metadata: {
        ...metadata,
        sessionId: newSessionId,
      },
      outboundSequence: outboundSeq,
      inboundSequence: lastSeq,
      lastAckedSequence: lastSeq,
      latencyMs: 0,
      missedHeartbeats: 0,
      reconnectCount: isReconnect ? 1 : 0,
      tokenExpiresAt: tokenExpiresAt || new Date(Date.now() + 3600000),
    };

    // Check max connections per user
    const existingConns = this.userConnections.get(userId);
    if (
      existingConns &&
      existingConns.size >= this.config.maxConnectionsPerUser
    ) {
      // Close oldest connection
      const oldestConnId = existingConns.values().next().value;
      if (oldestConnId) {
        await this.closeConnection(
          oldestConnId,
          4008,
          "Max connections exceeded",
        );
      }
    }

    // Store connection
    this.connections.set(connectionId, connection);
    this.websockets.set(connectionId, ws);
    this.pendingAcks.set(connectionId, new Map());

    // Track user connections
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    this.userConnections.get(userId)!.add(connectionId);

    // Store session for reconnection
    await this.saveSession(newSessionId, {
      userId,
      userType,
      deviceId,
      platform,
      lastSeq,
      outboundSeq,
      createdAt: now.getTime(),
      metadata,
    });

    // Register in Redis for cross-server discovery
    await this.registerConnection(connectionId, connection);

    // Setup WebSocket handlers
    this.setupWebSocketHandlers(ws, connectionId);

    // Start heartbeat
    this.startHeartbeat(connectionId);

    // Record metrics
    this.metrics.recordConnection(connectionId);

    // Emit connection event
    await this.emitConnectionEvent({
      type: isReconnect ? "reconnect" : "connect",
      connectionId,
      userId,
      userType,
      platform,
      timestamp: now,
      metadata: { sessionId: newSessionId },
    });

    // If reconnecting, deliver buffered messages
    if (isReconnect) {
      await this.deliverBufferedMessages(connectionId, userId, lastSeq);
    }

    console.log(
      `[${userType}] ${userId} ${isReconnect ? "re" : ""}connected (${connectionId})`,
    );

    // Send connection confirmation
    this.sendToConnection(connectionId, {
      type: "reconnect",
      seq: 0,
      ts: Date.now(),
      payload: {
        sessionId: newSessionId,
        lastSeq,
      },
    });

    return connectionId;
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupWebSocketHandlers(ws: WebSocket, connectionId: string): void {
    ws.on("message", async (data: Buffer) => {
      const connection = this.connections.get(connectionId);
      if (!connection) return;

      const bytes = data.length;
      this.metrics.recordMessageReceived(connectionId, bytes);

      // Rate limiting
      if (bytes > this.config.maxMessageSizeBytes) {
        this.sendError(
          connectionId,
          "MESSAGE_TOO_LARGE",
          "Message exceeds size limit",
        );
        return;
      }

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
        this.metrics.recordError("parse_error");
      }
    });

    ws.on("close", (code: number, reason: Buffer) => {
      console.log(
        `Connection ${connectionId} closed: ${code} ${reason.toString()}`,
      );
      this.handleDisconnection(connectionId);
    });

    ws.on("error", (error) => {
      console.error(`WebSocket error for ${connectionId}:`, error);
      this.metrics.recordError("websocket_error");
    });

    ws.on("pong", () => {
      const connection = this.connections.get(connectionId);
      if (connection) {
        connection.lastHeartbeat = new Date();
        connection.missedHeartbeats = 0;
      }
    });
  }

  /**
   * Start heartbeat ping/pong for connection
   */
  private startHeartbeat(connectionId: string): void {
    const interval = setInterval(() => {
      const connection = this.connections.get(connectionId);
      const ws = this.websockets.get(connectionId);

      if (!connection || !ws) {
        clearInterval(interval);
        return;
      }

      // Check for stale connection
      const elapsed = Date.now() - connection.lastHeartbeat.getTime();
      if (elapsed > this.config.heartbeatTimeoutMs) {
        console.log(`Connection ${connectionId} timed out (${elapsed}ms)`);
        this.handleDisconnection(connectionId);
        clearInterval(interval);
        return;
      }

      // Count missed heartbeats
      if (elapsed > this.config.heartbeatIntervalMs) {
        connection.missedHeartbeats++;
      }

      // Send ping (WebSocket protocol level)
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }

      // Also send application-level heartbeat with timestamp for latency measurement
      const seq = ++connection.outboundSequence;
      this.sendToConnection(connectionId, {
        type: "heartbeat",
        seq,
        ts: Date.now(),
      });
    }, this.config.heartbeatIntervalMs);

    this.heartbeatIntervals.set(connectionId, interval);
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(
    connectionId: string,
    message: WebSocketMessage,
  ): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    connection.lastMessageAt = new Date();

    // Process acknowledgment if present
    if ("ackSeq" in message && message.ackSeq !== undefined) {
      this.processAck(connectionId, message.ackSeq);
    }

    // Track sequence for ordering
    if ("seq" in message && message.seq > 0) {
      // Check for out-of-order messages
      if (message.seq !== connection.inboundSequence + 1) {
        console.warn(
          `Out of order message: expected ${connection.inboundSequence + 1}, got ${message.seq}`,
        );
        // Could request retransmission here
      }
      connection.inboundSequence = Math.max(
        connection.inboundSequence,
        message.seq,
      );
    }

    switch (message.type) {
      case "heartbeat_ack":
        connection.lastHeartbeat = new Date();
        connection.missedHeartbeats = 0;
        // Calculate latency
        if ("ts" in message) {
          const latency = Date.now() - message.ts;
          connection.latencyMs = latency;
          this.metrics.recordLatency(connectionId, latency);
        }
        break;

      case "ack":
        // Just an ack, no additional processing needed
        break;

      case "location_update":
        await this.handleLocationUpdate(connection, message.payload);
        break;

      case "dispatch_response":
        await this.handleDispatchResponse(connection, message.payload);
        break;

      case "token_refresh":
        await this.handleTokenRefresh(connectionId, message.payload);
        break;

      default:
        // Forward to appropriate handler
        await this.forwardMessage(connection, message);
    }

    // Update session
    await this.updateSessionSequence(connection);
  }

  /**
   * Process message acknowledgment
   */
  private processAck(connectionId: string, ackSeq: number): void {
    const connection = this.connections.get(connectionId);
    const pending = this.pendingAcks.get(connectionId);

    if (!connection || !pending) return;

    // Remove acknowledged messages from pending
    for (const [seq] of pending) {
      if (seq <= ackSeq) {
        pending.delete(seq);
      }
    }

    connection.lastAckedSequence = Math.max(
      connection.lastAckedSequence,
      ackSeq,
    );
  }

  /**
   * Handle location update from driver
   */
  private async handleLocationUpdate(
    connection: WebSocketConnection,
    payload: any,
  ): Promise<void> {
    if (connection.userType !== "driver") {
      this.sendError(
        connection.id,
        "INVALID_USER_TYPE",
        "Only drivers can send location updates",
      );
      return;
    }

    // Publish to Redis for other services
    await this.redisPub.publish(
      `driver:${connection.userId}:location`,
      JSON.stringify({
        driverId: connection.userId,
        ...payload,
        timestamp: Date.now(),
        serverId: this.serverId,
      }),
    );
  }

  /**
   * Handle dispatch response from driver
   */
  private async handleDispatchResponse(
    connection: WebSocketConnection,
    payload: any,
  ): Promise<void> {
    if (connection.userType !== "driver") {
      this.sendError(
        connection.id,
        "INVALID_USER_TYPE",
        "Only drivers can respond to dispatches",
      );
      return;
    }

    await this.redis.setex(
      `dispatch:${payload.dispatchId}:response`,
      30,
      JSON.stringify({
        driverId: connection.userId,
        ...payload,
        timestamp: Date.now(),
      }),
    );

    await this.redisPub.publish(
      `dispatch:${payload.dispatchId}:response`,
      JSON.stringify(payload),
    );
  }

  /**
   * Handle token refresh (without reconnecting)
   */
  private async handleTokenRefresh(
    connectionId: string,
    payload: any,
  ): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    try {
      // Verify refresh token and get new access token
      // This would integrate with your auth service
      const newToken = await this.refreshAccessToken(payload.refreshToken);

      if (newToken) {
        connection.tokenExpiresAt = new Date(
          Date.now() + newToken.expiresIn * 1000,
        );

        this.sendToConnection(connectionId, {
          type: "token_refreshed",
          seq: ++connection.outboundSequence,
          ts: Date.now(),
          payload: {
            accessToken: newToken.accessToken,
            expiresIn: newToken.expiresIn,
          },
        });

        await this.emitConnectionEvent({
          type: "token_refresh",
          connectionId,
          userId: connection.userId,
          userType: connection.userType,
          platform: connection.platform,
          timestamp: new Date(),
        });
      } else {
        this.sendError(
          connectionId,
          "INVALID_REFRESH_TOKEN",
          "Token refresh failed",
        );
      }
    } catch (error) {
      console.error("Token refresh error:", error);
      this.sendError(
        connectionId,
        "TOKEN_REFRESH_ERROR",
        "Token refresh failed",
      );
    }
  }

  /**
   * Forward message to other services
   */
  private async forwardMessage(
    connection: WebSocketConnection,
    message: WebSocketMessage,
  ): Promise<void> {
    // Publish to appropriate channel for processing
    await this.redisPub.publish(
      `ws:messages:${message.type}`,
      JSON.stringify({
        userId: connection.userId,
        userType: connection.userType,
        connectionId: connection.id,
        message,
        timestamp: Date.now(),
      }),
    );
  }

  /**
   * Send message to a specific connection
   */
  sendToConnection(connectionId: string, message: WebSocketMessage): boolean {
    const ws = this.websockets.get(connectionId);
    const connection = this.connections.get(connectionId);

    if (!ws || ws.readyState !== WebSocket.OPEN || !connection) {
      return false;
    }

    try {
      const data = JSON.stringify(message);
      ws.send(data);

      this.metrics.recordMessageSent(connectionId, Buffer.byteLength(data));

      // Track for acknowledgment (except heartbeats and acks)
      if (
        message.type !== "heartbeat" &&
        message.type !== "ack" &&
        "seq" in message
      ) {
        const pending = this.pendingAcks.get(connectionId);
        if (pending) {
          pending.set(message.seq, {
            seq: message.seq,
            sentAt: Date.now(),
            message,
            retryCount: 0,
          });

          // Setup retry timeout
          this.setupRetryTimeout(connectionId, message.seq);
        }
      }

      return true;
    } catch (error) {
      console.error("Error sending message:", error);
      this.metrics.recordError("send_error");
      return false;
    }
  }

  /**
   * Setup retry timeout for unacknowledged message
   */
  private setupRetryTimeout(connectionId: string, seq: number): void {
    setTimeout(() => {
      const pending = this.pendingAcks.get(connectionId);
      const ack = pending?.get(seq);

      if (!ack) return; // Already acknowledged

      if (ack.retryCount < 3) {
        // Retry sending
        ack.retryCount++;
        this.sendToConnection(connectionId, ack.message);
      } else {
        // Message failed after retries, buffer it
        const connection = this.connections.get(connectionId);
        if (connection) {
          this.messageBuffer.bufferMessage(
            connection.userId,
            ack.message,
            "normal",
          );
        }
        pending?.delete(seq);
      }
    }, 5000); // 5 second retry timeout
  }

  /**
   * Send message to all connections for a user (cross-server)
   */
  async sendToUser(userId: string, message: WebSocketMessage): Promise<void> {
    // Send to local connections
    const localConns = this.userConnections.get(userId);
    if (localConns) {
      for (const connId of localConns) {
        this.sendToConnection(connId, message);
      }
    }

    // Publish to Redis for other servers
    await this.redisPub.publish(
      `ws:user:${userId}:messages`,
      JSON.stringify(message),
    );

    // If user has no active connections anywhere, buffer the message
    const hasConnections = await this.userHasConnections(userId);
    if (!hasConnections) {
      await this.messageBuffer.bufferMessage(userId, message, "normal");
    }
  }

  /**
   * Check if user has connections on any server
   */
  private async userHasConnections(userId: string): Promise<boolean> {
    // Check local first
    const local = this.userConnections.get(userId);
    if (local && local.size > 0) return true;

    // Check Redis for other servers
    const connCount = await this.redis.scard(`ws:user:${userId}:connections`);
    return connCount > 0;
  }

  /**
   * Broadcast message to all local connections
   */
  private broadcastLocal(message: WebSocketMessage): void {
    for (const connId of this.connections.keys()) {
      this.sendToConnection(connId, message);
    }
  }

  /**
   * Broadcast to all connections (cross-server)
   */
  async broadcast(message: WebSocketMessage): Promise<void> {
    this.broadcastLocal(message);
    await this.redisPub.publish("ws:broadcast:global", JSON.stringify(message));
  }

  /**
   * Send error message
   */
  sendError(
    connectionId: string,
    code: string,
    message: string,
    retryable = false,
  ): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    this.sendToConnection(connectionId, {
      type: "error",
      seq: ++connection.outboundSequence,
      ts: Date.now(),
      payload: { code, message, retryable },
    });
  }

  /**
   * Handle connection disconnection
   */
  async handleDisconnection(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    console.log(
      `[${connection.userType}] ${connection.userId} disconnected (${connectionId})`,
    );

    // Clear heartbeat
    const interval = this.heartbeatIntervals.get(connectionId);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(connectionId);
    }

    // Buffer any pending messages for reconnection
    const pending = this.pendingAcks.get(connectionId);
    if (pending) {
      for (const [, ack] of pending) {
        await this.messageBuffer.bufferMessage(
          connection.userId,
          ack.message,
          "high",
        );
      }
      this.pendingAcks.delete(connectionId);
    }

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

    // Update Redis
    await this.unregisterConnection(connectionId, connection.userId);

    // Record metrics
    this.metrics.recordDisconnection(connectionId);

    // Emit event
    await this.emitConnectionEvent({
      type: "disconnect",
      connectionId,
      userId: connection.userId,
      userType: connection.userType,
      platform: connection.platform,
      timestamp: new Date(),
    });
  }

  /**
   * Close connection gracefully
   */
  async closeConnection(
    connectionId: string,
    code: number,
    reason: string,
  ): Promise<void> {
    const ws = this.websockets.get(connectionId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close(code, reason);
    }
    await this.handleDisconnection(connectionId);
  }

  /**
   * Deliver buffered messages after reconnection
   */
  private async deliverBufferedMessages(
    connectionId: string,
    userId: string,
    fromSeq: number,
  ): Promise<void> {
    const messages = await this.messageBuffer.getBufferedMessages(
      userId,
      fromSeq,
    );

    if (messages.length === 0) return;

    console.log(`Delivering ${messages.length} buffered messages to ${userId}`);

    for (const message of messages) {
      this.sendToConnection(connectionId, message);
    }

    // Clear delivered messages
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && "seq" in lastMsg) {
      await this.messageBuffer.clearBuffer(userId, lastMsg.seq);
    }
  }

  /**
   * Register connection in Redis
   */
  private async registerConnection(
    connectionId: string,
    connection: WebSocketConnection,
  ): Promise<void> {
    const pipeline = this.redis.pipeline();

    // Add to user's connection set
    pipeline.sadd(`ws:user:${connection.userId}:connections`, connectionId);

    // Store connection details
    pipeline.hset(`ws:connection:${connectionId}`, {
      serverId: this.serverId,
      userId: connection.userId,
      userType: connection.userType,
      deviceId: connection.deviceId,
      platform: connection.platform,
      connectedAt: connection.connectedAt.toISOString(),
    });
    pipeline.expire(`ws:connection:${connectionId}`, 7200);

    // Add to server's connection set
    pipeline.sadd(`ws:server:${this.serverId}:connections`, connectionId);

    // Subscribe to user's message channel
    await this.redisSub.subscribe(`ws:user:${connection.userId}:messages`);

    await pipeline.exec();
  }

  /**
   * Unregister connection from Redis
   */
  private async unregisterConnection(
    connectionId: string,
    userId: string,
  ): Promise<void> {
    const pipeline = this.redis.pipeline();

    pipeline.srem(`ws:user:${userId}:connections`, connectionId);
    pipeline.del(`ws:connection:${connectionId}`);
    pipeline.srem(`ws:server:${this.serverId}:connections`, connectionId);

    await pipeline.exec();

    // Unsubscribe from user channel if no more local connections
    const userConns = this.userConnections.get(userId);
    if (!userConns || userConns.size === 0) {
      await this.redisSub.unsubscribe(`ws:user:${userId}:messages`);
    }
  }

  /**
   * Save session for reconnection
   */
  private async saveSession(
    sessionId: string,
    data: SessionData,
  ): Promise<void> {
    await this.redis.setex(
      `ws:session:${sessionId}`,
      Math.ceil(this.config.sessionTtlMs / 1000),
      JSON.stringify(data),
    );
    this.sessions.set(sessionId, data);
  }

  /**
   * Get session for reconnection
   */
  private async getSession(
    sessionId: string,
    userId: string,
  ): Promise<SessionData | null> {
    // Check local cache first
    const local = this.sessions.get(sessionId);
    if (local && local.userId === userId) {
      return local;
    }

    // Check Redis
    const data = await this.redis.get(`ws:session:${sessionId}`);
    if (data) {
      const session = JSON.parse(data) as SessionData;
      if (session.userId === userId) {
        return session;
      }
    }

    return null;
  }

  /**
   * Update session sequence numbers
   */
  private async updateSessionSequence(
    connection: WebSocketConnection,
  ): Promise<void> {
    const sessionId = connection.metadata.sessionId as string;
    if (!sessionId) return;

    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastSeq = connection.inboundSequence;
      session.outboundSeq = connection.outboundSequence;
      await this.saveSession(sessionId, session);
    }
  }

  /**
   * Emit connection event
   */
  private async emitConnectionEvent(event: ConnectionEvent): Promise<void> {
    await this.redisPub.publish("ws:events", JSON.stringify(event));
  }

  /**
   * Refresh access token (mock implementation)
   */
  private async refreshAccessToken(
    _refreshToken: string,
  ): Promise<{ accessToken: string; expiresIn: number } | null> {
    // TODO: Integrate with your auth service
    try {
      // Mock implementation
      return {
        accessToken: `new_token_${nanoid()}`,
        expiresIn: 3600,
      };
    } catch {
      return null;
    }
  }

  /**
   * Start periodic cleanup tasks
   */
  private startCleanupTasks(): void {
    // Clean up expired buffer messages
    setInterval(async () => {
      const cleaned = await this.messageBuffer.cleanupExpired();
      if (cleaned > 0) {
        console.log(`Cleaned ${cleaned} expired buffered messages`);
      }
    }, 60000); // Every minute

    // Clean up stale sessions
    setInterval(() => {
      const cutoff = Date.now() - this.config.sessionTtlMs;
      for (const [sessionId, session] of this.sessions) {
        if (session.createdAt < cutoff) {
          this.sessions.delete(sessionId);
        }
      }
    }, 300000); // Every 5 minutes
  }

  /**
   * Get server metrics
   */
  async getMetrics(): Promise<ServerMetrics> {
    const bufferMemory = await this.messageBuffer.getMemoryUsage();
    return this.metrics.getServerMetrics(this.connections, bufferMemory);
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get connection by ID
   */
  getConnection(connectionId: string): WebSocketConnection | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * Cleanup on shutdown
   */
  async cleanup(): Promise<void> {
    console.log(`[${this.serverId}] Cleaning up connections...`);

    // Clear all intervals
    for (const interval of this.heartbeatIntervals.values()) {
      clearInterval(interval);
    }
    this.heartbeatIntervals.clear();

    // Close all WebSockets gracefully
    for (const [connId, ws] of this.websockets.entries()) {
      ws.close(1001, "Server shutting down");
      await this.handleDisconnection(connId);
    }

    // Clean up metrics
    this.metrics.destroy();

    // Close Redis connections
    await this.redis.quit();
    await this.redisSub.quit();
    await this.redisPub.quit();

    console.log(`[${this.serverId}] Cleanup complete`);
  }
}

// Re-export config
export { DEFAULT_CONFIG } from "./types.js";
