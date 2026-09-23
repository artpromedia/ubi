/**
 * Audience, privacy and per-viewer copy for every notifiable event
 * (marketplace round 2-6 events, trip access, airport transfers, delivery
 * returns) — driven through the real spec table and MarketplacePushDeliverer
 * with in-memory fakes for FCM, SMS, preferences and the party directory.
 *
 * Payloads mirror what the producers actually write (ride-service
 * internal/marketplace/*.go, travel-service src/ops/transfer-*.ts), INCLUDING
 * the money fields and PII-like fields a push must never carry, so each case
 * also proves they do not leak.
 */
/* eslint-disable require-await, @typescript-eslint/require-await -- async port fakes intentionally have no awaits */
import { describe, expect, it, vi } from "vitest";

import { HINT_DATA_KEYS, type Role } from "./audience.js";
import {
  MarketplacePushDeliverer,
  type DeadLetterEntry,
  type MarketplacePushPorts,
  type PushNotification,
} from "./push.js";
import { NOTIFICATION_SPECS } from "./specs.js";

import type { PartyDirectory } from "./parties.js";
import type { SmsSendResult } from "../providers/sms.js";
import type { EventEnvelope } from "@ubi/contracts";

const R = "aaaaaaaa-0000-4000-8000-000000000001"; // requester (rider)
const D = "dddddddd-0000-4000-8000-000000000002"; // driver
const T = "tttttttt-0000-4000-8000-000000000003"; // airport traveller
const S = "ssssssss-0000-4000-8000-000000000004"; // delivery sender
const RIVAL = "dddddddd-0000-4000-8000-00000000009f";
const AWARD = "11111111-0000-4000-8000-000000000010";
const REQUEST = "22222222-0000-4000-8000-000000000020";
const TRANSFER = "trf_airport_1";
const R_PHONE = "+2348030000001";
const D_PHONE = "+2348030000002";
const PASSENGER_PHONE = "+2348099999999";

/** Values that must never reach a notification (title, body or data). */
const FORBIDDEN = [
  "280000", // fare
  "28000", // commission
  "31500", // revised fare
  "3150", // revised commission
  "1500", // deltas / waiting
  "Ada", // a passenger name
  PASSENGER_PHONE,
  R_PHONE,
  D_PHONE,
];

const MONEY = {
  fareMinor: 280000,
  commissionMinor: 28000,
  priorFareMinor: 280000,
  revisedFareMinor: 315000,
  commissionDeltaMinor: 3150,
  riderFundingDeltaMinor: 31500,
  accruedMinor: 1500,
  currency: "NGN",
  // PII-like fields a careless producer might add:
  passengerFirstName: "Ada",
  passengerPhone: PASSENGER_PHONE,
};

interface Case {
  readonly name: string;
  readonly actor?: EventEnvelope["actor"];
  readonly subject: EventEnvelope["subject"];
  readonly payload: Record<string, unknown>;
  /** Expected recipients by role → exact title. Roles absent: not notified. */
  readonly expect: Partial<Record<Role, string>>;
}

const SYSTEM = { type: "system" as const, id: "ride-service" };
const RIDER = { type: "rider" as const, id: R };
const DRIVER = { type: "driver" as const, id: D };
const TRAVELLER = { type: "rider" as const, id: T };

const amendment = (state: string, extra: Record<string, unknown> = {}) => ({
  amendmentId: "amd_1",
  awardId: AWARD,
  requestId: REQUEST,
  executionId: "ride_1",
  kind: "route",
  state,
  routeRevision: 2,
  fareRevision: 2,
  expiresAt: "2026-09-23T10:10:00Z",
  ...MONEY,
  ...extra,
});

const stop = (extra: Record<string, unknown> = {}) => ({
  awardId: AWARD,
  requestId: REQUEST,
  executionId: "ride_1",
  stopId: "stp_1",
  order: 1,
  state: "arrived",
  occurredAt: "2026-09-23T10:00:00Z",
  authorizedCapMinor: 1500,
  ...MONEY,
  ...extra,
});

const scheduled = (state: string, extra: Record<string, unknown> = {}) => ({
  scheduledRequestId: "sch_1",
  product: "scheduled_request",
  requesterId: R,
  state,
  pickupAt: "2026-09-24T08:00:00Z",
  windowEnd: "2026-09-24T08:15:00Z",
  localDate: "2026-09-24",
  localTime: "09:00",
  timeZone: "Africa/Lagos",
  driverSecured: false,
  ...MONEY,
  ...extra,
});

