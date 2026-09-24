/**
 * The fleet calendar (B1–B3) as pure data: rows, lanes and blocks with their
 * text, the week grid, the agenda/table equivalent, the keyboard model and
 * the virtual-row window. Screens only render what this returns.
 *
 * Everything comes from the server's calendar response. The portal computes
 * no feasibility, conflict or money: an at-risk booking is at risk because
 * the server says `risk: "at_risk"`, a conflict flag is the server's flag,
 * and a booking is only ever "Booked · 07:15–09:40" (decisions Q1 — no zone,
 * no rider, no location, no fare). Driver time off is "Unavailable · set by
 * driver" (Q9); proposals never appear (they never count as availability).
 */
import {
  MAINTENANCE_KIND_LABELS,
  MAINTENANCE_STATUS_LABELS,
  STATUS_NOW_LABELS,
  documentLabel,
  flagLabel,
  shiftName,
  shiftSummaryLabel,
  ubiStatusLabel,
} from "./labels";
import {
  addDays,
  compareDates,
  dateTimeIn,
  hoursLabel,
  localDateOf,
  localTimeOf,
  monthOf,
  spanOn,
  timeRangeIn,
  weekdayOf,
  zoneLongName,
  type DayRuler,
  type RulerSpan,
} from "./time";

import type {
  CalendarRow,
  DaySummary,
  FleetCalendar,
  OccupiedBlock,
} from "./fleet-types";

export type BlockKind =
  | "shift"
  | "maintenance"
  | "off_road"
  | "booked"
  | "on_trip"
  | "available"
  | "unavailable"
  | "ubi_status";

export type BlockLayer =
  | "Assignment"
  | "Maintenance"
  | "Booking"
  | "Availability"
  | "UBI status";

export type BlockSource =
  | { readonly type: "booking"; readonly blockId: string }
  | {
      readonly type: "maintenance";
      readonly blockId: string;
      readonly vehicleId: string;
    }
  | {
      readonly type: "assignment";
      readonly assignmentId: string;
      readonly vehicleId: string;
    }
  | { readonly type: "availability" }
  | { readonly type: "ubi" };

export interface TimelineBlock {
  /** Unique, DOM-safe id (aria-activedescendant target). */
  readonly id: string;
  readonly lane: number;
  readonly kind: BlockKind;
  readonly layer: BlockLayer;
  readonly startsAt: string;
  readonly endsAt: string | null;
  /** The visible text. */
  readonly label: string;
  /** Status in words ("At risk · needs a decision by 30 Sep 09:20"). */
  readonly status: string;
  /** "LAG-118-AB, Booked, 11:20 to 13:00 West Africa Time, at risk …". */
  readonly accessibleName: string;
  readonly atRisk: boolean;
  readonly source: BlockSource;
}

export interface TimelineRow {
  readonly rowId: string;
  readonly rowKind: "vehicle" | "driver";
  readonly vehicleId: string | null;
  readonly driverId: string | null;
  readonly label: string;
  /** Vehicle: status now; driver: the hours summary. */
  readonly summary: string;
  readonly flags: readonly string[];
  readonly documents: readonly string[];
  readonly lanes: number;
  /** In time order (the keyboard's Left/Right order). */
  readonly blocks: readonly TimelineBlock[];
  readonly hasConflict: boolean;
}

export interface BuildOptions {
  readonly zone: string;
  /** Vehicle id → plate, for driver rows' shift labels. */
  readonly plates?: ReadonlyMap<string, string>;
}

/** "At risk · …" → "at risk · …" (mid-sentence in an accessible name). */
const lowerFirst = (text: string): string =>
  text.charAt(0).toLowerCase() + text.slice(1);

const domId = (...parts: string[]): string =>
  "blk-" + parts.join("-").replace(/[^A-Za-z0-9_-]/g, "_");

