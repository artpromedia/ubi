/**
 * Fleet availability, maintenance and assignments (addendum A05) — the
 * contract fleet-service serves and ride-service / payment-service consume.
 *
 * Sources: docs/design/FLEET_CALENDAR_DECISIONS.md (WINS where it differs),
 * docs/launch-readiness/handoff-fleet-calendar/README.md (the Claude Design
 * handoff), docs/design/FLEET_AVAILABILITY_CALENDAR_BRIEF.md and
 * contracts/openapi/fleet.yaml.
 *
 * WHO SERVES WHAT
 *  - fleet-service (services/fleet-service) owns fleets, staff roles, fleet
 *    vehicles, the assignment HISTORY (which driver drives which vehicle, on
 *    which shift, under which signed terms version), proposals and their PIN
 *    signature evidence, maintenance blocks, driver-authored availability and
 *    the conflict centre. Client routes are `/v1/fleets/…`,
 *    `/v1/fleet-offers/…` and the driver routes `/v1/drivers/me/fleet…`,
 *    `/v1/drivers/me/schedule`, `/v1/drivers/me/availability…` and
 *    `/v1/drivers/me/conflicts/…`, all behind the deny-by-default `fleet` flag
 *    and the gateway-signed identity.
 *  - ride-service owns bookings and the single vehicle OCCUPANCY ledger
 *    (maintenance and bookings in one table with the `(vehicle_id, range)`
 *    exclusion — decisions doc, engineering correction 3). fleet-service
 *    reaches it only through INTERNAL CONTRACT A below.
 *  - payment-service owns remittance settlement on the canonical ledger and
 *    reads its inputs from fleet-service through INTERNAL CONTRACT B below.
 *    There are no settlement tables in fleet-service.
 *
 * Non-negotiables encoded here rather than in prose:
 *  - fleets NEVER see rider identity, contact, location, route, fare or
 *    safety evidence, nor a driver's NET earnings. A booking reaches a fleet
 *    only as `OccupiedBlock` (time + server risk flag, nothing else — not even
 *    a null rider field). `FLEET_FORBIDDEN_FIELD_PATTERNS` is walked over
 *    every response schema in `FLEET_RESPONSE_SCHEMAS` by fleet-service's
 *    privacy test;
 *  - a driver's time off reaches a fleet only as an unexplained
 *    `unavailable` block;
 *  - a fleet proposes, the driver signs with the wallet PIN (verified by
 *    user-service, never by the client). Managers may propose shift and
 *    vehicle changes only under the driver's CURRENTLY SIGNED terms version;
 *    new remittance terms are owner-only. Declining has no penalty and no
 *    reason; the fleet sees only `declined`;
 *  - planned maintenance is never confirmed over a confirmed booking (409);
 *    "report off-road" is the only fleet action that affects one — it sets
 *    the booking `at_risk` (never cancels) and is audited and flagged if the
 *    vehicle goes online during the claimed breakdown;
 *  - money is integer minor units with the city's currency, server-computed.
 */
import { z } from "zod";

import { CurrencySchema, MoneySchema } from "./money";

const Timestamp = z.string().datetime({ offset: true });

/** A calendar date in the fleet's city zone, `YYYY-MM-DD`. */
export const FleetLocalDateSchema = z
  .string()
  .regex(
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
    "expected YYYY-MM-DD",
  );

/** A wall-clock time in the fleet's city zone, `HH:mm` (24h). */
export const FleetLocalTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:mm (24-hour)");

// ── Vocabulary ─────────────────────────────────────────────────────────────

/** The deny-by-default city flag every client route checks (flags.ts). */
export const FLEET_FLAG = "fleet" as const;

/**
 * Gateway scopes. `fleet:read` / `fleet:manage` only decide whether a session
 * may ASK; authority inside a fleet (owner / manager / read-only) is
 * fleet-service's own staff check. `fleet:driver` is the driver side (offers,
 * signing, schedule, availability, own conflicts). None survives limited mode.
 */
export const FLEET_SCOPES = [
  "fleet:read",
  "fleet:manage",
  "fleet:driver",
] as const;
export type FleetScope = (typeof FLEET_SCOPES)[number];

export const FLEET_STAFF_ROLES = ["owner", "manager", "read_only"] as const;
export type FleetStaffRole = (typeof FLEET_STAFF_ROLES)[number];

/**
 * The role matrix (handoff B9, decisions correction 5). `never` rows — rider
 * identity, routes, safety evidence — are not capabilities at all.
 */
export const FLEET_CAPABILITIES = {
  view_calendar: ["owner", "manager", "read_only"],
  manage_maintenance: ["owner", "manager"],
  report_off_road: ["owner", "manager"],
  propose_assignment: ["owner", "manager"],
  propose_terms: ["owner"],
  manage_vehicles: ["owner", "manager"],
  request_vehicle_swap: ["owner", "manager"],
  remind_driver: ["owner", "manager"],
  terminate_arrangement: ["owner"],
  manage_staff: ["owner"],
} as const satisfies Record<string, readonly FleetStaffRole[]>;
export type FleetCapability = keyof typeof FLEET_CAPABILITIES;

/**
 * Mirrors VEHICLE_CLASSES (city-config.ts); fleet-service also checks every
 * class against the city's configured `vehicleClasses`.
 */
export const FLEET_VEHICLE_CLASSES = ["go", "comfort", "xl", "moto"] as const;

export const FLEET_SHIFT_KINDS = ["full", "day", "night", "custom"] as const;
export type FleetShiftKind = (typeof FLEET_SHIFT_KINDS)[number];

export const MAINTENANCE_KINDS = [
  "planned_service",
  "inspection",
  "repair",
  "unplanned_off_road",
] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];

/** Fleet-scheduled downtime (decisions Q2: pro-rated on weekly_fixed terms). */
export const PLANNED_MAINTENANCE_KINDS = [
  "planned_service",
  "inspection",
  "repair",
] as const;
export type PlannedMaintenanceKind = (typeof PLANNED_MAINTENANCE_KINDS)[number];

export const MAINTENANCE_STATUSES = [
  "draft",
  "checking",
  "needs_resolution",
  "scheduled",
  "active",
  "completed",
  "cancelled",
] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const PROPOSAL_STATUSES = [
  "draft",
  "checking",
  "sent",
  "pending_signature",
  "signed",
  "declined",
  "expired",
  "withdrawn",
  "superseded",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/**
 * A SIGNED arrangement (one row per signed terms version). The legacy
 * `fleetAssignment` machine in contracts/state-machines.json models offer and
 * arrangement together; fleet-service keeps them apart as the handoff does
 * (AssignmentProposal + Assignment).
 */
export const ARRANGEMENT_STATUSES = [
  "active",
  "notice",
  "ended",
  "superseded",
] as const;
export type ArrangementStatus = (typeof ARRANGEMENT_STATUSES)[number];

export const AVAILABILITY_KINDS = ["available", "time_off"] as const;
export type AvailabilityKind = (typeof AVAILABILITY_KINDS)[number];

export const AVAILABILITY_STATUSES = [
  "draft",
  "checking",
  "saved",
  "saved_with_withdrawals",
  "removed",
] as const;

export const CONFLICT_TYPES = [
  "maintenance_overlaps_booking",
  "unplanned_off_road",
  "document_expiring",
  "document_expires_in_booking",
  "time_off_overlaps_booking",
  "termination_bookings",
  "vehicle_service_requested",
] as const;
export type ConflictType = (typeof CONFLICT_TYPES)[number];

/**
 * What a FLEET sees as the conflict type. A driver's time off overlapping
 * their own booking is the driver's to resolve and reaches the fleet only as
 * `driver_resolving` — never labelled time off (decisions: Fleet view).
 */
export const FLEET_VISIBLE_CONFLICT_TYPES = [
  "maintenance_overlaps_booking",
  "unplanned_off_road",
  "document_expiring",
  "document_expires_in_booking",
  "driver_resolving",
  "termination_bookings",
  "vehicle_service_requested",
] as const;

export const CONFLICT_SEVERITIES = [
  "critical",
  "high",
  "medium",
  "blocked",
  "status",
] as const;
export const CONFLICT_RESOLVER_ROLES = [
  "fleet",
  "driver",
  "rider",
  "ubi",
] as const;
export const CONFLICT_STATUSES = [
  "open",
  "resolving",
  "resolved",
  "lapsed",
] as const;
export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];

/** Fleet-side conflict actions; which ones a caller gets depends on role. */
export const FLEET_CONFLICT_ACTIONS = [
  "move_block",
  "cancel_block",
  "complete_block",
  "propose_vehicle_swap",
  "ask_driver",
  "remind",
  "renew_document",
  "plan_maintenance",
] as const;
export type FleetConflictAction = (typeof FLEET_CONFLICT_ACTIONS)[number];

export const DOCUMENT_KINDS = ["insurance", "inspection"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_STATUSES = [
  "valid",
  "expiring",
  "expired",
  "missing",
] as const;

/**
 * Vehicle document upload/review types (CC-C02 / P1-05). `insurance` and
 * `inspection` write through to `vehicles.insurance_expiry` and
 * `vehicles.inspection_expiry` when reviewed `valid`.
 */
export const VEHICLE_DOCUMENT_TYPES = [
  "insurance",
  "inspection",
  "registration",
] as const;
export type VehicleDocumentType = (typeof VEHICLE_DOCUMENT_TYPES)[number];

export const VEHICLE_DOCUMENT_REVIEW_STATUSES = [
  "pending",
  "valid",
  "rejected",
  "expired",
] as const;
export type VehicleDocumentReviewStatus =
  (typeof VEHICLE_DOCUMENT_REVIEW_STATUSES)[number];

export const FLEET_DOCUMENT_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type FleetDocumentContentType =
  (typeof FLEET_DOCUMENT_CONTENT_TYPES)[number];

/** Maximum fleet KYB / vehicle document size: 10 MiB. */
export const FLEET_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export const FLEET_STATUSES = [
  "pending_review",
  "changes_requested",
  "approved",
  "active",
  "rejected",
  "suspended",
] as const;
export type FleetStatus = (typeof FLEET_STATUSES)[number];

export const FLEET_KYB_STATUSES = [
  "pending_review",
  "changes_requested",
  "approved",
  "rejected",
] as const;
export type FleetKybStatus = (typeof FLEET_KYB_STATUSES)[number];

export const FLEET_INVITATION_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "revoked",
  "expired",
] as const;
export type FleetInvitationStatus = (typeof FLEET_INVITATION_STATUSES)[number];

export const FLEET_INVITATION_KINDS = [
  "staff_invite",
  "ownership_transfer",
] as const;
export type FleetInvitationKind = (typeof FLEET_INVITATION_KINDS)[number];

/** UBI decisions — status only, never evidence, never an override. */
export const UBI_STATUSES = [
  "held_by_ubi",
  "doc_expired",
  "suspended",
] as const;

