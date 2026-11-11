/**
 * Durable consumer helper for outbox events (CLAUDE.md #2).
 *
 * By default (`transport: "streams"`), consumes from the durable Redis Stream
 * (`outbox:stream`) using a Redis Streams consumer group (`XGROUP CREATE ...
 * MKSTREAM`, `XREADGROUP`, `XPENDING`/`XCLAIM` retry with exponential backoff,
 * `XACK`, and dead-lettering to `outbox:dlq` after `maxDeliveries` attempts),
 * so a late-starting or restarting consumer never misses events published while
 * it was offline.
 *
 * Also maintains a `psubscribe` listener for callers/tests that publish directly
 * via `redis.publish` (or when `transport: "pubsub"` is explicitly selected),
 * deduplicated on `envelope.id` via `SET <prefix><id> "1" EX <ttl> NX`.
 */
import { EventEnvelopeSchema, type EventEnvelope } from "@ubi/contracts";

import { backoffDelayMs } from "./backoff";
import {
  eventTypeChannel,
  matchesOutboxPattern,
  OUTBOX_DLQ_STREAM_KEY,
  OUTBOX_STREAM_KEY,
  subjectChannel,
} from "./channels";

import type { Redis } from "ioredis";

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
   * Transport mode:
   * - `"streams"` (default): durable Redis Streams consumer group (`XREADGROUP`
   *   + `XPENDING`/`XCLAIM` + `XACK`), with pub/sub fallback for direct
   *   `redis.publish` callers.
   * - `"pubsub"`: ephemeral Redis Pub/Sub only (misses events published while
   *   no subscriber was connected).
   */
  readonly transport?: "streams" | "pubsub";
  /** Stream key to consume from in `"streams"` mode. Default `outbox:stream`. */
  readonly streamKey?: string;
  /** Dead-letter stream key for exhausted stream deliveries. Default `outbox:dlq`. */
  readonly dlqStreamKey?: string;
  /** Consumer group name. Derived from `dedupeKeyPrefix` + `pattern` when omitted. */
  readonly groupName?: string;
  /** Consumer instance name within the group. Default unique per subscription. */
  readonly consumerName?: string;
  /** Initial stream offset when creating a new group (`"0"` or `"$"`). Default `"0"`. */
  readonly streamStartId?: string;
  /** Max handler attempts before moving a stream entry to `dlqStreamKey`. Default 3. */
  readonly maxDeliveries?: number;
  /** Base retry backoff in ms before reclaiming a failed stream entry. Default 50ms. */
  readonly retryBackoffBaseMs?: number;
  /** Maximum retry backoff in ms. Default 5000ms. */
  readonly retryBackoffMaxMs?: number;
  /** Poll interval in ms for the stream reader when idle. Default 25ms. */
  readonly pollIntervalMs?: number;
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
const DEFAULT_MAX_DELIVERIES = 3;
const DEFAULT_RETRY_BACKOFF_BASE_MS = 50;
const DEFAULT_RETRY_BACKOFF_MAX_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 25;

let consumerSeq = 0;

