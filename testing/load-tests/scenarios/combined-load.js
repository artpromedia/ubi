// k6 Load Test - Combined Scenarios
// Master test file that runs all scenarios simultaneously for realistic load

import ws from "k6/ws";
import { getEnvConfig } from "./config.js";
import {
  TokenStore,
  customMetrics,
  log,
  makeRequest,
  parseJSON,
  randomData,
  sleepWithJitter,
} from "./utils.js";

const env = getEnvConfig(__ENV.TEST_ENV || "staging");

export const options = {
  scenarios: {
    // Ride booking - 40% of traffic
    ride_booking: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 400 },
        { duration: "5m", target: 2000 },
        { duration: "10m", target: 4000 },
        { duration: "5m", target: 4000 },
        { duration: "3m", target: 0 },
      ],
      exec: "rideBookingScenario",
      tags: { scenario: "ride_booking" },
    },

    // Food ordering - 30% of traffic
    food_ordering: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 300 },
        { duration: "5m", target: 1500 },
        { duration: "10m", target: 3000 },
        { duration: "5m", target: 3000 },
        { duration: "3m", target: 0 },
      ],
      exec: "foodOrderingScenario",
      startTime: "30s",
      tags: { scenario: "food_ordering" },
    },

    // Delivery tracking - 15% of traffic
    delivery_tracking: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 150 },
        { duration: "5m", target: 750 },
        { duration: "10m", target: 1500 },
        { duration: "5m", target: 1500 },
        { duration: "3m", target: 0 },
      ],
      exec: "deliveryTrackingScenario",
      startTime: "1m",
      tags: { scenario: "delivery_tracking" },
    },

    // User profile operations - 10% of traffic
    user_profile: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 100 },
        { duration: "5m", target: 500 },
        { duration: "10m", target: 1000 },
        { duration: "5m", target: 1000 },
        { duration: "3m", target: 0 },
      ],
      exec: "userProfileScenario",
      startTime: "1m30s",
      tags: { scenario: "user_profile" },
    },

    // Payment operations - 5% of traffic
    payments: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 50 },
        { duration: "5m", target: 250 },
        { duration: "10m", target: 500 },
        { duration: "5m", target: 500 },
        { duration: "3m", target: 0 },
      ],
      exec: "paymentScenario",
      startTime: "2m",
      tags: { scenario: "payments" },
    },

    // WebSocket connections for real-time tracking
    websocket_tracking: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 5000 },
        { duration: "5m", target: 25000 },
        { duration: "10m", target: 50000 },
        { duration: "5m", target: 50000 },
        { duration: "3m", target: 0 },
      ],
      exec: "websocketTrackingScenario",
      startTime: "2m",
      tags: { scenario: "websocket" },
    },
  },

  thresholds: {
    // Global thresholds
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    http_req_failed: ["rate<0.01"],

    // Per-scenario thresholds
    "http_req_duration{scenario:ride_booking}": ["p(95)<600"],
    "http_req_duration{scenario:food_ordering}": ["p(95)<500"],
    "http_req_duration{scenario:delivery_tracking}": ["p(95)<400"],
    "http_req_duration{scenario:user_profile}": ["p(95)<300"],
    "http_req_duration{scenario:payments}": ["p(95)<800"],

    // Business metrics
    booking_duration: ["p(95)<30000"],
    ride_success_rate: ["rate>0.95"],
    food_order_success_rate: ["rate>0.95"],
    payment_success_rate: ["rate>0.99"],

    // WebSocket
    ws_connection_time: ["p(95)<1000"],
    ws_message_latency: ["p(95)<100"],
  },
};

// Scenario implementations
export function rideBookingScenario() {
  const tokenStore = new TokenStore();
  const vuId = __VU;

  // Authenticate
  authenticateUser(tokenStore, vuId);
  if (!tokenStore.accessToken) return;

  // Search locations
  const pickup = searchLocation(tokenStore, "Nairobi CBD");
  const dropoff = searchLocation(tokenStore, "Westlands");
  sleepWithJitter(1);

  // Get ride options
  const options = getRideOptions(tokenStore, pickup, dropoff);
  sleepWithJitter(2);

  // Book ride
  if (options) {
    const bookingId = createRideBooking(
      tokenStore,
      pickup,
      dropoff,
      options[0]
    );
    if (bookingId) {
      customMetrics.bookingCreated.add(1);
      pollRideStatus(tokenStore, bookingId);
    }
  }

  sleepWithJitter(5);
}

