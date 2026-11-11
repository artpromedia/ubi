/**
 * Marketplace (mp.*) outbox event fan-out.
 *
 * Subscribes to the `event:mp.*` Redis channels published by the shared
 * @ubi/outbox relay, translates each validated EventEnvelope into a
 * client-facing `marketplace_event` WebSocketMessage, and pushes a
 * role-filtered projection to the authorized audience only:
 *
 *   - `requesterId` / `driverId` / `driverIds` / `audienceDriverIds` name
 *     recipients, and each recipient is tagged with its audience role
 *     (`requester` or `driver`).
 *   - `translateEnvelope(envelope, role)` applies a closed per-event,
 *     per-role field allowlist (`MARKETPLACE_EVENT_SPECS`) and enforces the
 *     forbidden-key invariants (`FORBIDDEN_REQUESTER_KEYS` and
 *     `FORBIDDEN_DRIVER_KEYS`) so driver-private fields (`commissionMinor`,
 *     `netMinor`, `reservationId`, ...) never reach a requester and
 *     requester-private fields (rider/passenger PII, sealed tokens, business
 *     organization/cost-centre/payment details, recipient driver lists) never
 *     reach a driver.
 *   - Bid events (`mp.bid.*`) are private between the requester and the
 *     bidding driver — rival bidders must NEVER see them, so recipient lists
 *     are ignored for that family.
 *   - `mp.request.published` / `mp.request.closed` go to the drivers the
 *     engine named in `payload.audienceDriverIds` when present (eligibility
 *     is computed server-side by the marketplace engine — the gateway must
 *     not guess) and otherwise only to the requester.
 *   - Events with no resolvable audience or an unknown `mp.*` event name are
 *     dropped, never broadcast.
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

export type MarketplaceAudienceRole = "requester" | "driver";

export interface MarketplaceAudienceRecipient {
  userId: string;
  role: MarketplaceAudienceRole;
}

/**
 * Payload keys that name recipient lists. Never forwarded to any client.
 */
const RECIPIENT_LIST_KEYS = [
  "driverIds",
  "audienceDriverIds",
  "recipientDriverIds",
] as const;

/**
 * Keys that must NEVER appear in a requester-facing marketplace event payload.
 */
export const FORBIDDEN_REQUESTER_KEYS = [
  "commissionMinor",
  "netMinor",
  "driverNetMinor",
  "commissionBps",
  "reservationId",
  "holdId",
  "driverPayoutMinor",
  "fleetRemittanceMinor",
  "splitRule",
  "driverPhone",
  "driverEmail",
  "driverIds",
  "audienceDriverIds",
  "recipientDriverIds",
] as const;

/**
 * Keys that must NEVER appear in a driver-facing marketplace event payload.
 */
export const FORBIDDEN_DRIVER_KEYS = [
  "riderName",
  "riderFirstName",
  "riderLastName",
  "riderPhone",
  "riderEmail",
  "passengerPhone",
  "passengerFirstName",
  "sealed",
  "sealedToken",
  "organizationId",
  "costCentreId",
  "paymentMethod",
  "paymentMethodId",
  "fundingSource",
  "recipientDriverIds",
  "audienceDriverIds",
  "driverIds",
] as const;

const FORBIDDEN_REQUESTER_SET: ReadonlySet<string> = new Set(
  FORBIDDEN_REQUESTER_KEYS,
);
const FORBIDDEN_DRIVER_SET: ReadonlySet<string> = new Set(
  FORBIDDEN_DRIVER_KEYS,
);

export interface MarketplaceEventRoleSpec {
  readonly requester?: readonly string[];
  readonly driver?: readonly string[];
}

const REQUEST_COMMON_FIELDS = [
  "requestId",
  "requesterId",
  "revision",
  "routeRevision",
  "service",
  "vehicleClass",
  "fareMinor",
  "askedMinor",
  "requestedFareMinor",
  "minMinor",
  "maxMinor",
  "currency",
  "expiresAt",
  "step",
  "radiusMeters",
  "reason",
  "state",
] as const;

const BID_REQUESTER_FIELDS = [
  "bidId",
  "requestId",
  "requesterId",
  "requestRevision",
  "bidVersion",
  "amountMinor",
  "currency",
  "slot",
  "expiresAt",
  "state",
  "reason",
] as const;