/** Derived, never written by a client (handoff: VehicleAvailability). */
export const VEHICLE_AVAILABILITY_STATES = [
  "in_service",
  "maintenance",
  "doc_expired",
  "held_by_ubi",
  "unassigned",
  /** UBI holds no verified expiry for a required document yet. */
  "documents_pending",
] as const;

export const OCCUPIED_BLOCK_KINDS = ["booked", "on_trip"] as const;
export const BOOKING_RISKS = ["ok", "at_risk"] as const;

// ── Policy (per market; pilot defaults until CityConfig carries `fleet`) ───

export const FleetKybRequirementSchema = z
  .object({
    key: z.string().min(1).max(64),
    label: z.string().min(1).max(160),
    kind: z.enum(["text", "document"]),
    required: z.boolean(),
  })
  .strict();
export type FleetKybRequirement = z.infer<typeof FleetKybRequirementSchema>;

export const FleetPolicySchema = z
  .object({
    /** A sent proposal lapses unsigned after this long (handoff: 48 h). */
    proposalTtlHours: z.number().int().positive(),
    /** Decisions Q6: warnings at these days before a document expires. */
    documentWarningDays: z.array(z.number().int().positive()).min(1),
    /** Decisions A5: utilisation is shown only after this many days of data. */
    utilisationMinDays: z.number().int().positive(),
    /** fleet.yaml: two-week notice from either side. */
    terminationNoticeDays: z.number().int().positive(),
    /** Named shift windows in local wall-clock time. */
    shifts: z.object({
      day: z.object({ start: FleetLocalTimeSchema, end: FleetLocalTimeSchema }),
      night: z.object({
        start: FleetLocalTimeSchema,
        end: FleetLocalTimeSchema,
      }),
    }),
    /** How far ahead an availability change is checked against bookings. */
    availabilityCheckHorizonDays: z.number().int().positive(),
    /**
     * Per-city KYB requirement list (DEC-5 / P1-05). When absent, fleet
     * creation stays in `pending_review` and cannot be approved until the
     * city's KYB requirements are configured.
     */
    kyb: z
      .object({
        requirements: z.array(FleetKybRequirementSchema).min(1),
      })
      .strict()
      .optional(),
  })
  .strict();
export type FleetPolicy = z.infer<typeof FleetPolicySchema>;

/**
 * Pilot defaults — the values the design handoff and the decisions doc name.
 * A market overrides them with a `fleet` block on its city config version.
 */
export const FLEET_POLICY_DEFAULTS: FleetPolicy = {
  proposalTtlHours: 48,
  documentWarningDays: [30, 14, 7, 1],
  utilisationMinDays: 7,
  terminationNoticeDays: 14,
  shifts: {
    day: { start: "06:00", end: "18:00" },
    night: { start: "18:00", end: "06:00" },
  },
  availabilityCheckHorizonDays: 60,
};

// ── State machines ─────────────────────────────────────────────────────────

interface FleetMachine {
  readonly initial: string;
  readonly transitions: Readonly<Record<string, readonly string[]>>;
}

export const FLEET_MACHINES = {
  maintenanceBlock: {
    initial: "draft",
    transitions: {
      draft: ["checking", "cancelled"],
      checking: ["scheduled", "needs_resolution", "cancelled"],
      needs_resolution: ["checking", "cancelled"],
      scheduled: ["active", "cancelled"],
      active: ["completed"],
      completed: [],
      cancelled: [],
    },
  },
  /**
   * `unplanned_off_road` enters `active` directly (handoff: created → active;
   * safety, no consent) — `FLEET_OFF_ROAD_INITIAL`.
   */
  assignmentProposal: {
    initial: "draft",
    transitions: {
      draft: ["checking", "withdrawn"],
      checking: ["sent", "draft"],
      sent: ["pending_signature", "withdrawn", "expired", "superseded"],
      pending_signature: [
        "signed",
        "declined",
        "expired",
        "withdrawn",
        "superseded",
      ],
      signed: [],
      declined: [],
      expired: [],
      withdrawn: [],
      superseded: [],
    },
  },
  arrangement: {
    initial: "active",
    transitions: {
      active: ["notice", "superseded", "ended"],
      notice: ["ended", "superseded"],
      ended: [],
      superseded: [],
    },
  },
  driverAvailability: {
    initial: "draft",
    transitions: {
      draft: ["checking"],
      checking: ["saved", "saved_with_withdrawals", "draft"],
      saved: ["removed"],
      saved_with_withdrawals: ["removed"],
      removed: [],
    },
  },
  conflict: {
    initial: "open",
    transitions: {
      open: ["resolving", "resolved", "lapsed"],
      resolving: ["open", "resolved", "lapsed"],
      resolved: [],
      lapsed: [],
    },
  },
  kybApplication: {
    initial: "pending_review",
    transitions: {
      pending_review: ["changes_requested", "approved", "rejected"],
      changes_requested: ["pending_review", "rejected"],
      approved: ["changes_requested", "rejected"],
      rejected: [],
    },
  },
  staffInvitation: {
    initial: "pending",
    transitions: {
      pending: ["accepted", "declined", "revoked", "expired"],
      accepted: [],
      declined: [],
      revoked: [],
      expired: [],
    },
  },
  vehicleDocument: {
    initial: "pending",
    transitions: {
      pending: ["valid", "rejected"],
      valid: ["expired", "rejected"],
      rejected: [],
      expired: [],
    },
  },
} as const satisfies Record<string, FleetMachine>;
export type FleetMachineName = keyof typeof FLEET_MACHINES;

export const FLEET_OFF_ROAD_INITIAL = "active" as const;

export function canFleetTransition(
  machine: FleetMachineName,
  from: string,
  to: string,
): boolean {
  const transitions: Readonly<Record<string, readonly string[]>> =
    FLEET_MACHINES[machine].transitions;
  const allowed = transitions[from];
  return allowed !== undefined && allowed.includes(to);
}

// ── Error codes (registered in errors.ts ERROR_CODES) ──────────────────────

/** Fleet-specific codes and the HTTP status each answers with. */
export const FLEET_ERROR_STATUS = {
  /** Two signed shifts on one vehicle (or one driver) would overlap. */
  shift_overlap: 422,
  /** A weekly_fixed remittance above the city's `remittanceCapMinor`. */
  above_city_cap: 422,
  /** Planned maintenance overlaps a confirmed booking: resolve first. */
  needs_resolution: 409,
  /** Managers propose only under the currently signed terms version. */
  terms_owner_only: 403,
  /** A vehicle swap the server found ineligible (reasons in details). */
  swap_ineligible: 422,
  /** The request no longer matches the server preview it cites. */
  preview_stale: 409,
  /** Two planned maintenance blocks on one vehicle would overlap. */
  maintenance_overlap: 409,
  /** A time-off change overlaps bookings the driver has not chosen for. */
  unresolved_booking_overlap: 409,
  /** Fleet KYB is not approved yet: assignments/maintenance cannot run (P1-05). */
  kyb_not_approved: 403,
  /** City config has no `fleet.kyb.requirements` yet (DEC-5). */
  kyb_requirements_unconfigured: 409,
  /** Uploaded document failed size, SHA-256, or magic-byte verification. */
  upload_verification_failed: 422,
  /** Private document storage is not configured in this environment. */
  doc_storage_not_configured: 503,
  /** Private document storage was unreachable or errored. */
  doc_storage_unavailable: 503,
  /** Staff invitation or ownership transfer has expired. */
  invitation_expired: 409,
  /** Submitted vehicle document has an expiry date in the past. */
  document_already_expired: 422,
} as const;
export type FleetErrorCode = keyof typeof FLEET_ERROR_STATUS;
export const FLEET_ERROR_CODES = Object.keys(
  FLEET_ERROR_STATUS,
) as readonly FleetErrorCode[];

// ── Events (registered in events.ts EVENT_NAMES) ───────────────────────────

/**
 * Payloads carry ids, codes, times and money only — never PII. The handoff's
 * names are kept verbatim (`fleet.conflict.*`, `maintenance.status.changed`,
 * `assignment.proposal.status.changed`, `vehicle.document.expiring`, the
 * off-road report); the rest follow the same shape.
 */
export const FLEET_EVENT_NAMES = [
  "fleet.created",
  "fleet.kyb.submitted",
  "fleet.kyb.status.changed",
  "fleet.staff.changed",
  "fleet.invitation.sent",
  "fleet.invitation.responded",
  "fleet.invitation.revoked",
  "fleet.vehicle.added",
  "vehicle.document.submitted",
  "vehicle.document.reviewed",
  "assignment.proposal.status.changed",
  "assignment.signed",
  "assignment.status.changed",
  "maintenance.status.changed",
  "fleet.offroad.reported",
  "fleet.offroad.flagged",
  "fleet.conflict.opened",
  "fleet.conflict.resolved",
  "fleet.conflict.lapsed",
  "fleet.conflict.reminder_sent",
  "vehicle.document.expiring",
  "vehicle.document.expired",
  "driver.availability.saved",
  "fleet.vehicle_swap.requested",
  "fleet.alert",
] as const;
export type FleetEventName = (typeof FLEET_EVENT_NAMES)[number];

/**
 * The envelope subjects fleet-service publishes under (events.ts
 * SUBJECT_TYPES must hold each): fleets and staff `fleet`, proposals and
 * signed arrangements `assignment`, a fleet vehicle `vehicle`, a maintenance
 * block or off-road report `maintenance_block`, a conflict `fleet_conflict`,
 * a driver's availability set `driver`.
 */
export const FLEET_SUBJECT_TYPES = [
  "fleet",
  "assignment",
  "vehicle",
  "maintenance_block",
  "fleet_conflict",
  "driver",
] as const;
export type FleetSubjectType = (typeof FLEET_SUBJECT_TYPES)[number];

/** The envelope actor types fleet-service records (events.ts ACTOR_TYPES). */
export const FLEET_ACTOR_TYPES = ["fleet", "driver", "system"] as const;
export type FleetActorType = (typeof FLEET_ACTOR_TYPES)[number];

// ── Shared shapes ──────────────────────────────────────────────────────────

/** `full` / `day` / `night` (fleet.yaml), or a custom `{start, end}`. */
export const FleetShiftInputSchema = z.union([
  z.enum(["full", "day", "night"]),
  z
    .object({ start: FleetLocalTimeSchema, end: FleetLocalTimeSchema })
    .strict()
    .refine((shift) => shift.start !== shift.end, {
      message:
        "a custom shift must not start and end at the same time; use full",
    }),
]);
export type FleetShiftInput = z.infer<typeof FleetShiftInputSchema>;

/** A resolved shift: local wall-clock start and end (end < start crosses midnight). */
export const FleetShiftSchema = z.object({
  kind: z.enum(FLEET_SHIFT_KINDS),
  start: FleetLocalTimeSchema,
  end: FleetLocalTimeSchema,
});
export type FleetShift = z.infer<typeof FleetShiftSchema>;

