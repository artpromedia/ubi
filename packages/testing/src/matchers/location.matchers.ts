/**
 * Location & Geography Matchers
 *
 * Custom matchers for validating locations, coordinates, and distances.
 */

import { AFRICAN_CITIES, GEOFENCE_AREAS } from "../fixtures/locations.fixture";

interface LocationMatchers<R = unknown> {
  toBeValidCoordinates(): R;
  toBeWithinRadius(
    center: { latitude: number; longitude: number },
    radiusKm: number,
  ): R;
  toBeInCity(city: string): R;
  toBeInOperationalArea(areaName: string): R;
  toBeValidAfricanPhoneNumber(): R;
}

declare module "vitest" {
  interface Assertion<T = unknown> extends LocationMatchers<T> {}
  interface AsymmetricMatchersContaining extends LocationMatchers {}
}

/**
 * Calculate distance between two points using Haversine formula
 */
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Check if value contains valid coordinates
 */
export function toBeValidCoordinates(received: unknown) {
  const location = received as { latitude?: number; longitude?: number };

  const pass =
    location &&
    typeof location === "object" &&
    typeof location.latitude === "number" &&
    typeof location.longitude === "number" &&
    location.latitude >= -90 &&
    location.latitude <= 90 &&
    location.longitude >= -180 &&
    location.longitude <= 180 &&
    !isNaN(location.latitude) &&
    !isNaN(location.longitude);

  return {
    pass,
    message: () =>
      pass
        ? `Expected ${JSON.stringify(received)} not to be valid coordinates`
        : `Expected valid coordinates { latitude: -90 to 90, longitude: -180 to 180 }, but got ${JSON.stringify(received)}`,
  };
}

/**
 * Check if location is within specified radius of center point
 */
export function toBeWithinRadius(
  received: unknown,
  center: { latitude: number; longitude: number },
  radiusKm: number,
) {
  const location = received as { latitude: number; longitude: number };

  if (
    !location ||
    typeof location.latitude !== "number" ||
    typeof location.longitude !== "number"
  ) {
    return {
      pass: false,
      message: () =>
        `Expected valid location object with latitude and longitude`,
    };
  }

  const distance = calculateDistance(
    location.latitude,
    location.longitude,
    center.latitude,
    center.longitude,
  );

  const pass = distance <= radiusKm;

  return {
    pass,
    message: () =>
      pass
        ? `Expected location not to be within ${radiusKm}km of center`
        : `Expected location to be within ${radiusKm}km of center, but was ${distance.toFixed(2)}km away`,
  };
}

/**
 * Check if location is within a city's approximate bounds
 */
export function toBeInCity(received: unknown, city: string) {
  const location = received as { latitude: number; longitude: number };
  const cityLower = city.toLowerCase();
  const cityData = AFRICAN_CITIES[cityLower as keyof typeof AFRICAN_CITIES];

  if (!cityData) {
    return {
      pass: false,
      message: () =>
        `Unknown city: ${city}. Available cities: ${Object.keys(AFRICAN_CITIES).join(", ")}`,
    };
  }

  if (
    !location ||
    typeof location.latitude !== "number" ||
    typeof location.longitude !== "number"
  ) {
    return {
      pass: false,
      message: () =>
        `Expected valid location object with latitude and longitude`,
    };
  }

  // Approximate city radius of 50km
  const distance = calculateDistance(
    location.latitude,
    location.longitude,
    cityData.latitude,
    cityData.longitude,
  );

  const pass = distance <= 50;

  return {
    pass,
    message: () =>
      pass
        ? `Expected location not to be in ${city}`
        : `Expected location to be in ${city} (within 50km of center), but was ${distance.toFixed(2)}km away`,
  };
}

/**
 * Check if location is within an operational area
 */
export function toBeInOperationalArea(received: unknown, areaName: string) {
  const location = received as { latitude: number; longitude: number };
  const area = GEOFENCE_AREAS[areaName as keyof typeof GEOFENCE_AREAS];

  if (!area) {
    return {
      pass: false,
      message: () =>
        `Unknown operational area: ${areaName}. Available: ${Object.keys(GEOFENCE_AREAS).join(", ")}`,
    };
  }

  if (
    !location ||
    typeof location.latitude !== "number" ||
    typeof location.longitude !== "number"
  ) {
    return {
      pass: false,
      message: () =>
        `Expected valid location object with latitude and longitude`,
    };
  }

  const distance = calculateDistance(
    location.latitude,
    location.longitude,
    area.center.latitude,
    area.center.longitude,
  );

  const pass = distance <= area.radiusKm;

  return {
    pass,
    message: () =>
      pass
        ? `Expected location not to be in ${area.name}`
        : `Expected location to be in ${area.name} (within ${area.radiusKm}km), but was ${distance.toFixed(2)}km away`,
  };
}

/**
 * Check if string is a valid African phone number
 */
export function toBeValidAfricanPhoneNumber(received: unknown) {
  const phone = received as string;

  if (typeof phone !== "string") {
    return {
      pass: false,
      message: () => `Expected string, got ${typeof phone}`,
    };
  }

  // African phone number patterns
  const patterns = [
    /^\+234[0-9]{10}$/, // Nigeria
    /^\+254[0-9]{9}$/, // Kenya
    /^\+233[0-9]{9}$/, // Ghana
    /^\+27[0-9]{9}$/, // South Africa
    /^\+250[0-9]{9}$/, // Rwanda
    /^\+251[0-9]{9}$/, // Ethiopia
    /^\+255[0-9]{9}$/, // Tanzania
    /^\+256[0-9]{9}$/, // Uganda
    /^\+20[0-9]{10}$/, // Egypt
  ];

  const pass = patterns.some((pattern) => pattern.test(phone));

  return {
    pass,
    message: () =>
      pass
        ? `Expected ${phone} not to be a valid African phone number`
        : `Expected ${phone} to be a valid African phone number (e.g., +234XXXXXXXXXX for Nigeria)`,
  };
}

/**
 * Location matchers object for extending expect
 */
export const locationMatchers = {
  toBeValidCoordinates,
  toBeWithinRadius,
  toBeInCity,
  toBeInOperationalArea,
  toBeValidAfricanPhoneNumber,
};
