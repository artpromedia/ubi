/**
 * Fleet availability calendar — the ride-service side (A05: handoff FL-2,
 * FL-4, FL-6, FL-8; docs/design/FLEET_CALENDAR_DECISIONS.md corrections 1-4
 * and 6). The building blocks `marketplace.ts` composes into the advance
 * booking views, and re-exports.
 *
 * Two surfaces live here:
 *
 *  1. INTERNAL CONTRACT A — ride-service <-> fleet-service. Service to
 *     service only: every route takes `X-Service-Key` (ride-service accepts
 *     FLEET_RIDE_SERVICE_KEY, fleet-service accepts FLEET_SERVICE_KEY; both at
 *     least 32 characters, compared in constant time, failing closed when
 *     unset). Never proxied by the client gateway. Money is
 *     `{amountMinor, currency}`; times are ISO-8601 UTC.
 *     ride-service serves (under /internal/fleet):
 *       1. POST occupancy/maintenance:preview
 *       2. POST occupancy/maintenance            (Idempotency-Key)
 *       3. POST occupancy/maintenance/:blockId/release (Idempotency-Key)
 *       4. POST occupancy/off-road               (Idempotency-Key)
 *       5. GET  occupancy/blocks                 (the fleet-safe projection)
 *       6. GET  drivers/:driverId/calendar       (MpDriverCalendarSchema)
 *       7. POST bookings/:blockId/vehicle-swaps  (Idempotency-Key)
 *     fleet-service serves (under /internal/fleet):
 *       8. GET  drivers/:driverId/vehicle-at?from&to
 *       9. GET  vehicles/:vehicleId
 *
 *  2. What the booking's own parties see of it: the DRIVER's risk alert and
 *     vehicle-swap decision, and the RIDER's consent to a vehicle change (D1)
 *     — riders never see why a booking is at risk.
 *
 * Non-negotiables encoded here rather than in prose:
 *  - a booking shown to a fleet is FULLY OPAQUE: exactly the OccupiedBlock
 *    fields — time (buffers included), the server's risk flag and deadline —
 *    and nothing else, not even as null (no rider, location, fare, request or
 *    booking internals; `blockId` is an opaque per-booking id, never the
 *    booking id). The schema is strict so an extra key fails parsing;
 *  - planned maintenance is never confirmed over a booking (the shared
 *    occupancy ledger's exclusion constraint answers 409
 *    `occupancy_conflict`); "report off-road" is the only path that affects a
 *    booking, and it only sets it `at_risk`, never cancels it;
 *  - a vehicle swap needs the booked driver's decision AND the rider's
 *    explicit consent, always; the fare is unchanged and the 10% commission
 *    is never charged again.
 */
import { z } from "zod";

import { MoneySchema } from "./money";
import { MP_VEHICLE_SWAP_STATES } from "./state-machines";

const Timestamp = z.string().datetime({ offset: true });
/** A document expiry: an ISO date (YYYY-MM-DD) or an ISO-8601 instant. */
const ExpiryDate = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  z.string().datetime({ offset: true }),
]);

// ── Internal contract A: shared constants ──────────────────────────────────

/** The service-authentication header on every contract A route. */
export const FLEET_INTERNAL_KEY_HEADER = "X-Service-Key";
/** The shortest service key either side accepts (fail closed below it). */
export const FLEET_INTERNAL_KEY_MIN_LENGTH = 32;
/** Both services mount contract A here; the client gateway never proxies it. */
export const FLEET_INTERNAL_BASE_PATH = "/internal/fleet";

/** Contract A error codes (the canonical `{code, message, details}` body). */
export const FLEET_INTERNAL_ERROR_CODES = [
  /** 409 — a maintenance block would overlap a booking (or another block). */
  "occupancy_conflict",
  /** 409 — an Idempotency-Key reused with a different body. */
  "idempotency_conflict",
  /** 422 — the proposed vehicle swap cannot be offered, with reasons. */
  "swap_ineligible",
] as const;
export type FleetInternalErrorCode =
  (typeof FLEET_INTERNAL_ERROR_CODES)[number];

// ── The fleet-safe booking projection (FL-6) ───────────────────────────────

/** A booking still ahead on the calendar, or one that entered the live slots. */
export const MP_OCCUPIED_BLOCK_KINDS = ["booked", "on_trip"] as const;
/** The server's risk flag on a booking — never computed by a client. */
export const MP_BOOKING_RISKS = ["ok", "at_risk"] as const;
export type MpBookingRisk = (typeof MP_BOOKING_RISKS)[number];

/**
 * The ONLY shape of a booking a fleet (or fleet-service) ever receives.
 * `startsAt`/`endsAt` INCLUDE the booking's pre/post buffers. Strict: any
 * other key — a rider, a location, a fare, a request or booking id — fails.
 */
export const MpOccupiedBlockSchema = z
  .object({
    blockId: z.string().min(1),
    driverId: z.string().min(1),
    vehicleId: z.string().min(1).nullable(),
    startsAt: Timestamp,
    endsAt: Timestamp,
    kind: z.enum(MP_OCCUPIED_BLOCK_KINDS),
    risk: z.enum(MP_BOOKING_RISKS),
    decisionDeadline: Timestamp.nullable(),
  })
  .strict();
