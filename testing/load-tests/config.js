// k6 Configuration for UBI Load Testing
// Supports distributed load testing across multiple scenarios

export const CONFIG = {
  // Environment configurations
  environments: {
    local: {
      baseUrl: "http://localhost:3000",
      wsUrl: "ws://localhost:3001",
    },
    staging: {
      baseUrl: "https://api-staging.ubi.com",
      wsUrl: "wss://ws-staging.ubi.com",
    },
    production: {
      baseUrl: "https://api.ubi.com",
      wsUrl: "wss://ws.ubi.com",
    },
  },

  // Test users pool
  testUsers: {
    riders: {
      count: 10000,
      phonePrefix: "+25470000",
      passwordPattern: "TestPass123!",
    },
    drivers: {
      count: 2000,
      phonePrefix: "+25471000",
      passwordPattern: "DriverPass123!",
    },
  },

  // Geolocation bounds (Nairobi)
  geoBounds: {
    minLat: -1.35,
    maxLat: -1.2,
    minLng: 36.7,
    maxLng: 36.95,
  },

  // Performance thresholds
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    http_req_failed: ["rate<0.01"],
    ws_connecting: ["p(95)<100"],
    ws_msgs_received: ["rate>1000"],
    iteration_duration: ["p(95)<5000"],
  },

  // Load profiles
  loadProfiles: {
    smoke: {
      vus: 10,
      duration: "2m",
    },
    load: {
      stages: [
        { duration: "2m", target: 100 },
        { duration: "5m", target: 1000 },
        { duration: "10m", target: 1000 },
        { duration: "2m", target: 0 },
      ],
    },
    stress: {
      stages: [
        { duration: "2m", target: 1000 },
        { duration: "5m", target: 5000 },
        { duration: "5m", target: 10000 },
        { duration: "5m", target: 10000 },
        { duration: "5m", target: 0 },
      ],
    },
    spike: {
      stages: [
        { duration: "1m", target: 100 },
        { duration: "30s", target: 10000 },
        { duration: "2m", target: 10000 },
        { duration: "30s", target: 100 },
        { duration: "2m", target: 0 },
      ],
    },
    soak: {
      stages: [
        { duration: "5m", target: 1000 },
        { duration: "4h", target: 1000 },
        { duration: "5m", target: 0 },
      ],
    },
  },

  // Scenario weights (percentage of VUs)
  scenarioWeights: {
    rideBooking: 40,
    foodOrdering: 30,
    deliveryTracking: 15,
    userProfile: 10,
    payments: 5,
  },
};

// Helper functions for config
export function getEnvConfig(env = "staging") {
  return CONFIG.environments[env] || CONFIG.environments.staging;
}

export function getThresholds() {
  return CONFIG.thresholds;
}

export function getLoadProfile(profile = "load") {
  return CONFIG.loadProfiles[profile] || CONFIG.loadProfiles.load;
}

export function generateRandomCoordinate() {
  return {
    lat:
      CONFIG.geoBounds.minLat +
      Math.random() * (CONFIG.geoBounds.maxLat - CONFIG.geoBounds.minLat),
    lng:
      CONFIG.geoBounds.minLng +
      Math.random() * (CONFIG.geoBounds.maxLng - CONFIG.geoBounds.minLng),
  };
}

export function generateTestUser(type = "rider", index) {
  const config =
    type === "driver" ? CONFIG.testUsers.drivers : CONFIG.testUsers.riders;
  return {
    phone: `${config.phonePrefix}${String(index).padStart(5, "0")}`,
    password: config.passwordPattern,
  };
}
