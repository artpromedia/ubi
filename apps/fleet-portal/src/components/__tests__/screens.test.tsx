/**
 * Every fleet screen (B1–B9), rendered with react-dom/server in each of its
 * states: loading, empty, error, offline/stale (with the last-updated
 * time), flag off, permission (role) — plus privacy (nothing of a polluted
 * response renders), allowedActions-only buttons and Confirm gating.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  assignments,
  conflicts,
  dayCalendar,
  driverCalendar,
  feasiblePreview,
  fleetAs,
  FORBIDDEN_VALUES,
  infeasiblePreview,
  maintenanceList,
  NOW,
  overview,
  polluted,
  staff,
  utilisation,
  VEH,
  vehicleAvailability,
  vehicleView,
  weekCalendar,
} from "@/lib/__tests__/fixtures";
import { classifyError, FLAG_OFF_COPY, type ReadState } from "@/lib/access";
import { ApiError } from "@/lib/api-client";
import { defaultControls } from "@/lib/calendar-controls";
import { FLEET_STATE_TEST_IDS, FLEET_TEST_IDS } from "@/lib/test-ids";

import { AssignmentsView } from "../assignments/Assignments";
import {
  CalendarBoard,
  type CalendarBoardProps,
} from "../calendar/CalendarBoard";
import { ConflictCentreView } from "../conflicts/ConflictCentre";
import { FleetGateView } from "../fleet/fleet-context";
import {
  MaintenanceEditorView,
  type MaintenanceEditorViewProps,
} from "../maintenance/MaintenanceEditor";
import { OffRoadPanel } from "../maintenance/OffRoadPanel";
import { OverviewView } from "../overview/Overview";
import { StaffRolesView } from "../staff/StaffRoles";
import { UtilisationView } from "../utilisation/Utilisation";
import { VehicleDetailView, WeekMoneyPanel } from "../vehicle/VehicleDetail";
import { VehiclesListView } from "../vehicle/VehiclesList";

import type { FleetVehicleList, FleetView } from "@/lib/fleet-types";
import type { MaintenanceForm } from "@/lib/maintenance-model";
import type { ReactElement } from "react";

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const count = (markup: string, testId: string): number =>
  markup.split(`data-testid="${testId}"`).length - 1;
const tagOf = (markup: string, testId: string): string =>
  new RegExp(`<[^>]*data-testid="${testId.replace(/\./g, "\\.")}"[^>]*>`).exec(
    markup,
  )?.[0] ?? "";
/** True when an opening tag carries the `disabled` attribute (not a `disabled:` class). */
const isDisabled = (tag: string): boolean => /\sdisabled(=""|\s|>)/.test(tag);
/** Visible text, entities decoded (for copy assertions). */
const text = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const ready = <T,>(
  data: T,
  stale: ReadState<T> extends { stale: infer S } ? S : never = null as never,
): ReadState<T> => ({
  kind: "ready",
  data,
  updatedAt: NOW,
  stale,
});
const failed = <T,>(error: unknown, online = true): ReadState<T> => ({
  kind: "failed",
  access: classifyError(error, online),
});
const flagOff = <T,>(): ReadState<T> =>
  failed(new ApiError(404, "feature_disabled", "fleet is not enabled"));
const loading = <T,>(): ReadState<T> => ({ kind: "loading" });
const offlineStale = <T,>(data: T): ReadState<T> => ({
  kind: "ready",
  data,
  updatedAt: NOW,
  stale: classifyError(null, false),
});

const expectNoForbidden = (markup: string): void => {
  for (const value of FORBIDDEN_VALUES) {
    expect(markup).not.toContain(value);
  }
};

const owner = fleetAs("owner");
const manager = fleetAs("manager");
const readOnly = fleetAs("read_only");
const vehicles = [
  vehicleView,
  { ...vehicleView, vehicleId: VEH.mm, plate: "LAG-744-MM" },
];

describe("FleetGate — the portal-wide state", () => {
  it("shows loading, flag off, no fleet, or the screens", () => {
    expect(
      text(
        html(
          <FleetGateView state={loading()} fleet={null}>
            child
          </FleetGateView>,
        ),
      ),
    ).toContain("Loading your fleet…");
    const off = html(
      <FleetGateView state={flagOff()} fleet={null}>
        SECRET-CHILD
      </FleetGateView>,
    );
    expect(text(off)).toContain(FLAG_OFF_COPY);
    expect(off).toContain(
      `data-testid="${FLEET_STATE_TEST_IDS.access("flag_off")}"`,
    );
    expect(off).not.toContain("SECRET-CHILD");
    const none = html(
      <FleetGateView state={ready({ fleets: [] })} fleet={null}>
        SECRET-CHILD
      </FleetGateView>,
    );
    expect(text(none)).toContain(
      "No fleet is linked to your UBI account in this city.",
    );
    expect(none).not.toContain("SECRET-CHILD");
    expect(
      html(
        <FleetGateView state={ready({ fleets: [owner] })} fleet={owner}>
          SCREEN
        </FleetGateView>,
      ),
    ).toContain("SCREEN");
    expect(
      text(
        html(
          <FleetGateView
            state={failed(new ApiError(401, "unauthorized", "x"))}
            fleet={null}
          >
            x
          </FleetGateView>,
        ),
      ),
    ).toContain("Signed out");
  });
});