export const ShortfallSchema = z
  .object({
    policy: z.literal("carry_forward"),
    maxWeeks: z.number().int().min(1).max(52),
  })
  .strict();

/**
 * Remittance terms as an OWNER proposes them. The currency is never taken
 * from a client: it is the fleet's city currency.
 */
export const AssignmentTermsInputSchema = z
  .object({
    type: z.enum(["weekly_fixed", "percent_of_net"]),
    amountMinor: z.number().int().positive().optional(),
    percent: z.number().positive().max(100).optional(),
    shortfall: ShortfallSchema,
    fuelBy: z.enum(["driver", "fleet"]),
    servicingBy: z.enum(["driver", "fleet"]),
  })
  .strict()
  .superRefine((terms, ctx) => {
    if (terms.type === "weekly_fixed") {
      if (terms.amountMinor === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["amountMinor"],
          message: "weekly_fixed terms need amountMinor",
        });
      }
      if (terms.percent !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["percent"],
          message: "weekly_fixed terms carry no percent",
        });
      }
    } else {
      if (terms.percent === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["percent"],
          message: "percent_of_net terms need percent",
        });
      }
      if (terms.amountMinor !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["amountMinor"],
          message: "percent_of_net terms carry no amountMinor",
        });
      }
    }
  });
export type AssignmentTermsInput = z.infer<typeof AssignmentTermsInputSchema>;

/** A terms snapshot, exactly as signed. */
export const AssignmentTermsSchema = z.object({
  type: z.enum(["weekly_fixed", "percent_of_net"]),
  amountMinor: z.number().int().positive().nullable(),
  currency: CurrencySchema,
  percent: z.number().positive().max(100).nullable(),
  shortfall: ShortfallSchema,
  fuelBy: z.enum(["driver", "fleet"]),
  servicingBy: z.enum(["driver", "fleet"]),
});
export type AssignmentTerms = z.infer<typeof AssignmentTermsSchema>;

/** Which parts of an arrangement a proposal changes; `material` needs a new PIN. */
export const TermDiffSchema = z.object({
  field: z.enum([
    "vehicle",
    "shift",
    "validity",
    "remittance",
    "shortfall",
    "fuelBy",
    "servicingBy",
  ]),
  material: z.boolean(),
});
export type TermDiff = z.infer<typeof TermDiffSchema>;

const IntervalSchema = z.object({ startsAt: Timestamp, endsAt: Timestamp });

// ── INTERNAL CONTRACT A — ride-service ⇄ fleet-service ─────────────────────
//
// Auth: X-Service-Key on every route. ride-service accepts
// FLEET_RIDE_SERVICE_KEY (fleet → ride); fleet-service accepts
// FLEET_SERVICE_KEY (ride → fleet). Both ≥ 32 chars, constant-time compare,
// fail closed when unset. Never proxied by the gateway.

export const FLEET_SERVICE_KEY_HEADER = "X-Service-Key";

/**
 * THE ONLY booking shape a fleet receives. `startsAt`/`endsAt` INCLUDE the
 * booking buffers. Strict: no rider, location, fare, request or booking
 * internals may be present at all — not even as null.
 */
export const OccupiedBlockSchema = z
  .object({
    blockId: z.string().min(1),
    driverId: z.string().min(1),
    vehicleId: z.string().min(1).nullable(),
    startsAt: Timestamp,
    endsAt: Timestamp,
    kind: z.enum(OCCUPIED_BLOCK_KINDS),
    risk: z.enum(BOOKING_RISKS),
    decisionDeadline: Timestamp.nullable(),
  })
  .strict();
export type OccupiedBlock = z.infer<typeof OccupiedBlockSchema>;
export const OCCUPIED_BLOCK_FIELDS = [
  "blockId",
  "driverId",
  "vehicleId",
  "startsAt",
  "endsAt",
  "kind",
  "risk",
  "decisionDeadline",
] as const;

/** Route 1 request. */
export const RideMaintenancePreviewRequestSchema = z
  .object({
    vehicleId: z.string().min(1),
    kind: z.enum(PLANNED_MAINTENANCE_KINDS),
    startsAt: Timestamp,
    endsAt: Timestamp,
  })
  .strict();
/** Route 1 response. */
export const RideMaintenancePreviewResponseSchema = z.object({
  feasible: z.boolean(),
  affectedBlocks: z.array(OccupiedBlockSchema),
  nextFeasibleWindow: IntervalSchema.nullable(),
});
/** Route 2 request (+ Idempotency-Key). */
export const RideCreateMaintenanceOccupancySchema = z
  .object({
    blockId: z.string().min(1),
    vehicleId: z.string().min(1),
    kind: z.enum(PLANNED_MAINTENANCE_KINDS),
    startsAt: Timestamp,
    endsAt: Timestamp,
  })
  .strict();
export const RideOccupancyCreatedSchema = z.object({
  occupancyId: z.string().min(1),
});
/** Route 2 refusal: 409 `occupancy_conflict`. */
export const RideOccupancyConflictSchema = z.object({
  code: z.literal("occupancy_conflict"),
  message: z.string().optional(),
  details: z.object({ affectedBlocks: z.array(OccupiedBlockSchema) }),
});
/** Route 3 response. */
export const RideOccupancyReleasedSchema = z.object({
  released: z.literal(true),
});
/** Route 4 request (+ Idempotency-Key). */
export const RideOffRoadRequestSchema = z
  .object({
    blockId: z.string().min(1),
    vehicleId: z.string().min(1),
    startsAt: Timestamp,
    expectedEndsAt: Timestamp.nullable(),
  })
  .strict();
export const RideOffRoadResponseSchema = z.object({
  occupancyId: z.string().min(1),
  atRiskBookings: z.array(
    z.object({ blockId: z.string().min(1), decisionDeadline: Timestamp }),
  ),
});
/** Route 5 response. */
export const RideOccupiedBlocksResponseSchema = z.object({
  blocks: z.array(OccupiedBlockSchema),
});
/**
 * Route 6 response: the driver-entitled calendar entries, the same shape as
 * MpDriverCalendar's `bookings` (MpAdvanceBookingSchema, driver view).
 */
export const RideDriverCalendarResponseSchema = z.object({
  bookings: z.array(z.record(z.unknown())),
});
/** Route 7 request (+ Idempotency-Key). */
export const RideVehicleSwapRequestSchema = z
  .object({
    toVehicleId: z.string().min(1),
    requestedByStaffId: z.string().min(1),
  })
  .strict();
export const RideVehicleSwapResponseSchema = z.object({
  swapId: z.string().min(1),
  status: z.literal("proposed"),
});
/** Route 7 refusal: 422 `swap_ineligible`. */
export const RideSwapIneligibleSchema = z.object({
  code: z.literal("swap_ineligible"),
  message: z.string().optional(),
  details: z.object({ reasons: z.array(z.string()) }),
});

/** Route 8 (served by fleet-service). */
export const FleetVehicleAtResponseSchema = z.object({
  vehicleId: z.string().min(1).nullable(),
  assignmentId: z.string().min(1).nullable(),
  /** The vehicle's primary class (the first of its classes). */
  vehicleClass: z.string().min(1).nullable(),
  capacity: z.number().int().positive().nullable(),
});
export type FleetVehicleAtResponse = z.infer<
  typeof FleetVehicleAtResponseSchema
>;

/** Route 9 (served by fleet-service): swap revalidation facts. */
export const FleetInternalVehicleSchema = z.object({
  vehicleId: z.string().min(1),
  fleetId: z.string().min(1),
  classes: z.array(z.string().min(1)),
  capacity: z.number().int().positive(),
  documents: z.object({
    insuranceExpiry: Timestamp.nullable(),
    inspectionExpiry: Timestamp.nullable(),
  }),
});

/**
 * Live go-online & award vehicle resolution (CC-A01 / DEC-3 = A, served by
 * fleet-service under `GET /internal/fleet/drivers/:driverId/online-vehicle`).
 */
export const FleetOnlineVehicleResponseSchema = z.object({
  fleetMember: z.boolean(),
  status: z.enum([
    "not_fleet_driver",
    "ok",
    "no_active_shift",
    "vehicle_inactive",
    "doc_expired",
  ]),
  assignmentId: z.string().min(1).nullable(),
  shiftEndsAt: Timestamp.nullable(),
  vehicle: z
    .object({
      vehicleId: z.string().min(1),
      fleetId: z.string().min(1),
      plateMasked: z.string().min(1),
      make: z.string().min(1).nullable(),
      model: z.string().min(1).nullable(),
      colour: z.string().min(1).nullable(),
      bodyType: z.enum(["sedan", "suv", "van", "motorcycle", "electric"]),
      classes: z.array(z.string().min(1)),
      capacity: z.number().int().positive(),
      documents: z.object({
        insuranceExpiry: Timestamp.nullable(),
        inspectionExpiry: Timestamp.nullable(),
      }),
    })
    .nullable(),
});
export type FleetOnlineVehicleResponse = z.infer<
  typeof FleetOnlineVehicleResponseSchema
>;

/** The seven routes ride-service serves and the two fleet-service serves. */
export const CONTRACT_A_ROUTES = {
  maintenancePreview: {
    server: "ride-service",
    method: "POST",
    path: "/internal/fleet/occupancy/maintenance:preview",
  },
  maintenanceCreate: {
    server: "ride-service",
    method: "POST",
    path: "/internal/fleet/occupancy/maintenance",
  },
  maintenanceRelease: {
    server: "ride-service",
    method: "POST",
    path: "/internal/fleet/occupancy/maintenance/{blockId}/release",
  },
  offRoad: {
    server: "ride-service",
    method: "POST",
    path: "/internal/fleet/occupancy/off-road",
  },
  occupiedBlocks: {
    server: "ride-service",
    method: "GET",
    path: "/internal/fleet/occupancy/blocks",
  },
  driverCalendar: {
    server: "ride-service",
    method: "GET",
    path: "/internal/fleet/drivers/{driverId}/calendar",
  },
  vehicleSwap: {
    server: "ride-service",
    method: "POST",
    path: "/internal/fleet/bookings/{blockId}/vehicle-swaps",
  },
  vehicleAt: {
    server: "fleet-service",
    method: "GET",
    path: "/internal/fleet/drivers/{driverId}/vehicle-at",
  },
  vehicle: {
    server: "fleet-service",
    method: "GET",
    path: "/internal/fleet/vehicles/{vehicleId}",
  },
} as const;

// ── INTERNAL CONTRACT B — fleet-service → payment-service ──────────────────
//
// X-Service-Key = FLEET_PAYMENT_SERVICE_KEY (≥ 32 chars, constant time, fail
// closed). Hours are decimal hours (2 dp) computed from SIGNED shift
// intervals intersected with the settlement week and with maintenance blocks
// (planned = planned_service | inspection | repair; unplanned = off-road; an
// hour inside both counts as planned only). Terms are the version SIGNED for
// that week — a mid-week terms change is two items, never a retroactive
// rewrite. `weekStart` is a Monday in the city's zone; `weekEnd` is the
// week's LAST local date (inclusive): the week is [weekStart 00:00 local,
// weekEnd + 1 day 00:00 local).

