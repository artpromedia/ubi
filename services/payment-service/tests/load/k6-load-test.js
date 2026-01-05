/**
 * Load Testing Configuration
 * UBI Payment Service
 *
 * Uses k6 for load testing
 * Target: 1000 TPS with p99 < 200ms
 */

import {
  randomIntBetween,
  randomItem,
} from "https://jslib.k6.io/k6-utils/1.2.0/index.js";
import { check, group, sleep } from "k6";
import http from "k6/http";
import { Counter, Rate, Trend } from "k6/metrics";

// ===========================================
// CUSTOM METRICS
// ===========================================

const paymentSuccessRate = new Rate("payment_success_rate");
const paymentLatency = new Trend("payment_latency");
const walletOpsLatency = new Trend("wallet_ops_latency");
const fraudCheckLatency = new Trend("fraud_check_latency");
const errorCounter = new Counter("errors");

// ===========================================
// CONFIGURATION
// ===========================================

export const options = {
  // Ramp-up stages
  stages: [
    { duration: "30s", target: 100 }, // Warm-up
    { duration: "1m", target: 500 }, // Ramp to 500 VUs
    { duration: "2m", target: 1000 }, // Ramp to 1000 VUs (target TPS)
    { duration: "5m", target: 1000 }, // Sustained load
    { duration: "1m", target: 500 }, // Scale down
    { duration: "30s", target: 0 }, // Cool down
  ],

  // Thresholds
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"], // Latency
    http_req_failed: ["rate<0.01"], // Error rate < 1%
    payment_success_rate: ["rate>0.99"], // Success rate > 99%
    payment_latency: ["p(99)<200"], // Payment p99 < 200ms
    wallet_ops_latency: ["p(99)<100"], // Wallet p99 < 100ms
  },

  // Output
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
};

// ===========================================
// TEST DATA
// ===========================================

const BASE_URL = __ENV.BASE_URL || "http://localhost:4003";
const AUTH_TOKEN = __ENV.AUTH_TOKEN || "load-test-token";

const testUsers = Array.from({ length: 1000 }, (_, i) => ({
  id: `load-test-user-${i}`,
  phone: `+254712${String(i).padStart(6, "0")}`,
}));

const currencies = ["NGN", "KES", "GHS", "ZAR"];
const providers = ["MPESA", "MTN_MOMO", "PAYSTACK"];

// ===========================================
// HELPER FUNCTIONS
// ===========================================

function getHeaders(userId) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${AUTH_TOKEN}`,
    "X-User-ID": userId,
    "X-Request-ID": `k6-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  };
}

function checkResponse(res, successMetric, latencyMetric) {
  const success = check(res, {
    "status is 200": (r) => r.status === 200,
    "response time < 500ms": (r) => r.timings.duration < 500,
    "has valid body": (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success === true || body.data !== undefined;
      } catch {
        return false;
      }
    },
  });

  successMetric.add(success);
  latencyMetric.add(res.timings.duration);

  if (!success) {
    errorCounter.add(1);
  }

  return success;
}

// ===========================================
// TEST SCENARIOS
// ===========================================

export default function () {
  const user = randomItem(testUsers);
  const scenario = randomIntBetween(1, 100);

  // Distribution of operations
  if (scenario <= 40) {
    // 40% - Wallet balance checks
    group("Wallet Balance Check", () => {
      walletBalanceCheck(user);
    });
  } else if (scenario <= 70) {
    // 30% - Payment initiations
    group("Payment Initiation", () => {
      initiatePayment(user);
    });
  } else if (scenario <= 85) {
    // 15% - Transaction history
    group("Transaction History", () => {
      getTransactionHistory(user);
    });
  } else if (scenario <= 95) {
    // 10% - Payout requests
    group("Payout Request", () => {
      requestPayout(user);
    });
  } else {
    // 5% - Admin operations (dashboards, reports)
    group("Admin Operations", () => {
      adminDashboard();
    });
  }

  sleep(randomIntBetween(1, 3) / 10); // 0.1-0.3s between requests
}

// ===========================================
// SCENARIO IMPLEMENTATIONS
// ===========================================

function walletBalanceCheck(user) {
  const currency = randomItem(currencies);

  const res = http.get(`${BASE_URL}/wallets/balance?currency=${currency}`, {
    headers: getHeaders(user.id),
  });

  checkResponse(res, paymentSuccessRate, walletOpsLatency);
}

