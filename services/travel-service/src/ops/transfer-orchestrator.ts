/**
 * Airport transfer orchestration: intent → scheduled request → award.
 *
 * A transfer becomes a Book for Later SCHEDULED REQUEST on ride-service (A03,
 * product A), made AS the traveller with the signed ride context. That is a
 * stored intent on ride-service too: it publishes as an ordinary marketplace
 * request at the market's lead time, drivers bid privately and the traveller
 * selects an offer. So no driver's next-job slot is ever held days ahead — the
 * request only reaches drivers near the pickup window. travel-service never
 * awards anything: it learns of the requester-approved award by reading the
 * scheduled request back, and only then marks the transfer `awarded`.
 *
 * Every ride-service call is idempotent under a key derived from the transfer
 * and its generation. The create body is stored BEFORE the call, so a retry
 * after a lost answer replays the very same body (ride-service answers a replay
 * before it re-checks the quote); a canonical refusal means ride-service stored
 * nothing under the key. Every write that depends on what was read is guarded
 * by the row version, so a flight event and a worker pass cannot overwrite each
 * other — the loser re-reads and decides again.
 *
 * Flight changes:
 *  - before the scheduled request is made: the window just moves;
 *  - before publication: the old scheduled request is withdrawn and a new one
 *    made for the new window with the SAME approved spend limit (fresh server
 *    bounds; a minimum above the limit waits for the traveller);
 *  - once drivers were asked, or a driver is secured: nothing moves. The
 *    traveller chooses to keep the ride, cancel it under the ride's own rules,
 *    or request a new one. No accepted fare or pickup is ever changed here, no
 *    current passenger is diverted, and no replacement is promised.
 */
import {
  ContractError,
  isEnabled,
  type EventName,
  type MpCreateScheduledRequest,
  type MpScheduledRequest,
} from "@ubi/contracts";

import { cleanJson } from "./json";
import {
  departureWindow,
  localSchedule,
  outcomeOf,
  transferPolicyOf,
  type TransferPolicy,
} from "./transfer-policy";
import {
  ACTIVE_STATES,
  claimTransfer,
  guardedUpdate,
  isTerminal,
  JSON_NULL,
  principalOf,
  releaseTransfer,
  SYSTEM_ACTOR,
  touchTransfer,
  transitionTransfer,
  type GuardedEvent,
  type TransferRow,
  type TransferUpdate,
} from "./transfer-store";
import { logger } from "../lib/logger";
import { RideRefusal, RideUnavailableError } from "../ports/ride-port";

import type { TravelDeps } from "./context";
import type { Actor, JsonRecord } from "./types";

/** How often a live scheduled request is read back. Plumbing, not policy. */
export const SYNC_INTERVAL_MS = 60_000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 5 * 60_000;
/** An awarded transfer is watched (for a ride-side cancel) this long past its window. */
const AWARDED_WATCH_MS = 2 * 3_600_000;
const MAX_STEPS = 6;

const transferLogger = logger.child({ component: "airport-transfers" });

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

interface PendingCreate {
  readonly generation: number;
  readonly key: string;
  readonly body: MpCreateScheduledRequest;
}

interface WindowTarget {
  readonly pickupAt: string | null;
  readonly windowEnd: string | null;
  readonly arriveBy: string | null;
}

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function pendingOf(row: TransferRow): PendingCreate | null {
  const pending = record(row.pendingCreate);
  if (pending === null) {
    return null;
  }
  return pending as unknown as PendingCreate;
}

function targetOf(value: unknown): WindowTarget | null {
  const target = record(value);
  return target === null ? null : (target as unknown as WindowTarget);
}

function dateOrNull(value: string | null | undefined): Date | null {
  return typeof value === "string" ? new Date(value) : null;
}

function placeOf(value: unknown): { lat: number; lng: number } {
  const place = record(value) ?? {};
  return { lat: Number(place.lat), lng: Number(place.lng) };
}

/** When a not-yet-secured transfer is too late to help the traveller. */
export function deadlineOf(row: TransferRow): Date | null {
  return row.windowEnd ?? row.arriveBy ?? row.pickupAt;
}

function deadlinePassed(row: TransferRow, now: Date): boolean {
  const deadline = deadlineOf(row);
  return deadline !== null && now >= deadline;
}

function driverSecured(view: MpScheduledRequest): boolean {
  return (
    view.driverSecured ||
    (view.state === "published" &&
      (view.requestState === "awarded" || view.requestState === "execution"))
  );
}

function rideFields(view: MpScheduledRequest): TransferUpdate {
  return {
    rideState: view.state,
    rideRequestState: view.requestState,
    rideRequestId: view.requestId,
    rideNotice: cleanJson({
      statusLabel: view.statusLabel,
      notice: view.notice,
      approval: view.approval,
      version: view.version,
    }),
  };
}

/** Integer-only money phrasing for server-written messages. */
export function formatMinor(
  amountMinor: number,
  currency: string,
  digits: number,
): string {
  if (digits <= 0) {
    return `${currency} ${amountMinor}`;
  }
  const scale = 10 ** digits;
  const sign = amountMinor < 0 ? "-" : "";
  const abs = Math.abs(amountMinor);
  const major = Math.trunc(abs / scale);
  const minor = String(abs % scale).padStart(digits, "0");
  return `${currency} ${sign}${major}.${minor}`;
}

// ---------------------------------------------------------------------------
// Choices offered to the traveller
// ---------------------------------------------------------------------------