const booking = (state: string, extra: Record<string, unknown> = {}) => ({
  bookingId: "bkg_1",
  awardId: AWARD,
  requestId: REQUEST,
  driverId: D,
  requesterId: R,
  state,
  fundingState: "secured",
  windowStart: "2026-09-24T08:00:00Z",
  windowEnd: "2026-09-24T08:15:00Z",
  ...MONEY,
  ...extra,
});

const transfer = (state: string, extra: Record<string, unknown> = {}) => ({
  transferId: TRANSFER,
  linkedOrderId: "ord_flight_1",
  direction: "arrival_pickup",
  state,
  driverSecured: state === "awarded",
  generation: 1,
  scheduledRequestId: "sch_9",
  rideRequestId: null,
  pickupAt: "2026-09-24T08:00:00Z",
  windowEnd: "2026-09-24T08:30:00Z",
  approvedMaxFareMinor: 280000,
  currency: "NGN",
  ...extra,
});

const CASES: Case[] = [
  // ── existing marketplace events, now per viewer ──
  {
    name: "mp.bid.submitted",
    actor: DRIVER,
    subject: { type: "mp_bid", id: "bid_1" },
    payload: {
      bidId: "bid_1",
      requestId: REQUEST,
      driverId: D,
      amountMinor: 280000,
      commissionMinor: 28000,
      driverIds: [RIVAL],
    },
    expect: { requester: "New offer on your request" },
  },
  {
    name: "mp.award.confirmed",
    subject: { type: "mp_award", id: AWARD },
    payload: { awardId: AWARD, requestId: REQUEST, driverId: D, ...MONEY },
    expect: { requester: "Your driver is confirmed" },
  },
  {
    name: "mp.bid.won",
    subject: { type: "mp_bid", id: "bid_1" },
    payload: {
      bidId: "bid_1",
      requestId: REQUEST,
      awardId: AWARD,
      driverId: D,
    },
    expect: { driver: "You won a request" },
  },
  {
    name: "mp.bid.lost",
    subject: { type: "mp_bid", id: "bid_2" },
    payload: {
      bidId: "bid_2",
      requestId: REQUEST,
      driverId: D,
      reservationId: "res_2",
      driverIds: [RIVAL],
      audienceDriverIds: [RIVAL],
    },
    expect: { driver: "Requester chose another driver" },
  },
  {
    name: "mp.claim.promoted",
    subject: { type: "mp_claim", id: "clm_1" },
    payload: {
      claimId: "clm_1",
      awardId: AWARD,
      requestId: REQUEST,
      driverId: D,
    },
    expect: { requester: "Your driver is on the way" },
  },
  {
    name: "mp.queue.eta_updated",
    subject: { type: "mp_claim", id: "clm_1" },
    payload: {
      claimId: "clm_1",
      awardId: AWARD,
      requestId: REQUEST,
      driverId: D,
    },
    expect: { requester: "Pickup ETA updated" },
  },
  {
    name: "mp.queue.window_missed",
    subject: { type: "mp_claim", id: "clm_1" },
    payload: {
      claimId: "clm_1",
      awardId: AWARD,
      requestId: REQUEST,
      driverId: D,
    },
    expect: { requester: "Pickup window update" },
  },
  {
    name: "mp.settlement.posted",
    subject: { type: "mp_award", id: AWARD },
    payload: { awardId: AWARD, requestId: REQUEST, driverId: D, ...MONEY },
    expect: { requester: "Ride settled", driver: "Trip settled" },
  },
  // ── trip amendments ──
  {
    name: "mp.amendment.proposed",
    actor: RIDER,
    subject: { type: "mp_amendment", id: "amd_1" },
    payload: amendment("proposed"),
    expect: { driver: "Trip change requested" },
  },
  {
    name: "mp.amendment.proposed",
    actor: DRIVER,
    subject: { type: "mp_amendment", id: "amd_1" },
    payload: amendment("proposed"),
    expect: { requester: "Trip change proposed" },
  },
  {
    name: "mp.amendment.approved",
    actor: RIDER,
    subject: { type: "mp_amendment", id: "amd_1" },
    payload: amendment("awaiting_approvals", { approvedBy: "rider" }),
    expect: { driver: "Rider approved the change" },
  },
  {
    name: "mp.amendment.approved",
    actor: DRIVER,
    subject: { type: "mp_amendment", id: "amd_1" },
    payload: amendment("awaiting_approvals", { approvedBy: "driver" }),
    expect: { requester: "Driver approved the change" },
  },
  {
    name: "mp.amendment.rejected",
    actor: DRIVER,
    subject: { type: "mp_amendment", id: "amd_1" },
    payload: amendment("rejected", { reason: "declined" }),
    expect: { requester: "Trip change declined" },
  },
  {
    name: "mp.amendment.rejected",
    actor: SYSTEM,
    subject: { type: "mp_amendment", id: "amd_1" },
    payload: amendment("rejected", { reason: "rider_funding_refused" }),
    expect: {
      requester: "Trip change not applied",
      driver: "Trip change not applied",
    },
  },
  {
    name: "mp.amendment.expired",
    actor: SYSTEM,
    subject: { type: "mp_amendment", id: "amd_1" },
    payload: amendment("expired", { reason: "approval_window_elapsed" }),
    expect: { requester: "Trip change expired", driver: "Trip change expired" },
  },
  {
    name: "mp.amendment.committed",
    actor: SYSTEM,
    subject: { type: "mp_amendment", id: "amd_1" },
    payload: amendment("committed"),
    expect: { requester: "Trip updated", driver: "Trip updated" },
  },
  {
    name: "mp.amendment.compensated",
    actor: SYSTEM,
    subject: { type: "mp_amendment", id: "amd_1" },
    payload: amendment("compensated", { reason: "commit_refused" }),
    expect: {
      requester: "Trip change not applied",
      driver: "Trip change not applied",
    },
  },
  // ── stops and paid waiting ──
  {
    name: "mp.stop.waiting_approval_required",
    actor: SYSTEM,
    subject: { type: "mp_award", id: AWARD },
    payload: stop({ capRevision: 1 }),
    expect: {
      requester: "Approve more waiting?",
      driver: "Waiting limit reached",
    },
  },
  {
    name: "mp.stop.excessive_waiting",
    actor: SYSTEM,
    subject: { type: "mp_award", id: AWARD },
    payload: stop({ excessiveAfterSec: 900, waitedSec: 960 }),
    expect: {
      requester: "Your driver has waited a long time",
      driver: "You may leave this stop",
    },
  },
  // ── Book for Later: scheduled requests ──
  {
    name: "mp.scheduled_request.needs_approval",
    actor: SYSTEM,
    subject: { type: "mp_scheduled_request", id: "sch_1" },
    payload: scheduled("needs_rider_approval", {
      reason: "fare_above_approval",
      message: "The minimum fare for this trip is now NGN 2,800.00",
    }),
    expect: { requester: "Approve your scheduled ride" },
  },
  {
    name: "mp.scheduled_request.published",
    actor: SYSTEM,
    subject: { type: "mp_scheduled_request", id: "sch_1" },
    payload: scheduled("published", { requestId: REQUEST }),
    expect: { requester: "Your scheduled ride is open to drivers" },
  },
  {
    name: "mp.scheduled_request.unfulfilled",
    actor: SYSTEM,
    subject: { type: "mp_scheduled_request", id: "sch_1" },
    payload: scheduled("unfulfilled", { reason: "no_driver_found" }),
    expect: { requester: "No driver for your scheduled ride" },
  },
  {
    name: "mp.scheduled_request.unfulfilled",
    actor: SYSTEM,
    subject: { type: "mp_scheduled_request", id: "sch_1" },
    payload: scheduled("unfulfilled", { reason: "market_unavailable" }),
    expect: { requester: "Scheduled ride unavailable" },
  },
  {
    name: "mp.scheduled_request.expired",
    actor: SYSTEM,
    subject: { type: "mp_scheduled_request", id: "sch_1" },
    payload: scheduled("expired", { reason: "pickup_time_passed" }),
    expect: { requester: "Scheduled ride expired" },
  },
  {
    name: "mp.scheduled_request.reminder",
    actor: SYSTEM,
    subject: { type: "mp_scheduled_request", id: "sch_1" },
    payload: scheduled("scheduled_unassigned", { offsetSec: 43200 }),
    expect: { requester: "Scheduled ride reminder" },
  },
  {
    name: "mp.scheduled_request.skipped",
    actor: SYSTEM,
    subject: { type: "mp_scheduled_request", id: "sch_1" },
    payload: scheduled("skipped", {
      templateId: "tpl_1",
      occurrenceDate: "2026-09-24",
      reason: "series_conflict",
    }),
    expect: { requester: "A ride in your series was skipped" },
  },
  // ── Book for Later: advance driver reservations ──
  {
    name: "mp.advance_booking.reminder",
    actor: SYSTEM,
    subject: { type: "mp_advance_booking", id: "bkg_1" },
    payload: booking("confirmed", {
      offsetSec: 3600,
      audience: ["rider", "driver"],
      fullySecured: true,
    }),
    expect: {
      requester: "Upcoming reserved ride",
      driver: "Upcoming reserved job",
    },
  },
  {
    name: "mp.advance_booking.reconfirm_requested",
    actor: SYSTEM,
    subject: { type: "mp_advance_booking", id: "bkg_1" },
    payload: booking("confirmed", {
      deadline: "2026-09-24T06:00:00Z",
      message:
        "Please reconfirm your advance booking. If you do not reconfirm in time it is released and your commission returned.",
    }),
    expect: { driver: "Reconfirm your reserved job" },
  },
  {
    name: "mp.advance_booking.failed",
    actor: SYSTEM,
    subject: { type: "mp_advance_booking", id: "bkg_1" },
    payload: booking("failed", {
      reason: "reconfirmation_missed",
      financialOutcome: {
        commissionReversed: true,
        riderFundingReleased: true,
        riderCharged: false,
      },
      rematchAvailable: true,
    }),
    expect: {
      requester: "Your reserved ride can't go ahead",
      driver: "Reserved job cancelled",
    },
  },
  {
    name: "mp.advance_booking.failed",
    actor: DRIVER, // the driver withdrew: they are not pushed about it
    subject: { type: "mp_advance_booking", id: "bkg_1" },
    payload: booking("failed", {
      reason: "driver_withdrew",
      financialOutcome: {
        commissionReversed: true,
        riderFundingReleased: false,
        riderCharged: false,
      },
      rematchAvailable: true,
    }),
    expect: { requester: "Your reserved ride can't go ahead" },
  },
  {
    name: "mp.advance_booking.cancelled",
    actor: RIDER, // the rider cancelled: only the driver is told
    subject: { type: "mp_advance_booking", id: "bkg_1" },
    payload: booking("cancelled", {
      reason: "rider_cancelled",
      financialOutcome: {
        commissionReversed: true,
        riderFundingReleased: true,
        riderCharged: false,
      },
      rematchAvailable: false,
    }),
    expect: { driver: "Reserved job cancelled" },
  },
  {
    name: "mp.advance_booking.activated",
    actor: SYSTEM,
    subject: { type: "mp_advance_booking", id: "bkg_1" },
    payload: booking("activated", {
      slot: "current",
      claimId: "clm_1",
      commissionChargedAgain: false,
      commissionAlreadyCharged: 28000,
    }),
    expect: {
      requester: "Your reserved ride is starting",
      driver: "Reserved job is now active",
    },
  },
  // ── preferred driver ──
  {
    name: "mp.request.preferred_driver_invited",
    actor: RIDER,
    subject: { type: "mp_request", id: REQUEST },
    payload: {
      requestId: REQUEST,
      driverId: D,
      service: "ride",
      vehicleClass: "standard",
      windowSec: 120,
      windowEndsAt: "2026-09-23T10:02:00Z",
    },
    expect: { driver: "You're invited to offer first" },
  },
  {
    name: "mp.request.preferred_driver_declined",
    actor: DRIVER,
    subject: { type: "mp_request", id: REQUEST },
    payload: { requestId: REQUEST, driverId: D },
    expect: { driver: "Invitation declined" },
  },
  {
    name: "mp.request.opened_to_market",
    actor: SYSTEM,
    subject: { type: "mp_request", id: REQUEST },
    payload: {
      requestId: REQUEST,
      requesterId: R,
      reason: "preferred_driver_unavailable",
      expiresAt: "2026-09-23T10:20:00Z",
    },
    expect: { requester: "Your request is open to other drivers" },
  },
  {
    name: "mp.request.closed",
    actor: SYSTEM,
    subject: { type: "mp_request", id: REQUEST },
    payload: {
      requestId: REQUEST,
      requesterId: R,
      reason: "preferred_driver_unavailable",
    },
    expect: { requester: "Preferred driver unavailable" },
  },
  // ── book for another adult ──
  {
    name: "trip_access.declined",
    actor: { type: "rider", id: "tac_1" },
    subject: { type: "trip_access", id: "tac_1" },
    payload: {
      tokenId: "tac_1",
      requestId: REQUEST,
      requesterId: R,
      reason: "passenger_declined",
      feeMinor: 0,
    },
    expect: { requester: "Your passenger declined the ride" },
  },
  // ── delivery returns ──
  {
    name: "shipment.return_proposed",
    actor: DRIVER,
    subject: { type: "shipment", id: "dlv_1" },
    payload: {
      deliveryId: "dlv_1",
      returnId: "ret_1",
      senderId: S,
      driverId: D,
      chargeStatus: "authorization_required",
      feeMinor: 1500,
      currency: "NGN",
    },
    expect: { sender: "Approve a return fee" },
  },
  // ── airport transfers ──
  {
    name: "reservation.assigned",
    subject: { type: "reservation", id: TRANSFER },
    payload: transfer("awarded", { requestId: REQUEST }),
    expect: { traveller: "Driver secured for your airport ride" },
  },
  {
    name: "reservation.requested",
    subject: { type: "reservation", id: TRANSFER },
    payload: transfer("pending_unassigned", {
      reason:
        "the server's minimum fare is above the traveller's approved limit; nothing sent to drivers",
    }),
    expect: { traveller: "Action needed for your airport ride" },
  },
  {
    name: "reservation.reservation_failed",
    subject: { type: "reservation", id: TRANSFER },
    payload: transfer("failed", { reason: "no_driver_found" }),
    expect: { traveller: "No driver for your airport ride" },
  },
  {
    name: "reservation.reservation_failed",
    subject: { type: "reservation", id: TRANSFER },
    payload: transfer("cancelled", { reason: "flight_cancelled" }),
    expect: { traveller: "Airport ride cancelled" },
  },
];

