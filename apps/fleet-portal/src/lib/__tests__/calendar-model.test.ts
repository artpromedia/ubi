/**
 * The calendar model (B1–B3): block text and lanes from the server's
 * calendar, opaque bookings, "Unavailable" for time off, the week grid and
 * its month boundary, the agenda equivalent, the keyboard model, virtual
 * rows at 200+, and how controls become the server query.
 */
import { describe, expect, it } from "vitest";

import {
  calendarQuery,
  calendarRange,
  controlsFromSearch,
  controlsToSearch,
  defaultControls,
  mergePages,
  showingText,
  stepDate,
} from "../calendar-controls";
import {
  agendaEntries,
  buildTimelineRows,
  gridKey,
  placeOnRuler,
  scrollTopFor,
  sortAgenda,
  visibleWindow,
  weekGrid,
} from "../calendar-model";
import { dayRuler } from "../time";
import {
  dayCalendar,
  driverCalendar,
  VEH,
  weekCalendar,
  ZONE,
} from "./fixtures";

import type { FleetCalendar } from "../fleet-types";

describe("buildTimelineRows — vehicle rows (B1)", () => {
  const rows = buildTimelineRows(dayCalendar, { zone: ZONE });
  const kj = rows[0];
  const ab = rows[1];

  it("puts assignments + maintenance on lane 0 and opaque bookings on lane 1", () => {
    expect(kj?.lanes).toBe(2);
    expect(
      kj?.blocks
        .filter((block) => block.layer === "Booking")
        .every((block) => block.lane === 1),
    ).toBe(true);
    expect(
      kj?.blocks
        .filter((block) => block.layer === "Assignment")
        .every((block) => block.lane === 0),
    ).toBe(true);
    expect(
      ab?.blocks
        .filter((block) => block.layer === "Maintenance")
        .every((block) => block.lane === 0),
    ).toBe(true);
  });

  it("shows a booking only as its time and the server's risk", () => {
    const booked = kj?.blocks.find((block) => block.layer === "Booking");
    expect(booked?.label).toBe("Booked · 07:15–09:40");
    expect(booked?.status).toBe("Confirmed");
    const atRisk = ab?.blocks.find((block) => block.layer === "Booking");
    expect(atRisk?.label).toBe("At risk · Booked · 11:20–13:00");
    expect(atRisk?.status).toBe("At risk · needs a decision by 30 Sep 09:20");
    expect(atRisk?.accessibleName).toBe(
      "LAG-118-AB, Booked, 11:20 to 13:00 West Africa Time, at risk · needs a decision by 30 Sep 09:20",
    );
  });

  it("labels shifts and maintenance in words, in time order", () => {
    expect(ab?.blocks.map((block) => block.label)).toEqual([
      "Bola A. · Day shift 06:00–18:00",
      "Planned service · Needs resolution · 10:00–15:00",
      "At risk · Booked · 11:20–13:00",
    ]);
    expect(ab?.flags).toEqual([
      "Conflict",
      "Booking at risk",
      "Document expiring",
    ]);
    expect(ab?.documents).toEqual(["Insurance expiring · 15 Oct"]);
    expect(ab?.hasConflict).toBe(true);
    expect(kj?.summary).toBe("In service");
  });

  it("shows a UBI decision as status only, with no reason", () => {
    const qd = rows[2];
    expect(qd?.summary).toBe("Document expired · enforced by UBI");
    expect(qd?.blocks[0]?.label).toBe(
      "Document expired · status only · decided by UBI",
    );
    expect(qd?.blocks[0]?.status).toBe("Status only · no override");
  });

  it("counts blocks outside 06:00–22:00 so the agenda can show them", () => {
    const placed = placeOnRuler(
      kj as NonNullable<typeof kj>,
      dayRuler("2026-09-30", ZONE),
    );
    expect(placed.outside).toBe(1);
    expect(placed.placed).toHaveLength(2);
  });
});

describe("buildTimelineRows — driver rows (B3)", () => {
  const [tunde] = buildTimelineRows(driverCalendar, {
    zone: ZONE,
    plates: new Map([[VEH.mm, "LAG-744-MM"]]),
  });

  it("uses three lanes: availability, shift + maintenance, bookings", () => {
    expect(tunde?.lanes).toBe(3);
    const lanes = Object.fromEntries(
      (tunde?.blocks ?? []).map((block) => [block.label, block.lane]),
    );
    expect(lanes).toEqual({
      "Available · set by driver": 0,
      "Unavailable · set by driver": 0,
      "Shift · LAG-744-MM": 1,
      "Booked · 08:00–09:30": 2,
    });
  });

  it("never calls the driver's time off anything but Unavailable, read-only", () => {
    const text = JSON.stringify(tunde);
    expect(text).not.toMatch(/time off|time_off|reason/i);
    const unavailable = tunde?.blocks.find(
      (block) => block.kind === "unavailable",
    );
    expect(unavailable?.status).toBe("Set by the driver · read-only");
  });

  it("summarises hours from the server", () => {
    expect(tunde?.summary).toBe("8 h signed shift · 1 booked");
  });
});

