/**
 * Outbox relay runner for food-service (Bites).
 *
 * food-service writes `outbox_events` rows (order placed / accepted / picked up
 * / delivered, issues, refunds, merchant lifecycle) in the same transaction as
 * the state change; this wires the shared @ubi/outbox relay to publish them from
 * this service's own prisma + redis singletons. Importing this module has no
 * side effects — the lead calls `startOutboxRelay()` from the service bootstrap
 * (see the note in the PR).
 */
import { createOutboxRelay, type OutboxRelay } from "@ubi/outbox";

import { logger } from "./lib/logger.js";
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