export const SETTLEMENT_INPUTS_PATH = "/internal/fleet/settlement-inputs";

export const SettlementInputsQuerySchema = z
  .object({ weekStart: FleetLocalDateSchema, cityId: z.string().min(1) })
  .strict();

export const SettlementInputItemSchema = z.object({
  assignmentId: z.string().min(1),
  fleetId: z.string().min(1),
  driverId: z.string().min(1),
  vehicleId: z.string().min(1),
  termsVersion: z.number().int().positive(),
  terms: z.object({
    type: z.enum(["weekly_fixed", "percent_of_net"]),
    amountMinor: z.number().int().positive().nullable(),
    currency: CurrencySchema,
    percent: z.number().positive().max(100).nullable(),
    shortfall: z.object({
      policy: z.literal("carry_forward"),
      maxWeeks: z.number().int().positive(),
    }),
  }),
  shiftHoursInWeek: z.number().nonnegative(),
  plannedMaintenanceHoursInWeek: z.number().nonnegative(),
  unplannedOffRoadHoursInWeek: z.number().nonnegative(),
  activeFrom: Timestamp,
  activeTo: Timestamp.nullable(),
});
export type SettlementInputItem = z.infer<typeof SettlementInputItemSchema>;

export const SettlementInputsResponseSchema = z.object({
  weekStart: FleetLocalDateSchema,
  weekEnd: FleetLocalDateSchema,
  zone: z.string().min(1),
  items: z.array(SettlementInputItemSchema),
});
export type SettlementInputsResponse = z.infer<
  typeof SettlementInputsResponseSchema
>;

/**
 * INTERNAL CONTRACT B (payment-service → fleet-service direction, CC-A02 /
 * P1-09, DEC-9 = A): service-keyed read of a fleet's weekly gross, UBI
 * commission, remittance breakdown, and status — never a driver's net
 * earnings or a per-trip split.
 */
export const FLEET_WEEK_MONEY_PATH = "/v1/finance/fleet/internal/week-money";

export const FLEET_MONEY_EXCLUDES = ["cash_fares", "tips"] as const;
export type FleetMoneyExclusion = (typeof FLEET_MONEY_EXCLUDES)[number];

export const FleetMoneyExcludesSchema = z.tuple([
  z.literal("cash_fares"),
  z.literal("tips"),
]);

export const FleetRemittanceBreakdownSchema = z
  .object({
    due: MoneySchema,
    collected: MoneySchema,
    shortfall: MoneySchema,
    carried: MoneySchema,
    refunded: MoneySchema,
  })
  .strict();
export type FleetRemittanceBreakdown = z.infer<
  typeof FleetRemittanceBreakdownSchema
>;

export const FleetMoneySummarySchema = z
  .object({
    weekGross: MoneySchema,
    ubiCommission: MoneySchema,
    fleetRemittance: MoneySchema,
    remittanceStatus: z.string().min(1),
    remittance: FleetRemittanceBreakdownSchema,
  })
  .strict();
export type FleetMoneySummary = z.infer<typeof FleetMoneySummarySchema>;

export const FleetWeekMoneyAssignmentInputSchema = z
  .object({
    assignmentId: z.string().min(1),
    driverId: z.string().min(1),
    vehicleId: z.string().min(1),
    activeFrom: Timestamp,
    activeTo: Timestamp.nullable(),
  })
  .strict();
export type FleetWeekMoneyAssignmentInput = z.infer<
  typeof FleetWeekMoneyAssignmentInputSchema
>;

export const FleetWeekMoneyRequestSchema = z
  .object({
    fleetId: z.string().min(1),
    cityId: z.string().min(1),
    weekStart: FleetLocalDateSchema,
    vehicleIds: z.array(z.string().min(1)).optional(),
    assignments: z.array(FleetWeekMoneyAssignmentInputSchema).optional(),
  })
  .strict();
export type FleetWeekMoneyRequest = z.infer<typeof FleetWeekMoneyRequestSchema>;

export const FleetWeekMoneyResponseSchema = z
  .object({
    fleetId: z.string().min(1),
    cityId: z.string().min(1),
    weekStart: FleetLocalDateSchema,
    weekEnd: FleetLocalDateSchema,
    asOf: Timestamp,
    excludes: FleetMoneyExcludesSchema,
    fleet: FleetMoneySummarySchema,
    vehicles: z.record(z.string(), FleetMoneySummarySchema),
    assignments: z.record(z.string(), FleetMoneySummarySchema),
  })
  .strict();
export type FleetWeekMoneyResponse = z.infer<
  typeof FleetWeekMoneyResponseSchema
>;

// ── Public request bodies ──────────────────────────────────────────────────

export const CreateFleetSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    registrationNumber: z.string().trim().min(2).max(64).optional(),
    taxId: z.string().trim().min(2).max(64).optional(),
    fields: z.record(z.string().min(1).max(64), z.string().max(400)).optional(),
    declarationsAccepted: z.boolean().optional(),
  })
  .strict();

export const CreateDocumentUploadSchema = z
  .object({
    purpose: z.enum(["kyb_document", "vehicle_document"]),
    contentType: z.enum(FLEET_DOCUMENT_CONTENT_TYPES),
    sizeBytes: z.number().int().positive().max(FLEET_DOCUMENT_MAX_BYTES),
    sha256Hex: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/, "sha256Hex must be 64 hex characters"),
  })
  .strict();
export type CreateDocumentUploadInput = z.infer<
  typeof CreateDocumentUploadSchema
>;

export const SubmitFleetKybSchema = z
  .object({
    registrationNumber: z.string().trim().min(2).max(64).optional(),
    taxId: z.string().trim().min(2).max(64).optional(),
    fields: z
      .record(z.string().min(1).max(64), z.string().max(400))
      .default({}),
    documents: z
      .array(
        z
          .object({
            requirementKey: z.string().min(1).max(64),
            uploadId: z.string().min(1).max(64),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    declarationsAccepted: z.literal(true),
  })
  .strict();
export type SubmitFleetKybInput = z.infer<typeof SubmitFleetKybSchema>;

export const ReviewFleetKybSchema = z
  .object({
    decision: z.enum(["approved", "changes_requested", "rejected"]),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (
      (val.decision === "changes_requested" || val.decision === "rejected") &&
      (!val.note || val.note.trim().length < 3)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["note"],
        message: "note is required when requesting changes or rejecting",
      });
    }
  });
export type ReviewFleetKybInput = z.infer<typeof ReviewFleetKybSchema>;

export const CreateFleetInvitationSchema = z
  .object({
    phone: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{6,14}$/, "phone must be E.164"),
    role: z.enum(FLEET_STAFF_ROLES),
    kind: z.enum(FLEET_INVITATION_KINDS).optional(),
  })
  .strict();
export type CreateFleetInvitationInput = z.infer<
  typeof CreateFleetInvitationSchema
>;

export const PatchFleetStaffRoleSchema = z
  .object({
    role: z.enum(FLEET_STAFF_ROLES),
  })
  .strict();
export type PatchFleetStaffRoleInput = z.infer<
  typeof PatchFleetStaffRoleSchema
>;

export const AttachVehicleDocumentSchema = z
  .object({
    docType: z.enum(VEHICLE_DOCUMENT_TYPES),
    uploadId: z.string().min(1).max(64),
    expiresAt: Timestamp,
  })
  .strict();
export type AttachVehicleDocumentInput = z.infer<
  typeof AttachVehicleDocumentSchema
>;

export const ReviewVehicleDocumentSchema = z
  .object({
    decision: z.enum(["valid", "rejected"]),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (
      val.decision === "rejected" &&
      (!val.note || val.note.trim().length < 3)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["note"],
        message: "note is required when rejecting a vehicle document",
      });
    }
  });
export type ReviewVehicleDocumentInput = z.infer<
  typeof ReviewVehicleDocumentSchema
>;

