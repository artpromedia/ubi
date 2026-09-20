/**
 * Geospatial Utilities
 *
 * Helpers for geospatial calculations including H3 indexing,
 * distance calculations, and ETA estimation.
 */

// Haversine formula constants
const EARTH_RADIUS_KM = 6371;
const EARTH_RADIUS_M = 6371000;

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Convert radians to degrees
 */
function toDegrees(radians: number): number {
  return radians * (180 / Math.PI);
}

/**
 * Coordinate interface
 */
export interface Coordinate {
  latitude: number;
  longitude: number;
}

/**
 * Bounding box interface
 */
export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * Calculate distance between two points using Haversine formula
 * @param from - Starting coordinate
 * @param to - Ending coordinate
 * @param unit - Return unit ('km' | 'm')
 * @returns Distance in specified unit
 */
export function calculateDistance(
  from: Coordinate,
  to: Coordinate,
  unit: "km" | "m" = "m"
): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLng = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const radius = unit === "km" ? EARTH_RADIUS_KM : EARTH_RADIUS_M;
  return radius * c;
}

/**
 * Calculate bearing between two points
 * @param from - Starting coordinate
 * @param to - Ending coordinate
 * @returns Bearing in degrees (0-360)
 */
export function calculateBearing(from: Coordinate, to: Coordinate): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLng = toRadians(to.longitude - from.longitude);

  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);

  const bearing = toDegrees(Math.atan2(y, x));
  return (bearing + 360) % 360;
}

/**
 * Calculate a point at a given distance and bearing from start
 * @param start - Starting coordinate
 * @param distance - Distance in meters
 * @param bearing - Bearing in degrees
 * @returns New coordinate
 */
export function destinationPoint(
  start: Coordinate,
  distance: number,
  bearing: number
): Coordinate {
  const lat1 = toRadians(start.latitude);
  const lng1 = toRadians(start.longitude);
  const brng = toRadians(bearing);
  const angularDist = distance / EARTH_RADIUS_M;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDist) +
      Math.cos(lat1) * Math.sin(angularDist) * Math.cos(brng)
  );

  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(angularDist) * Math.cos(lat1),
      Math.cos(angularDist) - Math.sin(lat1) * Math.sin(lat2)
    );

  return {
    latitude: toDegrees(lat2),
    longitude: toDegrees(lng2),
  };
}

/**
 * Calculate bounding box around a point
 * @param center - Center coordinate
 * @param radiusMeters - Radius in meters
 * @returns Bounding box
 */
export function getBoundingBox(
  center: Coordinate,
  radiusMeters: number
): BoundingBox {
  const north = destinationPoint(center, radiusMeters, 0);
  const south = destinationPoint(center, radiusMeters, 180);
  const east = destinationPoint(center, radiusMeters, 90);
  const west = destinationPoint(center, radiusMeters, 270);

  return {
    north: north.latitude,
    south: south.latitude,
    east: east.longitude,
    west: west.longitude,
  };
}

/**
 * Check if a point is within a bounding box
 * @param point - Coordinate to check
 * @param box - Bounding box
 * @returns True if point is within box
 */
export function isWithinBoundingBox(
  point: Coordinate,
  box: BoundingBox
): boolean {
  return (
    point.latitude <= box.north &&
    point.latitude >= box.south &&
    point.longitude <= box.east &&
    point.longitude >= box.west
  );
}

/**
 * Check if a point is within radius of another point
 * @param point - Coordinate to check
 * @param center - Center coordinate
 * @param radiusMeters - Radius in meters
 * @returns True if point is within radius
 */
export function isWithinRadius(
  point: Coordinate,
  center: Coordinate,
  radiusMeters: number
): boolean {
  const distance = calculateDistance(point, center, "m");
  return distance <= radiusMeters;
}

/**
 * Average speed assumptions by vehicle type (km/h)
 */
const VEHICLE_SPEEDS: Record<string, number> = {
  ECONOMY: 25, // Traffic-adjusted average
  COMFORT: 25,
  PREMIUM: 25,
  XL: 20,
  MOTO: 30, // Motorcycles can navigate traffic better
  BICYCLE: 15,
  WALK: 5,
};

/**
 * Estimate time to travel a distance
 * @param distanceMeters - Distance in meters
 * @param vehicleType - Type of vehicle
 * @param trafficMultiplier - Traffic adjustment (1.0 = normal, >1 = heavy traffic)
 * @returns Estimated time in seconds
 */
export function estimateTravelTime(
  distanceMeters: number,
  vehicleType: string = "ECONOMY",
  trafficMultiplier: number = 1
): number {
  const speedKmh = VEHICLE_SPEEDS[vehicleType] ?? VEHICLE_SPEEDS.ECONOMY ?? 40;
  const speedMs = (speedKmh * 1000) / 3600; // Convert to m/s
  const adjustedSpeed = speedMs / trafficMultiplier;

  return Math.round(distanceMeters / adjustedSpeed);
}

/**
 * Estimate ETA based on current location and destination
 * @param from - Current location
 * @param to - Destination
 * @param vehicleType - Type of vehicle
 * @param trafficMultiplier - Traffic adjustment
 * @returns Object with distance (m), duration (s), and ETA timestamp
 */
