/**
 * Airport transfers (P16 / recheck T03) — the traveller-facing flows.
 *
 * Replaces the airport "reservation" fiction, which wrote a link row and a
 * `reservation.reserved` event and called that a reserved ride: no
 * marketplace request, no award, no stored pickup, a retry answered with the
 * new caller's values, any order kind accepted, and a compensation promise
 * (free retiming, a ride refund) nothing performed.
 *
 * A transfer is an INTENT linked to a FLIGHT order the traveller owns, in a
 * booked state, in the same city. Its pickup window is derived server-side from
 * the chosen leg under the city's airport policy; the traveller states only the
 * places, the class, the payment method and the most they approve to spend.
 * Creating one secures nothing: the orchestrator (./transfer-orchestrator.ts)
 * makes a scheduled ride request on ride-service near the trip, and only a
 * requester-approved award reported back makes it `awarded`.
 *
 * Create is idempotent with an immutable stored answer: the id derives from
 * the scoped Idempotency-Key, and a replay whose normalized body hashes
 * differently is refused with `idempotency_key_reuse` — never answered with the
 * new caller's values. Traveller actions are recorded the same way.
 *
 * The flight and the ride stay financially separate (CLAUDE.md #25): nothing
 * here authorizes, captures or refunds anything. The ride's money is
 * ride-service's (the traveller's own funding at award, the driver's 10%
 * captured once there); the flight's is its order's.
 */
import { createHash } from "node:crypto";

import {
  ContractError,
  scopedIdempotencyKey,
  type Money,
} from "@ubi/contracts";

import { assertFlagEnabled } from "./config";
import { cleanJson } from "./json";
import { withOutbox } from "./outbox";
import { isOpsRole } from "./roles";
import {
  applyRideView,
  driveTransfer,
  executeCancel,
  withdrawRide,
} from "./transfer-orchestrator";
import {
  arrivalWindow,
  departureArriveBy,
  flightLegs,
  isKnownTimeZone,
  submitAfterFor,
  transferPolicyOf,
  type TransferDirection,
} from "./transfer-policy";
import {
  claimTransfer,
  isTerminal,
  JSON_NULL,
  principalOf,
  releaseTransfer,
  transferEvent,
  transitionTransfer,
  type TransferRow,
} from "./transfer-store";
import { transferView } from "./transfer-view";
import { deterministicId, generateId } from "../lib/ids";
import { RideRefusal, RideUnavailableError } from "../ports/ride-port";

import type { TravelDeps } from "./context";
import type { Actor, JsonRecord } from "./types";

/** A flight a ride can be arranged against: the booking really exists. */
const BOOKED_FLIGHT_STATES: ReadonlySet<string> = new Set([
  "confirmed",
  "ticketed",
]);

/** Travellers book airport rides as the ride's requester. */
const TRANSFER_ROLE = "rider";

export interface TransferPlaceInput {
  readonly lat: number;
  readonly lng: number;
  readonly label?: string;
}

export interface CreateTransferBody {
  readonly linkedOrderId: string;
  readonly legIndex: number;
  readonly direction: TransferDirection;
  /** The traveller's meeting / drop point at the terminal. */
  readonly airportPoint: TransferPlaceInput;
  /** The other end: where the traveller is going to or coming from. */
  readonly place: TransferPlaceInput;
  readonly vehicleClass: string;
  /** The most the traveller approves for this ride — every retime included. */
  readonly maxFareMinor: Money;
  readonly requestedFareMinor?: Money;
  readonly paymentMethodId: string;
}

export interface CreateTransferInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly body: CreateTransferBody;
  readonly idempotencyKey: string;
  readonly correlationId: string | null;
}

export interface TransferAnswer {
  readonly status: number;
  readonly body: JsonRecord;
  readonly replayed: boolean;
}

function hashOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizedPlace(place: TransferPlaceInput): JsonRecord {
  return { lat: place.lat, lng: place.lng, label: place.label ?? null };
}

/** Fixed key order: the same request always hashes the same. */
function createHashOf(cityId: string, body: CreateTransferBody): string {
  return hashOf([
    cityId,
    body.linkedOrderId,
    body.legIndex,
    body.direction,
    normalizedPlace(body.airportPoint),
    normalizedPlace(body.place),
    body.vehicleClass,
    [body.maxFareMinor.amountMinor, body.maxFareMinor.currency],
    body.requestedFareMinor === undefined
      ? null
      : [body.requestedFareMinor.amountMinor, body.requestedFareMinor.currency],
    body.paymentMethodId,
  ]);
}