export const PutFleetStaffSchema = z
  .object({
    staff: z
      .array(
        z
          .object({
            userId: z.string().min(1).max(64),
            role: z.enum(FLEET_STAFF_ROLES),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

export const AddFleetVehicleSchema = z
  .object({
    plate: z.string().trim().min(3).max(16),
    make: z.string().trim().min(1).max(60),
    model: z.string().trim().min(1).max(60),
    year: z.number().int().min(1980).max(2100),
    color: z.string().trim().min(1).max(30),
    type: z.enum(["SEDAN", "SUV", "VAN", "MOTORCYCLE", "ELECTRIC"]),
    capacity: z.number().int().min(1).max(20),
    classes: z.array(z.enum(FLEET_VEHICLE_CLASSES)).min(1).max(4),
  })
  .strict();

export const ProposeAssignmentSchema = z
  .object({
    vehicleId: z.string().min(1),
    driverId: z.string().min(1),
    shift: FleetShiftInputSchema,
    validFrom: FleetLocalDateSchema,
    validTo: FleetLocalDateSchema.optional(),
    /**
     * Owners only. Absent ⇒ the driver's CURRENTLY SIGNED terms version with
     * this fleet is reused (the only form a manager may send).
     */
    terms: AssignmentTermsInputSchema.optional(),
  })
  .strict();
export type ProposeAssignment = z.infer<typeof ProposeAssignmentSchema>;

export const MaintenanceWindowSchema = z
  .object({
    vehicleId: z.string().min(1),
    kind: z.enum(PLANNED_MAINTENANCE_KINDS),
    startsAt: Timestamp,
    endsAt: Timestamp,
  })
  .strict();

export const CreateMaintenanceSchema = MaintenanceWindowSchema.extend({
  note: z.string().trim().max(280).optional(),
  /** From the preview of exactly this window (a freshness binding). */
  previewToken: z.string().min(1),
}).strict();

export const PatchMaintenanceSchema = z
  .object({
    startsAt: Timestamp.optional(),
    endsAt: Timestamp.optional(),
    note: z.string().trim().max(280).optional(),
    previewToken: z.string().min(1),
  })
  .strict();

export const ConfirmMaintenanceSchema = z
  .object({ previewToken: z.string().min(1) })
  .strict();

export const ReportOffRoadSchema = z
  .object({
    vehicleId: z.string().min(1),
    startsAt: Timestamp.optional(),
    expectedEndsAt: Timestamp.optional(),
    note: z.string().trim().max(280).optional(),
  })
  .strict();

export const RequestVehicleSwapSchema = z
  .object({ toVehicleId: z.string().min(1) })
  .strict();

export const SignOfferSchema = z
  .object({ pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits") })
  .strict();

/** A driver-authored window. `rrule`: FREQ=DAILY|WEEKLY[;BYDAY=..][;COUNT=n|;UNTIL=YYYYMMDD]. */
export const AvailabilityWindowInputSchema = z
  .object({
    kind: z.enum(AVAILABILITY_KINDS),
    startsAt: Timestamp,
    endsAt: Timestamp,
    rrule: z.string().min(1).max(200).optional(),
  })
  .strict();

export const AvailabilityPreviewSchema = z
  .object({ windows: z.array(AvailabilityWindowInputSchema).max(50) })
  .strict();

export const PutAvailabilitySchema = z
  .object({
    windows: z.array(AvailabilityWindowInputSchema).max(50),
    /** Bookings the driver EXPLICITLY chose to withdraw from, per the preview. */
    withdrawals: z.array(z.string().min(1)).max(50),
    previewToken: z.string().min(1),
  })
  .strict();

// ── Public responses ───────────────────────────────────────────────────────

export const FleetViewSchema = z.object({
  fleetId: z.string(),
  name: z.string(),
  cityId: z.string(),
  currency: CurrencySchema,
  zone: z.string(),
  status: z.enum(FLEET_STATUSES),
  kybStatus: z.enum(FLEET_KYB_STATUSES).optional(),
  kybReviewNote: z.string().nullable().optional(),
  myRole: z.enum(FLEET_STAFF_ROLES),
  createdAt: Timestamp,
});

export const FleetKybRequirementsResponseSchema = z.object({
  cityId: z.string(),
  configured: z.boolean(),
  requirements: z.array(FleetKybRequirementSchema),
});
export type FleetKybRequirementsResponse = z.infer<
  typeof FleetKybRequirementsResponseSchema
>;

export const FleetKybDocumentViewSchema = z.object({
  kybDocumentId: z.string(),
  requirementKey: z.string(),
  uploadId: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().positive(),
  sha256Hex: z.string(),
  status: z.enum(["pending", "valid", "rejected"]),
  reviewNote: z.string().nullable(),
  createdAt: Timestamp,
});
export type FleetKybDocumentView = z.infer<typeof FleetKybDocumentViewSchema>;

export const FleetKybApplicationViewSchema = z.object({
  fleetId: z.string(),
  name: z.string(),
  cityId: z.string(),
  status: z.enum(FLEET_STATUSES),
  kybStatus: z.enum(FLEET_KYB_STATUSES),
  registrationNumber: z.string().nullable(),
  taxId: z.string().nullable(),
  fields: z.record(z.string(), z.string()),
  declarationsAccepted: z.boolean(),
  submittedAt: Timestamp.nullable(),
  reviewedBy: z.string().nullable(),
  reviewedAt: Timestamp.nullable(),
  reviewNote: z.string().nullable(),
  requirementsConfigured: z.boolean(),
  requirements: z.array(FleetKybRequirementSchema),
  documents: z.array(FleetKybDocumentViewSchema),
});
export type FleetKybApplicationView = z.infer<
  typeof FleetKybApplicationViewSchema
>;

export const FleetAdminKybListSchema = z.object({
  applications: z.array(FleetKybApplicationViewSchema),
});
export type FleetAdminKybList = z.infer<typeof FleetAdminKybListSchema>;

export const DocumentUploadSlotViewSchema = z.object({
  uploadId: z.string(),
  objectKey: z.string(),
  uploadUrl: z.string(),
  method: z.literal("PUT"),
  requiredHeaders: z.record(z.string(), z.string()),
  expiresAt: Timestamp,
});
export type DocumentUploadSlotView = z.infer<
  typeof DocumentUploadSlotViewSchema
>;

export const DocumentDownloadUrlViewSchema = z.object({
  url: z.string(),
  expiresAt: Timestamp,
  contentType: z.string(),
});
export type DocumentDownloadUrlView = z.infer<
  typeof DocumentDownloadUrlViewSchema
>;

export const FleetInvitationViewSchema = z.object({
  invitationId: z.string(),
  fleetId: z.string(),
  fleetName: z.string(),
  kind: z.enum(FLEET_INVITATION_KINDS),
  role: z.enum(FLEET_STAFF_ROLES),
  inviteeMasked: z.string(),
  inviteeUserId: z.string().nullable(),
  inviteeDisplayName: z.string().nullable(),
  invitedByUserId: z.string(),
  status: z.enum(FLEET_INVITATION_STATUSES),
  expiresAt: Timestamp,
  respondedAt: Timestamp.nullable(),
  revokedAt: Timestamp.nullable(),
  createdAt: Timestamp,
});
export type FleetInvitationView = z.infer<typeof FleetInvitationViewSchema>;

export const FleetInvitationListSchema = z.object({
  invitations: z.array(FleetInvitationViewSchema),
});
export type FleetInvitationList = z.infer<typeof FleetInvitationListSchema>;

export const VehicleDocumentViewSchema = z.object({
  documentId: z.string(),
  vehicleId: z.string(),
  fleetId: z.string(),
  plate: z.string(),
  docType: z.enum(VEHICLE_DOCUMENT_TYPES),
  uploadId: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().positive(),
  sha256Hex: z.string(),
  expiresAt: Timestamp,
  status: z.enum(VEHICLE_DOCUMENT_REVIEW_STATUSES),
  uploadedByUserId: z.string(),
  reviewedBy: z.string().nullable(),
  reviewedAt: Timestamp.nullable(),
  reviewNote: z.string().nullable(),
  createdAt: Timestamp,
});
export type VehicleDocumentView = z.infer<typeof VehicleDocumentViewSchema>;

export const VehicleDocumentListSchema = z.object({
  vehicleId: z.string(),
  documents: z.array(VehicleDocumentViewSchema),
});
export type VehicleDocumentList = z.infer<typeof VehicleDocumentListSchema>;

export const FleetAdminDocumentListSchema = z.object({
  documents: z.array(VehicleDocumentViewSchema),
});
export type FleetAdminDocumentList = z.infer<
  typeof FleetAdminDocumentListSchema
>;

export const FleetListSchema = z.object({ fleets: z.array(FleetViewSchema) });

export const FleetStaffListSchema = z.object({
  fleetId: z.string(),
  staff: z.array(
    z.object({
      staffId: z.string(),
      userId: z.string(),
      displayName: z.string().nullable(),
      role: z.enum(FLEET_STAFF_ROLES),
      addedAt: Timestamp,
    }),
  ),
});

export const DocumentStatusSchema = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  status: z.enum(DOCUMENT_STATUSES),
  expiresAt: Timestamp.nullable(),
  daysToExpiry: z.number().int().nullable(),
});

export const UbiStatusSchema = z.object({
  subject: z.enum(["driver", "vehicle"]),
  subjectId: z.string(),
  status: z.enum(UBI_STATUSES),
  effectiveFrom: Timestamp.nullable(),
  effectiveTo: Timestamp.nullable(),
});

/** Money the fleet portal shows comes from payment-service, never from here. */
export const MoneyUnavailableSchema = z.object({
  available: z.literal(false),
  reason: z.string(),
  source: z.string(),
});

/**
 * Decision Q7 + DEC-9 (option A): fleets see the four Q7 money lines
 * (`weekGross`, `ubiCommission`, `fleetRemittance`, `remittanceStatus`) plus
 * `asOf`, `excludes: ["cash_fares", "tips"]`, and the remittance breakdown —
 * never a driver's net earnings or a per-trip split.
 */
export const MoneyAvailableSchema = z
  .object({
    available: z.literal(true),
    asOf: Timestamp,
    excludes: FleetMoneyExcludesSchema,
    weekStart: FleetLocalDateSchema.optional(),
    weekEnd: FleetLocalDateSchema.optional(),
    weekGross: MoneySchema,
    ubiCommission: MoneySchema,
    fleetRemittance: MoneySchema,
    remittanceStatus: z.string().min(1),
    remittance: FleetRemittanceBreakdownSchema.optional(),
  })
  .strict();

export const FleetMoneySchema = z.discriminatedUnion("available", [
  MoneyUnavailableSchema,
  MoneyAvailableSchema,
]);

export const FleetVehicleViewSchema = z.object({
  vehicleId: z.string(),
  plate: z.string(),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  color: z.string(),
  classes: z.array(z.string()),
  capacity: z.number().int(),
  statusNow: z.enum(VEHICLE_AVAILABILITY_STATES),
  drivers: z.array(
    z.object({
      driverId: z.string(),
      displayName: z.string(),
      shift: FleetShiftSchema,
      termsVersion: z.number().int(),
    }),
  ),
  documents: z.array(DocumentStatusSchema),
  money: FleetMoneySchema,
  addedAt: Timestamp,
});
export const FleetVehicleListSchema = z.object({
  vehicles: z.array(FleetVehicleViewSchema),
});

export const ArrangementViewSchema = z.object({
  assignmentId: z.string(),
  fleetId: z.string(),
  vehicleId: z.string(),
  driverId: z.string(),
  driverDisplayName: z.string(),
  shift: FleetShiftSchema,
  validFrom: FleetLocalDateSchema,
  validTo: FleetLocalDateSchema.nullable(),
  termsVersion: z.number().int().positive(),
  terms: AssignmentTermsSchema,
  signedAt: Timestamp,
  status: z.enum(ARRANGEMENT_STATUSES),
});

export const ProposalViewSchema = z.object({
  proposalId: z.string(),
  fleetId: z.string(),
  vehicleId: z.string(),
  driverId: z.string(),
  driverDisplayName: z.string(),
  shift: FleetShiftSchema,
  validFrom: FleetLocalDateSchema,
  validTo: FleetLocalDateSchema.nullable(),
  termsVersion: z.number().int().positive(),
  terms: AssignmentTermsSchema,
  diff: z.array(TermDiffSchema),
  /** The fleet sees the outcome only — never why a driver declined. */
  status: z.enum(PROPOSAL_STATUSES),
  check: z.object({
    shiftOverlap: z.boolean(),
    withinCityCap: z.boolean(),
    cityCap: MoneySchema,
  }),
  proposedByRole: z.enum(["owner", "manager"]),
  sentAt: Timestamp.nullable(),
  expiresAt: Timestamp.nullable(),
  respondedAt: Timestamp.nullable(),
});

export const FleetAssignmentsSchema = z.object({
  arrangements: z.array(ArrangementViewSchema),
  proposals: z.array(ProposalViewSchema),
});

export const MaintenanceBlockViewSchema = z.object({
  blockId: z.string(),
  fleetId: z.string(),
  vehicleId: z.string(),
  kind: z.enum(MAINTENANCE_KINDS),
  startsAt: Timestamp,
  endsAt: Timestamp.nullable(),
  zone: z.string(),
  note: z.string().nullable(),
  status: z.enum(MAINTENANCE_STATUSES),
  version: z.number().int().positive(),
  offRoadFlagged: z.boolean(),
  createdAt: Timestamp,
});
export const MaintenanceListSchema = z.object({
  blocks: z.array(MaintenanceBlockViewSchema),
});

export const MaintenanceSuggestionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("move"), startsAt: Timestamp, endsAt: Timestamp }),
  z.object({
    kind: z.literal("swap"),
    bookingBlockId: z.string(),
    candidates: z.array(
      z.object({
        vehicleId: z.string(),
        plate: z.string(),
        eligible: z.boolean(),
        reasons: z.array(z.string()),
      }),
    ),
  }),
  z.object({
    kind: z.literal("ask_driver"),
    bookingBlockId: z.string(),
    driverId: z.string(),
  }),
]);

export const MaintenancePreviewViewSchema = z.object({
  feasible: z.boolean(),
  affectedAssignments: z.array(
    z.object({
      assignmentId: z.string(),
      driverId: z.string(),
      driverDisplayName: z.string(),
      lostInterval: IntervalSchema,
    }),
  ),
  affectedBlocks: z.array(OccupiedBlockSchema),
  suggestions: z.array(MaintenanceSuggestionSchema),
  previewToken: z.string(),
  checkedAt: Timestamp,
});

export const NeedsResolutionDetailsSchema = z.object({
  block: MaintenanceBlockViewSchema,
  affectedBlocks: z.array(OccupiedBlockSchema),
  conflictIds: z.array(z.string()),
});

export const OffRoadViewSchema = z.object({
  block: MaintenanceBlockViewSchema,
  atRiskBookings: z.array(
    z.object({ blockId: z.string(), decisionDeadline: Timestamp }),
  ),
  conflictIds: z.array(z.string()),
});

export const ConflictViewSchema = z.object({
  conflictId: z.string(),
  type: z.enum(FLEET_VISIBLE_CONFLICT_TYPES),
  severity: z.enum(CONFLICT_SEVERITIES),
  maintenanceBlockId: z.string().nullable(),
  subjects: z.array(
    z.object({
      vehicleId: z.string().nullable(),
      driverId: z.string().nullable(),
      blockId: z.string().nullable(),
    }),
  ),
  resolverRoles: z.array(z.enum(CONFLICT_RESOLVER_ROLES)),
  /** For THIS caller's role. */
  allowedActions: z.array(z.enum(FLEET_CONFLICT_ACTIONS)),
  deadlineAt: Timestamp.nullable(),
  status: z.enum(CONFLICT_STATUSES),
  openedAt: Timestamp,
  resolvedAt: Timestamp.nullable(),
});
export const ConflictListSchema = z.object({
  conflicts: z.array(ConflictViewSchema),
});

const CalendarAssignmentSchema = z.object({
  assignmentId: z.string(),
  vehicleId: z.string(),
  driverId: z.string(),
  driverDisplayName: z.string(),
  shift: FleetShiftSchema,
  termsVersion: z.number().int().positive(),
  status: z.enum(ARRANGEMENT_STATUSES),
  /** The shift's instances inside the requested range (server-expanded). */
  intervals: z.array(IntervalSchema),
});

/** A driver-authored window as a FLEET sees it: time off is `unavailable`. */
const FleetAvailabilityBlockSchema = z.object({
  kind: z.enum(["available", "unavailable"]),
  startsAt: Timestamp,
  endsAt: Timestamp,
  setBy: z.literal("driver"),
});

export const CalendarRowSchema = z.object({
  rowId: z.string(),
  rowKind: z.enum(["vehicle", "driver"]),
  vehicleId: z.string().nullable(),
  driverId: z.string().nullable(),
  label: z.string(),
  statusNow: z.enum(VEHICLE_AVAILABILITY_STATES).nullable(),
  flags: z.array(z.string()),
  assignments: z.array(CalendarAssignmentSchema),
  maintenance: z.array(MaintenanceBlockViewSchema),
  occupied: z.array(OccupiedBlockSchema),
  documents: z.array(DocumentStatusSchema),
  ubiStatus: UbiStatusSchema.nullable(),
  availability: z.array(FleetAvailabilityBlockSchema).nullable(),
  hours: z.object({ signedShiftHours: z.number().nonnegative() }).nullable(),
});

export const FleetCalendarSchema = z.object({
  zone: z.string(),
  asOf: Timestamp,
  from: Timestamp,
  to: Timestamp,
  zoom: z.enum(["day", "week"]),
  rowsKind: z.enum(["vehicles", "drivers"]),
  layers: z.array(
    z.enum(["assignments", "maintenance", "bookings", "documents"]),
  ),
  rows: z.array(CalendarRowSchema),
  daySummaries: z
    .array(
      z.object({
        date: FleetLocalDateSchema,
        rowId: z.string(),
        bookedCount: z.number().int().nonnegative(),
        shiftSummary: z.array(z.string()),
        maintenanceCount: z.number().int().nonnegative(),
        flags: z.array(z.string()),
      }),
    )
    .nullable(),
  nextCursor: z.string().nullable(),
  totalRows: z.number().int().nonnegative(),
});

export const UtilisationSchema = z.object({
  asOf: Timestamp,
  zone: z.string(),
  from: Timestamp,
  to: Timestamp,
  definitions: z.record(z.string()),
  rows: z.array(
    z.object({
      vehicleId: z.string(),
      plate: z.string(),
      addedAt: Timestamp,
      enoughData: z.boolean(),
      reason: z.literal("not_enough_data").nullable(),
      hours: z
        .object({
          onTrip: z.number().nonnegative().nullable(),
          onlineIdle: z.number().nonnegative().nullable(),
          bookedAhead: z.number().nonnegative().nullable(),
          maintenance: z.number().nonnegative().nullable(),
          offline: z.number().nonnegative().nullable(),
        })
        .nullable(),
      unavailable: z.array(
        z.object({
          metric: z.string(),
          reason: z.string(),
          dependency: z.string(),
        }),
      ),
    }),
  ),
});

export const FleetOverviewSchema = z.object({
  fleetId: z.string(),
  asOf: Timestamp,
  zone: z.string(),
  vehicles: z.object({
    total: z.number().int().nonnegative(),
    docExpiring: z.number().int().nonnegative(),
    docExpired: z.number().int().nonnegative(),
    inMaintenance: z.number().int().nonnegative(),
  }),
  arrangements: z.object({
    active: z.number().int().nonnegative(),
    onNotice: z.number().int().nonnegative(),
    pendingProposals: z.number().int().nonnegative(),
  }),
  openConflicts: z.object({
    critical: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    status: z.number().int().nonnegative(),
  }),
  money: FleetMoneySchema,
});

export const VehicleSwapRequestViewSchema = z.object({
  swapRequestId: z.string(),
  bookingBlockId: z.string(),
  fromVehicleId: z.string(),
  toVehicleId: z.string(),
  swapId: z.string().nullable(),
  status: z.enum(["proposed", "ineligible"]),
  reasons: z.array(z.string()),
});

export const TerminationViewSchema = z.object({
  assignmentId: z.string(),
  status: z.enum(ARRANGEMENT_STATUSES),
  noticeEndsOn: FleetLocalDateSchema,
  bookingsAfterNotice: z.array(OccupiedBlockSchema),
  conflictIds: z.array(z.string()),
});

export const ReminderViewSchema = z.object({
  conflictId: z.string(),
  remindedAt: Timestamp,
});

// ── Driver-facing responses ────────────────────────────────────────────────

export const DriverOfferViewSchema = z.object({
  offerId: z.string(),
  fleet: z.object({ fleetId: z.string(), name: z.string() }),
  vehicle: z.object({
    vehicleId: z.string(),
    plate: z.string(),
    make: z.string(),
    model: z.string(),
    classes: z.array(z.string()),
    capacity: z.number().int(),
  }),
  shift: FleetShiftSchema,
  validFrom: FleetLocalDateSchema,
  validTo: FleetLocalDateSchema.nullable(),
  termsVersion: z.number().int().positive(),
  terms: AssignmentTermsSchema,
  current: z
    .object({
      assignmentId: z.string(),
      vehicleId: z.string(),
      shift: FleetShiftSchema,
      termsVersion: z.number().int().positive(),
      terms: AssignmentTermsSchema,
    })
    .nullable(),
  diff: z.array(TermDiffSchema),
  /** Checked by UBI; null = the check could not run right now (never guessed). */
  check: z.object({
    clashesWithBookings: z.boolean().nullable(),
    clashesWithTimeOff: z.boolean(),
  }),
  status: z.enum(PROPOSAL_STATUSES),
  expiresAt: Timestamp.nullable(),
  /** fleet.yaml's "real historic earnings": no real source yet — never invented. */
  historicEarnings: z.null(),
  historicEarningsReason: z.string(),
});
export const DriverOfferListSchema = z.object({
  offers: z.array(DriverOfferViewSchema),
});

export const SignatureEvidenceSchema = z.object({
  signedAt: Timestamp,
  termsVersion: z.number().int().positive(),
  termsHash: z.string(),
  verification: z.object({
    method: z.literal("wallet_pin"),
    verifiedBy: z.literal("user-service"),
    reference: z.string(),
  }),
});

export const SignOfferViewSchema = z.object({
  offerId: z.string(),
  status: z.literal("signed"),
  arrangement: ArrangementViewSchema,
  signature: SignatureEvidenceSchema,
});

export const DeclineOfferViewSchema = z.object({
  offerId: z.string(),
  status: z.literal("declined"),
});

export const DriverArrangementVehicleSummarySchema = z
  .object({
    vehicleId: z.string(),
    plate: z.string(),
    make: z.string(),
    model: z.string(),
  })
  .strict();

export const DriverArrangementListSchema = z.object({
  arrangements: z.array(
    ArrangementViewSchema.extend({
      fleetName: z.string(),
      noticeEndsOn: FleetLocalDateSchema.nullable(),
      vehicle: DriverArrangementVehicleSummarySchema,
    }),
  ),
  /** This week's split lives in payment-service's ledger. */
  weekSplit: MoneyUnavailableSchema,
});

export const DriverScheduleSchema = z.object({
  zone: z.string(),
  asOf: Timestamp,
  from: Timestamp,
  to: Timestamp,
  items: z.array(
    z.object({
      itemId: z.string(),
      kind: z.enum([
        "availability",
        "time_off",
        "shift",
        "maintenance",
        "booking",
      ]),
      startsAt: Timestamp,
      endsAt: Timestamp,
      label: z.string(),
      vehicleId: z.string().nullable(),
      bookingId: z.string().nullable(),
      risk: z.enum(BOOKING_RISKS).nullable(),
      decisionDeadline: Timestamp.nullable(),
      conflictId: z.string().nullable(),
    }),
  ),
  alerts: z.array(
    z.object({
      conflictId: z.string(),
      type: z.enum(CONFLICT_TYPES),
      deadlineAt: Timestamp.nullable(),
    }),
  ),
});

const WithdrawOutcomeSchema = z.object({
  /** The commission captured at the advance award, returned with a linked reversal. */
  commissionReturned: MoneySchema.nullable(),
  /** The booking's funding reservation is released (the passenger is never charged). */
  fundingReleased: z.literal(true),
  /** Only the marketplace knows whether enough lead time remains to rematch. */
  rematch: z.literal("decided_by_marketplace"),
  penalty: z.literal("none"),
});

export const AvailabilityPreviewViewSchema = z.object({
  previewToken: z.string(),
  zone: z.string(),
  checkedAt: Timestamp,
  horizonEndsAt: Timestamp,
  affects: z.array(
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("shift"),
        assignmentId: z.string(),
        effect: z.literal("hours_reduced"),
        lostHours: z.number().nonnegative(),
      }),
      z.object({
        kind: z.literal("booking"),
        bookingId: z.string(),
        effect: z.literal("conflicts"),
        startsAt: Timestamp,
        endsAt: Timestamp,
        outcome: WithdrawOutcomeSchema,
        options: z.array(z.enum(["trim_time_off", "withdraw_booking"])),
      }),
    ]),
  ),
});

