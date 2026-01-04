/**
 * Real-Time Gateway Types
 */

export type UserType = 'rider' | 'driver' | 'restaurant' | 'delivery_partner';

export interface WebSocketConnection {
  id: string;
  userId: string;
  userType: UserType;
  deviceId: string;
  platform: 'ios' | 'android' | 'web';
  connectedAt: Date;
  lastHeartbeat: Date;
  subscriptions: Set<string>;
  metadata: Record<string, unknown>;
}

export type WebSocketMessage =
  | { type: 'heartbeat'; payload: { timestamp: number } }
  | { type: 'heartbeat_ack'; payload: { timestamp: number } }
  | { type: 'location_update'; payload: LocationUpdate }
  | { type: 'ride_request'; payload: RideRequestPayload }
  | { type: 'ride_status'; payload: RideStatusPayload }
  | { type: 'driver_location'; payload: DriverLocationPayload }
  | { type: 'eta_update'; payload: ETAUpdatePayload }
  | { type: 'notification'; payload: NotificationPayload }
  | { type: 'order_status'; payload: OrderStatusPayload }
  | { type: 'dispatch_request'; payload: DispatchRequestPayload }
  | { type: 'dispatch_response'; payload: DispatchResponsePayload }
  | { type: 'error'; payload: ErrorPayload };

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
  eta?: number; // seconds
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
  eta: number; // seconds
  distance: number; // meters
  trafficLevel: 'low' | 'moderate' | 'heavy';
}

export interface NotificationPayload {
  id: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  priority: 'high' | 'normal' | 'low';
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
  expiresIn: number; // seconds
}

export interface DispatchResponsePayload {
  dispatchId: string;
  requestId: string;
  accepted: boolean;
  reason?: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// Internal events
export interface ConnectionEvent {
  type: 'connect' | 'disconnect';
  connectionId: string;
  userId: string;
  userType: UserType;
  timestamp: Date;
}

export interface LocationEvent {
  driverId: string;
  latitude: number;
  longitude: number;
  heading: number;
  speed: number;
  accuracy: number;
  h3Index: string;
  timestamp: Date;
  isAvailable: boolean;
}

// Redis channel names
export const REDIS_CHANNELS = {
  userPrefix: (userId: string) => `user:${userId}`,
  driverLocation: (driverId: string) => `driver:${driverId}:location`,
  tripUpdates: (tripId: string) => `trip:${tripId}:updates`,
  orderUpdates: (orderId: string) => `order:${orderId}:updates`,
  zoneEvents: (h3Index: string) => `zone:${h3Index}:events`,
  globalEvents: 'events:global',
} as const;

// Kafka topics
export const KAFKA_TOPICS = {
  driverLocations: 'driver-locations',
  rideRequests: 'ride-requests',
  tripEvents: 'trip-events',
  orderEvents: 'order-events',
  notifications: 'notifications',
  connectionEvents: 'connection-events',
} as const;
