// Plain-language copy and display formatting for the rider's A02 (route builder, trip,
// route changes) and A03 (Book for Later) screens. Everything here turns SERVER values
// into words: refusal codes/reasons into sentences, seconds and metres into labels,
// server states into status words (always printed — colour is never the only signal),
// and a money delta's SIGN into the right sentence. No amount is ever computed: money
// leaves these screens only through MoneyText on the server's own Money objects.
import { useEffect, useState } from "react";
import { ApiError, type Money } from "@ubi/mobile-core";
import type {
  MpAdvanceBooking,
  MpAmendment,
  MpRecurringTemplate,
  MpScheduledRequest,
  MpStopInput,
  MpTrip,
} from "../../api/marketplace";

export type Tone = "ok" | "warn" | "error" | "neutral" | "info";
export type StatusWord = { label: string; tone: Tone };
export type Refusal = { title: string; body: string };

/** A failure that never reached the server (no ApiError) is the offline case. */
export const isOffline = (e: unknown) => !(e instanceof ApiError);

/** Why what's on screen may be old: a refresh failed offline, or the server erred. */
export type Staleness = null | "offline" | "error";
export const stalenessOf = (...errors: unknown[]): Staleness => {
  const failed = errors.filter((e) => e !== null && e !== undefined);
  if (!failed.length) return null;
  return failed.some(isOffline) ? "offline" : "error";
};

/** The server's `details.reason` on a contract error, when it sent one. */
export const errorReason = (e: unknown): string | undefined => {
  if (!(e instanceof ApiError)) return undefined;
  const details = e.details as { reason?: unknown } | undefined;
  return typeof details?.reason === "string" ? details.reason : undefined;
};

export const errorDetail = <T>(e: unknown, key: string): T | undefined => {
  if (!(e instanceof ApiError)) return undefined;
  const details = e.details as Record<string, unknown> | undefined;
  return details?.[key] as T | undefined;
};

/** A feature the server answers as not here (flag off) or not this caller's. */
export const isUnavailable = (e: unknown) =>
  e instanceof ApiError &&
  (e.code === "feature_disabled" || e.code === "not_found");

/** Sign of a server Money value — chooses the sentence, never changes the figure. */
export const moneySign = (m: Money | null | undefined): -1 | 0 | 1 =>
  !m || m.amountMinor === 0 ? 0 : m.amountMinor > 0 ? 1 : -1;

/** Ticking clock for countdowns (time only — never money). */
export function useNow(intervalMs = 1_000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, enabled]);
  return now;
}

/** 75 → "1:15"; 3725 → "1:02:05". */
export const clock = (totalSec: number) => {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3_600);
  const m = Math.floor((sec % 3_600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h > 0 ? h + ":" + String(m).padStart(2, "0") + ":" + s : m + ":" + s;
};

/** 14230 → "14.2 km"; 800 → "0.8 km". */
export const km = (meters: number) =>
  (Math.max(0, meters) / 1_000).toFixed(1) + " km";

/** 2280 → "38 min"; 4500 → "1 h 15 min"; 30 → "1 min". */
export const minutes = (sec: number) => {
  const total = Math.max(0, Math.round(sec / 60));
  if (total === 0 && sec > 0) return "1 min";
  if (total < 60) return total + " min";
  const h = Math.floor(total / 60);
  return h + " h" + (total % 60 ? " " + (total % 60) + " min" : "");
};

/** 3100 → "+3.1 km"; −1200 → "−1.2 km"; 0 → "no extra distance". */
export const signedKm = (meters: number) =>
  meters === 0
    ? "no extra distance"
    : (meters > 0 ? "+" : "−") + (Math.abs(meters) / 1_000).toFixed(1) + " km";

/** 360 → "+6 min"; −120 → "−2 min"; 0 → "no extra time". */
export const signedMinutes = (sec: number) =>
  sec === 0
    ? "no extra time"
    : (sec > 0 ? "+" : "−") +
      Math.max(1, Math.round(Math.abs(sec) / 60)) +
      " min";

/** "in 2 h 5 min" / "in 45 min" / "in 30 s" relative to `now`; null once passed. */
export const inLabel = (iso: string, now: number): string | null => {
  const sec = Math.floor((Date.parse(iso) - now) / 1_000);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  if (sec < 60) return "in " + sec + " s";
  const min = Math.round(sec / 60);
  if (min < 60) return "in " + min + " min";
  const hours = Math.floor(min / 60);
  if (hours < 48)
    return "in " + hours + " h" + (min % 60 ? " " + (min % 60) + " min" : "");
  return "in " + Math.floor(hours / 24) + " d " + (hours % 24) + " h";
};

/** A server instant as a wall-clock label in the pickup's own timezone when known. */
export const whenLabel = (
  iso: string | null | undefined,
  timeZone?: string,
) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return d.toLocaleString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  }
};

