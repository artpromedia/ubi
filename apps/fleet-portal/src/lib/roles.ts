/**
 * The fleet role matrix (handoff B9; decisions correction 5) — a mirror of
 * FLEET_CAPABILITIES in packages/contracts/src/fleet.ts.
 *
 * The portal uses it for ONE thing: hiding controls a role cannot use
 * ("Permission denied hides the controls" — hidden, not just disabled).
 * Authority is fleet-service's: every write re-checks the caller's staff
 * role on the signed identity and answers `forbidden` (shown with the copy
 * below) whatever the portal rendered. Conflict actions are never derived
 * from this table — they come only from the server's `allowedActions`.
 */
import type { FleetCapability, FleetStaffRole } from "./fleet-types";

export const FLEET_CAPABILITIES: Readonly<
  Record<FleetCapability, readonly FleetStaffRole[]>
> = {
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
};

export const can = (
  role: FleetStaffRole | null | undefined,
  capability: FleetCapability,
): boolean =>
  role !== null &&
  role !== undefined &&
  FLEET_CAPABILITIES[capability].includes(role);

export const ROLE_LABELS: Readonly<Record<FleetStaffRole, string>> = {
  owner: "Owner",
  manager: "Manager",
  read_only: "Read-only",
};

export type MatrixCell = "Yes" | "No" | "Never";

export interface RoleMatrixRow {
  readonly capability: string;
  readonly cells: Readonly<Record<FleetStaffRole, MatrixCell>>;
}

function cell(
  granted: readonly FleetStaffRole[] | "never",
  role: FleetStaffRole,
): MatrixCell {
  if (granted === "never") {
    return "Never";
  }
  return granted.includes(role) ? "Yes" : "No";
}

const row = (
  capability: string,
  granted: readonly FleetStaffRole[] | "never",
): RoleMatrixRow => ({
  capability,
  cells: {
    owner: cell(granted, "owner"),
    manager: cell(granted, "manager"),
    read_only: cell(granted, "read_only"),
  },
});

/** B9's matrix, rows in the handoff's order, derived from the capabilities. */
export const ROLE_MATRIX: readonly RoleMatrixRow[] = [
  row("View calendar and utilisation", FLEET_CAPABILITIES.view_calendar),
  row(
    "Create or edit maintenance; report off-road",
    FLEET_CAPABILITIES.manage_maintenance,
  ),
  row("Propose assignments and shifts", FLEET_CAPABILITIES.propose_assignment),
  row("Propose remittance terms", FLEET_CAPABILITIES.propose_terms),
  row(
    "Add vehicles; upload vehicle documents",
    FLEET_CAPABILITIES.manage_vehicles,
  ),
  row("Terminate an arrangement", FLEET_CAPABILITIES.terminate_arrangement),
  row("Manage staff", FLEET_CAPABILITIES.manage_staff),
  row("See rider identity, routes or safety evidence", "never"),
];

/** The permission copy for a capability a role lacks (handoff copy deck). */
export function permissionCopy(capability: FleetCapability): string {
  switch (capability) {
    case "manage_maintenance":
    case "report_off_road":
      return "Your role can view the calendar but can't create maintenance. Ask a fleet owner or manager.";
    case "propose_assignment":
      return "Your role can view assignments but can't propose them. Ask a fleet owner or manager.";
    case "propose_terms":
      return "New remittance terms are proposed by a fleet owner. Managers propose shift and vehicle changes under the driver's signed terms.";
    case "manage_vehicles":
      return "Your role can view vehicles but can't add them. Ask a fleet owner or manager.";
    case "terminate_arrangement":
      return "Only a fleet owner can give notice on an arrangement.";
    case "manage_staff":
      return "Your role can view staff but can't change roles. Ask a fleet owner.";
    case "request_vehicle_swap":
    case "remind_driver":
      return "Your role can view conflicts but can't act on them. Ask a fleet owner or manager.";
    default:
      return "Your role can view but not edit. Ask a fleet owner.";
  }
}
