/**
 * Production wiring for durable outbox push (G10; round 2-6 events).
 *
 * Subscribes to the canonical outbox channels the notification table covers
 * (NOTIFICATION_PATTERNS: `event:mp.*` — the same stream realtime-gateway
 * consumes — plus `event:trip_access.declined`, `event:reservation.*` and
 * `event:shipment.return_proposed`) and drives MarketplacePushDeliverer with
 * real ports: Prisma for device tokens, preferences, the party directory and
 * verified phones; the Firebase provider for push; the SMS service for the
 * time-critical fallback; Redis for dedupe, per-subject ordering, the
 * dead-letter queue and the offline-retry pending list. No new datastore is
 * introduced — Redis is already the service's cache/pubsub/rate-limit store.
 *
 * One subscriber connection PER PATTERN: the outbox helper's pmessage
 * listener does not filter by pattern, so two patterns on one connection
 * would hand every message to every handler.
 */
import { Redis } from "ioredis";

import { subscribeOutbox, type OutboxSubscription } from "@ubi/outbox";

import { SqlPartyDirectory, type PartyDirectory } from "./parties.js";
import {
  MarketplacePushDeliverer,
  type DeadLetterEntry,
  type MarketplacePushPorts,
  type PendingEntry,
  type PushLogger,
  type PushNotification,
  type PushSendResult,
} from "./push.js";
import { NOTIFICATION_PATTERNS } from "./specs.js";
import { pushLogger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { firebaseService } from "../providers/firebase.js";
import { smsSender } from "../providers/sms.js";

import type { PushPrefCategory } from "./audience.js";

/** Redis glob pattern for marketplace event-type channels. */
export const MARKETPLACE_PUSH_PATTERN = "event:mp.*";

export { NOTIFICATION_PATTERNS };

const DEFAULT_KEY_PREFIX = "notif:mp:";
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

/** Test seams: replace a production port (FCM, Prisma, SMS) with a fake. */
export interface PushPortOverrides {
  readonly devices?: MarketplacePushPorts["devices"];
  readonly prefs?: MarketplacePushPorts["prefs"];
  readonly sender?: MarketplacePushPorts["sender"];
  /** null disables the directory (payload ids only). */
  readonly parties?: PartyDirectory | null;
  /** null disables the SMS fallback. */
  readonly sms?: MarketplacePushPorts["sms"] | null;
  readonly logger?: PushLogger;
  /** Redis key namespace (default `notif:mp:`). */
  readonly keyPrefix?: string;
  readonly maxAttempts?: number;
  readonly delay?: (ms: number) => Promise<void>;
}

async function preferenceRow(userId: string) {
  const row = await prisma.notificationPreference.findUnique({
    where: { userId },
  });
  return row;
}

export function buildMarketplacePushPorts(
  commands: Redis,
  overrides: PushPortOverrides = {},
): MarketplacePushPorts {
  const prefix = overrides.keyPrefix ?? DEFAULT_KEY_PREFIX;
  const directory = new SqlPartyDirectory(prisma);
  return {
    devices: overrides.devices ?? {
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
    prefs: overrides.prefs ?? {
      async allows(
        userId: string,
        category: PushPrefCategory,
      ): Promise<boolean> {
        const pref = await preferenceRow(userId);
        // Documented default: with no preference row, marketplace push is
        // allowed (the rider/driver opted into the marketplace by using it).
        if (!pref) {
          return true;
        }
        if (!pref.pushEnabled) {
          return false;
        }
        if (category === "payment") {
          return pref.pushPaymentUpdates;
        }
        if (category === "delivery") {
          return pref.pushDeliveryUpdates;
        }
        return pref.pushRideUpdates;
      },
    },
    sender: overrides.sender ?? {
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
          `${prefix}seen:${eventId}`,
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
          `${prefix}seq:${subjectKey}`,
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
            `${prefix}dlq`,
            JSON.stringify({ ...entry, at: new Date().toISOString() }),
          )
          .ltrim(`${prefix}dlq`, -DLQ_MAX, -1)
          .exec();
      },
    },
    pending: {
      async record(entry: PendingEntry): Promise<void> {
        await commands
          .multi()
          .rpush(
            `${prefix}pending`,
            JSON.stringify({ ...entry, at: new Date().toISOString() }),
          )
          .ltrim(`${prefix}pending`, -PENDING_MAX, -1)
          .exec();
      },
    },
    logger: overrides.logger ?? pushLogger,
    ...(overrides.parties === null
      ? {}
      : { parties: overrides.parties ?? directory }),
    ...(overrides.sms === null
      ? {}
      : {
          sms: overrides.sms ?? {
            phones: directory,
            sender: smsSender,
            async allows(userId: string): Promise<boolean> {
              const pref = await preferenceRow(userId);
              // Same documented default as push: no row → allowed.
              return !pref || (pref.smsEnabled && pref.smsCriticalAlerts);
            },
          },
        }),
    ...(overrides.maxAttempts !== undefined
      ? { maxAttempts: overrides.maxAttempts }
      : {}),
    ...(overrides.delay !== undefined ? { delay: overrides.delay } : {}),
  };
}