export const STOP_PURPOSES: {
  code: NonNullable<MpStopInput["purpose"]>;
  label: string;
}[] = [
  { code: "errand", label: "Errand" },
  { code: "pickup_passenger", label: "Pick someone up" },
  { code: "drop_passenger", label: "Drop someone off" },
  { code: "other", label: "Other" },
];
export const STOP_PURPOSE_TEXT: Record<string, string> = {
  errand: "Errand stop",
  pickup_passenger: "Picking someone up",
  drop_passenger: "Dropping someone off",
  other: "Stop",
};

/** Expected-wait choices; `undefined` = the market's own default (the server applies it). */
export const DWELL_CHOICES: { sec: number | undefined; label: string }[] = [
  { sec: undefined, label: "Standard wait" },
  { sec: 120, label: "2 min" },
  { sec: 300, label: "5 min" },
  { sec: 600, label: "10 min" },
];

const SKIP_REASON: Record<string, string> = {
  removed_by_amendment: "removed by an agreed change",
  trip_terminated: "trip ended early",
  excessive_waiting: "the driver left after a long wait",
};

type TripStop = MpTrip["stops"][number];

/** A stop's state as the rider reads it. */
export const stopStatusText = (stop: TripStop): string => {
  switch (stop.state) {
    case "pending":
      return "Not reached yet";
    case "arrived":
      return stop.arrivalDisputed
        ? "Driver arrived · arrival disputed (no paid waiting)"
        : "Driver arrived · waiting";
    case "departed":
      return "Done";
    case "skipped":
      return (
        "Skipped" +
        (stop.skipReason
          ? " · " + (SKIP_REASON[stop.skipReason] ?? stop.skipReason)
          : "")
      );
  }
};

export const SETTLEMENT_TEXT: Record<string, string> = {
  none: "No paid waiting at this stop",
  pending: "Waiting fee settling",
  committed: "Waiting fee added to your fare",
  failed: "Waiting fee not settled — support is reconciling it",
};

/** The rider's side of an amendment's money, stated honestly. */
export const RIDER_FUNDING_TEXT: Record<string, string> = {
  pending: "Reserving the extra from your payment…",
  reserved: "Reserved from your payment — only charged if this change commits",
  committed: "Committed to your fare",
  released: "Released back to you",
  release_on_commit: "The difference comes back to you if this commits",
  partially_released: "The difference was returned to you",
  not_required: "No extra funding needed",
  unsecured_cash:
    "Cash trip — nothing is reserved in advance; you pay the driver at the end",
};

export const ADJUSTMENT_KIND_TEXT: Record<string, string> = {
  route: "Agreed route change",
  stop_waiting: "Paid waiting at a stop",
  early_termination: "Trip ended early",
};

const OPEN_AMENDMENT = new Set(["proposed", "awaiting_approvals_and_funding"]);
export const isOpenAmendment = (a: MpAmendment) => OPEN_AMENDMENT.has(a.state);

/** Who proposed a change, from the rider's side. */
export const proposerText = (role: MpAmendment["proposedByRole"]) =>
  role === "rider"
    ? "You proposed this"
    : role === "driver"
      ? "Your driver proposed this"
      : "Recorded by UBI";

