// k6 Utility Functions for UBI Load Testing
// Common helpers for all load test scenarios

import { check, sleep } from "k6";
import http from "k6/http";
import { Counter, Gauge, Rate, Trend } from "k6/metrics";

// Custom metrics
export const customMetrics = {
  // Booking metrics
  bookingCreated: new Counter("booking_created"),
  bookingCompleted: new Counter("booking_completed"),
  bookingCancelled: new Counter("booking_cancelled"),
  bookingDuration: new Trend("booking_duration"),
  driverMatchTime: new Trend("driver_match_time"),

  // API metrics
  authDuration: new Trend("auth_duration"),
  searchDuration: new Trend("search_duration"),
  paymentDuration: new Trend("payment_duration"),

  // WebSocket metrics
  wsConnectionTime: new Trend("ws_connection_time"),
  wsMessageLatency: new Trend("ws_message_latency"),
  wsReconnects: new Counter("ws_reconnects"),

  // Business metrics
  rideSuccessRate: new Rate("ride_success_rate"),
  foodOrderSuccessRate: new Rate("food_order_success_rate"),
  paymentSuccessRate: new Rate("payment_success_rate"),

  // System health
  activeConnections: new Gauge("active_connections"),
  errorRate: new Rate("error_rate"),
};

// Token storage for VU
export class TokenStore {
  constructor() {
    this.accessToken = null;
    this.refreshToken = null;
    this.userId = null;
  }

  setTokens(access, refresh) {
    this.accessToken = access;
    this.refreshToken = refresh;
  }

  getAuthHeader() {
    return this.accessToken
      ? { Authorization: `Bearer ${this.accessToken}` }
      : {};
  }

  clear() {
    this.accessToken = null;
    this.refreshToken = null;
    this.userId = null;
  }
}

// HTTP request wrapper with metrics
export function makeRequest(method, url, body, headers = {}, tags = {}) {
  const params = {
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    tags,
    timeout: "30s",
  };

  let response;
  const payload = body ? JSON.stringify(body) : null;

  switch (method.toUpperCase()) {
    case "GET":
      response = http.get(url, params);
      break;
    case "POST":
      response = http.post(url, payload, params);
      break;
    case "PUT":
      response = http.put(url, payload, params);
      break;
    case "PATCH":
      response = http.patch(url, payload, params);
      break;
    case "DELETE":
      response = http.del(url, payload, params);
      break;
    default:
      throw new Error(`Unsupported HTTP method: ${method}`);
  }

  return response;
}

// Check response and track metrics
export function checkResponse(
  response,
  expectedStatus = 200,
  checkName = "status check"
) {
  const success = check(response, {
    [checkName]: (r) => r.status === expectedStatus,
    "response time OK": (r) => r.timings.duration < 1000,
  });

  if (!success) {
    customMetrics.errorRate.add(1);
    console.error(`Request failed: ${response.status} - ${response.body}`);
  } else {
    customMetrics.errorRate.add(0);
  }

  return success;
}

// Parse JSON response safely
export function parseJSON(response) {
  try {
    return JSON.parse(response.body);
  } catch (e) {
    console.error(`Failed to parse JSON: ${e.message}`);
    return null;
  }
}

// Generate random data
export const randomData = {
  // Random phone number
  phone: () => {
    const prefix = "+25470";
    const number = Math.floor(Math.random() * 10000000)
      .toString()
      .padStart(7, "0");
    return prefix + number;
  },

  // Random coordinates in Nairobi
  coordinates: () => ({
    latitude: -1.35 + Math.random() * 0.15,
    longitude: 36.7 + Math.random() * 0.25,
  }),

  // Random address
  address: () => {
    const streets = [
      "Kenyatta Avenue",
      "Moi Avenue",
      "Uhuru Highway",
      "Ngong Road",
      "Thika Road",
    ];
    const areas = ["CBD", "Westlands", "Kilimani", "Karen", "Lavington"];
    return `${streets[Math.floor(Math.random() * streets.length)]}, ${areas[Math.floor(Math.random() * areas.length)]}`;
  },

  // Random ride type
  rideType: () => {
    const types = ["economy", "comfort", "premium", "xl"];
    return types[Math.floor(Math.random() * types.length)];
  },

  // Random payment method
  paymentMethod: () => {
    const methods = ["cash", "mpesa", "card"];
    return methods[Math.floor(Math.random() * methods.length)];
  },

  // Random tip amount
  tip: () => Math.floor(Math.random() * 10) * 10, // 0, 10, 20, ..., 90

  // Random rating
  rating: () => Math.floor(Math.random() * 3) + 3, // 3, 4, or 5 stars
};

// Sleep with jitter
export function sleepWithJitter(baseDuration, jitterPercent = 20) {
  const jitter = baseDuration * (jitterPercent / 100);
  const actual = baseDuration + (Math.random() * 2 - 1) * jitter;
  sleep(Math.max(0.1, actual));
}

// Retry logic for flaky requests
export function retryRequest(requestFn, maxRetries = 3, backoff = 1) {
  for (let i = 0; i < maxRetries; i++) {
    const response = requestFn();
    if (response.status >= 200 && response.status < 300) {
      return response;
    }
    if (i < maxRetries - 1) {
      sleep(backoff * Math.pow(2, i));
    }
  }
  return requestFn(); // Final attempt
}

// Batch request helper
export function batchRequests(requests) {
  return http.batch(requests);
}

// Format duration for logging
export function formatDuration(ms) {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// Log with timestamp
export function log(message, level = "INFO") {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);
}
