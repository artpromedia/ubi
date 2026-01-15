/**
 * API Test
 *
 * Tests individual API endpoints for performance baseline.
 * Useful for identifying slow endpoints and establishing SLOs.
 *
 * Target: Individual endpoint testing with varying loads
 * Purpose: Establish performance baselines per endpoint
 */

import { check, group, sleep } from "k6";
import http from "k6/http";
import { Rate, Trend } from "k6/metrics";
import { Options } from "k6/options";
import { generateLocation, generatePhoneNumber, getBaseUrl } from "../config";
import { authenticateUser, createHeaders } from "../helpers";

// Per-endpoint metrics
const authEndpoint = new Trend("endpoint_auth", true);
const userEndpoint = new Trend("endpoint_user", true);
const rideEstimateEndpoint = new Trend("endpoint_ride_estimate", true);
const rideRequestEndpoint = new Trend("endpoint_ride_request", true);
const restaurantsEndpoint = new Trend("endpoint_restaurants", true);
const menuEndpoint = new Trend("endpoint_menu", true);
const paymentMethodsEndpoint = new Trend("endpoint_payment_methods", true);
const walletEndpoint = new Trend("endpoint_wallet", true);
const healthEndpoint = new Trend("endpoint_health", true);

// Endpoint success rates
const authSuccess = new Rate("auth_success_rate");
const apiSuccess = new Rate("api_success_rate");

export const options: Options = {
  scenarios: {
    // Health check (always fast)
    health_check: {
      executor: "constant-arrival-rate",
      rate: 10,
      timeUnit: "1s",
      duration: "5m",
      preAllocatedVUs: 10,
      tags: { endpoint: "health" },
      exec: "testHealthEndpoint",
    },
    // Authentication endpoints
    auth_endpoints: {
      executor: "constant-vus",
      vus: 50,
      duration: "5m",
      tags: { endpoint: "auth" },
      exec: "testAuthEndpoints",
      startTime: "5m",
    },
    // Ride endpoints
    ride_endpoints: {
      executor: "constant-vus",
      vus: 100,
      duration: "5m",
      tags: { endpoint: "ride" },
      exec: "testRideEndpoints",
      startTime: "10m",
    },
    // Food endpoints
    food_endpoints: {
      executor: "constant-vus",
      vus: 100,
      duration: "5m",
      tags: { endpoint: "food" },
      exec: "testFoodEndpoints",
      startTime: "15m",
    },
    // Payment endpoints
    payment_endpoints: {
      executor: "constant-vus",
      vus: 50,
      duration: "5m",
      tags: { endpoint: "payment" },
      exec: "testPaymentEndpoints",
      startTime: "20m",
    },
  },
  thresholds: {
    // Health should be very fast
    endpoint_health: ["p(95)<50", "p(99)<100"],

    // Auth should be fast
    endpoint_auth: ["p(95)<500", "p(99)<1000"],

    // User endpoints
    endpoint_user: ["p(95)<500", "p(99)<1000"],

    // Ride endpoints (can be slower due to geo calculations)
    endpoint_ride_estimate: ["p(95)<1500", "p(99)<3000"],
    endpoint_ride_request: ["p(95)<2000", "p(99)<4000"],

    // Restaurant endpoints
    endpoint_restaurants: ["p(95)<1000", "p(99)<2000"],
    endpoint_menu: ["p(95)<500", "p(99)<1000"],

    // Payment endpoints (must be reliable)
    endpoint_payment_methods: ["p(95)<500", "p(99)<1000"],
    endpoint_wallet: ["p(95)<500", "p(99)<1000"],

    // Success rates
    auth_success_rate: ["rate>0.99"],
    api_success_rate: ["rate>0.99"],
  },
};

// Health endpoint test
export function testHealthEndpoint(): void {
  const baseUrl = getBaseUrl("apiGateway");

  const response = http.get(`${baseUrl}/health`);
  healthEndpoint.add(response.timings.duration);

  check(response, {
    "health - status is 200": (r) => r.status === 200,
  });

  sleep(0.1);
}