const BID_DRIVER_FIELDS = [
  "bidId",
  "requestId",
  "requesterId",
  "driverId",
  "requestRevision",
  "bidVersion",
  "amountMinor",
  "commissionMinor",
  "netMinor",
  "currency",
  "slot",
  "reservationId",
  "dependsOnClaimId",
  "expiresAt",
  "state",
  "reason",
] as const;

const AWARD_REQUESTER_FIELDS = [
  "awardId",
  "requestId",
  "bidId",
  "requesterId",
  "driverId",
  "state",
  "slot",
  "fareMinor",
  "currency",
  "requestVersion",
  "bidVersion",
  "executionRef",
  "executionService",
  "executionId",
  "vehicleId",
  "failReason",
  "reason",
  "cancelledBy",
] as const;

const AWARD_DRIVER_FIELDS = [
  ...AWARD_REQUESTER_FIELDS,
  "commissionMinor",
  "netMinor",
  "reservationId",
  "claimId",
] as const;

const COMMISSION_DRIVER_FIELDS = [
  "reservationId",
  "holdId",
  "receiptId",
  "bidId",
  "awardId",
  "requestId",
  "driverId",
  "amountMinor",
  "commissionMinor",
  "fareMinor",
  "baseMinor",
  "commissionBps",
  "currency",
  "state",
  "kind",
  "reason",
] as const;

const CLAIM_DRIVER_FIELDS = [
  "claimId",
  "driverId",
  "awardId",
  "requestId",
  "slot",
  "service",
  "state",
  "dependsOnClaimId",
  "executionRef",
  "executionService",
  "executionId",
  "fencingToken",
  "availabilityEpoch",
  "reason",
] as const;

const QUEUE_SHARED_FIELDS = [
  "requestId",
  "awardId",
  "claimId",
  "requesterId",
  "driverId",
  "etaSeconds",
  "earliestSec",
  "latestSec",
  "etaVersion",
  "inWindow",
  "reason",
] as const;

const AMENDMENT_SHARED_FIELDS = [
  "amendmentId",
  "awardId",
  "requestId",
  "rideId",
  "requesterId",
  "driverId",
  "proposerRole",
  "state",
  "routeRevision",
  "fareRevision",
  "proposedFareMinor",
  "previousFareMinor",
  "deltaMinor",
  "currency",
  "reason",
  "expiresAt",
] as const;

const AMENDMENT_DRIVER_FIELDS = [
  ...AMENDMENT_SHARED_FIELDS,
  "commissionDeltaMinor",
  "commissionMinor",
  "reservationId",
] as const;

const STOP_SHARED_FIELDS = [
  "awardId",
  "requestId",
  "rideId",
  "stopId",
  "stopOrder",
  "requesterId",
  "driverId",
  "state",
  "arrivedAt",
  "departedAt",
  "waitingSec",
  "allowanceSec",
  "paidWaitingSec",
  "paidWaitingMinor",
  "currency",
  "reason",
] as const;

const SCHEDULED_REQUEST_FIELDS = [
  "scheduledRequestId",
  "templateId",
  "requestId",
  "requesterId",
  "state",
  "version",
  "product",
  "service",
  "vehicleClass",
  "windowStart",
  "windowEnd",
  "requestedFareMinor",
  "maxFareMinor",
  "refreshedMinMinor",
  "currency",
  "reason",
] as const;

const ADVANCE_BOOKING_REQUESTER_FIELDS = [
  "bookingId",
  "awardId",
  "requestId",
  "bidId",
  "requesterId",
  "driverId",
  "state",
  "version",
  "windowStart",
  "windowEnd",
  "fareMinor",
  "sameFareMinor",
  "currency",
  "reason",
  "rematchAvailable",
  "rematchBy",
  "rematchRequestId",
  "options",
  "refund",
  "audience",
  "rideId",
  "vehicleId",
] as const;

const ADVANCE_BOOKING_DRIVER_FIELDS = [
  "bookingId",
  "awardId",
  "requestId",
  "bidId",
  "driverId",
  "state",
  "version",
  "windowStart",
  "windowEnd",
  "fareMinor",
  "commissionMinor",
  "netMinor",
  "reservationId",
  "currency",
  "reason",
  "riskState",
  "blockers",
  "decisionDeadline",
  "rideId",
  "vehicleId",
] as const;

