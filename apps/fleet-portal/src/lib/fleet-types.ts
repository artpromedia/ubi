/**
 * The fleet-service responses the portal reads — a local mirror of
 * packages/contracts/src/fleet.ts (the response schemas in
 * `FLEET_RESPONSE_SCHEMAS`), field for field. The portal does not depend on
 * @ubi/contracts (fleet.ts is not registered in its index yet), so these
 * types are kept by hand; fixtures in the tests are shaped from the same
 * schemas.
 *
 * What is deliberately ABSENT: every booking reaches the portal only as an
 * `OccupiedBlock` (time + server risk flag). There is no rider, location,
 * route, fare or driver-net field anywhere in these types, and
 * `privacy.ts` strips any such key a response might carry before it
 * reaches a screen.
 */

export type FleetStaffRole = "owner" | "manager" | "read_only";

export type FleetCapability =
  | "view_calendar"
  | "manage_maintenance"
  | "report_off_road"
  | "propose_assignment"
  | "propose_terms"
  | "manage_vehicles"
  | "request_vehicle_swap"
  | "remind_driver"
  | "terminate_arrangement"
  | "manage_staff";

/** A server amount: integer minor units + ISO currency. */
export interface Money {
  readonly amountMinor: number;
  readonly currency: string;
}

/** Money fleet-service does not serve (payment-service owns it). */
export interface MoneyUnavailable {
  readonly available: false;
  readonly reason: string;
  readonly source: string;
}

export interface FleetView {
  readonly fleetId: string;
  readonly name: string;
  readonly cityId: string;
  readonly currency: string;
  readonly zone: string;
  readonly status: "active" | "suspended";
  readonly myRole: FleetStaffRole;
  readonly createdAt: string;
}

export interface FleetList {
  readonly fleets: readonly FleetView[];
}

export type FleetShiftKind = "full" | "day" | "night" | "custom";

export interface FleetShift {
  readonly kind: FleetShiftKind;
  readonly start: string;
  readonly end: string;
}

export type DocumentKind = "insurance" | "inspection";
export type DocumentStatus = "valid" | "expiring" | "expired" | "missing";

export interface DocumentStatusView {
  readonly kind: DocumentKind;
  readonly status: DocumentStatus;
  readonly expiresAt: string | null;
  readonly daysToExpiry: number | null;
}

export type VehicleAvailabilityState =
  | "in_service"
  | "maintenance"
  | "doc_expired"
  | "held_by_ubi"
  | "unassigned"
  | "documents_pending";

export const VEHICLE_AVAILABILITY_STATES: readonly VehicleAvailabilityState[] =
  [
    "in_service",
    "maintenance",
    "doc_expired",
    "held_by_ubi",
    "unassigned",
    "documents_pending",
  ];

export const FLEET_VEHICLE_CLASSES = ["go", "comfort", "xl", "moto"] as const;

export interface FleetVehicleView {
  readonly vehicleId: string;
  readonly plate: string;
  readonly make: string;
  readonly model: string;
  readonly year: number;
  readonly color: string;
  readonly classes: readonly string[];
  readonly capacity: number;
  readonly statusNow: VehicleAvailabilityState;
  readonly drivers: readonly {
    readonly driverId: string;
    readonly displayName: string;
    readonly shift: FleetShift;
    readonly termsVersion: number;
  }[];
  readonly documents: readonly DocumentStatusView[];
  readonly money: MoneyUnavailable;
  readonly addedAt: string;
}

export interface FleetVehicleList {
  readonly vehicles: readonly FleetVehicleView[];
}

export type ArrangementStatus = "active" | "notice" | "ended" | "superseded";

export interface AssignmentTerms {
  readonly type: "weekly_fixed" | "percent_of_net";
  readonly amountMinor: number | null;
  readonly currency: string;
  readonly percent: number | null;
  readonly shortfall: {
    readonly policy: "carry_forward";
    readonly maxWeeks: number;
  };
  readonly fuelBy: "driver" | "fleet";
  readonly servicingBy: "driver" | "fleet";
}

export interface ArrangementView {
  readonly assignmentId: string;
  readonly fleetId: string;
  readonly vehicleId: string;
  readonly driverId: string;
  readonly driverDisplayName: string;
  readonly shift: FleetShift;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly termsVersion: number;
  readonly terms: AssignmentTerms;
  readonly signedAt: string;
  readonly status: ArrangementStatus;
}

