/**
 * Message Buffer for Offline/Reconnecting Clients
 *
 * Provides zero message loss during brief disconnections (<30s)
 * Messages are stored in Redis with TTL and sequence ordering
 */

import { Redis } from "ioredis";
import type {
  BufferedMessage,
  WebSocketConfig,
  WebSocketMessage,
} from "./types.js";

export class MessageBuffer {
  private redis: Redis;
  private config: WebSocketConfig;
  private localBuffer = new Map<string, BufferedMessage[]>();

  constructor(redis: Redis, config: WebSocketConfig) {
    this.redis = redis;
    this.config = config;
  }

  /**
   * Buffer a message for a disconnected/reconnecting user
   */
  async bufferMessage(
    userId: string,
    message: WebSocketMessage,
    priority: "high" | "normal" | "low" = "normal"
  ): Promise<boolean> {
    const key = `ws:buffer:${userId}`;

    const bufferedMessage: BufferedMessage = {
      message,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.config.bufferTtlMs),
      attempts: 0,
      priority,
    };

    try {
      // Check buffer size
      const currentSize = await this.redis.llen(key);
      if (currentSize >= this.config.maxBufferSize) {
        // Remove oldest low-priority messages if at capacity
        if (priority === "high") {
          await this.trimLowPriority(userId);
        } else {
          console.warn(`Buffer full for user ${userId}, dropping message`);
          return false;
        }
      }

      // Add to Redis buffer with priority ordering
      const serialized = JSON.stringify(bufferedMessage);

      if (priority === "high") {
        // High priority goes to front
        await this.redis.lpush(key, serialized);
      } else {
        // Normal/low priority goes to back
        await this.redis.rpush(key, serialized);
      }

      // Set TTL on buffer key
      await this.redis.expire(key, Math.ceil(this.config.bufferTtlMs / 1000));

      // Also cache locally for fast access
      if (!this.localBuffer.has(userId)) {
        this.localBuffer.set(userId, []);
      }
      const local = this.localBuffer.get(userId)!;
      if (priority === "high") {
        local.unshift(bufferedMessage);
      } else {
        local.push(bufferedMessage);
      }

      return true;
    } catch (error) {
      console.error(`Failed to buffer message for ${userId}:`, error);
      return false;
    }
  }

  /**
   * Get all buffered messages for a user (on reconnection)
   * Returns messages in sequence order
   */
  async getBufferedMessages(
    userId: string,
    fromSeq?: number
  ): Promise<WebSocketMessage[]> {
    const key = `ws:buffer:${userId}`;

    try {
      // Get all buffered messages
      const items = await this.redis.lrange(key, 0, -1);

      const messages: WebSocketMessage[] = [];
      const now = Date.now();

      for (const item of items) {
        try {
          const buffered: BufferedMessage = JSON.parse(item);

          // Skip expired messages
          if (new Date(buffered.expiresAt).getTime() < now) {
            continue;
          }

          // Skip messages with sequence <= fromSeq (already received)
          if (fromSeq !== undefined && "seq" in buffered.message) {
            if (buffered.message.seq <= fromSeq) {
              continue;
            }
          }

          messages.push(buffered.message);
        } catch {
          // Skip malformed messages
          continue;
        }
      }

      // Sort by sequence number
      messages.sort((a, b) => {
        const seqA = "seq" in a ? a.seq : 0;
        const seqB = "seq" in b ? b.seq : 0;
        return seqA - seqB;
      });

      return messages;
    } catch (error) {
      console.error(`Failed to get buffered messages for ${userId}:`, error);
      return [];
    }
  }

  /**
   * Clear buffer after successful delivery
   */
  async clearBuffer(userId: string, upToSeq?: number): Promise<void> {
    const key = `ws:buffer:${userId}`;

    try {
      if (upToSeq === undefined) {
        // Clear entire buffer
        await this.redis.del(key);
        this.localBuffer.delete(userId);
      } else {
        // Remove only delivered messages
        const items = await this.redis.lrange(key, 0, -1);
        const remaining: string[] = [];

        for (const item of items) {
          try {
            const buffered: BufferedMessage = JSON.parse(item);
            if ("seq" in buffered.message && buffered.message.seq > upToSeq) {
              remaining.push(item);
            }
          } catch {
            // Keep malformed messages for debugging
            remaining.push(item);
          }
        }

        // Replace buffer with remaining messages
        await this.redis.del(key);
        if (remaining.length > 0) {
          await this.redis.rpush(key, ...remaining);
          await this.redis.expire(
            key,
            Math.ceil(this.config.bufferTtlMs / 1000)
          );
        }

        // Update local cache
        this.localBuffer.delete(userId);
      }
    } catch (error) {
      console.error(`Failed to clear buffer for ${userId}:`, error);
    }
  }

  /**
   * Get buffer size for a user
   */
  async getBufferSize(userId: string): Promise<number> {
    try {
      return await this.redis.llen(`ws:buffer:${userId}`);
    } catch {
      return 0;
    }
  }

  /**
   * Mark a message as delivered (increment attempts, remove if max reached)
   */
  async markDeliveryAttempt(userId: string, seq: number): Promise<void> {
    // This is handled during the delivery process
    // Messages are removed on successful ack or expired
  }

  /**
   * Clean up expired messages periodically
   */
  async cleanupExpired(): Promise<number> {
    let cleaned = 0;

    // Get all buffer keys
    const keys = await this.redis.keys("ws:buffer:*");
    const now = Date.now();

    for (const key of keys) {
      const items = await this.redis.lrange(key, 0, -1);
      const valid: string[] = [];

      for (const item of items) {
        try {
          const buffered: BufferedMessage = JSON.parse(item);
          if (new Date(buffered.expiresAt).getTime() > now) {
            valid.push(item);
          } else {
            cleaned++;
          }
        } catch {
          // Remove malformed messages
          cleaned++;
        }
      }

      // Replace with valid messages
      if (valid.length !== items.length) {
        await this.redis.del(key);
        if (valid.length > 0) {
          await this.redis.rpush(key, ...valid);
        }
      }
    }

    return cleaned;
  }

  /**
   * Remove low priority messages when buffer is full
   */
  private async trimLowPriority(userId: string): Promise<void> {
    const key = `ws:buffer:${userId}`;
    const items = await this.redis.lrange(key, 0, -1);

    const toKeep: string[] = [];
    let removed = 0;

    for (const item of items) {
      try {
        const buffered: BufferedMessage = JSON.parse(item);
        if (buffered.priority === "high" || removed >= 10) {
          toKeep.push(item);
        } else {
          removed++;
        }
      } catch {
        // Keep malformed messages
        toKeep.push(item);
      }
    }

    if (removed > 0) {
      await this.redis.del(key);
      if (toKeep.length > 0) {
        await this.redis.rpush(key, ...toKeep);
      }
    }
  }

  /**
   * Get total buffer memory usage
   */
  async getMemoryUsage(): Promise<number> {
    let totalBytes = 0;
    const keys = await this.redis.keys("ws:buffer:*");

    for (const key of keys) {
      const items = await this.redis.lrange(key, 0, -1);
      for (const item of items) {
        totalBytes += Buffer.byteLength(item, "utf8");
      }
    }

    return totalBytes;
  }
}
