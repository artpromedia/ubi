/**
 * Shifts: what a signed assignment's wall-clock window means in real time.
 *
 * A shift is a daily local window: `full` (00:00 → next 00:00), `day` and
 * `night` (the market's named windows, FleetPolicy.shifts) or a custom
 * `{start, end}`. An end at or before the start crosses midnight, so a night
 * shift 18:00-06:00 that starts on day D ends on D+1, and a full shift on a
 * DST day is 23 or 25 real hours — instants always come from the zone rules
 * (lib/time.ts), never from adding fixed hours.
 *
 * For the DATABASE the same shift becomes local-day SEGMENTS (a night shift
 * is two: [18:00, 24:00) on D and [00:00, 06:00) on D+1), which the EXCLUDE
 * constraints on fleet_assignment_shift_segments compare; the application
 * check and the database refusal use the same decomposition.
 */
import {
  addDays,
  compareDates,
  intersect,
  localDateOf,
  localToInstant,
  minutesOf,
  type Interval,
} from "../lib/time";

import type { FleetPolicy, FleetShift, FleetShiftInput } from "../contract";

export function resolveShift(
  input: FleetShiftInput,
  policy: FleetPolicy,
): FleetShift {
  if (typeof input === "string") {
    if (input === "full") {
      return { kind: "full", start: "00:00", end: "00:00" };
    }
    const named = policy.shifts[input];
    return { kind: input, start: named.start, end: named.end };
  }
  return { kind: "custom", start: input.start, end: input.end };
}

export interface ShiftSegment {
  /** 0 = the day the instance starts, 1 = the next day. */
  readonly dayOffset: 0 | 1;
  readonly minuteFrom: number;
  readonly minuteTo: number;
}

/** A shift as local-day minute segments. */
export function shiftSegments(shift: FleetShift): ShiftSegment[] {
  const start = minutesOf(shift.start);
  const end = minutesOf(shift.end);
  if (end > start) {
    return [{ dayOffset: 0, minuteFrom: start, minuteTo: end }];
  }
  const segments: ShiftSegment[] = [
    { dayOffset: 0, minuteFrom: start, minuteTo: 1440 },
  ];
  if (end > 0) {
    segments.push({ dayOffset: 1, minuteFrom: 0, minuteTo: end });
  }
  return segments;
}

/** The real interval of the instance that starts on local date `date`. */
export function shiftInstanceOn(
  shift: FleetShift,
  date: string,
  zone: string,
): Interval {
  const start = localToInstant(date, shift.start, zone);
  const crosses = minutesOf(shift.end) <= minutesOf(shift.start);
  const end = localToInstant(
    crosses ? addDays(date, 1) : date,
    shift.end,
    zone,
  );
  return { start, end };
}

/**
 * Every real interval of the shift inside `window`, for instances starting
 * on local dates in [validFrom, validTo) (validTo null = open-ended).
 */
export function shiftIntervals(
  shift: FleetShift,
  zone: string,
  validFrom: string,
  validTo: string | null,
  window: Interval,
): Interval[] {
  if (window.end <= window.start) {
    return [];
  }
  // An instance that starts the day before the window can still reach into it.
  let date = addDays(localDateOf(window.start, zone), -1);
  if (compareDates(date, validFrom) < 0) {
    date = validFrom;
  }
  const lastDate = localDateOf(window.end, zone);
  const out: Interval[] = [];
  let guard = 0;
  while (compareDates(date, lastDate) <= 0 && guard < 800) {
    guard += 1;
    if (validTo !== null && compareDates(date, validTo) >= 0) {
      break;
    }
    const piece = intersect(shiftInstanceOn(shift, date, zone), window);
    if (piece !== null) {
      out.push(piece);
    }
    date = addDays(date, 1);
  }
  return out;
}

/** "day 06:00–18:00" — the server's phrasing of a shift. */
export function shiftLabel(shift: FleetShift): string {
  if (shift.kind === "full") {
    return "full day";
  }
  return `${shift.kind} ${shift.start}–${shift.end}`;
}
