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
import { createHash } from "node:crypto";

import { Redis } from "ioredis";

import { subscribeOutbox, type OutboxSubscription } from "@ubi/outbox";

import { SqlPartyDirectory, type PartyDirectory } from "./parties.js";
import {
  MarketplacePushDeliverer,
  type DeadLetterEntry,
  type InboxEntry,
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
import type { NotificationType, Prisma } from "@prisma/client";

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
  /** null disables in-app inbox persistence. */
  readonly inbox?: MarketplacePushPorts["inbox"] | null;
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PRISMA_NOTIFICATION_TYPES = new Set<string>([
  "WELCOME",
  "OTP",
  "EMAIL_VERIFICATION",
  "PASSWORD_RESET",
  "SECURITY_ALERT",
  "ACCOUNT_LOCKED",
  "MARKETING",
  "PROMO_CODE",
  "RIDE_REQUESTED",
  "RIDE_ACCEPTED",
  "RIDE_STARTED",
  "RIDE_COMPLETED",
  "DRIVER_ARRIVING",
  "DRIVER_ARRIVED",
  "ORDER_PLACED",
  "ORDER_CONFIRMED",
  "ORDER_PREPARING",
  "ORDER_DELIVERED",
  "FOOD_ORDER_CONFIRMED",
  "FOOD_PREPARING",
  "FOOD_READY_FOR_PICKUP",
  "FOOD_OUT_FOR_DELIVERY",
  "FOOD_DELIVERED",
  "DELIVERY_CREATED",
  "DELIVERY_PICKED_UP",
  "DELIVERY_IN_TRANSIT",
  "DELIVERY_COMPLETED",
  "DELIVERY_DELIVERED",
  "PAYMENT_RECEIVED",
  "PAYMENT_SUCCESSFUL",
  "PAYMENT_FAILED",
  "REFUND_PROCESSED",
  "SOS_ALERT",
  "GENERAL",
]);

export function deterministicUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function toPrismaNotificationType(
  raw: string | undefined,
): NotificationType {
  if (!raw) {
    return "GENERAL";
  }
  const upper = raw.toUpperCase();
  if (PRISMA_NOTIFICATION_TYPES.has(upper)) {
    return upper as NotificationType;
  }
  if (raw.startsWith("mp.award.") || raw.startsWith("mp.bid.won")) {
    return "RIDE_ACCEPTED";
  }
  if (raw.startsWith("mp.settlement.")) {
    return "PAYMENT_RECEIVED";
  }
  if (raw.startsWith("shipment.")) {
    return "DELIVERY_IN_TRANSIT";
  }
  return "GENERAL";
}

export function deterministicMpDlqId(
  entry: Pick<DeadLetterEntry, "eventId" | "role" | "userId" | "channel">,
): string {
  const digest = createHash("sha256")
    .update(
      `${entry.eventId}:${entry.role ?? ""}:${entry.userId}:${entry.channel ?? "push"}`,
    )
    .digest("hex")
    .slice(0, 20);
  return `dlq_mp_${digest}`;
}

function deterministicInboxId(eventId: string, userId: string): string {
  return deterministicUuid(`inbox:${eventId}:${userId}`);
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
        userId: string,
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
        if (UUID_RE.test(userId)) {
          const now = new Date();
          await prisma.notificationLog
            .create({
              data: {
                userId,
                channel: "PUSH",
                type: toPrismaNotificationType(notification.type),
                title: notification.title,
                body: notification.body,
                data: notification.data as Prisma.InputJsonValue,
                status: success ? "SENT" : "FAILED",
                sentAt: success ? now : null,
                failedAt: success ? null : now,
                failureReason:
                  res.error ?? (success ? null : "delivery_failed"),
              },
            })
            .catch(() => undefined);
        }
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
        const id = entry.id ?? deterministicMpDlqId(entry);
        const at = entry.at ?? new Date().toISOString();
        await commands
          .multi()
          .rpush(`${prefix}dlq`, JSON.stringify({ ...entry, id, at }))
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
            JSON.stringify({
              ...entry,
              at: entry.at ?? new Date().toISOString(),
            }),
          )
          .ltrim(`${prefix}pending`, -PENDING_MAX, -1)
          .exec();
      },
    },
    ...(overrides.inbox === null
      ? {}
      : {
          inbox: overrides.inbox ?? {
            async record(entry: InboxEntry): Promise<void> {
              if (!UUID_RE.test(entry.userId)) {
                return;
              }
              const pref = await preferenceRow(entry.userId);
              if (pref && !pref.inAppEnabled) {
                return;
              }
              const id = deterministicInboxId(entry.eventId, entry.userId);
              await prisma.inAppNotification.upsert({
                where: { id },
                update: {},
                create: {
                  id,
                  userId: entry.userId,
                  type: toPrismaNotificationType(entry.notification.type),
                  title: entry.notification.title,
                  body: entry.notification.body,
                  data: {
                    ...entry.notification.data,
                    eventType: entry.notification.type,
                    role: entry.role,
                  } as Prisma.InputJsonValue,
                },
              });
              const unreadCount = await prisma.inAppNotification.count({
                where: { userId: entry.userId, readAt: null },
              });
              await commands.set(
                `user:${entry.userId}:badge`,
                unreadCount,
                "EX",
                SEEN_TTL_SECONDS,
              );
            },
          },
        }),
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