function spoken(
  rowLabel: string,
  layerWord: string,
  startsAt: string,
  endsAt: string | null,
  zone: string,
  extra: string | null,
): string {
  const start = new Date(startsAt).getTime();
  const long = zoneLongName(zone, start);
  const sameDay =
    endsAt !== null &&
    localDateOf(start, zone) ===
      localDateOf(new Date(endsAt).getTime() - 1, zone);
  let when = `from ${dateTimeIn(startsAt, zone)} ${long}, no end set`;
  if (endsAt !== null) {
    when = sameDay
      ? `${localTimeOf(start, zone)} to ${localTimeOf(new Date(endsAt).getTime(), zone)} ${long}`
      : `${dateTimeIn(startsAt, zone)} to ${dateTimeIn(endsAt, zone)} ${long}`;
  }
  return [rowLabel, layerWord, when, extra]
    .filter((part) => part !== null && part !== "")
    .join(", ");
}

function bookingBlock(
  row: CalendarRow,
  block: OccupiedBlock,
  lane: number,
  zone: string,
): TimelineBlock {
  const range = timeRangeIn(block.startsAt, block.endsAt, zone);
  const atRisk = block.risk === "at_risk";
  const deadline =
    block.decisionDeadline === null
      ? null
      : dateTimeIn(block.decisionDeadline, zone);
  const base =
    block.kind === "on_trip" ? `On a trip · ${range}` : `Booked · ${range}`;
  let status = block.kind === "on_trip" ? "On a trip now" : "Confirmed";
  if (atRisk) {
    status =
      deadline === null
        ? "At risk · needs a decision"
        : `At risk · needs a decision by ${deadline}`;
  }
  return {
    id: domId(row.rowId, "bk", block.blockId),
    lane,
    kind: block.kind === "on_trip" ? "on_trip" : "booked",
    layer: "Booking",
    startsAt: block.startsAt,
    endsAt: block.endsAt,
    label: atRisk ? `At risk · ${base}` : base,
    status,
    accessibleName: spoken(
      row.label,
      block.kind === "on_trip" ? "On a trip" : "Booked",
      block.startsAt,
      block.endsAt,
      zone,
      atRisk ? lowerFirst(status) : null,
    ),
    atRisk,
    source: { type: "booking", blockId: block.blockId },
  };
}

function maintenanceBlocks(
  row: CalendarRow,
  lane: number,
  zone: string,
): TimelineBlock[] {
  return row.maintenance.map((block) => {
    const offRoad = block.kind === "unplanned_off_road";
    const kindText = offRoad ? "Off-road" : MAINTENANCE_KIND_LABELS[block.kind];
    const statusText = MAINTENANCE_STATUS_LABELS[block.status];
    const range = timeRangeIn(block.startsAt, block.endsAt, zone);
    const label =
      row.rowKind === "driver"
        ? `Vehicle in service · ${range}`
        : `${kindText} · ${statusText} · ${range}`;
    const status = block.offRoadFlagged
      ? `${statusText} · flagged for UBI review`
      : statusText;
    return {
      id: domId(row.rowId, "mt", block.blockId),
      lane,
      kind: offRoad ? ("off_road" as const) : ("maintenance" as const),
      layer: "Maintenance" as const,
      startsAt: block.startsAt,
      endsAt: block.endsAt,
      label,
      status,
      accessibleName: spoken(
        row.label,
        offRoad ? "Off-road" : `Maintenance, ${kindText}`,
        block.startsAt,
        block.endsAt,
        zone,
        lowerFirst(status),
      ),
      atRisk: block.status === "needs_resolution",
      source: {
        type: "maintenance" as const,
        blockId: block.blockId,
        vehicleId: block.vehicleId,
      },
    };
  });
}