export type MpOccupiedBlock = z.infer<typeof MpOccupiedBlockSchema>;

/** Exactly the OccupiedBlock keys, for allowlist tests on both sides. */
export const MP_OCCUPIED_BLOCK_FIELDS = [
  "blockId",
  "driverId",
  "vehicleId",
  "startsAt",
  "endsAt",
  "kind",
  "risk",
  "decisionDeadline",
] as const;

/** Route 5 — `GET /internal/fleet/occupancy/blocks?vehicleIds&driverIds&from&to`. */
export const MpOccupiedBlocksSchema = z
  .object({ blocks: z.array(MpOccupiedBlockSchema) })
  .strict();

// ── Maintenance and off-road occupancy (FL-2) ──────────────────────────────

/** Planned, time-based maintenance kinds (no odometer feed exists). */
export const MP_MAINTENANCE_KINDS = [
  "planned_service",
  "inspection",
  "repair",
] as const;
export type MpMaintenanceKind = (typeof MP_MAINTENANCE_KINDS)[number];

/** What occupies a vehicle on the shared ledger. */
export const MP_VEHICLE_OCCUPANCY_KINDS = [
  "booking",
  "maintenance",
  "off_road",
] as const;

/** Route 1 — `POST /internal/fleet/occupancy/maintenance:preview`. */
export const MpMaintenancePreviewRequestSchema = z
  .object({
    vehicleId: z.string().min(1),
    kind: z.enum(MP_MAINTENANCE_KINDS),
    startsAt: Timestamp,
    endsAt: Timestamp,
  })
  .strict();

export const MpMaintenancePreviewSchema = z
  .object({
    /** False when the block overlaps a booking or another block. */
    feasible: z.boolean(),
    /** The opaque bookings the block would overlap (buffers included). */
    affectedBlocks: z.array(MpOccupiedBlockSchema),
    /** The next window of the same length the server found free, or null. */
    nextFeasibleWindow: z
      .object({ startsAt: Timestamp, endsAt: Timestamp })
      .strict()
      .nullable(),
  })
  .strict();
export type MpMaintenancePreview = z.infer<typeof MpMaintenancePreviewSchema>;

/**
 * Route 2 — `POST /internal/fleet/occupancy/maintenance` (Idempotency-Key):
 * 201 `{occupancyId}`, or 409 `occupancy_conflict` with the affected blocks.
 * Atomic under the vehicle exclusion constraint; a replay with the same key
 * and body answers the same; a different body is `idempotency_conflict`.
 */
export const MpMaintenanceCreateRequestSchema = z
  .object({
    /** fleet-service's maintenance block id (the ledger's source id). */
    blockId: z.string().min(1),
    vehicleId: z.string().min(1),
    kind: z.enum(MP_MAINTENANCE_KINDS),
    startsAt: Timestamp,
    endsAt: Timestamp,
  })
  .strict();
export const MpOccupancyRecordedSchema = z
  .object({ occupancyId: z.string().min(1) })
  .strict();
export const MpOccupancyConflictSchema = z.object({
  code: z.literal("occupancy_conflict"),
  message: z.string().min(1),
  details: z
    .object({ affectedBlocks: z.array(MpOccupiedBlockSchema) })
    .passthrough(),
});

/**
 * Route 3 — `POST /internal/fleet/occupancy/maintenance/:blockId/release`
 * (Idempotency-Key). Releases a maintenance or off-road block; idempotent —
 * a block already released (or never recorded) answers the same.
 */
export const MpOccupancyReleasedSchema = z
  .object({ released: z.literal(true) })
  .strict();

/**
 * Route 4 — `POST /internal/fleet/occupancy/off-road` (Idempotency-Key). NOT
 * refused by bookings: every overlapping confirmed booking on the vehicle
 * moves to `at_risk` with its decision deadline. `expectedEndsAt: null` is an
 * open-ended breakdown.
 */
export const MpOffRoadRequestSchema = z
  .object({
    blockId: z.string().min(1),
    vehicleId: z.string().min(1),
    startsAt: Timestamp,
    expectedEndsAt: Timestamp.nullable(),
  })
  .strict();
export const MpOffRoadRecordedSchema = z
  .object({
    occupancyId: z.string().min(1),
    atRiskBookings: z.array(
      z
        .object({ blockId: z.string().min(1), decisionDeadline: Timestamp })
        .strict(),
    ),
  })
  .strict();

// ── Vehicle swap on an advance booking (FL-8) ──────────────────────────────

/** Why a proposed swap cannot be offered (`details.reasons` on 422). */
export const MP_SWAP_INELIGIBLE_REASONS = [
  "swaps_not_enabled",
  "booking_not_swappable",
  "swap_already_open",
  "same_vehicle",
  "vehicle_unknown",
  "different_fleet",
  "class_not_eligible",
  "capacity_too_small",
  "vehicle_occupied",
  "vehicle_off_road",
  "documents_expired",
  "fleet_service_unavailable",
] as const;
export type MpSwapIneligibleReason =
  (typeof MP_SWAP_INELIGIBLE_REASONS)[number];

