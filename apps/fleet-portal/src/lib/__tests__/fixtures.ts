/**
 * Test inputs shaped field for field from the fleet-service response
 * schemas (packages/contracts/src/fleet.ts). `contract-fixtures.test.ts`
 * parses every one of them with the REAL contract schemas, so a fixture can
 * never drift from what fleet-service serves. All plates, names and times
 * are invented (the handoff's fixture vocabulary); none is seeded anywhere.
 *
 * `POLLUTION` is what a response must never carry to a fleet — a rider, a
 * location, a fare, a driver's net. The privacy tests add it to responses
 * and check nothing of it survives or renders.
 */
import type {
  ConflictList,
  FleetAssignments,
  FleetCalendar,
  FleetOverview,
  FleetStaffList,
  FleetVehicleView,
  FleetView,
  MaintenanceList,
  MaintenancePreviewView,
  Utilisation,
} from "../fleet-types";

export const ZONE = "Africa/Lagos";
/** Wed 30 Sep 2026 09:42 WAT. */
export const NOW = Date.parse("2026-09-30T08:42:00.000Z");

export const fleetAs = (
  myRole: FleetView["myRole"],
  status: FleetView["status"] = "active",
): FleetView => ({
  fleetId: "flt_example",
  name: "Example Fleet Ltd",
  cityId: "lagos",
  currency: "NGN",
  zone: ZONE,
  status,
  myRole,
  createdAt: "2026-08-01T09:00:00.000Z",
});

export const VEH = {
  kj: "11111111-1111-4111-8111-111111111111",
  ab: "22222222-2222-4222-8222-222222222222",
  qd: "33333333-3333-4333-8333-333333333333",
  zx: "44444444-4444-4444-8444-444444444444",
  mm: "55555555-5555-4555-8555-555555555555",
} as const;

export const DRV = {
  chidi: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  bola: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  tunde: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  kemi: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
} as const;

const shiftDay = { kind: "day" as const, start: "06:00", end: "14:00" };

