/**
 * Wires the ops modules against the real singletons.
 *
 * The ledger is the one thing this service does not own. It is reached over HTTP
 * and has no fallback that pretends to work: if payment-service is unreachable a
 * rebate or a benefit fails loudly and posts nothing, rather than opening a
 * second set of books here (CLAUDE.md #4).
 */
import { prisma } from "./lib/prisma";
import { createFlagProvider } from "./ops/config";
import { createHttpLedger } from "./ops/ledger-port";

import type { GrowthDeps } from "./ops/context";
import type { GrowthDb } from "./ops/types";

const PAYMENT_SERVICE_URL =
  process.env.PAYMENT_SERVICE_URL ?? "http://payment-service:4003";

export function createDeps(): GrowthDeps {
  const db = prisma as unknown as GrowthDb;
  return {
    db,
    flags: createFlagProvider(db),
    ledger: createHttpLedger({
      baseUrl: PAYMENT_SERVICE_URL,
      serviceKey: process.env.INTERNAL_SERVICE_KEY,
    }),
    now: () => new Date(),
  };
}