describe("B1–B3 CalendarBoard", () => {
  const props = (
    overrides: Partial<CalendarBoardProps> = {},
  ): CalendarBoardProps => ({
    fleet: owner,
    state: ready(dayCalendar),
    controls: defaultControls("2026-09-30"),
    onControls: () => undefined,
    now: NOW,
    online: true,
    today: "2026-09-30",
    onLoadMore: () => undefined,
    ...overrides,
  });

  it("renders the day timeline: vehicle rows, blocks, now marker, zone label, toolbar", () => {
    const markup = html(<CalendarBoard {...props()} />);
    const shown = text(markup);
    expect(count(markup, FLEET_TEST_IDS.calendar.vehicleRow)).toBe(4);
    expect(count(markup, FLEET_TEST_IDS.calendar.block)).toBeGreaterThanOrEqual(
      5,
    );
    expect(count(markup, FLEET_TEST_IDS.calendar.nowMarker)).toBe(1);
    expect(shown).toContain("Now 09:42");
    expect(shown).toContain("Africa/Lagos · WAT (UTC+1)");
    expect(shown).toContain("Booked · 07:15–09:40");
    expect(shown).toContain("At risk · Booked · 11:20–13:00");
    expect(shown).toContain("Document expired · status only · decided by UBI");
    expect(shown).toContain("Showing 1–4 of 212 vehicles");
    expect(shown).toContain("Load the next 40");
    expect(shown).toContain("Feasibility from server · updated 09:42 WAT");
    expect(shown).toContain("+1 outside 06:00–22:00 (see agenda)");
    for (const id of [
      FLEET_TEST_IDS.calendar.zoomDay,
      FLEET_TEST_IDS.calendar.zoomWeek,
      FLEET_TEST_IDS.calendar.filterConflicts,
      FLEET_TEST_IDS.calendar.plateSearch,
      FLEET_TEST_IDS.calendar.agendaToggle,
    ]) {
      expect(count(markup, id)).toBe(1);
    }
    expect(count(markup, FLEET_TEST_IDS.calendar.layerToggle)).toBe(4);
    expect(markup).toContain('role="grid"');
    expect(markup).toContain(
      'aria-label="LAG-118-AB, Booked, 11:20 to 13:00 West Africa Time, at risk · needs a decision by 30 Sep 09:20"',
    );
    expect(shown).toContain("Maintenance block");
  });

  it("hides create controls from read-only staff and says who can", () => {
    const markup = html(<CalendarBoard {...props({ fleet: readOnly })} />);
    expect(markup).not.toContain('href="/maintenance/new"');
    expect(text(markup)).toContain(
      "Your role can view the calendar but can't create maintenance. Ask a fleet owner or manager.",
    );
  });

  it("renders driver rows with availability read-only and time off only as Unavailable", () => {
    const markup = html(
      <CalendarBoard
        {...props({
          state: ready(driverCalendar),
          controls: { ...defaultControls("2026-09-30"), rows: "drivers" },
        })}
      />,
    );
    expect(count(markup, FLEET_TEST_IDS.calendar.driverRow)).toBe(1);
    expect(text(markup)).toContain("Unavailable · set by driver");
    expect(text(markup)).toContain("8 h signed shift · 1 booked");
    expect(markup).not.toMatch(/time off/i);
  });

  it("renders the week with per-day cells and the month boundary", () => {
    const markup = html(
      <CalendarBoard
        {...props({
          state: ready(weekCalendar),
          controls: { ...defaultControls("2026-09-30"), zoom: "week" },
        })}
      />,
    );
    expect(count(markup, FLEET_TEST_IDS.calendar.weekCell)).toBe(14);
    expect(text(markup)).toContain("Oct · new month");
    expect(text(markup)).toContain("28 Sep – 4 Oct 2026");
    expect(count(markup, FLEET_TEST_IDS.calendar.vehicleRow)).toBe(0);
  });

  it("renders the agenda / table equivalent", () => {
    const markup = html(
      <CalendarBoard
        {...props({
          controls: { ...defaultControls("2026-09-30"), agenda: true },
        })}
      />,
    );
    expect(text(markup)).toContain(
      "Agenda · times in Africa/Lagos · WAT (UTC+1)",
    );
    expect(markup).toContain('aria-sort="ascending"');
    expect(text(markup)).toContain("30 Sep 22:30");
    expect(count(markup, FLEET_TEST_IDS.calendar.block)).toBe(0);
  });

  it("renders loading, empty, filtered-empty, error, offline-stale and flag-off states", () => {
    expect(
      text(html(<CalendarBoard {...props({ state: loading() })} />)),
    ).toContain("Loading calendar…");
    const empty = { ...dayCalendar, rows: [], totalRows: 0, nextCursor: null };
    expect(
      text(html(<CalendarBoard {...props({ state: ready(empty) })} />)),
    ).toContain("No vehicles yet. Add a vehicle to start planning.");
    expect(
      text(
        html(
          <CalendarBoard
            {...props({
              state: ready(empty),
              controls: { ...defaultControls("2026-09-30"), q: "ZZZ" },
            })}
          />,
        ),
      ),
    ).toContain("No vehicles match these filters.");
    const error = html(
      <CalendarBoard
        {...props({
          state: failed(new ApiError(500, "internal_error", "boom")),
          onRetry: () => undefined,
        })}
      />,
    );
    expect(text(error)).toContain("Something went wrong");
    expect(text(error)).toContain("Try again");
    const unavailable = html(
      <CalendarBoard
        {...props({
          state: failed(new ApiError(503, "service_unavailable", "x")),
        })}
      />,
    );
    expect(text(unavailable)).toContain("so nothing is shown as free");
    const stale = html(
      <CalendarBoard
        {...props({ state: offlineStale(dayCalendar), online: false })}
      />,
    );
    expect(text(stale)).toContain("Offline · showing data from 09:42 WAT");
    expect(count(stale, FLEET_TEST_IDS.calendar.vehicleRow)).toBe(4);
    expect(stale).not.toContain('href="/maintenance/new"');
    const off = html(<CalendarBoard {...props({ state: flagOff() })} />);
    expect(text(off)).toContain(FLAG_OFF_COPY);
    expect(count(off, FLEET_TEST_IDS.calendar.vehicleRow)).toBe(0);
    expect(count(off, FLEET_TEST_IDS.calendar.block)).toBe(0);
  });

  it("renders nothing of a polluted response (rider, location, fare, driver net)", () => {
    const markup = html(
      <CalendarBoard {...props({ state: ready(polluted(dayCalendar)) })} />,
    );
    expect(count(markup, FLEET_TEST_IDS.calendar.vehicleRow)).toBe(4);
    expectNoForbidden(markup);
    const drivers = html(
      <CalendarBoard
        {...props({
          state: ready(polluted(driverCalendar)),
          controls: { ...defaultControls("2026-09-30"), rows: "drivers" },
        })}
      />,
    );
    expectNoForbidden(drivers);
    const agenda = html(
      <CalendarBoard
        {...props({
          state: ready(polluted(dayCalendar)),
          controls: { ...defaultControls("2026-09-30"), agenda: true },
        })}
      />,
    );
    expectNoForbidden(agenda);
  });
});

