/**
 * Testing utility functions
 */

import type { NetworkProfile, TestConfig } from "./types";

// =============================================================================
// Wait Utilities
// =============================================================================

/**
 * Wait for a specified amount of time
 */
export async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 5000, interval = 100 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await wait(interval);
  }

  throw new Error(`waitFor timed out after ${timeout}ms`);
}

/**
 * Retry a function until it succeeds or times out
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; delay?: number; backoff?: number } = {}
): Promise<T> {
  const { maxAttempts = 3, delay = 1000, backoff = 2 } = options;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts) {
        await wait(delay * Math.pow(backoff, attempt - 1));
      }
    }
  }

  throw lastError;
}

// =============================================================================
// Network Simulation
// =============================================================================

/**
 * Predefined network profiles for testing African mobile conditions
 */
export const NETWORK_PROFILES: Record<string, NetworkProfile> = {
  // Standard connections
  "2G_EDGE": {
    name: "2G EDGE",
    downloadThroughput: 50_000, // 50 KB/s
    uploadThroughput: 20_000, // 20 KB/s
    latency: 500, // 500ms
  },
  "3G": {
    name: "3G",
    downloadThroughput: 500_000, // 500 KB/s
    uploadThroughput: 100_000, // 100 KB/s
    latency: 200, // 200ms
  },
  "4G_LTE": {
    name: "4G LTE",
    downloadThroughput: 4_000_000, // 4 MB/s
    uploadThroughput: 1_000_000, // 1 MB/s
    latency: 50, // 50ms
  },
  WIFI: {
    name: "WiFi",
    downloadThroughput: 10_000_000, // 10 MB/s
    uploadThroughput: 5_000_000, // 5 MB/s
    latency: 20, // 20ms
  },

  // Degraded conditions
  HIGH_LATENCY: {
    name: "High Latency",
    downloadThroughput: 1_000_000,
    uploadThroughput: 500_000,
    latency: 1000, // 1 second
  },
  PACKET_LOSS: {
    name: "Packet Loss",
    downloadThroughput: 1_000_000,
    uploadThroughput: 500_000,
    latency: 100,
    packetLoss: 10, // 10%
  },
  SLOW_3G: {
    name: "Slow 3G",
    downloadThroughput: 200_000,
    uploadThroughput: 50_000,
    latency: 400,
  },
};

/**
 * Simulate network delay
 */
export async function simulateNetworkDelay(
  profile: NetworkProfile
): Promise<void> {
  return wait(profile.latency);
}

// =============================================================================
// Test Configuration
// =============================================================================

/**
 * Get test configuration from environment
 */
export function getTestConfig(): TestConfig {
  return {
    apiBaseUrl: process.env.TEST_API_URL || "http://localhost:3000",
    useRealServices: process.env.TEST_USE_REAL_SERVICES === "true",
    timeout: Number.parseInt(process.env.TEST_TIMEOUT || "5000", 10),
    databaseUrl: process.env.TEST_DATABASE_URL,
    redisUrl: process.env.TEST_REDIS_URL,
  };
}

// =============================================================================
// Date Utilities
// =============================================================================

/**
 * Create a date relative to now
 */
export function relativeDate(
  offset: number,
  unit: "days" | "hours" | "minutes" | "seconds" = "days"
): Date {
  const date = new Date();
  const multipliers = {
    days: 24 * 60 * 60 * 1000,
    hours: 60 * 60 * 1000,
    minutes: 60 * 1000,
    seconds: 1000,
  };
  date.setTime(date.getTime() + offset * multipliers[unit]);
  return date;
}

/**
 * Freeze time for deterministic tests
 */
export function freezeTime(date: Date = new Date()): () => void {
  const originalNow = Date.now;
  const originalDate = globalThis.Date;

  const frozenTime = date.getTime();

  // @ts-expect-error - Overriding Date
  globalThis.Date = class extends originalDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super(frozenTime);
      } else {
        // @ts-expect-error - Spread arguments
        super(...args);
      }
    }

    static override now(): number {
      return frozenTime;
    }
  };

  return () => {
    globalThis.Date = originalDate;
    Date.now = originalNow;
  };
}

// =============================================================================
// Random Data Utilities
// =============================================================================

/**
 * Generate a random string of specified length
 */
export function randomString(length: number = 10): string {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a random integer between min and max (inclusive)
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Pick a random item from an array
 */
export function randomPick<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)] as T;
}

/**
 * Generate a UUID v4
 */