export function foodOrderingScenario() {
  const tokenStore = new TokenStore();
  const vuId = __VU;

  // Authenticate
  authenticateUser(tokenStore, vuId);
  if (!tokenStore.accessToken) return;

  // Browse restaurants
  const restaurants = getRestaurants(tokenStore);
  sleepWithJitter(2);

  if (restaurants && restaurants.length > 0) {
    const restaurant =
      restaurants[Math.floor(Math.random() * restaurants.length)];

    // Get menu
    const menu = getRestaurantMenu(tokenStore, restaurant.id);
    sleepWithJitter(2);

    if (menu && menu.items.length > 0) {
      // Create order
      const items = selectRandomItems(
        menu.items,
        Math.floor(Math.random() * 3) + 1
      );
      const orderId = createFoodOrder(tokenStore, restaurant.id, items);

      if (orderId) {
        customMetrics.foodOrderSuccessRate.add(1);
        pollOrderStatus(tokenStore, orderId);
      } else {
        customMetrics.foodOrderSuccessRate.add(0);
      }
    }
  }

  sleepWithJitter(5);
}

export function deliveryTrackingScenario() {
  const tokenStore = new TokenStore();
  const vuId = __VU;

  authenticateUser(tokenStore, vuId);
  if (!tokenStore.accessToken) return;

  // Get active deliveries
  const deliveries = getActiveDeliveries(tokenStore);

  if (deliveries && deliveries.length > 0) {
    const delivery = deliveries[0];

    // Poll delivery status
    for (let i = 0; i < 10; i++) {
      getDeliveryStatus(tokenStore, delivery.id);
      sleepWithJitter(3);
    }
  }

  sleepWithJitter(5);
}

export function userProfileScenario() {
  const tokenStore = new TokenStore();
  const vuId = __VU;

  authenticateUser(tokenStore, vuId);
  if (!tokenStore.accessToken) return;

  // Get profile
  getProfile(tokenStore);
  sleepWithJitter(1);

  // Get ride history
  getRideHistory(tokenStore);
  sleepWithJitter(1);

  // Get payment methods
  getPaymentMethods(tokenStore);
  sleepWithJitter(1);

  // Get saved places
  getSavedPlaces(tokenStore);
  sleepWithJitter(2);
}

export function paymentScenario() {
  const tokenStore = new TokenStore();
  const vuId = __VU;

  authenticateUser(tokenStore, vuId);
  if (!tokenStore.accessToken) return;

  // Get payment methods
  const methods = getPaymentMethods(tokenStore);
  sleepWithJitter(1);

  // Verify a payment (simulate checking transaction status)
  if (methods && methods.length > 0) {
    const transactionId = `txn_${Date.now()}_${vuId}`;
    verifyPayment(tokenStore, transactionId);
  }

  sleepWithJitter(3);
}

export function websocketTrackingScenario() {
  const vuId = __VU;
  const token = `test_token_${vuId}`;
  const trackingId = `track_${vuId}_${Date.now()}`;

  const url = `${env.wsUrl}/ws/track?token=${token}&id=${trackingId}`;

  const response = ws.connect(url, {}, (socket) => {
    socket.on("open", () => {
      customMetrics.wsConnections.add(1);

      socket.send(
        JSON.stringify({
          type: "subscribe",
          channel: "location",
          entityId: trackingId,
        })
      );
    });

    socket.on("message", (data) => {
      customMetrics.wsMessagesReceived.add(1);

      try {
        const message = JSON.parse(data);
        if (message.timestamp) {
          customMetrics.wsMessageLatency.add(Date.now() - message.timestamp);
        }
      } catch (e) {
        customMetrics.wsErrors.add(1);
      }
    });

    socket.on("error", () => {
      customMetrics.wsErrors.add(1);
    });

    // Heartbeat
    socket.setInterval(() => {
      socket.send(JSON.stringify({ type: "ping" }));
    }, 30000);

    // Keep alive for 2 minutes
    socket.setTimeout(() => {
      socket.close();
    }, 120000);
  });
}

// Helper functions
function authenticateUser(tokenStore, vuId) {
  const phone = `+25470${String(vuId % 100000).padStart(7, "0")}`;

  const otpResponse = makeRequest(
    "POST",
    `${env.baseUrl}/api/v1/auth/otp/request`,
    { phone },
    {}
  );

  if (otpResponse.status === 200) {
    const verifyResponse = makeRequest(
      "POST",
      `${env.baseUrl}/api/v1/auth/otp/verify`,
      { phone, code: "123456" },
      {}
    );

    if (verifyResponse.status === 200) {
      const data = parseJSON(verifyResponse);
      if (data) {
        tokenStore.setTokens(data.accessToken, data.refreshToken);
      }
    }
  }
}

function searchLocation(tokenStore, query) {
  const coords = randomData.coordinates();
  const response = makeRequest(
    "GET",
    `${env.baseUrl}/api/v1/locations/search?q=${encodeURIComponent(query)}&lat=${coords.latitude}&lng=${coords.longitude}`,
    null,
    tokenStore.getAuthHeader()
  );

  if (response.status === 200) {
    const data = parseJSON(response);
    return data?.results?.[0] || { ...coords, address: query };
  }

  return { ...coords, address: query };
}

