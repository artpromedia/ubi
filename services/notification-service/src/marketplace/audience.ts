/**
 * Marketplace (mp.*) push audience + spec.
 *
 * This mirrors realtime-gateway's fan-out rules so the two surfaces agree on
 * who may learn what: bid events are private between the requester and the
 * bidding driver, and rival bidders never appear. It is deliberately a second
 * implementation rather than a shared import because the two services must be
 * able to diverge in transport without silently coupling their privacy rules —
 * the shared contract is the event catalog, not this function. The unit tests
 * assert the privacy invariants directly.
 */
import type { EventEnvelope } from "@ubi/contracts";

function asId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
}

/**
 * Resolve the userIds authorized to receive a push for this envelope. An empty
 * result means "notify no one" — the caller drops the event.
 */
export function resolveMarketplaceAudience(envelope: EventEnvelope): string[] {
  const payload = envelope.payload;
  const requesterId = asId(payload.requesterId);
  const driverId = asId(payload.driverId);
  const audience = new Set<string>();

  if (envelope.name.startsWith("mp.bid.")) {
    // Bids are private between the requester and the bidding driver. Recipient
    // LISTS are ignored so a bid push can never reach a rival bidder.
    if (requesterId) {
      audience.add(requesterId);
    }
    if (driverId) {
      audience.add(driverId);
    }
    return [...audience];
  }

  if (
    envelope.name === "mp.request.published" ||
    envelope.name === "mp.request.closed"
  ) {
    if (requesterId) {
      audience.add(requesterId);
    }
    for (const id of asIdArray(payload.audienceDriverIds)) {
      audience.add(id);
    }
    return [...audience];
  }

  if (requesterId) {
    audience.add(requesterId);
  }
  if (driverId) {
    audience.add(driverId);
  }
  for (const id of asIdArray(payload.driverIds)) {
    audience.add(id);
  }
  return [...audience];
}

/** Which preference category gates this push. */
export type PushPrefCategory = "ride" | "payment";

export interface MarketplacePushSpec {
  readonly title: string;
  readonly body: string;
  readonly prefCategory: PushPrefCategory;
  /** Notification type recorded on the log row. */
  readonly type: string;
}

/**
 * The closed set of marketplace events that produce a push, with the hint copy.
 *
 * The copy NEVER contains money or a PIN — a push is only a nudge to open the
 * app and pull the authoritative state over REST. Events absent from this map
 * are deliberately not pushed:
 *   - mp.bid.expired / invalidated / withdrawn  → an expired/void offer is not
 *     something to buzz a phone about (offer-expiry suppression);
 *   - mp.request.published / revised / reopened → drivers discover via the feed;
 *   - mp.award.pending / failed / cancelled, mp.commission.*, mp.claim.created /
 *     released, mp.rate_profile.saved → internal or non-actionable for a push.
 */
export const MARKETPLACE_PUSH_SPECS: Readonly<
  Record<string, MarketplacePushSpec>
> = {
  "mp.bid.submitted": {
    title: "New offer on your request",
    body: "A driver sent you an offer. Open UBI to review it.",
    prefCategory: "ride",
    type: "RIDE_REQUESTED",
  },
  "mp.bid.won": {
    title: "You won a request",
    body: "A rider chose your offer. Open UBI to see the job.",
    prefCategory: "ride",
    type: "RIDE_ACCEPTED",
  },
  "mp.bid.lost": {
    // No amount, no winner identity — just that this offer was not selected.
    title: "Requester chose another driver",
    body: "Your offer wasn’t selected this time. Open UBI to keep bidding.",
    prefCategory: "ride",
    type: "RIDE_REQUESTED",
  },
  "mp.award.confirmed": {
    title: "Your driver is confirmed",
    body: "Open UBI to see your pickup details.",
    prefCategory: "ride",
    type: "RIDE_ACCEPTED",
  },
  "mp.claim.promoted": {
    title: "Your driver is on the way",
    body: "Your queued trip is starting. Open UBI for your PIN and pickup.",
    prefCategory: "ride",
    type: "DRIVER_ARRIVED",
  },
  "mp.queue.eta_updated": {
    title: "Pickup ETA updated",
    body: "Your pickup estimate changed. Open UBI for the latest.",
    prefCategory: "ride",
    type: "RIDE_REQUESTED",
  },
  "mp.queue.window_missed": {
    title: "Pickup window update",
    body: "Your pickup is running late. Open UBI for your options.",
    prefCategory: "ride",
    type: "RIDE_REQUESTED",
  },
  "mp.settlement.posted": {
    title: "Ride settled",
    body: "Your marketplace ride was settled. Open UBI for the receipt.",
    prefCategory: "payment",
    type: "PAYMENT_SUCCESSFUL",
  },
};

/**
 * Build the hint DATA payload. This is the ONLY place the wire payload is
 * assembled, and it copies ONLY ids and the event type — never an amount, a
 * currency, a bid price or a PIN. Everything is a string (FCM data values must
 * be strings). The client uses these ids to pull the authoritative state.
 */
export function buildHintData(envelope: EventEnvelope): Record<string, string> {
  const requestId =
    (typeof envelope.payload.requestId === "string" &&
      envelope.payload.requestId) ||
    (envelope.subject.type === "mp_request" ? envelope.subject.id : "");
  const data: Record<string, string> = {
    kind: "marketplace",
    name: envelope.name,
    subjectType: envelope.subject.type,
    subjectId: envelope.subject.id,
  };
  if (requestId) {
    data.requestId = requestId;
  }
  if (typeof envelope.sequence === "number") {
    data.seq = String(envelope.sequence);
  }
  return data;
}