export const dayCalendar: FleetCalendar = {
  zone: ZONE,
  asOf: "2026-09-30T08:42:00.000Z",
  from: "2026-09-29T23:00:00.000Z",
  to: "2026-09-30T23:00:00.000Z",
  zoom: "day",
  rowsKind: "vehicles",
  layers: ["assignments", "maintenance", "bookings", "documents"],
  rows: [
    {
      rowId: VEH.kj,
      rowKind: "vehicle",
      vehicleId: VEH.kj,
      driverId: null,
      label: "LAG-472-KJ",
      statusNow: "in_service",
      flags: [],
      assignments: [
        {
          assignmentId: "fas_chidi_v3",
          vehicleId: VEH.kj,
          driverId: DRV.chidi,
          driverDisplayName: "Chidi O.",
          shift: shiftDay,
          termsVersion: 3,
          status: "active",
          intervals: [
            {
              startsAt: "2026-09-30T05:00:00.000Z",
              endsAt: "2026-09-30T13:00:00.000Z",
            },
          ],
        },
      ],
      maintenance: [],
      occupied: [
        {
          blockId: "blk_kj_1",
          driverId: DRV.chidi,
          vehicleId: VEH.kj,
          startsAt: "2026-09-30T06:15:00.000Z",
          endsAt: "2026-09-30T08:40:00.000Z",
          kind: "booked",
          risk: "ok",
          decisionDeadline: null,
        },
        {
          blockId: "blk_kj_night",
          driverId: DRV.chidi,
          vehicleId: VEH.kj,
          startsAt: "2026-09-30T21:30:00.000Z",
          endsAt: "2026-09-30T22:30:00.000Z",
          kind: "booked",
          risk: "ok",
          decisionDeadline: null,
        },
      ],
      documents: [
        {
          kind: "insurance",
          status: "valid",
          expiresAt: "2027-03-01T00:00:00.000Z",
          daysToExpiry: 151,
        },
        {
          kind: "inspection",
          status: "valid",
          expiresAt: "2027-01-01T00:00:00.000Z",
          daysToExpiry: 92,
        },
      ],
      ubiStatus: null,
      availability: null,
      hours: { signedShiftHours: 8 },
    },
    {
      rowId: VEH.ab,
      rowKind: "vehicle",
      vehicleId: VEH.ab,
      driverId: null,
      label: "LAG-118-AB",
      statusNow: "in_service",
      flags: ["conflict", "at_risk", "doc_expiring"],
      assignments: [
        {
          assignmentId: "fas_bola_v1",
          vehicleId: VEH.ab,
          driverId: DRV.bola,
          driverDisplayName: "Bola A.",
          shift: { kind: "day", start: "06:00", end: "18:00" },
          termsVersion: 1,
          status: "active",
          intervals: [
            {
              startsAt: "2026-09-30T05:00:00.000Z",
              endsAt: "2026-09-30T17:00:00.000Z",
            },
          ],
        },
      ],
      maintenance: [
        {
          blockId: "mnt_ab_service",
          fleetId: "flt_example",
          vehicleId: VEH.ab,
          kind: "planned_service",
          startsAt: "2026-09-30T09:00:00.000Z",
          endsAt: "2026-09-30T14:00:00.000Z",
          zone: ZONE,
          note: null,
          status: "needs_resolution",
          version: 2,
          offRoadFlagged: false,
          createdAt: "2026-09-29T10:00:00.000Z",
        },
      ],
      occupied: [
        {
          blockId: "blk_ab_1",
          driverId: DRV.bola,
          vehicleId: VEH.ab,
          startsAt: "2026-09-30T10:20:00.000Z",
          endsAt: "2026-09-30T12:00:00.000Z",
          kind: "booked",
          risk: "at_risk",
          decisionDeadline: "2026-09-30T08:20:00.000Z",
        },
      ],
      documents: [
        {
          kind: "insurance",
          status: "expiring",
          expiresAt: "2026-10-15T00:00:00.000Z",
          daysToExpiry: 14,
        },
        {
          kind: "inspection",
          status: "valid",
          expiresAt: "2026-12-02T00:00:00.000Z",
          daysToExpiry: 62,
        },
      ],
      ubiStatus: null,
      availability: null,
      hours: { signedShiftHours: 12 },
    },
    {
      rowId: VEH.qd,
      rowKind: "vehicle",
      vehicleId: VEH.qd,
      driverId: null,
      label: "LAG-551-QD",
      statusNow: "doc_expired",
      flags: ["doc_expired"],
      assignments: [],
      maintenance: [],
      occupied: [],
      documents: [
        {
          kind: "insurance",
          status: "expired",
          expiresAt: "2026-09-20T00:00:00.000Z",
          daysToExpiry: -11,
        },
        {
          kind: "inspection",
          status: "valid",
          expiresAt: "2027-01-01T00:00:00.000Z",
          daysToExpiry: 92,
        },
      ],
      ubiStatus: {
        subject: "vehicle",
        subjectId: VEH.qd,
        status: "doc_expired",
        effectiveFrom: "2026-09-20T00:00:00.000Z",
        effectiveTo: null,
      },
      availability: null,
      hours: { signedShiftHours: 0 },
    },
    {
      rowId: VEH.zx,
      rowKind: "vehicle",
      vehicleId: VEH.zx,
      driverId: null,
      label: "LAG-620-ZX",
      statusNow: "unassigned",
      flags: [],
      assignments: [],
      maintenance: [],
      occupied: [],
      documents: [],
      ubiStatus: null,
      availability: null,
      hours: { signedShiftHours: 0 },
    },
  ],
  daySummaries: null,
  nextCursor: "eyJvIjo0MH0",
  totalRows: 212,
};