/** The state of one amendment in words: awaiting driver/funding, committed, rejected, expired. */
export const amendmentStatus = (a: MpAmendment): StatusWord => {
  switch (a.state) {
    case "proposed":
      return { label: "Securing funding", tone: "info" };
    case "awaiting_approvals_and_funding":
      if (a.approvals.rider.approved && a.approvals.driver.approved)
        return { label: "Both approved · committing", tone: "info" };
      if (a.approvals.rider.approved)
        return { label: "Awaiting the driver", tone: "info" };
      return { label: "Awaiting your approval", tone: "warn" };
    case "committed":
      return { label: "Committed", tone: "ok" };
    case "rejected":
      return { label: "Rejected", tone: "neutral" };
    case "expired":
      return { label: "Expired", tone: "neutral" };
    case "failed":
      return { label: "Not applied", tone: "error" };
    case "compensated":
      return { label: "Not applied · returned", tone: "neutral" };
  }
};

/** A closed amendment's outcome, in plain words (history rows and banners). */
export const amendmentOutcome = (a: MpAmendment): string => {
  switch (a.state) {
    case "committed":
      return a.kind === "route"
        ? "Committed — the new route and fare are now your agreement."
        : a.kind === "stop_waiting"
          ? "Paid waiting was added to your fare."
          : "The trip ended early and your fare was adjusted.";
    case "expired":
      return "Expired before both of you approved. Nothing changed and anything reserved was released.";
    case "failed":
      return "Couldn’t be applied — anything reserved is being returned. Your original agreement stands.";
    case "compensated":
      return "Couldn’t be applied — everything reserved was returned. Your original agreement stands.";
    case "rejected":
      switch (a.reason) {
        case "rider_rejected":
          return "You declined. Your original agreement stays in force.";
        case "driver_rejected":
          return "Your driver declined. Your original agreement stays in force.";
        case "next_job_conflict":
          return "Declined automatically: it would have made your driver late for a pickup already promised to another rider.";
        case "insufficient_rider_funds":
          return "Declined: your payment couldn’t cover the higher fare. Nothing was charged.";
        case "insufficient_driver_spendable":
          return "Declined: your driver couldn’t take on this change. Nothing was charged.";
        case "wallet_terms_refreshed":
          return "Declined: payment terms changed while it was being set up. Nothing was charged.";
        case "execution_ended":
          return "Closed: the trip ended before it could apply.";
        case "route_changed":
          return "Closed: the trip’s route changed first.";
        case "approval_window_elapsed":
          return "Expired before both of you approved. Nothing changed and anything reserved was released.";
        default:
          return "Declined. Your original agreement stays in force.";
      }
    default:
      return "Open — your original agreement stays in force until this commits.";
  }
};

const OFFLINE: Refusal = {
  title: "You’re offline",
  body: "Nothing was sent. Try again when you’re back online — retrying is safe, it can’t act twice.",
};

/**
 * A refused rider action, in plain words. Known codes/reasons get a sentence; anything
 * else keeps the server's own message (never a silent failure).
 */
export const refusalFor = (e: unknown): Refusal => {
  if (isOffline(e)) return OFFLINE;
  const err = e as ApiError;
  switch (errorReason(e)) {
    case "next_job_conflict":
      return {
        title: "Your driver can’t take this change",
        body: "It would make your driver late for a pickup they’ve already promised to another rider, so it can’t go ahead. Nothing was reserved and your trip continues as agreed.",
      };
    case "amendment_open":
      return {
        title: "Another change is still open",
        body: "A change to this trip is still being resolved. Deal with that one first.",
      };
    case "funding_pending":
      return {
        title: "Still securing funding",
        body: "This change is still reserving its funds. You can approve it once that’s done.",
      };
    case "committing":
      return {
        title: "Already being applied",
        body: "Both of you approved this change and it’s being applied now.",
      };
    case "insufficient_rider_funds":
      return {
        title: "Your payment can’t cover this change",
        body: "The higher fare doesn’t fit your wallet balance. Nothing was reserved and your trip continues as agreed. Top up and try again.",
      };
    case "insufficient_driver_spendable":
      return {
        title: "Your driver can’t take this change",
        body: "Your driver can’t take on this change right now. Nothing was reserved and your trip continues as agreed.",
      };
  }
  switch (err.code) {
    case "insufficient_funds":
      return {
        title: "Your payment can’t cover this change",
        body: "The higher fare doesn’t fit your wallet balance. Nothing was reserved and your trip continues as agreed. Top up and try again.",
      };
    case "insufficient_spendable":
      return {
        title: "Your driver can’t take this change",
        body: "Your driver can’t take on this change right now. Nothing was reserved and your trip continues as agreed.",
      };
    case "version_conflict":
      return {
        title: "Things changed",
        body: "The terms changed after you opened them. We’ve refreshed them — review again.",
      };
    case "no_active_ride":
      return {
        title: "This trip is no longer running",
        body: "Nothing was changed.",
      };
    case "request_closed":
      return {
        title: "This request is closed",
        body: "It’s no longer open, so it can’t be changed. " + err.message,
      };
    case "fare_out_of_bounds":
      return {
        title: "That fare is outside the allowed range",
        body: err.message,
      };
    case "quote_expired":
      return {
        title: "The price expired",
        body: "Get an updated price for this route, then try again.",
      };
    case "feature_disabled":
    case "not_found":
      return {
        title: "Not available here",
        body: "This isn’t offered in your city right now.",
      };
    case "award_unresolved":
      return {
        title: "Still confirming",
        body: "Your driver is still being confirmed. Try again in a moment.",
      };
    case "validation_failed":
      return { title: "Check the details", body: err.message };
    case "conflict":
      return { title: "That can’t be done right now", body: err.message };
    default:
      return { title: "That didn’t go through", body: err.message };
  }
};

