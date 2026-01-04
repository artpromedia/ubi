/**
 * Ride Fixtures
 *
 * Pre-defined test rides for common scenarios.
 */

import type { TestRide } from "../types";
import {
  LAGOS_LOCATIONS,
  NAIROBI_LOCATIONS,
  RIDE_ROUTES,
} from "./locations.fixture";
import { TEST_DRIVERS, TEST_RIDERS } from "./users.fixture";

/**
 * Completed ride fixture
 */
export const COMPLETED_RIDE: TestRide = {
  id: "ride_completed_001",
  riderId: TEST_RIDERS.ADAOBI_RIDER.id,
  driverId: TEST_DRIVERS.EMEKA_DRIVER.id,
  status: "completed",
  rideType: "economy",
  pickup: LAGOS_LOCATIONS.VICTORIA_ISLAND,
  dropoff: LAGOS_LOCATIONS.IKEJA,
  distance: 15.2,
  estimatedDuration: 45,
  actualDuration: 52,
  pricing: {
    currency: "NGN",
    baseFare: 300,
    distanceFare: 1216,
    timeFare: 780,
    surge: 0,
    total: 2296,
    paymentMethod: "mobile_money",
  },
  searchStartedAt: new Date("2024-06-01T10:00:00Z"),
  driverAssignedAt: new Date("2024-06-01T10:02:00Z"),
  driverArrivedAt: new Date("2024-06-01T10:08:00Z"),
  rideStartedAt: new Date("2024-06-01T10:10:00Z"),
  rideCompletedAt: new Date("2024-06-01T11:02:00Z"),
  rating: {
    riderRating: 5,
    driverRating: 5,
    riderComment: "Great ride, very professional!",
    driverComment: "Nice passenger",
  },
  createdAt: new Date("2024-06-01T10:00:00Z"),
  updatedAt: new Date("2024-06-01T11:02:00Z"),
};

/**
 * In-progress ride fixture
 */
export const IN_PROGRESS_RIDE: TestRide = {
  id: "ride_in_progress_001",
  riderId: TEST_RIDERS.NJERI_RIDER.id,
  driverId: TEST_DRIVERS.KAMAU_BODA.id,
  status: "in_progress",
  rideType: "motorcycle",
  pickup: NAIROBI_LOCATIONS.KILIMANI,
  dropoff: NAIROBI_LOCATIONS.WESTLANDS,
  distance: 4.1,
  estimatedDuration: 15,
  pricing: {
    currency: "KES",
    baseFare: 50,
    distanceFare: 164,
    timeFare: 120,
    surge: 0,
    total: 334,
    paymentMethod: "mobile_money",
  },
  searchStartedAt: new Date("2024-06-01T14:00:00Z"),
  driverAssignedAt: new Date("2024-06-01T14:01:30Z"),
  driverArrivedAt: new Date("2024-06-01T14:05:00Z"),
  rideStartedAt: new Date("2024-06-01T14:06:00Z"),
  driverLocation: {
    latitude: -1.275,
    longitude: 36.793,
  },
  createdAt: new Date("2024-06-01T14:00:00Z"),
  updatedAt: new Date("2024-06-01T14:10:00Z"),
};

/**
 * Searching for driver ride fixture
 */
