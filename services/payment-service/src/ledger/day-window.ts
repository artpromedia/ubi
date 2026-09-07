/**
 * Calendar-day boundaries in a city's own timezone.
 *
 * A daily transfer limit and a daily reconciliation are both "per business day
 * in the city", and the timezone comes from city config (CLAUDE.md #1) — never
 * from the server's locale and never assumed to be UTC.
 */
import { ContractError } from "@ubi/contracts";

export interface DayWindow {
  readonly start: Date;
  readonly end: Date;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Milliseconds that must be subtracted from a wall-clock reading to get UTC. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) {
      throw new ContractError(
        "internal_error",
        `timezone ${timeZone} produced no ${type}`,
      );
    }
    return Number.parseInt(part.value, 10);
  };
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
  return asUtc - instant.getTime();
}

/** Instant of local midnight starting `isoDate` in `timeZone`. */
function localMidnight(isoDate: string, timeZone: string): Date {
  const year = Number.parseInt(isoDate.slice(0, 4), 10);
  const month = Number.parseInt(isoDate.slice(5, 7), 10);
  const day = Number.parseInt(isoDate.slice(8, 10), 10);
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  // Two passes so a DST change on the day itself still lands on real midnight.
  let candidate = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
  candidate = new Date(naive - zoneOffsetMs(candidate, timeZone));
  return candidate;
}

export function assertIsoDate(value: string): string {
  if (!ISO_DATE.test(value)) {
    throw new ContractError(
      "validation_failed",
      "date must be formatted YYYY-MM-DD",
      {
        value,
      },
    );
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new ContractError(
      "validation_failed",
      "date is not a real calendar date",
      {
        value,
      },
    );
  }
  return value;
}

/** `[start, end)` covering the whole of `isoDate` in `timeZone`. */
export function dayWindow(isoDate: string, timeZone: string): DayWindow {
  assertIsoDate(isoDate);
  const start = localMidnight(isoDate, timeZone);
  const next = new Date(`${isoDate}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const end = localMidnight(next.toISOString().slice(0, 10), timeZone);
  return { start, end };
}

/** `[start, end)` spanning `fromDate`..`toDate` inclusive, in `timeZone`. */
export function rangeWindow(
  fromDate: string,
  toDate: string,
  timeZone: string,
): DayWindow {
  const from = dayWindow(fromDate, timeZone);
  const to = dayWindow(toDate, timeZone);
  if (to.end.getTime() <= from.start.getTime()) {
    throw new ContractError(
      "validation_failed",
      "`to` must not be before `from`",
      {
        from: fromDate,
        to: toDate,
      },
    );
  }
  return { start: from.start, end: to.end };
}

/** The calendar date `instant` falls on, in `timeZone`. */
export function dateInZone(instant: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(instant);
}