export const AvailabilitySavedWindowSchema = z.object({
  windowId: z.string(),
  kind: z.enum(AVAILABILITY_KINDS),
  startsAt: Timestamp,
  endsAt: Timestamp,
  rrule: z.string().nullable(),
});

export const DriverAvailabilityViewSchema = z
  .object({
    zone: z.string(),
    setVersion: z.number().int().nonnegative(),
    windows: z.array(AvailabilitySavedWindowSchema),
  })
  .strict();

export const AvailabilitySavedViewSchema = z.object({
  status: z.enum(["saved", "saved_with_withdrawals"]),
  setVersion: z.number().int().positive(),
  windows: z.array(AvailabilitySavedWindowSchema),
  withdrawals: z.array(
    z.object({
      bookingId: z.string(),
      conflictId: z.string(),
      outcome: WithdrawOutcomeSchema,
      /** The driver confirms the withdrawal on the marketplace itself. */
      next: z.object({ method: z.literal("POST"), path: z.string() }),
    }),
  ),
});

export const DriverConflictViewSchema = z.object({
  conflictId: z.string(),
  type: z.enum(CONFLICT_TYPES),
  severity: z.enum(CONFLICT_SEVERITIES),
  status: z.enum(CONFLICT_STATUSES),
  deadlineAt: Timestamp.nullable(),
  bookingId: z.string().nullable(),
  vehicleId: z.string().nullable(),
  options: z.array(
    z.object({
      id: z.enum([
        "keep_on_swapped_vehicle",
        "ask_fleet_to_move",
        "trim_time_off",
        "withdraw",
      ]),
      enabled: z.boolean(),
      reason: z.string().nullable(),
      outcome: WithdrawOutcomeSchema.nullable(),
      next: z.object({ method: z.string(), path: z.string() }).nullable(),
    }),
  ),
});

