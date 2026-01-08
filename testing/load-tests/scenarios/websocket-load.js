// k6 Load Test - WebSocket Connections
// Tests WebSocket infrastructure for real-time tracking at scale

import { check, sleep } from "k6";
import { Counter, Gauge, Rate, Trend } from "k6/metrics";
import ws from "k6/ws";
import { generateRandomCoordinate, getEnvConfig } from "./config.js";
import { log, sleepWithJitter } from "./utils.js";

const env = getEnvConfig(__ENV.TEST_ENV || "staging");

// Custom WebSocket metrics
const wsConnections = new Counter("ws_connections_total");
const wsConnectionTime = new Trend("ws_connection_time");
const wsMessagesSent = new Counter("ws_messages_sent");
const wsMessagesReceived = new Counter("ws_messages_received");
const wsMessageLatency = new Trend("ws_message_latency");
const wsErrors = new Counter("ws_errors");
const wsReconnections = new Counter("ws_reconnections");
const wsConnectionSuccess = new Rate("ws_connection_success");
const wsActiveConnections = new Gauge("ws_active_connections");

export const options = {
  scenarios: {
    // Rider tracking connections
    rider_connections: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 10000 }, // Ramp up to 10K
        { duration: "5m", target: 50000 }, // Ramp to 50K
        { duration: "10m", target: 100000 }, // Peak: 100K connections
        { duration: "5m", target: 100000 }, // Sustain peak
        { duration: "3m", target: 0 }, // Ramp down
      ],
      exec: "riderConnection",
      gracefulRampDown: "60s",
    },

    // Driver location updates
    driver_updates: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 2000 },
        { duration: "5m", target: 10000 },
        { duration: "10m", target: 20000 },
        { duration: "5m", target: 20000 },
        { duration: "3m", target: 0 },
      ],
      exec: "driverLocationUpdates",
      startTime: "1m",
      gracefulRampDown: "60s",
    },
  },

  thresholds: {
    ws_connection_time: ["p(95)<1000", "p(99)<2000"],
    ws_message_latency: ["p(95)<100", "p(99)<200"],
    ws_connection_success: ["rate>0.99"],
    ws_errors: ["count<1000"],
  },
};

// Rider WebSocket connection (subscribes to driver location updates)
export function riderConnection() {
  const vuId = __VU;
  const rideId = `ride_${vuId}_${Date.now()}`;
  const token = `test_token_${vuId}`;

  const url = `${env.wsUrl}/ws/rider?token=${token}&rideId=${rideId}`;
  const connectStart = Date.now();
  let messagesReceived = 0;
  let connectionEstablished = false;

  const response = ws.connect(
    url,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    (socket) => {
      socket.on("open", () => {
        const connectionTime = Date.now() - connectStart;
        wsConnectionTime.add(connectionTime);
        wsConnections.add(1);
        wsConnectionSuccess.add(1);
        wsActiveConnections.add(1);
        connectionEstablished = true;

        log(`VU ${vuId}: WebSocket connected in ${connectionTime}ms`);

        // Subscribe to ride updates
        socket.send(
          JSON.stringify({
            type: "subscribe",
            channel: "ride",
            rideId: rideId,
          })
        );
        wsMessagesSent.add(1);

        // Subscribe to driver location
        socket.send(
          JSON.stringify({
            type: "subscribe",
            channel: "driver_location",
            rideId: rideId,
          })
        );
        wsMessagesSent.add(1);
      });

      socket.on("message", (data) => {
        wsMessagesReceived.add(1);
        messagesReceived++;

        try {
          const message = JSON.parse(data);

          // Track latency for timestamped messages
          if (message.timestamp) {
            const latency = Date.now() - message.timestamp;
            wsMessageLatency.add(latency);
          }

          // Handle different message types
          switch (message.type) {
            case "driver_location":
              // Process driver location update
              handleDriverLocation(socket, message);
              break;
            case "ride_status":
              // Process ride status update
              handleRideStatus(socket, message);
              break;
            case "eta_update":
              // Process ETA update
              break;
            case "pong":
              // Heartbeat response
              break;
          }
        } catch (e) {
          wsErrors.add(1);
        }
      });

      socket.on("error", (e) => {
        wsErrors.add(1);
        wsConnectionSuccess.add(0);
        log(`VU ${vuId}: WebSocket error: ${e}`, "ERROR");
      });

      socket.on("close", () => {
        wsActiveConnections.add(-1);
        log(`VU ${vuId}: WebSocket closed after ${messagesReceived} messages`);
      });

      // Heartbeat
      socket.setInterval(() => {
        socket.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
        wsMessagesSent.add(1);
      }, 30000);

      // Keep connection alive for test duration
      socket.setTimeout(() => {
        socket.close();
      }, 120000); // 2 minutes
    }
  );

  check(response, {
    "WebSocket connected": (r) => r && r.status === 101,
  });
}

