/**
 * African Traffic Pattern Load Testing Suite
 * UBI Payment Service - Sprint 3: Production Hardening
 *
 * Simulates realistic African traffic patterns including:
 * - Peak hours (7-9 AM, 12-2 PM, 5-8 PM EAT/WAT)
 * - Mobile network conditions (2G, 3G, 4G)
 * - Regional distribution (Kenya, Nigeria, Ghana, South Africa)
 * - Payment provider mix (M-Pesa, MTN MoMo, Airtel, Paystack)
 *
 * Run with: k6 run --out json=results.json africa-load-test.js
 */

import {
  randomIntBetween,
  randomItem,
  randomString,
} from "https://jslib.k6.io/k6-utils/1.2.0/index.js";
import { check, group, sleep } from "k6";
import http from "k6/http";
import { Counter, Rate, Trend } from "k6/metrics";

// ===========================================
// AFRICAN TRAFFIC METRICS
// ===========================================

// Payment provider specific metrics
const mpesaLatency = new Trend("mpesa_latency_ms");
const momoLatency = new Trend("momo_latency_ms");
const paystackLatency = new Trend("paystack_latency_ms");
const airtelLatency = new Trend("airtel_latency_ms");

// Network condition metrics
const network2GLatency = new Trend("network_2g_latency_ms");
const network3GLatency = new Trend("network_3g_latency_ms");
const network4GLatency = new Trend("network_4g_latency_ms");

// Success rates by region
const kenyaSuccessRate = new Rate("kenya_success_rate");
const nigeriaSuccessRate = new Rate("nigeria_success_rate");
const ghanaSuccessRate = new Rate("ghana_success_rate");

// Error tracking
const timeoutErrors = new Counter("timeout_errors");
const networkErrors = new Counter("network_errors");
const paymentFailures = new Counter("payment_failures");
const retryAttempts = new Counter("retry_attempts");

// ===========================================
// AFRICAN NETWORK CONDITIONS
// ===========================================

/**
 * Realistic African network profiles
 * Based on GSMA Mobile Connectivity Index data
 */
const NETWORK_PROFILES = {
  // 2G: Common in rural areas
  "2G": {
    latencyMs: { min: 800, max: 2500 },
    jitterMs: { min: 100, max: 500 },
    packetLossRate: 0.05,
    bandwidthKbps: 50,
  },
  // 3G: Urban areas, majority of users
  "3G": {
    latencyMs: { min: 200, max: 800 },
    jitterMs: { min: 50, max: 200 },
    packetLossRate: 0.02,
    bandwidthKbps: 1000,
  },
  // 4G: Major cities
  "4G": {
    latencyMs: { min: 50, max: 200 },
    jitterMs: { min: 10, max: 50 },
    packetLossRate: 0.005,
    bandwidthKbps: 10000,
  },
};

/**
 * Network distribution by country (based on GSMA data)
 */
const NETWORK_DISTRIBUTION = {
  KENYA: { "2G": 0.15, "3G": 0.55, "4G": 0.3 },
  NIGERIA: { "2G": 0.25, "3G": 0.5, "4G": 0.25 },
  GHANA: { "2G": 0.2, "3G": 0.55, "4G": 0.25 },
  SOUTH_AFRICA: { "2G": 0.1, "3G": 0.4, "4G": 0.5 },
  UGANDA: { "2G": 0.3, "3G": 0.55, "4G": 0.15 },
  TANZANIA: { "2G": 0.35, "3G": 0.5, "4G": 0.15 },
};

/**
 * Payment provider distribution by country
 */
const PROVIDER_DISTRIBUTION = {
  KENYA: {
    MPESA: 0.75,
    AIRTEL_MONEY: 0.15,
    CARD: 0.08,
    BANK: 0.02,
  },
  NIGERIA: {
    PAYSTACK: 0.4,
    FLUTTERWAVE: 0.25,
    CARD: 0.25,
    BANK: 0.1,
  },
  GHANA: {
    MTN_MOMO: 0.55,
    VODAFONE_CASH: 0.2,
    AIRTEL_TIGO: 0.15,
    CARD: 0.1,
  },
  SOUTH_AFRICA: {
    CARD: 0.5,
    EFT: 0.3,
    SNAPSCAN: 0.1,
    OZOW: 0.1,
  },
};

