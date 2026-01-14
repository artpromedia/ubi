/**
 * HTTP Polling Fallback Handler
 *
 * Graceful degradation to HTTP long-polling when WebSocket is unavailable
 * Used when:
 * - Client doesn't support WebSocket
 * - WebSocket blocked by firewall/proxy
 * - Network conditions prevent WebSocket connection
 */

import { Context } from "hono";
import { Redis } from "ioredis";
import { nanoid } from "nanoid";
import type { UserType, WebSocketConfig, WebSocketMessage } from "./types.js";

interface PollingSession {
  sessionId: string;
  userId: string;
  userType: UserType;
  deviceId: string;
  createdAt: Date;
  lastPollAt: Date;
  lastSeq: number;
  isActive: boolean;
}

interface PollResponse {
  messages: WebSocketMessage[];
  nextSeq: number;
  sessionId: string;
  serverTime: number;
  retryAfterMs: number;
}

export class PollingFallbackHandler {
  private redis: Redis;
  private sessions = new Map<string, PollingSession>();

  // Polling configuration
  private readonly POLL_TIMEOUT_MS = 30000; // Long-poll timeout
  private readonly MIN_POLL_INTERVAL_MS = 1000; // Minimum time between polls
  private readonly MAX_POLL_INTERVAL_MS = 5000; // Maximum poll interval
  private readonly SESSION_TTL_MS = 300000; // 5 minutes

  constructor(redis: Redis, _config: WebSocketConfig) {
    this.redis = redis;

    // Cleanup expired sessions periodically
    setInterval(() => this.cleanupExpiredSessions(), 60000);
  }

  /**
   * Create a new polling session
   */
  async createSession(
    userId: string,
    userType: UserType,
    deviceId: string
  ): Promise<{ sessionId: string; pollUrl: string }> {
    const sessionId = nanoid();

    const session: PollingSession = {
      sessionId,
      userId,
      userType,
      deviceId,
      createdAt: new Date(),
      lastPollAt: new Date(),
      lastSeq: 0,
      isActive: true,
    };

    // Store in Redis
    await this.redis.setex(
      `poll:session:${sessionId}`,
      Math.ceil(this.SESSION_TTL_MS / 1000),
      JSON.stringify(session)
    );

    // Register session for user
    await this.redis.sadd(`poll:user:${userId}:sessions`, sessionId);

    // Store locally for fast access
    this.sessions.set(sessionId, session);

    console.log(`[Polling] New session ${sessionId} for user ${userId}`);

    return {
      sessionId,
      pollUrl: `/poll/${sessionId}`,
    };
  }

  /**
   * Long-poll endpoint for receiving messages
   */
  async poll(c: Context): Promise<Response> {
    const sessionId = c.req.param("sessionId");
    const lastSeqParam = c.req.query("lastSeq");
    const lastSeq = lastSeqParam ? parseInt(lastSeqParam, 10) : 0;

    // Get session
    const session = await this.getSession(sessionId);
    if (!session) {
      return c.json(
        { error: "Session not found or expired", code: "SESSION_EXPIRED" },
        404
      );
    }

    // Rate limiting
    const timeSinceLastPoll = Date.now() - session.lastPollAt.getTime();
    if (timeSinceLastPoll < this.MIN_POLL_INTERVAL_MS) {
      return c.json(
        {
          error: "Polling too fast",
          code: "RATE_LIMITED",
          retryAfterMs: this.MIN_POLL_INTERVAL_MS - timeSinceLastPoll,
        },
        429
      );
    }

    // Update last poll time
    session.lastPollAt = new Date();
    session.lastSeq = lastSeq;
    await this.updateSession(session);

    // Try to get messages immediately
    const messages = await this.getMessagesForUser(session.userId, lastSeq);

    if (messages.length > 0) {
      // Return immediately with messages
      const response: PollResponse = {
        messages,
        nextSeq: this.getMaxSeq(messages),
        sessionId,
        serverTime: Date.now(),
        retryAfterMs: this.MIN_POLL_INTERVAL_MS,
      };
      return c.json(response);
    }

    // Long-poll: wait for messages
    const result = await this.waitForMessages(session, this.POLL_TIMEOUT_MS);

    const response: PollResponse = {
      messages: result.messages,
      nextSeq:
        result.messages.length > 0 ? this.getMaxSeq(result.messages) : lastSeq,
      sessionId,
      serverTime: Date.now(),
      retryAfterMs:
        result.messages.length > 0
          ? this.MIN_POLL_INTERVAL_MS
          : this.MAX_POLL_INTERVAL_MS,
    };

    return c.json(response);
  }

  /**
   * Send a message via polling (POST endpoint)
   */
  async sendMessage(c: Context): Promise<Response> {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json();

    // Get session
    const session = await this.getSession(sessionId);
    if (!session) {
      return c.json(
        { error: "Session not found or expired", code: "SESSION_EXPIRED" },
        404
      );
    }

    // Process the message
    try {
      await this.handleIncomingMessage(session, body);
      return c.json({ success: true, serverTime: Date.now() });
    } catch (error) {
      console.error("Error processing message:", error);
      return c.json(
        { error: "Failed to process message", code: "PROCESSING_ERROR" },
        500
      );
    }
  }