/** Route 7 — `POST /internal/fleet/bookings/:blockId/vehicle-swaps`. */
export const MpFleetVehicleSwapRequestSchema = z
  .object({
    toVehicleId: z.string().min(1),
    /** Recorded for audit; never shown to the driver or the rider. */
    requestedByStaffId: z.string().min(1),
  })
  .strict();
export const MpFleetVehicleSwapCreatedSchema = z
  .object({ swapId: z.string().min(1), status: z.literal("proposed") })
  .strict();
export const MpSwapIneligibleSchema = z.object({
  code: z.literal("swap_ineligible"),
  message: z.string().min(1),
  details: z
    .object({ reasons: z.array(z.enum(MP_SWAP_INELIGIBLE_REASONS)).min(1) })
    .passthrough(),
});

// ── fleet-service routes ride-service calls (8, 9) ─────────────────────────

/**
 * Route 8 — `GET /internal/fleet/drivers/:driverId/vehicle-at?from&to`: the
 * vehicle a fleet driver is assigned to for that WHOLE interval under a
 * signed assignment; all null for a driver with no covering assignment.
 */
export const MpFleetVehicleAtSchema = z
  .object({
    vehicleId: z.string().min(1).nullable(),
    assignmentId: z.string().min(1).nullable(),
    vehicleClass: z.string().min(1).nullable(),
    capacity: z.number().int().positive().nullable(),
  })
  .strict();
export type MpFleetVehicleAt = z.infer<typeof MpFleetVehicleAtSchema>;

/** Route 9 — `GET /internal/fleet/vehicles/:vehicleId` (swap revalidation). */
export const MpFleetVehicleSchema = z
  .object({
    vehicleId: z.string().min(1),
    fleetId: z.string().min(1),
    classes: z.array(z.string().min(1)),
    capacity: z.number().int().positive(),
    documents: z
      .object({
        insuranceExpiry: ExpiryDate.nullable(),
        inspectionExpiry: ExpiryDate.nullable(),
      })
      .strict(),
  })
  .strict();
export type MpFleetVehicle = z.infer<typeof MpFleetVehicleSchema>;

// ── What the booking's own parties see ─────────────────────────────────────

/** Why a booking is at risk (DRIVER view only — never shown to the rider). */
export const MP_BOOKING_RISK_REASONS = [
  "off_road",
  "document_expiry",
  "assignment_ending",
  "vehicle_conflict",
] as const;

/**
 * Driver view: the server's risk overlay on the booking. The driver may keep
 * the booking on a swapped vehicle (when the fleet proposes one), wait for
 * the blocker to clear, or withdraw; at the deadline the booking fails with
 * the commission returned.
 */
export const MpBookingRiskViewSchema = z.object({
  state: z.enum(MP_BOOKING_RISKS),
  decisionDeadline: Timestamp.nullable(),
  reasons: z.array(z.enum(MP_BOOKING_RISK_REASONS)),
  message: z.string().min(1),
});
export type MpBookingRiskView = z.infer<typeof MpBookingRiskViewSchema>;

/** A vehicle as a booking's parties see it: a server-written label only. */
export const MpBookingVehicleSchema = z.object({
  /** e.g. "Comfort · 4 seats" — composed by the server, never the client. */
  label: z.string().min(1),
  classes: z.array(z.string().min(1)),
  capacity: z.number().int().positive().nullable(),
});
export type MpBookingVehicle = z.infer<typeof MpBookingVehicleSchema>;

/**
 * Rider view (D1 BookingChangeConsent): a vehicle change awaiting the rider's
 * explicit consent. Same driver, fare unchanged; nothing changes unless the
 * rider confirms, and cancelling the booking stays free.
 * `POST /v1/mp/advance-bookings/:id/changes/:changeId/accept|decline`.
 */
export const MpBookingPendingChangeSchema = z.object({
  changeId: z.string().min(1),
  kind: z.literal("vehicle_swap"),
  sameDriver: z.literal(true),
  from: MpBookingVehicleSchema.nullable(),
  to: MpBookingVehicleSchema,
  fareMinor: MoneySchema,
  fareUnchanged: z.literal(true),
  expiresAt: Timestamp,
  notice: z.string().min(1),
});
export type MpBookingPendingChange = z.infer<
  typeof MpBookingPendingChangeSchema
>;

/**
 * Driver view: a fleet's proposal to move this booking to another vehicle,
 * awaiting the driver's decision (made parked, like every driver decision).
 * `POST /v1/mp/advance-bookings/:id/vehicle-swaps/:swapId/accept|decline`.
 */
export const MpBookingVehicleSwapOfferSchema = z.object({
  swapId: z.string().min(1),
  state: z.enum(MP_VEHICLE_SWAP_STATES),
  from: MpBookingVehicleSchema.nullable(),
  to: MpBookingVehicleSchema,
  expiresAt: Timestamp,
  notice: z.string().min(1),
});
export type MpBookingVehicleSwapOffer = z.infer<
  typeof MpBookingVehicleSwapOfferSchema
>;
