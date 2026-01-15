/**
 * Ride Factory
 *
 * Creates test rides with realistic data for ride-hailing scenarios.
 */

import { faker } from "@faker-js/faker";
import type { TestDriver, TestRide, TestRider, TestRideStatus } from "../types";
import { randomPick, uuid } from "../utils";
import {
  calculateDistance,
  calculateEstimatedDuration,
  createRideLocations,
} from "./location.factory";
import { createDriver, createRider } from "./user.factory";

const RIDE_TYPES = [
  "economy",
  "comfort",
  "premium",
  "motorcycle",
  "tuktuk",
] as const;
type RideType = (typeof RIDE_TYPES)[number];

const CANCELLATION_REASONS = {
  rider: [
    "Changed my mind",
    "Driver too far",
    "Found alternative transport",
    "Entered wrong destination",
    "Driver not moving",
  ],
  driver: [
    "Rider not at pickup",
    "Rider requested cancellation",
    "Vehicle issue",
    "Emergency",
    "Cannot reach destination",
  ],
};

interface RideFactoryOptions {
  status?: TestRideStatus;
  rideType?: RideType;
  city?: string;
  currency?: string;
  driver?: TestDriver;
  rider?: TestRider;
  includeSurge?: boolean;
}

/**
 * Calculate ride price based on distance and type
 */
function calculateRidePrice(
  distanceKm: number,
  rideType: RideType,
  currency: string,
  hasSurge: boolean = false,
): {
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  surge: number;
  total: number;
} {
  // Base fares and per-km rates by ride type (in local currency units)
  const pricing: Record<
    RideType,
    { base: number; perKm: number; perMin: number }
  > = {
    economy: { base: 300, perKm: 80, perMin: 15 },
    comfort: { base: 500, perKm: 120, perMin: 20 },
    premium: { base: 800, perKm: 180, perMin: 30 },
    motorcycle: { base: 150, perKm: 40, perMin: 8 },
    tuktuk: { base: 200, perKm: 50, perMin: 10 },
  };

  // Currency multipliers (to make amounts realistic)
  const currencyMultipliers: Record<string, number> = {
    NGN: 1,
    KES: 0.3,
    GHS: 0.02,
    ZAR: 0.05,
    UGX: 10,
    TZS: 7,
  };

  const multiplier = currencyMultipliers[currency] || 1;
  const rates = pricing[rideType];
  const duration = calculateEstimatedDuration(distanceKm);

  const baseFare = Math.round(rates.base * multiplier);
  const distanceFare = Math.round(distanceKm * rates.perKm * multiplier);
  const timeFare = Math.round(duration * rates.perMin * multiplier);
  const subtotal = baseFare + distanceFare + timeFare;
  const surgeMultiplier = hasSurge
    ? faker.number.float({ min: 1.2, max: 2.5, multipleOf: 0.1 })
    : 1;
  const surge = Math.round(subtotal * (surgeMultiplier - 1));
  const total = subtotal + surge;

  return { baseFare, distanceFare, timeFare, surge, total };
}

/**
 * Create a test ride
 */
