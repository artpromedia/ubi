/**
 * Marketing-site revalidation consumer.
 *
 * The marketing site caches what it reads from this service for five minutes.
 * Whenever a config version is activated, a flag changes or a city's launch
 * status changes, this consumer asks the site to purge that cache, so a
 * service that switches on is reflected within one request. It reuses the
 * shared outbox subscriber (idempotent on event id) and calls the site's
 * `POST /api/revalidate` with a shared secret.
 *
 * Disabled unless MARKETING_REVALIDATE_URL and MARKETING_REVALIDATE_SECRET are
 * set. A failed call is retried with backoff and then logged; the next event
 * or the five-minute window catches up. Nothing from the payload is logged.
 */
import { type OutboxSubscription, subscribeOutbox } from "@ubi/outbox";

import { logger } from "./lib/logger";
import { redis } from "./lib/redis";

import type { EventEnvelope } from "@ubi/contracts";

export const REVALIDATING_EVENTS: ReadonlySet<string> = new Set([
  "config.version_activated",
  "flag.changed",
  "city.status_changed",
]);

export interface MarketingRevalidatorOptions {
  readonly url: string;
  readonly secret: string;
  readonly fetch?: typeof fetch;
  readonly attempts?: number;
  readonly backoffMs?: number;
  readonly log?: Pick<typeof logger, "info" | "warn" | "error">;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface MarketingRevalidator {
  /** Returns true when the site acknowledged the purge. */
  handle(
    envelope: Pick<EventEnvelope, "id" | "name" | "cityId">,
  ): Promise<boolean>;
}

const defaultSleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

export function createMarketingRevalidator(
  options: MarketingRevalidatorOptions,
): MarketingRevalidator {
  const doFetch = options.fetch ?? fetch;
  const attempts = options.attempts ?? 3;
  const backoffMs = options.backoffMs ?? 500;
  const log =
    options.log ?? logger.child({ component: "marketing-revalidate" });
  const sleep = options.sleep ?? defaultSleep;

  return {
    async handle(envelope): Promise<boolean> {
      if (!REVALIDATING_EVENTS.has(envelope.name)) {
        return false;
      }
      const body = JSON.stringify({
        tags: ["availability"],
        reason: envelope.name,
      });
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const response = await doFetch(options.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${options.secret}`,
            },
            body,
          });
          if (response.ok) {
            log.info(
              { event: envelope.name, cityId: envelope.cityId, attempt },
              "marketing cache revalidated",
            );
            return true;
          }
          // 401/403/422 will not improve with a retry.
          if (response.status < 500 && response.status !== 429) {
            log.error(
              { event: envelope.name, status: response.status },
              "marketing revalidation refused",
            );
            return false;
          }
          log.warn(
            { event: envelope.name, status: response.status, attempt },
            "marketing revalidation failed; retrying",
          );
        } catch (err) {
          log.warn(
            { err, event: envelope.name, attempt },
            "marketing revalidation unreachable; retrying",
          );
        }
        if (attempt < attempts) {
          await sleep(backoffMs * 2 ** (attempt - 1));
        }
      }
      log.error(
        { event: envelope.name, eventId: envelope.id },
        "marketing revalidation gave up; the site catches up within its cache window",
      );
      return false;
    },
  };
}

/**
 * Subscribes to every outbox event and forwards the revalidating ones. Returns
 * undefined when the consumer is not configured for this deployment.
 */
export async function startMarketingRevalidation(): Promise<
  OutboxSubscription | undefined
> {
  const url = process.env.MARKETING_REVALIDATE_URL?.trim();
  const secret = process.env.MARKETING_REVALIDATE_SECRET?.trim();
  if (!url || !secret) {
    logger.info(
      { component: "marketing-revalidate" },
      "marketing revalidation disabled (MARKETING_REVALIDATE_URL / MARKETING_REVALIDATE_SECRET unset)",
    );
    return undefined;
  }
  const revalidator = createMarketingRevalidator({ url, secret });
  // A subscriber connection cannot run commands, so the consumer gets its own.
  const subscriber = redis.duplicate();
  const subscription = await subscribeOutbox(
    subscriber,
    "event:*",
    async (envelope) => {
      await revalidator.handle(envelope);
    },
    {
      dedupeKeyPrefix: "outbox:seen:marketing:",
      onError: (err, channel) => {
        logger.error(
          { err, channel, component: "marketing-revalidate" },
          "marketing revalidation consumer error",
        );
      },
    },
  );
  logger.info(
    { component: "marketing-revalidate" },
    "marketing revalidation consumer started",
  );
  return {
    async stop(): Promise<void> {
      await subscription.stop();
      await subscriber.quit();
    },
  };
}