const RECURRING_TEMPLATE_FIELDS = [
  "templateId",
  "scheduledRequestId",
  "requesterId",
  "state",
  "version",
  "product",
  "startsOn",
  "endsOn",
  "reason",
] as const;

const VEHICLE_SWAP_DRIVER_FIELDS = [
  "swapId",
  "bookingId",
  "awardId",
  "requestId",
  "driverId",
  "fleetId",
  "fromVehicleId",
  "toVehicleId",
  "proposedVehicleId",
  "state",
  "reason",
  "expiresAt",
] as const;

const VEHICLE_SWAP_REQUESTER_FIELDS = [
  "swapId",
  "changeId",
  "bookingId",
  "awardId",
  "requestId",
  "requesterId",
  "driverId",
  "state",
  "vehicle",
  "reason",
  "expiresAt",
] as const;

/**
 * Closed per-event, per-role allowlist for every `mp.*` event in `@ubi/contracts`
 * `EVENT_NAMES`. A test in `marketplace-events.test.ts` asserts that every
 * `mp.*` event in `EVENT_NAMES` is registered here and that no forbidden keys
 * appear in the wrong role's allowlist.
 */
export const MARKETPLACE_EVENT_SPECS: Readonly<
  Record<string, MarketplaceEventRoleSpec>
