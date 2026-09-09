/**
 * Wires the ops modules against the real singletons.
 *
 * payment-service is the one thing this service does not own. It is reached over
 * HTTP and has no fallback that pretends to work: if payment-service is
 * unreachable an authorize/capture/refund fails loudly and the order is not
 * advanced past where the money actually is. Supply adapters are resolved per
 * supplier row, so nothing here names Duffel or Nuitee.
 */
import { prisma } from "./lib/prisma";
import { createCityConfigProvider } from "./ops/config";
import { createHttpPayment } from "./ports/payment-port";

import type { TravelDeps } from "./ops/context";
import type { TravelDb } from "./ops/types";

const PAYMENT_SERVICE_URL =
  process.env.PAYMENT_SERVICE_URL ?? "http://payment-service:4003";

export function createDeps(): TravelDeps {
  const db = prisma as unknown as TravelDb;
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
    now: () => new Date(),
  };
}
