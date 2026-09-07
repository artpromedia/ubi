/**
 * Outbox relay runner for support-service.
 *
 * support-service writes `outbox_events` rows (case timeline, remedies, SOS /
 * safety events) in the same transaction as the state change; this wires the
 * shared @ubi/outbox relay to publish them from this service's own prisma +
 * redis singletons. Importing this module has no side effects — the lead calls
 * `startOutboxRelay()` from the service bootstrap (see the note in the PR).
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