function fieldsToRecord(fields: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const k = fields[i];
    const v = fields[i + 1];
    if (k !== undefined && v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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
  const transport = options.transport ?? "streams";
  const streamKey = options.streamKey ?? OUTBOX_STREAM_KEY;
  const dlqStreamKey = options.dlqStreamKey ?? OUTBOX_DLQ_STREAM_KEY;
  const maxDeliveries = Math.max(
    1,
    options.maxDeliveries ?? DEFAULT_MAX_DELIVERIES,
  );
  const retryBackoffBaseMs =
    options.retryBackoffBaseMs ?? DEFAULT_RETRY_BACKOFF_BASE_MS;
  const retryBackoffMaxMs =
    options.retryBackoffMaxMs ?? DEFAULT_RETRY_BACKOFF_MAX_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const groupName =
    options.groupName ?? `outbox:cg:${prefix.replace(/:+$/, "")}:${pattern}`;
  consumerSeq += 1;
  const consumerName =
    options.consumerName ?? `c_${process.pid}_${Date.now()}_${consumerSeq}`;
  const startId = options.streamStartId ?? "0";

  // Separate connection: the subscriber connection cannot run ordinary commands.
  const commands = redis.duplicate();

  const supportsStreams =
    transport === "streams" &&
    typeof (commands as unknown as { xreadgroup?: unknown }).xreadgroup ===
      "function" &&
    typeof (commands as unknown as { xgroup?: unknown }).xgroup === "function";

  const lastErrorByEntry = new Map<string, string>();

  const writeDlq = async (
    entryId: string,
    channel: string,
    raw: string,
    attempts: number,
    error: string,
    envelope?: EventEnvelope,
  ): Promise<void> => {
    if (
      typeof (commands as unknown as { xadd?: unknown }).xadd !== "function"
    ) {
      return;
    }
    await commands.xadd(
      dlqStreamKey,
      "MAXLEN",
      "~",
      "10000",
      "*",
      "streamEntryId",
      entryId,
      "id",
      envelope?.id ?? "",
      "name",
      envelope?.name ?? "",
      "channel",
      channel,
      "group",
      groupName,
      "attempts",
      String(attempts),
      "error",
      error,
      "raw",
      raw,
    );
  };

  const handlePubSubMessage = async (
    channel: string,
    raw: string,
  ): Promise<void> => {
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

    if (
      supportsStreams &&
      streamKey === OUTBOX_STREAM_KEY &&
      typeof (commands as unknown as { exists?: unknown }).exists === "function"
    ) {
      try {
        const streamed = await commands.exists(
          `outbox:streamed:${envelope.id}`,
        );
        if (streamed === 1) {
          // Delivered through the durable Redis Stream consumer group instead.
          return;
        }
      } catch {
        // Fall through to pubsub handling if exists check fails.
      }
    }

    let firstSight: "OK" | null;
    try {
      firstSight = await commands.set(
        `${prefix}${envelope.id}`,
        "1",
        "EX",
        ttl,
        "NX",
      );
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

  const processStreamEntry = async (
    entryId: string,
    fields: string[],
    deliveryCount: number,
  ): Promise<void> => {
    const record = fieldsToRecord(fields);
    const raw = record.raw ?? "";
    const subCh = record.subjectChannel ?? "";
    const typeCh = record.eventTypeChannel ?? "";

    let matchedChannel: string | null = null;
    if (typeCh && matchesOutboxPattern(typeCh, pattern)) {
      matchedChannel = typeCh;
    } else if (subCh && matchesOutboxPattern(subCh, pattern)) {
      matchedChannel = subCh;
    }

    let envelope: EventEnvelope | undefined;
    try {
      const parsed = EventEnvelopeSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        if (matchedChannel !== null) {
          options.onError?.(parsed.error, matchedChannel, raw);
          await writeDlq(
            entryId,
            matchedChannel,
            raw,
            deliveryCount,
            errorText(parsed.error),
          );
        }
        await commands.xack(streamKey, groupName, entryId);
        lastErrorByEntry.delete(entryId);
        return;
      }
      envelope = parsed.data;
    } catch (err) {
      if (matchedChannel !== null) {
        options.onError?.(err, matchedChannel, raw);
        await writeDlq(
          entryId,
          matchedChannel,
          raw,
          deliveryCount,
          errorText(err),
        );
      }
      await commands.xack(streamKey, groupName, entryId);
      lastErrorByEntry.delete(entryId);
      return;
    }

    if (matchedChannel === null) {
      const derivedTypeCh = eventTypeChannel(envelope.name);
      const derivedSubCh = subjectChannel(envelope.subject);
      if (matchesOutboxPattern(derivedTypeCh, pattern)) {
        matchedChannel = derivedTypeCh;
      } else if (matchesOutboxPattern(derivedSubCh, pattern)) {
        matchedChannel = derivedSubCh;
      }
    }

    if (matchedChannel === null) {
      // Entry does not match this subscription's pattern; ack and skip.
      await commands.xack(streamKey, groupName, entryId);
      lastErrorByEntry.delete(entryId);
      return;
    }

    const firstSight = await commands.set(
      `${prefix}${envelope.id}`,
      "1",
      "EX",
      ttl,
      "NX",
    );
    if (firstSight === null) {
      // Already handled within the TTL window; ack the duplicate stream entry.
      await commands.xack(streamKey, groupName, entryId);
      lastErrorByEntry.delete(entryId);
      return;
    }

    try {
      await handler(envelope, matchedChannel);
      await commands.xack(streamKey, groupName, entryId);
      lastErrorByEntry.delete(entryId);
    } catch (err) {
      // Release the dedupe marker so the stream retry can execute the handler.
      if (
        typeof (commands as unknown as { del?: unknown }).del === "function"
      ) {
        await commands.del(`${prefix}${envelope.id}`).catch(() => undefined);
      }
      const errMsg = errorText(err);
      lastErrorByEntry.set(entryId, errMsg);
      options.onError?.(err, matchedChannel, raw);

      if (deliveryCount >= maxDeliveries) {
        await writeDlq(
          entryId,
          matchedChannel,
          raw,
          deliveryCount,
          errMsg,
          envelope,
        );
        await commands.xack(streamKey, groupName, entryId);
        lastErrorByEntry.delete(entryId);
      }
    }
  };

  let stopped = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let pollResolve: (() => void) | undefined;
  let streamLoopPromise: Promise<void> = Promise.resolve();

  if (supportsStreams) {
    try {
      await commands.xgroup(
        "CREATE",
        streamKey,
        groupName,
        startId,
        "MKSTREAM",
      );
    } catch (err) {
      if (!errorText(err).includes("BUSYGROUP")) {
        throw err;
      }
    }

    const reclaimPending = async (): Promise<number> => {
      const pending = (await commands.xpending(
        streamKey,
        groupName,
        "-",
        "+",
        50,
      )) as Array<[string, string, number, number]>;
      let processed = 0;
      for (const [entryId, _owner, idleMs, deliveryCount] of pending) {
        if (stopped) break;
        if (deliveryCount >= maxDeliveries) {
          const rows = (await commands.xrange(
            streamKey,
            entryId,
            entryId,
          )) as Array<[string, string[]]>;
          const fields = rows[0]?.[1] ?? [];
          const record = fieldsToRecord(fields);
          const raw = record.raw ?? "";
          const ch =
            record.eventTypeChannel || record.subjectChannel || pattern;
          let parsedEnv: EventEnvelope | undefined;
          try {
            const p = EventEnvelopeSchema.safeParse(JSON.parse(raw));
            if (p.success) parsedEnv = p.data;
          } catch {
            // ignore
          }
          await writeDlq(
            entryId,
            ch,
            raw,
            deliveryCount,
            lastErrorByEntry.get(entryId) ?? "max_deliveries_exhausted",
            parsedEnv,
          );
          await commands.xack(streamKey, groupName, entryId);
          lastErrorByEntry.delete(entryId);
          processed += 1;
          continue;
        }

        const requiredIdleMs = backoffDelayMs(deliveryCount, {
          baseMs: retryBackoffBaseMs,
          maxMs: retryBackoffMaxMs,
        });
        if (idleMs < requiredIdleMs) {
          continue;
        }

        const claimed = (await commands.xclaim(
          streamKey,
          groupName,
          consumerName,
          requiredIdleMs,
          entryId,
        )) as Array<[string, string[]] | null>;
        for (const item of claimed) {
          if (!item) continue;
          const [claimedId, fields] = item;
          await processStreamEntry(claimedId, fields, deliveryCount + 1);
          processed += 1;
        }
      }
      return processed;
    };

    const readNewEntries = async (): Promise<number> => {
      const res = (await commands.xreadgroup(
        "GROUP",
        groupName,
        consumerName,
        "COUNT",
        50,
        "STREAMS",
        streamKey,
        ">",
      )) as Array<[string, Array<[string, string[]]>]> | null;
      if (!res) return 0;
      let count = 0;
      for (const [_sKey, entries] of res) {
        for (const [entryId, fields] of entries) {
          if (stopped) break;
          await processStreamEntry(entryId, fields, 1);
          count += 1;
        }
      }
      return count;
    };

    // Perform an initial drain pass before returning so any backlog already in
    // the stream is immediately picked up.
    await reclaimPending().catch(() => 0);
    await readNewEntries().catch(() => 0);

    streamLoopPromise = (async () => {
      while (!stopped) {
        let count = 0;
        try {
          count += await reclaimPending();
          count += await readNewEntries();
        } catch {
          // Ignore transient stream read errors during shutdown or reconnect.
        }
        if (stopped) break;
        if (count === 0) {
          await new Promise<void>((resolve) => {
            pollResolve = resolve;
            pollTimer = setTimeout(() => {
              pollTimer = undefined;
              pollResolve = undefined;
              resolve();
            }, pollIntervalMs);
          });
        }
      }
    })();
  }

  const onPMessage = (
    _pattern: string,
    channel: string,
    message: string,
  ): void => {
    void handlePubSubMessage(channel, message);
  };

  redis.on("pmessage", onPMessage);
  await redis.psubscribe(pattern);

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (pollTimer !== undefined) {
        clearTimeout(pollTimer);
        pollTimer = undefined;
      }
      if (pollResolve !== undefined) {
        const resolve = pollResolve;
        pollResolve = undefined;
        resolve();
      }
      await streamLoopPromise;
      redis.off("pmessage", onPMessage);
      try {
        await redis.punsubscribe(pattern);
      } finally {
        await commands.quit();
      }
    },
  };
}
