/**
 * Ride type constants for UBI
 */

export const RideType = {
  STANDARD: "STANDARD",
  PREMIUM: "PREMIUM",
  XL: "XL",
  BODA: "BODA",
  TUKTUK: "TUKTUK",
  SHARED: "SHARED",
} as const;

export type RideTypeValue = (typeof RideType)[keyof typeof RideType];

/**
 * Ride type configuration
 */
export interface RideTypeConfig {
  type: RideTypeValue;
  name: string;
  description: string;
  maxPassengers: number;
  baseFare: number;
  perKmRate: number;
  perMinuteRate: number;
  icon: string;
}

export const RIDE_TYPE_CONFIG: Record<RideTypeValue, RideTypeConfig> = {
  STANDARD: {
    type: "STANDARD",
    name: "UBI Standard",
    description: "Affordable everyday rides",
    maxPassengers: 4,
    baseFare: 100,
    perKmRate: 30,
    perMinuteRate: 5,
    icon: "car",
  },
  PREMIUM: {
    type: "PREMIUM",
    name: "UBI Premium",
    description: "High-end vehicles for a comfortable ride",
    maxPassengers: 4,
    baseFare: 200,
    perKmRate: 50,
    perMinuteRate: 8,
    icon: "car-premium",
  },
  XL: {
    type: "XL",
    name: "UBI XL",
    description: "Larger vehicles for groups",
    maxPassengers: 7,
    baseFare: 150,
    perKmRate: 40,
    perMinuteRate: 6,
    icon: "car-xl",
  },
  BODA: {
    type: "BODA",
    name: "UBI Boda",
    description: "Motorcycle taxis for quick trips",
    maxPassengers: 1,
    baseFare: 50,
    perKmRate: 15,
    perMinuteRate: 3,
    icon: "motorcycle",
  },
  TUKTUK: {
    type: "TUKTUK",
    name: "UBI TukTuk",
    description: "Three-wheeler rides",
    maxPassengers: 3,
    baseFare: 75,
    perKmRate: 20,
    perMinuteRate: 4,
    icon: "tuktuk",
  },
  SHARED: {
    type: "SHARED",
    name: "UBI Share",
    description: "Share your ride and save",
    maxPassengers: 4,
    baseFare: 60,
    perKmRate: 20,
    perMinuteRate: 3,
    icon: "car-share",
  },
};

/**
 * Get ride type configuration
 */
export function getRideTypeConfig(type: RideTypeValue): RideTypeConfig {
  return RIDE_TYPE_CONFIG[type];
}

/**
 * Get all available ride types
 */
export function getAvailableRideTypes(): RideTypeConfig[] {
  return Object.values(RIDE_TYPE_CONFIG);
}

/**
 * Calculate estimated fare
 */
export function calculateEstimatedFare(
  type: RideTypeValue,
  distanceKm: number,
  durationMinutes: number,
  surgeMultiplier = 1,
): number {
  const config = RIDE_TYPE_CONFIG[type];
  const fare =
    config.baseFare +
    config.perKmRate * distanceKm +
    config.perMinuteRate * durationMinutes;
  return Math.round(fare * surgeMultiplier);
}
