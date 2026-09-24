/**
 * The zone arithmetic every shift, week and settlement figure rests on:
 * local wall clock → real instants through the zone's own rules, with the
 * DST gap resolved forward and the repeated hour resolved to the earlier
 * instant; shift decomposition into the database's local-day segments.
 */
import { describe, expect, it } from "vitest";

import { parseRrule } from "../src/ops/availability";
import { resolveShift, shiftIntervals, shiftSegments } from "../src/ops/shifts";
import { FLEET_POLICY_DEFAULTS } from "../src/contract";
import {
  hours2dp,
  iso,
  localDateOf,
  localToInstant,
  subtractIntervals,
  totalMs,
} from "../src/lib/time";

describe("local time", () => {
  it("maps Lagos wall clock with its fixed offset", () => {
    expect(iso(localToInstant("2026-09-28", "06:00", "Africa/Lagos"))).toBe(
      "2026-09-28T05:00:00.000Z",
    );
    expect(
      localDateOf(Date.parse("2026-09-27T23:30:00Z"), "Africa/Lagos"),
    ).toBe("2026-09-28");
  });

  it("resolves the spring-forward gap forward and the fall-back hour to the earlier instant", () => {
    // Europe/London 2027-03-28: 01:00 GMT → 02:00 BST; 01:30 does not exist.
    expect(iso(localToInstant("2027-03-28", "01:30", "Europe/London"))).toBe(
      "2027-03-28T01:30:00.000Z",
    );
    // 2026-10-25: 01:30 happens twice (BST then GMT): the earlier is 00:30Z.
    expect(iso(localToInstant("2026-10-25", "01:30", "Europe/London"))).toBe(
      "2026-10-25T00:30:00.000Z",
    );
  });

  it("gives a full shift 23 / 25 real hours on DST days", () => {
    const full = resolveShift("full", FLEET_POLICY_DEFAULTS);
    const day = (date: string) =>
      hours2dp(
        totalMs(
          shiftIntervals(full, "Europe/London", date, null, {
            start: Date.parse(`${date}T00:00:00Z`) - 3_600_000,
            end: Date.parse(`${date}T00:00:00Z`) + 2 * 86_400_000,
          }).slice(0, 1),
        ),
      );
    expect(day("2027-03-28")).toBe(23);
    expect(day("2026-10-25")).toBe(25);
  });

  it("decomposes shifts into local-day segments the EXCLUDE constraints compare", () => {
    expect(shiftSegments(resolveShift("day", FLEET_POLICY_DEFAULTS))).toEqual([
      { dayOffset: 0, minuteFrom: 360, minuteTo: 1080 },
    ]);
    expect(shiftSegments(resolveShift("night", FLEET_POLICY_DEFAULTS))).toEqual(
      [
        { dayOffset: 0, minuteFrom: 1080, minuteTo: 1440 },
        { dayOffset: 1, minuteFrom: 0, minuteTo: 360 },
      ],
    );
    expect(shiftSegments(resolveShift("full", FLEET_POLICY_DEFAULTS))).toEqual([
      { dayOffset: 0, minuteFrom: 0, minuteTo: 1440 },
    ]);
    expect(
      shiftSegments(
        resolveShift({ start: "22:00", end: "00:00" }, FLEET_POLICY_DEFAULTS),
      ),
    ).toEqual([{ dayOffset: 0, minuteFrom: 1320, minuteTo: 1440 }]);
  });

  it("subtracts intervals without double counting", () => {
    expect(
      subtractIntervals(
        [{ start: 0, end: 10 }],
        [
          { start: 2, end: 4 },
          { start: 3, end: 6 },
        ],
      ),
    ).toEqual([
      { start: 0, end: 2 },
      { start: 6, end: 10 },
    ]);
  });

  it("accepts the supported rrule subset and refuses the rest", () => {
    expect(parseRrule("FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4")).toEqual({
      freq: "WEEKLY",
      byDay: [1, 3],
      count: 4,
      until: null,
    });
    expect(parseRrule("FREQ=DAILY;UNTIL=20261031")).toEqual({
      freq: "DAILY",
      byDay: null,
      count: null,
      until: "2026-10-31",
    });
    expect(() => parseRrule("FREQ=MONTHLY")).toThrow();
    expect(() => parseRrule("FREQ=DAILY;INTERVAL=2")).toThrow();
  });
});
