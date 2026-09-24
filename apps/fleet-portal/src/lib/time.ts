/**
 * The fleet's city time, labelled (handoff global rule 8).
 *
 * The server stores UTC plus an IANA zone and every response carries `zone`.
 * The portal shows city local time with the zone labelled
 * ("Africa/Lagos · WAT (UTC+1)"), splits days at LOCAL midnight and, on a DST
 * day, lets the ruler repeat or skip the hour with its label — it converts
 * wall clock to real instants through the zone's own rules (Intl) rather
 * than adding fixed offsets, the same way fleet-service's lib/time.ts does.
 * A local time that does not exist resolves forward by the gap; one that
 * happens twice resolves to the earlier instant.
 *
 * Nothing here decides availability or money: it only places server
 * instants on a ruler and turns form input into instants for the server.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

interface LocalParts {
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

export function isValidZone(zone: string): boolean {
  try {
    formatterFor(zone);
    return true;
  } catch {
    return false;
  }
}

function zonedParts(instant: number, zone: string): LocalParts {
  const parts = formatterFor(zone).formatToParts(new Date(instant));
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
  return asUtc - Math.floor(instant / 1000) * 1000;
}

export const pad2 = (value: number): string =>
  value < 10 ? `0${value}` : String(value);

function splitDate(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map((part) => Number.parseInt(part, 10));
  return [y ?? 1970, m ?? 1, d ?? 1];
}

/** The real instant of a local date + `HH:mm` in `zone`. */
export function localToInstant(
  date: string,
  time: string,
  zone: string,
): number {
  const [y, m, d] = splitDate(date);
  const [hh, mm] = time.split(":").map((part) => Number.parseInt(part, 10));
  const wall = Date.UTC(y, m - 1, d, hh ?? 0, mm ?? 0);
  const before = offsetMs(wall - 12 * HOUR_MS, zone);
  const after = offsetMs(wall + 12 * HOUR_MS, zone);
  const candidates = [wall - before, wall - after].filter(
    (candidate) => candidate + offsetMs(candidate, zone) === wall,
  );
  if (candidates.length > 0) {
    return Math.min(...candidates);
  }
  return wall - before;
}