export function estimateETA(
  from: Coordinate,
  to: Coordinate,
  vehicleType: string = "ECONOMY",
  trafficMultiplier: number = 1
): { distance: number; duration: number; eta: Date } {
  const distance = calculateDistance(from, to, "m");
  const duration = estimateTravelTime(distance, vehicleType, trafficMultiplier);
  const eta = new Date(Date.now() + duration * 1000);

  return { distance, duration, eta };
}

/**
 * H3 Utility functions (simplified - use h3-js library for production)
 * Resolution guide:
 * - Resolution 4: ~288km² (country-level)
 * - Resolution 7: ~5km² (city-level)
 * - Resolution 8: ~0.74km² (neighborhood) - Used for driver matching
 * - Resolution 9: ~0.1km² (block-level)
 * - Resolution 10: ~15,000m² (precise)
 */

/**
 * Generate a simple grid cell ID (placeholder for H3)
 * In production, use the h3-js library
 * @param coord - Coordinate
 * @param resolution - Grid resolution (higher = more precise)
 * @returns Grid cell ID string
 */
export function getGridCell(coord: Coordinate, resolution: number = 8): string {
  // This is a simplified implementation
  // In production, use: import { latLngToCell } from 'h3-js';
  const latBucket = Math.floor(coord.latitude * Math.pow(10, resolution - 4));
  const lngBucket = Math.floor(coord.longitude * Math.pow(10, resolution - 4));
  return `${latBucket}:${lngBucket}:${resolution}`;
}

/**
 * Get neighboring grid cells (k-ring)
 * @param cellId - Center cell ID
 * @param k - Ring size (1 = immediate neighbors)
 * @returns Array of cell IDs including center
 */
export function getNeighborCells(cellId: string, k: number = 1): string[] {
  // Simplified implementation - returns center only
  // In production, use: import { gridDisk } from 'h3-js';
  const cells = [cellId];

  const parts = cellId.split(":");
  const latPart = parts[0] ?? "0";
  const lngPart = parts[1] ?? "0";
  const lat = Number.parseInt(latPart);
  const lng = Number.parseInt(lngPart);
  const res = parts[2] ?? "7";

  for (let i = -k; i <= k; i++) {
    for (let j = -k; j <= k; j++) {
      if (i === 0 && j === 0) {continue;}
      cells.push(`${lat + i}:${lng + j}:${res}`);
    }
  }

  return cells;
}

/**
 * Check if two coordinates are in the same grid cell
 * @param coord1 - First coordinate
 * @param coord2 - Second coordinate
 * @param resolution - Grid resolution
 * @returns True if in same cell
 */
export function isSameCell(
  coord1: Coordinate,
  coord2: Coordinate,
  resolution: number = 8
): boolean {
  return getGridCell(coord1, resolution) === getGridCell(coord2, resolution);
}

/**
 * Validate coordinate values
 * @param coord - Coordinate to validate
 * @returns True if valid
 */
export function isValidCoordinate(coord: Coordinate): boolean {
  return (
    typeof coord.latitude === "number" &&
    typeof coord.longitude === "number" &&
    coord.latitude >= -90 &&
    coord.latitude <= 90 &&
    coord.longitude >= -180 &&
    coord.longitude <= 180 &&
    !Number.isNaN(coord.latitude) &&
    !Number.isNaN(coord.longitude)
  );
}

/**
 * African cities with their coordinates
 * Used for geofencing and service area validation
 */
export const AFRICAN_CITIES: Record<string, Coordinate> = {
  // Nigeria
  lagos: { latitude: 6.5244, longitude: 3.3792 },
  abuja: { latitude: 9.0579, longitude: 7.4951 },
  port_harcourt: { latitude: 4.8156, longitude: 7.0498 },

  // Kenya
  nairobi: { latitude: -1.2921, longitude: 36.8219 },
  mombasa: { latitude: -4.0435, longitude: 39.6682 },

  // South Africa
  johannesburg: { latitude: -26.2041, longitude: 28.0473 },
  cape_town: { latitude: -33.9249, longitude: 18.4241 },
  durban: { latitude: -29.8587, longitude: 31.0218 },

  // Ghana
  accra: { latitude: 5.6037, longitude: -0.187 },
  kumasi: { latitude: 6.6885, longitude: -1.6244 },

  // Rwanda
  kigali: { latitude: -1.9403, longitude: 29.8739 },

  // Ethiopia
  addis_ababa: { latitude: 9.032, longitude: 38.7469 },

  // Egypt
  cairo: { latitude: 30.0444, longitude: 31.2357 },
  alexandria: { latitude: 31.2001, longitude: 29.9187 },

  // Morocco
  casablanca: { latitude: 33.5731, longitude: -7.5898 },
  marrakech: { latitude: 31.6295, longitude: -7.9811 },
};

/**
 * Check if coordinate is within a supported city
 * @param coord - Coordinate to check
 * @param cityRadiusKm - Radius around city center (default 50km)
 * @returns City name if within, null otherwise
 */
export function getSupportedCity(
  coord: Coordinate,
  cityRadiusKm: number = 50
): string | null {
  for (const [cityName, cityCoord] of Object.entries(AFRICAN_CITIES)) {
    const distance = calculateDistance(coord, cityCoord, "km");
    if (distance <= cityRadiusKm) {
      return cityName;
    }
  }
  return null;
}
