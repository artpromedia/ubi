/**
 * Outbox relay runner for user-service.
 *
 * user-service writes `outbox_events` rows (driver status/eligibility, device
 * enrolment, step-up, document expiry, identity cases, safe-mode) in the same
 * transaction as the state change; this wires the shared @ubi/outbox relay to
 * publish them from this service's own prisma + redis singletons. Importing this
 * module has no side effects — the lead calls `startOutboxRelay()` from the
 * service bootstrap (see the note in the PR).
 */
import { createOutboxRelay, type OutboxRelay } from "@ubi/outbox";

import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";

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
