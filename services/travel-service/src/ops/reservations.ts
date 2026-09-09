/**
 * Linked airport ride reservations (machine `rideReservation`).
 *
 * The ride is a SEPARATE order from the flight (CLAUDE.md #25): it has its own
 * status and its own compensation policy, spelled out to the traveller. A flight
 * that is not yet booked cannot have a ride reserved against it, so the
 * reservation fails honestly (`reservation_failed`) rather than pretending. When
 * the flight is disrupted the reservation is kept and the pickup re-timed — the
 * link row's `retimed_count` records how many times.
 */
import {
  assertTransition,
  ContractError,
  scopedIdempotencyKey,
} from "@ubi/contracts";

import { deterministicId } from "../lib/ids";
import { withOutbox } from "./outbox";
import { actorTypeFor, isOpsRole } from "./roles";

import type { TravelDeps } from "./context";
import type { Actor } from "./types";

const MACHINE = "rideReservation" as const;

const COMPENSATION_POLICY =
  "This airport ride is a separate booking with its own status. If your flight is disrupted the ride is re-timed to your new arrival at no charge; if no driver can be assigned, only the ride is refunded and your flight is unaffected.";

export interface ReservationView {
  readonly reservationId: string;
  readonly orderId: string;
  readonly direction: string;
  readonly status: "reserved" | "reservation_failed";
  readonly pickupAt: string;
  readonly classId: string;
  readonly compensationPolicy: string;
}

export async function createReservation(
  deps: TravelDeps,
  input: {
    readonly actor: Actor;
    readonly cityId: string;
    readonly linkedOrderId: string;
    readonly pickupAt: string;
    readonly classId: string;
    readonly direction: "to_airport" | "from_airport";
    readonly idempotencyKey: string;
    readonly correlationId: string | null;
  },
): Promise<ReservationView> {
  const order = await deps.db.travelOrder.findUnique({
    where: { id: input.linkedOrderId },
  });
  if (order === null) {
    throw new ContractError("not_found", "no such order to link", {
      orderId: input.linkedOrderId,
    });
  }
  if (order.userId !== input.actor.id && !isOpsRole(input.actor.role)) {
    throw new ContractError("not_found", "no such order to link", {
      orderId: input.linkedOrderId,
    });
  }

  const scoped = scopedIdempotencyKey(
    `travel.reservation:${input.linkedOrderId}`,
    input.actor.id,
    input.idempotencyKey,
  );
  const reservationId = deterministicId("resv", scoped);

  const existing = await deps.db.rideReservationLink.findUnique({
    where: { reservationId },
  });
  if (existing !== null) {
    return {
      reservationId,
      orderId: existing.orderId,
      direction: existing.direction,
      status: "reserved",
      pickupAt: input.pickupAt,
      classId: input.classId,
      compensationPolicy: COMPENSATION_POLICY,
    };
  }

  const bookable = order.state === "confirmed" || order.state === "ticketed";
  const occurredAt = deps.now();
  const actorType = actorTypeFor(input.actor.role);

  if (!bookable) {
    // requested → reservation_failed. No link row is created; the flight must be
    // booked before a ride can be reserved against it.
    assertTransition(MACHINE, "requested", "reservation_failed");
    await withOutbox(deps.db, async () => ({
      result: undefined,
      events: [
        reservationEvent("reservation.requested", reservationId, input, occurredAt, actorType),
        {
          ...reservationEvent(
            "reservation.reservation_failed",
            reservationId,
            input,
            occurredAt,
            actorType,
          ),
          payload: {
            reservationId,
            linkedOrderId: input.linkedOrderId,
            reason: "flight_not_booked",
            orderState: order.state,
          },
        },
      ],
    }));
    return {
      reservationId,
      orderId: input.linkedOrderId,
      direction: input.direction,
      status: "reservation_failed",
      pickupAt: input.pickupAt,
      classId: input.classId,
      compensationPolicy: COMPENSATION_POLICY,
    };
  }

  assertTransition(MACHINE, "requested", "reserved");
  await withOutbox(deps.db, async (tx) => {
    await tx.rideReservationLink.create({
      data: {
        reservationId,
        orderId: input.linkedOrderId,
        direction: input.direction,
      },
    });
    return {
      result: undefined,
      events: [
        reservationEvent("reservation.requested", reservationId, input, occurredAt, actorType),
        reservationEvent("reservation.reserved", reservationId, input, occurredAt, actorType),
      ],
    };
  });

  return {
    reservationId,
    orderId: input.linkedOrderId,
    direction: input.direction,
    status: "reserved",
    pickupAt: input.pickupAt,
    classId: input.classId,
    compensationPolicy: COMPENSATION_POLICY,
  };
}

function reservationEvent(
  name:
    | "reservation.requested"
    | "reservation.reserved"
    | "reservation.reservation_failed",
  reservationId: string,
  input: {
    readonly actor: Actor;
    readonly cityId: string;
    readonly linkedOrderId: string;
    readonly pickupAt: string;
    readonly classId: string;
    readonly direction: string;
    readonly correlationId: string | null;
  },
  occurredAt: Date,
  actorType: string,
) {
  return {
    name,
    aggregateType: "ride_reservation",
    aggregateId: reservationId,
    fromVersion: null,
    toVersion: 1,
    actor: input.actor,
    actorType,
    cityId: input.cityId,
    idempotencyKey: `${name}:${reservationId}`,
    correlationId: input.correlationId,
    occurredAt,
    payload: {
      reservationId,
      linkedOrderId: input.linkedOrderId,
      pickupAt: input.pickupAt,
      classId: input.classId,
      direction: input.direction,
    },
  } as const;
}
