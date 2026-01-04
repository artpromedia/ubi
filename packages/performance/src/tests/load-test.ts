/**
 * Load Test
 *
 * Tests system behavior under expected load conditions.
 * Simulates typical traffic patterns for African markets.
 *
 * Target: 500 VUs representing normal peak traffic
 * Duration: 30 minutes with ramp-up and ramp-down
 */

import { sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { Options } from "k6/options";
import { baseOptions, sleepWithJitter, weightedRandom } from "../config";
import {
  authenticateUser,
  getWalletBalance,
  simulateFoodOrderFlow,
  simulateRideFlow,
} from "../helpers";

// Custom metrics
const rideRequestLatency = new Trend("ride_request_latency", true);
const foodOrderLatency = new Trend("food_order_latency", true);
const authLatency = new Trend("auth_latency", true);
const userFlowSuccess = new Rate("user_flow_success");
const totalRideRequests = new Counter("total_ride_requests");
const totalFoodOrders = new Counter("total_food_orders");

export const options: Options = {
  ...baseOptions,
  scenarios: {
    // Morning rush scenario (7am-9am)
    morning_rush: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "5m", target: 300 }, // Ramp up
        { duration: "20m", target: 500 }, // Peak
        { duration: "5m", target: 100 }, // Ramp down
      ],
      gracefulRampDown: "1m",
      tags: { scenario: "morning_rush" },
      env: { USER_TYPE: "mixed" },
    },
  },
  thresholds: {
    // Overall thresholds
    http_req_duration: ["p(95)<2000", "p(99)<5000"],
    http_req_failed: ["rate<0.01"],

    // Scenario-specific thresholds
    ride_request_latency: ["p(95)<3000"],
    food_order_latency: ["p(95)<2500"],
    auth_latency: ["p(95)<500"],
    user_flow_success: ["rate>0.95"],
  },
};

export default function () {
  const vuId = __VU;

  // Authenticate
  const startAuth = Date.now();
  const authResult = authenticateUser(vuId);
  authLatency.add(Date.now() - startAuth);

  if (!authResult) {
    userFlowSuccess.add(false);
    sleep(5);
    return;
  }

  const { tokens } = authResult;

  // Randomly select user flow based on realistic distribution
  const flow = weightedRandom([
    { item: "ride", weight: 0.6 }, // 60% ride requests
    { item: "food", weight: 0.3 }, // 30% food orders
    { item: "browse", weight: 0.1 }, // 10% just browsing
  ]);

  let success = false;

  switch (flow) {
    case "ride": {
      const startRide = Date.now();
      success = simulateRideFlow(tokens.accessToken, "lagos");
      rideRequestLatency.add(Date.now() - startRide);
      totalRideRequests.add(1);
      break;
    }
    case "food": {
      const startFood = Date.now();
      success = simulateFoodOrderFlow(tokens.accessToken, "lagos");
      foodOrderLatency.add(Date.now() - startFood);
      totalFoodOrders.add(1);
      break;
    }
    case "browse": {
      // Just check wallet balance
      const wallet = getWalletBalance(tokens.accessToken);
      success = wallet !== null;
      break;
    }
  }

  userFlowSuccess.add(success);

  // Realistic think time between actions
  sleep(sleepWithJitter(3000, 30) / 1000);
}

export function teardown(): void {
  console.log("Load test completed");
}
