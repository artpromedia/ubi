/**
 * Production wiring for the passenger trip-link SMS (TRIP-LINK SEALED
 * DELIVERY CONTRACT, consumer side).
 *
 * Pattern-subscribes to `event:trip_access.*` on the shared outbox relay and
 * drives TripAccessSmsDeliverer with real ports: Redis for the per-token claim
 * and outcome markers, the revocation markers and the dead-letter list; the
 * Africa's Talking / Twilio SMS service for delivery.
 *
 * FAIL CLOSED: without a usable TRIP_ACCESS_DELIVERY_KEY/_KID pair, or without
 * a usable PASSENGER_TRIP_LINK_BASE_URL, the consumer is NOT started — an alert
 * is logged, no subscription is made, and nothing is ever sent. (ride-service
 * refuses to issue guest trip links without its key, so nothing is lost in
 * clear either way.)
 *
 * Keys (prefix `notif:trip_access:`): `sms:<tokenId>` = pending | sent | dead |
 * revoked | expired; `revoked:<tokenId>`; `dlq` (JSON entries: ids, reason,
 * masked phone, the still-sealed envelope). To replay a dead-lettered
 * delivery once its cause is fixed, delete `sms:<tokenId>` and re-publish the
 * event rebuilt from the entry — the per-token marker is what makes a
 * redelivery a no-op.
 */
import { Redis } from "ioredis";

import { subscribeOutbox, type OutboxSubscription } from "@ubi/outbox";

import {
  TripAccessSmsDeliverer,
  type TripAccessDeadLetter,
  type TripAccessFinal,
  type TripAccessLogger,
  type TripAccessSmsPorts,
} from "./deliverer.js";
import { loadTripAccessKeyRing, type TripAccessKeyRing } from "./sealed.js";
import { smsLogger } from "../lib/logger.js";
import { smsSender, type SmsSender } from "../providers/sms.js";

/** Redis glob pattern for the trip-access event-type channels. */
export const TRIP_ACCESS_PATTERN = "event:trip_access.*";

export const PASSENGER_TRIP_LINK_BASE_URL_ENV = "PASSENGER_TRIP_LINK_BASE_URL";

const DEFAULT_KEY_PREFIX = "notif:trip_access:";
/** A claim outlives any realistic send-with-retries, then lapses for a retry. */
const CLAIM_TTL_SECONDS = 15 * 60;
/** Outcome/revocation markers outlive the 12h link by a wide margin. */
const OUTCOME_TTL_SECONDS = 2 * 86_400;
const DLQ_MAX = 10_000;

export interface TripAccessConfig {
  readonly ring: TripAccessKeyRing;
  readonly linkBaseUrl: string;
  readonly warnings: readonly string[];
}

export type TripAccessConfigResult =
  | ({ readonly ok: true } & TripAccessConfig)
  | { readonly ok: false; readonly reason: string };

/**
 * The link base must be an absolute URL with no fragment of its own (the
 * token IS the fragment). https is required in production.
 */