function getRideOptions(tokenStore, pickup, dropoff) {
  const response = makeRequest(
    "POST",
    `${env.baseUrl}/api/v1/rides/options`,
    { pickup, dropoff },
    tokenStore.getAuthHeader()
  );

  if (response.status === 200) {
    const data = parseJSON(response);
    return data?.options;
  }

  return null;
}

function createRideBooking(tokenStore, pickup, dropoff, option) {
  const response = makeRequest(
    "POST",
    `${env.baseUrl}/api/v1/rides/book`,
    {
      pickup,
      dropoff,
      rideType: option.type,
      paymentMethod: "cash",
    },
    tokenStore.getAuthHeader()
  );

  if (response.status === 201) {
    const data = parseJSON(response);
    return data?.bookingId;
  }

  return null;
}

function pollRideStatus(tokenStore, bookingId) {
  for (let i = 0; i < 5; i++) {
    makeRequest(
      "GET",
      `${env.baseUrl}/api/v1/rides/${bookingId}/status`,
      null,
      tokenStore.getAuthHeader()
    );
    sleepWithJitter(3);
  }
}

function getRestaurants(tokenStore) {
  const coords = randomData.coordinates();
  const response = makeRequest(
    "GET",
    `${env.baseUrl}/api/v1/food/restaurants?lat=${coords.latitude}&lng=${coords.longitude}&limit=20`,
    null,
    tokenStore.getAuthHeader()
  );

  if (response.status === 200) {
    return parseJSON(response)?.restaurants;
  }

  return null;
}

function getRestaurantMenu(tokenStore, restaurantId) {
  const response = makeRequest(
    "GET",
    `${env.baseUrl}/api/v1/food/restaurants/${restaurantId}/menu`,
    null,
    tokenStore.getAuthHeader()
  );

  if (response.status === 200) {
    return parseJSON(response);
  }

  return null;
}

function selectRandomItems(items, count) {
  const selected = [];
  for (let i = 0; i < count && i < items.length; i++) {
    const item = items[Math.floor(Math.random() * items.length)];
    selected.push({
      itemId: item.id,
      quantity: Math.floor(Math.random() * 2) + 1,
    });
  }
  return selected;
}

function createFoodOrder(tokenStore, restaurantId, items) {
  const coords = randomData.coordinates();
  const response = makeRequest(
    "POST",
    `${env.baseUrl}/api/v1/food/orders`,
    {
      restaurantId,
      items,
      deliveryAddress: {
        ...coords,
        address: randomData.address(),
      },
      paymentMethod: "cash",
    },
    tokenStore.getAuthHeader()
  );

  if (response.status === 201) {
    return parseJSON(response)?.orderId;
  }

  return null;
}

function pollOrderStatus(tokenStore, orderId) {
  for (let i = 0; i < 3; i++) {
    makeRequest(
      "GET",
      `${env.baseUrl}/api/v1/food/orders/${orderId}/status`,
      null,
      tokenStore.getAuthHeader()
    );
    sleepWithJitter(5);
  }
}

function getActiveDeliveries(tokenStore) {
  const response = makeRequest(
    "GET",
    `${env.baseUrl}/api/v1/deliveries/active`,
    null,
    tokenStore.getAuthHeader()
  );

  if (response.status === 200) {
    return parseJSON(response)?.deliveries;
  }

  return [];
}

function getDeliveryStatus(tokenStore, deliveryId) {
  return makeRequest(
    "GET",
    `${env.baseUrl}/api/v1/deliveries/${deliveryId}/status`,
    null,
    tokenStore.getAuthHeader()
  );
}

function getProfile(tokenStore) {
  return makeRequest(
    "GET",
    `${env.baseUrl}/api/v1/users/me`,
    null,
    tokenStore.getAuthHeader()
  );
}

function getRideHistory(tokenStore) {
  return makeRequest(
    "GET",
    `${env.baseUrl}/api/v1/users/me/rides?limit=10`,
    null,
    tokenStore.getAuthHeader()
  );
}

function getPaymentMethods(tokenStore) {
  const response = makeRequest(
    "GET",
    `${env.baseUrl}/api/v1/users/me/payment-methods`,
    null,
    tokenStore.getAuthHeader()
  );

  if (response.status === 200) {
    return parseJSON(response)?.methods;
  }

  return [];
}

function getSavedPlaces(tokenStore) {
  return makeRequest(
    "GET",
    `${env.baseUrl}/api/v1/users/me/places`,
    null,
    tokenStore.getAuthHeader()
  );
}

function verifyPayment(tokenStore, transactionId) {
  return makeRequest(
    "GET",
    `${env.baseUrl}/api/v1/payments/verify/${transactionId}`,
    null,
    tokenStore.getAuthHeader()
  );
}

export function setup() {
  log("Starting combined load test");
  log(`Environment: ${__ENV.TEST_ENV || "staging"}`);
  log("Target: 10K concurrent rides, 100K API requests/minute");
  return { startTime: Date.now() };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  log(`Combined load test completed in ${duration.toFixed(1)} seconds`);
}