export const driverCalendar: FleetCalendar = {
  ...dayCalendar,
  rowsKind: "drivers",
  nextCursor: null,
  totalRows: 1,
  rows: [
    {
      rowId: DRV.tunde,
      rowKind: "driver",
      vehicleId: null,
      driverId: DRV.tunde,
      label: "Tunde B.",
      statusNow: null,
      flags: [],
      assignments: [
        {
          assignmentId: "fas_tunde_v2",
          vehicleId: VEH.mm,
          driverId: DRV.tunde,
          driverDisplayName: "Tunde B.",
          shift: shiftDay,
          termsVersion: 2,
          status: "active",
          intervals: [
            {
              startsAt: "2026-09-30T05:00:00.000Z",
              endsAt: "2026-09-30T13:00:00.000Z",
            },
          ],
        },
      ],
      maintenance: [],
      occupied: [
        {
          blockId: "blk_mm_1",
          driverId: DRV.tunde,
          vehicleId: VEH.mm,
          startsAt: "2026-09-30T07:00:00.000Z",
          endsAt: "2026-09-30T08:30:00.000Z",
          kind: "booked",
          risk: "ok",
          decisionDeadline: null,
        },
      ],
      documents: [],
      ubiStatus: null,
      availability: [
        {
          kind: "available",
          startsAt: "2026-09-30T04:30:00.000Z",
          endsAt: "2026-09-30T13:00:00.000Z",
          setBy: "driver",
        },
        {
          kind: "unavailable",
          startsAt: "2026-09-30T13:00:00.000Z",
          endsAt: "2026-09-30T22:00:00.000Z",
          setBy: "driver",
        },
      ],
      hours: { signedShiftHours: 8 },
    },
  ],
};

export const weekCalendar: FleetCalendar = {
  ...dayCalendar,
  zoom: "week",
  from: "2026-09-27T23:00:00.000Z",
  to: "2026-10-04T23:00:00.000Z",
  nextCursor: null,
  totalRows: 2,
  rows: [
    dayCalendar.rows[1] as FleetCalendar["rows"][number],
    dayCalendar.rows[2] as FleetCalendar["rows"][number],
  ],
  daySummaries: [
    {
      date: "2026-09-29",
      rowId: VEH.ab,
      bookedCount: 0,
      shiftSummary: ["day 06:00–18:00"],
      maintenanceCount: 0,
      flags: [],
    },
    {
      date: "2026-09-30",
      rowId: VEH.ab,
      bookedCount: 1,
      shiftSummary: ["day 06:00–18:00"],
      maintenanceCount: 1,
      flags: ["at_risk", "maintenance"],
    },
    {
      date: "2026-10-01",
      rowId: VEH.ab,
      bookedCount: 2,
      shiftSummary: ["day 06:00–18:00"],
      maintenanceCount: 0,
      flags: [],
    },
    {
      date: "2026-10-02",
      rowId: VEH.ab,
      bookedCount: 0,
      shiftSummary: [],
      maintenanceCount: 1,
      flags: ["maintenance"],
    },
    {
      date: "2026-09-29",
      rowId: VEH.qd,
      bookedCount: 0,
      shiftSummary: [],
      maintenanceCount: 0,
      flags: [],
    },
  ],
};

export const conflicts: ConflictList = {
  conflicts: [
    {
      conflictId: "fcf_maint",
      type: "maintenance_overlaps_booking",
      severity: "critical",
      subjects: [
        { vehicleId: VEH.ab, driverId: DRV.bola, blockId: "blk_ab_1" },
      ],
      resolverRoles: ["fleet", "driver", "rider"],
      allowedActions: [
        "move_block",
        "cancel_block",
        "propose_vehicle_swap",
        "ask_driver",
      ],
      deadlineAt: "2026-09-30T08:20:00.000Z",
      status: "open",
      openedAt: "2026-09-29T10:00:00.000Z",
      resolvedAt: null,
    },
    {
      conflictId: "fcf_doc",
      type: "document_expiring",
      severity: "high",
      subjects: [{ vehicleId: VEH.ab, driverId: null, blockId: null }],
      resolverRoles: ["fleet", "ubi"],
      allowedActions: ["renew_document"],
      deadlineAt: "2026-10-15T00:00:00.000Z",
      status: "open",
      openedAt: "2026-09-29T10:00:00.000Z",
      resolvedAt: null,
    },
    {
      conflictId: "fcf_driver",
      type: "driver_resolving",
      severity: "medium",
      subjects: [{ vehicleId: null, driverId: DRV.tunde, blockId: "blk_mm_1" }],
      resolverRoles: ["driver"],
      allowedActions: [],
      deadlineAt: "2026-10-01T11:00:00.000Z",
      status: "open",
      openedAt: "2026-09-29T10:00:00.000Z",
      resolvedAt: null,
    },
    {
      conflictId: "fcf_held",
      type: "unplanned_off_road",
      severity: "status",
      subjects: [{ vehicleId: VEH.qd, driverId: null, blockId: null }],
      resolverRoles: ["ubi"],
      allowedActions: [],
      deadlineAt: null,
      status: "open",
      openedAt: "2026-09-29T10:00:00.000Z",
      resolvedAt: null,
    },
  ],
};