describe("B6 ConflictCentreView — actions only from allowedActions", () => {
  const view = (fleet: FleetView, state: ReadState<typeof conflicts>) =>
    html(
      <ConflictCentreView
        fleet={fleet}
        state={state}
        status="open"
        onStatus={() => undefined}
        names={{ plates: new Map([[VEH.ab, "LAG-118-AB"]]) }}
        vehicles={vehicles}
        online
      />,
    );

  it("renders a button for exactly each allowed action, and none otherwise", () => {
    const markup = view(owner, ready(conflicts));
    expect(count(markup, FLEET_TEST_IDS.conflicts.row)).toBe(4);
    const actions = [
      ...markup.matchAll(
        /data-testid="fleet\.conflicts\.action" data-action="([a-z_]+)"/g,
      ),
    ].map((match) => match[1]);
    expect(actions).toEqual([
      "move_block",
      "cancel_block",
      "propose_vehicle_swap",
      "ask_driver",
      "renew_document",
    ]);
    const shown = text(markup);
    expect(shown).toContain("View only");
    expect(shown).toContain("No action");
    expect(shown).toContain("Driver resolving a booking");
    expect(shown).toContain("3 open · 1 status only · sorted by deadline");
    expect(shown).toContain("30 Sep 09:20 WAT");
    expect(markup).not.toMatch(/time off/i);
  });

  it("never infers an action the server did not allow", () => {
    const onlyRemind = {
      conflicts: [
        {
          ...(conflicts.conflicts[0] as (typeof conflicts.conflicts)[number]),
          allowedActions: ["remind" as const],
        },
      ],
    };
    const markup = view(owner, ready(onlyRemind));
    const actions = [...markup.matchAll(/data-action="([a-z_]+)"/g)].map(
      (match) => match[1],
    );
    expect(actions).toEqual(["remind"]);
    const readOnlyView = view(
      readOnly,
      ready({
        conflicts: conflicts.conflicts.map((conflict) => ({
          ...conflict,
          allowedActions: [],
        })),
      }),
    );
    expect(count(readOnlyView, FLEET_TEST_IDS.conflicts.action)).toBe(0);
    expect(text(readOnlyView)).toContain("View only");
  });

  it("renders loading, empty, flag-off and polluted states honestly", () => {
    expect(text(view(owner, loading()))).toContain("Loading conflicts…");
    expect(text(view(owner, ready({ conflicts: [] })))).toContain(
      "No open conflicts.",
    );
    const off = view(owner, flagOff());
    expect(text(off)).toContain(FLAG_OFF_COPY);
    expect(count(off, FLEET_TEST_IDS.conflicts.row)).toBe(0);
    expectNoForbidden(view(owner, ready(polluted(conflicts))));
  });
});

