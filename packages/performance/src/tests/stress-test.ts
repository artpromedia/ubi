/**
 * Stress Test
 *
 * Tests system behavior under extreme load conditions.
 * Identifies breaking points and recovery behavior.
 *
 * Target: Ramp up to 2000+ VUs to find system limits
 * Duration: 45 minutes with progressive load increase
 */

import { sleep } from "k6";
import { Counter, Gauge, Trend } from "k6/metrics";
import { Options } from "k6/options";
import { baseOptions, sleepWithJitter } from "../config";
import {
  authenticateUser,
  simulateFoodOrderFlow,
  simulateRideFlow,
} from "../helpers";

// Custom metrics for stress testing
const errorsByStage = new Counter("errors_by_stage");
const responseTimeByLoad = new Trend("response_time_by_load", true);
const systemCapacity = new Gauge("system_capacity");
const recoveryTime = new Trend("recovery_time", true);
const circuitBreakerTrips = new Counter("circuit_breaker_trips");

export const options: Options = {
  ...baseOptions,
  scenarios: {
    // Progressive stress test
    stress_test: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        // Warm up
        { duration: "3m", target: 100 },

        // Normal load
        { duration: "5m", target: 500 },

        // High load
        { duration: "5m", target: 1000 },

        // Very high load
        { duration: "5m", target: 1500 },

        // Breaking point search
        { duration: "5m", target: 2000 },

        // Beyond breaking point
        { duration: "3m", target: 2500 },

        // Recovery
        { duration: "5m", target: 500 },

        // Verify recovery
        { duration: "5m", target: 100 },

        // Cool down
        { duration: "2m", target: 0 },
      ],
      gracefulRampDown: "2m",
      tags: { scenario: "stress_test" },
    },
  },
  thresholds: {
    // Relaxed thresholds for stress test (we expect degradation)
    http_req_duration: ["p(95)<10000"], // Accept up to 10s under extreme load
    http_req_failed: ["rate<0.1"], // Accept up to 10% failure under stress

    // Recovery thresholds
    recovery_time: ["p(95)<5000"], // Should recover within 5s

    // Critical errors should still be low
    "errors_by_stage{type:critical}": ["count<100"],
  },
};

// Track current stage
let currentStage = "warmup";
let stageStartTime = Date.now();

export function setup(): void {
  console.log("Starting stress test - searching for system limits");
}

export default function () {
  const vuId = __VU;
  const vuCount = __VU;

  // Update stage based on VU count (approximation)
  if (vuCount > 2000) {
    currentStage = "beyond_breaking";
  } else if (vuCount > 1500) {
    currentStage = "breaking_point";
  } else if (vuCount > 1000) {
    currentStage = "very_high";
  } else if (vuCount > 500) {
    currentStage = "high";
  } else {
    currentStage = "normal";
  }

  // Record capacity gauge
  systemCapacity.add(vuCount);

  const startTime = Date.now();

  // Authenticate
  const authResult = authenticateUser(vuId);

  if (!authResult) {
    errorsByStage.add(1, { stage: currentStage, type: "auth" });
    sleep(2);
    return;
  }

  const { tokens } = authResult;

  // Randomly select flow (heavier on rides for stress)
  const flowType = Math.random();
  let success = false;

  try {
    if (flowType < 0.7) {
      // 70% rides
      success = simulateRideFlow(tokens.accessToken, "lagos");
    } else {
      // 30% food
      success = simulateFoodOrderFlow(tokens.accessToken, "lagos");
    }
  } catch (e) {
    // Check for circuit breaker patterns
    if (String(e).includes("503") || String(e).includes("circuit")) {
      circuitBreakerTrips.add(1, { stage: currentStage });
    }
    errorsByStage.add(1, { stage: currentStage, type: "critical" });
    success = false;
  }

  const duration = Date.now() - startTime;
  responseTimeByLoad.add(duration, {
    vu_count: String(Math.floor(vuCount / 100) * 100),
  });

  if (!success) {
    errorsByStage.add(1, { stage: currentStage, type: "flow" });
  }

  // Shorter think time under stress (more aggressive)
  sleep(sleepWithJitter(1000, 50) / 1000);
}

export function teardown(): void {
  console.log("Stress test completed");
  console.log("Review metrics to identify:");
  console.log("- Breaking point (where errors spike)");
  console.log("- Degradation pattern (gradual vs cliff)");
  console.log("- Recovery behavior (time to return to normal)");
}
