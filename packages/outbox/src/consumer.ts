/**
 * Thin consumer helper for outbox events.
 *
 * Pattern-subscribes to Redis, parses and validates each message against
 * `EventEnvelopeSchema`, and de-duplicates on the event `id` before invoking the
 * handler. Dedupe is a Redis `SET key value NX EX <ttl>`: the first delivery of
 * an id wins the key and is handled; a redelivery within the TTL finds the key
 * already set and is dropped. This is what makes the at-least-once outbox safe
 * for consumers (CLAUDE.md #2: "consumers idempotent on id").
 *
 * A dedicated command connection is used for the SET because the subscribing
 * connection is in subscriber mode and cannot run ordinary commands.
 */
import { Redis } from "ioredis";

import { EventEnvelopeSchema, type EventEnvelope } from "@ubi/contracts";

export type OutboxHandler = (
  envelope: EventEnvelope,
  channel: string,
) => void | Promise<void>;

export interface SubscribeOutboxOptions {
  /** How long a handled id is remembered, in seconds. Default 86400 (24h). */
  readonly dedupeTtlSeconds?: number;
  /** Key prefix for the dedupe set. Default `outbox:seen:`. */
  readonly dedupeKeyPrefix?: string;
  /**
   * Called for a message that could not be parsed/validated or whose handler
   * threw. The raw message is passed so the caller can decide what to record;
   * it may contain payload data, so callers must not log it verbatim.
   */
  readonly onError?: (err: unknown, channel: string, raw: string) => void;
}

export interface OutboxSubscription {
  stop(): Promise<void>;
}

const DEFAULT_DEDUPE_TTL_SECONDS = 86_400;
const DEFAULT_DEDUPE_PREFIX = "outbox:seen:";

/**
 * Subscribe to outbox events matching `pattern` (a Redis glob pattern, e.g.
 * `ride.*`, `event:order.*`, or `event:*`). Returns a handle whose `stop()`
 * unsubscribes and closes the command connection this helper opened.
 */
export async function subscribeOutbox(
  redis: Redis,
  pattern: string,
  handler: OutboxHandler,
  options: SubscribeOutboxOptions = {},
): Promise<OutboxSubscription> {
  const ttl = options.dedupeTtlSeconds ?? DEFAULT_DEDUPE_TTL_SECONDS;
  const prefix = options.dedupeKeyPrefix ?? DEFAULT_DEDUPE_PREFIX;

  // Separate connection: the subscriber connection cannot run SET.
  const commands = redis.duplicate();

  const handleMessage = async (channel: string, raw: string): Promise<void> => {
    let envelope: EventEnvelope;
    try {
      const parsed = EventEnvelopeSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        options.onError?.(parsed.error, channel, raw);
        return;
      }
      envelope = parsed.data;
    } catch (err) {
      options.onError?.(err, channel, raw);
      return;
    }

    let firstSight: "OK" | null;
    try {
      firstSight = await commands.set(`${prefix}${envelope.id}`, "1", "EX", ttl, "NX");
    } catch (err) {
      options.onError?.(err, channel, raw);
      return;
    }
    if (firstSight === null) {
      // Already handled within the TTL window; drop the redelivery.
      return;
    }

    try {
      await handler(envelope, channel);
    } catch (err) {
      options.onError?.(err, channel, raw);
    }
  };

  const onPMessage = (_pattern: string, channel: string, message: string): void => {
    void handleMessage(channel, message);
  };

  redis.on("pmessage", onPMessage);
  await redis.psubscribe(pattern);

  return {
    async stop(): Promise<void> {
      redis.off("pmessage", onPMessage);
      try {
        await redis.punsubscribe(pattern);
      } finally {
        await commands.quit();
      }
    },
  };
}