export const infeasiblePreview: MaintenancePreviewView = {
  feasible: false,
  affectedAssignments: [
    {
      assignmentId: "fas_bola_v1",
      driverId: DRV.bola,
      driverDisplayName: "Bola A.",
      lostInterval: {
        startsAt: "2026-09-30T09:00:00.000Z",
        endsAt: "2026-09-30T14:00:00.000Z",
      },
    },
  ],
  affectedBlocks: [
    dayCalendar.rows[1]
      ?.occupied[0] as FleetCalendar["rows"][number]["occupied"][number],
  ],
  suggestions: [
    {
      kind: "move",
      startsAt: "2026-09-30T12:40:00.000Z",
      endsAt: "2026-09-30T17:40:00.000Z",
    },
    {
      kind: "swap",
      bookingBlockId: "blk_ab_1",
      candidates: [
        {
          vehicleId: VEH.zx,
          plate: "LAG-620-ZX",
          eligible: false,
          reasons: ["class_not_eligible"],
        },
        { vehicleId: VEH.mm, plate: "LAG-744-MM", eligible: true, reasons: [] },
      ],
    },
    { kind: "ask_driver", bookingBlockId: "blk_ab_1", driverId: DRV.bola },
  ],
  previewToken: "mpv_0123456789abcdef0123456789abcdef01234567",
  checkedAt: "2026-09-30T08:42:00.000Z",
};

export const feasiblePreview: MaintenancePreviewView = {
  feasible: true,
  affectedAssignments: [],
  affectedBlocks: [],
  suggestions: [],
  previewToken: "mpv_feasible00000000000000000000000000000000",
  checkedAt: "2026-09-30T08:42:00.000Z",
};

export const vehicleView: FleetVehicleView = {
  vehicleId: VEH.ab,
  plate: "LAG-118-AB",
  make: "Toyota",
  model: "Camry",
  year: 2020,
  color: "Silver",
  classes: ["comfort"],
  capacity: 4,
  statusNow: "in_service",
  drivers: [
    {
      driverId: DRV.bola,
      displayName: "Bola A.",
      shift: { kind: "day", start: "06:00", end: "18:00" },
      termsVersion: 1,
    },
  ],
  documents: [
    {
      kind: "insurance",
      status: "expiring",
      expiresAt: "2026-10-15T00:00:00.000Z",
      daysToExpiry: 14,
    },
    {
      kind: "inspection",
      status: "valid",
      expiresAt: "2026-12-02T00:00:00.000Z",
      daysToExpiry: 62,
    },
  ],
  money: {
    available: false,
    reason:
      "gross, UBI commission and remittance are settled by payment-service; fleet-service never computes money",
    source: "payment-service remittance settlement (internal contract B)",
  },
  addedAt: "2026-08-02T09:00:00.000Z",
};

export const vehicleAvailability: FleetCalendar = {
  ...dayCalendar,
  zoom: "week",
  from: "2026-09-29T23:00:00.000Z",
  to: "2026-10-29T23:00:00.000Z",
  nextCursor: null,
  totalRows: 1,
  rows: [
    {
      ...(dayCalendar.rows[1] as FleetCalendar["rows"][number]),
      occupied: [
        dayCalendar.rows[1]
          ?.occupied[0] as FleetCalendar["rows"][number]["occupied"][number],
        {
          blockId: "blk_ab_late",
          driverId: DRV.bola,
          vehicleId: VEH.ab,
          startsAt: "2026-10-20T08:00:00.000Z",
          endsAt: "2026-10-20T09:30:00.000Z",
          kind: "booked",
          risk: "ok",
          decisionDeadline: null,
        },
      ],
    },
  ],
  daySummaries: [],
};

