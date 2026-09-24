/**
 * Airport transfer policy: which flight leg a transfer serves, when its pickup
 * window is, and the words a traveller is shown for each state.
 *
 * Every number comes from the city's active, two-person-approved config
 * version (CLAUDE.md #1): the airport block (arrival buffer, check-in cutoff,
 * traffic buffer, the city's airport codes) and the marketplace's Book for
 * Later policy (window length, minimum lead, horizon) — the SAME policy
 * ride-service enforces on the scheduled request this transfer becomes. A city
 * without that policy has no scheduled rides to offer, so a transfer there
 * fails closed with `market_not_configured`.
 *
 * Pickup windows are instants (UTC) phrased in the city's IANA zone: the
 * scheduled request carries local date + local time + zone, and ride-service
 * resolves them — including a daylight-saving overlap, which is disambiguated
 * explicitly here so the instant it resolves is exactly the one derived from
 * the flight.
 */
import {
  ContractError,
  type CityConfig,
  type MpPickupScheduleInput,
} from "@ubi/contracts";

import type { JsonRecord } from "./types";

export const TRANSFER_DIRECTIONS = [
  "arrival_pickup",
  "departure_dropoff",
] as const;
export type TransferDirection = (typeof TRANSFER_DIRECTIONS)[number];

export const TRANSFER_STATES = [
  "pending_unassigned",
  "requested",
  "awarded",
  "failed",
  "cancelled",
] as const;
export type TransferState = (typeof TRANSFER_STATES)[number];

/** The code-side version of the derivation rules below. */
const RULES_VERSION = "airport-transfer.v1";

// ---------------------------------------------------------------------------
// Flight legs
// ---------------------------------------------------------------------------

export interface FlightLeg {
  readonly index: number;
  readonly from: string | null;
  readonly to: string | null;
  readonly departAt: Date;
  readonly arriveAt: Date;
  readonly flightNumber: string | null;
}

/**
 * An absolute instant only: an ISO timestamp with `Z` or an explicit offset.
 * A local wall-clock time without a zone cannot be placed in time, and a
 * pickup is never scheduled at a guessed hour.
 */
