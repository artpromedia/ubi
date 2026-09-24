/**
 * The portal's mirrors of the fleet contract, checked against the REAL
 * contract module (packages/contracts/src/fleet.ts, read-only here): every
 * fixture parses with the response schema fleet-service answers with, and
 * the privacy patterns and role matrix the portal uses are the contract's.
 */
import { describe, expect, it } from "vitest";

import {
  ConflictListSchema,
  FLEET_CAPABILITIES as CONTRACT_CAPABILITIES,
  FLEET_FORBIDDEN_FIELD_PATTERNS as CONTRACT_PATTERNS,
  FleetAssignmentsSchema,
  FleetCalendarSchema,
  FleetOverviewSchema,
  FleetStaffListSchema,
  FleetVehicleViewSchema,
  FleetViewSchema,
  MaintenanceListSchema,
  MaintenancePreviewViewSchema,
  UtilisationSchema,
} from "../../../../../packages/contracts/src/fleet";
import { FLEET_FORBIDDEN_FIELD_PATTERNS } from "../privacy";
import { FLEET_CAPABILITIES } from "../roles";
import * as fx from "./fixtures";

describe("fixtures match the fleet-service contract", () => {
  it.each([
    ["FleetView (owner)", FleetViewSchema, fx.fleetAs("owner")],
    ["FleetCalendar (day, vehicles)", FleetCalendarSchema, fx.dayCalendar],
    ["FleetCalendar (day, drivers)", FleetCalendarSchema, fx.driverCalendar],
    ["FleetCalendar (week)", FleetCalendarSchema, fx.weekCalendar],
    [
      "FleetCalendar (vehicle availability)",
      FleetCalendarSchema,
      fx.vehicleAvailability,
    ],
    ["ConflictList", ConflictListSchema, fx.conflicts],
    [
      "MaintenancePreviewView (infeasible)",
      MaintenancePreviewViewSchema,
      fx.infeasiblePreview,
    ],
    [
      "MaintenancePreviewView (feasible)",
      MaintenancePreviewViewSchema,
      fx.feasiblePreview,
    ],
    ["FleetVehicleView", FleetVehicleViewSchema, fx.vehicleView],
    ["MaintenanceList", MaintenanceListSchema, fx.maintenanceList],
    ["FleetAssignments", FleetAssignmentsSchema, fx.assignments],
    ["Utilisation", UtilisationSchema, fx.utilisation],
    ["FleetStaffList", FleetStaffListSchema, fx.staff],
    ["FleetOverview", FleetOverviewSchema, fx.overview],
  ] as const)("%s parses", (_name, schema, value) => {
    const parsed = (
      schema as {
        safeParse: (v: unknown) => { success: boolean; error?: unknown };
      }
    ).safeParse(value);
    expect(parsed.error).toBeUndefined();
    expect(parsed.success).toBe(true);
  });
});

describe("mirrors of the contract", () => {
  it("uses exactly the contract's forbidden field patterns", () => {
    expect(FLEET_FORBIDDEN_FIELD_PATTERNS.map(String)).toEqual(
      CONTRACT_PATTERNS.map(String),
    );
  });

  it("uses exactly the contract's role matrix", () => {
    expect(FLEET_CAPABILITIES).toEqual(CONTRACT_CAPABILITIES);
  });
});
