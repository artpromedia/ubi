/**
 * Shared type definitions for testing
 */

// =============================================================================
// User Types
// =============================================================================

export interface TestUser {
  id: string;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  role: "rider" | "driver" | "admin" | "restaurant" | "merchant";
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TestDriver extends TestUser {
  role: "driver";
  vehicleId: string;
  licenseNumber: string;
  rating: number;
  totalTrips: number;
  isOnline: boolean;
  currentLocation?: TestLocation;
}

export interface TestRider extends TestUser {
  role: "rider";
  walletBalance: number;
  savedLocations: TestSavedLocation[];
}

// =============================================================================
// Location Types
// =============================================================================

export interface TestLocation {
  latitude: number;
  longitude: number;
  address?: string;
  city?: string;
  country?: string;
}

export interface TestSavedLocation extends TestLocation {
  id: string;
  name: string;
  type: "home" | "work" | "other";
}

// =============================================================================
// Ride Types
// =============================================================================

export interface TestRide {
  id: string;
  riderId: string;
  driverId?: string;
  pickup: TestLocation;
  destination: TestLocation;
  vehicleType: "economy" | "comfort" | "premium" | "xl";
  status: TestRideStatus;
  fareEstimate: number;
  finalFare?: number;
  distance: number;
  duration: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export type TestRideStatus =
  | "pending"
  | "matching"
  | "driver_assigned"
  | "driver_arriving"
  | "in_progress"
  | "completed"
  | "cancelled";

// =============================================================================
// Food Order Types
// =============================================================================

export interface TestRestaurant {
  id: string;
  name: string;
  description: string;
  location: TestLocation;
  rating: number;
  deliveryTime: number;
  deliveryFee: number;
  isOpen: boolean;
  cuisineTypes: string[];
}

export interface TestMenuItem {
  id: string;
  restaurantId: string;
  name: string;
  description: string;
  price: number;
  category: string;
  isAvailable: boolean;
  imageUrl?: string;
}

export interface TestFoodOrder {
  id: string;
  riderId: string;
  restaurantId: string;
  driverId?: string;
  items: TestOrderItem[];
  status: TestOrderStatus;
  subtotal: number;
  deliveryFee: number;
  total: number;
  deliveryLocation: TestLocation;
  createdAt: Date;
  estimatedDelivery?: Date;
}

export interface TestOrderItem {
  menuItemId: string;
  name: string;
  quantity: number;
  price: number;
  specialInstructions?: string;
}

export type TestOrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready_for_pickup"
  | "picked_up"
  | "delivering"
  | "delivered"
  | "cancelled";

// =============================================================================
// Payment Types
// =============================================================================

export interface TestPaymentMethod {
  id: string;
  userId: string;
  type: "card" | "mpesa" | "mtn_momo" | "airtel_money" | "wallet";
  isDefault: boolean;
  lastFour?: string;
  provider?: string;
  phoneNumber?: string;
}

export interface TestTransaction {
  id: string;
  userId: string;
  type: "payment" | "refund" | "top_up" | "withdrawal";
  amount: number;
  currency: string;
  status: "pending" | "completed" | "failed" | "cancelled";
  paymentMethodId: string;
  referenceId?: string;
  createdAt: Date;
}

// =============================================================================
// API Response Types
// =============================================================================

export interface TestApiResponse<T> {
  success: boolean;
  data?: T;
  error?: TestApiError;
  meta?: TestApiMeta;
}

export interface TestApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface TestApiMeta {
  page?: number;
  limit?: number;
  total?: number;
  hasMore?: boolean;
}

// =============================================================================
// Test Configuration Types
// =============================================================================

export interface TestConfig {
  /** API base URL for integration tests */
  apiBaseUrl: string;
  /** Whether to use real external services */
  useRealServices: boolean;
  /** Default timeout for async operations */
  timeout: number;
  /** Test database connection string */
  databaseUrl?: string;
  /** Redis connection string for tests */
  redisUrl?: string;
}

export interface NetworkProfile {
  name: string;
  downloadThroughput: number;
  uploadThroughput: number;
  latency: number;
  packetLoss?: number;
}
