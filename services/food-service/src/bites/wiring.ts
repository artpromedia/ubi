/**
 * Wires the Bites module against the real singletons.
 *
 * The payment service is the one thing Bites does not own; it is reached over
 * HTTP and has no fallback that pretends to work. If payment-service is
 * unreachable, placing an order fails loudly and holds nothing, releasing a hold
 * on a rejection fails loudly rather than silently capturing, and a refund is
 * not posted at all.
 */
import { prisma } from "../lib/prisma.js";
import { createCityConfigProvider } from "./city-config.js";
import { createHttpPayments } from "./payment-port.js";

import type { BitesDeps } from "./context.js";
import type { BitesDb } from "./lib/types.js";

const PAYMENT_SERVICE_URL =
  process.env.PAYMENT_SERVICE_URL ?? "http://payment-service:4003";

export function createBitesDeps(): BitesDeps {
  const db = prisma as unknown as BitesDb;
  return {
    db,
    config: createCityConfigProvider(db),
    payments: createHttpPayments({
      baseUrl: PAYMENT_SERVICE_URL,
      serviceKey: process.env.INTERNAL_SERVICE_KEY,
    }),
    now: () => new Date(),
  };
}
