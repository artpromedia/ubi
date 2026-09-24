/**
 * The calendar's view controls (date, zoom, rows, layers, filters, search,
 * agenda) and how they become the server query. Filters and search run on
 * the SERVER (`class`, `status`, `conflictsOnly`, `q`), which pages rows 40
 * at a time with a cursor; days split at local midnight in the fleet's zone.
 */
import {
  CALENDAR_LAYERS,
  VEHICLE_AVAILABILITY_STATES,
  type CalendarLayer,
  type CalendarQuery,
  type FleetCalendar,
  type VehicleAvailabilityState,
} from "./fleet-types";
import { addDays, localDateOf, mondayOf, startOfLocalDay, toIso } from "./time";

export const CALENDAR_PAGE_SIZE = 40;

export interface CalendarControls {
  readonly date: string;
  readonly zoom: "day" | "week";
  readonly rows: "vehicles" | "drivers";
  readonly layers: readonly CalendarLayer[];
  readonly vehicleClass: string;
  readonly status: VehicleAvailabilityState | "";
  readonly conflictsOnly: boolean;
  readonly q: string;
  readonly agenda: boolean;
}

export const defaultControls = (today: string): CalendarControls => ({
  date: today,
  zoom: "day",
  rows: "vehicles",
  layers: [...CALENDAR_LAYERS],
  vehicleClass: "",
  status: "",
  conflictsOnly: false,
  q: "",
  agenda: false,
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Controls from a URL (`?view=week&date=…&rows=drivers&q=…`), defaults otherwise. */
export function controlsFromSearch(
  params: URLSearchParams,
  today: string,
): CalendarControls {
  const base = defaultControls(today);
  const date = params.get("date");
  const layers = params.get("layers");
  const status = params.get("status");
  return {
    ...base,
    date: date !== null && DATE_RE.test(date) ? date : today,
    zoom: params.get("view") === "week" ? "week" : "day",
    rows: params.get("rows") === "drivers" ? "drivers" : "vehicles",
    layers:
      layers === null
        ? base.layers
        : CALENDAR_LAYERS.filter((layer) => layers.split(",").includes(layer)),
    vehicleClass: params.get("class") ?? "",
    status:
      status !== null &&
      (VEHICLE_AVAILABILITY_STATES as readonly string[]).includes(status)
        ? (status as VehicleAvailabilityState)
        : "",
    conflictsOnly: params.get("conflicts") === "1",
    q: params.get("q") ?? "",
    agenda: params.get("agenda") === "1",
  };
}

export function controlsToSearch(controls: CalendarControls): string {
  const params = new URLSearchParams();
  params.set("view", controls.zoom);
  params.set("date", controls.date);
  if (controls.rows === "drivers") {
    params.set("rows", "drivers");
  }
  if (controls.layers.length !== CALENDAR_LAYERS.length) {
    params.set("layers", controls.layers.join(","));
  }
  if (controls.vehicleClass !== "") {
    params.set("class", controls.vehicleClass);
  }
  if (controls.status !== "") {
    params.set("status", controls.status);
  }
  if (controls.conflictsOnly) {
    params.set("conflicts", "1");
  }
  if (controls.q.trim() !== "") {
    params.set("q", controls.q.trim());
  }
  if (controls.agenda) {
    params.set("agenda", "1");
  }
  return params.toString();
}

/** The first local date shown: the day, or the Monday of its week. */
export const firstDate = (controls: CalendarControls): string =>
  controls.zoom === "week" ? mondayOf(controls.date) : controls.date;

/** The UTC range of the view (local midnight to local midnight). */
export function calendarRange(
  controls: CalendarControls,
  zone: string,
): { from: string; to: string } {
  const first = firstDate(controls);
  const days = controls.zoom === "week" ? 7 : 1;
  return {
    from: toIso(startOfLocalDay(first, zone)),
    to: toIso(startOfLocalDay(addDays(first, days), zone)),
  };
}

export function calendarQuery(
  controls: CalendarControls,
  zone: string,
): CalendarQuery {
  const range = calendarRange(controls, zone);
  return {
    ...range,
    zoom: controls.zoom,
    rows: controls.rows,
    // The server returns only the layers asked for; with none, it would
    // return all — so an all-off view still asks for nothing extra.
    layers: controls.layers.length === 0 ? ["documents"] : controls.layers,
    vehicleClass:
      controls.rows === "vehicles" && controls.vehicleClass !== ""
        ? controls.vehicleClass
        : undefined,
    status:
      controls.rows === "vehicles" && controls.status !== ""
        ? controls.status
        : undefined,
    conflictsOnly: controls.conflictsOnly,
    q: controls.q.trim() === "" ? undefined : controls.q.trim(),
    limit: CALENDAR_PAGE_SIZE,
  };
}

/** Previous / next day or week. */
export const stepDate = (
  controls: CalendarControls,
  direction: -1 | 1,
): string =>
  addDays(controls.date, direction * (controls.zoom === "week" ? 7 : 1));

export const todayIn = (zone: string, now: number): string =>
  localDateOf(now, zone);

/** Server pages merged into one calendar (rows and day summaries appended). */
export function mergePages(
  pages: readonly FleetCalendar[],
): FleetCalendar | undefined {
  const [first, ...rest] = pages;
  if (first === undefined) {
    return undefined;
  }
  const last = pages[pages.length - 1] ?? first;
  return {
    ...first,
    asOf: last.asOf,
    rows: pages.flatMap((page) => page.rows),
    daySummaries:
      first.daySummaries === null
        ? null
        : [first, ...rest].flatMap((page) => page.daySummaries ?? []),
    nextCursor: last.nextCursor,
    totalRows: last.totalRows,
  };
}

/** "Showing 1–40 of 212 vehicles". */
export function showingText(calendar: FleetCalendar): string {
  const noun = calendar.rowsKind === "drivers" ? "drivers" : "vehicles";
  if (calendar.rows.length === 0) {
    return `Showing 0 of ${calendar.totalRows} ${noun}`;
  }
  return `Showing 1–${calendar.rows.length} of ${calendar.totalRows} ${noun}`;
}

export const hasFilters = (controls: CalendarControls): boolean =>
  controls.vehicleClass !== "" ||
  controls.status !== "" ||
  controls.conflictsOnly ||
  controls.q.trim() !== "";
