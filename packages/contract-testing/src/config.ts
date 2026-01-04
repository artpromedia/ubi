/**
 * Pact Configuration
 *
 * Centralized configuration for contract testing.
 */

import path from "path";

// Pact broker configuration
export const PACT_BROKER_CONFIG = {
  url: process.env.PACT_BROKER_URL || "http://localhost:9292",
  token: process.env.PACT_BROKER_TOKEN || "",
  username: process.env.PACT_BROKER_USERNAME || "",
  password: process.env.PACT_BROKER_PASSWORD || "",
};

// Pact file output directory
export const PACTS_DIR = path.resolve(__dirname, "../pacts");

// Consumer names
export const CONSUMERS = {
  WEB_APP: "ubi-web-app",
  MOBILE_APP: "ubi-mobile-app",
  ADMIN_DASHBOARD: "ubi-admin-dashboard",
  RESTAURANT_PORTAL: "ubi-restaurant-portal",
  FLEET_PORTAL: "ubi-fleet-portal",
} as const;

// Provider names
export const PROVIDERS = {
  API_GATEWAY: "ubi-api-gateway",
  USER_SERVICE: "ubi-user-service",
  RIDE_SERVICE: "ubi-ride-service",
  FOOD_SERVICE: "ubi-food-service",
  PAYMENT_SERVICE: "ubi-payment-service",
  NOTIFICATION_SERVICE: "ubi-notification-service",
} as const;

// Provider states
export const PROVIDER_STATES = {
  // User states
  USER_EXISTS: "a user exists with ID %s",
  USER_NOT_EXISTS: "no user exists with ID %s",
  USER_AUTHENTICATED: "user %s is authenticated",

  // Ride states
  RIDE_EXISTS: "a ride exists with ID %s",
  RIDE_SEARCHING: "a ride with ID %s is searching for driver",
  RIDE_IN_PROGRESS: "a ride with ID %s is in progress",
  RIDE_COMPLETED: "a ride with ID %s is completed",
  DRIVERS_AVAILABLE: "drivers are available in %s",
  NO_DRIVERS_AVAILABLE: "no drivers are available in %s",

  // Food states
  RESTAURANT_EXISTS: "a restaurant exists with ID %s",
  RESTAURANT_OPEN: "restaurant %s is open",
  RESTAURANT_CLOSED: "restaurant %s is closed",
  MENU_ITEMS_AVAILABLE: "menu items are available for restaurant %s",
  FOOD_ORDER_EXISTS: "a food order exists with ID %s",

  // Payment states
  WALLET_EXISTS: "a wallet exists for user %s",
  WALLET_HAS_BALANCE: "wallet for user %s has balance of %s %s",
  PAYMENT_METHOD_EXISTS: "payment method %s exists for user %s",
  TRANSACTION_EXISTS: "transaction %s exists",
} as const;

// API versions
export const API_VERSIONS = {
  V1: "v1",
  V2: "v2",
} as const;

// Standard response matchers for Pact
export const RESPONSE_MATCHERS = {
  id: {
    type: "string",
    example: "user_123abc",
    pattern: "^[a-z]+_[a-zA-Z0-9]+$",
  },
  uuid: {
    type: "string",
    example: "550e8400-e29b-41d4-a716-446655440000",
    pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
  },
  timestamp: {
    type: "string",
    example: "2024-01-15T10:30:00.000Z",
    pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}",
  },
  phoneNumber: {
    type: "string",
    example: "+2348012345678",
    pattern: "^\\+[0-9]{10,15}$",
  },
  email: {
    type: "string",
    example: "user@example.com",
    pattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
  },
  currency: {
    type: "string",
    example: "NGN",
    pattern: "^[A-Z]{3}$",
  },
  coordinates: {
    latitude: {
      type: "number",
      example: 6.5244,
      min: -90,
      max: 90,
    },
    longitude: {
      type: "number",
      example: 3.3792,
      min: -180,
      max: 180,
    },
  },
};

// Common error responses
export const ERROR_RESPONSES = {
  unauthorized: {
    status: 401,
    body: {
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or expired authentication token",
      },
    },
  },
  notFound: {
    status: 404,
    body: {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Resource not found",
      },
    },
  },
  badRequest: {
    status: 400,
    body: {
      success: false,
      error: {
        code: "BAD_REQUEST",
        message: "Invalid request parameters",
      },
    },
  },
  serverError: {
    status: 500,
    body: {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    },
  },
};