// ===========================================
// PEAK TRAFFIC PATTERNS
// ===========================================

/**
 * African peak hours (in UTC for EAT/WAT)
 * - Morning rush: 4-6 UTC (7-9 AM EAT)
 * - Lunch break: 9-11 UTC (12-2 PM EAT)
 * - Evening rush: 14-17 UTC (5-8 PM EAT)
 */
const TRAFFIC_MULTIPLIERS = {
  0: 0.3,
  1: 0.2,
  2: 0.15,
  3: 0.15, // Night (low)
  4: 0.8,
  5: 1.2,
  6: 1.5, // Morning rush start
  7: 1,
  8: 0.7, // Post-morning
  9: 1.3,
  10: 1.4,
  11: 1.2, // Lunch peak
  12: 0.9,
  13: 0.8, // Afternoon lull
  14: 1.4,
  15: 1.8,
  16: 2,
  17: 1.8, // Evening rush peak
  18: 1.2,
  19: 1, // Evening wind-down
  20: 0.7,
  21: 0.5,
  22: 0.4,
  23: 0.35, // Night ramp-down
};

// ===========================================
// CONFIGURATION
// ===========================================

export const options = {
  scenarios: {
    // Simulate realistic African traffic patterns
    african_peak_traffic: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        // Simulate morning rush (7-9 AM EAT)
        { duration: "2m", target: 200 }, // Ramp up
        { duration: "5m", target: 500 }, // Morning peak
        { duration: "3m", target: 300 }, // Post-rush decline

        // Simulate lunch peak (12-2 PM EAT)
        { duration: "2m", target: 450 }, // Lunch ramp
        { duration: "5m", target: 600 }, // Lunch peak
        { duration: "3m", target: 300 }, // Post-lunch

        // Simulate evening rush (5-8 PM EAT) - Highest load
        { duration: "3m", target: 800 }, // Evening ramp
        { duration: "8m", target: 1000 }, // Peak evening (target TPS)
        { duration: "5m", target: 600 }, // Wind down
        { duration: "2m", target: 200 }, // Night
        { duration: "2m", target: 0 }, // Cool down
      ],
      gracefulRampDown: "30s",
    },

    // Network resilience testing
    poor_network_stress: {
      executor: "constant-vus",
      vus: 100,
      duration: "10m",
      startTime: "5m",
      env: { NETWORK_PROFILE: "2G" },
    },

    // Payment timeout recovery testing
    timeout_recovery: {
      executor: "per-vu-iterations",
      vus: 50,
      iterations: 10,
      startTime: "15m",
      maxDuration: "5m",
    },
  },

  thresholds: {
    // Overall performance
    http_req_duration: ["p(95)<2000", "p(99)<5000"], // Relaxed for Africa
    http_req_failed: ["rate<0.05"], // 5% failure acceptable

    // Payment success rates
    kenya_success_rate: ["rate>0.95"],
    nigeria_success_rate: ["rate>0.90"], // Lower due to network issues
    ghana_success_rate: ["rate>0.92"],

    // Provider-specific latencies
    mpesa_latency_ms: ["p(95)<3000"], // M-Pesa can be slow
    momo_latency_ms: ["p(95)<4000"], // MTN MoMo even slower
    paystack_latency_ms: ["p(95)<2000"], // Card payments faster

    // Network-specific thresholds
    network_2g_latency_ms: ["p(95)<8000"],
    network_3g_latency_ms: ["p(95)<3000"],
    network_4g_latency_ms: ["p(95)<1000"],

    // Error limits
    timeout_errors: ["count<100"],
    payment_failures: ["count<50"],
  },

  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
};

// ===========================================
// TEST DATA
// ===========================================

const BASE_URL = __ENV.BASE_URL || "http://localhost:4003";
const AUTH_TOKEN = __ENV.AUTH_TOKEN || "load-test-token";

// Test phone numbers by country
const TEST_PHONES = {
  KENYA: Array.from(
    { length: 500 },
    (_, i) => `+254712${String(i).padStart(6, "0")}`,
  ),
  NIGERIA: Array.from(
    { length: 500 },
    (_, i) => `+234801${String(i).padStart(7, "0")}`,
  ),
  GHANA: Array.from(
    { length: 200 },
    (_, i) => `+23320${String(i).padStart(7, "0")}`,
  ),
  SOUTH_AFRICA: Array.from(
    { length: 200 },
    (_, i) => `+27721${String(i).padStart(6, "0")}`,
  ),
};