describe("B4 VehicleDetailView", () => {
  const view = (
    fleet: FleetView,
    overrides: Partial<Parameters<typeof VehicleDetailView>[0]> = {},
  ) =>
    html(
      <VehicleDetailView
        fleet={fleet}
        vehicle={ready(vehicleView)}
        availability={ready(vehicleAvailability)}
        maintenance={ready(maintenanceList)}
        arrangements={assignments.arrangements}
        conflicts={conflicts.conflicts}
        now={NOW}
        online
        {...overrides}
      />,
    );

  it("shows documents against commitments, maintenance, drivers with terms and the week's money lines", () => {
    const markup = view(owner);
    const shown = text(markup);
    for (const id of [
      FLEET_TEST_IDS.vehicle.documentsTimeline,
      FLEET_TEST_IDS.vehicle.maintenanceList,
      FLEET_TEST_IDS.vehicle.weekMoney,
    ]) {
      expect(count(markup, id)).toBe(1);
    }
    expect(shown).toContain("LAG-118-AB");
    expect(shown).toContain("Toyota Camry 2020 · Silver · comfort · 4 seats");
    expect(shown).toContain("Insurance expiring · 15 Oct");
    expect(shown).toContain("Booked · 30 Sep 11:20–13:00 · At risk");
    expect(shown).toContain(
      "Enforcement By UBI Status only. There is no override.",
    );
    expect(shown).toContain("Planned service");
    expect(shown).toContain("Needs resolution");
    expect(shown).toContain("Repair");
    expect(shown).toContain("Bola A. · Day shift 06:00–18:00");
    expect(shown).toContain("Terms v1 · ₦45,000.00 / week (weekly fixed)");
    expect(shown).toContain("2 conflicts");
    expect(shown).toContain("2 Oct 00:00–24:00");
    expect(shown.match(/Not available yet/g)).toHaveLength(4);
    expect(shown).toContain("Fleets don't see a driver's net earnings.");
    expect(shown).toContain("Add maintenance");
    expect(shown).toContain("Resolve →");
    expect(shown).toContain("Cancel block");
  });

  it("hides every control from read-only staff", () => {
    const shown = text(view(readOnly));
    expect(shown).not.toContain("Add maintenance");
    expect(shown).not.toContain("Resolve →");
    expect(shown).not.toContain("Cancel block");
    expect(shown).not.toContain("Propose an assignment →");
    expect(shown).toContain(
      "Your role can view the calendar but can't create maintenance.",
    );
  });

  it("never renders a driver's net or rider data, whatever the response carries", () => {
    expectNoForbidden(
      view(owner, {
        vehicle: ready(polluted(vehicleView)),
        availability: ready(polluted(vehicleAvailability)),
        maintenance: ready(polluted(maintenanceList)),
      }),
    );
    const panel = html(
      <WeekMoneyPanel
        money={{
          available: true,
          weekGross: { amountMinor: 18_450_000, currency: "NGN" },
          ubiCommission: { amountMinor: 1_845_000, currency: "NGN" },
          fleetRemittance: { amountMinor: 4_500_000, currency: "NGN" },
          remittanceStatus: "Covered",
          ...(POLLUTED_NET as object),
        }}
      />,
    );
    expect(text(panel)).toContain("Week gross ₦184,500.00");
    expect(text(panel)).toContain("UBI commission ₦18,450.00");
    expect(text(panel)).toContain("Fleet remittance ₦45,000.00");
    expect(text(panel)).toContain("Remittance status Covered");
    expectNoForbidden(panel);
  });

  it("renders loading, not-found and flag-off states", () => {
    expect(text(view(owner, { vehicle: loading() }))).toContain(
      "Loading vehicle…",
    );
    expect(
      text(
        view(owner, {
          vehicle: failed(new ApiError(404, "not_found", "vehicle not found")),
        }),
      ),
    ).toContain("Not found");
    const off = view(owner, { vehicle: flagOff() });
    expect(text(off)).toContain(FLAG_OFF_COPY);
    expect(count(off, FLEET_TEST_IDS.vehicle.weekMoney)).toBe(0);
    expect(
      text(view(owner, { availability: offlineStale(vehicleAvailability) })),
    ).toContain("Offline · showing data from 09:42 WAT");
  });
});

