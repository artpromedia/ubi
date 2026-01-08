/**
 * Enhanced WebSocket Types for High-Performance Real-Time Gateway
 * Supports 100K+ concurrent connections with message ordering guarantees
 */

export type UserType = "rider" | "driver" | "restaurant" | "delivery_partner";

export type ConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

/**
 * Extended connection info with sequence tracking and metrics
 */
export interface WebSocketConnection {
  id: string;
  userId: string;
  userType: UserType;
  deviceId: string;
  platform: "ios" | "android" | "web";
  connectedAt: Date;
  lastHeartbeat: Date;
  lastMessageAt: Date;
  subscriptions: Set<string>;
  metadata: Record<string, unknown>;

  // Message ordering
  outboundSequence: number;
  inboundSequence: number;
  lastAckedSequence: number;

  // Connection quality
  latencyMs: number;
  missedHeartbeats: number;
  reconnectCount: number;

  // Auth
  tokenExpiresAt: Date;
  refreshToken?: string;
}

/**
 * All messages include sequence numbers for ordering guarantees
 */
export interface SequencedMessage {
  seq: number;
  ackSeq?: number; // Last received sequence from peer
  ts: number; // Timestamp for latency calculation
}

export type WebSocketMessage =
  | { type: "heartbeat"; seq: number; ts: number }
  | { type: "heartbeat_ack"; seq: number; ackSeq: number; ts: number }
  | { type: "ack"; seq: number; ackSeq: number; ts: number }
  | {
      type: "location_update";
      seq: number;
      ts: number;
      payload: LocationUpdate;
    }
  | {
      type: "ride_request";
      seq: number;
      ts: number;
      payload: RideRequestPayload;
    }
  | { type: "ride_status"; seq: number; ts: number; payload: RideStatusPayload }
  | {
      type: "driver_location";
      seq: number;
      ts: number;
      payload: DriverLocationPayload;
    }
  | { type: "eta_update"; seq: number; ts: number; payload: ETAUpdatePayload }
  | {
      type: "notification";
      seq: number;
      ts: number;
      payload: NotificationPayload;
    }
  | {
      type: "order_status";
      seq: number;
      ts: number;
      payload: OrderStatusPayload;
    }
  | {
      type: "dispatch_request";
      seq: number;
      ts: number;
      payload: DispatchRequestPayload;
    }
  | {
      type: "dispatch_response";
      seq: number;
      ts: number;
      payload: DispatchResponsePayload;
    }
  | {
      type: "token_refresh";
      seq: number;
      ts: number;
      payload: TokenRefreshPayload;
    }
  | {
      type: "token_refreshed";
      seq: number;
      ts: number;
      payload: TokenRefreshedPayload;
    }
  | { type: "error"; seq: number; ts: number; payload: ErrorPayload }
  | { type: "reconnect"; seq: number; ts: number; payload: ReconnectPayload };

export interface LocationUpdate {
  latitude: number;
  longitude: number;
  heading: number;
  speed: number;
  accuracy: number;
  timestamp: number;
  isAvailable?: boolean;
  vehicleType?: string;
}

export interface RideRequestPayload {
  requestId: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  vehicleType: string;
  fareEstimate: number;
  currency: string;
}

export interface RideStatusPayload {
  tripId: string;
  status: string;
  driverLocation?: {
    latitude: number;
    longitude: number;
    heading: number;
  };
  eta?: number;
  message?: string;
}

export interface DriverLocationPayload {
  tripId: string;
  latitude: number;
  longitude: number;
  heading: number;
  speed: number;
  eta?: number;
}

export interface ETAUpdatePayload {
  tripId: string;
  eta: number;
  distance: number;
  trafficLevel: "low" | "moderate" | "heavy";
  confidence?: {
    min: number;
    max: number;
  };
}

export interface NotificationPayload {
  id: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  priority: "high" | "normal" | "low";
  timestamp: number;
}

export interface OrderStatusPayload {
  orderId: string;
  status: string;
  restaurantId?: string;
  driverId?: string;
  estimatedTime?: number;
  message?: string;
}

export interface DispatchRequestPayload {
  dispatchId: string;
  requestId: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffAddress: string;
  fareEstimate: number;
  currency: string;
  expiresIn: number;
}

