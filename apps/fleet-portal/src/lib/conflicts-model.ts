/**
 * The conflict centre (B6) as pure data.
 *
 * ACTIONS COME ONLY FROM THE SERVER. Each row offers exactly the actions in
 * the conflict's `allowedActions` (computed by fleet-service for the
 * caller's role, services/fleet-service/src/ops/conflicts.ts) — the portal
 * never infers one from the conflict type, its role or its status. An empty
 * list is "View only" (a driver's or UBI's conflict: the fleet can look,
 * never resolve it for them). Each allowed action maps to the ONE route that
 * performs it; one the portal has no route for yet is shown, disabled, with
 * the reason — never silently dropped and never faked.
 */
import {
  CONFLICT_STATUS_LABELS,
  CONFLICT_TITLES,
  SEVERITY_LABELS,
  resolverLabel,
} from "./labels";
import { dateTimeIn, zoneShort } from "./time";

import type { ConflictView, FleetConflictAction } from "./fleet-types";

export type ActionPlan =
  | {
      readonly action: FleetConflictAction;
      readonly label: string;
      readonly kind: "remind";
      readonly conflictId: string;
    }
  | {
      readonly action: FleetConflictAction;
      readonly label: string;
      readonly kind: "swap";
      readonly bookingBlockId: string;
      readonly fromVehicleId: string | null;
    }
  | {
      readonly action: FleetConflictAction;
      readonly label: string;
      readonly kind: "maintenance";
      readonly href: string;
    }
  | {
      readonly action: FleetConflictAction;
      readonly label: string;
      readonly kind: "unavailable";
      readonly reason: string;
    };

export const ACTION_LABELS: Readonly<Record<FleetConflictAction, string>> = {
  move_block: "Move the block",
  cancel_block: "Cancel the block",
  complete_block: "Vehicle back in service",
  propose_vehicle_swap: "Propose a vehicle swap",
  ask_driver: "Ask the driver to review",
  remind: "Send a reminder",
  renew_document: "Upload renewal",
};

/** The route that performs one allowed action on one conflict. */
export function planAction(
  conflict: ConflictView,
  action: FleetConflictAction,
): ActionPlan {
  const subject = conflict.subjects[0];
  const label = ACTION_LABELS[action];
  switch (action) {
    case "ask_driver":
    case "remind":
      return { action, label, kind: "remind", conflictId: conflict.conflictId };
    case "propose_vehicle_swap":
      return subject?.blockId
        ? {
            action,
            label,
            kind: "swap",
            bookingBlockId: subject.blockId,
            fromVehicleId: subject.vehicleId,
          }
        : {
            action,
            label,
            kind: "unavailable",
            reason: "No booking is linked to this conflict.",
          };
    case "move_block":
    case "cancel_block":
    case "complete_block":
      // The maintenance block is managed from its vehicle's maintenance list
      // (the editor re-previews a move with the server before it applies).
      return subject?.vehicleId
        ? {
            action,
            label,
            kind: "maintenance",
            href: `/vehicles/${encodeURIComponent(subject.vehicleId)}#maintenance`,
          }
        : {
            action,
            label,
            kind: "unavailable",
            reason: "No vehicle is linked to this conflict.",
          };
    default:
      return {
        action,
        label,
        kind: "unavailable",
        reason:
          "Document upload isn't available in the portal yet. UBI verifies renewals; the warning clears when the new expiry is on file.",
      };
  }
}

export interface ConflictRowModel {
  readonly conflictId: string;
  readonly severity: string;
  readonly severityKey: ConflictView["severity"];
  readonly title: string;
  readonly subject: string;
  readonly resolver: string;
  readonly deadline: string;
  readonly status: string;
  /** Exactly the server's allowedActions, in its order. */
  readonly actions: readonly ActionPlan[];
  /** Shown when there is no action: "View only" or "No action". */
  readonly noActionText: string | null;
}

export interface ConflictNames {
  readonly plates?: ReadonlyMap<string, string>;
  readonly drivers?: ReadonlyMap<string, string>;
}

const noActionText = (ubiOnly: boolean): string =>
  ubiOnly ? "No action" : "View only";

export function conflictRow(
  conflict: ConflictView,
  zone: string,
  names: ConflictNames = {},
): ConflictRowModel {
  const subject = conflict.subjects[0];
  const plate =
    subject?.vehicleId === null || subject?.vehicleId === undefined
      ? null
      : (names.plates?.get(subject.vehicleId) ?? "Vehicle");
  const driver =
    subject?.driverId === null || subject?.driverId === undefined
      ? null
      : (names.drivers?.get(subject.driverId) ?? "Driver");
  const parts = [plate, driver, subject?.blockId ? "1 booking" : null].filter(
    (part): part is string => part !== null,
  );
  const driverOwned = conflict.type === "driver_resolving";
  const ubiOnly =
    conflict.severity === "status" ||
    conflict.resolverRoles.every((role) => role === "ubi");
  const actions = conflict.allowedActions.map((action) =>
    planAction(conflict, action),
  );
  return {
    conflictId: conflict.conflictId,
    severity: SEVERITY_LABELS[conflict.severity],
    severityKey: conflict.severity,
    title: CONFLICT_TITLES[conflict.type],
    subject: parts.length > 0 ? parts.join(" · ") : "—",
    resolver: driverOwned
      ? "Driver (resolving)"
      : resolverLabel(conflict.resolverRoles),
    deadline:
      conflict.deadlineAt === null
        ? "—"
        : `${dateTimeIn(conflict.deadlineAt, zone)} ${zoneShort(zone, new Date(conflict.deadlineAt).getTime())}`,
    status: CONFLICT_STATUS_LABELS[conflict.status],
    actions,
    noActionText: actions.length > 0 ? null : noActionText(ubiOnly),
  };
}

/** "5 open · 1 status only · sorted by deadline". */
export function conflictSummary(conflicts: readonly ConflictView[]): string {
  const live = conflicts.filter(
    (c) => c.status === "open" || c.status === "resolving",
  );
  const statusOnly = live.filter((c) => c.severity === "status").length;
  return `${live.length - statusOnly} open · ${statusOnly} status only · sorted by deadline`;
}