export const DriverTerminationViewSchema = z.object({
  assignmentId: z.string(),
  status: z.enum(ARRANGEMENT_STATUSES),
  noticeEndsOn: FleetLocalDateSchema,
  /** The driver's OWN bookings after the notice end (they may keep or withdraw each). */
  bookingsAfterNotice: z.array(
    z.object({ bookingId: z.string(), startsAt: Timestamp }),
  ),
});

/**
 * C5 (ReportVehicleIssue, decisions Q5 + Q8) — `POST /v1/drivers/me/vehicle-issues`.
 */
export const VEHICLE_ISSUE_SEVERITIES = [
  "cannot_drive",
  "service_soon",
] as const;
export const VehicleIssueSeveritySchema = z.enum(VEHICLE_ISSUE_SEVERITIES);
export type VehicleIssueSeverity = (typeof VEHICLE_ISSUE_SEVERITIES)[number];

export const VEHICLE_ISSUE_REMITTANCE_EFFECTS = [
  /**
   * Decisions Q8: a breakdown is NOT pro-rated. Lost hours count as unplanned
   * off-road hours under the signed terms' shortfall rule.
   */
  "signed_terms_shortfall_rule",
  /** `service_soon` leaves the vehicle on the road until the fleet books a service. */
  "none",
] as const;

export const ReportVehicleIssueSchema = z
  .object({
    vehicleId: z.string().min(1),
    severity: z.enum(VEHICLE_ISSUE_SEVERITIES),
    note: z.string().trim().max(280).optional(),
  })
  .strict();
export type ReportVehicleIssue = z.infer<typeof ReportVehicleIssueSchema>;
export type ReportVehicleIssueInput = ReportVehicleIssue;

export const VehicleIssueViewSchema = z
  .object({
    issueId: z.string().min(1),
    severity: z.enum(VEHICLE_ISSUE_SEVERITIES),
    vehicleId: z.string().min(1),
    reportedAt: Timestamp,
    fleetAlerted: z.literal(true),
    block: z
      .object({
        blockId: z.string().min(1),
        kind: z.literal("unplanned_off_road"),
        status: z.enum(["active", "completed"]),
        startsAt: Timestamp,
        endsAt: Timestamp.nullable(),
      })
      .strict()
      .nullable(),
    decisions: z.array(
      z
        .object({
          conflictId: z.string().min(1),
          deadlineAt: Timestamp.nullable(),
        })
        .strict(),
    ),
    remittanceEffect: z.enum(VEHICLE_ISSUE_REMITTANCE_EFFECTS),
  })
  .strict();
export type VehicleIssueView = z.infer<typeof VehicleIssueViewSchema>;

export type FleetView = z.infer<typeof FleetViewSchema>;
export type FleetList = z.infer<typeof FleetListSchema>;
export type FleetStaffList = z.infer<typeof FleetStaffListSchema>;
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;
export type UbiStatus = z.infer<typeof UbiStatusSchema>;
export type MoneyUnavailable = z.infer<typeof MoneyUnavailableSchema>;
export type MoneyAvailable = z.infer<typeof MoneyAvailableSchema>;
export type FleetMoney = z.infer<typeof FleetMoneySchema>;
export type FleetVehicleView = z.infer<typeof FleetVehicleViewSchema>;
export type FleetVehicleList = z.infer<typeof FleetVehicleListSchema>;
export type ArrangementView = z.infer<typeof ArrangementViewSchema>;
export type ProposalView = z.infer<typeof ProposalViewSchema>;
export type FleetAssignments = z.infer<typeof FleetAssignmentsSchema>;
export type MaintenanceBlockView = z.infer<typeof MaintenanceBlockViewSchema>;
export type MaintenanceList = z.infer<typeof MaintenanceListSchema>;
export type MaintenanceSuggestion = z.infer<typeof MaintenanceSuggestionSchema>;
export type MaintenancePreviewView = z.infer<
  typeof MaintenancePreviewViewSchema
>;
export type NeedsResolutionDetails = z.infer<
  typeof NeedsResolutionDetailsSchema
>;
export type OffRoadView = z.infer<typeof OffRoadViewSchema>;
export type ConflictView = z.infer<typeof ConflictViewSchema>;
export type ConflictList = z.infer<typeof ConflictListSchema>;
export type CalendarRow = z.infer<typeof CalendarRowSchema>;
export type FleetCalendar = z.infer<typeof FleetCalendarSchema>;
export type Utilisation = z.infer<typeof UtilisationSchema>;
export type FleetOverview = z.infer<typeof FleetOverviewSchema>;
export type VehicleSwapRequestView = z.infer<
  typeof VehicleSwapRequestViewSchema
>;
export type TerminationView = z.infer<typeof TerminationViewSchema>;
export type ReminderView = z.infer<typeof ReminderViewSchema>;
export type DriverOfferView = z.infer<typeof DriverOfferViewSchema>;
export type DriverOfferList = z.infer<typeof DriverOfferListSchema>;
export type SignatureEvidence = z.infer<typeof SignatureEvidenceSchema>;
export type SignOfferView = z.infer<typeof SignOfferViewSchema>;
export type DeclineOfferView = z.infer<typeof DeclineOfferViewSchema>;
export type DriverArrangementList = z.infer<typeof DriverArrangementListSchema>;
export type DriverSchedule = z.infer<typeof DriverScheduleSchema>;
export type AvailabilityPreviewView = z.infer<
  typeof AvailabilityPreviewViewSchema
>;
export type DriverAvailabilityView = z.infer<
  typeof DriverAvailabilityViewSchema
>;
export type AvailabilitySavedView = z.infer<typeof AvailabilitySavedViewSchema>;
export type DriverConflictView = z.infer<typeof DriverConflictViewSchema>;
export type DriverTerminationView = z.infer<typeof DriverTerminationViewSchema>;

// ── Privacy ────────────────────────────────────────────────────────────────

/**
 * Field names no fleet-service response may carry at any depth: rider
 * identity or contact, location, route, fare, safety evidence, booking
 * internals, per-trip splits and a driver's net earnings.
 */
export const FLEET_FORBIDDEN_FIELD_PATTERNS: readonly RegExp[] = [
  /rider/i,
  /passenger/i,
  /requester/i,
  /pickup/i,
  /dropoff/i,
  /destination/i,
  /address/i,
  /location/i,
  /^(lat|lng|latitude|longitude|coordinates?)$/i,
  /route/i,
  /polyline/i,
  /waypoint/i,
  /fare/i,
  /price/i,
  /phone/i,
  /email/i,
  /contact/i,
  /safety/i,
  /evidence/i,
  /incident/i,
  /^net/i,
  /driverNet/i,
  /earningsNet/i,
  /perTrip/i,
  /^requestId$/,
  /^awardId$/,
  /^bidId$/,
  /paymentMethod/i,
];

/** Every response fleet-service serves, for the privacy walk. */
export const FLEET_RESPONSE_SCHEMAS = {
  FleetView: FleetViewSchema,
  FleetList: FleetListSchema,
  FleetKybRequirementsResponse: FleetKybRequirementsResponseSchema,
  FleetKybDocumentView: FleetKybDocumentViewSchema,
  FleetKybApplicationView: FleetKybApplicationViewSchema,
  FleetAdminKybList: FleetAdminKybListSchema,
  DocumentUploadSlotView: DocumentUploadSlotViewSchema,
  DocumentDownloadUrlView: DocumentDownloadUrlViewSchema,
  FleetStaffList: FleetStaffListSchema,
  FleetInvitationView: FleetInvitationViewSchema,
  FleetInvitationList: FleetInvitationListSchema,
  FleetVehicleView: FleetVehicleViewSchema,
  FleetVehicleList: FleetVehicleListSchema,
  VehicleDocumentView: VehicleDocumentViewSchema,
  VehicleDocumentList: VehicleDocumentListSchema,
  FleetAdminDocumentList: FleetAdminDocumentListSchema,
  FleetAssignments: FleetAssignmentsSchema,
  ProposalView: ProposalViewSchema,
  ArrangementView: ArrangementViewSchema,
  MaintenanceBlockView: MaintenanceBlockViewSchema,
  MaintenanceList: MaintenanceListSchema,
  MaintenancePreviewView: MaintenancePreviewViewSchema,
  NeedsResolutionDetails: NeedsResolutionDetailsSchema,
  OffRoadView: OffRoadViewSchema,
  ConflictList: ConflictListSchema,
  FleetCalendar: FleetCalendarSchema,
  Utilisation: UtilisationSchema,
  FleetOverview: FleetOverviewSchema,
  VehicleSwapRequestView: VehicleSwapRequestViewSchema,
  TerminationView: TerminationViewSchema,
  ReminderView: ReminderViewSchema,
  DriverOfferList: DriverOfferListSchema,
  SignOfferView: SignOfferViewSchema,
  DeclineOfferView: DeclineOfferViewSchema,
  DriverArrangementList: DriverArrangementListSchema,
  DriverSchedule: DriverScheduleSchema,
  AvailabilityPreviewView: AvailabilityPreviewViewSchema,
  DriverAvailabilityView: DriverAvailabilityViewSchema,
  AvailabilitySavedView: AvailabilitySavedViewSchema,
  DriverConflictView: DriverConflictViewSchema,
  DriverTerminationView: DriverTerminationViewSchema,
  VehicleIssueView: VehicleIssueViewSchema,
  FleetVehicleAtResponse: FleetVehicleAtResponseSchema,
  FleetInternalVehicle: FleetInternalVehicleSchema,
  FleetOnlineVehicleResponse: FleetOnlineVehicleResponseSchema,
  SettlementInputsResponse: SettlementInputsResponseSchema,
  FleetWeekMoneyResponse: FleetWeekMoneyResponseSchema,
} as const;

