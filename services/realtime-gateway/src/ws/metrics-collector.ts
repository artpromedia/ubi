/**
 * Connection Metrics Collector
 *
 * Tracks real-time metrics for monitoring and alerting:
 * - Active connections count
 * - Message throughput (messages/sec)
 * - Message latency (avg, p95, p99)
 * - Reconnection rate
 * - Error rate
 */

import { Redis } from "ioredis";
import type {
  ConnectionMetrics,
  ServerMetrics,
  UserType,
  WebSocketConfig,
  WebSocketConnection,
} from "./types.js";

interface LatencySample {
  value: number;
  timestamp: number;
}

interface ConnectionStats {
  messagesReceived: number;
  messagesSent: number;
  bytesReceived: number;
  bytesSent: number;
  latencySamples: LatencySample[];
}

export class MetricsCollector {
  private redis: Redis;
  private serverId: string;

  // In-memory counters for high-frequency updates
  private connectionStats = new Map<string, ConnectionStats>();
  private globalStats = {
    totalMessages: 0,
    totalErrors: 0,
    totalReconnects: 0,
    messagesBySecond: new Map<number, number>(),
    errorsBySecond: new Map<number, number>(),
    reconnectsBySecond: new Map<number, number>(),
  };

  // Rolling window for latency percentiles
  private latencySamples: number[] = [];
  private maxSamples: number;

  // Periodic flush interval
  private flushInterval?: NodeJS.Timeout;

  constructor(redis: Redis, config: WebSocketConfig, serverId: string) {
    this.redis = redis;
    this.serverId = serverId;
    this.maxSamples = config.latencyWindowSize;

    // Start periodic flush to Redis
    this.flushInterval = setInterval(
      () => this.flushToRedis(),
      config.metricsIntervalMs
    );
  }

  /**
   * Record a connection event
   */
  recordConnection(connectionId: string): void {
    this.connectionStats.set(connectionId, {
      messagesReceived: 0,
      messagesSent: 0,
      bytesReceived: 0,
      bytesSent: 0,
      latencySamples: [],
    });
  }

  /**
   * Record a disconnection
   */
  recordDisconnection(connectionId: string): void {
    this.connectionStats.delete(connectionId);
  }

  /**
   * Record a reconnection event
   */
  recordReconnection(): void {
    this.globalStats.totalReconnects++;
    const second = Math.floor(Date.now() / 1000);
    this.globalStats.reconnectsBySecond.set(
      second,
      (this.globalStats.reconnectsBySecond.get(second) || 0) + 1
    );
  }

  /**
   * Record an outbound message
   */
  recordMessageSent(connectionId: string, bytes: number): void {
    const stats = this.connectionStats.get(connectionId);
    if (stats) {
      stats.messagesSent++;
      stats.bytesSent += bytes;
    }
    this.globalStats.totalMessages++;
    const second = Math.floor(Date.now() / 1000);
    this.globalStats.messagesBySecond.set(
      second,
      (this.globalStats.messagesBySecond.get(second) || 0) + 1
    );
  }

  /**
   * Record an inbound message
   */
  recordMessageReceived(connectionId: string, bytes: number): void {
    const stats = this.connectionStats.get(connectionId);
    if (stats) {
      stats.messagesReceived++;
      stats.bytesReceived += bytes;
    }
  }

  /**
   * Record message latency (round-trip time)
   */
  recordLatency(connectionId: string, latencyMs: number): void {
    // Connection-specific
    const stats = this.connectionStats.get(connectionId);
    if (stats) {
      stats.latencySamples.push({
        value: latencyMs,
        timestamp: Date.now(),
      });
      // Keep only recent samples
      if (stats.latencySamples.length > this.maxSamples) {
        stats.latencySamples.shift();
      }
    }

    // Global
    this.latencySamples.push(latencyMs);
    if (this.latencySamples.length > this.maxSamples * 10) {
      this.latencySamples = this.latencySamples.slice(-this.maxSamples * 10);
    }
  }

  /**
   * Record an error
   */
  recordError(_errorType: string): void {
    this.globalStats.totalErrors++;
    const second = Math.floor(Date.now() / 1000);
    this.globalStats.errorsBySecond.set(
      second,
      (this.globalStats.errorsBySecond.get(second) || 0) + 1
    );
  }

  /**
   * Get metrics for a specific connection
   */
  getConnectionMetrics(connection: WebSocketConnection): ConnectionMetrics {
    const stats = this.connectionStats.get(connection.id) || {
      messagesReceived: 0,
      messagesSent: 0,
      bytesReceived: 0,
      bytesSent: 0,
      latencySamples: [],
    };

    const latencies = stats.latencySamples.map((s) => s.value);
    const { avg, p99 } = this.calculatePercentiles(latencies);

    return {
      connectionId: connection.id,
      userId: connection.userId,
      userType: connection.userType,
      platform: connection.platform,
      connectedAt: connection.connectedAt,
      messagesReceived: stats.messagesReceived,
      messagesSent: stats.messagesSent,
      bytesReceived: stats.bytesReceived,
      bytesSent: stats.bytesSent,
      avgLatencyMs: avg,
      p99LatencyMs: p99,
      reconnectCount: connection.reconnectCount,
      missedHeartbeats: connection.missedHeartbeats,
      bufferSize: 0, // Will be populated by connection manager
    };
  }