export const maintenanceList: MaintenanceList = {
  blocks: [
    {
      blockId: "mnt_ab_repair",
      fleetId: "flt_example",
      vehicleId: VEH.ab,
      kind: "repair",
      startsAt: "2026-09-12T08:00:00.000Z",
      endsAt: "2026-09-12T12:30:00.000Z",
      zone: ZONE,
      note: "brake pads",
      status: "completed",
      version: 3,
      offRoadFlagged: false,
      createdAt: "2026-09-10T10:00:00.000Z",
    },
    dayCalendar.rows[1]?.maintenance[0] as MaintenanceList["blocks"][number],
    {
      blockId: "mnt_ab_inspection",
      fleetId: "flt_example",
      vehicleId: VEH.ab,
      kind: "inspection",
      startsAt: "2026-10-01T23:00:00.000Z",
      endsAt: "2026-10-02T23:00:00.000Z",
      zone: ZONE,
      note: null,
      status: "scheduled",
      version: 1,
      offRoadFlagged: false,
      createdAt: "2026-09-20T10:00:00.000Z",
    },
  ],
};

export const assignments: FleetAssignments = {
  arrangements: [
    {
      assignmentId: "fas_bola_v1",
      fleetId: "flt_example",
      vehicleId: VEH.ab,
      driverId: DRV.bola,
      driverDisplayName: "Bola A.",
      shift: { kind: "day", start: "06:00", end: "18:00" },
      validFrom: "2026-09-02",
      validTo: null,
      termsVersion: 1,
      terms: {
        type: "weekly_fixed",
        amountMinor: 4_500_000,
        currency: "NGN",
        percent: null,
        shortfall: { policy: "carry_forward", maxWeeks: 2 },
        fuelBy: "driver",
        servicingBy: "fleet",
      },
      signedAt: "2026-09-02T09:00:00.000Z",
      status: "active",
    },
  ],
  proposals: [
    {
      proposalId: "fpr_kemi",
      fleetId: "flt_example",
      vehicleId: VEH.mm,
      driverId: DRV.kemi,
      driverDisplayName: "Kemi L.",
      shift: { kind: "custom", start: "14:00", end: "22:00" },
      validFrom: "2026-10-01",
      validTo: null,
      termsVersion: 1,
      terms: {
        type: "weekly_fixed",
        amountMinor: 4_000_000,
        currency: "NGN",
        percent: null,
        shortfall: { policy: "carry_forward", maxWeeks: 2 },
        fuelBy: "driver",
        servicingBy: "fleet",
      },
      diff: [
        { field: "vehicle", material: true },
        { field: "shift", material: true },
        { field: "remittance", material: true },
      ],
      status: "pending_signature",
      check: {
        shiftOverlap: false,
        withinCityCap: true,
        cityCap: { amountMinor: 15_000_000, currency: "NGN" },
      },
      proposedByRole: "owner",
      sentAt: "2026-09-23T09:02:00.000Z",
      expiresAt: "2026-09-25T09:02:00.000Z",
      respondedAt: null,
    },
    {
      proposalId: "fpr_declined",
      fleetId: "flt_example",
      vehicleId: VEH.zx,
      driverId: DRV.tunde,
      driverDisplayName: "Tunde B.",
      shift: shiftDay,
      validFrom: "2026-09-20",
      validTo: null,
      termsVersion: 2,
      terms: {
        type: "percent_of_net",
        amountMinor: null,
        currency: "NGN",
        percent: 20,
        shortfall: { policy: "carry_forward", maxWeeks: 1 },
        fuelBy: "driver",
        servicingBy: "driver",
      },
      diff: [{ field: "vehicle", material: true }],
      status: "declined",
      check: {
        shiftOverlap: false,
        withinCityCap: true,
        cityCap: { amountMinor: 15_000_000, currency: "NGN" },
      },
      proposedByRole: "manager",
      sentAt: "2026-09-18T09:00:00.000Z",
      expiresAt: "2026-09-20T09:00:00.000Z",
      respondedAt: "2026-09-19T12:00:00.000Z",
    },
  ],
};