/**
 * Short-window flush window (15 minutes): events older than this are stale by
 * the time a device registers (offer/trip state has moved on and REST snapshot
 * refresh reconciles), so they are dropped rather than spammed.
 */
export const DEFAULT_PENDING_FLUSH_WINDOW_MS = 15 * 60_000;
const FLUSH_SCAN_TAIL = 500;

export interface FlushPendingResult {
  readonly flushed: number;
  readonly skippedExpired: number;
  readonly skippedDuplicate: number;
}

/**
 * Reconciles recent notifications deferred while `userId` had no active push
 * device (`no_active_device` / `all_tokens_invalidated`, CC-B04 / P1-13).
 *
 * Guarantees:
 * - Short-window only (`windowMs`, default 15 min): stale entries are removed
 *   without pushing.
 * - Zero duplicates: each `(userId, eventId)` is claimed atomically via
 *   `SET notif:mp:flushed:<userId>:<eventId> 1 EX 86400 NX` before sending, so
 *   concurrent or repeated `POST /push/devices` calls never send twice.
 * - Preference-aware: honours `ports.prefs.allows` at flush time.
 */
export async function flushPendingForUser(
  commands: Redis,
  userId: string,
  options: {
    readonly overrides?: PushPortOverrides;
    readonly windowMs?: number;
    readonly now?: Date;
  } = {},
): Promise<FlushPendingResult> {
  const ports = buildMarketplacePushPorts(commands, options.overrides);
  const prefix = options.overrides?.keyPrefix ?? DEFAULT_KEY_PREFIX;
  const windowMs = options.windowMs ?? DEFAULT_PENDING_FLUSH_WINDOW_MS;
  const nowMs = (options.now ?? new Date()).getTime();

  let tokens = await ports.devices.activeTokens(userId);
  if (tokens.length === 0) {
    return { flushed: 0, skippedExpired: 0, skippedDuplicate: 0 };
  }

  const rawItems = await commands.lrange(
    `${prefix}pending`,
    -FLUSH_SCAN_TAIL,
    -1,
  );
  let flushed = 0;
  let skippedExpired = 0;
  let skippedDuplicate = 0;

  for (const raw of rawItems) {
    let entry: PendingEntry;
    try {
      entry = JSON.parse(raw) as PendingEntry;
    } catch {
      continue;
    }
    if (entry.userId !== userId || !entry.notification) {
      continue;
    }

    const recordedMs = entry.at ? Date.parse(entry.at) : Number.NaN;
    if (!Number.isFinite(recordedMs) || nowMs - recordedMs > windowMs) {
      skippedExpired += 1;
      await commands.lrem(`${prefix}pending`, 1, raw);
      continue;
    }

    const category: PushPrefCategory = entry.prefCategory ?? "ride";
    if (!(await ports.prefs.allows(userId, category))) {
      await commands.lrem(`${prefix}pending`, 1, raw);
      continue;
    }

    const claimKey = `${prefix}flushed:${userId}:${entry.eventId}`;
    const claimed = await commands.set(
      claimKey,
      "1",
      "EX",
      SEEN_TTL_SECONDS,
      "NX",
    );
    if (claimed !== "OK") {
      skippedDuplicate += 1;
      await commands.lrem(`${prefix}pending`, 1, raw);
      continue;
    }

    let sendRes: PushSendResult;
    try {
      sendRes = await ports.sender.send(userId, tokens, entry.notification);
    } catch (err) {
      sendRes = {
        success: false,
        error: err instanceof Error ? err.message : "flush_send_threw",
      };
    }

    if (sendRes.invalidTokens && sendRes.invalidTokens.length > 0) {
      await ports.devices.deactivate(sendRes.invalidTokens);
      const invalid = new Set(sendRes.invalidTokens);
      tokens = tokens.filter((t) => !invalid.has(t));
    }

    if (sendRes.success) {
      flushed += 1;
      await commands.lrem(`${prefix}pending`, 1, raw);
    } else {
      // Release the claim so a subsequent registration within the window can
      // still retry.
      await commands.del(claimKey);
    }

    if (tokens.length === 0) {
      break;
    }
  }

  return { flushed, skippedExpired, skippedDuplicate };
}
