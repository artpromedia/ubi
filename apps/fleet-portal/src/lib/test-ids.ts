/**
 * testIDs for the fleet portal, rendered as `data-testid`.
 *
 * `FLEET_TEST_IDS` are the design handoff's strings VERBATIM
 * (docs/launch-readiness/handoff-fleet-calendar/README.md, "testIDs",
 * `<app>.<screen>.<element>`); `test-ids.test.ts` checks them against the
 * README so a rename on either side fails loudly. `FLEET_STATE_TEST_IDS` are
 * portal-local (the handoff names no ids for its honest states) and live
 * apart so they can never be mistaken for handoff ids.
 */
export const FLEET_TEST_IDS = {
  calendar: {
    vehicleRow: "fleet.calendar.vehicleRow",
    driverRow: "fleet.calendar.driverRow",
    block: "fleet.calendar.block",
    nowMarker: "fleet.calendar.nowMarker",
    zoomDay: "fleet.calendar.zoomDay",
    zoomWeek: "fleet.calendar.zoomWeek",
    weekCell: "fleet.calendar.weekCell",
    layerToggle: "fleet.calendar.layerToggle",
    filterConflicts: "fleet.calendar.filterConflicts",
    plateSearch: "fleet.calendar.plateSearch",
    agendaToggle: "fleet.calendar.agendaToggle",
  },
  vehicle: {
    documentsTimeline: "fleet.vehicle.documentsTimeline",
    maintenanceList: "fleet.vehicle.maintenanceList",
    weekMoney: "fleet.vehicle.weekMoney",
  },
  maintenance: {
    form: "fleet.maintenance.form",
    impactPreview: "fleet.maintenance.impactPreview",
    resolutionOption: "fleet.maintenance.resolutionOption",
    confirm: "fleet.maintenance.confirm",
  },
  offRoad: {
    report: "fleet.offRoad.report",
  },
  conflicts: {
    row: "fleet.conflicts.row",
    action: "fleet.conflicts.action",
  },
  assignment: {
    termsDiff: "fleet.assignment.termsDiff",
    proposeSubmit: "fleet.assignment.proposeSubmit",
    consentStatus: "fleet.assignment.consentStatus",
  },
  utilisation: {
    vehicleBar: "fleet.utilisation.vehicleBar",
  },
  staff: {
    roleMatrix: "fleet.staff.roleMatrix",
  },
} as const;

/** Every handoff fleet testID, flat. */
export const HANDOFF_FLEET_TEST_IDS: readonly string[] = Object.values(
  FLEET_TEST_IDS,
).flatMap((screen) => Object.values(screen));

/** Portal-local ids for the honest states every screen can show. */
export const FLEET_STATE_TEST_IDS = {
  loading: "fleet-portal.state.loading",
  empty: "fleet-portal.state.empty",
  stale: "fleet-portal.state.stale",
  access: (kind: string) => `fleet-portal.state.${kind}`,
} as const;