function assignmentBlocks(
  row: CalendarRow,
  lane: number,
  options: BuildOptions,
): TimelineBlock[] {
  return row.assignments.flatMap((assignment) =>
    assignment.intervals.map((interval, index) => {
      const plate = options.plates?.get(assignment.vehicleId);
      const notice = assignment.status === "notice" ? " · on notice" : "";
      const label =
        row.rowKind === "driver"
          ? `Shift · ${plate ?? "signed vehicle"}${notice}`
          : `${assignment.driverDisplayName} · ${shiftName(assignment.shift)}${notice}`;
      const status = `Signed · terms v${assignment.termsVersion}`;
      return {
        id: domId(row.rowId, "as", assignment.assignmentId, String(index)),
        lane,
        kind: "shift" as const,
        layer: "Assignment" as const,
        startsAt: interval.startsAt,
        endsAt: interval.endsAt,
        label,
        status,
        accessibleName: spoken(
          row.label,
          row.rowKind === "driver"
            ? `Signed shift${plate === undefined ? "" : ` on ${plate}`}`
            : `Signed shift, ${assignment.driverDisplayName}`,
          interval.startsAt,
          interval.endsAt,
          options.zone,
          lowerFirst(status),
        ),
        atRisk: false,
        source: {
          type: "assignment" as const,
          assignmentId: assignment.assignmentId,
          vehicleId: assignment.vehicleId,
        },
      };
    }),
  );
}

function availabilityBlocks(
  row: CalendarRow,
  lane: number,
  zone: string,
): TimelineBlock[] {
  return (row.availability ?? []).map((window, index) => {
    // Q9: time off reaches a fleet as an unexplained "Unavailable".
    const word = window.kind === "unavailable" ? "Unavailable" : "Available";
    return {
      id: domId(row.rowId, "av", String(index)),
      lane,
      kind:
        window.kind === "unavailable"
          ? ("unavailable" as const)
          : ("available" as const),
      layer: "Availability" as const,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      label: `${word} · set by driver`,
      status: "Set by the driver · read-only",
      accessibleName: spoken(
        row.label,
        `${word}, set by driver`,
        window.startsAt,
        window.endsAt,
        zone,
        "read-only",
      ),
      atRisk: false,
      source: { type: "availability" as const },
    };
  });
}

function ubiBlock(
  row: CalendarRow,
  calendar: FleetCalendar,
  lane: number,
  zone: string,
): TimelineBlock[] {
  if (row.ubiStatus === null) {
    return [];
  }
  const startsAt =
    row.ubiStatus.effectiveFrom !== null &&
    row.ubiStatus.effectiveFrom > calendar.from
      ? row.ubiStatus.effectiveFrom
      : calendar.from;
  const endsAt =
    row.ubiStatus.effectiveTo !== null &&
    row.ubiStatus.effectiveTo < calendar.to
      ? row.ubiStatus.effectiveTo
      : calendar.to;
  const label = ubiStatusLabel(row.ubiStatus.status);
  return [
    {
      id: domId(row.rowId, "ubi"),
      lane,
      kind: "ubi_status",
      layer: "UBI status",
      startsAt,
      endsAt,
      label,
      status: "Status only · no override",
      accessibleName: spoken(row.label, label, startsAt, endsAt, zone, null),
      atRisk: false,
      source: { type: "ubi" },
    },
  ];
}

const byStart = (a: TimelineBlock, b: TimelineBlock): number =>
  a.startsAt === b.startsAt
    ? a.lane - b.lane
    : compareDates(a.startsAt, b.startsAt);

