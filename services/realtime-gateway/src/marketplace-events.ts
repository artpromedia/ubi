/**
 * Marketplace (mp.*) outbox event fan-out.
 *
 * Subscribes to the `event:mp.*` Redis channels published by the shared
 * @ubi/outbox relay, translates each validated EventEnvelope into a
 * client-facing `marketplace_event` WebSocketMessage, and pushes it to the
 * authorized audience only:
 *
 *   - `requesterId` / `driverId` / `driverIds` payload keys name recipients.
 *   - Bid events (`mp.bid.*`) are private between the requester and the
 *     bidding driver — rival bidders must NEVER see them, so recipient lists
 *     are ignored for that family.
 *   - `mp.request.published` / `mp.request.closed` go to the drivers the
 *     engine named in `payload.audienceDriverIds` when present (eligibility
 *     is computed server-side by the marketplace engine — the gateway must
 *     not guess) and otherwise only to the requester.
 *   - Events with no resolvable audience are dropped, never broadcast.
 *   - The dedicated settlement event `mp.settlement.posted` (G15) needs no
 *     per-name wiring: it matches the `event:mp.*` pattern and its
 *     requester/driver payload resolves through the default audience branch, so
 *     the gateway recognizes it the moment payment-service emits it. The legacy
 *     `transfer.posted` / `payment.cash_acknowledged` names are off the mp.*
 *     channel and remain the payment/notification surfaces' concern.
 *
 * Cross-instance note: subscribeOutbox dedupes on envelope.id via a shared
 * Redis SET NX, so exactly one gateway instance handles each event;
 * broadcastToUser then fans out to every instance via the user:{userId}
 * channels.
 */

import type { Redis } from "ioredis";
import type { EventEnvelope } from "@ubi/contracts";
import { subscribeOutbox, type OutboxSubscription } from "@ubi/outbox";
import type { ConnectionManager } from "./connection-manager.js";
import { logger as rootLogger } from "./lib/logger.js";
import type { WebSocketMessage } from "./types/index.js";

const logger = rootLogger.child({ component: "marketplace-events" });

/** Redis glob pattern for marketplace event-type channels. */
export const MARKETPLACE_EVENT_PATTERN = "event:mp.*";

/**
 * Payload keys that name recipients. The recipient LISTS are stripped from
 * the client-facing `data` so one recipient never learns who else was
 * addressed (e.g. the set of eligible/rival drivers).
 */
const RECIPIENT_LIST_KEYS = ["driverIds", "audienceDriverIds"] as const;

function asId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
}

/**
 * Resolve the set of userIds authorized to receive this envelope.
 * Returns an empty array when no audience is resolvable — the caller must
 * drop the event rather than broadcast it.
 */
export function resolveAudience(envelope: EventEnvelope): string[] {
  const payload = envelope.payload;
  const requesterId = asId(payload.requesterId);
  const driverId = asId(payload.driverId);
  const audience = new Set<string>();

  if (envelope.name.startsWith("mp.bid.")) {
    // Bids are private between the requester and the bidding driver.
    // Recipient lists are deliberately ignored so a bid event can never
    // reach rival bidders.
    if (requesterId) audience.add(requesterId);
    if (driverId) audience.add(driverId);
    return [...audience];
  }

  if (
    envelope.name === "mp.request.published" ||
    envelope.name === "mp.request.closed"
  ) {
    // The engine computes driver eligibility; the gateway must not guess.
    const eligibleDrivers = asIdArray(payload.audienceDriverIds);
    if (requesterId) audience.add(requesterId);
    for (const id of eligibleDrivers) audience.add(id);
    return [...audience];
  }

  if (requesterId) audience.add(requesterId);
  if (driverId) audience.add(driverId);
  for (const id of asIdArray(payload.driverIds)) audience.add(id);
  return [...audience];
}

/**
 * Translate an outbox EventEnvelope into the client-facing
 * `marketplace_event` WebSocket message.
 */
export function translateEnvelope(envelope: EventEnvelope): WebSocketMessage {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(envelope.payload)) {
    if ((RECIPIENT_LIST_KEYS as readonly string[]).includes(key)) continue;
    data[key] = value;
  }

  const requestId =
    asId(envelope.payload.requestId) ??
    (envelope.subject.type === "mp_request" ? envelope.subject.id : undefined);
  const revision =
    typeof envelope.payload.revision === "number" &&
    Number.isInteger(envelope.payload.revision)
      ? envelope.payload.revision
      : undefined;

  return {
    type: "marketplace_event",
    payload: {
      name: envelope.name,
      subject: { type: envelope.subject.type, id: envelope.subject.id },
      ...(requestId !== undefined ? { requestId } : {}),
      ...(revision !== undefined ? { revision } : {}),
      ...(envelope.sequence !== undefined ? { seq: envelope.sequence } : {}),
      occurredAt: envelope.occurredAt,
      data,
    },
  };
}

/**
 * Route one validated marketplace envelope to its audience.
 * Exported for tests; production traffic arrives via
 * `subscribeMarketplaceEvents`.
 */
export async function handleMarketplaceEnvelope(
  connectionManager: Pick<ConnectionManager, "broadcastToUser">,
  envelope: EventEnvelope,
): Promise<void> {
  if (!envelope.name.startsWith("mp.")) {
    // Defensive: the pattern should only match mp.* channels.
    return;
  }

  const audience = resolveAudience(envelope);
  if (audience.length === 0) {
    logger.warn(
      { eventName: envelope.name, eventId: envelope.id },
      "Marketplace event dropped: no resolvable audience",
    );
    return;
  }

  const message = translateEnvelope(envelope);
  await Promise.all(
    audience.map((userId) =>
      connectionManager.broadcastToUser(userId, message),
    ),
  );

  logger.debug(
    {
      eventName: envelope.name,
      eventId: envelope.id,
      recipients: audience.length,
    },
    "Marketplace event fanned out",
  );
}

/**
 * Wire the gateway to the marketplace outbox stream.
 *
 * @param subscriber - a dedicated ioredis connection; subscribeOutbox puts it
 *   in subscriber mode and duplicates it internally for dedupe commands.
 */
export async function subscribeMarketplaceEvents(
  subscriber: Redis,
  connectionManager: Pick<ConnectionManager, "broadcastToUser">,
): Promise<OutboxSubscription> {
  const subscription = await subscribeOutbox(
    subscriber,
    MARKETPLACE_EVENT_PATTERN,
    async (envelope) => {
      await handleMarketplaceEnvelope(connectionManager, envelope);
    },
    {
      onError: (err, channel) => {
        // Raw message is intentionally not logged: it may carry payload data.
        logger.error(
          { err, channel },
          "Marketplace outbox message dropped (invalid envelope or handler error)",
        );
      },
    },
  );

  logger.info(
    { pattern: MARKETPLACE_EVENT_PATTERN },
    "Subscribed to marketplace outbox events",
  );

  return subscription;
}
