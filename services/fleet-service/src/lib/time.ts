/**
 * Local time in the fleet's city zone — the arithmetic every shift, week and
 * settlement figure rests on.
 *
 * Storage is UTC plus an IANA zone (handoff global rule 8). Shifts are local
 * wall-clock windows, days split at LOCAL midnight, and on a DST day a "full"
 * shift is 23 or 25 real hours: everything here converts wall clock to real
 * instants through the zone's own rules (Intl, full ICU in Node 22) rather
 * than adding fixed offsets. A local time that does not exist (the
 * spring-forward gap) resolves forward by the gap; one that happens twice
 * (fall back) resolves to the earlier instant — the same rule as
 * Temporal's "compatible" disambiguation.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export interface LocalParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

/** True when the runtime knows this IANA zone. */
export function isValidZone(zone: string): boolean {
  try {
    formatterFor(zone);
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(instant: Date | number, zone: string): LocalParts {
  const parts = formatterFor(zone).formatToParts(
    typeof instant === "number" ? new Date(instant) : instant,
  );
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part === undefined ? 0 : Number.parseInt(part.value, 10);
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

/** The zone's UTC offset at an instant, in ms (local = utc + offset). */
export function offsetMs(instant: number, zone: string): number {
  const p = zonedParts(instant, zone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  const truncated = Math.floor(instant / 1000) * 1000;
  return asUtc - truncated;
}

function wallClockMs(date: string, time: string): number {
  const [y, m, d] = date.split("-").map((part) => Number.parseInt(part, 10));
  const [hh, mm] = time.split(":").map((part) => Number.parseInt(part, 10));
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0);
}

/**
 * The real instant of a local date and wall-clock time in `zone`. Gaps move
 * forward by the gap; repeated times take the earlier instant.
 */
export function localToInstant(
  date: string,
  time: string,
  zone: string,
): number {
  const wall = wallClockMs(date, time);
  const before = offsetMs(wall - 12 * HOUR_MS, zone);
  const after = offsetMs(wall + 12 * HOUR_MS, zone);
  const candidates = [wall - before, wall - after].filter(
    (candidate) => candidate + offsetMs(candidate, zone) === wall,
  );
  if (candidates.length > 0) {
    return Math.min(...candidates);
  }
  // The gap: read with the offset in force before the transition, which lands
  // the same distance past the gap's end.
  return wall - before;
}

export function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** The local calendar date of an instant, `YYYY-MM-DD`. */
export function localDateOf(instant: number, zone: string): string {
  const p = zonedParts(instant, zone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** The local wall-clock time of an instant, `HH:mm`. */
export function localTimeOf(instant: number, zone: string): string {
  const p = zonedParts(instant, zone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** Pure calendar arithmetic on `YYYY-MM-DD` (no zone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map((part) => Number.parseInt(part, 10));
  const shifted = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map((part) => Number.parseInt(part, 10));
  const day = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Local midnight at the start of `date`. */
export function startOfLocalDay(date: string, zone: string): number {
  return localToInstant(date, "00:00", zone);
}

export function minutesOf(time: string): number {
  const [hh, mm] = time.split(":").map((part) => Number.parseInt(part, 10));
  return (hh ?? 0) * 60 + (mm ?? 0);
}

/** A `Date` from Prisma's `@db.Date` column as the calendar date it stores. */
export function dateColumnToLocalDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** A calendar date as the value Prisma writes to a `@db.Date` column. */
export function localDateToDateColumn(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

// ── Intervals (half-open [start, end), epoch ms) ───────────────────────────

export interface Interval {
  readonly start: number;
  readonly end: number;
}

export function intersect(a: Interval, b: Interval): Interval | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? { start, end } : null;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return intersect(a, b) !== null;
}

/** Sorted, non-overlapping union. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals]
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && interval.start <= last.end) {
      merged[merged.length - 1] = {
        start: last.start,
        end: Math.max(last.end, interval.end),
      };
    } else {
      merged.push(interval);
    }
  }
  return merged;
}

/** Every piece of `a` that no interval of `b` covers. */
export function subtractIntervals(
  a: readonly Interval[],
  b: readonly Interval[],
): Interval[] {
  const minus = mergeIntervals(b);
  const out: Interval[] = [];
  for (const piece of mergeIntervals(a)) {
    let cursor = piece.start;
    for (const cut of minus) {
      if (cut.end <= cursor || cut.start >= piece.end) {
        continue;
      }
      if (cut.start > cursor) {
        out.push({ start: cursor, end: cut.start });
      }
      cursor = Math.max(cursor, cut.end);
    }
    if (cursor < piece.end) {
      out.push({ start: cursor, end: piece.end });
    }
  }
  return out;
}

/** The union of `a` intersected with the union of `b`. */
export function intersectAll(
  a: readonly Interval[],
  b: readonly Interval[],
): Interval[] {
  const out: Interval[] = [];
  const left = mergeIntervals(a);
  const right = mergeIntervals(b);
  for (const x of left) {
    for (const y of right) {
      const piece = intersect(x, y);
      if (piece !== null) {
        out.push(piece);
      }
    }
  }
  return mergeIntervals(out);
}

export function totalMs(intervals: readonly Interval[]): number {
  return mergeIntervals(intervals).reduce(
    (sum, interval) => sum + (interval.end - interval.start),
    0,
  );
}

/** Decimal hours, two places, half up (contract B). */
export function hours2dp(ms: number): number {
  return Math.round(ms / 36_000) / 100;
}

export function iso(instant: number): string {
  return new Date(instant).toISOString();
}