function envelope(
  c: Case,
  id = `evt_${Math.random().toString(36).slice(2)}`,
): EventEnvelope {
  return {
    id,
    name: c.name,
    version: 1,
    occurredAt: "2026-09-23T10:00:00.000Z",
    actor: c.actor ?? { type: "system", id: "travel-service" },
    subject: c.subject,
    idempotencyKey: `${c.name}:${id}`.slice(0, 64),
    fromVersion: null,
    toVersion: 1,
    cityId: "lagos",
    payload: c.payload,
  };
}

interface Sent {
  userId: string;
  notification: PushNotification;
}

function harness(
  cfg: {
    tokensByUser?: Record<string, string[]>;
    parties?: PartyDirectory;
    smsAllows?: (userId: string) => boolean;
    smsResult?: SmsSendResult;
    pushAllows?: (userId: string) => boolean;
  } = {},
) {
  const sent: Sent[] = [];
  const sms: { to: string; message: string }[] = [];
  const phoneLookups: string[] = [];
  const deadLetters: DeadLetterEntry[] = [];
  const logs: unknown[] = [];
  const parties: PartyDirectory = cfg.parties ?? {
    award: async (awardId) =>
      awardId === AWARD ? { requesterId: R, driverId: D } : null,
    requester: async (requestId) => (requestId === REQUEST ? R : null),
    traveller: async (transferId) => (transferId === TRANSFER ? T : null),
  };
  const phones: Record<string, string> = { [R]: R_PHONE, [D]: D_PHONE };
  const seen = new Set<string>();
  const ports: MarketplacePushPorts = {
    devices: {
      activeTokens: async (userId) =>
        cfg.tokensByUser?.[userId] ?? [`tok_${userId}`],
      deactivate: async () => {},
    },
    prefs: {
      allows: async (userId) =>
        cfg.pushAllows ? cfg.pushAllows(userId) : true,
    },
    sender: {
      send: async (userId, _tokens, notification) => {
        sent.push({ userId, notification });
        return { success: true };
      },
    },
    state: {
      firstSightOfEvent: async (eventId) => {
        if (seen.has(eventId)) {
          return false;
        }
        seen.add(eventId);
        return true;
      },
      advanceSubjectSequence: async () => true,
    },
    deadLetters: {
      record: async (entry) => {
        deadLetters.push(entry);
      },
    },
    pending: { record: async () => {} },
    logger: {
      debug: vi.fn(),
      info: (obj: unknown) => logs.push(obj),
      warn: (obj: unknown) => logs.push(obj),
      error: (obj: unknown) => logs.push(obj),
    },
    parties,
    sms: {
      phones: {
        verifiedPhone: async (userId) => {
          phoneLookups.push(userId);
          return phones[userId] ?? null;
        },
      },
      sender: {
        send: async (to, message) => {
          sms.push({ to, message });
          return cfg.smsResult ?? { success: true, provider: "fake" };
        },
      },
      allows: async (userId) => (cfg.smsAllows ? cfg.smsAllows(userId) : true),
    },
    maxAttempts: 2,
    backoff: { baseMs: 1, maxMs: 1 },
    delay: async () => {},
  };
  return {
    deliverer: new MarketplacePushDeliverer(ports),
    sent,
    sms,
    phoneLookups,
    deadLetters,
    logs,
  };
}