export const utilisation: Utilisation = {
  asOf: "2026-09-30T08:42:00.000Z",
  zone: ZONE,
  from: "2026-09-23T08:42:00.000Z",
  to: "2026-09-30T08:42:00.000Z",
  definitions: {
    onTrip: "Hours the vehicle carried a trip (ride-service trip history).",
    onlineIdle: "Hours a driver was online in the vehicle without a trip.",
    bookedAhead:
      "Hours of confirmed advance bookings still ahead in the range, buffers included (ride-service's fleet-safe projection).",
    maintenance: "Hours inside maintenance or off-road blocks (fleet-service).",
    offline: "Hours with no driver online in the vehicle.",
  },
  rows: [
    {
      vehicleId: VEH.ab,
      plate: "LAG-118-AB",
      addedAt: "2026-08-02T09:00:00.000Z",
      enoughData: true,
      reason: null,
      hours: {
        onTrip: null,
        onlineIdle: null,
        bookedAhead: 7,
        maintenance: 10.5,
        offline: null,
      },
      unavailable: [
        {
          metric: "onTrip",
          reason:
            "no per-vehicle trip-hours history is available to fleet-service",
          dependency: "ride-service",
        },
      ],
    },
    {
      vehicleId: VEH.zx,
      plate: "LAG-620-ZX",
      addedAt: "2026-09-26T09:00:00.000Z",
      enoughData: false,
      reason: "not_enough_data",
      hours: null,
      unavailable: [],
    },
  ],
};

export const staff: FleetStaffList = {
  fleetId: "flt_example",
  staff: [
    {
      staffId: "fst_1",
      userId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
      displayName: "Ada O.",
      role: "owner",
      addedAt: "2026-08-01T09:00:00.000Z",
    },
    {
      staffId: "fst_2",
      userId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
      displayName: "Musa I.",
      role: "manager",
      addedAt: "2026-08-03T09:00:00.000Z",
    },
  ],
};

export const overview: FleetOverview = {
  fleetId: "flt_example",
  asOf: "2026-09-30T08:42:00.000Z",
  zone: ZONE,
  vehicles: { total: 6, docExpiring: 1, docExpired: 1, inMaintenance: 0 },
  arrangements: { active: 5, onNotice: 1, pendingProposals: 1 },
  openConflicts: { critical: 1, high: 2, medium: 1, status: 1 },
  money: vehicleView.money,
};

/** What must never reach a fleet: values that must not appear anywhere. */
export const FORBIDDEN_VALUES = [
  "Ada Obi",
  "+2348031234567",
  "12 Allen Avenue",
  "Ikeja City Mall",
  "6.6018",
  "polyline_ab12",
  "₦9,999.99",
  "999999",
  "ride_req_secret",
] as const;

export const POLLUTION = {
  rider: { name: "Ada Obi", phone: "+2348031234567" },
  passengerName: "Ada Obi",
  riderPhone: "+2348031234567",
  pickupAddress: "12 Allen Avenue",
  dropoff: { address: "Ikeja City Mall", lat: 6.6018 },
  lat: 6.6018,
  route: "polyline_ab12",
  fare: { amountMinor: 999999, currency: "NGN" },
  driverNet: { amountMinor: 999999, currency: "NGN" },
  netEarnings: { amountMinor: 999999, currency: "NGN" },
  requestId: "ride_req_secret",
  safetyEvidence: "ride_req_secret",
} as const;

/** A deep copy with the pollution added to every object. */
export function polluted<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => polluted(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = { ...POLLUTION };
    for (const [key, inner] of Object.entries(value)) {
      out[key] = polluted(inner);
    }
    return out as T;
  }
  return value;
}