export const FLEET_EVENT_PAYLOAD_SCHEMAS = {
  "fleet.created": z
    .object({
      fleetId: z.string().min(1),
      cityId: z.string().min(1),
      ownerId: z.string().min(1),
    })
    .strict(),
  "fleet.kyb.submitted": z
    .object({
      fleetId: z.string().min(1),
      cityId: z.string().min(1),
      submittedBy: z.string().min(1),
      documentCount: z.number().int().nonnegative(),
    })
    .strict(),
  "fleet.kyb.status.changed": z
    .object({
      fleetId: z.string().min(1),
      cityId: z.string().min(1),
      from: z.enum(FLEET_KYB_STATUSES),
      to: z.enum(FLEET_KYB_STATUSES),
      reviewedBy: z.string().min(1),
      hasNote: z.boolean(),
    })
    .strict(),
  "fleet.staff.changed": z
    .object({
      fleetId: z.string().min(1),
      changes: z.array(
        z
          .object({
            userId: z.string().min(1),
            from: z.enum([...FLEET_STAFF_ROLES, "removed"] as const).nullable(),
            to: z.enum([...FLEET_STAFF_ROLES, "removed"] as const),
          })
          .strict(),
      ),
    })
    .strict(),
  "fleet.invitation.sent": z
    .object({
      invitationId: z.string().min(1),
      fleetId: z.string().min(1),
      kind: z.enum(FLEET_INVITATION_KINDS),
      role: z.enum(FLEET_STAFF_ROLES),
      invitedByUserId: z.string().min(1),
      inviteeUserId: z.string().min(1).nullable(),
      expiresAt: Timestamp,
    })
    .strict(),
  "fleet.invitation.responded": z
    .object({
      invitationId: z.string().min(1),
      fleetId: z.string().min(1),
      kind: z.enum(FLEET_INVITATION_KINDS),
      role: z.enum(FLEET_STAFF_ROLES),
      userId: z.string().min(1),
      outcome: z.enum(["accepted", "declined"]),
    })
    .strict(),
  "fleet.invitation.revoked": z
    .object({
      invitationId: z.string().min(1),
      fleetId: z.string().min(1),
      revokedByUserId: z.string().min(1),
    })
    .strict(),
  "fleet.vehicle.added": z
    .object({
      fleetId: z.string().min(1),
      vehicleId: z.string().min(1),
      classes: z.array(z.string().min(1)),
      capacity: z.number().int().positive(),
    })
    .strict(),
  "vehicle.document.submitted": z
    .object({
      documentId: z.string().min(1),
      vehicleId: z.string().min(1),
      fleetId: z.string().min(1),
      docType: z.enum(VEHICLE_DOCUMENT_TYPES),
      expiresAt: Timestamp,
      uploadedByUserId: z.string().min(1),
    })
    .strict(),
  "vehicle.document.reviewed": z
    .object({
      documentId: z.string().min(1),
      vehicleId: z.string().min(1),
      fleetId: z.string().min(1),
      docType: z.enum(VEHICLE_DOCUMENT_TYPES),
      decision: z.enum(["valid", "rejected"]),
      reviewedBy: z.string().min(1),
      expiresAt: Timestamp,
    })
    .strict(),
  "assignment.proposal.status.changed": z
    .object({
      proposalId: z.string().min(1),
      fleetId: z.string().min(1),
      vehicleId: z.string().min(1),
      driverId: z.string().min(1),
      from: z.enum(PROPOSAL_STATUSES).nullable(),
      to: z.enum(PROPOSAL_STATUSES),
      path: z.array(z.enum(PROPOSAL_STATUSES)).optional(),
      termsVersion: z.number().int().positive().optional(),
      expiresAt: Timestamp.optional(),
    })
    .strict(),
  "assignment.signed": z
    .object({
      assignmentId: z.string().min(1),
      proposalId: z.string().min(1),
      fleetId: z.string().min(1),
      vehicleId: z.string().min(1),
      driverId: z.string().min(1),
      termsVersion: z.number().int().positive(),
      termsHash: z.string().min(1),
      signedAt: Timestamp,
      validFrom: FleetLocalDateSchema,
      validTo: FleetLocalDateSchema.nullable(),
    })
    .strict(),
  "assignment.status.changed": z
    .object({
      assignmentId: z.string().min(1),
      fleetId: z.string().min(1),
      vehicleId: z.string().min(1),
      driverId: z.string().min(1),
      from: z.enum(ARRANGEMENT_STATUSES),
      to: z.enum(ARRANGEMENT_STATUSES),
      supersededBy: z.string().min(1).optional(),
      noticeEndsOn: FleetLocalDateSchema.optional(),
    })
    .strict(),
  "maintenance.status.changed": z
    .object({
      blockId: z.string().min(1),
      fleetId: z.string().min(1),
      vehicleId: z.string().min(1),
      kind: z.enum(MAINTENANCE_KINDS),
      from: z.enum(MAINTENANCE_STATUSES).nullable(),
      to: z.enum(MAINTENANCE_STATUSES),
      path: z.array(z.enum(MAINTENANCE_STATUSES)).optional(),
      startsAt: Timestamp,
      endsAt: Timestamp.nullable(),
    })
    .strict(),
  "fleet.offroad.reported": z
    .object({
      blockId: z.string().min(1),
      fleetId: z.string().min(1),
      vehicleId: z.string().min(1),
      reportedBy: z.string().min(1),
      reportedByRole: z.enum([...FLEET_STAFF_ROLES, "driver"] as const),
      startsAt: Timestamp,
      expectedEndsAt: Timestamp.nullable(),
    })
    .strict(),
  "fleet.offroad.flagged": z
    .object({
      blockId: z.string().min(1),
      fleetId: z.string().min(1),
      vehicleId: z.string().min(1),
      reportedBy: z.string().min(1),
      reason: z.enum([
        "vehicle_on_trip_during_off_road",
        "driver_online_on_vehicle_during_off_road",
      ] as const),
    })
    .strict(),
  "fleet.conflict.opened": z
    .object({
      conflictId: z.string().min(1),
      fleetId: z.string().min(1).nullable(),
      type: z.enum(CONFLICT_TYPES),
      severity: z.enum(CONFLICT_SEVERITIES),
      vehicleId: z.string().min(1).nullable(),
      driverId: z.string().min(1).nullable(),
      bookingBlockId: z.string().min(1).nullable(),
      maintenanceBlockId: z.string().min(1).nullable(),
      deadlineAt: Timestamp.nullable(),
    })
    .strict(),
  "fleet.conflict.resolved": z
    .object({
      conflictId: z.string().min(1),
      fleetId: z.string().min(1).nullable(),
      driverId: z.string().min(1).nullable(),
      vehicleId: z.string().min(1).nullable(),
      type: z.enum(CONFLICT_TYPES),
      resolution: z.string().min(1),
    })
    .strict(),
  "fleet.conflict.lapsed": z
    .object({
      conflictId: z.string().min(1),
      fleetId: z.string().min(1).nullable(),
      driverId: z.string().min(1).nullable(),
      vehicleId: z.string().min(1).nullable(),
      type: z.enum(CONFLICT_TYPES),
      deadlineAt: Timestamp,
    })
    .strict(),
  "fleet.conflict.reminder_sent": z
    .object({
      conflictId: z.string().min(1),
      fleetId: z.string().min(1).nullable(),
      driverId: z.string().min(1).nullable(),
      type: z.enum(CONFLICT_TYPES),
    })
    .strict(),
  "vehicle.document.expiring": z
    .object({
      vehicleId: z.string().min(1),
      fleetId: z.string().min(1),
      document: z.enum(DOCUMENT_KINDS),
      expiresAt: Timestamp,
      reason: z.enum(["threshold", "booking_after_expiry"] as const),
      thresholdDays: z.number().int().positive().optional(),
      bookingBlockId: z.string().min(1).optional(),
    })
    .strict(),
  "vehicle.document.expired": z
    .object({
      vehicleId: z.string().min(1),
      fleetId: z.string().min(1),
      document: z.enum(DOCUMENT_KINDS),
      expiresAt: Timestamp,
      effect: z.literal("doc_expired"),
    })
    .strict(),
  "driver.availability.saved": z
    .object({
      driverId: z.string().min(1),
      setVersion: z.number().int().positive(),
      status: z.enum(AVAILABILITY_STATUSES),
      windows: z.number().int().nonnegative(),
      withdrawalsChosen: z.number().int().nonnegative(),
    })
    .strict(),
  "fleet.vehicle_swap.requested": z
    .object({
      swapRequestId: z.string().min(1),
      swapId: z.string().min(1),
      fleetId: z.string().min(1),
      bookingBlockId: z.string().min(1),
      fromVehicleId: z.string().min(1).nullable(),
      toVehicleId: z.string().min(1),
    })
    .strict(),
  "fleet.alert": z
    .object({
      alertType: z.literal("vehicle_issue_reported"),
      issueId: z.string().min(1),
      severity: z.enum(VEHICLE_ISSUE_SEVERITIES),
      fleetId: z.string().min(1),
      vehicleId: z.string().min(1),
      driverId: z.string().min(1),
      blockId: z.string().min(1).nullable(),
      fleetAction: z.enum([
        "vehicle_off_road",
        "schedule_planned_maintenance",
      ] as const),
      hasNote: z.boolean(),
      reportedAt: Timestamp,
    })
    .strict(),
} as const satisfies Record<FleetEventName, z.ZodTypeAny>;
export type FleetEventPayloadMap = {
  readonly [K in keyof typeof FLEET_EVENT_PAYLOAD_SCHEMAS]: z.infer<
    (typeof FLEET_EVENT_PAYLOAD_SCHEMAS)[K]
  >;
};
