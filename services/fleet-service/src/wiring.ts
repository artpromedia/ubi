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
import {
  FLEET_PAYMENT_SERVICE_KEY_ENV,
  FLEET_RIDE_SERVICE_KEY_ENV,
} from "./lib/service-key";
import { createCityConfigProvider } from "./ops/config";
import { createDocStoreFromEnv } from "./ports/doc-store";
import {
  createHttpPaymentPort,
  paymentServiceKeyFromEnv,
} from "./ports/payment-port";
import { createHttpPinPort } from "./ports/pin-port";
import { createHttpRidePort, rideServiceKeyFromEnv } from "./ports/ride-port";

import type { FleetDeps } from "./ops/context";
import type { FleetDb } from "./ops/types";

const RIDE_SERVICE_URL =
  process.env.RIDE_SERVICE_URL ?? "http://ride-service:4002";
const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL ?? "http://user-service:4001";
const PAYMENT_SERVICE_URL =
  process.env.PAYMENT_SERVICE_URL ?? "http://payment-service:3005";

export function createDeps(): FleetDeps {
  const db = prisma as unknown as FleetDb;
  const rideKey = rideServiceKeyFromEnv(process.env);
  if (rideKey === undefined) {
    logger.warn(
      `${FLEET_RIDE_SERVICE_KEY_ENV} is not set (or shorter than 32 characters): every call to ride-service is refused, so maintenance, off-road, calendars with bookings and schedules answer 503`,
    );
  }
  const paymentKey = paymentServiceKeyFromEnv(process.env);
  if (paymentKey === undefined) {
    logger.warn(
      `${FLEET_PAYMENT_SERVICE_KEY_ENV} is not set (or shorter than 32 characters): fleet week-money calls to payment-service will degrade to MONEY_UNAVAILABLE`,
    );
  }
  const now = () => new Date();
  const docs = createDocStoreFromEnv(process.env, now);
  if (!docs.configured()) {
    logger.warn(
      "FLEET_DOC_S3_* is not set: KYB document and vehicle document uploads answer 503 doc_storage_not_configured",
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
    payments: createHttpPaymentPort({
      baseUrl: PAYMENT_SERVICE_URL,
      serviceKey: paymentKey,
    }),
    docs,
    now,
  };
}
