/**
 * Row → response projections. Every fleet response is built here from named
 * fields (never by spreading a row), then parsed through its contract schema
 * on the way out (routes/respond.ts), which strips anything not declared —
 * so a rider, location, fare or driver-net field cannot reach a fleet even
 * if a future row or upstream grew one.
 */
import { isUuid } from "../lib/ids";
import { dateColumnToLocalDate, DAY_MS, iso } from "../lib/time";

import type {
  AssignmentTerms,
  FleetPolicy,
  FleetShift,
  FleetStaffRole,
  ProposalStatus,
  TermDiff,
} from "../contract";
import type { FleetTx } from "./types";
import type {
  Fleet,
  FleetAssignment,
  FleetAssignmentProposal,
  FleetMaintenanceBlock,
  Vehicle,
} from "@prisma/client/index";

export function fleetView(fleet: Fleet, myRole: FleetStaffRole) {
  return {
    fleetId: fleet.id,
    name: fleet.name,
    cityId: fleet.cityId,
    currency: fleet.currency,
    zone: fleet.zone,
    status: fleet.status as "active" | "suspended",
    myRole,
    createdAt: iso(fleet.createdAt.getTime()),
  };
}

interface TermsColumns {
  readonly termsType: string;
  readonly amountMinor: bigint | null;
  readonly currency: string;
  readonly percent: { toNumber(): number } | null;
  readonly shortfallPolicy: string;
  readonly shortfallMaxWeeks: number;
  readonly fuelBy: string;
  readonly servicingBy: string;
}

export function termsOf(row: TermsColumns): AssignmentTerms {
  return {
    type: row.termsType as AssignmentTerms["type"],
    amountMinor: row.amountMinor === null ? null : Number(row.amountMinor),
    currency: row.currency,
    percent: row.percent === null ? null : row.percent.toNumber(),
    shortfall: { policy: "carry_forward", maxWeeks: row.shortfallMaxWeeks },
    fuelBy: row.fuelBy as AssignmentTerms["fuelBy"],
    servicingBy: row.servicingBy as AssignmentTerms["servicingBy"],
  };
}

interface ShiftColumns {
  readonly shiftKind: string;
  readonly shiftStart: string;
  readonly shiftEnd: string;
}

export function shiftOf(row: ShiftColumns): FleetShift {
  return {
    kind: row.shiftKind as FleetShift["kind"],
    start: row.shiftStart,
    end: row.shiftEnd,
  };
}

export function validToOf(value: Date | null): string | null {
  return value === null ? null : dateColumnToLocalDate(value);
}

export function arrangementView(
  row: FleetAssignment,
  driverDisplayName: string,
) {
  return {
    assignmentId: row.id,
    fleetId: row.fleetId,
    vehicleId: row.vehicleId,
    driverId: row.driverId,
    driverDisplayName,
    shift: shiftOf(row),
    validFrom: dateColumnToLocalDate(row.validFrom),
    validTo: validToOf(row.validTo),
    termsVersion: row.termsVersion,
    terms: termsOf(row),
    signedAt: iso(row.signedAt.getTime()),
    status: row.status as "active" | "notice" | "ended" | "superseded",
  };
}

export function proposalView(
  row: FleetAssignmentProposal,
  driverDisplayName: string,
) {
  const check = (row.checkResult ?? {}) as {
    shiftOverlap?: boolean;
    withinCityCap?: boolean;
    cityCap?: { amountMinor: number; currency: string };
  };
  return {
    proposalId: row.id,
    fleetId: row.fleetId,
    vehicleId: row.vehicleId,
    driverId: row.driverId,
    driverDisplayName,
    shift: shiftOf(row),
    validFrom: dateColumnToLocalDate(row.validFrom),
    validTo: validToOf(row.validTo),
    termsVersion: row.termsVersion,
    terms: termsOf(row),
    diff: (row.diff ?? []) as TermDiff[],
    status: row.status as ProposalStatus,
    check: {
      shiftOverlap: check.shiftOverlap === true,
      withinCityCap: check.withinCityCap !== false,
      cityCap: check.cityCap ?? { amountMinor: 0, currency: row.currency },
    },
    proposedByRole: row.proposedByRole as "owner" | "manager",
    sentAt: row.sentAt === null ? null : iso(row.sentAt.getTime()),
    expiresAt: row.expiresAt === null ? null : iso(row.expiresAt.getTime()),
    respondedAt:
      row.respondedAt === null ? null : iso(row.respondedAt.getTime()),
  };
}

export function maintenanceView(row: FleetMaintenanceBlock) {
  return {
    blockId: row.id,
    fleetId: row.fleetId,
    vehicleId: row.vehicleId,
    kind: row.kind as
      | "planned_service"
      | "inspection"
      | "repair"
      | "unplanned_off_road",
    startsAt: iso(row.startsAt.getTime()),
    endsAt: row.endsAt === null ? null : iso(row.endsAt.getTime()),
    zone: row.zone,
    note: row.note,
    status: row.status as
      | "draft"
      | "checking"
      | "needs_resolution"
      | "scheduled"
      | "active"
      | "completed"
      | "cancelled",
    version: row.version,
    offRoadFlagged: row.offRoadFlaggedAt !== null,
    createdAt: iso(row.createdAt.getTime()),
  };
}

export type DocumentStatusView = {
  kind: "insurance" | "inspection";
  status: "valid" | "expiring" | "expired" | "missing";
  expiresAt: string | null;
  daysToExpiry: number | null;
};

/**
 * Vehicle documents as UBI holds them (vehicles.insurance_expiry /
 * inspection_expiry). A fleet cannot write these — UBI verifies documents —
 * so the status is status only.
 */
export function documentStatuses(
  vehicle: Pick<Vehicle, "insuranceExpiry" | "inspectionExpiry">,
  now: Date,
  policy: FleetPolicy,
): DocumentStatusView[] {
  const warnFrom = Math.max(...policy.documentWarningDays);
  const entries: [DocumentStatusView["kind"], Date | null][] = [
    ["insurance", vehicle.insuranceExpiry],
    ["inspection", vehicle.inspectionExpiry],
  ];
  return entries.map(([kind, expiry]) => {
    if (expiry === null) {
      return { kind, status: "missing", expiresAt: null, daysToExpiry: null };
    }
    const days = Math.floor((expiry.getTime() - now.getTime()) / DAY_MS);
    const status: DocumentStatusView["status"] =
      expiry.getTime() <= now.getTime()
        ? "expired"
        : days < warnFrom
          ? "expiring"
          : "valid";
    return {
      kind,
      status,
      expiresAt: iso(expiry.getTime()),
      daysToExpiry: days,
    };
  });
}

/** "Ada O." — enough for a fleet to know its driver, no more. */
export function shortName(firstName: string, lastName: string): string {
  const initial = lastName.trim().charAt(0);
  return initial.length > 0
    ? `${firstName.trim()} ${initial}.`
    : firstName.trim();
}

/** Driver (user) display names by user id; unknown ids answer "Driver". */
export async function displayNames(
  db: FleetTx,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id) => isUuid(id)))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const users = await db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true },
    });
    for (const user of users) {
      names.set(user.id, shortName(user.firstName, user.lastName));
    }
  }
  return names;
}

export function nameOr(names: Map<string, string>, id: string): string {
  return names.get(id) ?? "Driver";
}
