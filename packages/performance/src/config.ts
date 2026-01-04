/**
 * k6 Configuration Module
 *
 * Centralized configuration for performance tests including:
 * - Environment URLs
 * - Thresholds
 * - Network profiles
 * - African market simulation
 */

import { Options } from "k6/options";

// Environment URLs
export const ENVIRONMENTS = {
  local: {
    apiGateway: "http://localhost:3000",
    userService: "http://localhost:3001",
    rideService: "http://localhost:3002",
    foodService: "http://localhost:3003",
    paymentService: "http://localhost:3004",
  },
  staging: {
    apiGateway: "https://api-staging.ubi.com",
    userService: "https://user-staging.ubi.com",
    rideService: "https://ride-staging.ubi.com",
    foodService: "https://food-staging.ubi.com",
    paymentService: "https://payment-staging.ubi.com",
  },
  production: {
    apiGateway: "https://api.ubi.com",
    userService: "https://user.ubi.com",
    rideService: "https://ride.ubi.com",
    foodService: "https://food.ubi.com",
    paymentService: "https://payment.ubi.com",
  },
};

export function getEnv(): keyof typeof ENVIRONMENTS {
  const env = __ENV.K6_ENV || "local";
  return env as keyof typeof ENVIRONMENTS;
}

export function getBaseUrl(service: keyof typeof ENVIRONMENTS.local): string {
  return ENVIRONMENTS[getEnv()][service];
}

// Standard SLO thresholds for African markets
export const SLO_THRESHOLDS = {
  // Response times (accounting for variable network)
  http_req_duration: {
    // 95% of requests under 2s (accounting for network latency)
    p95: 2000,
    // 99% under 5s
    p99: 5000,
    // Average under 1s
    avg: 1000,
  },
  // Error rates
  http_req_failed: {
    // Less than 1% error rate
    rate: 0.01,
  },
  // Throughput
  http_reqs: {
    // Minimum requests per second
    rate: 100,
  },
};

// Common k6 options with African market considerations
export const baseOptions: Partial<Options> = {
  thresholds: {
    http_req_duration: ["p(95)<2000", "p(99)<5000", "avg<1000"],
    http_req_failed: ["rate<0.01"],
    http_reqs: ["rate>100"],
  },
  noConnectionReuse: false,
  userAgent: "k6-ubi-performance-test/1.0",
  insecureSkipTLSVerify: true,
  discardResponseBodies: false,
};

// Network profiles simulating African conditions
export const NETWORK_PROFILES = {
  // Good 4G LTE connection
  "4G_LTE": {
    latency: 50, // ms
    jitter: 10, // ms
    packetLoss: 0.01, // 1%
  },
  // Typical 3G connection
  "3G": {
    latency: 200,
    jitter: 50,
    packetLoss: 0.02,
  },
  // Poor 2G EDGE connection (rural areas)
  "2G_EDGE": {
    latency: 500,
    jitter: 100,
    packetLoss: 0.05,
  },
  // Congested network (peak hours)
  CONGESTED: {
    latency: 1000,
    jitter: 200,
    packetLoss: 0.1,
  },
};

// Traffic patterns for different times of day
export const TRAFFIC_PATTERNS = {
  // Morning rush (7am-9am)
  morningRush: {
    rampUpTime: "5m",
    peakDuration: "30m",
    rampDownTime: "5m",
    vus: 500,
  },
  // Evening rush (5pm-8pm)
  eveningRush: {
    rampUpTime: "10m",
    peakDuration: "45m",
    rampDownTime: "10m",
    vus: 800,
  },
  // Weekend surge
  weekendSurge: {
    rampUpTime: "15m",
    peakDuration: "2h",
    rampDownTime: "15m",
    vus: 1000,
  },
  // Night (low traffic)
  nightTime: {
    rampUpTime: "5m",
    peakDuration: "1h",
    rampDownTime: "5m",
    vus: 50,
  },
};

// Geographic distribution of users
export const GEO_DISTRIBUTION = {
  nigeria: {
    weight: 0.4, // 40% of traffic
    cities: ["lagos", "abuja", "port-harcourt", "kano"],
  },
  kenya: {
    weight: 0.25, // 25% of traffic
    cities: ["nairobi", "mombasa", "kisumu"],
  },
  southAfrica: {
    weight: 0.15, // 15% of traffic
    cities: ["johannesburg", "cape-town", "durban"],
  },
  ghana: {
    weight: 0.1, // 10% of traffic
    cities: ["accra", "kumasi"],
  },
  other: {
    weight: 0.1, // 10% of traffic
    cities: ["cairo", "casablanca", "dakar"],
  },
};

// Service-specific thresholds
export const SERVICE_THRESHOLDS = {
  // Authentication - must be fast
  auth: {
    p95: 500,
    p99: 1000,
    avg: 200,
  },
  // Ride matching - critical path
  rideMatching: {
    p95: 3000,
    p99: 5000,
    avg: 1500,
  },
  // Payment - must be reliable
  payment: {
    p95: 2000,
    p99: 4000,
    avg: 1000,
    errorRate: 0.001, // 0.1% max
  },
  // Food ordering
  foodOrdering: {
    p95: 2000,
    p99: 3000,
    avg: 1000,
  },
  // Notifications
  notifications: {
    p95: 500,
    p99: 1000,
    avg: 200,
  },
};

// Test data generators
export function generatePhoneNumber(country: string = "nigeria"): string {
  const prefixes: Record<string, string[]> = {
    nigeria: ["+234803", "+234805", "+234807", "+234809"],
    kenya: ["+254720", "+254721", "+254722", "+254723"],
    southAfrica: ["+2782", "+2783", "+2784"],
    ghana: ["+23324", "+23326", "+23327"],
  };

  const prefix = prefixes[country]?.[Math.floor(Math.random() * prefixes[country].length)] || "+234803";
  const suffix = Math.floor(Math.random() * 10000000)
    .toString()
    .padStart(7, "0");

  return prefix + suffix;
}

export function generateLocation(city: string = "lagos"): { lat: number; lng: number } {
  const cities: Record<string, { lat: number; lng: number; radius: number }> = {
    lagos: { lat: 6.5244, lng: 3.3792, radius: 0.1 },
    nairobi: { lat: -1.2921, lng: 36.8219, radius: 0.08 },
    johannesburg: { lat: -26.2041, lng: 28.0473, radius: 0.1 },
    accra: { lat: 5.6037, lng: -0.187, radius: 0.05 },
    cairo: { lat: 30.0444, lng: 31.2357, radius: 0.1 },
  };

  const cityData = cities[city] || cities.lagos;
  const randomOffset = () => (Math.random() - 0.5) * 2 * cityData.radius;

  return {
    lat: cityData.lat + randomOffset(),
    lng: cityData.lng + randomOffset(),
  };
}

// Weighted random selection
export function weightedRandom<T>(items: Array<{ item: T; weight: number }>): T {
  const totalWeight = items.reduce((sum, { weight }) => sum + weight, 0);
  let random = Math.random() * totalWeight;

  for (const { item, weight } of items) {
    random -= weight;
    if (random <= 0) return item;
  }

  return items[0].item;
}

// Sleep with jitter (simulate realistic user behavior)
export function sleepWithJitter(baseMs: number, jitterPercent: number = 20): number {
  const jitter = baseMs * (jitterPercent / 100);
  return baseMs + (Math.random() - 0.5) * 2 * jitter;
}