export function localDateOf(instant: number, zone: string): string {
  const p = zonedParts(instant, zone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export function localTimeOf(instant: number, zone: string): string {
  const p = zonedParts(instant, zone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = splitDate(date);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** Order two ISO strings (dates or instants in the same format). */
export function compareDates(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** The Monday on or before a local date. */
export function mondayOf(date: string): string {
  const [y, m, d] = splitDate(date);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

export const startOfLocalDay = (date: string, zone: string): number =>
  localToInstant(date, "00:00", zone);

export const toIso = (instant: number): string =>
  new Date(instant).toISOString();

const ms = (iso: string): number => new Date(iso).getTime();

// ── Zone labels ────────────────────────────────────────────────────────────

/** Abbreviations the pilot markets use, where Intl only knows "GMT+1". */
const KNOWN_ABBREVIATIONS: Readonly<Record<string, string>> = {
  "Africa/Lagos": "WAT",
  "Africa/Nairobi": "EAT",
  "Africa/Johannesburg": "SAST",
  "Africa/Kigali": "CAT",
  "Africa/Accra": "GMT",
};

/** "UTC+1", "UTC+5:30", "UTC". */
export function offsetLabel(zone: string, at: number): string {
  const minutes = Math.round(offsetMs(at, zone) / MINUTE_MS);
  if (minutes === 0) {
    return "UTC";
  }
  const sign = minutes > 0 ? "+" : "−";
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  return `UTC${sign}${hours}${rest === 0 ? "" : `:${pad2(rest)}`}`;
}

function intlZoneName(
  zone: string,
  at: number,
  style: "short" | "long",
): string | null {
  try {
    const part = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      timeZoneName: style,
    })
      .formatToParts(new Date(at))
      .find((candidate) => candidate.type === "timeZoneName");
    return part?.value ?? null;
  } catch {
    return null;
  }
}

export function zoneAbbreviation(zone: string, at: number): string | null {
  const known = KNOWN_ABBREVIATIONS[zone];
  if (known !== undefined) {
    return known;
  }
  const short = intlZoneName(zone, at, "short");
  return short === null || /^(GMT|UTC)[+−-]/.test(short) ? null : short;
}

/** "Africa/Lagos · WAT (UTC+1)" — the label every portal time sits under. */
export function zoneLabel(zone: string, at: number): string {
  const abbreviation = zoneAbbreviation(zone, at);
  const offset = offsetLabel(zone, at);
  return abbreviation === null
    ? `${zone} · ${offset}`
    : `${zone} · ${abbreviation} (${offset})`;
}

/** "WAT" (or "UTC+1") — the suffix for a time shown inline. */
export const zoneShort = (zone: string, at: number): string =>
  zoneAbbreviation(zone, at) ?? offsetLabel(zone, at);

/** "West Africa Time" — for accessible names. */
export const zoneLongName = (zone: string, at: number): string =>
  intlZoneName(zone, at, "long") ?? zone;

// ── Dates and ranges ──────────────────────────────────────────────────────

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function weekdayOf(date: string): string {
  const [y, m, d] = splitDate(date);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
}

export const monthOf = (date: string): string =>
  MONTHS[splitDate(date)[1] - 1] ?? "";

/** "Tue 30 Sep 2026". */
export function dayLabel(date: string): string {
  const [y, , d] = splitDate(date);
  return `${weekdayOf(date)} ${d} ${monthOf(date)} ${y}`;
}

/** "30 Sep". */
export const shortDate = (date: string): string =>
  `${splitDate(date)[2]} ${monthOf(date)}`;

/** "30 Sep 10:02" in the zone. */
export function dateTimeIn(iso: string, zone: string): string {
  const instant = ms(iso);
  return `${shortDate(localDateOf(instant, zone))} ${localTimeOf(instant, zone)}`;
}

/** "07:15–09:40", or with dates when the range crosses local midnight. */
export function timeRangeIn(
  startIso: string,
  endIso: string | null,
  zone: string,
): string {
  const start = ms(startIso);
  if (endIso === null) {
    return `from ${dateTimeIn(startIso, zone)}`;
  }
  const end = ms(endIso);
  const startDate = localDateOf(start, zone);
  const endDate = localDateOf(end - 1, zone);
  if (startDate === endDate) {
    // A range that ends at the next local midnight ends at "24:00".
    const endTime = localTimeOf(end, zone);
    return `${localTimeOf(start, zone)}–${endTime === "00:00" ? "24:00" : endTime}`;
  }
  return `${dateTimeIn(startIso, zone)}–${dateTimeIn(endIso, zone)}`;
}

/** "29 Sep – 5 Oct 2026" (inclusive last date). */
export function weekRangeLabel(first: string, last: string): string {
  const [fy] = splitDate(first);
  const [ly] = splitDate(last);
  return fy === ly
    ? `${shortDate(first)} – ${shortDate(last)} ${ly}`
    : `${shortDate(first)} ${fy} – ${shortDate(last)} ${ly}`;
}

// ── The day ruler (B1 / B3) ───────────────────────────────────────────────

export interface RulerTick {
  readonly label: string;
  readonly pct: number;
}

export interface DayRuler {
  readonly date: string;
  readonly start: number;
  readonly end: number;
  readonly ticks: readonly RulerTick[];
  /** The day's real length in hours (23 or 25 on a DST day). */
  readonly dayHours: number;
  /** "Sun 29 Mar · 23-hour day · 01:00 is skipped" on a DST day, else null. */
  readonly dstNote: string | null;
}

/**
 * The 06:00–22:00 ruler for a local date. Ticks are real instants every two
 * hours from the ruler start, labelled with their LOCAL time, so a DST day
 * repeats or skips a label instead of lying about the hour.
 */
export function dayRuler(
  date: string,
  zone: string,
  from = "06:00",
  to = "22:00",
): DayRuler {
  const start = localToInstant(date, from, zone);
  const end = localToInstant(date, to, zone);
  const span = end - start;
  const ticks: RulerTick[] = [];
  for (let at = start; at <= end; at += 2 * HOUR_MS) {
    ticks.push({
      label: localTimeOf(at, zone),
      pct: ((at - start) / span) * 100,
    });
  }
  const dayStart = startOfLocalDay(date, zone);
  const dayEnd = startOfLocalDay(addDays(date, 1), zone);
  const dayHours = Math.round((dayEnd - dayStart) / HOUR_MS);
  let dstNote: string | null = null;
  if (dayHours !== 24) {
    const seen = new Map<string, number>();
    let changed: string | null = null;
    for (let at = dayStart; at < dayEnd; at += HOUR_MS) {
      const label = localTimeOf(at, zone);
      seen.set(label, (seen.get(label) ?? 0) + 1);
      if ((seen.get(label) ?? 0) > 1) {
        changed = label;
      }
    }
    if (dayHours > 24) {
      dstNote = `${weekdayOf(date)} ${shortDate(date)} · ${dayHours}-hour day · ${changed ?? "an hour"} happens twice`;
    } else {
      let skipped: string | null = null;
      for (let hour = 0; hour < 24; hour += 1) {
        const label = `${pad2(hour)}:00`;
        if (!seen.has(label)) {
          skipped = label;
          break;
        }
      }
      dstNote = `${weekdayOf(date)} ${shortDate(date)} · ${dayHours}-hour day · ${skipped ?? "an hour"} is skipped`;
    }
  }
  return { date, start, end, ticks, dayHours, dstNote };
}

export interface RulerSpan {
  readonly leftPct: number;
  readonly widthPct: number;
  readonly clippedStart: boolean;
  readonly clippedEnd: boolean;
}

/** Where an interval sits on the ruler, or null when it is entirely outside. */
export function spanOn(
  ruler: DayRuler,
  startIso: string,
  endIso: string | null,
): RulerSpan | null {
  const start = ms(startIso);
  const end = endIso === null ? ruler.end : ms(endIso);
  if (!(end > ruler.start) || !(start < ruler.end)) {
    return null;
  }
  const span = ruler.end - ruler.start;
  const from = Math.max(start, ruler.start);
  const to = Math.min(end, ruler.end);
  return {
    leftPct: ((from - ruler.start) / span) * 100,
    widthPct: Math.max(((to - from) / span) * 100, 0.8),
    clippedStart: start < ruler.start,
    clippedEnd: end > ruler.end,
  };
}

/** The "now" marker position, or null when now is not on this ruler. */
export function nowOn(ruler: DayRuler, now: number): number | null {
  if (now < ruler.start || now > ruler.end) {
    return null;
  }
  return ((now - ruler.start) / (ruler.end - ruler.start)) * 100;
}

/** A `YYYY-MM-DD` + `HH:mm` form value in the city zone, as an ISO instant. */
export const localInputToIso = (
  date: string,
  time: string,
  zone: string,
): string => toIso(localToInstant(date, time, zone));

/** "8 h" / "7.5 h" for a server's decimal hours (display only). */
export function hoursLabel(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} h`;
}
