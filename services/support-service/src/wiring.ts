/**
 * Wires the ops module against the real singletons.
 *
 * The ledger and the notifier are the two things this service does not own. Both
 * are reached over HTTP; neither has a fallback that pretends to work. If
 * payment-service is unreachable a remedy fails loudly and posts nothing, and if
 * notification-service is unreachable an SOS is still recorded and retried.
 */
import { prisma } from "./lib/prisma";
import { createCityConfigProvider } from "./ops/city-config";
import { createHttpLedger } from "./ops/ledger-port";
import { createHttpNotifier } from "./ops/notifier";

import type { SupportDeps } from "./ops/context";
import type { SupportDb } from "./ops/types";

const PAYMENT_SERVICE_URL =
  process.env.PAYMENT_SERVICE_URL ?? "http://payment-service:4003";
const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL ?? "http://notification-service:4006";

export function createDeps(): SupportDeps {
  const db = prisma as unknown as SupportDb;
  return {
    db,
    config: createCityConfigProvider(db),
    ledger: createHttpLedger({
      baseUrl: PAYMENT_SERVICE_URL,
      ...(process.env.LEDGER_REMEDY_PATH === undefined
        ? {}
        : { path: process.env.LEDGER_REMEDY_PATH }),
      serviceKey: process.env.INTERNAL_SERVICE_KEY,
    }),
    notifier: createHttpNotifier({
      baseUrl: NOTIFICATION_SERVICE_URL,
      serviceKey: process.env.INTERNAL_SERVICE_KEY,
    }),
    now: () => new Date(),
  };
}
