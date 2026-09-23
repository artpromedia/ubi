// Plain-language copy and display formatting for the A02 trip screens (stops, waiting,
// amendments) and the A03 booking calendar. Everything here turns SERVER values into
// words: refusal codes/reasons into sentences, seconds and metres into labels, a money
// delta's SIGN into the right explanation. No amount is ever computed — money leaves
// these screens only through MoneyText/formatMinor on the server's own Money objects.
import { useEffect, useState } from "react";
import { ApiError, type Money } from "@ubi/mobile-core";
import type {
  MpAmendment,
  MpTerminationReason,
  MpTripStop,
} from "../../api/marketplace";

/** A failure that never reached the server (no ApiError) is the offline case. */
export const isOffline = (e: unknown) => !(e instanceof ApiError);

/**
 * Why the copy on screen may be old: a refetch failed offline, or the server answered
 * an error. null while the last refresh succeeded (or nothing has failed).
 */
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

/** Spoken form of a clock for screen readers: "6 minutes 12 seconds". */
export const spokenDuration = (totalSec: number) => {
  const sec = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return (
    (m > 0 ? m + (m === 1 ? " minute " : " minutes ") : "") +
    s +
    (s === 1 ? " second" : " seconds")
  );
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

export const STOP_PURPOSE: Record<MpTripStop["purpose"], string> = {
  pickup_passenger: "Pick up a passenger",
  drop_passenger: "Drop off a passenger",
  errand: "Errand stop",
  other: "Stop",
};

const SKIP_REASON: Record<string, string> = {
  removed_by_amendment: "removed by an agreed change",
  trip_terminated: "trip ended early",
  excessive_waiting: "left after excessive waiting",
};

/** The stop's state as words — the status is never carried by colour alone. */
export const stopStatusText = (stop: MpTripStop): string => {
  switch (stop.state) {
    case "pending":
      return "Not reached yet";
    case "arrived":
      return stop.arrivalDisputed ? "Arrived · disputed" : "Arrived · waiting";
    case "departed":
      return "Departed";
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
  committed: "Waiting fee settled",
  failed: "Waiting fee not settled — support is reconciling it",
};

export const TERMINATION_REASONS: {
  code: MpTerminationReason;
  label: string;
}[] = [
  { code: "rider_request", label: "Rider asked to end here" },
  { code: "excessive_waiting", label: "Excessive waiting" },
  { code: "safety_concern", label: "Safety concern" },
  { code: "vehicle_issue", label: "Vehicle issue" },
];

export const RIDER_FUNDING_TEXT: Record<string, string> = {
  pending: "Being reserved from the rider",
  reserved: "Reserved from the rider",
  committed: "Committed by the rider",
  released: "Released back to the rider",
  release_on_commit: "The difference returns to the rider if this commits",
  partially_released: "The difference was returned to the rider",
  not_required: "No extra rider funding needed",
  unsecured_cash: "Cash trip — collected at the end, not secured in advance",
};

export const ADJUSTMENT_KIND_TEXT: Record<MpAmendment["kind"], string> = {
  route: "Agreed route change",
  stop_waiting: "Paid waiting at a stop",
  early_termination: "Trip ended early",
};

export type Refusal = { title: string; body: string };

const OFFLINE: Refusal = {
  title: "You’re offline",
  body: "Nothing was sent. Try again when you’re back online — retrying is safe, it can’t act twice.",
};

/** Why a stop arrival was refused (422 not_at_pickup), from the server's evidence. */
export const arrivalRefusal = (e: unknown): Refusal => {
  const reason = errorReason(e);
  const meters = errorDetail<number>(e, "distanceMeters");
  const fence = errorDetail<number>(e, "geofenceMeters");
  switch (reason) {
    case "not_at_stop":
      return {
        title: "You’re not at this stop yet",
        body:
          (meters !== undefined
            ? "The server places you " + meters + " m away"
            : "The server places you outside the stop area") +
          (fence !== undefined ? " (stop area " + fence + " m)." : "."),
      };
    case "position_stale":
      return {
        title: "Your location is out of date",
        body: "Keep the app open with location on so the server gets a fresh position, then try again.",
      };
    case "position_inaccurate":
      return {
        title: "GPS is too imprecise here",
        body: "The server can’t confirm the stop from this fix. Move to open sky or try again in a moment.",
      };
    default:
      return {
        title: "The server has no position for you yet",
        body: "Keep location on so your position reaches the server, then try again.",
      };
  }
};

/**
 * A refused action, in plain words. Known codes/reasons get a sentence; anything
 * else keeps the server's own message (never a silent failure).
 */
export const refusalFor = (e: unknown): Refusal => {
  if (isOffline(e)) return OFFLINE;
  const err = e as ApiError;
  const reason = errorReason(e);
  switch (reason) {
    case "next_job_conflict":
      return {
        title: "This would break your next job",
        body: "It would make you late for the pickup you promised your next rider, so it can’t go ahead. Nothing was held and this trip continues as agreed.",
      };
    case "amendment_open":
      return {
        title: "Another change is still open",
        body: "A change to this trip is still being resolved. Deal with that one first.",
      };
    case "funding_pending":
      return {
        title: "Still securing funding",
        body: "This change is still reserving its funds. You can approve it once it’s ready.",
      };
    case "committing":
      return {
        title: "Already being applied",
        body: "Both of you approved this change and it’s being applied now.",
      };
    case "earlier_stop_open":
      return {
        title: "Finish the earlier stop first",
        body: "Depart from (or skip) the stop before this one, then arrive here.",
      };
    case "waiting_not_excessive":
      return {
        title: "You can’t leave this stop yet",
        body: "You may skip a stop only once waiting there becomes excessive. Waiting you’ve earned is kept.",
      };
    case "insufficient_driver_spendable":
      return {
        title: "Not enough in your wallet",
        body: "Your spendable balance can’t cover the extra 10% commission on this change. Nothing was held; the trip continues as agreed.",
      };
    case "insufficient_rider_funds":
      return {
        title: "The rider’s funds didn’t cover it",
        body: "The rider’s payment couldn’t cover the higher fare, so the change was declined. Nothing was charged.",
      };
    case "position_stale":
      return {
        title: "Your location is out of date",
        body: "The server needs a fresh position to end the trip where you are. Keep location on and try again.",
      };
  }
  switch (err.code) {
    case "driver_ineligible":
      return reason === "ACCOUNT_NOT_ELIGIBLE"
        ? {
            title: "Your account can’t take marketplace work right now",
            body: err.message,
          }
        : {
            title: "Stop safely first",
            body: "The server couldn’t confirm you’re safely parked, so nothing changed. Park, confirm, then try again.",
          };
    case "insufficient_spendable":
      return {
        title: "Not enough in your wallet",
        body: "Your spendable balance can’t cover the extra 10% commission on this change. Nothing was held; the trip continues as agreed.",
      };
    case "insufficient_funds":
      return {
        title: "The rider’s funds didn’t cover it",
        body: "The rider’s payment couldn’t cover the higher fare, so the change was declined. Nothing was charged.",
      };
    case "version_conflict":
      return {
        title: "The trip changed",
        body: "Its terms changed after you opened them. We’ve refreshed them — review again.",
      };
    case "no_active_ride":
      return {
        title: "This trip is no longer running",
        body: "Nothing was changed.",
      };
    case "reason_code_required":
      return { title: "Choose a reason", body: err.message };
    case "feature_disabled":
    case "not_found":
      return {
        title: "Not available for this trip",
        body: "This isn’t available here right now.",
      };
    case "conflict":
      return { title: "That can’t be done right now", body: err.message };
    default:
      return { title: "That didn’t go through", body: err.message };
  }
};

/** A closed amendment's outcome, in plain words (history rows and refusals). */
export const amendmentOutcome = (a: MpAmendment): string => {
  switch (a.state) {
    case "committed":
      return a.kind === "route"
        ? "Committed — the new route and fare are in force."
        : a.kind === "stop_waiting"
          ? "Paid waiting settled."
          : "Trip ended early — the fare was adjusted.";
    case "expired":
      return "Expired before both of you approved. Nothing changed and anything held was released.";
    case "failed":
      return "Couldn’t be applied — anything held is being returned.";
    case "compensated":
      return "Couldn’t be applied — everything held was returned.";
    case "rejected":
      switch (a.reason) {
        case "driver_rejected":
          return "You declined. No penalty — the original agreement stayed in force.";
        case "rider_rejected":
          return "The rider declined. The original agreement stays in force.";
        case "next_job_conflict":
          return "Declined automatically: it would have broken the pickup time promised to your next rider.";
        case "insufficient_driver_spendable":
          return "Declined: your wallet couldn’t cover the extra commission. Nothing was held.";
        case "insufficient_rider_funds":
          return "Declined: the rider’s funds couldn’t cover the higher fare. Nothing was charged.";
        case "wallet_terms_refreshed":
          return "Declined: wallet terms changed while it was being set up. Nothing was held.";
        case "execution_ended":
          return "Closed: the trip ended before it could apply.";
        case "route_changed":
          return "Closed: the trip’s route changed first.";
        case "approval_window_elapsed":
          return "Expired before both of you approved. Nothing changed and anything held was released.";
        default:
          return "Declined. The original agreement stays in force.";
      }
    default:
      return "Open.";
  }
};

/** Who proposed a change, from the driver's side. */
export const proposerText = (role: MpAmendment["proposedByRole"]) =>
  role === "driver"
    ? "Proposed by you"
    : role === "rider"
      ? "Proposed by the rider"
      : "Recorded by UBI";