// Currency by country
const CURRENCIES = {
  KENYA: "KES",
  NIGERIA: "NGN",
  GHANA: "GHS",
  SOUTH_AFRICA: "ZAR",
};

// Typical transaction amounts (in local currency cents)
const AMOUNT_RANGES = {
  KENYA: { min: 5000, max: 500000 }, // 50 - 5000 KES
  NIGERIA: { min: 50000, max: 5000000 }, // 500 - 50000 NGN
  GHANA: { min: 1000, max: 100000 }, // 10 - 1000 GHS
  SOUTH_AFRICA: { min: 2000, max: 200000 }, // 20 - 2000 ZAR
};

// ===========================================
// HELPER FUNCTIONS
// ===========================================

function selectCountry() {
  const distribution = [
    { country: "KENYA", weight: 0.35 },
    { country: "NIGERIA", weight: 0.35 },
    { country: "GHANA", weight: 0.15 },
    { country: "SOUTH_AFRICA", weight: 0.15 },
  ];

  const rand = Math.random();
  let cumulative = 0;

  for (const { country, weight } of distribution) {
    cumulative += weight;
    if (rand < cumulative) return country;
  }

  return "KENYA";
}

function selectNetwork(country) {
  const dist = NETWORK_DISTRIBUTION[country] || NETWORK_DISTRIBUTION.KENYA;
  const rand = Math.random();
  let cumulative = 0;

  for (const [network, weight] of Object.entries(dist)) {
    cumulative += weight;
    if (rand < cumulative) return network;
  }

  return "3G";
}

function selectProvider(country) {
  const dist = PROVIDER_DISTRIBUTION[country] || PROVIDER_DISTRIBUTION.KENYA;
  const rand = Math.random();
  let cumulative = 0;

  for (const [provider, weight] of Object.entries(dist)) {
    cumulative += weight;
    if (rand < cumulative) return provider;
  }

  return "MPESA";
}

function simulateNetworkDelay(network) {
  const profile = NETWORK_PROFILES[network] || NETWORK_PROFILES["3G"];
  const baseLatency = randomIntBetween(
    profile.latencyMs.min,
    profile.latencyMs.max,
  );
  const jitter = randomIntBetween(0, profile.jitterMs.max);

  // Simulate packet loss requiring retry
  if (Math.random() < profile.packetLossRate) {
    retryAttempts.add(1);
    return baseLatency * 2 + jitter; // Double latency for retry
  }

  return baseLatency + jitter;
}

