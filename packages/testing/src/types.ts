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
  role?: "rider" | "driver" | "admin" | "restaurant" | "merchant";
  isVerified: boolean;
  profilePicture?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TestVehicle {
  type: "car" | "motorcycle" | "bicycle" | "tuktuk";
  make: string;
  model: string;
  color: string;
  plateNumber: string;
  year: number;
}

export interface TestDriverDocuments {
  driversLicense: string;
  vehicleRegistration: string;
  insurance: string;
}

export interface TestDriver extends Omit<TestUser, "role"> {
  role: "driver";
  vehicleId?: string;
  licenseNumber?: string;
  rating: number;
  totalTrips: number;
  totalRides?: number;
  isOnline: boolean;
  currentLocation?: TestLocation;
  vehicle?: TestVehicle;
  location?: TestLocation;
  documents?: TestDriverDocuments;
}

export interface TestSavedPaymentMethod {
  id: string;
  type: string;
  isDefault: boolean;
  last4?: string;
  brand?: string;
  expiryMonth?: number;
  expiryYear?: number;
  provider?: string;
  phoneNumber?: string;
  card?: TestCardDetails;
  mobileMoney?: TestMobileMoneyDetails;
}

export interface TestRider extends Omit<TestUser, "role"> {
  role: "rider";
  walletBalance?: number;
  savedLocations?: TestSavedLocation[];
  preferredPaymentMethod?: string;
  savedPaymentMethods?: TestSavedPaymentMethod[];
  homeAddress?: TestLocation;
  workAddress?: TestLocation;
  totalRides?: number;
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
  isFavorite?: boolean;
  createdAt?: Date;
}

// =============================================================================
// Ride Types
// =============================================================================

export interface TestRidePricing {
  currency: string;
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  surge: number;
  total: number;
  paymentMethod?: string;
}

export interface TestRideRating {
  riderRating?: number;
  driverRating?: number;
  riderComment?: string;
  driverComment?: string;
}

export interface TestRide {
  id: string;
  riderId: string;
  driverId?: string;
  pickup: TestLocation;
  destination?: TestLocation;
  dropoff?: TestLocation;
  vehicleType?: "economy" | "comfort" | "premium" | "xl";
  rideType?: "economy" | "comfort" | "premium" | "motorcycle" | "tuktuk";
  status: TestRideStatus;
  fareEstimate?: number;
  finalFare?: number;
  distance: number;
  duration?: number;
  estimatedDuration?: number;
  actualDuration?: number;
  pricing?: TestRidePricing;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  searchStartedAt?: Date;
  driverAssignedAt?: Date;
  driverArrivedAt?: Date;
  rideStartedAt?: Date;
  rideCompletedAt?: Date;
  scheduledAt?: Date;
  cancelledAt?: Date;
  cancelledBy?: "rider" | "driver" | "system";
  cancellationReason?: string;
  driverLocation?: TestLocation;
  estimatedArrival?: Date;
  rating?: number | TestRideRating;
}

export type TestRideStatus =
  | "pending"
  | "matching"
  | "searching"
  | "driver_assigned"
  | "driver_arriving"
  | "driver_arrived"
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
  cuisineTypes?: string[];
  cuisine?: string | string[];
  images?: string[];
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
  image?: string;
  currency?: string;
}

export interface TestFoodOrderRating {
  foodRating?: number;
  deliveryRating?: number;
  comment?: string;
}

export interface TestFoodOrder {
  id: string;
  riderId?: string;
  userId?: string;
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
  orderNumber?: string;
  confirmedAt?: Date;
  preparingAt?: Date;
  readyAt?: Date;
  pickedUpAt?: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  driverLocation?: TestLocation;
  rating?: number | TestFoodOrderRating;
}

export interface TestOrderItemOption {
  name: string;
  price: number;
}

export interface TestOrderItem {
  id?: string;
  menuItemId: string;
  name: string;
  quantity: number;
  price: number;
  subtotal?: number;
  specialInstructions?: string;
  options?: TestOrderItemOption[];
}

export type TestOrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready_for_pickup"
  | "picked_up"
  | "out_for_delivery"
  | "delivering"
  | "delivered"
  | "cancelled";

// =============================================================================
// Payment Types
// =============================================================================

export interface TestCardDetails {
  last4: string;
  brand: string;
  expiryMonth: number;
  expiryYear: number;
  cardholderName?: string;
}

export interface TestMobileMoneyDetails {
  provider: string;
  phoneNumber: string;
  providerName?: string;
}

export interface TestBankAccountDetails {
  bankName: string;
  accountNumber: string;
  accountName?: string;
}

export interface TestWalletDetails {
  balance: number;
  currency?: string;
}

export interface TestPaymentMethod {
  id: string;
  userId: string;
  type: "card" | "mpesa" | "mtn_momo" | "airtel_money" | "wallet" | "mobile_money" | "bank_account";
  isDefault: boolean;
  lastFour?: string;
  provider?: string;
  phoneNumber?: string;
  createdAt?: Date;
  card?: TestCardDetails;
  mobileMoney?: TestMobileMoneyDetails;
  bankAccount?: TestBankAccountDetails;
  wallet?: TestWalletDetails;
}

export interface TestTransaction {
  id: string;
  userId: string;
  type: "payment" | "refund" | "top_up" | "withdrawal" | "ride_payment" | "food_payment" | "delivery_payment" | "wallet_topup" | "wallet_withdrawal" | "driver_payout" | "restaurant_payout";
  amount: number;
  currency: string;
  currencySymbol?: string;
  status: "pending" | "completed" | "failed" | "cancelled" | "refunded";
  paymentMethodId?: string;
  paymentMethod?: TestPaymentMethod;
  referenceId?: string;
  reference?: string;
  createdAt: Date;
  orderId?: string;
  originalTransactionId?: string;
  reason?: string;
  recipientId?: string;
  completedAt?: Date;
  failedAt?: Date;
  failureReason?: string;
  gatewayReference?: string;
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
  status?: number;
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
