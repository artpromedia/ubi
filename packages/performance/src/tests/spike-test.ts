/**
 * Spike Test
 *
 * Tests system behavior during sudden traffic spikes.
 * Simulates real-world scenarios like flash sales, events, or viral moments.
 *
 * Target: Sudden jumps from 50 to 1000+ VUs
 * Duration: Multiple spike cycles over 20 minutes
 */

import { sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { Options } from "k6/options";
import { baseOptions, sleepWithJitter } from "../config";
import {
  authenticateUser,
  simulateFoodOrderFlow,
  simulateRideFlow,
} from "../helpers";

// Spike-specific metrics
const preSpikeLatency = new Trend("pre_spike_latency", true);
const spikePeakLatency = new Trend("spike_peak_latency", true);
const postSpikeLatency = new Trend("post_spike_latency", true);
const spikeRecoveryRate = new Rate("spike_recovery_rate");
const requestsDropped = new Counter("requests_dropped");
const autoscaleEvents = new Counter("autoscale_events");

// Track spike state
let spikeState: "pre" | "during" | "post" = "pre";

export const options: Options = {
  ...baseOptions,
  scenarios: {
    // Multiple spike scenario
    spike_test: {
      executor: "ramping-vus",
      startVUs: 50,
      stages: [
        // Baseline
        { duration: "2m", target: 50 },

        // First spike (sudden)
        { duration: "10s", target: 1000 },
        { duration: "2m", target: 1000 },
        { duration: "30s", target: 50 },

        // Recovery period
        { duration: "2m", target: 50 },

        // Second spike (larger)
        { duration: "10s", target: 1500 },
        { duration: "2m", target: 1500 },
        { duration: "30s", target: 50 },

        // Recovery
        { duration: "2m", target: 50 },

        // Third spike (flash - very quick)
        { duration: "5s", target: 2000 },
        { duration: "30s", target: 2000 },
        { duration: "10s", target: 50 },

        // Final recovery
        { duration: "3m", target: 50 },
      ],
      gracefulRampDown: "30s",
      tags: { scenario: "spike_test" },
    },
  },
  thresholds: {
    // During spikes, we expect some degradation
    http_req_duration: ["p(95)<5000"],
    http_req_failed: ["rate<0.05"], // Accept 5% during spikes

    // Pre and post spike should be normal
    pre_spike_latency: ["p(95)<1000"],
    post_spike_latency: ["p(95)<1500"], // Slightly relaxed post-spike

    // Recovery should be quick
    spike_recovery_rate: ["rate>0.9"],
  },
};

export function setup(): void {
  console.log("Starting spike test - simulating traffic spikes");
  console.log("Testing scenarios:");
  console.log("1. Standard spike (50 -> 1000 VUs)");
  console.log("2. Large spike (50 -> 1500 VUs)");
  console.log("3. Flash spike (50 -> 2000 VUs in 5s)");
}

export default function () {
  const vuId = __VU;
  const vuCount = __VU;

  // Determine spike state
  if (vuCount > 800) {
    spikeState = "during";
  } else if (spikeState === "during" && vuCount < 200) {
    spikeState = "post";
  }

  const startTime = Date.now();

  // Authenticate
  const authResult = authenticateUser(vuId);

  if (!authResult) {
    if (spikeState === "during") {
      requestsDropped.add(1);
    }
    sleep(1);
    return;
  }

  const { tokens } = authResult;

  // Simulate user action
  let success = false;

  try {
    if (Math.random() < 0.7) {
      success = simulateRideFlow(tokens.accessToken, "lagos");
    } else {
      success = simulateFoodOrderFlow(tokens.accessToken, "lagos");
    }
  } catch {
    success = false;
  }

  const duration = Date.now() - startTime;

  // Record latency by spike state
  switch (spikeState) {
    case "pre":
      preSpikeLatency.add(duration);
      break;
    case "during":
      spikePeakLatency.add(duration);
      break;
    case "post":
      postSpikeLatency.add(duration);
      // Check if we've recovered to normal latency
      spikeRecoveryRate.add(duration < 2000);
      break;
  }

  if (!success && spikeState === "during") {
    requestsDropped.add(1);
  }

  // Minimal think time during spikes (simulating urgent requests)
  const thinkTime = spikeState === "during" ? 500 : 2000;
  sleep(sleepWithJitter(thinkTime, 30) / 1000);
}

export function teardown(): void {
  console.log("Spike test completed");
  console.log("\nKey metrics to analyze:");
  console.log("- Time to handle spike (did autoscaling kick in?)");
  console.log("- Request drop rate during spike");
  console.log("- Recovery time after spike");
  console.log("- Latency comparison: pre vs during vs post spike");
}