export interface DispatchResponsePayload {
  dispatchId: string;
  requestId: string;
  accepted: boolean;
  reason?: string;
}

export interface TokenRefreshPayload {
  refreshToken: string;
}

export interface TokenRefreshedPayload {
  accessToken: string;
  expiresIn: number;
}

export interface ErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
}

export interface ReconnectPayload {
  lastSeq: number;
  sessionId: string;
}

/**
 * Buffered message for offline/reconnecting clients
 */
export interface BufferedMessage {
  message: WebSocketMessage;
  createdAt: Date;
  expiresAt: Date;
  attempts: number;
  priority: "high" | "normal" | "low";
}

/**
 * Connection metrics for monitoring
 */
export interface ConnectionMetrics {
  connectionId: string;
  userId: string;
  userType: UserType;
  platform: string;
  connectedAt: Date;
  messagesReceived: number;
  messagesSent: number;
  bytesReceived: number;
  bytesSent: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
  reconnectCount: number;
  missedHeartbeats: number;
  bufferSize: number;
}

/**
 * Server-level metrics
 */
export interface ServerMetrics {
  serverId: string;
  totalConnections: number;
  activeConnections: number;
  uniqueUsers: number;
  connectionsByType: Record<UserType, number>;
  connectionsByPlatform: Record<string, number>;
  messagesPerSecond: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
  reconnectionRate: number;
  errorRate: number;
  bufferMemoryMB: number;
  uptime: number;
}

/**
 * Connection event for analytics
 */
export interface ConnectionEvent {
  type: "connect" | "disconnect" | "reconnect" | "error" | "token_refresh";
  connectionId: string;
  userId: string;
  userType: UserType;
  platform: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Message delivery tracking
 */
export interface DeliveryStatus {
  messageId: string;
  seq: number;
  userId: string;
  status: "pending" | "sent" | "delivered" | "failed" | "buffered";
  attempts: number;
  sentAt?: Date;
  deliveredAt?: Date;
  failedAt?: Date;
  error?: string;
}

/**
 * Redis channel patterns
 */
export const REDIS_CHANNELS = {
  userMessages: (userId: string) => `ws:user:${userId}:messages`,
  userBuffer: (userId: string) => `ws:user:${userId}:buffer`,
  userSession: (userId: string) => `ws:user:${userId}:session`,
  serverConnections: (serverId: string) => `ws:server:${serverId}:connections`,
  globalBroadcast: "ws:broadcast:global",
  typeBroadcast: (userType: UserType) => `ws:broadcast:type:${userType}`,
  metrics: "ws:metrics",
  events: "ws:events",
} as const;

/**
 * Configuration for WebSocket server
 */
export interface WebSocketConfig {
  // Heartbeat
  heartbeatIntervalMs: number; // 30000 (30s)
  heartbeatTimeoutMs: number; // 90000 (3 missed = disconnected)

  // Reconnection
  maxReconnectAttempts: number; // 10
  reconnectBackoffMs: number[]; // [1000, 2000, 4000, 8000, 16000, 30000]
  sessionTtlMs: number; // 300000 (5 min for reconnection window)

  // Message buffer
  maxBufferSize: number; // 100 messages per user
  bufferTtlMs: number; // 30000 (30s)

  // Performance
  maxConnectionsPerUser: number; // 5
  maxMessageSizeBytes: number; // 64KB
  rateLimitPerSecond: number; // 100 messages

  // Metrics
  metricsIntervalMs: number; // 10000 (10s)
  latencyWindowSize: number; // 100 samples
}

export const DEFAULT_CONFIG: WebSocketConfig = {
  heartbeatIntervalMs: 30000,
  heartbeatTimeoutMs: 90000,
  maxReconnectAttempts: 10,
  reconnectBackoffMs: [1000, 2000, 4000, 8000, 16000, 30000],
  sessionTtlMs: 300000,
  maxBufferSize: 100,
  bufferTtlMs: 30000,
  maxConnectionsPerUser: 5,
  maxMessageSizeBytes: 65536,
  rateLimitPerSecond: 100,
  metricsIntervalMs: 10000,
  latencyWindowSize: 100,
};