/**
 * Wire the notification service to the outbox streams. `openSubscriber`
 * returns a NEW dedicated connection each call (one per pattern; subscribeOutbox
 * puts it in subscriber mode and duplicates it for its own dedupe SET);
 * `commands` is an ordinary connection used by the ports. stop() unsubscribes
 * every pattern and closes the connections this function opened.
 */
export async function subscribeMarketplacePush(
  openSubscriber: () => Redis,
  commands: Redis,
  options: {
    readonly overrides?: PushPortOverrides;
    readonly patterns?: readonly string[];
  } = {},
): Promise<OutboxSubscription> {
  const ports = buildMarketplacePushPorts(commands, options.overrides);
  const deliverer = new MarketplacePushDeliverer(ports);
  const prefix = options.overrides?.keyPrefix ?? DEFAULT_KEY_PREFIX;
  const patterns = options.patterns ?? NOTIFICATION_PATTERNS;

  const opened: Redis[] = [];
  const subscriptions: OutboxSubscription[] = [];
  const stopAll = async (): Promise<void> => {
    await Promise.allSettled(
      subscriptions.map(async (s) => {
        await s.stop();
      }),
    );
    await Promise.allSettled(
      opened.map(async (c) => {
        await c.quit();
      }),
    );
  };

  try {
    for (const pattern of patterns) {
      const subscriber = openSubscriber();
      opened.push(subscriber);
      subscriptions.push(
        await subscribeOutbox(
          subscriber,
          pattern,
          async (envelope) => {
            const result = await deliverer.handle(envelope);
            if (result.outcome === "processed") {
              ports.logger.debug(
                {
                  eventName: result.eventName,
                  eventId: result.eventId,
                  outcomes: result.perUser.map((u) => `${u.role}:${u.outcome}`),
                  unresolved: result.unresolved.map((u) => u.role),
                },
                "outbox notification processed",
              );
            }
          },
          {
            // The outbox helper also dedupes on id; the deliverer's own dedupe
            // covers direct calls and a wider window. Both are cheap SET NX.
            dedupeKeyPrefix: `${prefix}outbox:`,
            onError: (err, channel) => {
              // Raw message is not logged: it may carry payload data.
              ports.logger.error(
                {
                  channel,
                  err: err instanceof Error ? err.message : "handler error",
                },
                "outbox notification message dropped (invalid envelope or handler error)",
              );
            },
          },
        ),
      );
    }
  } catch (err) {
    await stopAll();
    throw err;
  }

  ports.logger.info(
    { patterns },
    "Subscribed to outbox notification events (push + SMS fallback)",
  );
  return { stop: stopAll };
}

/**
 * Convenience for the composition root: open the connections from REDIS_URL
 * and start the subscriptions. Returns a stop() that tears them all down.
 */
export async function startMarketplacePush(
  redisUrl: string,
): Promise<{ stop: () => Promise<void> }> {
  const commands = new Redis(redisUrl);
  try {
    const subscription = await subscribeMarketplacePush(
      () => new Redis(redisUrl),
      commands,
    );
    return {
      async stop(): Promise<void> {
        try {
          await subscription.stop();
        } finally {
          await commands.quit().catch(() => undefined);
        }
      },
    };
  } catch (err) {
    await commands.quit().catch(() => undefined);
    throw err;
  }
}
