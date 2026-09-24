/**
 * Text for every status the portal shows — status is never colour alone
 * (handoff Accessibility). Copy templates never assume a gender: they use
 * the driver's display name or "the driver" / "their" (decisions correction
 * 8). A driver's time off is only ever "Unavailable" (decisions Q9); a UBI
 * decision is "status only" with no reason (handoff rule 4).
 */
import { dateTimeIn, shortDate, localDateOf } from "./time";

import type {
  ConflictResolverRole,
  ConflictSeverity,
  ConflictStatus,
  DocumentStatusView,
  FleetConflictType,
  FleetShift,
  MaintenanceKind,
  MaintenanceStatus,
  ProposalStatus,
  UbiStatus,
  VehicleAvailabilityState,
} from "./fleet-types";

export const MAINTENANCE_KIND_LABELS: Readonly<
  Record<MaintenanceKind, string>
> = {
  planned_service: "Planned service",
  inspection: "Inspection",
  repair: "Repair",
  unplanned_off_road: "Off-road (breakdown)",
};

export const MAINTENANCE_STATUS_LABELS: Readonly<
  Record<MaintenanceStatus, string>
> = {
  draft: "Draft",
  checking: "Checking with UBI…",
  needs_resolution: "Needs resolution",
  scheduled: "Scheduled",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const STATUS_NOW_LABELS: Readonly<
  Record<VehicleAvailabilityState, string>
> = {
  in_service: "In service",
  maintenance: "In maintenance",
  doc_expired: "Document expired · enforced by UBI",
  held_by_ubi: "Held by UBI",
  unassigned: "Unassigned",
  documents_pending: "Documents pending with UBI",
};

const FLAG_LABELS: Readonly<Record<string, string>> = {
  conflict: "Conflict",
  doc_expiring: "Document expiring",
  doc_expired: "Document expired",
  documents_pending: "Documents pending",
  at_risk: "Booking at risk",
  off_road_flagged: "Off-road report flagged for UBI review",
  maintenance: "Maintenance",
};

export function flagLabel(flag: string): string {
  const known = FLAG_LABELS[flag];
  if (known !== undefined) {
    return known;
  }
  const words = flag.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function shiftName(shift: FleetShift): string {
  switch (shift.kind) {
    case "full":
      return "Full shift";
    case "day":
      return `Day shift ${shift.start}–${shift.end}`;
    case "night":
      return `Night shift ${shift.start}–${shift.end}`;
    default:
      return `Shift ${shift.start}–${shift.end}`;
  }
}

/** The server's day-summary shift strings ("day 06:00–18:00") as display text. */
export function shiftSummaryLabel(summary: string): string {
  if (summary === "full day") {
    return "Full";
  }
  const [kind, ...rest] = summary.split(" ");
  const word = kind === "custom" ? "Shift" : (kind ?? "");
  return [word.charAt(0).toUpperCase() + word.slice(1), ...rest].join(" ");
}

const DOC_KIND: Readonly<Record<DocumentStatusView["kind"], string>> = {
  insurance: "Insurance",
  inspection: "Inspection",
};

/** "Insurance expiring · 15 Oct", "Inspection expired 1 Oct · enforced by UBI". */
export function documentLabel(doc: DocumentStatusView, zone: string): string {
  const kind = DOC_KIND[doc.kind];
  const date =
    doc.expiresAt === null
      ? null
      : shortDate(localDateOf(new Date(doc.expiresAt).getTime(), zone));
  switch (doc.status) {
    case "valid":
      return date === null ? `${kind} valid` : `${kind} valid · to ${date}`;
    case "expiring":
      return date === null ? `${kind} expiring` : `${kind} expiring · ${date}`;
    case "expired":
      return date === null
        ? `${kind} expired · enforced by UBI`
        : `${kind} expired ${date} · enforced by UBI`;
    default:
      return `${kind} missing · pending with UBI`;
  }
}

const UBI_STATUS_LABELS: Readonly<Record<UbiStatus["status"], string>> = {
  held_by_ubi: "Held by UBI",
  suspended: "Suspended by UBI",
  doc_expired: "Document expired",
};

/** "Held by UBI · status only · decided by UBI" — never a reason. */
export const ubiStatusLabel = (status: UbiStatus["status"]): string =>
  `${UBI_STATUS_LABELS[status]} · status only · decided by UBI`;

export const SEVERITY_LABELS: Readonly<Record<ConflictSeverity, string>> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  blocked: "Blocked",
  status: "Status",
};

export const CONFLICT_STATUS_LABELS: Readonly<Record<ConflictStatus, string>> =
  {
    open: "Open",
    resolving: "Resolving",
    resolved: "Resolved",
    lapsed: "Lapsed",
  };

/** B6 titles. A driver-owned conflict is only ever "Driver resolving". */
export const CONFLICT_TITLES: Readonly<Record<FleetConflictType, string>> = {
  maintenance_overlaps_booking: "Maintenance overlaps a confirmed booking",
  unplanned_off_road: "Vehicle off-road: booking at risk",
  document_expiring: "Vehicle document expiring",
  document_expires_in_booking: "Document expires before a booking",
  driver_resolving: "Driver resolving a booking",
  termination_bookings: "Notice period ends before a booking",
};

const RESOLVER_LABELS: Readonly<Record<ConflictResolverRole, string>> = {
  fleet: "Fleet",
  driver: "driver",
  rider: "rider",
  ubi: "UBI",
};

/** "Fleet → driver → rider" in the server's order. */
export function resolverLabel(roles: readonly ConflictResolverRole[]): string {
  if (roles.length === 0) {
    return "—";
  }
  const text = roles.map((role) => RESOLVER_LABELS[role]).join(" → ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const PROPOSAL_STATUS_LABELS: Readonly<Record<ProposalStatus, string>> =
  {
    draft: "Draft",
    checking: "Checking with UBI…",
    sent: "Sent",
    pending_signature: "Waiting for signature",
    signed: "Signed",
    declined: "Declined",
    expired: "Expired",
    withdrawn: "Withdrawn",
    superseded: "Superseded",
  };

/** "30 Sep 09:20 WAT"-style deadline text, or null. */
export const deadlineText = (
  iso: string | null,
  zone: string,
): string | null => (iso === null ? null : dateTimeIn(iso, zone));

/** A swap/ineligibility reason code from the server as words. */
export function reasonLabel(reason: string): string {
  const known: Readonly<Record<string, string>> = {
    same_vehicle: "it is the same vehicle",
    class_not_eligible: "its class doesn't cover the booking",
    capacity_too_small: "it has fewer seats",
    documents_expired: "a document isn't valid through the booking",
    vehicle_off_road: "it is off-road",
    vehicle_occupied: "it is already booked or in maintenance then",
    vehicle_unknown: "the booking's vehicle isn't known",
    different_fleet: "the booking's vehicle is in another fleet",
  };
  return known[reason] ?? reason.replace(/_/g, " ");
}
