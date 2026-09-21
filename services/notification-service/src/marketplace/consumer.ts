/**
 * Production wiring for durable marketplace push (G10).
 *
 * Subscribes to the canonical `event:mp.*` outbox channel (the same stream
 * realtime-gateway consumes) and drives MarketplacePushDeliverer with real
 * ports: Prisma for device tokens and preferences, the Firebase provider for
 * delivery, and Redis for dedupe, per-subject ordering, the dead-letter queue
 * and the offline-retry pending list. No new datastore is introduced — Redis
 * is already the notification service's cache/pubsub/rate-limit store.
 */
import { Redis } from "ioredis";

import { subscribeOutbox, type OutboxSubscription } from "@ubi/outbox";

import {
  MarketplacePushDeliverer,
  type DeadLetterEntry,
  type MarketplacePushPorts,
  type PendingEntry,
  type PushNotification,
  type PushSendResult,
} from "./push.js";
import { pushLogger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { firebaseService } from "../providers/firebase.js";

import type { PushPrefCategory } from "./audience.js";

/** Redis glob pattern for marketplace event-type channels. */
export const MARKETPLACE_PUSH_PATTERN = "event:mp.*";

const SEEN_PREFIX = "notif:mp:seen:";
const SEQ_PREFIX = "notif:mp:seq:";
const DLQ_KEY = "notif:mp:dlq";
const PENDING_KEY = "notif:mp:pending";
const SEEN_TTL_SECONDS = 86_400; // 24h dedupe window
const SEQ_TTL_SECONDS = 86_400;
const DLQ_MAX = 10_000;
const PENDING_MAX = 50_000;

// Atomically record the max sequence seen for a subject. Returns 1 when the
// supplied sequence is strictly newer (process it), 0 otherwise (stale).
const ADVANCE_SEQ_LUA = `
local cur = tonumber(redis.call('GET', KEYS[1]) or '-1')
local seq = tonumber(ARGV[1])
if seq > cur then
  redis.call('SET', KEYS[1], seq, 'EX', ARGV[2])
  return 1
end
return 0`;

export function buildMarketplacePushPorts(
  commands: Redis,
): MarketplacePushPorts {
  return {
    devices: {
      async activeTokens(userId: string): Promise<string[]> {
        const rows = await prisma.deviceToken.findMany({
          where: { userId, isActive: true },
          select: { token: true },
        });
        return rows.map((r: { token: string }) => r.token);
      },
      async deactivate(tokens: string[]): Promise<void> {
        if (tokens.length === 0) {
          return;
        }
        await prisma.deviceToken.updateMany({
          where: { token: { in: tokens } },
          data: { isActive: false },
        });
      },
    },
    prefs: {
      async allows(
        userId: string,
        category: PushPrefCategory,
      ): Promise<boolean> {
        const pref = await prisma.notificationPreference.findUnique({
          where: { userId },
        });
        // Documented default: with no preference row, marketplace push is
        // allowed (the rider/driver opted into the marketplace by using it).
        if (!pref) {
          return true;
        }
        if (!pref.pushEnabled) {
          return false;
        }
        return category === "payment"
          ? pref.pushPaymentUpdates
          : pref.pushRideUpdates;
      },
    },
    sender: {
      async send(
        _userId: string,
        tokens: string[],
        notification: PushNotification,
      ): Promise<PushSendResult> {
        const res = await firebaseService.sendClassifiedMulticast({
          tokens,
          title: notification.title,
          body: notification.body,
          data: notification.data,
        });
        // Success once at least one device accepted it (or nothing was left to
        // send). Remaining retryable failures keep the event in the retry loop;
        // invalid tokens are handed back for deactivation.
        const success =
          res.successCount > 0 || res.retryableTokens.length === 0;
        return {
          success,
          invalidTokens: res.invalidTokens,
          error: res.error ?? (success ? undefined : "delivery_failed"),
        };
      },
    },
    state: {
      async firstSightOfEvent(eventId: string): Promise<boolean> {
        const set = await commands.set(
          `${SEEN_PREFIX}${eventId}`,
          "1",
          "EX",
          SEEN_TTL_SECONDS,
          "NX",
        );
        return set === "OK";
      },
      async advanceSubjectSequence(
        subjectKey: string,
        sequence: number,
      ): Promise<boolean> {
        const result = (await commands.eval(
          ADVANCE_SEQ_LUA,
          1,
          `${SEQ_PREFIX}${subjectKey}`,
          String(sequence),
          String(SEQ_TTL_SECONDS),
        )) as number;
        return result === 1;
      },
    },
    deadLetters: {
      async record(entry: DeadLetterEntry): Promise<void> {
        await commands
          .multi()
          .rpush(
            DLQ_KEY,
            JSON.stringify({ ...entry, at: new Date().toISOString() }),
          )
          .ltrim(DLQ_KEY, -DLQ_MAX, -1)
          .exec();
      },
    },
    pending: {
      async record(entry: PendingEntry): Promise<void> {
        await commands
          .multi()
          .rpush(
            PENDING_KEY,
            JSON.stringify({ ...entry, at: new Date().toISOString() }),
          )
          .ltrim(PENDING_KEY, -PENDING_MAX, -1)
          .exec();
      },
    },
    logger: pushLogger,
  };
}

/**
 * Wire the notification service to the marketplace outbox stream. `subscriber`
 * is a dedicated ioredis connection (subscribeOutbox puts it in subscriber
 * mode and duplicates it for its own dedupe SET); `commands` is an ordinary
 * connection used by the ports.
 */
export async function subscribeMarketplacePush(
  subscriber: Redis,
  commands: Redis,
): Promise<OutboxSubscription> {
  const deliverer = new MarketplacePushDeliverer(
    buildMarketplacePushPorts(commands),
  );

  const subscription = await subscribeOutbox(
    subscriber,
    MARKETPLACE_PUSH_PATTERN,
    async (envelope) => {
      const result = await deliverer.handle(envelope);
      if (result.outcome === "processed" && result.perUser.length > 0) {
        pushLogger.debug(
          {
            eventName: result.eventName,
            eventId: result.eventId,
            outcomes: result.perUser.map((u) => u.outcome),
          },
          "marketplace push processed",
        );
      }
    },
    {
      // The outbox helper also dedupes on id; the deliverer's own dedupe covers
      // direct calls and a wider window. Both are cheap Redis SET NX.
      dedupeKeyPrefix: "notif:mp:outbox:",
      onError: (err, channel) => {
        // Raw message is not logged: it may carry payload data.
        pushLogger.error(
          { err, channel },
          "marketplace outbox message dropped (invalid envelope or handler error)",
        );
      },
    },
  );

  pushLogger.info(
    { pattern: MARKETPLACE_PUSH_PATTERN },
    "Subscribed to marketplace outbox push events",
  );
  return subscription;
}

/**
 * Convenience for the composition root: open a dedicated subscriber connection
 * and a commands connection from REDIS_URL and start the subscription. Returns
 * a stop() that tears both down.
 */
export async function startMarketplacePush(
  redisUrl: string,
): Promise<{ stop: () => Promise<void> }> {
  const subscriber = new Redis(redisUrl);
  const commands = new Redis(redisUrl);
  const subscription = await subscribeMarketplacePush(subscriber, commands);
  return {
    async stop(): Promise<void> {
      try {
        await subscription.stop();
      } finally {
        await Promise.allSettled([subscriber.quit(), commands.quit()]);
      }
    },
  };
}
