// Plain-language copy and time formatting for the fleet calendar driver screens (A05,
// handoff C1–C5; docs/design/FLEET_CALENDAR_DECISIONS.md wins over the handoff where
// they differ). Everything here turns SERVER values into words: times into the city's
// local wall clock (the zone the server names), conflict types and refusal codes into
// sentences. No amount is ever computed or built here — money leaves these screens
// only through MoneyText on the server's own Money objects. The only arithmetic is on
// time (a local wall-clock time to a UTC instant for the time-off form).
//
// Copy rules: neutral (never assumes a gender — "you", "your fleet", "the rider"),
// the fleet never learns why a driver declined, and a rematch is mentioned only when
// the marketplace says one is available.
import { ApiError } from "@ubi/mobile-core";
import type {
  FleetConflict,
  FleetOffer,
  FleetScheduleItem,
  FleetTerms,
} from "../../api/fleet";
import { isOffline } from "../marketplace/tripCopy";

export { isOffline };

// ── Time (the city's zone, from the server) ────────────────────────────────

type Parts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
  monthName: string;
};

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string | null): Intl.DateTimeFormat {
  const key = zone ?? "";
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      ...(zone ? { timeZone: zone } : {}),
      year: "numeric",
      month: "short",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(key, f);
  }
  return f;
}

function partsOf(instant: number, zone: string | null): Parts {
  const out: Record<string, string> = {};
  for (const p of formatter(zone).formatToParts(new Date(instant)))
    out[p.type] = p.value;
  const monthIndex = [
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
  ].indexOf((out.month ?? "").slice(0, 3));
  return {
    year: Number(out.year),
    month: monthIndex + 1,
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: (out.weekday ?? "").slice(0, 3),
    monthName: (out.month ?? "").slice(0, 3),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "07:15" on the city's wall clock. */
export const timeIn = (iso: string, zone: string | null) => {
  const p = partsOf(Date.parse(iso), zone);
  return pad(p.hour) + ":" + pad(p.minute);
};

/** "Tue 30 Sep". */
export const dayIn = (iso: string, zone: string | null) => {
  const p = partsOf(Date.parse(iso), zone);
  return p.weekday + " " + p.day + " " + p.monthName;
};

/** "2026-09-30" — the local calendar day, for grouping. */
export const localDateKey = (iso: string, zone: string | null) => {
  const p = partsOf(Date.parse(iso), zone);
  return p.year + "-" + pad(p.month) + "-" + pad(p.day);
};

/** "Tue 30 Sep · 07:15". */
export const dateTimeIn = (iso: string, zone: string | null) =>
  dayIn(iso, zone) + " · " + timeIn(iso, zone);

/** "07:15–09:40", or with days when it crosses local midnight. */
export const rangeIn = (start: string, end: string, zone: string | null) =>
  localDateKey(start, zone) === localDateKey(end, zone)
    ? timeIn(start, zone) + "–" + timeIn(end, zone)
    : dateTimeIn(start, zone) + " – " + dateTimeIn(end, zone);

/** What a screen reader says for a time range: "07:15 to 09:40". */
export const spokenRange = (start: string, end: string, zone: string | null) =>
  rangeIn(start, end, zone).replace("–", " to ").replace(" – ", " to ");

/** "Times in Africa/Lagos" — or the phone's clock when the server named no zone. */
export const zoneNote = (zone: string | null) =>
  zone ? "Times in " + zone : "Times on your phone’s clock";

/** The earliest of some ISO instants (time only), or null. */
export const earliest = (...instants: (string | null | undefined)[]) => {
  const valid = instants.filter(
    (i): i is string => typeof i === "string" && Number.isFinite(Date.parse(i)),
  );
  if (!valid.length) return null;
  return valid.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a));
};