export const SEARCHING_RIDE: TestRide = {
  id: "ride_searching_001",
  riderId: TEST_RIDERS.ADAOBI_RIDER.id,
  status: "searching",
  rideType: "economy",
  pickup: LAGOS_LOCATIONS.LEKKI,
  dropoff: LAGOS_LOCATIONS.VICTORIA_ISLAND,
  distance: 8.5,
  estimatedDuration: 25,
  pricing: {
    currency: "NGN",
    baseFare: 300,
    distanceFare: 680,
    timeFare: 375,
    surge: 0,
    total: 1355,
    paymentMethod: "mobile_money",
  },
  searchStartedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Cancelled ride fixture
 */
export const CANCELLED_RIDE: TestRide = {
  id: "ride_cancelled_001",
  riderId: TEST_RIDERS.NEW_RIDER.id,
  driverId: TEST_DRIVERS.EMEKA_DRIVER.id,
  status: "cancelled",
  rideType: "economy",
  pickup: LAGOS_LOCATIONS.YABA,
  dropoff: LAGOS_LOCATIONS.IKEJA,
  distance: 10.2,
  estimatedDuration: 30,
  pricing: {
    currency: "NGN",
    baseFare: 300,
    distanceFare: 816,
    timeFare: 450,
    surge: 0,
    total: 1566,
    paymentMethod: "cash",
  },
  searchStartedAt: new Date("2024-06-01T09:00:00Z"),
  driverAssignedAt: new Date("2024-06-01T09:02:00Z"),
  cancelledAt: new Date("2024-06-01T09:05:00Z"),
  cancelledBy: "rider",
  cancellationReason: "Changed my mind",
  createdAt: new Date("2024-06-01T09:00:00Z"),
  updatedAt: new Date("2024-06-01T09:05:00Z"),
};

/**
 * Surge pricing ride fixture
 */
export const SURGE_RIDE: TestRide = {
  id: "ride_surge_001",
  riderId: TEST_RIDERS.ADAOBI_RIDER.id,
  driverId: TEST_DRIVERS.EMEKA_DRIVER.id,
  status: "completed",
  rideType: "economy",
  pickup: LAGOS_LOCATIONS.VICTORIA_ISLAND,
  dropoff: LAGOS_LOCATIONS.AIRPORT,
  distance: 25.0,
  estimatedDuration: 60,
  actualDuration: 55,
  pricing: {
    currency: "NGN",
    baseFare: 300,
    distanceFare: 2000,
    timeFare: 900,
    surge: 1600, // 1.5x surge
    total: 4800,
    paymentMethod: "card",
  },
  searchStartedAt: new Date("2024-06-01T18:00:00Z"),
  driverAssignedAt: new Date("2024-06-01T18:03:00Z"),
  driverArrivedAt: new Date("2024-06-01T18:10:00Z"),
  rideStartedAt: new Date("2024-06-01T18:12:00Z"),
  rideCompletedAt: new Date("2024-06-01T19:07:00Z"),
  rating: {
    riderRating: 4.5,
    driverRating: 5,
  },
  createdAt: new Date("2024-06-01T18:00:00Z"),
  updatedAt: new Date("2024-06-01T19:07:00Z"),
};

/**
 * Scheduled ride fixture (future ride)
 */
export const SCHEDULED_RIDE: TestRide = {
  id: "ride_scheduled_001",
  riderId: TEST_RIDERS.NJERI_RIDER.id,
  status: "scheduled" as any,
  rideType: "comfort",
  pickup: NAIROBI_LOCATIONS.WESTLANDS,
  dropoff: NAIROBI_LOCATIONS.JKIA,
  distance: 20.0,
  estimatedDuration: 40,
  pricing: {
    currency: "KES",
    baseFare: 150,
    distanceFare: 2400,
    timeFare: 800,
    surge: 0,
    total: 3350,
    paymentMethod: "mobile_money",
  },
  scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * All ride fixtures
 */
export const TEST_RIDES = {
  COMPLETED: COMPLETED_RIDE,
  IN_PROGRESS: IN_PROGRESS_RIDE,
  SEARCHING: SEARCHING_RIDE,
  CANCELLED: CANCELLED_RIDE,
  SURGE: SURGE_RIDE,
  SCHEDULED: SCHEDULED_RIDE,
};

/**
 * Ride scenarios for E2E testing
 */
export const RIDE_SCENARIOS = {
  // Happy path: Complete ride from request to completion
  HAPPY_PATH: {
    rider: TEST_RIDERS.ADAOBI_RIDER,
    driver: TEST_DRIVERS.EMEKA_DRIVER,
    route: RIDE_ROUTES.LAGOS_MEDIUM,
    rideType: "economy" as const,
    paymentMethod: "mobile_money" as const,
  },

  // Airport trip with premium vehicle
  AIRPORT_TRIP: {
    rider: TEST_RIDERS.NJERI_RIDER,
    driver: TEST_DRIVERS.KAMAU_BODA,
    route: RIDE_ROUTES.NAIROBI_AIRPORT,
    rideType: "comfort" as const,
    paymentMethod: "mobile_money" as const,
  },

  // Cash payment scenario
  CASH_PAYMENT: {
    rider: TEST_RIDERS.NEW_RIDER,
    driver: TEST_DRIVERS.EMEKA_DRIVER,
    route: RIDE_ROUTES.LAGOS_SHORT,
    rideType: "economy" as const,
    paymentMethod: "cash" as const,
  },

  // Driver cancellation
  DRIVER_CANCEL: {
    rider: TEST_RIDERS.ADAOBI_RIDER,
    driver: TEST_DRIVERS.EMEKA_DRIVER,
    route: RIDE_ROUTES.LAGOS_MEDIUM,
    cancelledBy: "driver" as const,
    cancellationReason: "Vehicle issue",
  },

  // No drivers available
  NO_DRIVERS: {
    rider: TEST_RIDERS.ADAOBI_RIDER,
    route: RIDE_ROUTES.LAGOS_AIRPORT,
    expectedOutcome: "no_drivers_found",
  },
};