const POLLUTED_NET = {
  driverNet: { amountMinor: 999_999, currency: "NGN" },
  netEarnings: { amountMinor: 999_999, currency: "NGN" },
};

describe("B5 MaintenanceEditorView", () => {
  const form: MaintenanceForm = {
    vehicleId: VEH.ab,
    kind: "planned_service",
    startDate: "2026-09-30",
    startTime: "10:00",
    endDate: "2026-09-30",
    endTime: "15:00",
    note: "",
  };
  const window = {
    vehicleId: VEH.ab,
    kind: "planned_service" as const,
    startsAt: "2026-09-30T09:00:00.000Z",
    endsAt: "2026-09-30T14:00:00.000Z",
  };
  const noop = () => undefined;
  const view = (overrides: Partial<MaintenanceEditorViewProps> = {}) =>
    html(
      <MaintenanceEditorView
        fleet={owner}
        vehicles={ready<FleetVehicleList>({ vehicles })}
        form={form}
        onForm={noop}
        editor={{ phase: "form" }}
        existingBlock={null}
        heldConflicts={[]}
        online
        now={NOW}
        problem={null}
        onCheck={noop}
        onConfirm={noop}
        onMoveAndConfirm={noop}
        onHold={noop}
        onRecheck={noop}
        onCancelBlock={noop}
        onBack={noop}
        {...overrides}
      />,
    );

  it("starts with the form and Confirm disabled", () => {
    const markup = view();
    expect(count(markup, FLEET_TEST_IDS.maintenance.form)).toBe(1);
    expect(count(markup, FLEET_TEST_IDS.maintenance.impactPreview)).toBe(1);
    expect(isDisabled(tagOf(markup, FLEET_TEST_IDS.maintenance.confirm))).toBe(
      true,
    );
    expect(text(markup)).toContain("Starts (WAT)");
    expect(text(markup)).toContain(
      'Planned maintenance never cancels a booking. Breakdown? Use "Report off-road".',
    );
  });

  it("says it is checking with the server and keeps Confirm disabled meanwhile", () => {
    const markup = view({ editor: { phase: "checking", window } });
    expect(text(markup)).toContain("Checking impact with the server…");
    expect(text(markup)).toContain(
      "We don't assume anything is free until the server confirms it.",
    );
    expect(isDisabled(tagOf(markup, FLEET_TEST_IDS.maintenance.confirm))).toBe(
      true,
    );
  });

  it("shows the impact preview and the server's resolutions; Confirm stays disabled until resolved", () => {
    const markup = view({
      editor: { phase: "preview", window, preview: infeasiblePreview },
    });
    const shown = text(markup);
    expect(shown).toContain("Affected assignment · 1");
    expect(shown).toContain(
      "Bola A. will be notified. Their signed terms don't change.",
    );
    expect(shown).toContain("Affected booking · 1");
    expect(shown).toContain("Booked · 11:20–13:00");
    expect(shown).toContain("Must be resolved first");
    expect(count(markup, FLEET_TEST_IDS.maintenance.resolutionOption)).toBe(3);
    expect(shown).toContain("Move & confirm");
    expect(shown).toContain("Request swap to LAG-744-MM");
    expect(shown).toContain("LAG-620-ZX: its class doesn't cover the booking");
    expect(shown).toContain("Hold the block and ask Bola A.");
    expect(isDisabled(tagOf(markup, FLEET_TEST_IDS.maintenance.confirm))).toBe(
      true,
    );
    // Decisions doc: no per-driver remittance amounts in the preview, neutral copy.
    expect(shown).not.toMatch(/₦|pro-rat|\bHer\b|\bShe\b/);
  });

  it("enables Confirm only for a feasible server preview, and never while offline", () => {
    expect(
      isDisabled(
        tagOf(
          view({
            editor: { phase: "preview", window, preview: feasiblePreview },
          }),
          FLEET_TEST_IDS.maintenance.confirm,
        ),
      ),
    ).toBe(false);
    expect(
      isDisabled(
        tagOf(
          view({
            editor: { phase: "preview", window, preview: feasiblePreview },
            online: false,
          }),
          FLEET_TEST_IDS.maintenance.confirm,
        ),
      ),
    ).toBe(true);
  });

  it("shows a held block with its conflicts' allowed actions", () => {
    const heldConflict = conflicts
      .conflicts[0] as (typeof conflicts.conflicts)[number];
    const markup = view({
      editor: {
        phase: "held",
        window,
        previewToken: infeasiblePreview.previewToken,
        details: {
          block: dayCalendar.rows[1]?.maintenance[0] as never,
          affectedBlocks: infeasiblePreview.affectedBlocks,
          conflictIds: ["fcf_maint"],
        },
      },
      heldConflicts: [heldConflict],
    });
    expect(text(markup)).toContain("Held · needs resolution");
    expect(text(markup)).toContain("Re-check with the server");
    expect(
      [...markup.matchAll(/data-action="([a-z_]+)"/g)].map((match) => match[1]),
    ).toEqual(heldConflict.allowedActions);
  });

  it("hides the editor from read-only staff and shows flag off honestly", () => {
    const denied = view({ fleet: readOnly });
    expect(count(denied, FLEET_TEST_IDS.maintenance.form)).toBe(0);
    expect(count(denied, FLEET_TEST_IDS.maintenance.confirm)).toBe(0);
    expect(text(denied)).toContain(
      "Your role can view the calendar but can't create maintenance. Ask a fleet owner or manager.",
    );
    const off = view({ vehicles: flagOff() });
    expect(text(off)).toContain(FLAG_OFF_COPY);
    expect(count(off, FLEET_TEST_IDS.maintenance.form)).toBe(0);
    expect(text(view({ vehicles: loading() }))).toContain("Loading vehicles…");
    expect(
      text(view({ vehicles: ready<FleetVehicleList>({ vehicles: [] }) })),
    ).toContain("No vehicles yet. Add a vehicle to start planning.");
  });
});