function offsetAt(instant: number, zone: string): number {
  const p = partsOf(instant, zone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - Math.floor(instant / 1_000) * 1_000;
}

/**
 * A local wall-clock time (a calendar day plus minutes after its midnight, which may
 * run past 24 h into the next day) in `zone`, as a UTC ISO instant. Time arithmetic
 * only — the server re-validates every window.
 */
export function zonedIso(date: string, minutes: number, zone: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  let guess = wall;
  for (let i = 0; i < 3; i++) guess = wall - offsetAt(guess, zone);
  return new Date(guess).toISOString();
}

/** "07:00" from minutes after midnight (wrapping past 24 h). */
export const clockOf = (minutes: number) =>
  pad(Math.floor((((minutes % 1440) + 1440) % 1440) / 60)) +
  ":" +
  pad((((minutes % 1440) + 1440) % 1440) % 60);

/** The next `n` local calendar days from `now`, as YYYY-MM-DD keys. */
export function nextLocalDays(now: number, zone: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < n && i < n + 2; i++) {
    const key = localDateKey(
      new Date(now + i * 86_400_000).toISOString(),
      zone,
    );
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

/** "Wed 1 Oct" for a YYYY-MM-DD key (read at local noon, so never the day before). */
export const dayOfKey = (key: string, zone: string) =>
  dayIn(zonedIso(key, 12 * 60, zone), zone);

// ── Schedule (C1) ──────────────────────────────────────────────────────────

export const SCHEDULE_KIND_TEXT: Record<FleetScheduleItem["kind"], string> = {
  availability: "Available",
  time_off: "Time off",
  shift: "Signed shift",
  maintenance: "Vehicle in service",
  booking: "Booking",
};

/** "1 booking needs your decision" / "1 proposal and 2 booking decisions". */
export function decisionTitle(bookings: number, proposals: number): string {
  const b =
    bookings === 1
      ? "1 booking needs your decision"
      : bookings + " bookings need your decision";
  const p =
    proposals === 1
      ? "1 proposal waiting for you"
      : proposals + " proposals waiting for you";
  if (bookings > 0 && proposals > 0)
    return (
      proposals +
      (proposals === 1 ? " proposal and " : " proposals and ") +
      bookings +
      (bookings === 1 ? " booking decision" : " booking decisions")
    );
  return bookings > 0 ? b : p;
}

/** C2b: "You have 1 proposal and 1 booking decision." */
export function waitingLine(bookings: number, proposals: number): string {
  const total = bookings + proposals;
  if (total === 0) return "Decisions";
  const what: string[] = [];
  if (proposals > 0)
    what.push(proposals + (proposals === 1 ? " proposal" : " proposals"));
  if (bookings > 0)
    what.push(
      bookings + (bookings === 1 ? " booking decision" : " booking decisions"),
    );
  return "You have " + what.join(" and ") + ".";
}

// ── Proposal (C2) ──────────────────────────────────────────────────────────

const SHIFT_NAME: Record<FleetOffer["shift"]["kind"], string> = {
  full: "Full day",
  day: "Day",
  night: "Night",
  custom: "Custom",
};

/** "Night · 18:00–06:00" — the signed shift's own local wall-clock window. */
export const shiftText = (shift: FleetOffer["shift"]) =>
  shift.kind === "full"
    ? "Full day · any time"
    : SHIFT_NAME[shift.kind] + " · " + shift.start + "–" + shift.end;

export const TERM_FIELD_TEXT: Record<
  FleetOffer["diff"][number]["field"],
  string
> = {
  vehicle: "Vehicle",
  shift: "Shift",
  validity: "Dates",
  remittance: "Remittance",
  shortfall: "Shortfall",
  fuelBy: "Fuel",
  servicingBy: "Servicing",
};

export const whoPays = (who: "driver" | "fleet", thing: string) =>
  who === "driver" ? "You pay for " + thing : "Your fleet pays for " + thing;

export const shortfallText = (terms: FleetTerms) =>
  "Carry forward, up to " +
  terms.shortfall.maxWeeks +
  (terms.shortfall.maxWeeks === 1 ? " week" : " weeks");

/** percent_of_net terms: the server's own percentage, printed. */
export const percentText = (terms: FleetTerms) =>
  terms.percent === null ? "—" : terms.percent + "% of your net earnings";

/** UBI's check on the offer, in words (null = the check could not run). */
export function offerCheckText(check: FleetOffer["check"]): {
  text: string;
  tone: "ok" | "warn";
} {
  if (check.clashesWithBookings === null)
    return {
      tone: "warn",
      text: "UBI couldn’t check your bookings right now. Signing checks everything again.",
    };
  if (!check.clashesWithBookings && !check.clashesWithTimeOff)
    return {
      tone: "ok",
      text: "This doesn’t clash with your availability or your bookings (checked by UBI).",
    };
  const clashes = [
    check.clashesWithTimeOff ? "your time off" : null,
    check.clashesWithBookings ? "your bookings" : null,
  ].filter(Boolean);
  return {
    tone: "warn",
    text:
      "This clashes with " +
      clashes.join(" and ") +
      " (checked by UBI). If you sign, you’ll be asked what to do about each one.",
  };
}

// ── Booking impact (C3) ────────────────────────────────────────────────────

export const CONFLICT_TITLE: Record<FleetConflict["type"], string> = {
  maintenance_overlaps_booking:
    "Your vehicle is booked in for service during this booking",
  unplanned_off_road: "Your vehicle is off the road",
  document_expiring: "A vehicle document expires before this booking",
  document_expires_in_booking: "A vehicle document expires before this booking",
  time_off_overlaps_booking: "Your time off overlaps this booking",
  termination_bookings: "Your fleet arrangement ends before this booking",
};

/** The reason the marketplace records for a withdrawal (never shown to the rider). */
export const WITHDRAW_REASON: Record<FleetConflict["type"], string> = {
  maintenance_overlaps_booking: "Fleet vehicle in planned service",
  unplanned_off_road: "Fleet vehicle off the road",
  document_expiring: "Vehicle document expiry",
  document_expires_in_booking: "Vehicle document expiry",
  time_off_overlaps_booking: "Taking time off",
  termination_bookings: "Fleet arrangement ending",
};

// ── Refusals ───────────────────────────────────────────────────────────────

export type Refusal = { title: string; body: string };

const detailsOf = (e: unknown): Record<string, unknown> =>
  e instanceof ApiError && e.details && typeof e.details === "object"
    ? (e.details as Record<string, unknown>)
    : {};

/** fleet-service's honest "not offered in this city" (the `fleet` flag is off). */
export const isFleetUnavailable = (e: unknown) =>
  e instanceof ApiError &&
  (e.code === "feature_disabled" || e.code === "city_unsupported");

export const OFFLINE_REFUSAL: Refusal = {
  title: "You’re offline",
  body: "Nothing was sent. Try again when you’re back online — retrying is safe, it can’t act twice.",
};

/**
 * A refused fleet action, in plain words. Known codes get a sentence; anything else
 * keeps the server's own message (never a silent failure).
 */
export function fleetRefusal(e: unknown, zone: string | null = null): Refusal {
  if (isOffline(e)) return OFFLINE_REFUSAL;
  const err = e as ApiError;
  const details = detailsOf(e);
  switch (err.code) {
    case "wrong_pin": {
      const left = details.attemptsRemaining;
      return {
        title: "That PIN isn’t right",
        body:
          (typeof left === "number"
            ? left +
              (left === 1 ? " try" : " tries") +
              " left before your PIN locks. "
            : "") + "Nothing was signed.",
      };
    }
    case "pin_locked": {
      const until = details.lockedUntil;
      return {
        title: "Your PIN is locked",
        body:
          "Too many wrong tries" +
          (typeof until === "string" && Number.isFinite(Date.parse(until))
            ? " — you can try again after " + dateTimeIn(until, zone)
            : "") +
          ". Nothing was signed.",
      };
    }
    case "pin_not_verified":
      return {
        title: "Set up your wallet PIN first",
        body: "Signing uses your wallet PIN. Set it up in your wallet, then come back — the offer stays open until it expires.",
      };
    case "offer_expired":
      return { title: "This offer expired", body: err.message };
    case "shift_overlap":
      return { title: "This clashes with a signed shift", body: err.message };
    case "illegal_transition":
      return {
        title: "This is no longer open",
        body: "It was withdrawn, replaced or already answered. Nothing changed.",
      };
    case "feature_disabled":
    case "city_unsupported":
      return {
        title: "Fleet tools aren’t available yet in your city",
        body: "Nothing was sent.",
      };
    case "not_found":
      return {
        title: "No longer available",
        body: "This isn’t available to you any more. Nothing changed.",
      };
    case "forbidden":
      return details.reason === "not_assigned_to_vehicle"
        ? {
            title: "Not your vehicle right now",
            body: "You can only report the vehicle you’re assigned to right now.",
          }
        : { title: "Not available for your account", body: err.message };
    case "limited_mode":
      return { title: "Finish the security check first", body: err.message };
    case "maintenance_overlap":
      return { title: "Already reported", body: err.message };
    case "unresolved_booking_overlap":
      return {
        title: "Choose for each booking first",
        body: "Your time off overlaps a booking. Trim the time off to keep it, or choose to withdraw from it.",
      };
    case "conflict":
      return details.reason === "preview_stale"
        ? {
            title: "Something changed since the check",
            body: "Your bookings or windows changed. Check again before saving.",
          }
        : { title: "That can’t be done right now", body: err.message };
    case "idempotency_key_reuse":
      return {
        title: "That was already sent differently",
        body: "Reload and try again.",
      };
    case "rate_limited":
      return { title: "Too many tries", body: "Wait a moment and try again." };
    case "validation_failed":
      return { title: "Check the details", body: err.message };
    case "service_unavailable":
      return { title: "Couldn’t finish right now", body: err.message };
    default:
      return { title: "That didn’t go through", body: err.message };
  }
}