export type ProposalStatus =
  | "draft"
  | "checking"
  | "sent"
  | "pending_signature"
  | "signed"
  | "declined"
  | "expired"
  | "withdrawn"
  | "superseded";

export type TermDiffField =
  | "vehicle"
  | "shift"
  | "validity"
  | "remittance"
  | "shortfall"
  | "fuelBy"
  | "servicingBy";

export interface TermDiff {
  readonly field: TermDiffField;
  readonly material: boolean;
}

export interface ProposalView {
  readonly proposalId: string;
  readonly fleetId: string;
  readonly vehicleId: string;
  readonly driverId: string;
  readonly driverDisplayName: string;
  readonly shift: FleetShift;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly termsVersion: number;
  readonly terms: AssignmentTerms;
  readonly diff: readonly TermDiff[];
  readonly status: ProposalStatus;
  readonly check: {
    readonly shiftOverlap: boolean;
    readonly withinCityCap: boolean;
    readonly cityCap: Money;
  };
  readonly proposedByRole: "owner" | "manager";
  readonly sentAt: string | null;
  readonly expiresAt: string | null;
  readonly respondedAt: string | null;
}

export interface FleetAssignments {
  readonly arrangements: readonly ArrangementView[];
  readonly proposals: readonly ProposalView[];
}

export type MaintenanceKind =
  | "planned_service"
  | "inspection"
  | "repair"
  | "unplanned_off_road";

export type PlannedMaintenanceKind = Exclude<
  MaintenanceKind,
  "unplanned_off_road"
>;

export const PLANNED_MAINTENANCE_KINDS: readonly PlannedMaintenanceKind[] = [
  "planned_service",
  "inspection",
  "repair",
];

export type MaintenanceStatus =
  | "draft"
  | "checking"
  | "needs_resolution"
  | "scheduled"
  | "active"
  | "completed"
  | "cancelled";

export interface MaintenanceBlockView {
  readonly blockId: string;
  readonly fleetId: string;
  readonly vehicleId: string;
  readonly kind: MaintenanceKind;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly zone: string;
  readonly note: string | null;
  readonly status: MaintenanceStatus;
  readonly version: number;
  readonly offRoadFlagged: boolean;
  readonly createdAt: string;
}

export interface MaintenanceList {
  readonly blocks: readonly MaintenanceBlockView[];
}

/** THE ONLY booking shape a fleet receives (buffers included). */
export interface OccupiedBlock {
  readonly blockId: string;
  readonly driverId: string;
  readonly vehicleId: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly kind: "booked" | "on_trip";
  readonly risk: "ok" | "at_risk";
  readonly decisionDeadline: string | null;
}

export type MaintenanceSuggestion =
  | {
      readonly kind: "move";
      readonly startsAt: string;
      readonly endsAt: string;
    }
  | {
      readonly kind: "swap";
      readonly bookingBlockId: string;
      readonly candidates: readonly {
        readonly vehicleId: string;
        readonly plate: string;
        readonly eligible: boolean;
        readonly reasons: readonly string[];
      }[];
    }
  | {
      readonly kind: "ask_driver";
      readonly bookingBlockId: string;
      readonly driverId: string;
    };

export interface MaintenancePreviewView {
  readonly feasible: boolean;
  readonly affectedAssignments: readonly {
    readonly assignmentId: string;
    readonly driverId: string;
    readonly driverDisplayName: string;
    readonly lostInterval: {
      readonly startsAt: string;
      readonly endsAt: string;
    };
  }[];
  readonly affectedBlocks: readonly OccupiedBlock[];
  readonly suggestions: readonly MaintenanceSuggestion[];
  readonly previewToken: string;
  readonly checkedAt: string;
}

export interface NeedsResolutionDetails {
  readonly block: MaintenanceBlockView;
  readonly affectedBlocks: readonly OccupiedBlock[];
  readonly conflictIds: readonly string[];
}

export interface OffRoadView {
  readonly block: MaintenanceBlockView;
  readonly atRiskBookings: readonly {
    readonly blockId: string;
    readonly decisionDeadline: string;
  }[];
  readonly conflictIds: readonly string[];
}