export function createRide(options: RideFactoryOptions = {}): TestRide {
  const {
    status = "completed",
    rideType = randomPick([...RIDE_TYPES]),
    city = "lagos",
    currency = "NGN",
    driver = createDriver({ country: "NG" }),
    rider = createRider({ country: "NG" }),
    includeSurge = false,
  } = options;

  const { pickup, dropoff } = createRideLocations({ city: city as any });
  const distance = calculateDistance(pickup, dropoff);
  const estimatedDuration = calculateEstimatedDuration(distance);
  const pricing = calculateRidePrice(
    distance,
    rideType,
    currency,
    includeSurge,
  );

  const rideId = uuid();
  const now = new Date();

  // Base ride object
  const ride: TestRide = {
    id: rideId,
    riderId: rider.id,
    driverId: driver.id,
    status,
    rideType,
    pickup,
    dropoff,
    distance: Math.round(distance * 100) / 100, // Round to 2 decimal places
    estimatedDuration,
    pricing: {
      currency,
      baseFare: pricing.baseFare,
      distanceFare: pricing.distanceFare,
      timeFare: pricing.timeFare,
      surge: pricing.surge,
      total: pricing.total,
      paymentMethod: rider.preferredPaymentMethod || "mobile_money",
    },
    createdAt: faker.date.past(),
    updatedAt: now,
  };

  // Add status-specific fields
  switch (status) {
    case "searching":
      ride.searchStartedAt = now;
      break;

    case "driver_assigned":
      ride.searchStartedAt = faker.date.recent();
      ride.driverAssignedAt = now;
      ride.driverLocation = {
        latitude: pickup.latitude + (Math.random() - 0.5) * 0.02,
        longitude: pickup.longitude + (Math.random() - 0.5) * 0.02,
      };
      ride.estimatedArrival = faker.number.int({ min: 3, max: 15 });
      break;

    case "driver_arrived":
      ride.searchStartedAt = faker.date.recent();
      ride.driverAssignedAt = faker.date.recent();
      ride.driverArrivedAt = now;
      ride.driverLocation = { ...pickup };
      break;

    case "in_progress":
      ride.searchStartedAt = faker.date.recent();
      ride.driverAssignedAt = faker.date.recent();
      ride.driverArrivedAt = faker.date.recent();
      ride.rideStartedAt = now;
      ride.driverLocation = {
        latitude: pickup.latitude + (dropoff.latitude - pickup.latitude) * 0.3,
        longitude:
          pickup.longitude + (dropoff.longitude - pickup.longitude) * 0.3,
      };
      break;

    case "completed":
      const startTime = faker.date.past();
      ride.searchStartedAt = startTime;
      ride.driverAssignedAt = new Date(startTime.getTime() + 60000);
      ride.driverArrivedAt = new Date(startTime.getTime() + 300000);
      ride.rideStartedAt = new Date(startTime.getTime() + 360000);
      ride.rideCompletedAt = new Date(
        startTime.getTime() + 360000 + estimatedDuration * 60000,
      );
      ride.actualDuration =
        estimatedDuration + faker.number.int({ min: -5, max: 10 });
      ride.rating = {
        riderRating: faker.number.float({ min: 4, max: 5, multipleOf: 0.5 }),
        driverRating: faker.number.float({ min: 4, max: 5, multipleOf: 0.5 }),
        riderComment: randomPick([
          undefined,
          "Great ride!",
          "On time",
          "Very professional",
        ]),
        driverComment: randomPick([
          undefined,
          "Nice passenger",
          "Polite",
          undefined,
        ]),
      };
      break;

    case "cancelled":
      ride.searchStartedAt = faker.date.recent();
      ride.cancelledAt = now;
      ride.cancelledBy = randomPick(["rider", "driver", "system"]);
      ride.cancellationReason =
        ride.cancelledBy === "rider"
          ? randomPick(CANCELLATION_REASONS.rider)
          : ride.cancelledBy === "driver"
            ? randomPick(CANCELLATION_REASONS.driver)
            : "No drivers available";
      break;
  }

  return ride;
}

/**
 * Create a scheduled ride (future ride)
 */
export function createScheduledRide(
  scheduledTime: Date,
  options: Omit<RideFactoryOptions, "status"> = {},
): TestRide {
  const ride = createRide({
    ...options,
    status: "scheduled" as TestRideStatus,
  });
  ride.scheduledAt = scheduledTime;
  return ride;
}

/**
 * Create multiple rides
 */
export function createRides(
  count: number,
  options?: RideFactoryOptions,
): TestRide[] {
  return Array.from({ length: count }, () => createRide(options));
}

/**
 * Create a ride with a specific scenario
 */
export function createRideScenario(
  scenario: "long_distance" | "short_trip" | "surge" | "airport" | "late_night",
): TestRide {
  switch (scenario) {
    case "long_distance":
      return createRide({ rideType: "comfort", includeSurge: false });

    case "short_trip":
      return createRide({ rideType: "motorcycle" });

    case "surge":
      return createRide({ includeSurge: true });

    case "airport":
      const airportRide = createRide({ rideType: "premium" });
      airportRide.dropoff.address = "International Airport, Arrivals";
      return airportRide;

    case "late_night":
      const lateRide = createRide({ includeSurge: true });
      const lateTime = new Date();
      lateTime.setHours(2, 30, 0, 0);
      lateRide.createdAt = lateTime;
      return lateRide;

    default:
      return createRide();
  }
}

/**
 * Create a ride history for a rider
 */
export function createRideHistory(
  riderId: string,
  count: number = 10,
): TestRide[] {
  return Array.from({ length: count }, (_, i) => {
    const ride = createRide({ status: randomPick(["completed", "cancelled"]) });
    ride.riderId = riderId;
    ride.createdAt = new Date(Date.now() - i * 24 * 60 * 60 * 1000); // Each ride 1 day apart
    return ride;
  });
}
