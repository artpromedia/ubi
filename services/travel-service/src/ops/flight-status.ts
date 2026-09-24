/**
 * Verified flight status events → airport transfers.
 *
 * A delay or a cancellation of one leg of a flight order is recorded once —
 * deduped by (source, event id) — and applied to that leg's live transfers in
 * the SAME transaction, so an event is either fully applied or not recorded at
 * all (a crash never leaves it "seen" but unapplied). Application is monotonic:
 * an observation older than the last one applied is recorded but changes
 * nothing, and a cancellation is final.
 *
 * What an event may do depends on how far the ride got (see
 * ./transfer-orchestrator.ts): the window of a transfer nothing was sent for
 * just moves; a scheduled request not yet published is withdrawn and re-made
 * by the orchestrator (retime, same approved limit); once drivers were asked or
 * a driver is secured, the traveller is offered choices and nothing moves. A
 * cancelled flight withdraws a not-yet-secured ride (free) but never cancels a
 * secured one. Flight money is never touched here: the flight's own refund
 * follows its order's rules.
 */
import { ContractError, type EventName } from "@ubi/contracts";

import { cleanJson } from "./json";
import { withOutbox, type OutboxInput, type OutboxTx } from "./outbox";
import {
  actionRequiredPayload,
  FLIGHT_ACTION_EVENT,
  flightCancelledAfterAwardAction,
  flightChangedAction,
} from "./transfer-orchestrator";
import {
  arrivalWindow,
  departureArriveBy,
  outcomeOf,
  submitAfterFor,
  transferPolicyOf,
  type TransferPolicy,
} from "./transfer-policy";
import {
  ACTIVE_STATES,
  actorTypeOf,
  assertTransferTransition,
  JSON_NULL,
  transferEvent,
  type TransferRow,
  type TransferUpdate,
} from "./transfer-store";
import { generateId } from "../lib/ids";

import type { TravelDeps } from "./context";
import type { Actor, JsonRecord } from "./types";

export const FLIGHT_STATUSES = ["delayed", "cancelled"] as const;
export type FlightStatus = (typeof FLIGHT_STATUSES)[number];

export interface FlightStatusInput {
  readonly actor: Actor;
  /** Who verified it (e.g. `ops:airline_notice`, a supplier id). */
  readonly source: string;
  readonly eventId: string;
  readonly orderId: string;
  readonly legIndex: number;
  readonly status: FlightStatus;
  /** The leg's new scheduled/estimated times (a delay must give at least one). */
  readonly departAt: Date | null;
  readonly arriveAt: Date | null;
  readonly observedAt: Date;
  readonly correlationId: string | null;
}

export interface FlightStatusResult {
  readonly duplicate: boolean;
  readonly applied: readonly { transferId: string; outcome: string }[];
}

class DuplicateEvent extends Error {}
class Raced extends Error {}

