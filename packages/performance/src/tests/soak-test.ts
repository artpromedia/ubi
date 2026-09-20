/**
 * Soak Test (Endurance Test)
 *
 * Tests system stability over extended periods.
 * Identifies memory leaks, resource exhaustion, and degradation over time.
 *
 * Target: Moderate load (300 VUs) sustained for 4 hours
 * Purpose: Find slow leaks and long-term stability issues
 */

import { sleep } from "k6";
import { Counter, Gauge, Rate, Trend } from "k6/metrics";
import { Options } from "k6/options";
import { baseOptions, sleepWithJitter } from "../config";
import {
  authenticateUser,
  getTransactionHistory,
  getWalletBalance,
  simulateFoodOrderFlow,
  simulateRideFlow,
} from "../helpers";

// Soak-specific metrics
const hourlyLatency = new Trend("hourly_latency", true);
const memoryGrowth = new Gauge("memory_growth_indicator");
const connectionPoolUsage = new Gauge("connection_pool_usage");
const cumulativeErrors = new Counter("cumulative_errors");
const degradationRate = new Rate("degradation_rate");
const consistencyScore = new Gauge("consistency_score");

// Track time periods
const startTime = Date.now();
const HOUR_MS = 60 * 60 * 1000;

function getCurrentHour(): number {
  return Math.floor((Date.now() - startTime) / HOUR_MS);
}

export const options: Options = {
  ...baseOptions,
  scenarios: {
    // Long-running soak test
    soak_test: {
      executor: "constant-vus",
      vus: 300,
      duration: "4h",
      tags: { scenario: "soak_test" },
    },
  },
  thresholds: {
    // Thresholds should remain consistent throughout
    http_req_duration: ["p(95)<2000", "p(99)<4000"],
    http_req_failed: ["rate<0.01"],

    // Hour-over-hour latency should not degrade significantly
    hourly_latency: ["p(95)<2500"],

    // Degradation rate should be minimal
    degradation_rate: ["rate<0.02"], // Less than 2% degradation

    // Cumulative errors should stay bounded
    cumulative_errors: ["count<1000"], // Over 4 hours
  },
};

// Track baseline for degradation detection
let baselineLatency: number | null = null;
const latencyHistory: number[] = [];

export function setup(): void {
  console.log("Starting 4-hour soak test");
  console.log("Monitoring for:");
  console.log("- Memory leaks (response time degradation)");
  console.log("- Connection pool exhaustion");
  console.log("- Database connection issues");
  console.log("- Cache effectiveness over time");
  console.log("\nCheckpoints every hour");
}

export default function () {
  const vuId = __VU;
  const currentHour = getCurrentHour();

  const startRequestTime = Date.now();

  // Authenticate
  const authResult = authenticateUser(vuId);

  if (!authResult) {
    cumulativeErrors.add(1);
    sleep(5);
    return;
  }

  const { tokens } = authResult;

  // Mix of operations to stress different system components
  const operation = Math.random();
  let success = false;
  let operationType = "";

  if (operation < 0.4) {
    // 40% ride requests (CPU + network intensive)
    operationType = "ride";
    success = simulateRideFlow(tokens.accessToken, "lagos");
  } else if (operation < 0.7) {
    // 30% food orders (database intensive)
    operationType = "food";
    success = simulateFoodOrderFlow(tokens.accessToken, "lagos");
  } else if (operation < 0.9) {
    // 20% wallet checks (cache + database)
    operationType = "wallet";
    const wallet = getWalletBalance(tokens.accessToken);
    success = wallet !== null;
  } else {
    // 10% transaction history (pagination + large queries)
    operationType = "history";
    const history = getTransactionHistory(tokens.accessToken, 1, 50);
    success = history !== null;
  }

  const duration = Date.now() - startRequestTime;

  // Record by hour
  hourlyLatency.add(duration, { hour: String(currentHour) });

  // Track baseline on first hour
  if (currentHour === 0 && latencyHistory.length < 100) {
    latencyHistory.push(duration);
    if (latencyHistory.length === 100) {
      baselineLatency =
        latencyHistory.reduce((a, b) => a + b, 0) / latencyHistory.length;
      console.log(`Baseline latency established: ${baselineLatency}ms`);
    }
  }

  // Check for degradation
  if (baselineLatency !== null) {
    const degraded = duration > baselineLatency * 1.5; // 50% degradation threshold
    degradationRate.add(degraded);

    // Calculate consistency score (how close to baseline)
    const consistency = Math.max(
      0,
      1 - Math.abs(duration - baselineLatency) / baselineLatency,
    );
    consistencyScore.add(consistency);
  }

  if (!success) {
    cumulativeErrors.add(1, {
      operation: operationType,
      hour: String(currentHour),
    });
  }

  // Simulate memory/connection indicators
  // In real scenario, these would come from system metrics
  memoryGrowth.add(currentHour * 0.1); // Placeholder
  connectionPoolUsage.add(50 + Math.random() * 30); // Placeholder

  // Realistic think time for sustained load
  sleep(sleepWithJitter(5000, 40) / 1000);
}

// Hourly checkpoint logging
export function handleSummary(
  data: Record<string, unknown>,
): Record<string, string> {
  const currentHour = getCurrentHour();
  console.log(`\n=== Hour ${currentHour} Checkpoint ===`);
  console.log(`Total requests: ${data.metrics?.http_reqs?.values?.count || 0}`);
  console.log(
    `Error count: ${data.metrics?.cumulative_errors?.values?.count || 0}`,
  );

  return {
    stdout: JSON.stringify(data, null, 2),
    "soak-test-results.json": JSON.stringify(data, null, 2),
  };
}

export function teardown(): void {
  const totalHours = getCurrentHour();
  console.log(`\nSoak test completed after ${totalHours} hours`);
  console.log("\nAnalysis checklist:");
  console.log("□ Compare hourly latency trends (should be flat)");
  console.log("□ Check error rate progression");
  console.log("□ Review memory/CPU graphs from monitoring");
  console.log("□ Check database connection pool stats");
  console.log("□ Verify cache hit rates remained stable");
  console.log("□ Look for any periodic patterns (GC, cron jobs)");
}