export function buildTimelineRows(
  calendar: FleetCalendar,
  options: BuildOptions,
): TimelineRow[] {
  const zone = options.zone;
  return calendar.rows.map((row) => {
    const isDriver = row.rowKind === "driver";
    // Vehicle rows: lane 0 assignments + maintenance, lane 1 opaque bookings.
    // Driver rows: lane 0 availability (read-only), lane 1 shift + the
    // vehicle's maintenance, lane 2 opaque bookings.
    const workLane = isDriver ? 1 : 0;
    const bookingLane = isDriver ? 2 : 1;
    const blocks = [
      ...(isDriver ? availabilityBlocks(row, 0, zone) : []),
      ...ubiBlock(row, calendar, workLane, zone),
      ...assignmentBlocks(row, workLane, options),
      ...maintenanceBlocks(row, workLane, zone),
      ...row.occupied.map((block) =>
        bookingBlock(row, block, bookingLane, zone),
      ),
    ].sort(byStart);
    const booked = row.occupied.filter(
      (block) => block.kind === "booked",
    ).length;
    const atRisk = row.occupied.filter(
      (block) => block.risk === "at_risk",
    ).length;
    const hours = row.hours?.signedShiftHours ?? 0;
    const vehicleSummary =
      row.statusNow === null
        ? "Status not known"
        : STATUS_NOW_LABELS[row.statusNow];
    const summary = isDriver
      ? [
          `${hoursLabel(hours)} signed shift`,
          `${booked} booked`,
          atRisk > 0 ? `${atRisk} at risk` : null,
        ]
          .filter((part): part is string => part !== null)
          .join(" · ")
      : vehicleSummary;
    return {
      rowId: row.rowId,
      rowKind: row.rowKind,
      vehicleId: row.vehicleId,
      driverId: row.driverId,
      label: row.label,
      summary,
      flags: row.flags.map(flagLabel),
      documents: row.documents
        .filter((doc) => doc.status !== "valid")
        .map((doc) => documentLabel(doc, zone)),
      lanes: isDriver ? 3 : 2,
      blocks,
      hasConflict:
        row.flags.includes("conflict") || row.flags.includes("at_risk"),
    };
  });
}

/** The blocks of a row placed on the day ruler, and how many fall outside it. */
export function placeOnRuler(
  row: TimelineRow,
  ruler: DayRuler,
): { placed: { block: TimelineBlock; span: RulerSpan }[]; outside: number } {
  const placed: { block: TimelineBlock; span: RulerSpan }[] = [];
  let outside = 0;
  for (const block of row.blocks) {
    const span = spanOn(ruler, block.startsAt, block.endsAt);
    if (span === null) {
      outside += 1;
    } else {
      placed.push({ block, span });
    }
  }
  return { placed, outside };
}

// ── Week (B2) ──────────────────────────────────────────────────────────────

export interface WeekColumn {
  readonly date: string;
  /** "Mon 29". */
  readonly day: string;
  /** "Sep", or "Oct · new month" at the boundary. */
  readonly month: string;
  readonly newMonth: boolean;
}

export function weekColumns(calendar: FleetCalendar): WeekColumn[] {
  const zone = calendar.zone;
  const first = localDateOf(new Date(calendar.from).getTime(), zone);
  const last = localDateOf(new Date(calendar.to).getTime() - 1, zone);
  const columns: WeekColumn[] = [];
  for (
    let date = first, guard = 0;
    compareDates(date, last) <= 0 && guard < 40;
    guard += 1
  ) {
    const previous = columns[columns.length - 1];
    const newMonth =
      previous !== undefined && monthOf(previous.date) !== monthOf(date);
    columns.push({
      date,
      day: `${weekdayOf(date)} ${Number.parseInt(date.slice(8), 10)}`,
      month: newMonth ? `${monthOf(date)} · new month` : monthOf(date),
      newMonth,
    });
    date = addDays(date, 1);
  }
  return columns;
}

export type WeekTone =
  | "normal"
  | "conflict"
  | "maintenance"
  | "expired"
  | "held"
  | "empty";

export interface WeekCell {
  readonly date: string;
  readonly rowId: string;
  readonly primary: string;
  readonly secondary: string;
  readonly tone: WeekTone;
  readonly accessibleName: string;
}