const ROLE_OF: Record<string, Role> = {
  [R]: "requester",
  [D]: "driver",
  [T]: "traveller",
  [S]: "sender",
};

describe("audience and per-viewer copy, per event", () => {
  it.each(
    CASES.map(
      (c) => [`${c.name} (actor ${c.actor?.type ?? "system"})`, c] as const,
    ),
  )("%s", async (_label, c) => {
    const h = harness();
    const res = await h.deliverer.handle(envelope(c));

    expect(res.outcome).toBe("processed");
    expect(res.unresolved).toEqual([]);
    // Exactly the expected roles, each with ITS copy.
    const got: Partial<Record<Role, string>> = {};
    for (const s of h.sent) {
      const role = ROLE_OF[s.userId];
      expect(role, `unexpected recipient ${s.userId}`).toBeDefined();
      got[role!] = s.notification.title;
    }
    expect(got).toEqual(c.expect);

    for (const s of h.sent) {
      // Hint data: ids + type only.
      for (const key of Object.keys(s.notification.data)) {
        expect(HINT_DATA_KEYS).toContain(key);
      }
      const wire = JSON.stringify(s.notification);
      for (const value of FORBIDDEN) {
        expect(wire, `leaked ${value}`).not.toContain(value);
      }
      // A rival listed in the payload is never addressed.
      expect(s.userId).not.toBe(RIVAL);
      // Riders never read about the driver's commission.
      if (ROLE_OF[s.userId] !== "driver") {
        expect(wire).not.toMatch(/commission/i);
      }
    }
  });

  it("covers every event in the spec table", () => {
    const covered = new Set(CASES.map((c) => c.name));
    for (const name of Object.keys(NOTIFICATION_SPECS)) {
      expect(covered.has(name), name).toBe(true);
    }
  });

  it("no copy promises transport before an award", async () => {
    const preAward = CASES.filter(
      (c) =>
        c.name.startsWith("mp.scheduled_request.") ||
        c.name === "mp.request.opened_to_market" ||
        (c.name.startsWith("reservation.") &&
          c.name !== "reservation.assigned"),
    );
    expect(preAward.length).toBeGreaterThan(5);
    await Promise.all(
      preAward.map(async (c) => {
        const h = harness();
        await h.deliverer.handle(envelope(c));
        for (const s of h.sent) {
          const text = `${s.notification.title} ${s.notification.body}`;
          // "confirmed"/"secured"/"booked" only ever negated ("No driver is…").
          expect(text).not.toMatch(
            /(?<!no )driver is (confirmed|secured|booked)/i,
          );
          expect(text).not.toMatch(/driver (secured|confirmed) for/i);
        }
      }),
    );
  });
});