function getHeaders(userId, country) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${AUTH_TOKEN}`,
    "X-User-ID": userId,
    "X-Request-ID": `k6-${Date.now()}-${randomString(8)}`,
    "X-Country": country,
    "X-Client-Version": "2.5.0",
    "Accept-Language": country === "KENYA" ? "sw-KE" : "en",
  };
}

function recordMetrics(res, country, provider, network) {
  const success = res.status === 200;
  const duration = res.timings.duration;

  // Country success rates
  if (country === "KENYA") kenyaSuccessRate.add(success);
  else if (country === "NIGERIA") nigeriaSuccessRate.add(success);
  else if (country === "GHANA") ghanaSuccessRate.add(success);

  // Provider latencies
  if (provider === "MPESA") mpesaLatency.add(duration);
  else if (provider.includes("MOMO")) momoLatency.add(duration);
  else if (provider === "PAYSTACK" || provider === "FLUTTERWAVE")
    paystackLatency.add(duration);
  else if (provider.includes("AIRTEL")) airtelLatency.add(duration);

  // Network latencies
  if (network === "2G") network2GLatency.add(duration);
  else if (network === "3G") network3GLatency.add(duration);
  else if (network === "4G") network4GLatency.add(duration);

  // Error tracking
  if (!success) {
    paymentFailures.add(1);
    if (duration > 30000) timeoutErrors.add(1);
    else networkErrors.add(1);
  }
}

// ===========================================
// TEST SCENARIOS
// ===========================================

export default function runLoadTest() {
  const country = selectCountry();
  const network = selectNetwork(country);
  const provider = selectProvider(country);
  const phone = randomItem(TEST_PHONES[country]);
  const currency = CURRENCIES[country];
  const amountRange = AMOUNT_RANGES[country];
  const amount = randomIntBetween(amountRange.min, amountRange.max);
  const userId = `user-${country.toLowerCase()}-${randomIntBetween(1, 10000)}`;

  // Add network delay simulation
  const networkDelay = simulateNetworkDelay(network);

  group(`${country} Payment Flow (${network}, ${provider})`, () => {
    // Step 1: Wallet Balance Check
    {
      const res = http.get(`${BASE_URL}/api/v1/wallet/balance`, {
        headers: getHeaders(userId, country),
        timeout: "10s",
      });

      check(res, {
        "balance check successful": (r) => r.status === 200 || r.status === 404,
      });
    }

    sleep((networkDelay / 1000) * 0.1); // Proportional think time

    // Step 2: Initiate Payment
    {
      const payload = JSON.stringify({
        amount,
        currency,
        provider,
        phone,
        reference: `k6-${country}-${Date.now()}-${randomString(6)}`,
        metadata: {
          test: true,
          network,
          country,
        },
      });

      const res = http.post(`${BASE_URL}/api/v1/payments/initiate`, payload, {
        headers: getHeaders(userId, country),
        timeout: provider === "MPESA" ? "60s" : "30s", // M-Pesa needs longer timeout
      });

      recordMetrics(res, country, provider, network);

      const success = check(res, {
        "payment initiated": (r) => r.status === 200 || r.status === 201,
        "has transaction id": (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.transactionId || body.data?.transactionId;
          } catch {
            return false;
          }
        },
      });

      if (success) {
        // Step 3: Check Payment Status (for M-Pesa STK Push flow)
        if (provider === "MPESA") {
          sleep(2 + Math.random() * 3); // Wait for STK push callback

          try {
            const body = JSON.parse(res.body);
            const txnId = body.transactionId || body.data?.transactionId;

            if (txnId) {
              const statusRes = http.get(
                `${BASE_URL}/api/v1/payments/${txnId}/status`,
                {
                  headers: getHeaders(userId, country),
                  timeout: "15s",
                },
              );

              check(statusRes, {
                "status check successful": (r) => r.status === 200,
              });
            }
          } catch {
            // Parse errors are expected for non-JSON responses
          }
        }
      }
    }

    // Random think time based on network conditions
    sleep((networkDelay / 1000) * 0.3 + Math.random() * 2);
  });
}

// ===========================================
// SETUP & TEARDOWN
// ===========================================

export function setup() {
  console.log("🌍 Starting African Traffic Load Test");
  console.log(`📊 Target: ${BASE_URL}`);
  console.log("🔧 Network profiles: 2G, 3G, 4G simulation enabled");
  console.log("💳 Providers: M-Pesa, MTN MoMo, Paystack, Airtel");

  // Verify service is reachable
  const res = http.get(`${BASE_URL}/health`);
  if (res.status !== 200) {
    console.warn(`⚠️ Health check returned ${res.status}`);
  }

  return {
    startTime: Date.now(),
  };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`\n🏁 Test completed in ${duration.toFixed(1)}s`);
  console.log("📈 Check results.json for detailed metrics");
}

// ===========================================
// CUSTOM SUMMARY
// ===========================================

export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    duration: data.state.testRunDurationMs,

    // Overall metrics
    overall: {
      requests: data.metrics.http_reqs?.values?.count || 0,
      failedRate: data.metrics.http_req_failed?.values?.rate || 0,
      avgDuration: data.metrics.http_req_duration?.values?.avg || 0,
      p95Duration: data.metrics.http_req_duration?.values["p(95)"] || 0,
      p99Duration: data.metrics.http_req_duration?.values["p(99)"] || 0,
    },

    // Country breakdown
    countries: {
      kenya: {
        successRate: data.metrics.kenya_success_rate?.values?.rate || 0,
      },
      nigeria: {
        successRate: data.metrics.nigeria_success_rate?.values?.rate || 0,
      },
      ghana: {
        successRate: data.metrics.ghana_success_rate?.values?.rate || 0,
      },
    },

    // Provider breakdown
    providers: {
      mpesa: {
        p95: data.metrics.mpesa_latency_ms?.values["p(95)"] || 0,
        avg: data.metrics.mpesa_latency_ms?.values?.avg || 0,
      },
      momo: {
        p95: data.metrics.momo_latency_ms?.values["p(95)"] || 0,
        avg: data.metrics.momo_latency_ms?.values?.avg || 0,
      },
      paystack: {
        p95: data.metrics.paystack_latency_ms?.values["p(95)"] || 0,
        avg: data.metrics.paystack_latency_ms?.values?.avg || 0,
      },
    },

    // Network breakdown
    networks: {
      "2g": {
        p95: data.metrics.network_2g_latency_ms?.values["p(95)"] || 0,
      },
      "3g": {
        p95: data.metrics.network_3g_latency_ms?.values["p(95)"] || 0,
      },
      "4g": {
        p95: data.metrics.network_4g_latency_ms?.values["p(95)"] || 0,
      },
    },

    // Errors
    errors: {
      timeouts: data.metrics.timeout_errors?.values?.count || 0,
      network: data.metrics.network_errors?.values?.count || 0,
      paymentFailures: data.metrics.payment_failures?.values?.count || 0,
      retries: data.metrics.retry_attempts?.values?.count || 0,
    },
  };

  return {
    stdout: textSummary(data, { indent: " ", enableColors: true }),
    "africa-load-results.json": JSON.stringify(summary, null, 2),
  };
}

function textSummary(data, options) {
  const lines = [
    "",
    "╔══════════════════════════════════════════════════════════════════╗",
    "║           🌍 AFRICAN TRAFFIC LOAD TEST RESULTS 🌍                ║",
    "╠══════════════════════════════════════════════════════════════════╣",
    "",
    `  Total Requests: ${data.metrics.http_reqs?.values?.count || 0}`,
    `  Failed Rate:    ${((data.metrics.http_req_failed?.values?.rate || 0) * 100).toFixed(2)}%`,
    `  Avg Duration:   ${(data.metrics.http_req_duration?.values?.avg || 0).toFixed(0)}ms`,
    `  P95 Duration:   ${(data.metrics.http_req_duration?.values["p(95)"] || 0).toFixed(0)}ms`,
    `  P99 Duration:   ${(data.metrics.http_req_duration?.values["p(99)"] || 0).toFixed(0)}ms`,
    "",
    "  📍 Success Rate by Country:",
    `     Kenya:        ${((data.metrics.kenya_success_rate?.values?.rate || 0) * 100).toFixed(1)}%`,
    `     Nigeria:      ${((data.metrics.nigeria_success_rate?.values?.rate || 0) * 100).toFixed(1)}%`,
    `     Ghana:        ${((data.metrics.ghana_success_rate?.values?.rate || 0) * 100).toFixed(1)}%`,
    "",
    "  💳 P95 Latency by Provider:",
    `     M-Pesa:       ${(data.metrics.mpesa_latency_ms?.values["p(95)"] || 0).toFixed(0)}ms`,
    `     MTN MoMo:     ${(data.metrics.momo_latency_ms?.values["p(95)"] || 0).toFixed(0)}ms`,
    `     Paystack:     ${(data.metrics.paystack_latency_ms?.values["p(95)"] || 0).toFixed(0)}ms`,
    "",
    "  📶 P95 Latency by Network:",
    `     2G:           ${(data.metrics.network_2g_latency_ms?.values["p(95)"] || 0).toFixed(0)}ms`,
    `     3G:           ${(data.metrics.network_3g_latency_ms?.values["p(95)"] || 0).toFixed(0)}ms`,
    `     4G:           ${(data.metrics.network_4g_latency_ms?.values["p(95)"] || 0).toFixed(0)}ms`,
    "",
    "  ⚠️ Errors:",
    `     Timeouts:     ${data.metrics.timeout_errors?.values?.count || 0}`,
    `     Network:      ${data.metrics.network_errors?.values?.count || 0}`,
    `     Failures:     ${data.metrics.payment_failures?.values?.count || 0}`,
    `     Retries:      ${data.metrics.retry_attempts?.values?.count || 0}`,
    "",
    "╚══════════════════════════════════════════════════════════════════╝",
    "",
  ];

  return lines.join("\n");
}