export function weekCell(
  row: CalendarRow,
  summary: DaySummary | undefined,
  date: string,
  zone: string,
): WeekCell {
  const cell = (
    primary: string,
    secondary: string,
    tone: WeekTone,
  ): WeekCell => ({
    date,
    rowId: row.rowId,
    primary,
    secondary,
    tone,
    accessibleName: [
      row.label,
      `${weekdayOf(date)} ${date}`,
      primary,
      secondary,
    ]
      .filter((part) => part !== "")
      .join(", "),
  });
  const shifts = (summary?.shiftSummary ?? [])
    .map(shiftSummaryLabel)
    .join(" + ");
  const booked = summary?.bookedCount ?? 0;
  const status = row.ubiStatus;
  if (status !== null) {
    const from =
      status.effectiveFrom === null
        ? null
        : localDateOf(new Date(status.effectiveFrom).getTime(), zone);
    const to =
      status.effectiveTo === null
        ? null
        : localDateOf(new Date(status.effectiveTo).getTime() - 1, zone);
    const covers =
      (from === null || compareDates(from, date) <= 0) &&
      (to === null || compareDates(date, to) <= 0);
    if (covers) {
      if (status.status === "doc_expired") {
        return cell(
          "Document expired",
          booked > 0 ? `${booked} booked · enforced by UBI` : "Enforced by UBI",
          "expired",
        );
      }
      return cell(
        status.status === "suspended" ? "Suspended by UBI" : "Held by UBI",
        "Status only",
        "held",
      );
    }
  }
  if (summary?.flags.includes("at_risk")) {
    return cell(
      "At risk",
      booked > 0 ? `${booked} booked · needs a decision` : "Needs a decision",
      "conflict",
    );
  }
  if ((summary?.maintenanceCount ?? 0) > 0) {
    return cell(
      "Maintenance",
      booked > 0 ? `${booked} booked` : shifts,
      "maintenance",
    );
  }
  if (booked > 0) {
    return cell(
      `${booked} booked`,
      shifts === "" ? "No shift" : shifts,
      "normal",
    );
  }
  if (shifts !== "") {
    return cell("No bookings", shifts, "normal");
  }
  return cell(
    row.statusNow === "unassigned" ? "Unassigned" : "No shift",
    "",
    "empty",
  );
}

/** Every row's cells for the week, in column order. */
export function weekGrid(calendar: FleetCalendar): {
  columns: WeekColumn[];
  rows: { row: CalendarRow; cells: WeekCell[] }[];
} {
  const columns = weekColumns(calendar);
  const summaries = new Map(
    (calendar.daySummaries ?? []).map((summary) => [
      `${summary.rowId}|${summary.date}`,
      summary,
    ]),
  );
  return {
    columns,
    rows: calendar.rows.map((row) => ({
      row,
      cells: columns.map((column) =>
        weekCell(
          row,
          summaries.get(`${row.rowId}|${column.date}`),
          column.date,
          calendar.zone,
        ),
      ),
    })),
  };
}

// ── Agenda / table equivalent ──────────────────────────────────────────────

export interface AgendaEntry {
  readonly id: string;
  readonly row: string;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly start: string;
  readonly end: string;
  readonly layer: BlockLayer;
  readonly label: string;
  readonly status: string;
}

export type AgendaSortKey =
  | "row"
  | "start"
  | "end"
  | "layer"
  | "label"
  | "status";

export function agendaEntries(
  rows: readonly TimelineRow[],
  zone: string,
): AgendaEntry[] {
  return rows.flatMap((row) =>
    row.blocks.map((block) => ({
      id: block.id,
      row: row.label,
      startsAt: block.startsAt,
      endsAt: block.endsAt,
      start: dateTimeIn(block.startsAt, zone),
      end:
        block.endsAt === null ? "No end set" : dateTimeIn(block.endsAt, zone),
      layer: block.layer,
      label: block.label,
      status: block.status,
    })),
  );
}

export function sortAgenda(
  entries: readonly AgendaEntry[],
  key: AgendaSortKey,
  direction: "asc" | "desc",
): AgendaEntry[] {
  // An entry with no end sorts after every dated one.
  const value = (entry: AgendaEntry): string => {
    if (key === "start") {
      return entry.startsAt;
    }
    if (key === "end") {
      return entry.endsAt ?? "~";
    }
    return entry[key];
  };
  const sorted = [...entries].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    return left === right
      ? compareDates(a.startsAt, b.startsAt)
      : compareDates(left, right);
  });
  return direction === "asc" ? sorted : sorted.reverse();
}

// ── Keyboard model (handoff Accessibility) ────────────────────────────────

export interface GridFocus {
  readonly row: number;
  /** Index into the row's blocks (time order), or null for the row itself. */
  readonly block: number | null;
}