> = {
  // Requests
  "mp.request.published": {
    requester: REQUEST_COMMON_FIELDS,
    driver: REQUEST_COMMON_FIELDS,
  },
  "mp.request.revised": {
    requester: REQUEST_COMMON_FIELDS,
    driver: REQUEST_COMMON_FIELDS,
  },
  "mp.request.closed": {
    requester: REQUEST_COMMON_FIELDS,
    driver: REQUEST_COMMON_FIELDS,
  },
  "mp.request.reopened": {
    requester: REQUEST_COMMON_FIELDS,
    driver: REQUEST_COMMON_FIELDS,
  },
  "mp.request.preferred_driver_invited": {
    requester: [
      ...REQUEST_COMMON_FIELDS,
      "preferredDriverId",
      "exclusiveUntil",
    ],
    driver: [...REQUEST_COMMON_FIELDS, "driverId", "exclusiveUntil"],
  },
  "mp.request.preferred_driver_declined": {
    driver: ["requestId", "driverId", "reason"],
  },
  "mp.request.opened_to_market": {
    requester: [...REQUEST_COMMON_FIELDS, "reason"],
    driver: REQUEST_COMMON_FIELDS,
  },

  // Bids (private between requester and bidding driver; requester never sees commissionMinor/reservationId)
  "mp.bid.submitted": {
    requester: BID_REQUESTER_FIELDS,
    driver: BID_DRIVER_FIELDS,
  },
  "mp.bid.revised": {
    requester: BID_REQUESTER_FIELDS,
    driver: BID_DRIVER_FIELDS,
  },
  "mp.bid.withdrawn": {
    requester: BID_REQUESTER_FIELDS,
    driver: BID_DRIVER_FIELDS,
  },
  "mp.bid.expired": {
    requester: BID_REQUESTER_FIELDS,
    driver: BID_DRIVER_FIELDS,
  },
  "mp.bid.invalidated": {
    requester: BID_REQUESTER_FIELDS,
    driver: BID_DRIVER_FIELDS,
  },
  "mp.bid.lost": {
    driver: BID_DRIVER_FIELDS,
  },
  "mp.bid.won": {
    requester: BID_REQUESTER_FIELDS,
    driver: BID_DRIVER_FIELDS,
  },

  // Awards (requester never sees commissionMinor/reservationId)
  "mp.award.pending": {
    requester: AWARD_REQUESTER_FIELDS,
    driver: AWARD_DRIVER_FIELDS,
  },
  "mp.award.confirmed": {
    requester: AWARD_REQUESTER_FIELDS,
    driver: AWARD_DRIVER_FIELDS,
  },
  "mp.award.failed": {
    requester: AWARD_REQUESTER_FIELDS,
    driver: AWARD_DRIVER_FIELDS,
  },
  "mp.award.cancelled": {
    requester: AWARD_REQUESTER_FIELDS,
    driver: AWARD_DRIVER_FIELDS,
  },

  // Commission holds & receipts (driver-only)
  "mp.commission.reserved": {
    driver: COMMISSION_DRIVER_FIELDS,
  },
  "mp.commission.adjusted": {
    driver: COMMISSION_DRIVER_FIELDS,
  },
  "mp.commission.released": {
    driver: COMMISSION_DRIVER_FIELDS,
  },
  "mp.commission.captured": {
    driver: COMMISSION_DRIVER_FIELDS,
  },
  "mp.commission.reversed": {
    driver: COMMISSION_DRIVER_FIELDS,
  },

  // Driver capacity claims (driver-only)
  "mp.claim.created": {
    driver: CLAIM_DRIVER_FIELDS,
  },
  "mp.claim.promoted": {
    requester: [
      "claimId",
      "awardId",
      "requestId",
      "requesterId",
      "driverId",
      "state",
      "executionRef",
    ],
    driver: CLAIM_DRIVER_FIELDS,
  },
  "mp.claim.released": {
    driver: CLAIM_DRIVER_FIELDS,
  },

  // Queue ETA & window updates
  "mp.queue.eta_updated": {
    requester: QUEUE_SHARED_FIELDS,
    driver: QUEUE_SHARED_FIELDS,
  },
  "mp.queue.window_missed": {
    requester: QUEUE_SHARED_FIELDS,
    driver: QUEUE_SHARED_FIELDS,
  },

  // Driver rate profiles & preferences (driver-only)
  "mp.rate_profile.saved": {
    driver: [
      "profileId",
      "driverId",
      "cityId",
      "service",
      "vehicleClass",
      "version",
      "perKmMinor",
      "minimumTripFareMinor",
      "currency",
    ],
  },
  "mp.driver_preferences.saved": {
    driver: ["driverId", "cityId", "version", "acceptsPreferredRequests"],
  },

  // Dedicated marketplace settlement event (G15)
  "mp.settlement.posted": {
    requester: [
      "requestId",
      "awardId",
      "requesterId",
      "driverId",
      "settlementId",
      "method",
      "fareMinor",
      "totalMinor",
      "currency",
    ],
    driver: [
      "requestId",
      "awardId",
      "driverId",
      "settlementId",
      "method",
      "fareMinor",
      "commissionMinor",
      "netMinor",
      "currency",
    ],
  },

  // Post-award trip amendments (A02)
  "mp.amendment.proposed": {
    requester: AMENDMENT_SHARED_FIELDS,
    driver: AMENDMENT_DRIVER_FIELDS,
  },
  "mp.amendment.awaiting_approvals": {
    requester: AMENDMENT_SHARED_FIELDS,
    driver: AMENDMENT_DRIVER_FIELDS,
  },
  "mp.amendment.approved": {
    requester: AMENDMENT_SHARED_FIELDS,
    driver: AMENDMENT_DRIVER_FIELDS,
  },
  "mp.amendment.committed": {
    requester: AMENDMENT_SHARED_FIELDS,
    driver: AMENDMENT_DRIVER_FIELDS,
  },
  "mp.amendment.rejected": {
    requester: AMENDMENT_SHARED_FIELDS,
    driver: AMENDMENT_DRIVER_FIELDS,
  },
  "mp.amendment.expired": {
    requester: AMENDMENT_SHARED_FIELDS,
    driver: AMENDMENT_DRIVER_FIELDS,
  },
  "mp.amendment.failed": {
    requester: AMENDMENT_SHARED_FIELDS,
    driver: AMENDMENT_DRIVER_FIELDS,
  },
  "mp.amendment.compensated": {
    requester: AMENDMENT_SHARED_FIELDS,
    driver: AMENDMENT_DRIVER_FIELDS,
  },

  // Multi-stop execution milestones (A02)
  "mp.stop.arrived": {
    requester: STOP_SHARED_FIELDS,
    driver: STOP_SHARED_FIELDS,
  },
  "mp.stop.arrival_disputed": {
    requester: STOP_SHARED_FIELDS,
    driver: STOP_SHARED_FIELDS,
  },
  "mp.stop.waiting_started": {
    requester: STOP_SHARED_FIELDS,
    driver: STOP_SHARED_FIELDS,
  },
  "mp.stop.allowance_consumed": {
    requester: STOP_SHARED_FIELDS,
    driver: STOP_SHARED_FIELDS,
  },
  "mp.stop.paid_waiting_accruing": {
    requester: STOP_SHARED_FIELDS,
    driver: STOP_SHARED_FIELDS,
  },
  "mp.stop.waiting_approval_required": {
    requester: STOP_SHARED_FIELDS,
    driver: STOP_SHARED_FIELDS,
  },
  "mp.stop.waiting_approved": {
    requester: STOP_SHARED_FIELDS,
    driver: STOP_SHARED_FIELDS,
  },
  "mp.stop.excessive_waiting": {
    requester: STOP_SHARED_FIELDS,
    driver: STOP_SHARED_FIELDS,
  },
  "mp.stop.departed": {
    requester: STOP_SHARED_FIELDS,
    driver: STOP_SHARED_FIELDS,
  },
  "mp.stop.skipped": {
    requester: STOP_SHARED_FIELDS,
    driver: STOP_SHARED_FIELDS,
  },
  "mp.trip.terminated_early": {
    requester: [
      "awardId",
      "requestId",
      "rideId",
      "requesterId",
      "driverId",
      "settledFareMinor",
      "currency",
      "reason",
    ],
    driver: [
      "awardId",
      "requestId",
      "rideId",
      "driverId",
      "settledFareMinor",
      "commissionMinor",
      "netMinor",
      "currency",
      "reason",
    ],
  },

  // Book for Later: scheduled requests & recurring occurrences (requester-only)
  "mp.scheduled_request.created": {
    requester: SCHEDULED_REQUEST_FIELDS,
  },
  "mp.scheduled_request.reminder": {
    requester: SCHEDULED_REQUEST_FIELDS,
  },
  "mp.scheduled_request.needs_approval": {
    requester: SCHEDULED_REQUEST_FIELDS,
  },
  "mp.scheduled_request.reapproved": {
    requester: SCHEDULED_REQUEST_FIELDS,
  },
  "mp.scheduled_request.published": {
    requester: SCHEDULED_REQUEST_FIELDS,
  },
  "mp.scheduled_request.unfulfilled": {
    requester: SCHEDULED_REQUEST_FIELDS,
  },
  "mp.scheduled_request.cancelled": {
    requester: SCHEDULED_REQUEST_FIELDS,
  },
  "mp.scheduled_request.skipped": {
    requester: SCHEDULED_REQUEST_FIELDS,
  },
  "mp.scheduled_request.expired": {
    requester: SCHEDULED_REQUEST_FIELDS,
  },
  "mp.recurring_occurrence.generated": {
    requester: SCHEDULED_REQUEST_FIELDS,
  },

  // Advance driver reservations (A03 + A05)
  "mp.advance_booking.held": {
    requester: ADVANCE_BOOKING_REQUESTER_FIELDS,
    driver: ADVANCE_BOOKING_DRIVER_FIELDS,
  },
  "mp.advance_booking.confirmed": {
    requester: ADVANCE_BOOKING_REQUESTER_FIELDS,
    driver: ADVANCE_BOOKING_DRIVER_FIELDS,
  },
  "mp.advance_booking.payment_pending": {
    requester: ADVANCE_BOOKING_REQUESTER_FIELDS,
    driver: ADVANCE_BOOKING_DRIVER_FIELDS,
  },
  "mp.advance_booking.funding_secured": {
    requester: ADVANCE_BOOKING_REQUESTER_FIELDS,
    driver: ADVANCE_BOOKING_DRIVER_FIELDS,
  },
  "mp.advance_booking.funding_refused": {
    requester: ADVANCE_BOOKING_REQUESTER_FIELDS,
    driver: ADVANCE_BOOKING_DRIVER_FIELDS,
  },
  "mp.advance_booking.reminder": {
    requester: ADVANCE_BOOKING_REQUESTER_FIELDS,
    driver: ADVANCE_BOOKING_DRIVER_FIELDS,
  },
  "mp.advance_booking.reconfirm_requested": {
    driver: ADVANCE_BOOKING_DRIVER_FIELDS,
  },
  "mp.advance_booking.reconfirmed": {
    requester: ADVANCE_BOOKING_REQUESTER_FIELDS,
    driver: ADVANCE_BOOKING_DRIVER_FIELDS,
  },
  "mp.advance_booking.activated": {
    requester: ADVANCE_BOOKING_REQUESTER_FIELDS,
    driver: ADVANCE_BOOKING_DRIVER_FIELDS,
  },
  "mp.advance_booking.completed": {
    requester: ADVANCE_BOOKING_REQUESTER_FIELDS,
    driver: ADVANCE_BOOKING_DRIVER_FIELDS,
  },
  "mp.advance_booking.failed": {
    requester: ADVANCE_BOOKING_REQUESTER_FIELDS,
    driver: ADVANCE_BOOKING_DRIVER_FIELDS,
  },
  "mp.advance_booking.cancelled": {
    requester: ADVANCE_BOOKING_REQUESTER_FIELDS,
    driver: ADVANCE_BOOKING_DRIVER_FIELDS,
  },
  "mp.advance_booking.released": {
    requester: ADVANCE_BOOKING_REQUESTER_FIELDS,
    driver: ADVANCE_BOOKING_DRIVER_FIELDS,
  },
  "mp.advance_booking.rematch_requested": {
    requester: ADVANCE_BOOKING_REQUESTER_FIELDS,
  },
  "mp.advance_booking.risk_changed": {
    driver: ADVANCE_BOOKING_DRIVER_FIELDS,
  },
  "mp.advance_booking.rematch_declined": {
    requester: ADVANCE_BOOKING_REQUESTER_FIELDS,
  },
  "mp.advance_booking.choice_offered": {
    requester: ADVANCE_BOOKING_REQUESTER_FIELDS,
  },

  // Recurring templates (requester-only)
  "mp.recurring_template.created": {
    requester: RECURRING_TEMPLATE_FIELDS,
  },
  "mp.recurring_template.paused": {
    requester: RECURRING_TEMPLATE_FIELDS,
  },
  "mp.recurring_template.resumed": {
    requester: RECURRING_TEMPLATE_FIELDS,
  },
  "mp.recurring_template.cancelled": {
    requester: RECURRING_TEMPLATE_FIELDS,
  },
  "mp.recurring_template.ended": {
    requester: RECURRING_TEMPLATE_FIELDS,
  },

  // Saved drivers (requester-only)
  "mp.favourite_driver.saved": {
    requester: ["driverId", "requesterId", "cityId", "state"],
  },
  "mp.favourite_driver.removed": {
    requester: ["driverId", "requesterId", "cityId", "state"],
  },

  // Vehicle swaps on advance bookings (A05)
  "mp.vehicle_swap.proposed": {
    driver: VEHICLE_SWAP_DRIVER_FIELDS,
  },
  "mp.vehicle_swap.driver_accepted": {
    driver: VEHICLE_SWAP_DRIVER_FIELDS,
  },
  "mp.vehicle_swap.driver_declined": {
    driver: VEHICLE_SWAP_DRIVER_FIELDS,
  },
  "mp.vehicle_swap.revalidation_failed": {
    driver: VEHICLE_SWAP_DRIVER_FIELDS,
  },
  "mp.vehicle_swap.rider_consent_requested": {
    requester: VEHICLE_SWAP_REQUESTER_FIELDS,
    driver: VEHICLE_SWAP_DRIVER_FIELDS,
  },
  "mp.vehicle_swap.applied": {
    requester: VEHICLE_SWAP_REQUESTER_FIELDS,
    driver: VEHICLE_SWAP_DRIVER_FIELDS,
  },
  "mp.vehicle_swap.rider_declined": {
    requester: VEHICLE_SWAP_REQUESTER_FIELDS,
    driver: VEHICLE_SWAP_DRIVER_FIELDS,
  },
  "mp.vehicle_swap.expired": {
    requester: VEHICLE_SWAP_REQUESTER_FIELDS,
    driver: VEHICLE_SWAP_DRIVER_FIELDS,
  },
  "mp.vehicle_swap.cancelled": {
    requester: VEHICLE_SWAP_REQUESTER_FIELDS,
    driver: VEHICLE_SWAP_DRIVER_FIELDS,
  },
};

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
 * Resolve the ordered list of `{ userId, role }` recipients authorized to
 * receive this envelope. Returns an empty array when the event is unknown or no
 * audience is resolvable — the caller must drop the event rather than broadcast
 * it.
 */
