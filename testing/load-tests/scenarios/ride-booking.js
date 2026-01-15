// k6 Load Test - Ride Booking Flow
// Simulates complete ride booking journey from search to completion

import { group, sleep } from "k6";
import { generateRandomCoordinate, getEnvConfig } from "./config.js";
import {
  TokenStore,
  checkResponse,
  customMetrics,
  log,
  makeRequest,
  parseJSON,
  randomData,
  sleepWithJitter,
} from "./utils.js";

const env = getEnvConfig(__ENV.TEST_ENV || "staging");
const tokenStore = new TokenStore();

export const options = {
  scenarios: {
    ride_booking: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 1000 }, // Ramp up to 1000 users
        { duration: "5m", target: 5000 }, // Ramp up to 5000 users
        { duration: "10m", target: 10000 }, // Peak load: 10K concurrent rides
        { duration: "5m", target: 10000 }, // Sustain peak
        { duration: "3m", target: 0 }, // Ramp down
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    http_req_failed: ["rate<0.01"],
    booking_duration: ["p(95)<30000"],
    driver_match_time: ["p(95)<60000"],
    ride_success_rate: ["rate>0.95"],
  },
};

export function setup() {
  log("Setting up ride booking load test");
  return {
    startTime: Date.now(),
  };
}

export default function (data) {
  const vuId = __VU;
  const iteration = __ITER;

  group("Authentication", () => {
    authenticateRider(vuId);
  });

  if (!tokenStore.accessToken) {
    log(`VU ${vuId}: Failed to authenticate, skipping iteration`, "WARN");
    return;
  }

  group("Ride Booking Flow", () => {
    // Step 1: Search for pickup location
    const pickup = searchLocation("pickup");
    sleepWithJitter(1);

    // Step 2: Search for dropoff location
    const dropoff = searchLocation("dropoff");
    sleepWithJitter(1);

    // Step 3: Get ride options and pricing
    const rideOptions = getRideOptions(pickup, dropoff);
    sleepWithJitter(2);

    // Step 4: Create booking
    if (rideOptions) {
      const bookingId = createBooking(pickup, dropoff, rideOptions);
      sleepWithJitter(1);

      // Step 5: Wait for driver match
      if (bookingId) {
        const driverId = waitForDriverMatch(bookingId);

        // Step 6: Simulate ride progress
        if (driverId) {
          simulateRideProgress(bookingId);

          // Step 7: Complete ride and rate
          completeRideAndRate(bookingId);
        }
      }
    }
  });

  // Think time between iterations
  sleepWithJitter(5);
}

function authenticateRider(vuId) {
  const startTime = Date.now();
  const phone = `+25470${String(vuId % 100000).padStart(7, "0")}`;

  // Request OTP
  const otpResponse = makeRequest(
    "POST",
    `${env.baseUrl}/api/v1/auth/otp/request`,
    { phone },
    {},
    { name: "auth_request_otp" },
  );

  if (!checkResponse(otpResponse, 200, "OTP requested")) {
    return;
  }

  sleepWithJitter(0.5);

  // Verify OTP (test environment auto-approves 123456)
  const verifyResponse = makeRequest(
    "POST",
    `${env.baseUrl}/api/v1/auth/otp/verify`,
    { phone, code: "123456" },
    {},
    { name: "auth_verify_otp" },
  );

  if (checkResponse(verifyResponse, 200, "OTP verified")) {
    const data = parseJSON(verifyResponse);
    if (data && data.accessToken) {
      tokenStore.setTokens(data.accessToken, data.refreshToken);
      tokenStore.userId = data.user?.id;
    }
  }

  customMetrics.authDuration.add(Date.now() - startTime);
}

function searchLocation(type) {
  const startTime = Date.now();
  const query = type === "pickup" ? "Nairobi CBD" : "Westlands";
  const coords = generateRandomCoordinate();

  const response = makeRequest(
    "GET",
    `${env.baseUrl}/api/v1/locations/search?q=${encodeURIComponent(query)}&lat=${coords.lat}&lng=${coords.lng}`,
    null,
    tokenStore.getAuthHeader(),
    { name: `search_${type}_location` },
  );

  customMetrics.searchDuration.add(Date.now() - startTime);

  if (checkResponse(response, 200, `${type} search successful`)) {
    const data = parseJSON(response);
    if (data && data.results && data.results.length > 0) {
      const location = data.results[0];
      return {
        placeId: location.placeId,
        address: location.address,
        latitude: location.latitude,
        longitude: location.longitude,
      };
    }
  }

  // Fallback to random coordinates
  return {
    placeId: `test_place_${Date.now()}`,
    address: randomData.address(),
    ...coords,
  };
}