describe("B5 OffRoadPanel", () => {
  it("reports a breakdown for owners and managers, with honest outcome copy", () => {
    const markup = html(
      <OffRoadPanel
        fleet={manager}
        vehicles={ready<FleetVehicleList>({ vehicles })}
        online
        now={NOW}
      />,
    );
    expect(count(markup, FLEET_TEST_IDS.offRoad.report)).toBe(1);
    expect(text(markup)).toContain(
      "bookings that overlap become at risk (never cancelled)",
    );
    expect(text(markup)).toContain("UBI reviews every report.");
    // Decisions Q8: breakdowns are not pro-rated — no remittance claims here.
    expect(text(markup)).not.toMatch(/pro-rat|remittance/i);
  });

  it("is hidden from read-only staff", () => {
    const markup = html(
      <OffRoadPanel
        fleet={readOnly}
        vehicles={ready<FleetVehicleList>({ vehicles })}
        online
        now={NOW}
      />,
    );
    expect(count(markup, FLEET_TEST_IDS.offRoad.report)).toBe(0);
    expect(text(markup)).toContain("can't create maintenance");
  });
});

describe("B7 AssignmentsView", () => {
  const view = (
    fleet: FleetView,
    state: ReadState<typeof assignments> = ready(assignments),
  ) =>
    html(
      <AssignmentsView
        fleet={fleet}
        state={state}
        vehicles={vehicles}
        online
        today="2026-09-30"
      />,
    );

  it("lets an owner propose with the terms diff, and follows consent", () => {
    const markup = view(owner);
    const shown = text(markup);
    expect(count(markup, FLEET_TEST_IDS.assignment.termsDiff)).toBe(1);
    expect(count(markup, FLEET_TEST_IDS.assignment.proposeSubmit)).toBe(1);
    expect(count(markup, FLEET_TEST_IDS.assignment.consentStatus)).toBe(2);
    expect(shown).toContain("Propose new remittance terms");
    expect(shown).toContain("Waiting for Kemi L.'s signature");
    expect(shown).toContain(
      "Expires 25 Sep 10:02 WAT (48 h). Not counted as availability.",
    );
    expect(shown).toContain(
      "Tunde B. declined. No reason is required and there is no penalty.",
    );
    expect(shown).toContain("The fleet never sees why a driver declined");
    expect(shown).toContain("₦45,000.00 / week (weekly fixed)");
    expect(shown).toContain("Give notice…");
    expect(shown).toContain("Withdraw proposal");
  });

  it("lets a manager propose only under signed terms, and never give notice", () => {
    const shown = text(view(manager));
    expect(shown).not.toContain("Propose new remittance terms");
    expect(shown).toContain(
      "New remittance terms are proposed by a fleet owner. Managers propose shift and vehicle changes under the driver's signed terms.",
    );
    expect(shown).not.toContain("Give notice");
  });

  it("hides proposing from read-only staff", () => {
    const markup = view(readOnly);
    expect(count(markup, FLEET_TEST_IDS.assignment.proposeSubmit)).toBe(0);
    expect(text(markup)).toContain(
      "Your role can view assignments but can't propose them. Ask a fleet owner or manager.",
    );
    expect(text(markup)).not.toContain("Withdraw proposal");
  });

  it("renders loading, flag-off and polluted states", () => {
    expect(text(view(owner, loading()))).toContain("Loading assignments…");
    expect(text(view(owner, flagOff()))).toContain(FLAG_OFF_COPY);
    expectNoForbidden(view(owner, ready(polluted(assignments))));
  });
});