describe("privacy rules", () => {
  it("a bid event never falls back to the award's driver (could be someone else's winning bid)", async () => {
    const h = harness();
    const res = await h.deliverer.handle(
      envelope({
        name: "mp.bid.won",
        subject: { type: "mp_bid", id: "bid_x" },
        payload: { bidId: "bid_x", requestId: REQUEST, awardId: AWARD },
        expect: {},
      }),
    );
    expect(h.sent).toHaveLength(0);
    expect(res.unresolved).toEqual([
      { role: "driver", reason: "bid_without_driver" },
    ]);
    expect(h.deadLetters[0]?.reason).toBe(
      "audience_unresolved: bid_without_driver",
    );
  });

  it("an unresolvable audience is dead-lettered for replay — never guessed or broadcast", async () => {
    const h = harness({
      parties: {
        award: async () => null,
        requester: async () => null,
        traveller: async () => null,
      },
    });
    const res = await h.deliverer.handle(
      envelope({
        name: "mp.amendment.committed",
        subject: { type: "mp_amendment", id: "amd_9" },
        payload: amendment("committed", {
          awardId: "11111111-0000-4000-8000-0000000000ff",
        }),
        expect: {},
      }),
    );
    expect(h.sent).toHaveLength(0);
    expect(res.unresolved.map((u) => u.role)).toEqual(["requester", "driver"]);
    expect(h.deadLetters.map((d) => d.reason)).toEqual([
      "audience_unresolved: requester_not_found",
      "audience_unresolved: driver_not_found",
    ]);
  });

  it("a directory outage is recorded as lookup_failed, not thrown", async () => {
    const h = harness({
      parties: {
        award: async () => {
          throw new Error('relation "mp.awards" does not exist');
        },
        requester: async () => null,
        traveller: async () => null,
      },
    });
    const res = await h.deliverer.handle(
      envelope({
        name: "mp.stop.excessive_waiting",
        subject: { type: "mp_award", id: AWARD },
        payload: stop(),
        expect: {},
      }),
    );
    // Both roles consult the (memoized, failed) award lookup first.
    expect(res.unresolved).toEqual([
      { role: "requester", reason: "lookup_failed" },
      { role: "driver", reason: "lookup_failed" },
    ]);
    expect(h.sent).toHaveLength(0);
  });

  it("the guest passenger is never pushed: trip_access.issued is not a push event", async () => {
    const h = harness();
    const res = await h.deliverer.handle(
      envelope({
        name: "trip_access.issued",
        subject: { type: "trip_access", id: "tac_1" },
        payload: {
          tokenId: "tac_1",
          requestId: REQUEST,
          scope: "guest_passenger",
          recipient: { channel: "sms" },
        },
        expect: {},
      }),
    );
    expect(res.outcome).toBe("skipped_event");
    expect(h.sent).toHaveLength(0);
    expect(h.sms).toHaveLength(0);
    expect(h.phoneLookups).toHaveLength(0);
  });

  it("the actor who acted is not pushed about it (and a system actor never suppresses anyone)", async () => {
    const h = harness();
    const res = await h.deliverer.handle(
      envelope({
        name: "reservation.reservation_failed",
        actor: TRAVELLER,
        subject: { type: "reservation", id: TRANSFER },
        payload: transfer("cancelled", { reason: "cancelled_by_traveller" }),
        expect: {},
      }),
    );
    expect(res.perUser).toEqual([
      { userId: T, role: "traveller", outcome: "skipped_actor", attempts: 0 },
    ]);
    expect(h.sent).toHaveLength(0);
  });

  it("the traveller's own request (or a request made with no driver yet) is not an action-required push", async () => {
    for (const actor of [
      TRAVELLER,
      { type: "system" as const, id: "travel-service" },
    ]) {
      const h = harness();
      const res = await h.deliverer.handle(
        envelope({
          name: "reservation.requested",
          actor,
          subject: { type: "reservation", id: TRANSFER },
          payload: transfer(
            actor.type === "system" ? "requested" : "pending_unassigned",
          ),
          expect: {},
        }),
      );
      expect(res.outcome).toBe("skipped_event");
      expect(h.sent).toHaveLength(0);
    }
  });

  it("a pre-authorized adjustment (stop waiting fee, early termination) is never announced as needing approval", async () => {
    // ride-service writes these through createSystemAdjustment with both
    // approvals implicit: the system proposes a waiting fee; either party
    // ends the trip early. Only the outcome (committed / not applied) is
    // pushed.
    for (const [kind, actor] of [
      ["stop_waiting", SYSTEM],
      ["early_termination", RIDER],
      ["early_termination", DRIVER],
    ] as const) {
      const h = harness();
      const res = await h.deliverer.handle(
        envelope({
          name: "mp.amendment.proposed",
          actor,
          subject: { type: "mp_amendment", id: `amd_${kind}` },
          payload: amendment("proposed", { kind }),
          expect: {},
        }),
      );
      expect(res.outcome, `${kind} by ${actor.type}`).toBe("skipped_event");
      expect(h.sent).toHaveLength(0);
      expect(h.sms).toHaveLength(0);
      expect(h.deadLetters).toHaveLength(0);
    }
  });

  it("a scheduled reminder states its lead time", async () => {
    const h = harness();
    await h.deliverer.handle(
      envelope({
        name: "mp.scheduled_request.reminder",
        subject: { type: "mp_scheduled_request", id: "sch_1" },
        payload: scheduled("scheduled_unassigned", { offsetSec: 3600 }),
        expect: {},
      }),
    );
    expect(h.sent[0]?.notification.body).toContain("in 1 hour");
    expect(h.sent[0]?.notification.body).toContain("No driver is secured yet");
  });

  it("an advance-booking failure explains the outcome per viewer: no charge for the rider, commission back for the driver", async () => {
    const h = harness();
    await h.deliverer.handle(
      envelope({
        name: "mp.advance_booking.failed",
        subject: { type: "mp_advance_booking", id: "bkg_1" },
        payload: booking("failed", {
          reason: "reconfirmation_missed",
          financialOutcome: {
            commissionReversed: true,
            riderFundingReleased: true,
            riderCharged: false,
          },
          rematchAvailable: true,
        }),
        expect: {},
      }),
    );
    const rider = h.sent.find((s) => s.userId === R)?.notification.body ?? "";
    const driver = h.sent.find((s) => s.userId === D)?.notification.body ?? "";
    expect(rider).toContain("didn't reconfirm in time");
    expect(rider).toContain(
      "You weren't charged and your payment hold was released.",
    );
    expect(rider).toContain("find another driver");
    expect(rider).not.toMatch(/commission/i);
    expect(driver).toContain("You didn't reconfirm this reserved job in time");
    expect(driver).toContain("commission you paid for it is returned");
    expect(driver).not.toMatch(/payment hold|charged/i);
  });
});