function getRideOptions(pickup, dropoff) {
  const response = makeRequest(
    "POST",
    `${env.baseUrl}/api/v1/rides/options`,
    {
      pickup: {
        latitude: pickup.latitude || pickup.lat,
        longitude: pickup.longitude || pickup.lng,
        address: pickup.address,
      },
      dropoff: {
        latitude: dropoff.latitude || dropoff.lat,
        longitude: dropoff.longitude || dropoff.lng,
        address: dropoff.address,
      },
    },
    tokenStore.getAuthHeader(),
    { name: "get_ride_options" },
  );

  if (checkResponse(response, 200, "ride options retrieved")) {
    const data = parseJSON(response);
    if (data && data.options) {
      // Select economy option by default
      return data.options.find((o) => o.type === "economy") || data.options[0];
    }
  }

  return null;
}

function createBooking(pickup, dropoff, rideOption) {
  const startTime = Date.now();

  const response = makeRequest(
    "POST",
    `${env.baseUrl}/api/v1/rides/book`,
    {
      pickup: {
        latitude: pickup.latitude || pickup.lat,
        longitude: pickup.longitude || pickup.lng,
        address: pickup.address,
        placeId: pickup.placeId,
      },
      dropoff: {
        latitude: dropoff.latitude || dropoff.lat,
        longitude: dropoff.longitude || dropoff.lng,
        address: dropoff.address,
        placeId: dropoff.placeId,
      },
      rideType: rideOption.type,
      paymentMethod: randomData.paymentMethod(),
      estimatedFare: rideOption.fare,
    },
    tokenStore.getAuthHeader(),
    { name: "create_booking" },
  );

  customMetrics.bookingDuration.add(Date.now() - startTime);

  if (checkResponse(response, 201, "booking created")) {
    const data = parseJSON(response);
    if (data && data.bookingId) {
      customMetrics.bookingCreated.add(1);
      return data.bookingId;
    }
  }

  return null;
}

function waitForDriverMatch(bookingId) {
  const startTime = Date.now();
  const maxWaitTime = 60000; // 60 seconds
  const pollInterval = 2000; // 2 seconds

  while (Date.now() - startTime < maxWaitTime) {
    const response = makeRequest(
      "GET",
      `${env.baseUrl}/api/v1/rides/${bookingId}/status`,
      null,
      tokenStore.getAuthHeader(),
      { name: "check_driver_match" },
    );

    if (response.status === 200) {
      const data = parseJSON(response);
      if (data && data.status === "driver_assigned" && data.driver) {
        customMetrics.driverMatchTime.add(Date.now() - startTime);
        return data.driver.id;
      }
      if (data && data.status === "no_drivers") {
        log(`Booking ${bookingId}: No drivers available`, "WARN");
        return null;
      }
      if (data && data.status === "cancelled") {
        return null;
      }
    }

    sleep(pollInterval / 1000);
  }

  log(`Booking ${bookingId}: Driver match timeout`, "WARN");
  return null;
}

function simulateRideProgress(bookingId) {
  // Poll for ride status updates
  const statuses = ["driver_arrived", "ride_started"];

  for (const expectedStatus of statuses) {
    const maxWait = 30000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const response = makeRequest(
        "GET",
        `${env.baseUrl}/api/v1/rides/${bookingId}/status`,
        null,
        tokenStore.getAuthHeader(),
        { name: "check_ride_status" },
      );

      if (response.status === 200) {
        const data = parseJSON(response);
        if (data && data.status === expectedStatus) {
          break;
        }
        if (data && data.status === "completed") {
          return;
        }
        if (data && data.status === "cancelled") {
          customMetrics.bookingCancelled.add(1);
          return;
        }
      }

      sleep(3);
    }

    sleepWithJitter(2);
  }
}

function completeRideAndRate(bookingId) {
  // Wait for ride completion
  const maxWait = 60000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    const response = makeRequest(
      "GET",
      `${env.baseUrl}/api/v1/rides/${bookingId}/status`,
      null,
      tokenStore.getAuthHeader(),
      { name: "check_ride_completion" },
    );

    if (response.status === 200) {
      const data = parseJSON(response);
      if (data && data.status === "completed") {
        customMetrics.bookingCompleted.add(1);
        customMetrics.rideSuccessRate.add(1);

        // Rate the ride
        sleepWithJitter(1);
        rateRide(bookingId);
        return;
      }
      if (data && data.status === "cancelled") {
        customMetrics.bookingCancelled.add(1);
        customMetrics.rideSuccessRate.add(0);
        return;
      }
    }

    sleep(5);
  }

  customMetrics.rideSuccessRate.add(0);
}

function rateRide(bookingId) {
  const response = makeRequest(
    "POST",
    `${env.baseUrl}/api/v1/rides/${bookingId}/rate`,
    {
      rating: randomData.rating(),
      tip: randomData.tip(),
      feedback: "Load test feedback",
    },
    tokenStore.getAuthHeader(),
    { name: "rate_ride" },
  );

  checkResponse(response, 200, "ride rated");
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  log(`Load test completed in ${duration.toFixed(1)} seconds`);
}
