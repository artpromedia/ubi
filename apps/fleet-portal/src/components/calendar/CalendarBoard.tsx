"use client";

/**
 * B1 / B2 / B3 — the fleet calendar board: toolbar (date, Day/Week,
 * Vehicles/Drivers, zone label, layer toggles, filters, plate search,
 * agenda toggle) over the day timeline, the week grid or the agenda table.
 * Pure props: the screen container owns the query; this renders every state
 * (loading, empty, error, offline/stale, flag off, permission).
 */
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Filter,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Table,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";

import {
  EmptyState,
  PermissionNote,
  ReadGate,
} from "@/components/states/states";
import {
  firstDate,
  hasFilters,
  showingText,
  type CalendarControls,
} from "@/lib/calendar-controls";
import { buildTimelineRows } from "@/lib/calendar-model";
import {
  FLEET_VEHICLE_CLASSES,
  VEHICLE_AVAILABILITY_STATES,
  type CalendarLayer,
  type FleetCalendar,
  type FleetView,
} from "@/lib/fleet-types";
import { STATUS_NOW_LABELS } from "@/lib/labels";
import { can, permissionCopy } from "@/lib/roles";
import { FLEET_TEST_IDS } from "@/lib/test-ids";
import {
  addDays,
  dayLabel,
  dayRuler,
  localTimeOf,
  weekRangeLabel,
  zoneLabel,
  zoneShort,
} from "@/lib/time";
import { cn } from "@/lib/utils";

import { AgendaTable } from "./AgendaTable";
import { DayTimeline } from "./DayTimeline";
import { WeekGrid } from "./WeekGrid";

import type { ReadState } from "@/lib/access";

const LAYER_LABELS: Readonly<Record<CalendarLayer, string>> = {
  assignments: "Assignments",
  maintenance: "Maintenance",
  bookings: "Bookings",
  documents: "Documents",
};

export interface CalendarBoardProps {
  readonly fleet: FleetView;
  readonly state: ReadState<FleetCalendar>;
  readonly controls: CalendarControls;
  readonly onControls: (next: Partial<CalendarControls>) => void;
  readonly now: number;
  readonly online: boolean;
  readonly plates?: ReadonlyMap<string, string>;
  readonly onLoadMore?: () => void;
  readonly loadingMore?: boolean;
  readonly onRetry?: () => void;
  readonly today: string;
}

const segment = (active: boolean) =>
  cn(
    "px-3 py-1 text-xs font-medium",
    active ? "bg-[#1DB954] text-black" : "text-zinc-300 hover:bg-zinc-800",
  );

/** The empty calendar: filtered to nothing, no drivers yet, or a new fleet. */
export const CalendarEmpty = ({
  fleet,
  controls,
  rowsKind,
}: {
  readonly fleet: FleetView;
  readonly controls: CalendarControls;
  readonly rowsKind: "vehicles" | "drivers";
}) => {
  if (hasFilters(controls)) {
    return (
      <EmptyState
        title={`No ${rowsKind} match these filters.`}
        body="Clear the search or filters to see the whole fleet."
      />
    );
  }
  if (rowsKind === "drivers") {
    return (
      <EmptyState
        title="No drivers have a signed arrangement in this range."
        body="Drivers appear here once they sign an assignment with your fleet."
        action={
          can(fleet.myRole, "propose_assignment")
            ? { href: "/assignments", label: "Propose an assignment" }
            : undefined
        }
      />
    );
  }
  return (
    <EmptyState
      title="No vehicles yet. Add a vehicle to start planning."
      action={
        can(fleet.myRole, "manage_vehicles")
          ? { href: "/vehicles", label: "Add a vehicle" }
          : undefined
      }
    />
  );
};