// Auth endpoints test
export function testAuthEndpoints(): void {
  const baseUrl = getBaseUrl("apiGateway");
  const phone = generatePhoneNumber("nigeria");

  group("Authentication Endpoints", () => {
    // OTP Request
    const otpStart = Date.now();
    const otpResponse = http.post(
      `${baseUrl}/api/v1/auth/otp/request`,
      JSON.stringify({ phoneNumber: phone }),
      { headers: createHeaders() },
    );
    authEndpoint.add(Date.now() - otpStart, { operation: "otp_request" });

    const otpSuccess = check(otpResponse, {
      "OTP request - status is 200": (r) => r.status === 200,
    });
    authSuccess.add(otpSuccess);

    sleep(0.5);

    // Login attempt (will fail but measures endpoint performance)
    const loginStart = Date.now();
    const loginResponse = http.post(
      `${baseUrl}/api/v1/auth/login`,
      JSON.stringify({ phoneNumber: phone, pin: "1234" }),
      { headers: createHeaders() },
    );
    authEndpoint.add(Date.now() - loginStart, { operation: "login" });
  });

  sleep(1);
}

// Ride endpoints test
export function testRideEndpoints(): void {
  const baseUrl = getBaseUrl("apiGateway");
  const vuId = __VU;

  // Authenticate first
  const authResult = authenticateUser(vuId);
  if (!authResult) {
    sleep(5);
    return;
  }

  const { tokens } = authResult;
  const headers = createHeaders(tokens.accessToken);

  const pickup = generateLocation("lagos");
  const dropoff = generateLocation("lagos");

  group("Ride Endpoints", () => {
    // Ride estimate
    const estimateStart = Date.now();
    const estimateResponse = http.post(
      `${baseUrl}/api/v1/rides/estimate`,
      JSON.stringify({
        pickup: { latitude: pickup.lat, longitude: pickup.lng },
        dropoff: { latitude: dropoff.lat, longitude: dropoff.lng },
      }),
      { headers },
    );
    rideEstimateEndpoint.add(Date.now() - estimateStart);

    const estimateSuccess = check(estimateResponse, {
      "ride estimate - status is 200": (r) => r.status === 200,
    });
    apiSuccess.add(estimateSuccess);

    sleep(0.5);

    // Ride request
    const requestStart = Date.now();
    const requestResponse = http.post(
      `${baseUrl}/api/v1/rides`,
      JSON.stringify({
        pickup: { latitude: pickup.lat, longitude: pickup.lng },
        dropoff: { latitude: dropoff.lat, longitude: dropoff.lng },
        rideType: "economy",
        paymentMethod: "wallet",
      }),
      { headers },
    );
    rideRequestEndpoint.add(Date.now() - requestStart);

    const requestSuccess = check(requestResponse, {
      "ride request - status is 201": (r) => r.status === 201,
    });
    apiSuccess.add(requestSuccess);

    // Cancel if ride was created
    if (requestResponse.status === 201) {
      try {
        const body = JSON.parse(requestResponse.body as string);
        if (body.data?.ride?.id) {
          http.post(
            `${baseUrl}/api/v1/rides/${body.data.ride.id}/cancel`,
            JSON.stringify({ reason: "load_test" }),
            { headers },
          );
        }
      } catch {
        // Ignore
      }
    }
  });

  sleep(1);
}

