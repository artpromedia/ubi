// k6 Load Test - API Endpoints
// Tests individual API endpoints for performance benchmarks

import { check, group } from "k6";
import http from "k6/http";
import { getEnvConfig } from "./config.js";
import {
  TokenStore,
  customMetrics,
  makeRequest,
  parseJSON,
  randomData,
  sleepWithJitter,
} from "./utils.js";

const env = getEnvConfig(__ENV.TEST_ENV || "staging");

export const options = {
  scenarios: {
    // Authentication endpoints
    auth_load: {
      executor: "constant-arrival-rate",
      rate: 1000, // 1000 requests per second
      timeUnit: "1s",
      duration: "5m",
      preAllocatedVUs: 200,
      maxVUs: 500,
      exec: "authScenario",
      tags: { scenario: "auth" },
    },

    // Search endpoints (heavily used)
    search_load: {
      executor: "constant-arrival-rate",
      rate: 2000, // 2000 requests per second
      timeUnit: "1s",
      duration: "5m",
      preAllocatedVUs: 400,
      maxVUs: 1000,
      exec: "searchScenario",
      startTime: "1m",
      tags: { scenario: "search" },
    },

    // Ride pricing (compute intensive)
    pricing_load: {
      executor: "constant-arrival-rate",
      rate: 500, // 500 requests per second
      timeUnit: "1s",
      duration: "5m",
      preAllocatedVUs: 100,
      maxVUs: 300,
      exec: "pricingScenario",
      startTime: "1m",
      tags: { scenario: "pricing" },
    },

    // User profile operations
    profile_load: {
      executor: "ramping-arrival-rate",
      startRate: 100,
      timeUnit: "1s",
      stages: [
        { duration: "1m", target: 500 },
        { duration: "3m", target: 500 },
        { duration: "1m", target: 100 },
      ],
      preAllocatedVUs: 100,
      maxVUs: 300,
      exec: "profileScenario",
      startTime: "2m",
      tags: { scenario: "profile" },
    },
  },

  thresholds: {
    // Global thresholds
    http_req_duration: ["p(95)<300", "p(99)<500"],
    http_req_failed: ["rate<0.01"],

    // Per-scenario thresholds
    "http_req_duration{scenario:auth}": ["p(95)<200"],
    "http_req_duration{scenario:search}": ["p(95)<150"],
    "http_req_duration{scenario:pricing}": ["p(95)<400"],
    "http_req_duration{scenario:profile}": ["p(95)<250"],

    // Custom metrics
    auth_duration: ["p(95)<300"],
    search_duration: ["p(95)<200"],
  },
};

// Shared token store for authenticated scenarios
const tokenStore = new TokenStore();

export function setup() {
  // Authenticate once for profile scenario
  const phone = "+254700000001";

  const otpResponse = http.post(
    `${env.baseUrl}/api/v1/auth/otp/request`,
    JSON.stringify({ phone }),
    { headers: { "Content-Type": "application/json" } },
  );

  if (otpResponse.status === 200) {
    const verifyResponse = http.post(
      `${env.baseUrl}/api/v1/auth/otp/verify`,
      JSON.stringify({ phone, code: "123456" }),
      { headers: { "Content-Type": "application/json" } },
    );

    if (verifyResponse.status === 200) {
      const data = JSON.parse(verifyResponse.body);
      return {
        accessToken: data.accessToken,
        userId: data.user?.id,
      };
    }
  }

  return { accessToken: null };
}

// Authentication scenario
export function authScenario() {
  const startTime = Date.now();
  const phone = randomData.phone();

  group("Auth - OTP Request", () => {
    const response = makeRequest(
      "POST",
      `${env.baseUrl}/api/v1/auth/otp/request`,
      { phone },
      {},
      { name: "otp_request" },
    );

    check(response, {
      "OTP request status 200": (r) => r.status === 200,
      "OTP request < 200ms": (r) => r.timings.duration < 200,
    });
  });

  customMetrics.authDuration.add(Date.now() - startTime);
}

// Search scenario
export function searchScenario() {
  const startTime = Date.now();
  const coords = randomData.coordinates();

  const queries = [
    "Nairobi CBD",
    "Westlands Mall",
    "JKIA Airport",
    "Karen",
    "Kilimani",
    "Lavington",
    "Ngong Road",
  ];

  const query = queries[Math.floor(Math.random() * queries.length)];

  group("Search - Location", () => {
    const response = makeRequest(
      "GET",
      `${env.baseUrl}/api/v1/locations/search?q=${encodeURIComponent(query)}&lat=${coords.latitude}&lng=${coords.longitude}&limit=5`,
      null,
      {},
      { name: "location_search" },
    );

    check(response, {
      "Search status 200": (r) => r.status === 200,
      "Search < 150ms": (r) => r.timings.duration < 150,
      "Has results": (r) => {
        const data = parseJSON(r);
        return data && data.results && data.results.length > 0;
      },
    });
  });

  customMetrics.searchDuration.add(Date.now() - startTime);
}

// Pricing scenario
export function pricingScenario() {
  const pickup = randomData.coordinates();
  const dropoff = randomData.coordinates();

  group("Pricing - Ride Options", () => {
    const response = makeRequest(
      "POST",
      `${env.baseUrl}/api/v1/rides/options`,
      {
        pickup: { ...pickup, address: "Test Pickup" },
        dropoff: { ...dropoff, address: "Test Dropoff" },
      },
      {},
      { name: "ride_options" },
    );

    check(response, {
      "Pricing status 200": (r) => r.status === 200,
      "Pricing < 400ms": (r) => r.timings.duration < 400,
      "Has options": (r) => {
        const data = parseJSON(r);
        return data && data.options && data.options.length > 0;
      },
      "Has ETA": (r) => {
        const data = parseJSON(r);
        return data && data.eta !== undefined;
      },
    });
  });
}

// Profile scenario
export function profileScenario(data) {
  if (!data.accessToken) {
    return;
  }

  const headers = { Authorization: `Bearer ${data.accessToken}` };

  group("Profile - Get User", () => {
    const response = makeRequest(
      "GET",
      `${env.baseUrl}/api/v1/users/me`,
      null,
      headers,
      { name: "get_profile" },
    );

    check(response, {
      "Profile status 200": (r) => r.status === 200 || r.status === 401,
      "Profile < 250ms": (r) => r.timings.duration < 250,
    });
  });

  sleepWithJitter(0.5);

  group("Profile - Get Rides History", () => {
    const response = makeRequest(
      "GET",
      `${env.baseUrl}/api/v1/users/me/rides?limit=10&offset=0`,
      null,
      headers,
      { name: "get_rides_history" },
    );

    check(response, {
      "History status 200": (r) => r.status === 200 || r.status === 401,
      "History < 300ms": (r) => r.timings.duration < 300,
    });
  });

  sleepWithJitter(0.5);

  group("Profile - Get Payment Methods", () => {
    const response = makeRequest(
      "GET",
      `${env.baseUrl}/api/v1/users/me/payment-methods`,
      null,
      headers,
      { name: "get_payment_methods" },
    );

    check(response, {
      "Payment methods status 200": (r) => r.status === 200 || r.status === 401,
      "Payment methods < 200ms": (r) => r.timings.duration < 200,
    });
  });
}

export function teardown(data) {
  console.log("API endpoint load test completed");
}