describe("week grid (B2)", () => {
  const grid = weekGrid(weekCalendar);

  it("labels the month boundary in the column header", () => {
    expect(
      grid.columns.map((column) => `${column.day} ${column.month}`),
    ).toEqual([
      "Mon 28 Sep",
      "Tue 29 Sep",
      "Wed 30 Sep",
      "Thu 1 Oct · new month",
      "Fri 2 Oct",
      "Sat 3 Oct",
      "Sun 4 Oct",
    ]);
  });

  it("summarises each day from the server's day summaries", () => {
    const ab = grid.rows.find((row) => row.row.rowId === VEH.ab);
    expect(
      ab?.cells.map((cell) => [cell.primary, cell.secondary, cell.tone]),
    ).toEqual([
      ["No shift", "", "empty"],
      ["No bookings", "Day 06:00–18:00", "normal"],
      ["At risk", "1 booked · needs a decision", "conflict"],
      ["2 booked", "Day 06:00–18:00", "normal"],
      ["Maintenance", "", "maintenance"],
      ["No shift", "", "empty"],
      ["No shift", "", "empty"],
    ]);
  });

  it("marks days after a document expiry as enforced by UBI", () => {
    const qd = grid.rows.find((row) => row.row.rowId === VEH.qd);
    expect(
      qd?.cells.every(
        (cell) =>
          cell.primary === "Document expired" && cell.tone === "expired",
      ),
    ).toBe(true);
  });
});

describe("agenda / table equivalent", () => {
  const rows = buildTimelineRows(dayCalendar, { zone: ZONE });

  it("lists every block, including those outside the ruler", () => {
    const entries = agendaEntries(rows, ZONE);
    expect(entries).toHaveLength(
      rows.reduce((sum, row) => sum + row.blocks.length, 0),
    );
    expect(entries.some((entry) => entry.start === "30 Sep 22:30")).toBe(true);
  });

  it("sorts by any column, both ways", () => {
    const entries = agendaEntries(rows, ZONE);
    const byStart = sortAgenda(entries, "start", "asc").map(
      (entry) => entry.startsAt,
    );
    expect(byStart).toEqual([...byStart].sort());
    const byRowDesc = sortAgenda(entries, "row", "desc").map(
      (entry) => entry.row,
    );
    expect(byRowDesc[0]).toBe("LAG-551-QD");
  });
});

describe("keyboard model", () => {
  const counts = [2, 0, 3];

  it("moves between rows with Up/Down and blocks with Left/Right", () => {
    expect(gridKey("ArrowDown", { row: 0, block: 1 }, counts)).toEqual({
      type: "focus",
      focus: { row: 1, block: null },
    });
    expect(gridKey("ArrowDown", { row: 1, block: null }, counts)).toEqual({
      type: "focus",
      focus: { row: 2, block: null },
    });
    expect(gridKey("ArrowUp", { row: 0, block: null }, counts)).toEqual({
      type: "focus",
      focus: { row: 0, block: null },
    });
    expect(gridKey("ArrowRight", { row: 2, block: null }, counts)).toEqual({
      type: "focus",
      focus: { row: 2, block: 0 },
    });
    expect(gridKey("ArrowRight", { row: 2, block: 2 }, counts)).toEqual({
      type: "focus",
      focus: { row: 2, block: 2 },
    });
    expect(gridKey("ArrowLeft", { row: 2, block: null }, counts)).toEqual({
      type: "focus",
      focus: { row: 2, block: 2 },
    });
    expect(gridKey("ArrowDown", { row: 0, block: 1 }, [2, 3])).toEqual({
      type: "focus",
      focus: { row: 1, block: 1 },
    });
    expect(gridKey("ArrowRight", { row: 1, block: null }, counts)).toEqual({
      type: "none",
    });
  });

  it("opens with Enter, zooms with D / W, jumps to now with T and searches with /", () => {
    expect(gridKey("Enter", { row: 2, block: 1 }, counts)).toEqual({
      type: "open",
      focus: { row: 2, block: 1 },
    });
    expect(gridKey("Enter", { row: 2, block: null }, counts)).toEqual({
      type: "none",
    });
    expect(gridKey("d", { row: 0, block: null }, counts)).toEqual({
      type: "zoom",
      zoom: "day",
    });
    expect(gridKey("W", { row: 0, block: null }, counts)).toEqual({
      type: "zoom",
      zoom: "week",
    });
    expect(gridKey("t", { row: 0, block: null }, counts)).toEqual({
      type: "now",
    });
    expect(gridKey("/", { row: 0, block: null }, counts)).toEqual({
      type: "search",
    });
  });
});