export type FleetConflictType =
  | "maintenance_overlaps_booking"
  | "unplanned_off_road"
  | "document_expiring"
  | "document_expires_in_booking"
  | "driver_resolving"
  | "termination_bookings";

export type ConflictSeverity =
  | "critical"
  | "high"
  | "medium"
  | "blocked"
  | "status";

export type ConflictResolverRole = "fleet" | "driver" | "rider" | "ubi";

export type ConflictStatus = "open" | "resolving" | "resolved" | "lapsed";

export type FleetConflictAction =
  | "move_block"
  | "cancel_block"
  | "complete_block"
  | "propose_vehicle_swap"
  | "ask_driver"
  | "remind"
  | "renew_document";

export interface ConflictView {
  readonly conflictId: string;
  readonly type: FleetConflictType;
  readonly severity: ConflictSeverity;
  readonly subjects: readonly {
    readonly vehicleId: string | null;
    readonly driverId: string | null;
    readonly blockId: string | null;
  }[];
  readonly resolverRoles: readonly ConflictResolverRole[];
  /** For THIS caller's role — the portal offers exactly these. */
  readonly allowedActions: readonly FleetConflictAction[];
  readonly deadlineAt: string | null;
  readonly status: ConflictStatus;
  readonly openedAt: string;
  readonly resolvedAt: string | null;
}

export interface ConflictList {
  readonly conflicts: readonly ConflictView[];
}

export type CalendarLayer =
  | "assignments"
  | "maintenance"
  | "bookings"
  | "documents";

export const CALENDAR_LAYERS: readonly CalendarLayer[] = [
  "assignments",
  "maintenance",
  "bookings",
  "documents",
];

export interface CalendarAssignment {
  readonly assignmentId: string;
  readonly vehicleId: string;
  readonly driverId: string;
  readonly driverDisplayName: string;
  readonly shift: FleetShift;
  readonly termsVersion: number;
  readonly status: ArrangementStatus;
  readonly intervals: readonly {
    readonly startsAt: string;
    readonly endsAt: string;
  }[];
}

/** A driver-authored window as a FLEET sees it: time off is `unavailable`. */
export interface FleetAvailabilityBlock {
  readonly kind: "available" | "unavailable";
  readonly startsAt: string;
  readonly endsAt: string;
  readonly setBy: "driver";
}

export interface UbiStatus {
  readonly subject: "driver" | "vehicle";
  readonly subjectId: string;
  readonly status: "held_by_ubi" | "doc_expired" | "suspended";
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
}

export interface CalendarRow {
  readonly rowId: string;
  readonly rowKind: "vehicle" | "driver";
  readonly vehicleId: string | null;
  readonly driverId: string | null;
  readonly label: string;
  readonly statusNow: VehicleAvailabilityState | null;
  readonly flags: readonly string[];
  readonly assignments: readonly CalendarAssignment[];
  readonly maintenance: readonly MaintenanceBlockView[];
  readonly occupied: readonly OccupiedBlock[];
  readonly documents: readonly DocumentStatusView[];
  readonly ubiStatus: UbiStatus | null;
  readonly availability: readonly FleetAvailabilityBlock[] | null;
  readonly hours: { readonly signedShiftHours: number } | null;
}

export interface DaySummary {
  readonly date: string;
  readonly rowId: string;
  readonly bookedCount: number;
  readonly shiftSummary: readonly string[];
  readonly maintenanceCount: number;
  readonly flags: readonly string[];
}

export interface FleetCalendar {
  readonly zone: string;
  readonly asOf: string;
  readonly from: string;
  readonly to: string;
  readonly zoom: "day" | "week";
  readonly rowsKind: "vehicles" | "drivers";
  readonly layers: readonly CalendarLayer[];
  readonly rows: readonly CalendarRow[];
  readonly daySummaries: readonly DaySummary[] | null;
  readonly nextCursor: string | null;
  readonly totalRows: number;
}

export type UtilisationMetric =
  | "onTrip"
  | "onlineIdle"
  | "bookedAhead"
  | "maintenance"
  | "offline";

export interface UtilisationRow {
  readonly vehicleId: string;
  readonly plate: string;
  readonly addedAt: string;
  readonly enoughData: boolean;
  readonly reason: "not_enough_data" | null;
  readonly hours: Readonly<Record<UtilisationMetric, number | null>> | null;
  readonly unavailable: readonly {
    readonly metric: string;
    readonly reason: string;
    readonly dependency: string;
  }[];
}