interface Plan {
  readonly outcome: string;
  readonly data?: TransferUpdate;
  /** A lifecycle move made right here (a pending intent the flight cancelled). */
  readonly to?: "cancelled";
  readonly event?: EventName;
  readonly eventPayload?: JsonRecord;
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/**
 * Nothing moves; the traveller chooses. The ACTION REQUIRED is announced
 * with the flight event's own outbox row (FLIGHT_ACTION_EVENT).
 */
function choicesOffered(base: TransferUpdate, action: JsonRecord): Plan {
  return {
    outcome: "choices_offered",
    data: { ...base, actionRequired: cleanJson(action) },
    event: FLIGHT_ACTION_EVENT,
    eventPayload: actionRequiredPayload(action),
  };
}

function planFor(
  row: TransferRow,
  input: FlightStatusInput,
  policy: TransferPolicy,
  now: Date,
): Plan {
  if (row.flightStatus === "cancelled") {
    return { outcome: "ignored_flight_already_cancelled" };
  }
  if (row.flightStatusAt !== null && input.observedAt <= row.flightStatusAt) {
    return { outcome: "ignored_stale" };
  }
  const departAt = input.departAt ?? row.flightDepartAt;
  const arriveAt = input.arriveAt ?? row.flightArriveAt;
  const base: TransferUpdate = {
    flightStatus: input.status,
    flightStatusAt: input.observedAt,
    flightDepartAt: departAt,
    flightArriveAt: arriveAt,
  };
  const nothingOnRide =
    row.scheduledRequestId === null && row.pendingCreate === null;

  if (input.status === "cancelled") {
    if (row.state === "awarded") {
      return choicesOffered(base, flightCancelledAfterAwardAction(now));
    }
    if (nothingOnRide) {
      return {
        outcome: "cancelled",
        to: "cancelled",
        data: {
          ...base,
          nextActionAt: null,
          retimeTarget: JSON_NULL,
          actionRequired: JSON_NULL,
          outcome: cleanJson(outcomeOf("flight_cancelled")),
        },
        event: "reservation.reservation_failed",
        eventPayload: { reason: "flight_cancelled" },
      };
    }
    // Something exists on ride-service and no driver is secured: the
    // orchestrator withdraws it (free) and cancels.
    return {
      outcome: "cancel_pending",
      data: { ...base, pendingCancel: "flight_cancelled", nextActionAt: now },
    };
  }

  // A delay (or any schedule move): the window the new times imply.
  let target: {
    pickupAt: Date | null;
    windowEnd: Date | null;
    arriveBy: Date | null;
  };
  if (row.direction === "arrival_pickup") {
    const window = arrivalWindow(policy, arriveAt, row.windowSec);
    target = {
      pickupAt: window.pickupAt,
      windowEnd: window.windowEnd,
      arriveBy: null,
    };
  } else {
    // A departure's pickup is derived from the route when the request is made.
    target = {
      pickupAt: null,
      windowEnd: null,
      arriveBy: departureArriveBy(policy, departAt),
    };
  }
  const proposal = {
    pickupAt: iso(target.pickupAt),
    windowEnd: iso(target.windowEnd),
    arriveBy: iso(target.arriveBy),
  };
  const current = row.retimeTarget as {
    pickupAt?: string | null;
    arriveBy?: string | null;
  } | null;
  const unchanged =
    row.direction === "arrival_pickup"
      ? sameInstant(
          target.pickupAt,
          current?.pickupAt ? new Date(current.pickupAt) : row.pickupAt,
        )
      : sameInstant(
          target.arriveBy,
          current?.arriveBy ? new Date(current.arriveBy) : row.arriveBy,
        );
  if (unchanged) {
    return { outcome: "unchanged", data: base };
  }

  if (row.state === "awarded") {
    return choicesOffered(base, flightChangedAction("award", proposal, now));
  }
  if (row.state === "requested" && row.rideState === "published") {
    return choicesOffered(
      base,
      flightChangedAction("publication", proposal, now),
    );
  }
  const retimed: TransferUpdate = { ...base, retimedCount: { increment: 1 } };
  if (nothingOnRide) {
    // Nothing was sent anywhere: the window simply moves.
    const anchor = target.pickupAt ?? target.arriveBy;
    const submitAfter =
      anchor === null ? now : submitAfterFor(policy, anchor, now);
    // A re-made request is due now; an intent waits for its horizon — or,
    // while the traveller is being asked something, for its deadline.
    let nextActionAt: Date | null = now;
    if (row.state !== "requested") {
      nextActionAt =
        row.actionRequired === null
          ? submitAfter
          : (target.windowEnd ?? target.arriveBy);
    }
    return {
      outcome: "retimed",
      data: {
        ...retimed,
        pickupAt: target.pickupAt,
        windowEnd: target.windowEnd,
        arriveBy: target.arriveBy,
        submitAfter,
        nextActionAt,
      },
      event: "reservation.retimed",
      eventPayload: { phase: "before_request", ...proposal },
    };
  }
  // A scheduled request (or one being made) exists for the OLD window and,
  // as far as we know, has not been published: the orchestrator withdraws it
  // and re-makes it for the new window. If ride-service says it was
  // published meanwhile, that becomes a choice instead. Nothing is retimed
  // YET, so nothing is counted or announced as retimed here: the
  // orchestrator counts the retime and emits `reservation.retimed` only once
  // the old request is actually withdrawn and the window really moves.
  return {
    outcome: "retime_pending",
    data: { ...base, retimeTarget: cleanJson(proposal), nextActionAt: now },
  };
}

async function applyPlan(
  tx: OutboxTx,
  row: TransferRow,
  plan: Plan,
  input: FlightStatusInput,
  now: Date,
): Promise<OutboxInput[]> {
  if (plan.data === undefined) {
    return [];
  }
  if (plan.to !== undefined) {
    assertTransferTransition(row.state, plan.to);
  }
  const updated = await tx.airportTransfer.updateMany({
    where: { id: row.id, version: row.version },
    data: {
      ...plan.data,
      ...(plan.to === undefined ? {} : { state: plan.to }),
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    throw new Raced();
  }
  const after = await tx.airportTransfer.findUniqueOrThrow({
    where: { id: row.id },
  });
  await tx.auditLog.create({
    data: {
      id: generateId("aud"),
      actorId: input.actor.id,
      actorRole: input.actor.role,
      action: `airport_transfer.flight_${input.status}`,
      subjectType: "airport_transfer",
      subjectId: row.id,
      before: cleanJson({
        state: row.state,
        version: row.version,
        pickupAt: iso(row.pickupAt),
      }),
      after: cleanJson({
        state: after.state,
        version: after.version,
        pickupAt: iso(after.pickupAt),
        outcome: plan.outcome,
      }),
      reason: `verified flight status ${input.status} (${input.source}:${input.eventId}): ${plan.outcome}`,
    },
  });
  if (plan.event === undefined) {
    return [];
  }
  return [
    transferEvent(plan.event, after, row.version, input.actor, {
      occurredAt: now,
      correlationId: input.correlationId,
      payload: {
        flightEventId: input.eventId,
        flightStatus: input.status,
        retimedCount: after.retimedCount,
        ...plan.eventPayload,
      },
    }),
  ];
}

/**
 * Records one verified flight status event and applies it to the leg's live
 * transfers. A duplicate (same source + event id) changes nothing.
 */
export async function recordFlightStatus(
  deps: TravelDeps,
  input: FlightStatusInput,
): Promise<FlightStatusResult> {
  if (
    input.status === "delayed" &&
    input.departAt === null &&
    input.arriveAt === null
  ) {
    throw new ContractError(
      "validation_failed",
      "a delay must state the leg's new departure or arrival time",
      { field: "departAt" },
    );
  }
  const order = await deps.db.travelOrder.findUnique({
    where: { id: input.orderId },
  });
  if (order === null || order.kind !== "flight") {
    throw new ContractError("not_found", "no such flight order", {
      orderId: input.orderId,
    });
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const seen = await deps.db.travelFlightStatusEvent.findUnique({
      where: {
        source_eventId: { source: input.source, eventId: input.eventId },
      },
    });
    if (seen !== null) {
      return { duplicate: true, applied: [] };
    }
    const now = deps.now();
    const transfers = await deps.db.airportTransfer.findMany({
      where: {
        orderId: input.orderId,
        legIndex: input.legIndex,
        state: { in: [...ACTIVE_STATES] },
      },
      orderBy: { createdAt: "asc" },
    });
    const policies = new Map<string, TransferPolicy>();
    for (const row of transfers) {
      if (!policies.has(row.cityId)) {
        const loaded = await deps.config.load(row.cityId);
        policies.set(row.cityId, transferPolicyOf(loaded.city));
      }
    }
    try {
      return await withOutbox(deps.db, async (tx) => {
        const eventRowId = generateId("tfs");
        try {
          await tx.travelFlightStatusEvent.create({
            data: {
              id: eventRowId,
              source: input.source,
              eventId: input.eventId,
              orderId: input.orderId,
              legIndex: input.legIndex,
              status: input.status,
              departAt: input.departAt,
              arriveAt: input.arriveAt,
              observedAt: input.observedAt,
            },
          });
        } catch (error) {
          if ((error as { code?: string }).code === "P2002") {
            throw new DuplicateEvent();
          }
          throw error;
        }
        const applied: { transferId: string; outcome: string }[] = [];
        const events: OutboxInput[] = [];
        for (const row of transfers) {
          const plan = planFor(
            row,
            input,
            policies.get(row.cityId) as TransferPolicy,
            now,
          );
          events.push(...(await applyPlan(tx, row, plan, input, now)));
          applied.push({ transferId: row.id, outcome: plan.outcome });
        }
        await tx.travelFlightStatusEvent.update({
          where: { id: eventRowId },
          data: { outcome: cleanJson({ applied }) },
        });
        events.unshift({
          name: "flight.status_changed",
          aggregateType: "travel_order",
          aggregateId: input.orderId,
          fromVersion: null,
          toVersion: 1,
          actor: input.actor,
          actorType: actorTypeOf(input.actor),
          cityId: order.cityId,
          idempotencyKey: `flight.status_changed:${input.source}:${input.eventId}`,
          correlationId: input.correlationId,
          occurredAt: now,
          payload: {
            orderId: input.orderId,
            legIndex: input.legIndex,
            status: input.status,
            departAt: iso(input.departAt),
            arriveAt: iso(input.arriveAt),
            observedAt: input.observedAt.toISOString(),
            transfers: applied,
          },
        });
        return { result: { duplicate: false, applied }, events };
      });
    } catch (error) {
      if (error instanceof DuplicateEvent) {
        return { duplicate: true, applied: [] };
      }
      if (error instanceof Raced) {
        continue;
      }
      throw error;
    }
  }
  throw new ContractError(
    "conflict",
    "the airport transfers for this flight are being updated; send the event again",
    { orderId: input.orderId },
  );
}