describe("SMS fallback for time-critical events", () => {
  const needsApproval: Case = {
    name: "mp.scheduled_request.needs_approval",
    subject: { type: "mp_scheduled_request", id: "sch_1" },
    payload: scheduled("needs_rider_approval", {
      reason: "fare_above_approval",
    }),
    expect: {},
  };

  it("sends ONE SMS to the recipient's own verified phone when no device can take the push", async () => {
    const h = harness({ tokensByUser: { [R]: [] } });
    const res = await h.deliverer.handle(envelope(needsApproval));
    expect(res.perUser).toEqual([
      {
        userId: R,
        role: "requester",
        outcome: "deferred_no_device",
        attempts: 0,
        sms: "sent",
      },
    ]);
    expect(h.sms).toEqual([
      {
        to: R_PHONE,
        message:
          "UBI: Approve your scheduled ride. Your scheduled ride needs your approval before it's sent to drivers. No driver is booked yet. Open UBI to review.",
      },
    ]);
    expect(h.phoneLookups).toEqual([R]);
    // Logged masked only.
    expect(JSON.stringify(h.logs)).not.toContain(R_PHONE);
    expect(JSON.stringify(h.logs)).toContain("+234********01");
  });

  it("does not text for a non-critical event", async () => {
    const h = harness({ tokensByUser: { [R]: [] } });
    const res = await h.deliverer.handle(
      envelope({
        name: "mp.scheduled_request.published",
        subject: { type: "mp_scheduled_request", id: "sch_1" },
        payload: scheduled("published"),
        expect: {},
      }),
    );
    expect(res.perUser[0]?.sms).toBeUndefined();
    expect(h.sms).toHaveLength(0);
  });

  it("honors the SMS critical-alert preference and a push opt-out", async () => {
    const noSms = harness({
      tokensByUser: { [R]: [] },
      smsAllows: () => false,
    });
    expect(
      (await noSms.deliverer.handle(envelope(needsApproval))).perUser[0]?.sms,
    ).toBe("suppressed_prefs");
    expect(noSms.sms).toHaveLength(0);

    const pushOff = harness({
      tokensByUser: { [R]: [] },
      pushAllows: () => false,
    });
    const res = await pushOff.deliverer.handle(envelope(needsApproval));
    expect(res.perUser[0]?.outcome).toBe("suppressed_prefs");
    expect(pushOff.sms).toHaveLength(0);
  });

  it("dead-letters a failed SMS with the phone scrubbed", async () => {
    const h = harness({
      tokensByUser: { [R]: [] },
      smsResult: { success: false, error: `number ${R_PHONE} unreachable` },
    });
    const res = await h.deliverer.handle(envelope(needsApproval));
    expect(res.perUser[0]?.sms).toBe("dead_lettered");
    expect(h.deadLetters).toHaveLength(1);
    expect(h.deadLetters[0]?.channel).toBe("sms");
    expect(h.deadLetters[0]?.reason).not.toContain(R_PHONE);
    expect(h.deadLetters[0]?.reason).not.toContain(R_PHONE.slice(1));
  });

  it("a driver's time-critical SMS goes to the driver's own phone only", async () => {
    const h = harness({ tokensByUser: { [D]: [] } });
    await h.deliverer.handle(
      envelope({
        name: "mp.advance_booking.reconfirm_requested",
        subject: { type: "mp_advance_booking", id: "bkg_1" },
        payload: booking("confirmed", { deadline: "2026-09-24T06:00:00Z" }),
        expect: {},
      }),
    );
    expect(h.sms.map((m) => m.to)).toEqual([D_PHONE]);
    expect(h.phoneLookups).toEqual([D]);
  });
});