function initiatePayment(user) {
  const provider = randomItem(providers);
  const amount = randomIntBetween(500, 50000);
  const currency =
    provider === "MPESA" ? "KES" : provider === "MTN_MOMO" ? "GHS" : "NGN";

  let endpoint = "/payments/process";
  let payload = {
    amount,
    currency,
    type: "WALLET_TOPUP",
    provider,
  };

  // M-Pesa specific endpoint
  if (provider === "MPESA") {
    endpoint = "/mobile-money/mpesa/stk-push";
    payload = {
      phone: user.phone,
      amount,
      currency: "KES",
    };
  }

  const res = http.post(`${BASE_URL}${endpoint}`, JSON.stringify(payload), {
    headers: getHeaders(user.id),
  });

  checkResponse(res, paymentSuccessRate, paymentLatency);
}

function getTransactionHistory(user) {
  const res = http.get(`${BASE_URL}/wallets/transactions?limit=20`, {
    headers: getHeaders(user.id),
  });

  checkResponse(res, paymentSuccessRate, walletOpsLatency);
}

function requestPayout(user) {
  const amount = randomIntBetween(1000, 20000);

  const res = http.post(
    `${BASE_URL}/payouts/instant-cashout`,
    JSON.stringify({
      amount,
      currency: "KES",
      phone: user.phone,
      provider: "MPESA",
    }),
    { headers: getHeaders(user.id) }
  );

  checkResponse(res, paymentSuccessRate, paymentLatency);
}

function adminDashboard() {
  const res = http.get(`${BASE_URL}/admin/dashboard`, {
    headers: {
      ...getHeaders("admin-load-test"),
      "X-Admin-Role": "SUPER_ADMIN",
    },
  });

  check(res, {
    "admin dashboard loads": (r) => r.status === 200,
  });
}

// ===========================================
// SPIKE TEST
// ===========================================

export function spikeTest() {
  // Sudden spike to test auto-scaling
  const user = randomItem(testUsers);

  const res = http.post(
    `${BASE_URL}/mobile-money/mpesa/stk-push`,
    JSON.stringify({
      phone: user.phone,
      amount: randomIntBetween(100, 5000),
      currency: "KES",
    }),
    { headers: getHeaders(user.id) }
  );

  checkResponse(res, paymentSuccessRate, paymentLatency);
}

export const spikeOptions = {
  stages: [
    { duration: "10s", target: 100 },
    { duration: "1s", target: 2000 }, // Instant spike
    { duration: "30s", target: 2000 }, // Sustained spike
    { duration: "10s", target: 100 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.05"], // Allow 5% errors during spike
  },
};

// ===========================================
// STRESS TEST
// ===========================================

export function stressTest() {
  const user = randomItem(testUsers);

  // Heavy transaction processing
  const res = http.post(
    `${BASE_URL}/payments/process`,
    JSON.stringify({
      amount: randomIntBetween(10000, 100000),
      currency: "NGN",
      type: "RIDE_PAYMENT",
      provider: "PAYSTACK",
      metadata: {
        rideId: `stress-ride-${Date.now()}`,
        driverId: `driver-${randomIntBetween(1, 100)}`,
      },
    }),
    { headers: getHeaders(user.id) }
  );

  checkResponse(res, paymentSuccessRate, paymentLatency);
  sleep(0.05); // Minimal delay for stress testing
}

export const stressOptions = {
  stages: [
    { duration: "2m", target: 500 },
    { duration: "5m", target: 1500 }, // Beyond normal capacity
    { duration: "5m", target: 2000 }, // Max stress
    { duration: "2m", target: 500 },
    { duration: "1m", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<2000"], // Allow higher latency under stress
    http_req_failed: ["rate<0.1"], // Allow 10% error rate
  },
};

// ===========================================
// ENDURANCE TEST
// ===========================================

export function enduranceTest() {
  // Sustained load over extended period
  const user = randomItem(testUsers);
  const scenario = randomIntBetween(1, 100);

  if (scenario <= 50) {
    walletBalanceCheck(user);
  } else {
    initiatePayment(user);
  }

  sleep(0.5);
}

export const enduranceOptions = {
  stages: [
    { duration: "5m", target: 500 },
    { duration: "4h", target: 500 }, // 4-hour sustained load
    { duration: "5m", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(99)<500"],
    http_req_failed: ["rate<0.01"],
  },
};