describe("virtual rows (tested to 200+)", () => {
  it("renders only a window of fixed-height rows and pads the rest", () => {
    const total = 240;
    const top = visibleWindow({
      scrollTop: 0,
      viewportHeight: 560,
      rowHeight: 72,
      total,
    });
    expect(top.start).toBe(0);
    expect(top.end).toBeLessThan(20);
    expect(top.padBottom).toBe((total - top.end) * 72);
    const middle = visibleWindow({
      scrollTop: 150 * 72,
      viewportHeight: 560,
      rowHeight: 72,
      total,
    });
    expect(middle.start).toBe(146);
    expect(middle.end - middle.start).toBeLessThan(20);
    expect(
      middle.padTop + (middle.end - middle.start) * 72 + middle.padBottom,
    ).toBe(total * 72);
    const bottom = visibleWindow({
      scrollTop: total * 72,
      viewportHeight: 560,
      rowHeight: 72,
      total,
    });
    expect(bottom.end).toBe(total);
    expect(
      visibleWindow({
        scrollTop: 0,
        viewportHeight: 560,
        rowHeight: 72,
        total: 0,
      }),
    ).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
  });

  it("scrolls a keyboard-focused row into view", () => {
    expect(
      scrollTopFor(200, { scrollTop: 0, viewportHeight: 560, rowHeight: 72 }),
    ).toBe(201 * 72 - 560);
    expect(
      scrollTopFor(3, {
        scrollTop: 72 * 10,
        viewportHeight: 560,
        rowHeight: 72,
      }),
    ).toBe(216);
    expect(
      scrollTopFor(12, {
        scrollTop: 72 * 10,
        viewportHeight: 560,
        rowHeight: 72,
      }),
    ).toBe(720);
  });
});

describe("calendar controls → server query", () => {
  it("splits days and weeks at local midnight", () => {
    const day = defaultControls("2026-09-30");
    expect(calendarRange(day, ZONE)).toEqual({
      from: "2026-09-29T23:00:00.000Z",
      to: "2026-09-30T23:00:00.000Z",
    });
    expect(calendarRange({ ...day, zoom: "week" }, ZONE)).toEqual({
      from: "2026-09-27T23:00:00.000Z",
      to: "2026-10-04T23:00:00.000Z",
    });
    expect(stepDate({ ...day, zoom: "week" }, 1)).toBe("2026-10-07");
    expect(stepDate(day, -1)).toBe("2026-09-29");
  });

  it("sends filters and search to the server, 40 rows a page", () => {
    const query = calendarQuery(
      {
        ...defaultControls("2026-09-30"),
        vehicleClass: "comfort",
        status: "maintenance",
        conflictsOnly: true,
        q: " LAG ",
      },
      ZONE,
    );
    expect(query).toMatchObject({
      vehicleClass: "comfort",
      status: "maintenance",
      conflictsOnly: true,
      q: "LAG",
      limit: 40,
    });
    const drivers = calendarQuery(
      {
        ...defaultControls("2026-09-30"),
        rows: "drivers",
        vehicleClass: "comfort",
      },
      ZONE,
    );
    expect(drivers.vehicleClass).toBeUndefined();
  });

  it("round-trips through the URL", () => {
    const controls = {
      ...defaultControls("2026-09-30"),
      zoom: "week" as const,
      rows: "drivers" as const,
      q: "Bola",
      conflictsOnly: true,
      layers: ["bookings" as const],
    };
    const parsed = controlsFromSearch(
      new URLSearchParams(controlsToSearch(controls)),
      "2026-01-01",
    );
    expect(parsed).toEqual(controls);
    expect(
      controlsFromSearch(
        new URLSearchParams("date=nonsense&status=bogus"),
        "2026-09-30",
      ),
    ).toEqual(defaultControls("2026-09-30"));
  });

  it("merges server pages and says how many rows are shown", () => {
    const second: FleetCalendar = {
      ...dayCalendar,
      rows: [dayCalendar.rows[0] as FleetCalendar["rows"][number]],
      nextCursor: null,
    };
    const merged = mergePages([dayCalendar, second]);
    expect(merged?.rows).toHaveLength(5);
    expect(merged?.nextCursor).toBeNull();
    expect(showingText(dayCalendar)).toBe("Showing 1–4 of 212 vehicles");
    expect(mergePages([])).toBeUndefined();
  });
});