describe("B8 UtilisationView", () => {
  it("shows measured hours, definitions, asOf and Not enough data — no benchmarks", () => {
    const markup = html(
      <UtilisationView fleet={owner} state={ready(utilisation)} />,
    );
    const shown = text(markup);
    expect(count(markup, FLEET_TEST_IDS.utilisation.vehicleBar)).toBe(2);
    expect(shown).toContain("Booked ahead 7 h · Maintenance 10.5 h");
    expect(shown).toContain("Not available yet: On trip");
    expect(shown).toContain("Not enough data · added 26 Sep");
    expect(shown).toContain("Data as of 30 Sep 09:42 WAT");
    expect(shown).toContain("No benchmarks or targets are shown.");
    expect(shown).toContain(
      "Hours inside maintenance or off-road blocks (fleet-service).",
    );
  });

  it("renders loading, error and flag-off states", () => {
    expect(
      text(html(<UtilisationView fleet={owner} state={loading()} />)),
    ).toContain("Loading utilisation…");
    expect(
      text(
        html(
          <UtilisationView
            fleet={owner}
            state={failed(new TypeError("fetch failed"))}
          />,
        ),
      ),
    ).toContain("You're offline");
    expect(
      text(html(<UtilisationView fleet={owner} state={flagOff()} />)),
    ).toContain(FLAG_OFF_COPY);
  });
});

describe("B9 StaffRolesView", () => {
  it("shows the role matrix and lets only an owner change roles", () => {
    const asOwner = html(
      <StaffRolesView fleet={owner} state={ready(staff)} online />,
    );
    expect(count(asOwner, FLEET_TEST_IDS.staff.roleMatrix)).toBe(1);
    expect(text(asOwner)).toContain(
      "See rider identity, routes or safety evidence Never Never Never",
    );
    expect(text(asOwner)).toContain("Save roles");
    const asManager = html(
      <StaffRolesView fleet={manager} state={ready(staff)} online />,
    );
    expect(count(asManager, FLEET_TEST_IDS.staff.roleMatrix)).toBe(1);
    expect(text(asManager)).not.toContain("Save roles");
    expect(text(asManager)).not.toContain("Add as read-only");
    expect(text(asManager)).toContain(
      "Your role can view staff but can't change roles. Ask a fleet owner.",
    );
  });

  it("renders loading and flag-off states", () => {
    expect(
      text(html(<StaffRolesView fleet={owner} state={loading()} online />)),
    ).toContain("Loading staff…");
    expect(
      text(html(<StaffRolesView fleet={owner} state={flagOff()} online />)),
    ).toContain(FLAG_OFF_COPY);
  });
});