export const CalendarBoard = ({
  fleet,
  state,
  controls,
  onControls,
  now,
  online,
  plates,
  onLoadMore,
  loadingMore = false,
  onRetry,
  today,
}: CalendarBoardProps) => {
  const search = useRef<HTMLInputElement>(null);
  const zone = fleet.zone;
  const canMaintain =
    can(fleet.myRole, "manage_maintenance") && fleet.status === "active";

  // D / W switch zoom, T jumps to now, "/" focuses plate search — anywhere
  // on the calendar except while typing in a field.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (target !== null &&
          (target.isContentEditable ||
            ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)))
      ) {
        return;
      }
      if (event.key === "d" || event.key === "D") {
        onControls({ zoom: "day" });
      } else if (event.key === "w" || event.key === "W") {
        onControls({ zoom: "week" });
      } else if (event.key === "t" || event.key === "T") {
        onControls({ date: today });
      } else if (event.key === "/") {
        event.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onControls, today]);

  const first = firstDate(controls);
  const rangeLabel =
    controls.zoom === "week"
      ? weekRangeLabel(first, addDays(first, 6))
      : dayLabel(controls.date);
  const ruler = useMemo(
    () => dayRuler(controls.date, zone),
    [controls.date, zone],
  );
  const rows = useMemo(
    () =>
      state.kind === "ready"
        ? buildTimelineRows(state.data, { zone, plates })
        : [],
    [state, zone, plates],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-zinc-100">Fleet calendar</h1>
        <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-[#1A1A1A] px-1">
          <button
            type="button"
            aria-label={
              controls.zoom === "week" ? "Previous week" : "Previous day"
            }
            onClick={() =>
              onControls({
                date: addDays(
                  controls.date,
                  controls.zoom === "week" ? -7 : -1,
                ),
              })
            }
            className="p-1 text-zinc-400 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[150px] text-center text-sm text-zinc-100">
            {rangeLabel}
          </span>
          <button
            type="button"
            aria-label={controls.zoom === "week" ? "Next week" : "Next day"}
            onClick={() =>
              onControls({
                date: addDays(controls.date, controls.zoom === "week" ? 7 : 1),
              })
            }
            className="p-1 text-zinc-400 hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => onControls({ date: today })}
          className="rounded-lg border border-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          Today (T)
        </button>
        <div
          className="flex overflow-hidden rounded-lg border border-zinc-800"
          role="group"
          aria-label="Zoom"
        >
          <button
            type="button"
            data-testid={FLEET_TEST_IDS.calendar.zoomDay}
            aria-pressed={controls.zoom === "day"}
            onClick={() => onControls({ zoom: "day" })}
            className={segment(controls.zoom === "day")}
          >
            Day
          </button>
          <button
            type="button"
            data-testid={FLEET_TEST_IDS.calendar.zoomWeek}
            aria-pressed={controls.zoom === "week"}
            onClick={() => onControls({ zoom: "week" })}
            className={segment(controls.zoom === "week")}
          >
            Week
          </button>
        </div>
        <div
          className="flex overflow-hidden rounded-lg border border-zinc-800"
          role="group"
          aria-label="Rows"
        >
          <button
            type="button"
            aria-pressed={controls.rows === "vehicles"}
            onClick={() => onControls({ rows: "vehicles" })}
            className={segment(controls.rows === "vehicles")}
          >
            Vehicles
          </button>
          <button
            type="button"
            aria-pressed={controls.rows === "drivers"}
            onClick={() =>
              onControls({ rows: "drivers", status: "", vehicleClass: "" })
            }
            className={segment(controls.rows === "drivers")}
          >
            Drivers
          </button>
        </div>
        <span className="flex items-center gap-1 font-mono text-xs text-zinc-400">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          {zoneLabel(zone, now)}
        </span>
        {canMaintain && online ? (
          <Link
            href="/maintenance/new"
            className="ml-auto flex items-center gap-1 rounded-lg bg-[#1DB954] px-3 py-1.5 text-xs font-semibold text-black"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Maintenance block
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1 text-zinc-500">
          <Layers className="h-3.5 w-3.5" aria-hidden />
          Layers
        </span>
        {(Object.keys(LAYER_LABELS) as CalendarLayer[]).map((layer) => {
          const on = controls.layers.includes(layer);
          return (
            <button
              key={layer}
              type="button"
              data-testid={FLEET_TEST_IDS.calendar.layerToggle}
              data-layer={layer}
              aria-pressed={on}
              onClick={() =>
                onControls({
                  layers: on
                    ? controls.layers.filter((entry) => entry !== layer)
                    : [...controls.layers, layer],
                })
              }
              className={cn(
                "rounded-full border px-2.5 py-0.5",
                on
                  ? "border-[#1DB954] text-[#86EFAC]"
                  : "border-zinc-700 text-zinc-500 line-through",
              )}
            >
              {LAYER_LABELS[layer]}
              <span className="sr-only">{on ? " (shown)" : " (hidden)"}</span>
            </button>
          );
        })}
        <span className="ml-2 flex items-center gap-1 text-zinc-500">
          <Filter className="h-3.5 w-3.5" aria-hidden />
          Filters
        </span>
        {controls.rows === "vehicles" ? (
          <>
            <label className="flex items-center gap-1 text-zinc-400">
              Class
              <select
                value={controls.vehicleClass}
                onChange={(event) =>
                  onControls({ vehicleClass: event.target.value })
                }
                className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-100"
              >
                <option value="">All</option>
                {FLEET_VEHICLE_CLASSES.map((cls) => (
                  <option key={cls} value={cls}>
                    {cls}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-zinc-400">
              Status
              <select
                value={controls.status}
                onChange={(event) =>
                  onControls({
                    status: event.target.value as CalendarControls["status"],
                  })
                }
                className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-100"
              >
                <option value="">All</option>
                {VEHICLE_AVAILABILITY_STATES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_NOW_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        <button
          type="button"
          data-testid={FLEET_TEST_IDS.calendar.filterConflicts}
          aria-pressed={controls.conflictsOnly}
          onClick={() => onControls({ conflictsOnly: !controls.conflictsOnly })}
          className={cn(
            "rounded-full border px-2.5 py-0.5",
            controls.conflictsOnly
              ? "border-red-500 text-red-200"
              : "border-zinc-700 text-zinc-400",
          )}
        >
          Conflicts only: {controls.conflictsOnly ? "on" : "off"}
        </button>
        <label className="flex items-center gap-1 rounded-full border border-zinc-700 px-2 py-0.5 text-zinc-400">
          <Search className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">
            {controls.rows === "drivers" ? "Search driver" : "Search plate"}
          </span>
          <input
            ref={search}
            type="search"
            data-testid={FLEET_TEST_IDS.calendar.plateSearch}
            value={controls.q}
            placeholder={
              controls.rows === "drivers"
                ? "Search driver (/)"
                : "Search plate (/)"
            }
            onChange={(event) => onControls({ q: event.target.value })}
            className="w-36 bg-transparent text-zinc-100 outline-none placeholder:text-zinc-500"
          />
        </label>
        {controls.zoom === "day" ? (
          <button
            type="button"
            data-testid={FLEET_TEST_IDS.calendar.agendaToggle}
            aria-pressed={controls.agenda}
            onClick={() => onControls({ agenda: !controls.agenda })}
            className={cn(
              "ml-auto flex items-center gap-1 rounded-full border px-2.5 py-0.5",
              controls.agenda
                ? "border-[#5B73C4] text-[#C7D2FE]"
                : "border-zinc-700 text-zinc-400",
            )}
          >
            <Table className="h-3.5 w-3.5" aria-hidden />
            Agenda / table
          </button>
        ) : null}
      </div>

      {!canMaintain && fleet.status === "active" ? (
        <PermissionNote>{permissionCopy("manage_maintenance")}</PermissionNote>
      ) : null}
      {controls.zoom === "day" && ruler.dstNote !== null ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {ruler.dstNote}
        </p>
      ) : null}

      <ReadGate
        state={state}
        loadingLabel="Loading calendar…"
        context="the calendar"
        zone={zone}
        onRetry={onRetry}
      >
        {(calendar) =>
          calendar.rows.length === 0 ? (
            <CalendarEmpty
              fleet={fleet}
              controls={controls}
              rowsKind={calendar.rowsKind}
            />
          ) : (
            <div className="space-y-2">
              {controls.zoom === "week" ? (
                <WeekGrid
                  calendar={calendar}
                  onOpenDay={(date, rowLabel) =>
                    onControls({ zoom: "day", date, q: rowLabel ?? controls.q })
                  }
                />
              ) : null}
              {controls.zoom === "day" && controls.agenda ? (
                <AgendaTable
                  rows={rows}
                  zone={zone}
                  zoneText={zoneLabel(zone, now)}
                  rowsKind={calendar.rowsKind}
                />
              ) : null}
              {controls.zoom === "day" && !controls.agenda ? (
                <DayTimeline
                  rows={rows}
                  rowsKind={calendar.rowsKind}
                  ruler={ruler}
                  zone={zone}
                  now={now}
                  showDocuments={controls.layers.includes("documents")}
                />
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
                <span>
                  {showingText(calendar)}
                  {calendar.nextCursor !== null && onLoadMore !== undefined ? (
                    <button
                      type="button"
                      disabled={loadingMore || !online}
                      onClick={onLoadMore}
                      className="ml-2 rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 disabled:opacity-50"
                    >
                      {loadingMore ? "Loading…" : "Load the next 40"}
                    </button>
                  ) : null}
                </span>
                <span className="flex items-center gap-1">
                  <RefreshCw className="h-3 w-3" aria-hidden />
                  Feasibility from server · updated{" "}
                  {localTimeOf(new Date(calendar.asOf).getTime(), zone)}{" "}
                  {zoneShort(zone, new Date(calendar.asOf).getTime())}
                </span>
              </div>
            </div>
          )
        }
      </ReadGate>
    </div>
  );
};