// ── Book for Later status words (always printed next to the server's own label) ──

/** A scheduled request: never "confirmed" before a driver is secured. */
export const scheduledStatus = (sr: MpScheduledRequest): StatusWord => {
  if (sr.driverSecured) return { label: "Driver secured", tone: "ok" };
  switch (sr.state) {
    case "scheduled_unassigned":
      return { label: "Scheduled · no driver yet", tone: "info" };
    case "needs_rider_approval":
      return { label: "Needs your approval", tone: "warn" };
    case "published":
      return { label: "Sent to drivers · no driver yet", tone: "info" };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" };
    case "skipped":
      return { label: "Skipped", tone: "neutral" };
    case "expired":
      return { label: "Expired · never sent", tone: "neutral" };
    case "unfulfilled":
      return { label: "No driver found", tone: "error" };
  }
};

/**
 * An advance booking. DRIVER CONFIRMED only when a named driver is committed AND the
 * rider's funding is secured (or explicitly cash); a reserved driver with payment still
 * pending is a different, weaker state and says so.
 */
export const bookingStatus = (b: MpAdvanceBooking): StatusWord => {
  switch (b.state) {
    case "held":
      return { label: "Confirming your driver", tone: "info" };
    case "payment_pending":
      return { label: "Driver reserved · payment pending", tone: "warn" };
    case "confirmed":
    case "reconfirmed":
      return b.fullySecured
        ? {
            label:
              b.state === "reconfirmed"
                ? "Driver confirmed · reconfirmed"
                : "Driver confirmed",
            tone: "ok",
          }
        : { label: "Driver reserved · payment not secured", tone: "warn" };
    case "activated":
      return { label: "Trip started", tone: "ok" };
    case "completed":
      return { label: "Completed", tone: "neutral" };
    case "failed":
      return { label: "Booking failed · no driver", tone: "error" };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" };
    case "released":
      return { label: "Not booked", tone: "neutral" };
  }
};

/** A series as a whole is NEVER confirmed: each occurrence books on its own. */
export const seriesStatus = (s: MpRecurringTemplate): StatusWord => {
  switch (s.state) {
    case "active":
      return { label: "Active · each trip books separately", tone: "info" };
    case "paused":
      return { label: "Paused", tone: "warn" };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" };
    case "ended":
      return { label: "Ended", tone: "neutral" };
  }
};

export const BOOKING_FAILURE_OUTCOME = (
  f: NonNullable<MpAdvanceBooking["failure"]>,
): string[] => [
  "You were not charged for this booking.",
  f.financialOutcome.riderFundingReleased
    ? "Your payment hold was released."
    : "No payment hold was taken.",
];

export const WEEKDAYS: {
  code: MpRecurringTemplate["daysOfWeek"][number];
  label: string;
}[] = [
  { code: "mon", label: "Mon" },
  { code: "tue", label: "Tue" },
  { code: "wed", label: "Wed" },
  { code: "thu", label: "Thu" },
  { code: "fri", label: "Fri" },
  { code: "sat", label: "Sat" },
  { code: "sun", label: "Sun" },
];