const CHOICE_LABELS: Readonly<Record<string, string>> = {
  keep: "Keep this ride as it is",
  cancel: "Cancel this ride (the ride's own cancellation rules apply)",
  cancel_free: "Cancel — nothing is charged for the ride",
  rerequest: "Request a new ride for the new time (a driver is not guaranteed)",
  // After an award a re-request first cancels the SECURED ride, under its own
  // rules (a fee may apply): the label says so before the traveller chooses.
  rerequest_after_award:
    "Cancel this ride under its own cancellation rules and request a new one for the new time (a driver is not guaranteed)",
  approve_limit: "Approve a new spending limit",
};

/** Label variants that answer with the same choice key. */
const CHOICE_KEYS: Readonly<Record<string, string>> = {
  cancel_free: "cancel",
  rerequest_after_award: "rerequest",
};

function choices(...keys: readonly string[]): JsonRecord[] {
  return keys.map((key) => ({
    key: CHOICE_KEYS[key] ?? key,
    label: CHOICE_LABELS[key] as string,
  }));
}

export function flightChangedAction(
  after: "publication" | "award",
  proposal: WindowTarget,
  raisedAt: Date,
): JsonRecord {
  if (after === "award") {
    return {
      reason: "flight_changed_after_award",
      message:
        "Your flight time changed after a driver was secured. Your ride's fare and pickup stay exactly as you accepted them unless you choose otherwise: keep the ride, cancel it under the ride's own cancellation rules, or request a new ride for the new time — a new driver is not guaranteed.",
      choices: choices("keep", "cancel", "rerequest_after_award"),
      proposal: cleanJson(proposal) as JsonRecord,
      raisedAt: raisedAt.toISOString(),
    };
  }
  return {
    reason: "flight_changed_after_publication",
    message:
      "Your flight time changed after drivers were already asked for the original pickup time, so we did not change it. No driver is secured yet. Choose: request a new ride for the new time (the current request is cancelled free of charge), cancel, or keep the original pickup time.",
    choices: choices("rerequest", "cancel_free", "keep"),
    proposal: cleanJson(proposal) as JsonRecord,
    raisedAt: raisedAt.toISOString(),
  };
}

/**
 * How a flight-driven ACTION REQUIRED is announced: the flight changed (or
 * was cancelled) after drivers were asked or a driver was secured, nothing
 * moved, and the traveller must choose. The lifecycle state does not change,
 * so no transition event covers it; this is the catalog event for exactly
 * that moment — the `reservation` machine's `pickup_moved` (contracts/
 * state-machines.json: assigned → pickup_moved → assigned | released: the
 * flight moved the pickup and the traveller keeps or releases the ride).
 * The payload carries the reason code and the choice KEYS, never the copy:
 * `actionRequired` (flight_changed_after_publication |
 * flight_changed_after_award | flight_cancelled), `choices`, the proposed
 * window and `driverSecured` (from the transfer event base) — so a consumer
 * never says "confirmed" for a ride no driver secured.
 *
 * notification-service consumes `event:reservation.*`; its copy table has
 * no entry for this name yet (it pushes reservation.requested /
 * .assigned / .reservation_failed), so this reaches the traveller's app
 * timeline now and a push once that copy exists.
 */
export const FLIGHT_ACTION_EVENT: EventName = "reservation.pickup_moved";

/** The ids-and-codes payload of a flight ACTION REQUIRED event. */
export function actionRequiredPayload(action: JsonRecord): JsonRecord {
  const offered = Array.isArray(action.choices)
    ? (action.choices as JsonRecord[]).map((choice) => String(choice.key))
    : [];
  return {
    actionRequired: String(action.reason),
    choices: offered,
    proposal: (action.proposal ?? null) as JsonRecord | null,
    actionRaisedAt: (action.raisedAt ?? null) as string | null,
  };
}

/** The announcement for a flight ACTION REQUIRED set by a guarded write. */
export function flightActionEvent(
  action: JsonRecord,
  occurredAt: Date,
): GuardedEvent {
  return {
    name: FLIGHT_ACTION_EVENT,
    payload: actionRequiredPayload(action),
    occurredAt,
  };
}

export function flightCancelledAfterAwardAction(raisedAt: Date): JsonRecord {
  return {
    reason: "flight_cancelled",
    message:
      "Your flight was cancelled, but a driver is already secured for this ride. We have not cancelled it for you: cancel it under the ride's own cancellation rules, or keep it.",
    choices: choices("cancel", "keep"),
    raisedAt: raisedAt.toISOString(),
  };
}

function fareAboveApprovalAction(
  row: TransferRow,
  minimumMinor: number,
  digits: number,
  raisedAt: Date,
): JsonRecord {
  const approved = Number(row.maxFareMinor);
  return {
    reason: "fare_above_approval",
    message: `The minimum fare for this ride is now ${formatMinor(minimumMinor, row.currency, digits)}, above the ${formatMinor(approved, row.currency, digits)} you approved. Nothing was sent to drivers. Approve a new limit to continue, or cancel.`,
    choices: choices("approve_limit", "cancel_free"),
    minimumFareMinor: { amountMinor: minimumMinor, currency: row.currency },
    approvedMaxFareMinor: { amountMinor: approved, currency: row.currency },
    raisedAt: raisedAt.toISOString(),
  };
}