  /**
   * End polling session
   */
  async endSession(c: Context): Promise<Response> {
    const sessionId = c.req.param("sessionId");

    const session = await this.getSession(sessionId);
    if (session) {
      await this.redis.del(`poll:session:${sessionId}`);
      await this.redis.srem(`poll:user:${session.userId}:sessions`, sessionId);
      this.sessions.delete(sessionId);
      console.log(`[Polling] Session ${sessionId} ended`);
    }

    return c.json({ success: true });
  }

  /**
   * Queue message for polling clients
   */
  async queueMessage(userId: string, message: WebSocketMessage): Promise<void> {
    // Store in Redis list for polling clients
    const key = `poll:messages:${userId}`;
    await this.redis.rpush(key, JSON.stringify(message));
    await this.redis.expire(key, 60); // 1 minute TTL

    // Trim to keep only recent messages
    await this.redis.ltrim(key, -100, -1);

    // Notify waiting long-polls via pub/sub
    await this.redis.publish(`poll:notify:${userId}`, "new_message");
  }

  /**
   * Get pending messages for user
   */
  private async getMessagesForUser(
    userId: string,
    fromSeq: number
  ): Promise<WebSocketMessage[]> {
    const key = `poll:messages:${userId}`;
    const items = await this.redis.lrange(key, 0, -1);

    const messages: WebSocketMessage[] = [];
    for (const item of items) {
      try {
        const message = JSON.parse(item) as WebSocketMessage;
        if ("seq" in message && message.seq > fromSeq) {
          messages.push(message);
        }
      } catch {
        // Skip malformed messages
      }
    }

    return messages.sort((a, b) => {
      const seqA = "seq" in a ? a.seq : 0;
      const seqB = "seq" in b ? b.seq : 0;
      return seqA - seqB;
    });
  }

  /**
   * Wait for new messages (long-polling)
   */
  private async waitForMessages(
    session: PollingSession,
    timeoutMs: number
  ): Promise<{ messages: WebSocketMessage[] }> {
    return new Promise((resolve) => {
      // Set timeout
      const timeout = setTimeout(() => {
        cleanup();
        resolve({ messages: [] });
      }, timeoutMs);

      // Subscribe to notifications
      const subClient = this.redis.duplicate();

      const cleanup = () => {
        clearTimeout(timeout);
        subClient.unsubscribe(`poll:notify:${session.userId}`);
        subClient.quit();
      };

      subClient.subscribe(`poll:notify:${session.userId}`, () => {
        subClient.on("message", async () => {
          const messages = await this.getMessagesForUser(
            session.userId,
            session.lastSeq
          );
          if (messages.length > 0) {
            cleanup();
            resolve({ messages });
          }
        });
      });
    });
  }

  /**
   * Handle incoming message from polling client
   */
  private async handleIncomingMessage(
    session: PollingSession,
    message: any
  ): Promise<void> {
    // Publish to Redis for processing by services
    await this.redis.publish(
      `ws:messages:${message.type}`,
      JSON.stringify({
        userId: session.userId,
        userType: session.userType,
        sessionId: session.sessionId,
        message,
        timestamp: Date.now(),
        source: "polling",
      })
    );
  }

  /**
   * Get session by ID
   */
  private async getSession(sessionId: string): Promise<PollingSession | null> {
    // Check local cache
    const local = this.sessions.get(sessionId);
    if (local) {
      return local;
    }

    // Check Redis
    const data = await this.redis.get(`poll:session:${sessionId}`);
    if (data) {
      const session = JSON.parse(data) as PollingSession;
      session.createdAt = new Date(session.createdAt);
      session.lastPollAt = new Date(session.lastPollAt);
      this.sessions.set(sessionId, session);
      return session;
    }

    return null;
  }

  /**
   * Update session in Redis
   */
  private async updateSession(session: PollingSession): Promise<void> {
    await this.redis.setex(
      `poll:session:${session.sessionId}`,
      Math.ceil(this.SESSION_TTL_MS / 1000),
      JSON.stringify(session)
    );
    this.sessions.set(session.sessionId, session);
  }

  /**
   * Get maximum sequence number from messages
   */
  private getMaxSeq(messages: WebSocketMessage[]): number {
    let maxSeq = 0;
    for (const msg of messages) {
      if ("seq" in msg && msg.seq > maxSeq) {
        maxSeq = msg.seq;
      }
    }
    return maxSeq;
  }

  /**
   * Clean up expired sessions
   */
  private cleanupExpiredSessions(): void {
    const cutoff = Date.now() - this.SESSION_TTL_MS;
    for (const [sessionId, session] of this.sessions) {
      if (session.lastPollAt.getTime() < cutoff) {
        this.sessions.delete(sessionId);
        console.log(`[Polling] Cleaned up expired session ${sessionId}`);
      }
    }
  }
}

/**
 * Hono routes for polling fallback
 */
export function createPollingRoutes(handler: PollingFallbackHandler) {
  const { Hono } = require("hono");
  const app = new Hono();

  // Create polling session
  app.post("/session", async (c: Context) => {
    const { userId, userType, deviceId } = await c.req.json();

    if (!userId || !userType) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const result = await handler.createSession(userId, userType, deviceId);
    return c.json(result);
  });

  // Long-poll for messages
  app.get("/:sessionId", async (c: Context) => {
    return handler.poll(c);
  });

  // Send message
  app.post("/:sessionId/message", async (c: Context) => {
    return handler.sendMessage(c);
  });

  // End session
  app.delete("/:sessionId", async (c: Context) => {
    return handler.endSession(c);
  });

  return app;
}