export interface Utilisation {
  readonly asOf: string;
  readonly zone: string;
  readonly from: string;
  readonly to: string;
  readonly definitions: Readonly<Record<string, string>>;
  readonly rows: readonly UtilisationRow[];
}

export interface FleetOverview {
  readonly fleetId: string;
  readonly asOf: string;
  readonly zone: string;
  readonly vehicles: {
    readonly total: number;
    readonly docExpiring: number;
    readonly docExpired: number;
    readonly inMaintenance: number;
  };
  readonly arrangements: {
    readonly active: number;
    readonly onNotice: number;
    readonly pendingProposals: number;
  };
  readonly openConflicts: {
    readonly critical: number;
    readonly high: number;
    readonly medium: number;
    readonly status: number;
  };
  readonly money: MoneyUnavailable;
}

export interface FleetStaffMember {
  readonly staffId: string;
  readonly userId: string;
  readonly displayName: string | null;
  readonly role: FleetStaffRole;
  readonly addedAt: string;
}

export interface FleetStaffList {
  readonly fleetId: string;
  readonly staff: readonly FleetStaffMember[];
}

export interface VehicleSwapRequestView {
  readonly swapRequestId: string;
  readonly bookingBlockId: string;
  readonly fromVehicleId: string;
  readonly toVehicleId: string;
  readonly swapId: string | null;
  readonly status: "proposed" | "ineligible";
  readonly reasons: readonly string[];
}

export interface TerminationView {
  readonly assignmentId: string;
  readonly status: ArrangementStatus;
  readonly noticeEndsOn: string;
  readonly bookingsAfterNotice: readonly OccupiedBlock[];
  readonly conflictIds: readonly string[];
}

export interface ReminderView {
  readonly conflictId: string;
  readonly remindedAt: string;
}

// ── Request bodies (packages/contracts/src/fleet.ts) ────────────────────────

export interface MaintenanceWindowInput {
  readonly vehicleId: string;
  readonly kind: PlannedMaintenanceKind;
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface CreateMaintenanceInput extends MaintenanceWindowInput {
  readonly note?: string;
  readonly previewToken: string;
}

export interface PatchMaintenanceInput {
  readonly startsAt?: string;
  readonly endsAt?: string;
  readonly note?: string;
  readonly previewToken: string;
}

export interface ReportOffRoadInput {
  readonly vehicleId: string;
  readonly startsAt?: string;
  readonly expectedEndsAt?: string;
  readonly note?: string;
}

export type FleetShiftInput =
  | "full"
  | "day"
  | "night"
  | { readonly start: string; readonly end: string };

export interface AssignmentTermsInput {
  readonly type: "weekly_fixed" | "percent_of_net";
  readonly amountMinor?: number;
  readonly percent?: number;
  readonly shortfall: {
    readonly policy: "carry_forward";
    readonly maxWeeks: number;
  };
  readonly fuelBy: "driver" | "fleet";
  readonly servicingBy: "driver" | "fleet";
}

export interface ProposeAssignmentInput {
  readonly vehicleId: string;
  readonly driverId: string;
  readonly shift: FleetShiftInput;
  readonly validFrom: string;
  readonly validTo?: string;
  /** Owners only; absent = the driver's currently signed terms version. */
  readonly terms?: AssignmentTermsInput;
}

export interface AddFleetVehicleInput {
  readonly plate: string;
  readonly make: string;
  readonly model: string;
  readonly year: number;
  readonly color: string;
  readonly type: "SEDAN" | "SUV" | "VAN" | "MOTORCYCLE" | "ELECTRIC";
  readonly capacity: number;
  readonly classes: readonly string[];
}

export interface PutFleetStaffInput {
  readonly staff: readonly {
    readonly userId: string;
    readonly role: FleetStaffRole;
  }[];
}

export interface CalendarQuery {
  readonly from: string;
  readonly to: string;
  readonly zoom: "day" | "week";
  readonly rows: "vehicles" | "drivers";
  readonly layers: readonly CalendarLayer[];
  readonly vehicleClass?: string;
  readonly status?: VehicleAvailabilityState;
  readonly conflictsOnly: boolean;
  readonly q?: string;
  readonly cursor?: string;
  readonly limit: number;
}
