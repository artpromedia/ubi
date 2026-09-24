/**
 * Local-vs-UTC time for supplier data.
 *
 * Airlines publish schedule times as the LOCAL wall-clock time at each airport
 * (Duffel `departing_at: "2020-06-13T16:38:02"` next to the airport's IANA
 * `time_zone`). A local time without its zone is ambiguous, so the adapters
 * convert it to an instant here and keep both: the local time with its UTC
 * offset for display, and the UTC instant for arithmetic (connection times,
 * check-in cut-offs, "has this departed"). Hotel dates are calendar dates at
 * the property and stay dates — never shifted into UTC.
 *
 * Only `Intl` (full ICU ships with Node) is used; no time-zone data is bundled
 * here.
 */

const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The zone's offset from UTC, in minutes, at `instant`. */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

export interface ZonedTime {
  /** The local wall-clock time with its offset, e.g. `2020-06-13T16:38:02+01:00`. */
  readonly local: string;
  /** The same instant in UTC, ISO 8601. */
  readonly utc: string;
  readonly timeZone: string;
}

/**
 * Interprets a supplier's local wall-clock time in `timeZone`. Returns null
 * when either input is unusable — the caller then refuses the offer rather
 * than guess a zone.
 */
export function zonedLocalToUtc(
  local: string,
  timeZone: string,
): ZonedTime | null {
  const match = LOCAL_DATETIME.exec(local);
  if (match === null || !isValidTimeZone(timeZone)) {
    return null;
  }
  const [year, month, day, hour, minute, second] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? "0"),
  ];
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  // Two passes settle DST edges: the offset at the guessed instant, then at
  // the corrected one.
  let offset = zoneOffsetMinutes(new Date(wall), timeZone);
  let instant = wall - offset * 60_000;
  const corrected = zoneOffsetMinutes(new Date(instant), timeZone);
  if (corrected !== offset) {
    offset = corrected;
    instant = wall - offset * 60_000;
  }
  const pad = (n: number): string => String(n).padStart(2, "0");
  const localText = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}${formatOffset(offset)}`;
  return {
    local: localText,
    utc: new Date(instant).toISOString(),
    timeZone,
  };
}

/** A real calendar date in `YYYY-MM-DD` form (rejects 2026-02-30). */
export function isCalendarDate(value: string): boolean {
  const match = DATE_ONLY.exec(value);
  if (match === null) {
    return false;
  }
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`). */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

/**
 * The earliest calendar date still current anywhere on Earth (UTC−12). A
 * travel date before it is in the past for every traveller; a date on or after
 * it may still be "today" somewhere, so it is not refused on time zone alone.
 */
export function earliestCurrentDate(now: Date): string {
  return new Date(now.getTime() - 12 * 3_600_000).toISOString().slice(0, 10);
}

/** Age in whole years on `onDate` for someone born on `bornOn` (both `YYYY-MM-DD`). */
export function ageOn(bornOn: string, onDate: string): number {
  const [by, bm, bd] = bornOn.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const [oy, om, od] = onDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  let age = oy - by;
  if (om < bm || (om === bm && od < bd)) {
    age -= 1;
  }
  return age;
}