// Driver WebSocket connection (sends location updates)
export function driverLocationUpdates() {
  const vuId = __VU;
  const driverId = `driver_${vuId}`;
  const token = `driver_token_${vuId}`;

  const url = `${env.wsUrl}/ws/driver?token=${token}&driverId=${driverId}`;
  const connectStart = Date.now();
  let updatesSent = 0;

  const response = ws.connect(
    url,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    (socket) => {
      let currentLocation = generateRandomCoordinate();

      socket.on("open", () => {
        wsConnectionTime.add(Date.now() - connectStart);
        wsConnections.add(1);
        wsConnectionSuccess.add(1);
        wsActiveConnections.add(1);

        // Register as available driver
        socket.send(
          JSON.stringify({
            type: "driver_online",
            driverId: driverId,
            location: currentLocation,
            vehicleType: "economy",
          })
        );
        wsMessagesSent.add(1);
      });

      socket.on("message", (data) => {
        wsMessagesReceived.add(1);

        try {
          const message = JSON.parse(data);

          if (message.type === "ride_request") {
            // Simulate accepting ride
            sleepWithJitter(1);
            socket.send(
              JSON.stringify({
                type: "accept_ride",
                rideId: message.rideId,
                driverId: driverId,
              })
            );
            wsMessagesSent.add(1);
          }
        } catch (e) {
          wsErrors.add(1);
        }
      });

      socket.on("error", (e) => {
        wsErrors.add(1);
        wsConnectionSuccess.add(0);
      });

      socket.on("close", () => {
        wsActiveConnections.add(-1);
      });

      // Simulate driving - send location updates every 3 seconds
      socket.setInterval(() => {
        // Move slightly (simulate driving)
        currentLocation = {
          lat: currentLocation.lat + (Math.random() - 0.5) * 0.001,
          lng: currentLocation.lng + (Math.random() - 0.5) * 0.001,
        };

        socket.send(
          JSON.stringify({
            type: "location_update",
            driverId: driverId,
            location: currentLocation,
            speed: 30 + Math.random() * 40, // 30-70 km/h
            heading: Math.random() * 360,
            timestamp: Date.now(),
          })
        );
        wsMessagesSent.add(1);
        updatesSent++;
      }, 3000);

      // Keep connection alive
      socket.setTimeout(() => {
        socket.close();
      }, 120000);
    }
  );

  check(response, {
    "Driver WebSocket connected": (r) => r && r.status === 101,
  });
}

function handleDriverLocation(socket, message) {
  // Acknowledge receipt of driver location
  if (message.ack) {
    socket.send(
      JSON.stringify({
        type: "ack",
        messageId: message.messageId,
      })
    );
    wsMessagesSent.add(1);
  }
}

function handleRideStatus(socket, message) {
  // React to status changes
  switch (message.status) {
    case "driver_assigned":
      // Start tracking
      break;
    case "driver_arrived":
      // Stop tracking driver approach
      break;
    case "ride_started":
      // Start tracking ride progress
      break;
    case "ride_completed":
      // Close connection after a delay
      sleep(2);
      socket.close();
      break;
  }
}

export function setup() {
  log("Starting WebSocket load test");
  log(`Target: 100K concurrent connections`);
  log(`Environment: ${__ENV.TEST_ENV || "staging"}`);
  return { startTime: Date.now() };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  log(`WebSocket load test completed in ${duration.toFixed(1)} seconds`);
}
