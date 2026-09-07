/**
 * @ubi/outbox
 *
 * The transactional outbox relay (CLAUDE.md #2): every service writes
 * `outbox_events` rows in the same transaction as its state change, and this
 * package is what publishes them to Redis, in per-aggregate order, exactly-once
 * per row across any number of replicas, with a consumer helper that is
 * idempotent on the event id.
 */
export {
  createOutboxRelay,
  type CreateOutboxRelayOptions,
  type OutboxRelay,
  type OutboxRelayLogger,
  type OutboxRelayPrisma,
  type OutboxRelayTx,
  type OutboxPublisher,
  type OutboxTickResult,
} from "./relay";

export {
  subscribeOutbox,
  type OutboxHandler,
  type OutboxSubscription,
  type SubscribeOutboxOptions,
} from "./consumer";

export {
  subjectChannel,
  eventTypeChannel,
  EVENT_TYPE_CHANNEL_PREFIX,
} from "./channels";

export {
  envelopeFromRow,
  type EnvelopeParse,
  type RawOutboxRow,
} from "./envelope";

export { backoffDelayMs, type BackoffOptions } from "./backoff";