function instantOf(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function legOf(
  index: number,
  record: JsonRecord,
  fallbackFlightNumber: string | null,
): FlightLeg | null {
  const departAt =
    instantOf(record.departAtUtc) ?? instantOf(record.departAt) ?? null;
  const arriveAt =
    instantOf(record.arriveAtUtc) ?? instantOf(record.arriveAt) ?? null;
  if (departAt === null || arriveAt === null || arriveAt <= departAt) {
    return null;
  }
  const segments = Array.isArray(record.segments)
    ? (record.segments as JsonRecord[])
    : [];
  return {
    index,
    from: text(record.from),
    to: text(record.to),
    departAt,
    arriveAt,
    flightNumber:
      text(segments[0]?.flightNumber) ??
      text(record.flightNumber) ??
      fallbackFlightNumber,
  };
}

/**
 * The legs of a flight order's offer snapshot, in order: one per slice when
 * the supplier reports slices (Duffel), otherwise the single leg the snapshot
 * describes. A leg whose times cannot be placed in time is left out.
 */
export function flightLegs(snapshot: unknown): readonly FlightLeg[] {
  if (typeof snapshot !== "object" || snapshot === null) {
    return [];
  }
  const record = snapshot as JsonRecord;
  const flightNumber = text(record.flightNumber);
  if (Array.isArray(record.slices) && record.slices.length > 0) {
    const legs: FlightLeg[] = [];
    record.slices.forEach((slice, index) => {
      if (
        typeof slice === "object" &&
        slice !== null &&
        !Array.isArray(slice)
      ) {
        const leg = legOf(index, slice as JsonRecord, flightNumber);
        if (leg !== null) {
          legs.push(leg);
        }
      }
    });
    return legs;
  }
  const single = legOf(0, record, flightNumber);
  return single === null ? [] : [single];
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export interface TransferPolicy {
  readonly version: string;
  readonly timeZone: string;
  readonly currency: string;
  readonly airportCodes: readonly string[];
  readonly doors: Readonly<Record<string, string>>;
  readonly arrivalBufferSec: number;
  readonly checkInCutoffSec: number;
  readonly trafficBufferSec: number;
  readonly windowSec: number;
  readonly minLeadSec: number;
  readonly maxHorizonSec: number;
  readonly publishLeadSec: number;
}

/**
 * The transfer policy of a city's active config. No scheduled-request policy
 * means the market offers no scheduled rides: fail closed.
 */
export function transferPolicyOf(config: CityConfig): TransferPolicy {
  const marketplace = config.marketplace;
  const scheduling = marketplace?.scheduling?.scheduledRequests;
  if (marketplace === undefined || scheduling === undefined) {
    throw new ContractError(
      "market_not_configured",
      "scheduled rides are not offered in this city, so an airport transfer cannot be arranged here",
      { cityId: config.cityId },
    );
  }
  // The market's default window, clamped into its own bounds and to whole
  // minutes (the scheduled request states the window in minutes).
  const clamped = Math.min(
    Math.max(scheduling.defaultWindowSec, scheduling.minWindowSec),
    scheduling.maxWindowSec,
  );
  const windowSec = Math.max(60, Math.floor(clamped / 60) * 60);
  return {
    version: `${RULES_VERSION}/cfg.${config.version}/mp.${marketplace.policyVersion}`,
    timeZone: config.timezone,
    currency: config.currency,
    airportCodes: config.airport.codes,
    doors: config.airport.doors,
    arrivalBufferSec: config.airport.arrivalBufferMin * 60,
    checkInCutoffSec: config.airport.checkInCutoffMin * 60,
    trafficBufferSec: config.airport.trafficBufferMin * 60,
    windowSec,
    minLeadSec: scheduling.minLeadSec,
    maxHorizonSec: scheduling.maxHorizonSec,
    publishLeadSec: scheduling.publishLeadSec,
  };
}

const MINUTE_MS = 60_000;

function ceilMinute(at: Date): Date {
  return new Date(Math.ceil(at.getTime() / MINUTE_MS) * MINUTE_MS);
}

function floorMinute(at: Date): Date {
  return new Date(Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS);
}

export interface PickupWindow {
  readonly pickupAt: Date;
  readonly windowEnd: Date;
}

/**
 * An arrival pickup starts once the traveller can be at the kerb: scheduled
 * landing + the city's arrival buffer, rounded UP to the minute (never earlier
 * than the policy allows).
 */
export function arrivalWindow(
  policy: TransferPolicy,
  landingAt: Date,
  windowSec: number = policy.windowSec,
): PickupWindow {
  const pickupAt = ceilMinute(
    new Date(landingAt.getTime() + policy.arrivalBufferSec * 1000),
  );
  return {
    pickupAt,
    windowEnd: new Date(pickupAt.getTime() + windowSec * 1000),
  };
}

/**
 * A departure drop-off must reach the airport before check-in closes with the
 * city's traffic buffer to spare: departure − cutoff − traffic buffer, rounded
 * DOWN to the minute.
 */
export function departureArriveBy(
  policy: TransferPolicy,
  departAt: Date,
): Date {
  return floorMinute(
    new Date(
      departAt.getTime() -
        (policy.checkInCutoffSec + policy.trafficBufferSec) * 1000,
    ),
  );
}

/**
 * The departure pickup window ends early enough that even the LATEST pickup in
 * it reaches the airport by `arriveBy` on the routed drive time ride-service
 * quoted for this very route.
 */
export function departureWindow(
  arriveBy: Date,
  routedDurationSec: number,
  windowSec: number,
): PickupWindow {
  const windowEnd = floorMinute(
    new Date(arriveBy.getTime() - routedDurationSec * 1000),
  );
  return {
    pickupAt: new Date(windowEnd.getTime() - windowSec * 1000),
    windowEnd,
  };
}

/**
 * When the scheduled request may be created: once the anchor (the arrival
 * pickup, or a departure's arrive-by, which is after its pickup) is inside the
 * market's horizon, with an hour's margin. Before then the transfer waits here
 * as an intent — nothing is held anywhere.
 */
export function submitAfterFor(
  policy: TransferPolicy,
  anchor: Date,
  now: Date,
): Date {
  const margin = Math.min(3_600, Math.floor(policy.maxHorizonSec / 2));
  const at = new Date(
    anchor.getTime() - (policy.maxHorizonSec - margin) * 1000,
  );
  return at > now ? at : now;
}

// ---------------------------------------------------------------------------
// Local time
// ---------------------------------------------------------------------------

interface WallClock {
  readonly date: string;
  readonly time: string;
}

function wallClock(at: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

/** True when `timeZone` is an IANA zone this runtime can phrase times in. */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/**
 * The scheduled request's pickup, phrased as ride-service reads it. When the
 * local time occurs twice (clocks go back), the occurrence this instant is is
 * named explicitly, so ride-service resolves exactly this instant.
 */
export function localSchedule(
  pickupAt: Date,
  timeZone: string,
  windowSec: number,
): MpPickupScheduleInput {
  const local = wallClock(pickupAt, timeZone);
  const hour = 3_600_000;
  const before = wallClock(new Date(pickupAt.getTime() - hour), timeZone);
  const after = wallClock(new Date(pickupAt.getTime() + hour), timeZone);
  const same = (other: WallClock): boolean =>
    other.date === local.date && other.time === local.time;
  const schedule: MpPickupScheduleInput = {
    localDate: local.date,
    localTime: local.time,
    timeZone,
    windowMinutes: Math.floor(windowSec / 60),
  };
  if (same(before)) {
    return { ...schedule, dstDisambiguation: "later" };
  }
  if (same(after)) {
    return { ...schedule, dstDisambiguation: "earlier" };
  }
  return schedule;
}

/** "Wed 23 Sep, 14:05" in the city's zone — display only. */
export function localLabel(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}

// ---------------------------------------------------------------------------
// The words a traveller is shown
// ---------------------------------------------------------------------------

/**
 * What an airport transfer is and is not — replacing the old promise of free
 * retiming and a ride refund, neither of which anything performed. Every line
 * here is something the code below actually does.
 */
export const TRANSFER_TERMS: readonly string[] = [
  "This airport ride is a separate booking from your flight, with its own status, payment and receipt.",
  "No driver is secured until you choose a driver's offer in the ride app. Until then this transfer is pending.",
  "If your flight time changes before drivers are asked, we move the pickup to match, within the spending limit you approved. If the trip now needs more than that limit, we ask you first and send nothing to drivers.",
  "Once a driver is secured we never change the fare or the pickup on our own. If your flight changes, you choose: keep the ride, cancel it under the ride's own cancellation rules, or request a new ride — a new driver is not guaranteed.",
  "Flight changes and refunds follow the airline's rules. Ride charges and refunds follow the ride's rules. Neither pays for the other.",
];

/** Why a transfer failed or was cancelled, in words, with what money did. */
export const OUTCOME_MESSAGES: Readonly<Record<string, string>> = {
  no_driver_found:
    "No driver took this ride in time. Nothing was charged for the ride. Your flight booking is separate and unaffected.",
  pickup_window_passed:
    "The pickup window passed without a driver being secured. Nothing was charged for the ride. Your flight booking is separate and unaffected.",
  pickup_time_passed:
    "The pickup time passed before the ride could be sent to drivers. Nothing was charged for the ride.",
  too_late_for_offers:
    "It was too late to collect driver offers for this pickup. Nothing was charged for the ride.",
  too_late_to_schedule:
    "The pickup is now too soon to schedule. Request a ride in the ride app when you are ready. Nothing was charged.",
  market_unavailable:
    "Airport transfers are not available in this city right now, so no ride was requested. Nothing was charged.",
  payment_method_unavailable:
    "Your payment method cannot be used for rides here, so no ride was requested. Nothing was charged.",
  ride_request_missing:
    "The ride service has no record of this ride request, so no driver is secured. Nothing was charged for the ride.",
  ride_refused:
    "The ride service refused this ride request, so no driver is secured. Nothing was charged for the ride.",
  cancelled_by_traveller:
    "You cancelled this airport ride before any driver was secured. Nothing was charged for the ride.",
  cancelled_after_award:
    "You cancelled this airport ride after a driver was secured. The ride's own cancellation rules apply; any fee is shown on the ride receipt, never on your flight.",
  flight_cancelled:
    "Your flight was cancelled, so we cancelled this airport ride request before any driver was secured. Nothing was charged for the ride. Your flight refund follows the airline's rules.",
  cancelled_in_ride_app:
    "This ride was cancelled in the ride app. No driver is secured for it now. Any ride charge follows the ride's own rules.",
};

export function outcomeOf(reason: string): JsonRecord {
  return {
    reason,
    message:
      OUTCOME_MESSAGES[reason] ??
      "No driver is secured for this ride. Nothing was charged for the ride.",
  };
}
