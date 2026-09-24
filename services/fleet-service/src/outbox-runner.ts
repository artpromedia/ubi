/**
 * Outbox relay runner: fleet-service writes `outbox_events` rows in the same
 * transaction as every state change; this publishes them with the shared
 * @ubi/outbox relay from this service's own prisma + redis singletons.
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
