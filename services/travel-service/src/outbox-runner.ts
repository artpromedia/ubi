/**
 * Outbox relay runner for travel-service.
 *
 * travel-service writes `outbox_events` rows (search, order ladder, refund,
 * disruption, settlement, webhook and reservation events) in the same
 * transaction as the state change; this wires the shared @ubi/outbox relay to
 * publish them from this service's own prisma + redis singletons.
 */
import { createOutboxRelay, type OutboxRelay } from "@ubi/outbox";

import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";

export function startOutboxRelay(): OutboxRelay {
  const relay = createOutboxRelay({
    prisma,
    redis,
    logger: logger.child({ component: "outbox" }),
  });
  relay.start();
  logger.info({ component: "outbox" }, "outbox relay started");
  return relay;
}