function refuse(
  message: string,
  reason: string,
  extra: JsonRecord = {},
): never {
  throw new ContractError("validation_failed", message, { reason, ...extra });
}

function replayOrConflict(existing: TransferRow, hash: string): TransferAnswer {
  if (existing.requestHash !== hash) {
    // Never echo the stored transfer to a request that does not match it.
    throw new ContractError(
      "idempotency_key_reuse",
      "this Idempotency-Key was already used for a different airport transfer request",
    );
  }
  return {
    status: 202,
    body: existing.createResult as JsonRecord,
    replayed: true,
  };
}

/**
 * Stores a transfer intent (`pending_unassigned`). Nothing is requested,
 * reserved or charged by this call; the answer says so.
 */
export async function createTransfer(
  deps: TravelDeps,
  input: CreateTransferInput,
): Promise<TransferAnswer> {
  const { actor, body, cityId } = input;
  const transferId = deterministicId(
    "trf",
    scopedIdempotencyKey("travel.transfer", actor.id, input.idempotencyKey),
  );
  const hash = createHashOf(cityId, body);

  const existing = await deps.db.airportTransfer.findUnique({
    where: { id: transferId },
  });
  if (existing !== null) {
    return replayOrConflict(existing, hash);
  }

  const config = await deps.config.load(cityId);
  assertFlagEnabled(config.flags, "reservations");
  if (actor.role !== TRANSFER_ROLE) {
    throw new ContractError(
      "forbidden",
      "an airport ride is arranged by the traveller, as its rider",
      { reason: "role_not_requester" },
    );
  }

  // The linked order: the traveller's own FLIGHT, booked, in this city.
  const order = await deps.db.travelOrder.findUnique({
    where: { id: body.linkedOrderId },
  });
  if (order === null || order.userId !== actor.id) {
    throw new ContractError("not_found", "no such flight order to link", {
      orderId: body.linkedOrderId,
    });
  }
  if (order.kind !== "flight") {
    refuse(
      "an airport transfer links to a flight order",
      "linked_order_not_flight",
      { field: "linkedOrderId", kind: order.kind },
    );
  }
  if (!BOOKED_FLIGHT_STATES.has(order.state)) {
    throw new ContractError(
      "conflict",
      "the flight must be confirmed or ticketed before an airport ride can be arranged",
      { reason: "flight_not_booked", orderState: order.state },
    );
  }
  if (order.cityId !== cityId) {
    refuse(
      "this flight was booked in a different city",
      "order_city_mismatch",
      { field: "linkedOrderId" },
    );
  }

  const policy = transferPolicyOf(config.city);
  if (!isKnownTimeZone(policy.timeZone)) {
    throw new ContractError(
      "config_unavailable",
      "the city's time zone cannot be read; airport transfers are closed until it is fixed",
      { cityId },
    );
  }
  const leg = flightLegs(order.offerSnapshot).find(
    (candidate) => candidate.index === body.legIndex,
  );
  if (leg === undefined) {
    refuse("the flight has no such leg", "flight_leg_unknown", {
      field: "legIndex",
    });
  }
  const airportCode = body.direction === "arrival_pickup" ? leg.to : leg.from;
  if (airportCode === null) {
    refuse(
      "the flight leg does not name its airport",
      "flight_leg_airport_unknown",
      { field: "legIndex" },
    );
  }
  if (!policy.airportCodes.includes(airportCode)) {
    refuse("that airport is not served in this city", "airport_not_in_city", {
      airportCode,
    });
  }
  if (!config.city.vehicleClasses.includes(body.vehicleClass as never)) {
    refuse(
      "this city does not offer that vehicle class",
      "vehicle_class_unknown",
      {
        field: "vehicleClass",
      },
    );
  }
  if (
    body.maxFareMinor.currency !== policy.currency ||
    (body.requestedFareMinor !== undefined &&
      body.requestedFareMinor.currency !== policy.currency)
  ) {
    refuse(`amounts must be in ${policy.currency}`, "currency_mismatch", {
      field: "maxFareMinor",
      currency: policy.currency,
    });
  }
  if (
    body.requestedFareMinor !== undefined &&
    body.requestedFareMinor.amountMinor > body.maxFareMinor.amountMinor
  ) {
    refuse(
      "the asked fare cannot be above the limit you approve",
      "requested_above_limit",
      { field: "requestedFareMinor" },
    );
  }
  const method = config.city.paymentMethods.find(
    (candidate) => candidate.id === body.paymentMethodId,
  );
  if (method === undefined || !method.available) {
    throw new ContractError(
      "payment_method_unavailable",
      `${body.paymentMethodId} cannot be used in this city`,
      { paymentMethodId: body.paymentMethodId },
    );
  }

  // The pickup window, from the leg — never from the client.
  const now = deps.now();
  let pickupAt: Date | null = null;
  let windowEnd: Date | null = null;
  let arriveBy: Date | null = null;
  let anchor: Date;
  if (body.direction === "arrival_pickup") {
    const window = arrivalWindow(policy, leg.arriveAt);
    pickupAt = window.pickupAt;
    windowEnd = window.windowEnd;
    anchor = window.pickupAt;
  } else {
    arriveBy = departureArriveBy(policy, leg.departAt);
    anchor = arriveBy;
  }
  if (anchor.getTime() - now.getTime() < policy.minLeadSec * 1000) {
    refuse(
      "this pickup is too soon to schedule; request a ride in the ride app when you are ready",
      "pickup_too_soon",
      { minimumLeadMinutes: Math.floor(policy.minLeadSec / 60) },
    );
  }
  const submitAfter = submitAfterFor(policy, anchor, now);

  const door = policy.doors[airportCode];
  const airportPlace = {
    lat: body.airportPoint.lat,
    lng: body.airportPoint.lng,
    label:
      body.airportPoint.label ??
      (door === undefined
        ? `${airportCode} airport`
        : `${airportCode} airport — ${door}`),
  };
  const otherPlace = {
    lat: body.place.lat,
    lng: body.place.lng,
    label: body.place.label ?? "Your address",
  };
  const arrival = body.direction === "arrival_pickup";

  try {
    return await withOutbox(deps.db, async (tx) => {
      const created = await tx.airportTransfer.create({
        data: {
          id: transferId,
          orderId: order.id,
          userId: actor.id,
          cityId,
          direction: body.direction,
          legIndex: leg.index,
          flightNumber: leg.flightNumber,
          airportCode,
          flightDepartAt: leg.departAt,
          flightArriveAt: leg.arriveAt,
          pickup: cleanJson(arrival ? airportPlace : otherPlace),
          dropoff: cleanJson(arrival ? otherPlace : airportPlace),
          timeZone: policy.timeZone,
          pickupAt,
          windowEnd,
          arriveBy,
          windowSec: policy.windowSec,
          vehicleClass: body.vehicleClass,
          currency: policy.currency,
          maxFareMinor: BigInt(body.maxFareMinor.amountMinor),
          requestedFareMinor:
            body.requestedFareMinor === undefined
              ? null
              : BigInt(body.requestedFareMinor.amountMinor),
          paymentMethodId: body.paymentMethodId,
          policyVersion: policy.version,
          state: "pending_unassigned",
          submitAfter,
          nextActionAt: submitAfter,
          requestHash: hash,
          createResult: {},
        },
      });
      const view = transferView(created);
      const stored = await tx.airportTransfer.update({
        where: { id: transferId },
        data: { createResult: cleanJson(view) },
      });
      await tx.auditLog.create({
        data: {
          id: generateId("aud"),
          actorId: actor.id,
          actorRole: actor.role,
          action: "airport_transfer.created",
          subjectType: "airport_transfer",
          subjectId: transferId,
          after: cleanJson({
            state: stored.state,
            orderId: order.id,
            direction: body.direction,
            legIndex: leg.index,
            pickupAt: pickupAt?.toISOString() ?? null,
            arriveBy: arriveBy?.toISOString() ?? null,
            maxFareMinor: body.maxFareMinor.amountMinor,
            currency: policy.currency,
            policyVersion: policy.version,
            driverSecured: false,
          }),
          reason: "traveller asked for an airport ride; nothing is secured yet",
        },
      });
      return {
        result: { status: 202, body: view, replayed: false },
        events: [
          transferEvent("reservation.requested", stored, null, actor, {
            occurredAt: now,
            correlationId: input.correlationId,
            payload: { policyVersion: policy.version },
          }),
        ],
      };
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      // A concurrent request with the same key committed first.
      const winner = await deps.db.airportTransfer.findUnique({
        where: { id: transferId },
      });
      if (winner !== null) {
        return replayOrConflict(winner, hash);
      }
    }
    throw error;
  }
}

async function readable(
  deps: TravelDeps,
  actor: Actor,
  transferId: string,
): Promise<TransferRow> {
  const row = await deps.db.airportTransfer.findUnique({
    where: { id: transferId },
  });
  if (row === null || (row.userId !== actor.id && !isOpsRole(actor.role))) {
    throw new ContractError("not_found", "no such airport transfer", {
      transferId,
    });
  }
  return row;
}

export async function getTransfer(
  deps: TravelDeps,
  actor: Actor,
  transferId: string,
): Promise<JsonRecord> {
  return transferView(await readable(deps, actor, transferId));
}

export async function listTransfers(
  deps: TravelDeps,
  actor: Actor,
  filter: { readonly linkedOrderId?: string },
): Promise<JsonRecord[]> {
  const rows = await deps.db.airportTransfer.findMany({
    where: {
      userId: actor.id,
      ...(filter.linkedOrderId === undefined
        ? {}
        : { orderId: filter.linkedOrderId }),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map(transferView);
}

// ---------------------------------------------------------------------------
// Traveller actions
// ---------------------------------------------------------------------------

export const TRANSFER_CHOICES = [
  "cancel",
  "keep",
  "rerequest",
  "approve_limit",
] as const;
export type TransferChoice = (typeof TRANSFER_CHOICES)[number];

export interface DecideInput {
  readonly actor: Actor;
  readonly transferId: string;
  readonly choice: TransferChoice;
  readonly maxFareMinor?: Money;
  readonly idempotencyKey: string;
  readonly correlationId: string | null;
}

function offered(row: TransferRow, choice: string): boolean {
  const action = row.actionRequired as JsonRecord | null;
  const list = Array.isArray(action?.choices)
    ? (action.choices as JsonRecord[])
    : [];
  return list.some((entry) => entry.key === choice);
}

function notOffered(choice: string): never {
  throw new ContractError(
    "conflict",
    `"${choice}" is not one of the choices this airport transfer is waiting for`,
    { reason: "choice_not_offered", choice },
  );
}

function driverSecuredMeanwhile(): never {
  throw new ContractError(
    "conflict",
    "A driver was secured before your choice reached the ride service, so nothing was changed. Cancelling now follows the ride's own rules — choose again if you still want to.",
    { reason: "driver_secured" },
  );
}

function rideUnavailable(error: unknown): never {
  if (error instanceof ContractError) {
    throw error;
  }
  throw new RideUnavailableError(
    "the ride marketplace did not answer; nothing was changed — try again",
    "ride_unavailable",
  );
}

function rideRefused(error: RideRefusal): never {
  throw new ContractError(
    error.code,
    `The ride service did not allow this, so nothing was changed: ${error.message}`,
    { reason: "ride_refused", ...(error.details ?? {}) },
  );
}

async function cancelChoice(
  deps: TravelDeps,
  row: TransferRow,
  input: DecideInput,
): Promise<TransferRow> {
  const result = await executeCancel(
    deps,
    row,
    "cancelled_by_traveller",
    input.actor,
    input.correlationId,
  );
  switch (result.kind) {
    case "cancelled":
      return result.row;
    case "secured":
      return driverSecuredMeanwhile();
    case "refused":
      return rideRefused(result.error);
    case "unavailable":
      return rideUnavailable(result.error);
    default:
      throw new ContractError(
        "conflict",
        "this airport transfer changed while cancelling; check it and try again",
      );
  }
}

async function keepChoice(
  deps: TravelDeps,
  row: TransferRow,
  input: DecideInput,
): Promise<TransferRow> {
  if (!offered(row, "keep")) {
    notOffered("keep");
  }
  const reason = (row.actionRequired as JsonRecord | null)?.reason ?? null;
  const after = await transitionTransfer(deps, {
    row,
    to: row.state as "pending_unassigned" | "requested" | "awarded",
    data: { actionRequired: JSON_NULL },
    actor: input.actor,
    action: "airport_transfer.kept",
    reason: "traveller kept the ride exactly as it is",
    event: "driver.kept",
    payload: { choice: "keep", about: reason as string | null },
    correlationId: input.correlationId,
    occurredAt: deps.now(),
  });
  if (after === null) {
    throw new ContractError(
      "conflict",
      "this airport transfer changed; check it and try again",
    );
  }
  return after;
}

async function rerequestChoice(
  deps: TravelDeps,
  row: TransferRow,
  input: DecideInput,
): Promise<TransferRow> {
  if (!offered(row, "rerequest")) {
    notOffered("rerequest");
  }
  const proposal = ((row.actionRequired as JsonRecord).proposal ?? {}) as {
    pickupAt?: string | null;
    windowEnd?: string | null;
    arriveBy?: string | null;
  };
  // Withdraw the current ride under ITS rules first; nothing else moves
  // unless that succeeded.
  await executeCancelForRerequest(deps, row);
  const after = await transitionTransfer(deps, {
    row,
    to: "requested",
    data: {
      actionRequired: JSON_NULL,
      scheduledRequestId: null,
      rideRequestId: null,
      rideState: "cancelled",
      rideRequestState: null,
      rideNotice: JSON_NULL,
      pickupAt: proposal.pickupAt ? new Date(proposal.pickupAt) : null,
      windowEnd: proposal.windowEnd ? new Date(proposal.windowEnd) : null,
      arriveBy: proposal.arriveBy ? new Date(proposal.arriveBy) : row.arriveBy,
      nextActionAt: deps.now(),
    },
    actor: input.actor,
    action: "airport_transfer.rerequested",
    reason:
      row.state === "awarded"
        ? "traveller cancelled the secured ride under its own rules and asked for a new one for the new flight time"
        : "traveller withdrew the live request and asked for a new one for the new flight time",
    event: "reservation.requested",
    payload: { reason: "rerequest", replacesAward: row.state === "awarded" },
    correlationId: input.correlationId,
    occurredAt: deps.now(),
  });
  if (after === null) {
    throw new ContractError(
      "conflict",
      "this airport transfer changed; check it and try again",
    );
  }
  return driveTransfer(deps, after);
}

async function executeCancelForRerequest(
  deps: TravelDeps,
  row: TransferRow,
): Promise<"withdrawn"> {
  const withdrawal = await withdrawRide(deps, row, true);
  switch (withdrawal.kind) {
    case "withdrawn":
      return "withdrawn";
    case "secured":
      await applyRideView(deps, row, withdrawal.view, deps.now());
      return driverSecuredMeanwhile();
    case "refused":
      return rideRefused(withdrawal.error);
    case "unavailable":
      return rideUnavailable(withdrawal.error);
    default:
      throw new ContractError(
        "conflict",
        "this airport transfer changed; check it and try again",
      );
  }
}

async function approveLimitChoice(
  deps: TravelDeps,
  row: TransferRow,
  input: DecideInput,
): Promise<TransferRow> {
  if (!offered(row, "approve_limit")) {
    notOffered("approve_limit");
  }
  const limit = input.maxFareMinor;
  if (limit === undefined) {
    throw new ContractError(
      "validation_failed",
      "a new maxFareMinor is required",
      {
        field: "maxFareMinor",
      },
    );
  }
  if (limit.currency !== row.currency || limit.amountMinor <= 0) {
    throw new ContractError(
      "validation_failed",
      `the limit must be a positive ${row.currency} amount`,
      {
        field: "maxFareMinor",
      },
    );
  }
  if (
    row.requestedFareMinor !== null &&
    limit.amountMinor < Number(row.requestedFareMinor)
  ) {
    throw new ContractError(
      "validation_failed",
      "the limit cannot be below the fare you asked for",
      {
        field: "maxFareMinor",
      },
    );
  }
  const action = row.actionRequired as JsonRecord;
  const minimum = (
    action.minimumFareMinor as { amountMinor?: number } | undefined
  )?.amountMinor;
  if (typeof minimum === "number" && limit.amountMinor < minimum) {
    throw new ContractError(
      "fare_out_of_bounds",
      "the new limit is still below the ride's current minimum fare",
      { field: "maxFareMinor", minimumMinor: minimum },
    );
  }

  if (
    action.reason === "ride_needs_approval" &&
    row.scheduledRequestId !== null
  ) {
    // The scheduled request on ride-service is waiting for the traveller:
    // carry the approval there, against the version they were shown.
    const principal = principalOf(row);
    let approved;
    try {
      approved = await deps.rides.approveScheduledRequest(
        principal,
        row.scheduledRequestId,
        { expectedVersion: Number(action.rideVersion), maxFareMinor: limit },
        `${row.id}:a${row.generation}v${String(action.rideVersion)}`,
      );
    } catch (error) {
      if (error instanceof RideRefusal) {
        return rideRefused(error);
      }
      return rideUnavailable(error);
    }
    const after = await transitionTransfer(deps, {
      row,
      to: row.state as "requested",
      data: {
        maxFareMinor: BigInt(limit.amountMinor),
        actionRequired: JSON_NULL,
        rideState: approved.state,
        rideNotice: cleanJson({
          statusLabel: approved.statusLabel,
          notice: approved.notice,
          approval: approved.approval,
          version: approved.version,
        }),
        nextActionAt: deps.now(),
      },
      actor: input.actor,
      action: "airport_transfer.limit_approved",
      reason: "traveller approved a new spending limit for the scheduled ride",
      event: "reservation.requested",
      payload: {
        reason: "limit_approved",
        approvedMaxFareMinor: limit.amountMinor,
      },
      correlationId: input.correlationId,
      occurredAt: deps.now(),
    });
    if (after === null) {
      throw new ContractError(
        "conflict",
        "this airport transfer changed; check it and try again",
      );
    }
    return after;
  }

  // Nothing is live on ride-service yet: the new limit applies to the
  // request made next.
  const after = await transitionTransfer(deps, {
    row,
    to: row.state as "pending_unassigned",
    data: {
      maxFareMinor: BigInt(limit.amountMinor),
      actionRequired: JSON_NULL,
      submitAfter: deps.now(),
      nextActionAt: deps.now(),
    },
    actor: input.actor,
    action: "airport_transfer.limit_approved",
    reason: "traveller approved a new spending limit",
    event: "reservation.requested",
    payload: {
      reason: "limit_approved",
      approvedMaxFareMinor: limit.amountMinor,
    },
    correlationId: input.correlationId,
    occurredAt: deps.now(),
  });
  if (after === null) {
    throw new ContractError(
      "conflict",
      "this airport transfer changed; check it and try again",
    );
  }
  return driveTransfer(deps, after);
}

/**
 * One traveller action on their transfer, idempotent under its key: a replay
 * answers the stored result, a replay with a different body is refused. A
 * refusal or an unanswered ride call stores nothing, so the traveller can
 * simply try again.
 */
export async function decideTransfer(
  deps: TravelDeps,
  input: DecideInput,
): Promise<TransferAnswer> {
  const actionId = deterministicId(
    "tra",
    scopedIdempotencyKey(
      `travel.transfer.action:${input.transferId}`,
      input.actor.id,
      input.idempotencyKey,
    ),
  );
  const hash = hashOf([
    input.transferId,
    input.choice,
    input.maxFareMinor === undefined
      ? null
      : [input.maxFareMinor.amountMinor, input.maxFareMinor.currency],
  ]);
  const replay = await deps.db.airportTransferAction.findUnique({
    where: { id: actionId },
  });
  if (replay !== null) {
    if (replay.requestHash !== hash) {
      throw new ContractError(
        "idempotency_key_reuse",
        "this Idempotency-Key was already used for a different action",
      );
    }
    return {
      status: replay.statusCode,
      body: replay.result as JsonRecord,
      replayed: true,
    };
  }

  const row = await deps.db.airportTransfer.findUnique({
    where: { id: input.transferId },
  });
  if (row === null || row.userId !== input.actor.id) {
    // Only the traveller acts on their ride; travel-ops never acts for them.
    throw new ContractError("not_found", "no such airport transfer", {
      transferId: input.transferId,
    });
  }
  if (isTerminal(row.state)) {
    throw new ContractError(
      "conflict",
      "this airport transfer is already closed",
      {
        state: row.state,
      },
    );
  }
  const held = await claimTransfer(deps, row.id);
  if (held === null) {
    throw new ContractError(
      "conflict",
      "this airport transfer is being updated right now; try again in a moment",
      { reason: "busy" },
    );
  }
  try {
    let after: TransferRow;
    switch (input.choice) {
      case "cancel":
        after = await cancelChoice(deps, held, input);
        break;
      case "keep":
        after = await keepChoice(deps, held, input);
        break;
      case "rerequest":
        after = await rerequestChoice(deps, held, input);
        break;
      default:
        after = await approveLimitChoice(deps, held, input);
    }
    const result = transferView(after);
    try {
      await deps.db.airportTransferAction.create({
        data: {
          id: actionId,
          transferId: row.id,
          action: input.choice,
          requestHash: hash,
          statusCode: 200,
          result: cleanJson(result),
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") {
        throw error;
      }
    }
    return { status: 200, body: result, replayed: false };
  } finally {
    await releaseTransfer(deps, row.id);
  }
}