// Food endpoints test
export function testFoodEndpoints(): void {
  const baseUrl = getBaseUrl("apiGateway");
  const vuId = __VU;

  const authResult = authenticateUser(vuId);
  if (!authResult) {
    sleep(5);
    return;
  }

  const { tokens } = authResult;
  const headers = createHeaders(tokens.accessToken);

  const location = generateLocation("lagos");

  group("Food Endpoints", () => {
    // Nearby restaurants
    const nearbyStart = Date.now();
    const nearbyResponse = http.get(
      `${baseUrl}/api/v1/restaurants/nearby?lat=${location.lat}&lng=${location.lng}`,
      { headers },
    );
    restaurantsEndpoint.add(Date.now() - nearbyStart);

    const nearbySuccess = check(nearbyResponse, {
      "nearby restaurants - status is 200": (r) => r.status === 200,
    });
    apiSuccess.add(nearbySuccess);

    sleep(0.3);

    // Get menu (using first restaurant if available)
    let restaurantId = "test_restaurant";
    try {
      const body = JSON.parse(nearbyResponse.body as string);
      if (body.data?.restaurants?.[0]?.id) {
        restaurantId = body.data.restaurants[0].id;
      }
    } catch {
      // Use default
    }

    const menuStart = Date.now();
    const menuResponse = http.get(
      `${baseUrl}/api/v1/restaurants/${restaurantId}/menu`,
      { headers },
    );
    menuEndpoint.add(Date.now() - menuStart);

    const menuSuccess = check(menuResponse, {
      "menu - status is 200 or 404": (r) =>
        r.status === 200 || r.status === 404,
    });
    apiSuccess.add(menuSuccess);
  });

  sleep(1);
}

// Payment endpoints test
export function testPaymentEndpoints(): void {
  const baseUrl = getBaseUrl("apiGateway");
  const vuId = __VU;

  const authResult = authenticateUser(vuId);
  if (!authResult) {
    sleep(5);
    return;
  }

  const { tokens, user } = authResult;
  const headers = createHeaders(tokens.accessToken);

  group("Payment Endpoints", () => {
    // Get payment methods
    const pmStart = Date.now();
    const pmResponse = http.get(`${baseUrl}/api/v1/users/me/payment-methods`, {
      headers,
    });
    paymentMethodsEndpoint.add(Date.now() - pmStart);

    const pmSuccess = check(pmResponse, {
      "payment methods - status is 200": (r) => r.status === 200,
    });
    apiSuccess.add(pmSuccess);

    sleep(0.3);

    // Get wallet balance
    const walletStart = Date.now();
    const walletResponse = http.get(`${baseUrl}/api/v1/wallets/me`, {
      headers,
    });
    walletEndpoint.add(Date.now() - walletStart);

    const walletSuccess = check(walletResponse, {
      "wallet - status is 200": (r) => r.status === 200,
    });
    apiSuccess.add(walletSuccess);

    sleep(0.3);

    // Get user profile
    const userStart = Date.now();
    const userResponse = http.get(`${baseUrl}/api/v1/users/me`, { headers });
    userEndpoint.add(Date.now() - userStart);

    const userSuccess = check(userResponse, {
      "user profile - status is 200": (r) => r.status === 200,
    });
    apiSuccess.add(userSuccess);
  });

  sleep(1);
}

export function handleSummary(
  data: Record<string, unknown>,
): Record<string, string> {
  console.log("\n=== API Performance Baselines ===\n");

  const metrics = [
    { name: "Health", metric: "endpoint_health" },
    { name: "Auth", metric: "endpoint_auth" },
    { name: "User", metric: "endpoint_user" },
    { name: "Ride Estimate", metric: "endpoint_ride_estimate" },
    { name: "Ride Request", metric: "endpoint_ride_request" },
    { name: "Restaurants", metric: "endpoint_restaurants" },
    { name: "Menu", metric: "endpoint_menu" },
    { name: "Payment Methods", metric: "endpoint_payment_methods" },
    { name: "Wallet", metric: "endpoint_wallet" },
  ];

  for (const { name, metric } of metrics) {
    const m = (
      data.metrics as Record<
        string,
        { values?: { "p(95)"?: number; avg?: number } }
      >
    )?.[metric];
    if (m?.values) {
      console.log(
        `${name}: p95=${m.values["p(95)"]?.toFixed(0)}ms, avg=${m.values.avg?.toFixed(0)}ms`,
      );
    }
  }

  return {
    "api-test-results.json": JSON.stringify(data, null, 2),
  };
}