export type GridCommand =
  | { readonly type: "focus"; readonly focus: GridFocus }
  | { readonly type: "open"; readonly focus: GridFocus }
  | { readonly type: "zoom"; readonly zoom: "day" | "week" }
  | { readonly type: "now" }
  | { readonly type: "search" }
  | { readonly type: "none" };

/**
 * Up/Down move between rows; Left/Right move between blocks in a row in
 * time order; Enter opens a block; D / W switch zoom; T jumps to now; `/`
 * focuses plate search.
 */
export function gridKey(
  key: string,
  focus: GridFocus,
  blockCounts: readonly number[],
): GridCommand {
  const rows = blockCounts.length;
  const countAt = (row: number): number => blockCounts[row] ?? 0;
  const clampBlock = (row: number, block: number | null): number | null => {
    const count = countAt(row);
    if (count === 0 || block === null) {
      return null;
    }
    return Math.min(Math.max(block, 0), count - 1);
  };
  switch (key) {
    case "ArrowDown":
    case "ArrowUp": {
      if (rows === 0) {
        return { type: "none" };
      }
      const row = Math.min(
        Math.max(focus.row + (key === "ArrowDown" ? 1 : -1), 0),
        rows - 1,
      );
      return {
        type: "focus",
        focus: { row, block: clampBlock(row, focus.block) },
      };
    }
    case "ArrowRight":
    case "ArrowLeft": {
      const count = countAt(focus.row);
      if (count === 0) {
        return { type: "none" };
      }
      const step = key === "ArrowRight" ? 1 : -1;
      const first = key === "ArrowRight" ? 0 : count - 1;
      const next = focus.block === null ? first : focus.block + step;
      return {
        type: "focus",
        focus: { row: focus.row, block: clampBlock(focus.row, next) },
      };
    }
    case "Home":
      return countAt(focus.row) === 0
        ? { type: "none" }
        : { type: "focus", focus: { row: focus.row, block: 0 } };
    case "End":
      return countAt(focus.row) === 0
        ? { type: "none" }
        : {
            type: "focus",
            focus: { row: focus.row, block: countAt(focus.row) - 1 },
          };
    case "Enter":
      return focus.block === null ? { type: "none" } : { type: "open", focus };
    case "d":
    case "D":
      return { type: "zoom", zoom: "day" };
    case "w":
    case "W":
      return { type: "zoom", zoom: "week" };
    case "t":
    case "T":
      return { type: "now" };
    case "/":
      return { type: "search" };
    default:
      return { type: "none" };
  }
}

// ── Virtual rows (tested to 200+) ─────────────────────────────────────────

export interface VirtualWindow {
  readonly start: number;
  /** Exclusive. */
  readonly end: number;
  readonly padTop: number;
  readonly padBottom: number;
}

export function visibleWindow(input: {
  readonly scrollTop: number;
  readonly viewportHeight: number;
  readonly rowHeight: number;
  readonly total: number;
  readonly overscan?: number;
}): VirtualWindow {
  const overscan = input.overscan ?? 4;
  if (input.total === 0) {
    return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  }
  const first = Math.floor(Math.max(input.scrollTop, 0) / input.rowHeight);
  const visible = Math.ceil(input.viewportHeight / input.rowHeight) + 1;
  const start = Math.min(Math.max(first - overscan, 0), input.total - 1);
  const end = Math.min(first + visible + overscan, input.total);
  return {
    start,
    end,
    padTop: start * input.rowHeight,
    padBottom: (input.total - end) * input.rowHeight,
  };
}

/** The scrollTop that brings `row` into view (unchanged if it already is). */
export function scrollTopFor(
  row: number,
  view: {
    readonly scrollTop: number;
    readonly viewportHeight: number;
    readonly rowHeight: number;
  },
): number {
  const top = row * view.rowHeight;
  const bottom = top + view.rowHeight;
  if (top < view.scrollTop) {
    return top;
  }
  if (bottom > view.scrollTop + view.viewportHeight) {
    return bottom - view.viewportHeight;
  }
  return view.scrollTop;
}