export function resolveAudienceByRole(
  envelope: EventEnvelope,
): MarketplaceAudienceRecipient[] {
  const spec = MARKETPLACE_EVENT_SPECS[envelope.name];
  if (!spec) {
    return [];
  }

  const payload = envelope.payload;
  const requesterId = asId(payload.requesterId);
  const driverId = asId(payload.driverId);
  const byUser = new Map<string, MarketplaceAudienceRole>();

  const addRecipient = (
    userId: string | null,
    role: MarketplaceAudienceRole,
  ) => {
    if (!userId) return;
    if (!byUser.has(userId)) {
      byUser.set(userId, role);
    }
  };

  if (spec.requester && requesterId) {
    addRecipient(requesterId, "requester");
  }

  if (spec.driver) {
    if (envelope.name.startsWith("mp.bid.")) {
      // Bids are private between the requester and the bidding driver.
      // Recipient lists are deliberately ignored so a bid event can never
      // reach rival bidders.
      addRecipient(driverId, "driver");
    } else if (
      envelope.name === "mp.request.published" ||
      envelope.name === "mp.request.closed"
    ) {
      // The engine computes driver eligibility; the gateway must not guess.
      for (const id of asIdArray(payload.audienceDriverIds)) {
        addRecipient(id, "driver");
      }
    } else {
      addRecipient(driverId, "driver");
      for (const id of asIdArray(payload.driverIds)) {
        addRecipient(id, "driver");
      }
    }
  }

  return [...byUser.entries()].map(([userId, role]) => ({ userId, role }));
}