function validateLinkBase(
  raw: string | undefined,
  production: boolean,
): { ok: true; url: string } | { ok: false; reason: string } {
  const value = (raw ?? "").trim();
  if (value === "") {
    return {
      ok: false,
      reason: `${PASSENGER_TRIP_LINK_BASE_URL_ENV} is not configured`,
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return {
      ok: false,
      reason: `${PASSENGER_TRIP_LINK_BASE_URL_ENV} is not an absolute URL`,
    };
  }
  if (value.includes("#")) {
    return {
      ok: false,
      reason: `${PASSENGER_TRIP_LINK_BASE_URL_ENV} must not contain a fragment`,
    };
  }
  const allowed = production ? ["https:"] : ["https:", "http:"];
  if (!allowed.includes(parsed.protocol)) {
    return {
      ok: false,
      reason: `${PASSENGER_TRIP_LINK_BASE_URL_ENV} must use ${allowed.join(" or ")}`,
    };
  }
  return { ok: true, url: value };
}

/** Everything the consumer needs, or the reason it must not start. */
export function loadTripAccessConfig(
  env: Readonly<Record<string, string | undefined>>,
): TripAccessConfigResult {
  const keys = loadTripAccessKeyRing(env);
  if (!keys.ok) {
    return { ok: false, reason: keys.reason };
  }
  const link = validateLinkBase(
    env[PASSENGER_TRIP_LINK_BASE_URL_ENV],
    env.NODE_ENV === "production",
  );
  if (!link.ok) {
    return { ok: false, reason: link.reason };
  }
  return {
    ok: true,
    ring: keys.ring,
    linkBaseUrl: link.url,
    warnings: keys.warnings,
  };
}

export function buildTripAccessPorts(
  commands: Redis,
  config: TripAccessConfig,
  options: {
    readonly sms?: SmsSender;
    readonly logger?: TripAccessLogger;
    readonly keyPrefix?: string;
  } = {},
): TripAccessSmsPorts {
  const prefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
  const smsKey = (tokenId: string): string => `${prefix}sms:${tokenId}`;
  const revokedKey = (tokenId: string): string => `${prefix}revoked:${tokenId}`;
  const dlqKey = `${prefix}dlq`;
  return {
    keys: config.ring,
    linkBaseUrl: config.linkBaseUrl,
    sms: options.sms ?? smsSender,
    state: {
      async claim(tokenId: string): Promise<boolean> {
        const set = await commands.set(
          smsKey(tokenId),
          "pending",
          "EX",
          CLAIM_TTL_SECONDS,
          "NX",
        );
        return set === "OK";
      },
      async finish(tokenId: string, outcome: TripAccessFinal): Promise<void> {
        await commands.set(smsKey(tokenId), outcome, "EX", OUTCOME_TTL_SECONDS);
      },
      async markRevoked(tokenId: string): Promise<void> {
        await commands.set(revokedKey(tokenId), "1", "EX", OUTCOME_TTL_SECONDS);
      },
      async isRevoked(tokenId: string): Promise<boolean> {
        return (await commands.exists(revokedKey(tokenId))) === 1;
      },
    },
    deadLetters: {
      async record(entry: TripAccessDeadLetter): Promise<void> {
        await commands
          .multi()
          .rpush(
            dlqKey,
            JSON.stringify({ ...entry, at: new Date().toISOString() }),
          )
          .ltrim(dlqKey, -DLQ_MAX, -1)
          .exec();
      },
    },
    logger: options.logger ?? smsLogger,
  };
}

/**
 * Subscribe the deliverer to the trip-access stream. `subscriber` is a
 * dedicated connection (put in subscriber mode; it must not carry any other
 * pattern, because the outbox helper's listener sees every pattern on it).
 */
export async function subscribeTripAccessSms(
  subscriber: Redis,
  ports: TripAccessSmsPorts,
  options: { readonly dedupeKeyPrefix?: string } = {},
): Promise<OutboxSubscription> {
  const deliverer = new TripAccessSmsDeliverer(ports);
  const subscription = await subscribeOutbox(
    subscriber,
    TRIP_ACCESS_PATTERN,
    async (envelope) => {
      if (!envelope.name.startsWith("trip_access.")) {
        return; // defensive: only this family is ours
      }
      await deliverer.handle(envelope);
    },
    {
      dedupeKeyPrefix:
        options.dedupeKeyPrefix ?? `${DEFAULT_KEY_PREFIX}outbox:`,
      onError: (err, channel) => {
        // The raw message is never logged (the outbox helper passes it; it
        // may carry payload data). A ZodError here lists paths, not values.
        ports.logger.error(
          {
            alert: "trip_access_message_dropped",
            channel,
            err: err instanceof Error ? err.message : "handler error",
          },
          "trip access outbox message dropped (invalid envelope or handler error)",
        );
      },
    },
  );
  ports.logger.info(
    { pattern: TRIP_ACCESS_PATTERN, kids: ports.keys.kids },
    "Subscribed to trip access outbox events (passenger trip link SMS)",
  );
  return subscription;
}

export interface TripAccessSmsHandle {
  stop(): Promise<void>;
}

/**
 * Composition root: validate the configuration FIRST and refuse to start
 * without it (alert logged, no Redis connection opened, nothing sent).
 */
export async function startTripAccessSms(options: {
  readonly redisUrl: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly sms?: SmsSender;
  readonly logger?: TripAccessLogger;
  readonly keyPrefix?: string;
}): Promise<TripAccessSmsHandle | null> {
  const logger = options.logger ?? smsLogger;
  const config = loadTripAccessConfig(options.env);
  if (!config.ok) {
    logger.error(
      { alert: "trip_access_consumer_not_started", reason: config.reason },
      "Passenger trip link SMS consumer NOT started: sealed delivery is not configured; no trip link SMS will be sent",
    );
    return null;
  }
  for (const warning of config.warnings) {
    logger.warn(
      { alert: "trip_access_previous_key_ignored", warning },
      warning,
    );
  }

  const subscriber = new Redis(options.redisUrl);
  const commands = new Redis(options.redisUrl);
  try {
    const ports = buildTripAccessPorts(commands, config, {
      sms: options.sms,
      logger,
      keyPrefix: options.keyPrefix,
    });
    const subscription = await subscribeTripAccessSms(subscriber, ports, {
      dedupeKeyPrefix: `${options.keyPrefix ?? DEFAULT_KEY_PREFIX}outbox:`,
    });
    return {
      async stop(): Promise<void> {
        try {
          await subscription.stop();
        } finally {
          await Promise.allSettled([subscriber.quit(), commands.quit()]);
        }
      },
    };
  } catch (err) {
    await Promise.allSettled([subscriber.quit(), commands.quit()]);
    throw err;
  }
}