  /**
   * Get server-level metrics
   */
  getServerMetrics(
    connections: Map<string, WebSocketConnection>,
    bufferMemoryBytes: number
  ): ServerMetrics {
    const byType: Record<UserType, number> = {
      rider: 0,
      driver: 0,
      restaurant: 0,
      delivery_partner: 0,
    };
    const byPlatform: Record<string, number> = {};
    const uniqueUsers = new Set<string>();

    for (const conn of connections.values()) {
      byType[conn.userType]++;
      byPlatform[conn.platform] = (byPlatform[conn.platform] || 0) + 1;
      uniqueUsers.add(conn.userId);
    }

    const { avg, p99 } = this.calculatePercentiles(this.latencySamples);
    const messagesPerSecond = this.calculateRatePerSecond(
      this.globalStats.messagesBySecond
    );
    const reconnectionRate = this.calculateRatePerSecond(
      this.globalStats.reconnectsBySecond
    );
    const errorRate = this.calculateRatePerSecond(
      this.globalStats.errorsBySecond
    );

    return {
      serverId: this.serverId,
      totalConnections: connections.size,
      activeConnections: connections.size, // All connections are active
      uniqueUsers: uniqueUsers.size,
      connectionsByType: byType,
      connectionsByPlatform: byPlatform,
      messagesPerSecond,
      avgLatencyMs: avg,
      p99LatencyMs: p99,
      reconnectionRate,
      errorRate,
      bufferMemoryMB: bufferMemoryBytes / (1024 * 1024),
      uptime: process.uptime(),
    };
  }

  /**
   * Calculate percentiles from samples
   */
  private calculatePercentiles(samples: number[]): {
    avg: number;
    p99: number;
  } {
    if (samples.length === 0) {
      return { avg: 0, p99: 0 };
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const p99Index = Math.floor(sorted.length * 0.99);
    const p99 = sorted[p99Index] || sorted[sorted.length - 1];

    return { avg: Math.round(avg * 100) / 100, p99: p99 ?? 0 };
  }

  /**
   * Calculate rate per second from timestamped counters
   */
  private calculateRatePerSecond(counters: Map<number, number>): number {
    const now = Math.floor(Date.now() / 1000);
    const windowSeconds = 60; // Last minute
    let total = 0;

    for (const [second, count] of counters) {
      if (now - second <= windowSeconds) {
        total += count;
      }
    }

    return Math.round((total / windowSeconds) * 100) / 100;
  }

  /**
   * Flush metrics to Redis for aggregation
   */
  private async flushToRedis(): Promise<void> {
    try {
      const metrics = {
        serverId: this.serverId,
        timestamp: Date.now(),
        connections: this.connectionStats.size,
        messagesPerSecond: this.calculateRatePerSecond(
          this.globalStats.messagesBySecond
        ),
        errorRate: this.calculateRatePerSecond(this.globalStats.errorsBySecond),
        reconnectionRate: this.calculateRatePerSecond(
          this.globalStats.reconnectsBySecond
        ),
        latency: this.calculatePercentiles(this.latencySamples),
      };

      // Store in Redis for dashboard
      await this.redis.hset(
        "ws:metrics:servers",
        this.serverId,
        JSON.stringify(metrics)
      );
      await this.redis.expire("ws:metrics:servers", 120); // 2 min TTL

      // Publish for real-time monitoring
      await this.redis.publish("ws:metrics", JSON.stringify(metrics));

      // Cleanup old counters (keep last 5 minutes)
      const cutoff = Math.floor(Date.now() / 1000) - 300;
      for (const [second] of this.globalStats.messagesBySecond) {
        if (second < cutoff) this.globalStats.messagesBySecond.delete(second);
      }
      for (const [second] of this.globalStats.errorsBySecond) {
        if (second < cutoff) this.globalStats.errorsBySecond.delete(second);
      }
      for (const [second] of this.globalStats.reconnectsBySecond) {
        if (second < cutoff) this.globalStats.reconnectsBySecond.delete(second);
      }
    } catch (error) {
      console.error("Failed to flush metrics to Redis:", error);
    }
  }

  /**
   * Get aggregated metrics from all servers
   */
  async getClusterMetrics(): Promise<ServerMetrics[]> {
    try {
      const servers = await this.redis.hgetall("ws:metrics:servers");
      return Object.values(servers).map((s) => JSON.parse(s));
    } catch (error) {
      console.error("Failed to get cluster metrics:", error);
      return [];
    }
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
  }
}