export function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replaceAll(/[xy]/g, (c) => {
    const r = Math.trunc(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// =============================================================================
// Assertion Utilities
// =============================================================================

/**
 * Assert that a value is defined (not null or undefined)
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message?: string
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message || "Expected value to be defined");
  }
}

/**
 * Assert that a condition is true
 */
export function assert(
  condition: boolean,
  message?: string
): asserts condition {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

// =============================================================================
// African Market Utilities
// =============================================================================

/**
 * African country phone number formats
 */
export const PHONE_FORMATS: Record<string, { code: string; format: string }> = {
  NG: { code: "+234", format: "XXXXXXXXXX" }, // Nigeria
  KE: { code: "+254", format: "XXXXXXXXX" }, // Kenya
  GH: { code: "+233", format: "XXXXXXXXX" }, // Ghana
  ZA: { code: "+27", format: "XXXXXXXXX" }, // South Africa
  RW: { code: "+250", format: "XXXXXXXXX" }, // Rwanda
  ET: { code: "+251", format: "XXXXXXXXX" }, // Ethiopia
  TZ: { code: "+255", format: "XXXXXXXXX" }, // Tanzania
  UG: { code: "+256", format: "XXXXXXXXX" }, // Uganda
};

/**
 * African city coordinates for location testing
 * @internal - Use AFRICAN_CITIES from fixtures/locations.fixture.ts instead
 */
const CITY_COORDS: Record<
  string,
  { latitude: number; longitude: number; name: string; country: string }
> = {
  lagos: {
    latitude: 6.5244,
    longitude: 3.3792,
    name: "Lagos",
    country: "Nigeria",
  },
  nairobi: {
    latitude: -1.2921,
    longitude: 36.8219,
    name: "Nairobi",
    country: "Kenya",
  },
  accra: {
    latitude: 5.6037,
    longitude: -0.187,
    name: "Accra",
    country: "Ghana",
  },
  johannesburg: {
    latitude: -26.2041,
    longitude: 28.0473,
    name: "Johannesburg",
    country: "South Africa",
  },
  capetown: {
    latitude: -33.9249,
    longitude: 18.4241,
    name: "Cape Town",
    country: "South Africa",
  },
  kigali: {
    latitude: -1.9403,
    longitude: 29.8739,
    name: "Kigali",
    country: "Rwanda",
  },
  addisababa: {
    latitude: 9.0054,
    longitude: 38.7636,
    name: "Addis Ababa",
    country: "Ethiopia",
  },
  daressalaam: {
    latitude: -6.7924,
    longitude: 39.2083,
    name: "Dar es Salaam",
    country: "Tanzania",
  },
  kampala: {
    latitude: 0.3476,
    longitude: 32.5825,
    name: "Kampala",
    country: "Uganda",
  },
  cairo: {
    latitude: 30.0444,
    longitude: 31.2357,
    name: "Cairo",
    country: "Egypt",
  },
};

/**
 * Generate a random location within a city's bounds
 */
export function randomLocationInCity(
  city: keyof typeof CITY_COORDS,
  radiusKm: number = 10
): { latitude: number; longitude: number } {
  const cityData = CITY_COORDS[city];
  if (!cityData) {
    throw new Error(`Unknown city: ${city}`);
  }

  // Approximate degrees per km at the equator
  const kmPerDegree = 111;
  const latOffset = (Math.random() - 0.5) * 2 * (radiusKm / kmPerDegree);
  const lngOffset = (Math.random() - 0.5) * 2 * (radiusKm / kmPerDegree);

  return {
    latitude: cityData.latitude + latOffset,
    longitude: cityData.longitude + lngOffset,
  };
}

// =============================================================================
// Currency Utilities
// =============================================================================

/**
 * African currency codes and symbols
 */
export const CURRENCIES: Record<
  string,
  { code: string; symbol: string; name: string }
> = {
  NGN: { code: "NGN", symbol: "₦", name: "Nigerian Naira" },
  KES: { code: "KES", symbol: "KSh", name: "Kenyan Shilling" },
  GHS: { code: "GHS", symbol: "GH₵", name: "Ghanaian Cedi" },
  ZAR: { code: "ZAR", symbol: "R", name: "South African Rand" },
  RWF: { code: "RWF", symbol: "FRw", name: "Rwandan Franc" },
  ETB: { code: "ETB", symbol: "Br", name: "Ethiopian Birr" },
  TZS: { code: "TZS", symbol: "TSh", name: "Tanzanian Shilling" },
  UGX: { code: "UGX", symbol: "USh", name: "Ugandan Shilling" },
  USD: { code: "USD", symbol: "$", name: "US Dollar" },
};