/**
 * Resolve the set of userIds authorized to receive this envelope.
 * Returns an empty array when no audience is resolvable — the caller must
 * drop the event rather than broadcast it.
 */
export function resolveAudience(envelope: EventEnvelope): string[] {
  return resolveAudienceByRole(envelope).map((r) => r.userId);
}

/**
 * Translate an outbox EventEnvelope into the client-facing
 * `marketplace_event` WebSocket message for a specific recipient role.
 *
 * Only fields explicitly allowlisted for `(envelope.name, role)` in
 * `MARKETPLACE_EVENT_SPECS` are copied, and any key in that role's forbidden
 * set (`FORBIDDEN_REQUESTER_KEYS` / `FORBIDDEN_DRIVER_KEYS`) is stripped even
 * if accidentally listed.
 */
export function translateEnvelope(
  envelope: EventEnvelope,
  role: MarketplaceAudienceRole = "requester",
): WebSocketMessage {
  const spec = MARKETPLACE_EVENT_SPECS[envelope.name];
  const allowedList = spec?.[role] ?? [];
  const allowedSet = new Set<string>(allowedList);
  const forbiddenSet =
    role === "requester" ? FORBIDDEN_REQUESTER_SET : FORBIDDEN_DRIVER_SET;

  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(envelope.payload)) {
    if ((RECIPIENT_LIST_KEYS as readonly string[]).includes(key)) continue;
    if (forbiddenSet.has(key)) continue;
    if (!allowedSet.has(key)) continue;
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
    ...(envelope.sequence !== undefined ? { seq: envelope.sequence } : {}),
    occurredAt: envelope.occurredAt,
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
 * Route one validated marketplace envelope to its audience, translating the
 * payload separately for each recipient's role (`requester` vs `driver`).
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

  const recipients = resolveAudienceByRole(envelope);
  if (recipients.length === 0) {
    logger.warn(
      { eventName: envelope.name, eventId: envelope.id },
      "Marketplace event dropped: no resolvable audience",
    );
    return;
  }

  await Promise.all(
    recipients.map(({ userId, role }) =>
      connectionManager.broadcastToUser(
        userId,
        translateEnvelope(envelope, role),
      ),
    ),
  );

  logger.debug(
    {
      eventName: envelope.name,
      eventId: envelope.id,
      recipients: recipients.length,
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