describe("Overview and vehicles", () => {
  it("shows the server's counts and says money is not published — nothing estimated", () => {
    const shown = text(
      html(<OverviewView fleet={owner} state={ready(overview)} now={NOW} />),
    );
    expect(shown).toContain("Example Fleet Ltd");
    expect(shown).toContain("Owner · Africa/Lagos · WAT (UTC+1)");
    expect(shown).toContain("1 critical · 2 high · 1 medium · 1 status only");
    expect(shown).toContain(
      "aren't published to the portal yet. Nothing is estimated here",
    );
    expect(shown).not.toContain("₦");
    expect(
      text(html(<OverviewView fleet={owner} state={flagOff()} now={NOW} />)),
    ).toContain(FLAG_OFF_COPY);
  });

  it("lists vehicles and offers Add a vehicle only to owners and managers", () => {
    const asOwner = text(
      html(
        <VehiclesListView
          fleet={owner}
          state={ready<FleetVehicleList>({ vehicles })}
          online
        />,
      ),
    );
    expect(asOwner).toContain("LAG-744-MM");
    expect(asOwner).toContain("Add vehicle");
    const asReader = text(
      html(
        <VehiclesListView
          fleet={readOnly}
          state={ready<FleetVehicleList>({ vehicles })}
          online
        />,
      ),
    );
    expect(asReader).not.toContain("Add vehicle");
    expect(asReader).toContain(
      "Your role can view vehicles but can't add them.",
    );
    expect(
      text(
        html(
          <VehiclesListView
            fleet={owner}
            state={ready<FleetVehicleList>({ vehicles: [] })}
            online
          />,
        ),
      ),
    ).toContain("No vehicles yet. Add a vehicle to start planning.");
    expect(
      text(html(<VehiclesListView fleet={owner} state={flagOff()} online />)),
    ).toContain(FLAG_OFF_COPY);
  });

  it("hides writes for a fleet UBI has suspended", () => {
    const suspended = fleetAs("owner", "suspended");
    const markup = html(
      <CalendarBoard
        fleet={suspended}
        state={ready(dayCalendar)}
        controls={defaultControls("2026-09-30")}
        onControls={() => undefined}
        now={NOW}
        online
        today="2026-09-30"
      />,
    );
    expect(markup).not.toContain('href="/maintenance/new"');
  });
});

describe("offline / stale on every screen", () => {
  it.each([
    [
      "conflicts",
      () =>
        html(
          <ConflictCentreView
            fleet={owner}
            state={offlineStale(conflicts)}
            status="open"
            onStatus={() => undefined}
            names={{}}
            vehicles={vehicles}
            online={false}
          />,
        ),
    ],
    [
      "assignments",
      () =>
        html(
          <AssignmentsView
            fleet={owner}
            state={offlineStale(assignments)}
            vehicles={vehicles}
            online={false}
            today="2026-09-30"
          />,
        ),
    ],
    [
      "utilisation",
      () =>
        html(
          <UtilisationView fleet={owner} state={offlineStale(utilisation)} />,
        ),
    ],
    [
      "staff",
      () =>
        html(
          <StaffRolesView
            fleet={owner}
            state={offlineStale(staff)}
            online={false}
          />,
        ),
    ],
    [
      "overview",
      () =>
        html(
          <OverviewView
            fleet={owner}
            state={offlineStale(overview)}
            now={NOW}
          />,
        ),
    ],
    [
      "vehicles",
      () =>
        html(
          <VehiclesListView
            fleet={owner}
            state={offlineStale<FleetVehicleList>({ vehicles })}
            online={false}
          />,
        ),
    ],
  ])("%s keeps the last data, marked with its time", (_name, render) => {
    const markup = render();
    expect(count(markup, FLEET_STATE_TEST_IDS.stale)).toBe(1);
    expect(text(markup)).toContain(
      "Offline · showing data from 09:42 WAT. Changes are disabled until you reconnect.",
    );
  });

  it("disables every write while offline", () => {
    const assignmentsMarkup = html(
      <AssignmentsView
        fleet={owner}
        state={offlineStale(assignments)}
        vehicles={vehicles}
        online={false}
        today="2026-09-30"
      />,
    );
    expect(
      isDisabled(
        tagOf(assignmentsMarkup, FLEET_TEST_IDS.assignment.proposeSubmit),
      ),
    ).toBe(true);
    const offRoad = html(
      <OffRoadPanel
        fleet={owner}
        vehicles={ready<FleetVehicleList>({ vehicles })}
        online={false}
        now={NOW}
      />,
    );
    expect(isDisabled(tagOf(offRoad, FLEET_TEST_IDS.offRoad.report))).toBe(
      true,
    );
    const conflictMarkup = html(
      <ConflictCentreView
        fleet={owner}
        state={offlineStale(conflicts)}
        status="open"
        onStatus={() => undefined}
        names={{}}
        vehicles={vehicles}
        online={false}
      />,
    );
    const actionTags =
      conflictMarkup.match(
        /<[^>]*data-testid="fleet\.conflicts\.action"[^>]*>/g,
      ) ?? [];
    expect(actionTags.length).toBeGreaterThan(0);
    for (const tag of actionTags.filter((candidate) =>
      candidate.startsWith("<button"),
    )) {
      expect(isDisabled(tag)).toBe(true);
    }
  });
});
