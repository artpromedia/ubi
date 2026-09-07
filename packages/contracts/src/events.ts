/**
 * Canonical realtime/domain event envelope.
 *
 * Source: design handoff contracts/events/catalog.md. Every state transition in
 * UBI is published through a transactional outbox using this envelope, and every
 * consumer is idempotent on `id`.
 */
import { z } from "zod";

export const ACTOR_TYPES = [
  "rider",
  "driver",
  "merchant",
  "hotel",
  "fleet",
  "agent",
  "system",
] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const SUBJECT_TYPES = [
  "ride",
  "offer",
  "quote",
  "order",
  "shipment",
  "journey",
  "reservation",
  "booking",
  "stay",
  "transfer",
  "wallet",
  "case",
  "config",
  "driver",
  "user",
  "device",
  "document",
  "fleet",
  "assignment",
  "recon",
] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export const ActorSchema = z.object({
  type: z.enum(ACTOR_TYPES),
  id: z.string().min(1),
});

export const SubjectSchema = z.object({
  type: z.enum(SUBJECT_TYPES),
  id: z.string().min(1),
});

/**
 * `fromVersion`/`toVersion` are the aggregate versions either side of the
 * transition. Consumers use them to detect gaps: a jump means replay is needed.
 */
export const EventEnvelopeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().min(1),
  occurredAt: z.string().datetime({ offset: true }),
  actor: ActorSchema,
  subject: SubjectSchema,
  idempotencyKey: z.string().min(1).max(64),
  fromVersion: z.number().int().min(0).nullable(),
  toVersion: z.number().int().min(0),
  cityId: z.string().min(1).nullable(),
  sequence: z.number().int().min(0).optional(),
  correlationId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  payload: z.record(z.unknown()),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

/**
 * Every event name on the board. Keeping this closed means a producer cannot
 * invent an event that no consumer or ops timeline knows how to render.
 */
export const EVENT_NAMES = [
  // quotes & rides (slice 02)
  "quote.created",
  "quote.expired",
  "ride.requested",
  "ride.assigned",
  "ride.driver_arrived",
  "ride.pin_verified",
  "ride.started",
  "ride.location",
  "ride.completed",
  "ride.cancelled_by_rider",
  "ride.cancelled_by_driver",
  "ride.no_driver",
  "ride.safety_hold",
  "ride.rated",
  "matching.retry",
  "matching.restarted",
  "offer.created",
  "offer.expired",
  "offer.declined",
  "offer.accepted",
  // payments & wallet (slice 04)
  "payment.cash_acknowledged",
  "payment.cash_disputed",
  "payment.intent_failed",
  "payment.method_switched",
  "payment.auth_released",
  "tip.captured",
  "transfer.posted",
  "transfer.held",
  "transfer.return_requested",
  "transfer.reversed",
  "request.created",
  "request.paid",
  "nip.pending",
  "nip.confirmed",
  "nip.reversed",
  "topup.captured",
  "pin.locked",
  "pin.rotated",
  "cooling.started",
  // identity (slice 03)
  "driver.status_changed",
  "driver.eligibility_changed",
  "document.expiring",
  "document.expired",
  "vehicle.offline_for_all_drivers",
  "device.enrolled",
  "step_up.passed",
  "step_up.failed",
  "wallet.safe_mode_entered",
  "wallet.safe_mode_exited",
  "face_check.failed",
  "identity.case_opened",
  "identity.case_decided",
  // safety
  "safety.sos_raised",
  "incident.created",
  // bites (slice 05)
  "order.placed",
  "merchant.accepted",
  "merchant.rejected",
  "order.picked_up",
  "order.delivered",
  "order.issue_reported",
  "merchant.responded",
  "refund.posted",
  "menu.item_unavailable",
  "store.paused",
  "merchant.applied",
  "merchant.approved",
  "merchant.fix_requested",
  // send (slice 06)
  "shipment.created",
  "shipment.picked_up",
  "shipment.exception",
  "sender.decision",
  "shipment.hub_held",
  "shipment.delivered",
  "claim.opened",
  "claim.decided",
  "business.webhook_delivered",
  // travel (slices 07-09)
  "booking.confirmed",
  "flight.watch_started",
  "flight.status_changed",
  "oneticket.activated",
  "alternatives.ranked",
  "seat.held",
  "booking.switched",
  "booking.refunded_to_wallet",
  "reclaim.filed",
  "reclaim.recovered",
  "reclaim.disputed",
  "desk.assisted",
  "journey.created",
  "journey.leg_added",
  "leg.retimed",
  "journey.completed",
  "receipt.compiled",
  "reservation.assigned",
  "reservation.reminder",
  "reservation.pickup_moved",
  "reservation.no_show",
  "driver.kept",
  "driver.released",
  "stay.booked",
  "stay.checkin_precompleted",
  "hotel.eta_shared",
  "stay.late_arrival",
  "stay.moved",
  "stay.cancelled_by_airline_cause",
  "hotel.first_night_cover",
  "stay.checked_out",
  "review.posted",
  "hotel.replied",
  "partner.applied",
  "partner.approved",
  // fleet (slice 10)
  "fleet.assignment_proposed",
  "driver.signed_terms",
  "split_rule.activated",
  "split_rule.change_proposed",
  "remittance.applied",
  "remittance.shortfall",
  "remittance.carried",
  "fleet.alert",
  // ops (slices 01, 11)
  "case.opened",
  "remedy.posted",
  "case.resolved",
  "config.version_activated",
  "flag.changed",
  "recon.run",
  "recon.break_opened",
  "recon.break_owned",
  "recon.closed",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

const EVENT_NAME_SET: ReadonlySet<string> = new Set(EVENT_NAMES);

export function isKnownEventName(name: string): name is EventName {
  return EVENT_NAME_SET.has(name);
}

export function assertKnownEventName(name: string): EventName {
  if (!isKnownEventName(name)) {
    throw new Error(
      `unknown event name "${name}" — add it to contracts/events before publishing`,
    );
  }
  return name;
}

/** Realtime topics mirror the subject, e.g. ride.rd_314. */
export function topicFor(subject: { type: SubjectType; id: string }): string {
  return `${subject.type}.${subject.id}`;
}

/**
 * Bounded replay: clients resume with lastSeq, the gateway replays at most
 * `maxReplay` events, and anything larger falls back to a REST snapshot.
 */
export const MAX_REPLAY_EVENTS = 50;

export interface ResumeDecision {
  readonly action: "replay" | "snapshot" | "up_to_date";
  readonly fromSequence: number;
  readonly count: number;
}

export function decideResume(
  lastSeenSequence: number,
  currentSequence: number,
  maxReplay: number = MAX_REPLAY_EVENTS,
): ResumeDecision {
  if (currentSequence <= lastSeenSequence) {
    return { action: "up_to_date", fromSequence: currentSequence, count: 0 };
  }
  const gap = currentSequence - lastSeenSequence;
  if (gap > maxReplay) {
    return { action: "snapshot", fromSequence: currentSequence, count: 0 };
  }
  return { action: "replay", fromSequence: lastSeenSequence + 1, count: gap };
}
