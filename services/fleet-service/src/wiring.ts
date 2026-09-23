/**
 * Wires the ops modules against the real singletons.
 *
 * ride-service (contract A) and user-service (the wallet-PIN check) are the
 * two things this service does not own. Each is reached over HTTP with no
 * fallback that pretends to work: an unreachable ride-service fails the
 * fleet action with 503 before any fleet state moves past what ride-service
 * confirmed; an unreachable user-service signs nothing.
 */
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { FLEET_RIDE_SERVICE_KEY_ENV } from "./lib/service-key";
import { createCityConfigProvider } from "./ops/config";
import { createHttpPinPort } from "./ports/pin-port";
import { createHttpRidePort, rideServiceKeyFromEnv } from "./ports/ride-port";

import type { FleetDeps } from "./ops/context";
import type { FleetDb } from "./ops/types";

const RIDE_SERVICE_URL =
  process.env.RIDE_SERVICE_URL ?? "http://ride-service:4002";
const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL ?? "http://user-service:4001";

export function createDeps(): FleetDeps {
  const db = prisma as unknown as FleetDb;
  const rideKey = rideServiceKeyFromEnv(process.env);
  if (rideKey === undefined) {
    logger.warn(
      `${FLEET_RIDE_SERVICE_KEY_ENV} is not set (or shorter than 32 characters): every call to ride-service is refused, so maintenance, off-road, calendars with bookings and schedules answer 503`,
    );
  }
  return {
    db,
    config: createCityConfigProvider(db),
    rides: createHttpRidePort({
      baseUrl: RIDE_SERVICE_URL,
      serviceKey: rideKey,
    }),
    pins: createHttpPinPort({ baseUrl: USER_SERVICE_URL }),
    now: () => new Date(),
  };
}