function rideApprovalAction(
  view: MpScheduledRequest,
  raisedAt: Date,
): JsonRecord {
  const minimum = view.approval?.refreshedTerms?.minimumFareMinor ?? null;
  return {
    reason: "ride_needs_approval",
    message:
      view.approval?.message ??
      "The ride's terms changed since you approved them, so nothing was sent to drivers. Approve to continue, or cancel.",
    choices: choices("approve_limit", "cancel_free"),
    ...(minimum === null ? {} : { minimumFareMinor: minimum }),
    rideVersion: view.version,
    raisedAt: raisedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Terminal moves and retries
// ---------------------------------------------------------------------------

const CLEAR_WORK: TransferUpdate = {
  nextActionAt: null,
  pendingCreate: JSON_NULL,
  retimeTarget: JSON_NULL,
  pendingCancel: null,
  actionRequired: JSON_NULL,
};

async function failTransfer(
  deps: TravelDeps,
  row: TransferRow,
  reason: string,
  actor: Actor = SYSTEM_ACTOR,
  extra: JsonRecord = {},
): Promise<TransferRow | null> {
  const result = await transitionTransfer(deps, {
    row,
    to: "failed",
    data: {
      ...CLEAR_WORK,
      outcome: cleanJson({ ...outcomeOf(reason), ...extra }),
    },
    actor,
    action: "airport_transfer.failed",
    reason,
    event: "reservation.reservation_failed",
    payload: { reason },
    occurredAt: deps.now(),
  });
  return result;
}

async function cancelTransfer(
  deps: TravelDeps,
  row: TransferRow,
  reason: string,
  actor: Actor,
  correlationId: string | null = null,
): Promise<TransferRow | null> {
  const result = await transitionTransfer(deps, {
    row,
    to: "cancelled",
    data: { ...CLEAR_WORK, outcome: cleanJson(outcomeOf(reason)) },
    actor,
    action: "airport_transfer.cancelled",
    reason,
    // The catalog has no reservation.cancelled yet: a cancellation is the
    // failed-reservation event with state `cancelled` and its reason.
    event: "reservation.reservation_failed",
    payload: { reason },
    correlationId,
    occurredAt: deps.now(),
  });
  return result;
}

async function backoff(
  deps: TravelDeps,
  row: TransferRow,
  error: unknown,
): Promise<void> {
  const attempts = row.attempts + 1;
  const delay = Math.min(
    BACKOFF_BASE_MS * 2 ** Math.min(attempts - 1, 8),
    BACKOFF_MAX_MS,
  );
  let message = String(error);
  if (error instanceof ContractError) {
    message = `${error.code}: ${error.message}`;
  } else if (error instanceof Error) {
    message = error.message;
  }
  transferLogger.warn(
    { transferId: row.id, attempts, err: message },
    "airport transfer step did not complete; will retry",
  );
  await touchTransfer(deps, row.id, {
    attempts,
    lastError: message.slice(0, 500),
    nextActionAt: new Date(deps.now().getTime() + delay),
  });
}

// ---------------------------------------------------------------------------
// Submission: quote → stored create body → scheduled request
// ---------------------------------------------------------------------------

interface LoadedPolicy {
  readonly policy: TransferPolicy;
  readonly flagOn: boolean;
  readonly digits: number;
}

async function loadPolicy(
  deps: TravelDeps,
  row: TransferRow,
): Promise<LoadedPolicy | "market_unavailable" | "retry"> {
  try {
    const loaded = await deps.config.load(row.cityId);
    return {
      policy: transferPolicyOf(loaded.city),
      flagOn: isEnabled(loaded.flags, "reservations"),
      digits: loaded.city.currencyFractionDigits,
    };
  } catch (error) {
    if (
      error instanceof ContractError &&
      (error.code === "city_unsupported" ||
        error.code === "market_not_configured")
    ) {
      return "market_unavailable";
    }
    await backoff(deps, row, error);
    return "retry";
  }
}

async function parkForApproval(
  deps: TravelDeps,
  row: TransferRow,
  action: JsonRecord,
  reason: string,
): Promise<void> {
  const deadline = deadlineOf(row);
  const data: TransferUpdate = {
    actionRequired: cleanJson(action),
    nextActionAt: deadline,
    attempts: 0,
    lastError: null,
  };
  if (row.state === "pending_unassigned") {
    await guardedUpdate(deps, row, data, {
      actor: SYSTEM_ACTOR,
      action: "airport_transfer.approval_needed",
      reason,
    });
    return;
  }
  // A re-made request (retime / re-request) that now needs more than the
  // approved limit: nothing is live on ride-service, so the transfer is
  // pending again until the traveller decides.
  await transitionTransfer(deps, {
    row,
    to: "pending_unassigned",
    data,
    actor: SYSTEM_ACTOR,
    action: "airport_transfer.approval_needed",
    reason,
    event: "reservation.requested",
    payload: { reason },
    occurredAt: deps.now(),
  });
}

async function prepareSubmission(
  deps: TravelDeps,
  row: TransferRow,
  now: Date,
): Promise<boolean> {
  const loaded = await loadPolicy(deps, row);
  if (loaded === "retry") {
    return false;
  }
  if (loaded === "market_unavailable") {
    await failTransfer(deps, row, "market_unavailable");
    return false;
  }
  // The kill switch stops NEW rides: a transfer that never reached
  // ride-service is closed honestly. One already there (a retime, a
  // traveller's re-request) is an existing booking and keeps being served.
  if (row.generation === 0 && !loaded.flagOn) {
    await failTransfer(deps, row, "market_unavailable");
    return false;
  }
  // The flight was checked at creation, possibly weeks ago. A ride that never
  // reached ride-service is not started for a flight booking that has since
  // been cancelled or refunded: nothing is sent to drivers for a trip that
  // will not happen (a live one is the traveller's to keep or cancel).
  if (row.generation === 0) {
    const order = await deps.db.travelOrder.findUnique({
      where: { id: row.orderId },
      select: { state: true },
    });
    if (
      order === null ||
      order.state === "cancelled" ||
      order.state === "refunded"
    ) {
      await cancelTransfer(deps, row, "flight_cancelled", SYSTEM_ACTOR);
      return false;
    }
  }

  let quote;
  try {
    quote = await deps.rides.quote(principalOf(row), {
      vehicleClass: row.vehicleClass,
      pickup: placeOf(row.pickup),
      dropoff: placeOf(row.dropoff),
    });
  } catch (error) {
    if (error instanceof RideRefusal) {
      const reason =
        error.code === "market_not_configured" ||
        error.code === "feature_disabled" ||
        error.code === "city_unsupported"
          ? "market_unavailable"
          : "ride_refused";
      await failTransfer(deps, row, reason, SYSTEM_ACTOR, {
        rideCode: error.code,
      });
      return false;
    }
    await backoff(deps, row, error);
    return false;
  }
  if (quote.currency !== row.currency || quote.service !== "ride") {
    transferLogger.error(
      {
        transferId: row.id,
        quoteCurrency: quote.currency,
        currency: row.currency,
      },
      "ride quote does not match the transfer's currency; refusing to schedule",
    );
    await failTransfer(deps, row, "ride_refused", SYSTEM_ACTOR, {
      rideCode: "currency_mismatch",
    });
    return false;
  }

  // An arrival's window is fixed by the leg; a departure's ends a routed
  // drive before the arrive-by time, on THIS quote's drive time.
  let window: { pickupAt: Date; windowEnd: Date } | null = null;
  if (row.direction === "arrival_pickup") {
    if (row.pickupAt !== null && row.windowEnd !== null) {
      window = { pickupAt: row.pickupAt, windowEnd: row.windowEnd };
    }
  } else if (row.arriveBy !== null) {
    window = departureWindow(
      row.arriveBy,
      quote.routedDurationSec,
      row.windowSec,
    );
  }
  if (window === null) {
    await failTransfer(deps, row, "ride_refused", SYSTEM_ACTOR, {
      rideCode: "window_unknown",
    });
    return false;
  }
  if (
    window.pickupAt.getTime() - now.getTime() <
    loaded.policy.minLeadSec * 1000
  ) {
    await failTransfer(deps, row, "too_late_to_schedule");
    return false;
  }

  const minimum = quote.minimumFareMinor.amountMinor;
  const maximum = quote.maximumFareMinor.amountMinor;
  const approved = Number(row.maxFareMinor);
  if (minimum > approved) {
    await parkForApproval(
      deps,
      row,
      fareAboveApprovalAction(row, minimum, loaded.digits, now),
      "the server's minimum fare is above the traveller's approved limit; nothing sent to drivers",
    );
    return false;
  }
  // The asked fare sits inside BOTH the server's fresh bounds and the
  // traveller's approval; ride-service clamps again at publication.
  const ceiling = Math.min(maximum, approved);
  const wanted =
    row.requestedFareMinor === null
      ? quote.suggestedFareMinor.amountMinor
      : Number(row.requestedFareMinor);
  const asked = Math.min(Math.max(wanted, minimum), ceiling);

  const generation = row.generation + 1;
  const pending: PendingCreate = {
    generation,
    key: `${row.id}:g${generation}`,
    body: {
      quoteId: quote.quoteId,
      requestedFareMinor: { amountMinor: asked, currency: row.currency },
      maxFareMinor: { amountMinor: approved, currency: row.currency },
      paymentMethodId: row.paymentMethodId,
      schedule: localSchedule(window.pickupAt, row.timeZone, row.windowSec),
    },
  };
  // Stored before the call: a retry replays exactly this body under this key.
  await guardedUpdate(deps, row, {
    pendingCreate: cleanJson(pending),
    pickupAt: window.pickupAt,
    windowEnd: window.windowEnd,
    lastError: null,
  });
  return true;
}

async function resolvePendingCreate(
  deps: TravelDeps,
  row: TransferRow,
  now: Date,
): Promise<boolean> {
  const pending = pendingOf(row);
  if (pending === null) {
    return true;
  }
  let view: MpScheduledRequest;
  try {
    view = await deps.rides.createScheduledRequest(
      principalOf(row),
      pending.body,
      pending.key,
    );
  } catch (error) {
    if (!(error instanceof RideRefusal)) {
      // Unknown outcome: keep the stored body and replay it later.
      await backoff(deps, row, error);
      return false;
    }
    // Definitive: ride-service stores a result only on success, so nothing
    // exists under this key. Drop the stored body and decide.
    const details = error.details ?? {};
    const cleared: TransferUpdate = { pendingCreate: JSON_NULL };
    switch (error.code) {
      case "quote_expired":
      case "conflict":
        // The quote lapsed (or was used): a fresh one on the next step.
        await guardedUpdate(deps, row, cleared);
        return true;
      case "validation_failed":
        if ("minimumLeadMinutes" in details) {
          await failTransfer(deps, row, "too_late_to_schedule");
          return false;
        }
        if ("maximumHorizonDays" in details) {
          const later = new Date(now.getTime() + 3_600_000);
          await guardedUpdate(deps, row, {
            ...cleared,
            submitAfter: later,
            nextActionAt: later,
          });
          return false;
        }
        await failTransfer(deps, row, "ride_refused", SYSTEM_ACTOR, {
          rideCode: error.code,
        });
        return false;
      case "request_cap_reached": {
        const updated = await guardedUpdate(deps, row, cleared);
        if (updated !== null) {
          await backoff(deps, updated, error);
        }
        return false;
      }
      case "payment_method_unavailable":
        await failTransfer(deps, row, "payment_method_unavailable");
        return false;
      case "market_not_configured":
      case "feature_disabled":
      case "city_unsupported":
        await failTransfer(deps, row, "market_unavailable", SYSTEM_ACTOR, {
          rideCode: error.code,
        });
        return false;
      default:
        await failTransfer(deps, row, "ride_refused", SYSTEM_ACTOR, {
          rideCode: error.code,
        });
        return false;
    }
  }

  const after = await transitionTransfer(deps, {
    row,
    to: "requested",
    data: {
      ...rideFields(view),
      scheduledRequestId: view.scheduledRequestId,
      generation: pending.generation,
      pendingCreate: JSON_NULL,
      pickupAt: new Date(view.schedule.pickupAt),
      windowEnd: new Date(view.schedule.windowEnd),
      attempts: 0,
      lastError: null,
      nextActionAt: new Date(now.getTime() + SYNC_INTERVAL_MS),
    },
    actor: SYSTEM_ACTOR,
    action: "airport_transfer.requested",
    reason:
      "a scheduled ride request was made on ride-service; no driver is secured",
    event: "reservation.requested",
    payload: {
      publishAt: view.publishAt,
      requestedFareMinor: view.requestedFareMinor.amountMinor,
    },
    occurredAt: now,
  });
  if (after === null) {
    // Moved underneath (a flight event); the same key replays next pass.
    return true;
  }
  return after.retimeTarget !== null || view.state !== "scheduled_unassigned";
}

// ---------------------------------------------------------------------------
// Reading ride-service back
// ---------------------------------------------------------------------------

const RIDE_CLOSE_REASONS: Readonly<Record<string, string>> = {
  no_driver_found: "no_driver_found",
  market_unavailable: "market_unavailable",
  pickup_time_passed: "pickup_time_passed",
  too_late_for_offers: "too_late_for_offers",
  cancelled_by_rider: "cancelled_in_ride_app",
};

export async function applyRideView(
  deps: TravelDeps,
  row: TransferRow,
  view: MpScheduledRequest,
  now: Date,
): Promise<boolean> {
  const fields = rideFields(view);
  const next = new Date(now.getTime() + SYNC_INTERVAL_MS);
  const action = record(row.actionRequired);

  if (driverSecured(view)) {
    if (row.state === "awarded") {
      await touchTransfer(deps, row.id, {
        ...fields,
        nextActionAt: next,
        attempts: 0,
      });
      return false;
    }
    // A choice offered while drivers were being asked now concerns a
    // SECURED ride: restate it as such (same proposal, same choices) — and
    // say so on the award's own event, since the choices' terms changed (a
    // cancellation now follows the ride's own rules).
    let actionRequired: TransferUpdate["actionRequired"] = undefined;
    let restated: JsonRecord | null = null;
    if (action?.reason === "flight_changed_after_publication") {
      restated = flightChangedAction(
        "award",
        targetOf(action.proposal) ?? {
          pickupAt: null,
          windowEnd: null,
          arriveBy: null,
        },
        now,
      );
      actionRequired = cleanJson(restated);
    } else if (action?.reason === "ride_needs_approval") {
      actionRequired = JSON_NULL;
    }
    await transitionTransfer(deps, {
      row,
      to: "awarded",
      data: {
        ...fields,
        ...(actionRequired === undefined ? {} : { actionRequired }),
        retimeTarget: JSON_NULL,
        attempts: 0,
        lastError: null,
        nextActionAt: next,
      },
      actor: SYSTEM_ACTOR,
      action: "airport_transfer.awarded",
      reason: "ride-service reported a requester-approved award",
      event: "reservation.assigned",
      payload: {
        requestId: view.requestId,
        ...(restated === null ? {} : actionRequiredPayload(restated)),
      },
      occurredAt: now,
    });
    return false;
  }

  if (
    view.state === "unfulfilled" ||
    view.state === "expired" ||
    view.state === "skipped"
  ) {
    const reason =
      RIDE_CLOSE_REASONS[view.closeReason ?? ""] ?? "no_driver_found";
    await failTransfer(deps, row, reason, SYSTEM_ACTOR, {
      rideState: view.state,
    });
    return false;
  }
  if (view.state === "cancelled") {
    await cancelTransfer(
      deps,
      row,
      row.pendingCancel ?? "cancelled_in_ride_app",
      SYSTEM_ACTOR,
    );
    return false;
  }
  if (view.state === "published") {
    if (view.requestState === "cancelled") {
      await cancelTransfer(
        deps,
        row,
        row.pendingCancel ?? "cancelled_in_ride_app",
        SYSTEM_ACTOR,
      );
      return false;
    }
    if (view.requestState === "expired" || view.requestState === "no_offers") {
      await failTransfer(deps, row, "no_driver_found", SYSTEM_ACTOR, {
        rideRequestState: view.requestState,
      });
      return false;
    }
  }

  // Still in progress on ride-service.
  if (view.state === "needs_rider_approval") {
    if (
      action?.reason !== "ride_needs_approval" ||
      action.rideVersion !== view.version
    ) {
      if (action === null || action.reason === "ride_needs_approval") {
        await guardedUpdate(
          deps,
          row,
          {
            ...fields,
            actionRequired: cleanJson(rideApprovalAction(view, now)),
            nextActionAt: next,
          },
          {
            actor: SYSTEM_ACTOR,
            action: "airport_transfer.approval_needed",
            reason:
              "ride-service's refreshed terms exceed the traveller's approval",
          },
        );
        return false;
      }
    }
  } else if (action?.reason === "ride_needs_approval") {
    await guardedUpdate(deps, row, {
      ...fields,
      actionRequired: JSON_NULL,
      nextActionAt: next,
    });
    return false;
  }
  await touchTransfer(deps, row.id, {
    ...fields,
    nextActionAt: next,
    attempts: 0,
    lastError: null,
  });

  if (row.state === "requested" && deadlinePassed(row, now)) {
    await closeAtDeadline(deps, row);
  }
  return false;
}

async function sync(
  deps: TravelDeps,
  row: TransferRow,
  now: Date,
): Promise<boolean> {
  if (row.scheduledRequestId === null) {
    return false;
  }
  let view: MpScheduledRequest | null;
  try {
    view = await deps.rides.getScheduledRequest(
      principalOf(row),
      row.scheduledRequestId,
    );
  } catch (error) {
    await backoff(deps, row, error);
    return false;
  }
  if (view === null) {
    await failTransfer(deps, row, "ride_request_missing");
    return false;
  }
  return applyRideView(deps, row, view, now);
}

// ---------------------------------------------------------------------------
// Withdrawing what exists on ride-service
// ---------------------------------------------------------------------------

export type Withdrawal =
  | { readonly kind: "withdrawn" }
  | { readonly kind: "secured"; readonly view: MpScheduledRequest }
  | { readonly kind: "published"; readonly requestId: string }
  | { readonly kind: "refused"; readonly error: RideRefusal }
  | { readonly kind: "unavailable"; readonly error: unknown };

function endedOnRide(view: MpScheduledRequest): boolean {
  return (
    view.state === "cancelled" ||
    view.state === "unfulfilled" ||
    view.state === "expired" ||
    view.state === "skipped" ||
    (view.state === "published" &&
      (view.requestState === "cancelled" ||
        view.requestState === "expired" ||
        view.requestState === "no_offers"))
  );
}

async function readBack(
  deps: TravelDeps,
  row: TransferRow,
): Promise<MpScheduledRequest | null | "unavailable"> {
  if (row.scheduledRequestId === null) {
    return null;
  }
  try {
    return await deps.rides.getScheduledRequest(
      principalOf(row),
      row.scheduledRequestId,
    );
  } catch {
    return "unavailable";
  }
}

/**
 * Withdraws the scheduled request (before publication: free), or with
 * `requestToo` the published request as well — under the ride's OWN rules,
 * which ride-service applies (free while open; an awarded ride's rules are
 * its own). Never assumes success: a refusal is read back.
 */
export async function withdrawRide(
  deps: TravelDeps,
  row: TransferRow,
  requestToo: boolean,
): Promise<Withdrawal> {
  if (row.scheduledRequestId === null) {
    return { kind: "withdrawn" };
  }
  const principal = principalOf(row);
  let requestId: string | null =
    row.state === "awarded" ? row.rideRequestId : null;
  if (row.state !== "awarded") {
    try {
      await deps.rides.cancelScheduledRequest(
        principal,
        row.scheduledRequestId,
        `${row.id}:x${row.generation}`,
      );
      return { kind: "withdrawn" };
    } catch (error) {
      if (!(error instanceof RideRefusal)) {
        return { kind: "unavailable", error };
      }
      const closedId = error.details?.requestId;
      if (error.code === "request_closed" && typeof closedId === "string") {
        requestId = closedId;
      } else if (error.code === "not_found") {
        return { kind: "withdrawn" };
      } else {
        const view = await readBack(deps, row);
        if (view === "unavailable") {
          return { kind: "unavailable", error };
        }
        if (view === null || endedOnRide(view)) {
          return { kind: "withdrawn" };
        }
        if (driverSecured(view)) {
          return { kind: "secured", view };
        }
        if (view.state === "published" && view.requestId !== null) {
          requestId = view.requestId;
        } else {
          return { kind: "refused", error };
        }
      }
    }
  }
  if (requestId === null) {
    return { kind: "withdrawn" };
  }
  if (!requestToo) {
    return { kind: "published", requestId };
  }
  try {
    await deps.rides.cancelRequest(
      principal,
      requestId,
      `${row.id}:c${row.generation}`,
    );
    return { kind: "withdrawn" };
  } catch (error) {
    if (!(error instanceof RideRefusal)) {
      return { kind: "unavailable", error };
    }
    const view = await readBack(deps, row);
    if (view === "unavailable") {
      return { kind: "unavailable", error };
    }
    if (view === null || endedOnRide(view)) {
      return { kind: "withdrawn" };
    }
    if (driverSecured(view) && row.state !== "awarded") {
      return { kind: "secured", view };
    }
    return { kind: "refused", error };
  }
}

/** The pickup window passed with no driver secured: withdraw, then fail. */
async function closeAtDeadline(
  deps: TravelDeps,
  row: TransferRow,
): Promise<void> {
  const withdrawal = await withdrawRide(deps, row, true);
  switch (withdrawal.kind) {
    case "withdrawn":
      await failTransfer(deps, row, "pickup_window_passed");
      return;
    case "secured":
      await applyRideView(deps, row, withdrawal.view, deps.now());
      return;
    case "unavailable":
      await backoff(deps, row, withdrawal.error);
      return;
    default:
      // ride-service keeps it (its own expiry will close it); read it again.
      await touchTransfer(deps, row.id, {
        nextActionAt: new Date(deps.now().getTime() + SYNC_INTERVAL_MS),
      });
  }
}

// ---------------------------------------------------------------------------
// Retime before publication
// ---------------------------------------------------------------------------

async function retime(
  deps: TravelDeps,
  row: TransferRow,
  now: Date,
): Promise<boolean> {
  const target = targetOf(row.retimeTarget);
  if (target === null) {
    return true;
  }
  const withdrawal = await withdrawRide(deps, row, false);
  switch (withdrawal.kind) {
    case "withdrawn":
      // The old scheduled request is gone before any driver saw it: the
      // transfer moves to the new window and a new request is made for it,
      // with the same approved limit. This — not the flight event — is the
      // retime, so it is counted and announced here, once.
      await transitionTransfer(deps, {
        row,
        to: "requested",
        data: {
          retimeTarget: JSON_NULL,
          scheduledRequestId: null,
          rideRequestId: null,
          rideState: "cancelled",
          rideRequestState: null,
          rideNotice: JSON_NULL,
          pickupAt: dateOrNull(target.pickupAt),
          windowEnd: dateOrNull(target.windowEnd),
          arriveBy: dateOrNull(target.arriveBy),
          retimedCount: { increment: 1 },
          nextActionAt: now,
        },
        actor: SYSTEM_ACTOR,
        action: "airport_transfer.retime_withdrawn",
        reason:
          "withdrew the scheduled ride for the old flight time before any driver was asked; a new one follows for the new time",
        event: "reservation.retimed",
        payload: {
          phase: "before_publication",
          withdrawnScheduledRequestId: row.scheduledRequestId,
          ...target,
        },
        occurredAt: now,
      });
      return true;
    case "published": {
      // Drivers were already asked for the old time: never move a live
      // request silently. The traveller chooses — and is told so.
      const action = flightChangedAction("publication", target, now);
      await guardedUpdate(
        deps,
        row,
        {
          retimeTarget: JSON_NULL,
          rideState: "published",
          rideRequestId: withdrawal.requestId,
          actionRequired: cleanJson(action),
          nextActionAt: now,
        },
        {
          actor: SYSTEM_ACTOR,
          action: "airport_transfer.choices_offered",
          reason:
            "flight changed after publication; offered keep / cancel / re-request",
        },
        flightActionEvent(action, now),
      );
      return true;
    }
    case "secured": {
      const action = flightChangedAction("award", target, now);
      const updated = await guardedUpdate(
        deps,
        row,
        {
          retimeTarget: JSON_NULL,
          actionRequired: cleanJson(action),
        },
        {
          actor: SYSTEM_ACTOR,
          action: "airport_transfer.choices_offered",
          reason:
            "flight changed after a driver was secured; offered keep / cancel / re-request",
        },
        flightActionEvent(action, now),
      );
      if (updated !== null) {
        await applyRideView(deps, updated, withdrawal.view, now);
      }
      return false;
    }
    case "refused":
      await guardedUpdate(deps, row, {
        retimeTarget: JSON_NULL,
        nextActionAt: now,
      });
      return true;
    default:
      await backoff(deps, row, withdrawal.error);
      return false;
  }
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export type CancelResult =
  | { readonly kind: "cancelled"; readonly row: TransferRow }
  | { readonly kind: "secured" }
  | { readonly kind: "refused"; readonly error: RideRefusal }
  | { readonly kind: "unavailable"; readonly error: unknown }
  | { readonly kind: "raced" };

/**
 * Cancels a transfer and whatever exists for it on ride-service. Before an
 * award that is free. An awarded ride is cancelled only when the traveller
 * asked (`travellerAfterAward`), under the ride's own rules — ride-service
 * decides, and a refusal leaves the transfer awarded.
 */
export async function executeCancel(
  deps: TravelDeps,
  start: TransferRow,
  reason: string,
  actor: Actor,
  correlationId: string | null,
): Promise<CancelResult> {
  let row = start;
  const now = deps.now();
  if (pendingOf(row) !== null) {
    // Settle an in-flight create first, so we know what exists to withdraw.
    await resolvePendingCreate(deps, row, now);
    const reread = await deps.db.airportTransfer.findUnique({
      where: { id: row.id },
    });
    if (reread === null) {
      return { kind: "raced" };
    }
    row = reread;
    if (isTerminal(row.state)) {
      return { kind: "raced" };
    }
    if (pendingOf(row) !== null) {
      return {
        kind: "unavailable",
        error: new RideUnavailableError(
          "the ride marketplace did not answer; try again",
          "ride_unavailable",
        ),
      };
    }
  }
  const awarded = row.state === "awarded";
  if (awarded && actor.role === "system") {
    // Nothing automatic ever cancels a secured ride.
    return { kind: "secured" };
  }
  const withdrawal = await withdrawRide(deps, row, true);
  switch (withdrawal.kind) {
    case "withdrawn": {
      const cancelled = await cancelTransfer(
        deps,
        row,
        awarded ? "cancelled_after_award" : reason,
        actor,
        correlationId,
      );
      return cancelled === null
        ? { kind: "raced" }
        : { kind: "cancelled", row: cancelled };
    }
    case "secured":
      await applyRideView(deps, row, withdrawal.view, now);
      return { kind: "secured" };
    case "refused":
      return { kind: "refused", error: withdrawal.error };
    case "published":
      // withdrawRide only answers `published` without requestToo.
      return { kind: "raced" };
    default:
      return { kind: "unavailable", error: withdrawal.error };
  }
}

// ---------------------------------------------------------------------------
// The step machine
// ---------------------------------------------------------------------------

async function stepSubmission(
  deps: TravelDeps,
  row: TransferRow,
  now: Date,
): Promise<boolean> {
  if (pendingOf(row) !== null) {
    return resolvePendingCreate(deps, row, now);
  }
  if (deadlinePassed(row, now)) {
    await failTransfer(deps, row, "pickup_window_passed");
    return false;
  }
  if (row.actionRequired !== null) {
    // Waiting for the traveller; look again at the deadline.
    await touchTransfer(deps, row.id, { nextActionAt: deadlineOf(row) });
    return false;
  }
  if (row.state === "pending_unassigned" && row.submitAfter > now) {
    await touchTransfer(deps, row.id, { nextActionAt: row.submitAfter });
    return false;
  }
  return prepareSubmission(deps, row, now);
}

async function stepOnce(deps: TravelDeps, row: TransferRow): Promise<boolean> {
  const now = deps.now();
  if (isTerminal(row.state)) {
    if (row.nextActionAt !== null) {
      await touchTransfer(deps, row.id, { nextActionAt: null });
    }
    return false;
  }
  if (row.pendingCancel !== null) {
    const result = await executeCancel(
      deps,
      row,
      row.pendingCancel,
      SYSTEM_ACTOR,
      null,
    );
    if (result.kind === "secured") {
      // A driver was secured before the cancel reached ride-service: never
      // auto-cancel a secured ride — the traveller chooses.
      const reread = await deps.db.airportTransfer.findUnique({
        where: { id: row.id },
      });
      if (reread !== null && reread.pendingCancel === "flight_cancelled") {
        // The flight is gone but the ride is secured: the traveller decides
        // (cancel under the ride's own rules, or keep) — and is told so.
        const action = flightCancelledAfterAwardAction(now);
        await guardedUpdate(
          deps,
          reread,
          { pendingCancel: null, actionRequired: cleanJson(action) },
          {
            actor: SYSTEM_ACTOR,
            action: "airport_transfer.choices_offered",
            reason:
              "flight cancelled after a driver was secured; offered cancel / keep",
          },
          flightActionEvent(action, now),
        );
      } else if (reread !== null && reread.pendingCancel !== null) {
        await guardedUpdate(deps, reread, { pendingCancel: null });
      }
    } else if (result.kind === "unavailable") {
      await backoff(deps, row, result.error);
    } else if (result.kind === "refused") {
      await guardedUpdate(deps, row, {
        pendingCancel: null,
        nextActionAt: now,
      });
      return true;
    }
    return false;
  }
  switch (row.state) {
    case "pending_unassigned":
      return stepSubmission(deps, row, now);
    case "requested":
      if (row.scheduledRequestId === null) {
        return stepSubmission(deps, row, now);
      }
      if (row.retimeTarget !== null) {
        return retime(deps, row, now);
      }
      return sync(deps, row, now);
    case "awarded": {
      const end = row.windowEnd ?? row.pickupAt ?? now;
      if (now.getTime() - end.getTime() > AWARDED_WATCH_MS) {
        await touchTransfer(deps, row.id, { nextActionAt: null });
        return false;
      }
      return sync(deps, row, now);
    }
    default:
      return false;
  }
}

/** Drives a transfer the caller holds the lease on, a few steps at most. */
export async function driveTransfer(
  deps: TravelDeps,
  start: TransferRow,
): Promise<TransferRow> {
  let row = start;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const more = await stepOnce(deps, row);
    const reread = await deps.db.airportTransfer.findUnique({
      where: { id: row.id },
    });
    if (reread === null) {
      return row;
    }
    row = reread;
    if (!more) {
      break;
    }
  }
  return row;
}

/** One orchestration pass on one transfer (no-op if another holds it). */
export async function advanceTransfer(
  deps: TravelDeps,
  transferId: string,
): Promise<void> {
  const row = await claimTransfer(deps, transferId);
  if (row === null) {
    return;
  }
  try {
    await driveTransfer(deps, row);
  } finally {
    await releaseTransfer(deps, transferId);
  }
}

/**
 * The durable worker pass: every live transfer whose next action is due —
 * a submission whose horizon opened, a retime, a read-back of a live
 * scheduled request, a deadline. Replays are harmless: every step is keyed
 * and version-guarded.
 */
export async function runTransferSweep(
  deps: TravelDeps,
  limit = 50,
): Promise<number> {
  const due = await deps.db.airportTransfer.findMany({
    where: {
      state: { in: [...ACTIVE_STATES] },
      nextActionAt: { lte: deps.now() },
    },
    orderBy: { nextActionAt: "asc" },
    take: limit,
    select: { id: true },
  });
  for (const { id } of due) {
    try {
      await advanceTransfer(deps, id);
    } catch (error) {
      transferLogger.error(
        { err: error, transferId: id },
        "airport transfer pass failed",
      );
    }
  }
  return due.length;
}
