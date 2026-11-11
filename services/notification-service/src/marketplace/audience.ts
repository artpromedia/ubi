/**
 * Notification audience + per-viewer copy model (marketplace, trip access,
 * airport transfers, delivery returns).
 *
 * Every notifiable event names the ROLES it addresses, each with its own copy
 * (the rider and the driver of one trip are told different things about the
 * same event). A role absent from a spec is never told — that is how privacy
 * by audience is enforced:
 *
 *   - bid events stay private between the requester and the bidding driver;
 *     recipient LISTS in payloads (driverIds / audienceDriverIds) are never
 *     read, so a push can never reach a rival bidder;
 *   - drivers never receive rider PII and riders never receive the driver's
 *     commission: copy is static per role and the push DATA is a hint built
 *     only from ids (buildHintData) — never an amount, a name, a phone or a
 *     PIN;
 *   - the guest passenger of a booking-for-another-adult has no role here at
 *     all: they are reached ONLY by the sealed trip-link SMS
 *     (../trip-access/), never by push and never by a phone lookup.
 *
 * This mirrors realtime-gateway's fan-out rules deliberately as a second
 * implementation (the shared contract is the event catalog, not code); the
 * unit tests assert the privacy invariants directly.
 */
import type { EventEnvelope } from "@ubi/contracts";

/** Who a notification is for, relative to the event. */
export type Role =
  | "requester"
  | "driver"
  | "sender"
  | "traveller"
  | "fleet_owner"
  | "fleet_manager"
  | "ubi_ops";

/** Resolution order (and the order recipients are processed in). */
export const ROLES: readonly Role[] = [
  "requester",
  "driver",
  "sender",
  "traveller",
  "fleet_owner",
  "fleet_manager",
  "ubi_ops",
];

/** Which preference category gates this push. */
export type PushPrefCategory = "ride" | "payment" | "delivery";

export interface ViewerCopy {
  readonly title: string;
  readonly body: string;
}

/** Static copy, or copy that depends on the event (null = not this time). */
export type CopyRule =
  | ViewerCopy
  | ((envelope: EventEnvelope) => ViewerCopy | null);

export interface NotificationSpec {
  readonly prefCategory: PushPrefCategory;
  /** Notification type recorded on the log row. */
  readonly type: string;
  /** Per-role copy. A role absent here is never notified of this event. */
  readonly copy: Partial<Record<Role, CopyRule>>;
  /**
   * By default the person who performed the action (envelope.actor, when a
   * rider or driver) is not pushed about it — they already know. Set when the
   * catalog names the actor as the audience (a driver's own free decline).
   */
  readonly notifyActor?: boolean;
  /**
   * Time-critical: when no device can take the push, fall back to ONE SMS to
   * the recipient's own verified account phone (never anyone else's).
   */
  readonly smsFallback?: boolean | ((envelope: EventEnvelope) => boolean);
}

export interface AddressedRole {
  readonly role: Role;
  readonly copy: ViewerCopy;
}

/** The roles this event addresses right now, with their copy. */
export function addressedRoles(
  envelope: EventEnvelope,
  spec: NotificationSpec,
): AddressedRole[] {
  const out: AddressedRole[] = [];
  for (const role of ROLES) {
    const rule = spec.copy[role];
    if (rule === undefined) {
      continue;
    }
    const copy = typeof rule === "function" ? rule(envelope) : rule;
    if (copy !== null) {
      out.push({ role, copy });
    }
  }
  return out;
}

export function asId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** A payload id, or null. */
export function payloadId(envelope: EventEnvelope, key: string): string | null {
  return asId(envelope.payload[key]);
}

/** True when the actor is a person (rider/driver/…), not a system. */
export function isPersonActor(actor: EventEnvelope["actor"]): boolean {
  return actor.type !== "system" && actor.type !== "agent";
}

/** The client surface a hint opens. */
function hintKind(name: string): string {
  if (name.startsWith("reservation.")) {
    return "airport_transfer";
  }
  if (name.startsWith("shipment.")) {
    return "delivery";
  }
  if (
    name.startsWith("fleet.") ||
    name.startsWith("assignment.") ||
    name.startsWith("maintenance.") ||
    name.startsWith("vehicle.document.") ||
    name === "driver.availability.saved"
  ) {
    return "fleet";
  }
  return "marketplace";
}

/** The ONLY keys a push data payload may carry. */
export const HINT_DATA_KEYS: readonly string[] = [
  "kind",
  "name",
  "subjectType",
  "subjectId",
  "requestId",
  "bookingId",
  "fleetId",
  "vehicleId",
  "proposalId",
  "assignmentId",
  "blockId",
  "conflictId",
  "swapId",
  "seq",
];

/**
 * Build the hint DATA payload. This is the ONLY place the wire payload is
 * assembled, and it copies ONLY ids and the event type — never an amount, a
 * currency, a bid price, a commission, a name, a phone or a PIN. Everything is
 * a string (FCM data values must be strings). The client uses these ids to
 * pull the authoritative, viewer-scoped state over REST.
 */
export function buildHintData(envelope: EventEnvelope): Record<string, string> {
  const requestId =
    payloadId(envelope, "requestId") ??
    (envelope.subject.type === "mp_request" ? envelope.subject.id : null);
  const bookingId =
    payloadId(envelope, "bookingId") ??
    (envelope.subject.type === "mp_advance_booking"
      ? envelope.subject.id
      : null);
  const fleetId =
    payloadId(envelope, "fleetId") ??
    (envelope.subject.type === "fleet" ? envelope.subject.id : null);
  const vehicleId =
    payloadId(envelope, "vehicleId") ??
    (envelope.subject.type === "vehicle" ? envelope.subject.id : null);
  const proposalId = payloadId(envelope, "proposalId");
  const assignmentId =
    payloadId(envelope, "assignmentId") ??
    (envelope.subject.type === "assignment" && !proposalId
      ? envelope.subject.id
      : null);
  const blockId =
    payloadId(envelope, "blockId") ??
    payloadId(envelope, "maintenanceBlockId") ??
    (envelope.subject.type === "maintenance_block"
      ? envelope.subject.id
      : null);
  const conflictId =
    payloadId(envelope, "conflictId") ??
    (envelope.subject.type === "fleet_conflict" ? envelope.subject.id : null);
  const swapId =
    payloadId(envelope, "swapId") ??
    (envelope.subject.type === "mp_vehicle_swap" ? envelope.subject.id : null);

  const data: Record<string, string> = {
    kind: hintKind(envelope.name),
    name: envelope.name,
    subjectType: envelope.subject.type,
    subjectId: envelope.subject.id,
  };
  if (requestId) data.requestId = requestId;
  if (bookingId) data.bookingId = bookingId;
  if (fleetId) data.fleetId = fleetId;
  if (vehicleId) data.vehicleId = vehicleId;
  if (proposalId) data.proposalId = proposalId;
  if (assignmentId) data.assignmentId = assignmentId;
  if (blockId) data.blockId = blockId;
  if (conflictId) data.conflictId = conflictId;
  if (swapId) data.swapId = swapId;
  if (typeof envelope.sequence === "number") {
    data.seq = String(envelope.sequence);
  }
  return data;
}
