/**
 * Wires the ops modules against the real singletons.
 *
 * payment-service is the one thing this service does not own. It is reached over
 * HTTP and has no fallback that pretends to work: if payment-service is
 * unreachable an authorize/capture/refund fails loudly and the order is not
 * advanced past where the money actually is. Supply adapters are resolved per
 * supplier row, so nothing here names Duffel or Nuitee.
 *
 * ride-service is reached for airport transfers AS the traveller, with the
 * HMAC-signed internal identity its middleware verifies (lib/ride-context.ts).
 * In production a missing RIDE_INTERNAL_CONTEXT_SECRET throws here, and the
 * process refuses to start (index.ts) — exactly as ride-service itself does.
 */
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import {
  loadRideContextKeys,
  RIDE_CONTEXT_SECRET_ENV,
} from "./lib/ride-context";
import { createCityConfigProvider } from "./ops/config";
import { createHttpPayment } from "./ports/payment-port";
import { createHttpRidePort } from "./ports/ride-port";

import type { TravelDeps } from "./ops/context";
import type { TravelDb } from "./ops/types";

const PAYMENT_SERVICE_URL =
  process.env.PAYMENT_SERVICE_URL ?? "http://payment-service:4003";
const RIDE_SERVICE_URL =
  process.env.RIDE_SERVICE_URL ?? "http://ride-service:4002";

export function createDeps(): TravelDeps {
  const db = prisma as unknown as TravelDb;
  // Throws in production without a key: fail closed at boot.
  const rideContextKeys = loadRideContextKeys(process.env);
  if (rideContextKeys.length === 0) {
    logger.warn(
      `${RIDE_CONTEXT_SECRET_ENV} is not set: airport-transfer calls to ride-service carry an UNSIGNED identity (development only)`,
    );
  }
  return {
    db,
    config: createCityConfigProvider(db),
    payment: createHttpPayment({
      baseUrl: PAYMENT_SERVICE_URL,
      ...(process.env.PAYMENT_TRAVEL_PATH === undefined
        ? {}
        : { basePath: process.env.PAYMENT_TRAVEL_PATH }),
      serviceKey: process.env.INTERNAL_SERVICE_KEY,
    }),
    rides: createHttpRidePort({
      baseUrl: RIDE_SERVICE_URL,
      signingKeys: rideContextKeys,
    }),
    now: () => new Date(),
  };
}
