/**
 * Trip itinerary and linked orders (contracts/openapi/travel-v2.yaml).
 *
 * A trip is a view over the per-item orders and the ride reservations linked to
 * them. Each linked item shows its OWN status and its OWN charge (CLAUDE.md #25):
 * the itinerary never rolls the flight, the hotel and the ride up into a single
 * outcome, because they can and do diverge.
 */
import { ContractError } from "@ubi/contracts";

import { isOpsRole } from "./roles";

import type { TravelDeps } from "./context";
import type { Actor, JsonRecord } from "./types";

const ORDER_STATUS: Readonly<Record<string, string>> = {
  payment_authorized: "supplier_pending",
  submitted: "supplier_pending",
  supplier_pending: "supplier_pending",
  unknown_reconciling: "supplier_pending",
  confirmed: "confirmed",
  disrupted: "confirmed",
  ticketed: "ticketed",
  completed: "completed",
  failed_released: "not_booked",
  cancelled: "cancelled",
  refunded: "refunded",
};

interface OrderRecord {
  id: string;
  kind: string;
  state: string;
  chargedMinor: bigint;
  currency: string;
  supplierRefs: unknown;
  policy: unknown;
  userId: string;
}

function linkedFromOrder(order: OrderRecord, disrupted: boolean): JsonRecord {
  const refs =
    typeof order.supplierRefs === "object" && order.supplierRefs !== null
      ? (order.supplierRefs as JsonRecord)
      : {};
  const subtitleParts: string[] = [];
  if (typeof refs.pnr === "string") subtitleParts.push(`PNR ${refs.pnr}`);
  if (typeof refs.bookingRef === "string") subtitleParts.push(`Ref ${refs.bookingRef}`);
  return {
    kind: order.kind,
    orderId: order.id,
    title: order.kind === "flight" ? "Flight" : "Stay",
    subtitle: subtitleParts.join(" · "),
    status: ORDER_STATUS[order.state] ?? "supplier_pending",
    charged: { amountMinor: Number(order.chargedMinor), currency: order.currency },
    policy:
      typeof order.policy === "object" && order.policy !== null
        ? JSON.stringify(order.policy)
        : null,
    disruption: disrupted ? "disruption detected — see options" : null,
    actions: [],
  };
}

async function assertTripReadable(
  deps: TravelDeps,
  actor: Actor,
  tripId: string,
): Promise<void> {
  const trip = await deps.db.travelTrip.findUnique({ where: { id: tripId } });
  if (trip === null) {
    throw new ContractError("not_found", "no such trip", { tripId });
  }
  if (trip.userId !== actor.id && !isOpsRole(actor.role)) {
    throw new ContractError("not_found", "no such trip", { tripId });
  }
}

export async function getLinked(
  deps: TravelDeps,
  actor: Actor,
  tripId: string,
): Promise<readonly JsonRecord[]> {
  await assertTripReadable(deps, actor, tripId);
  const orders = await deps.db.travelOrder.findMany({
    where: { tripId },
    orderBy: { createdAt: "asc" },
  });
  const items: JsonRecord[] = [];
  for (const order of orders) {
    const disruption = await deps.db.travelDisruption.findFirst({
      where: { orderId: order.id, resolvedAt: null },
    });
    items.push(linkedFromOrder(order, disruption !== null));
    const reservations = await deps.db.rideReservationLink.findMany({
      where: { orderId: order.id },
    });
    for (const reservation of reservations) {
      items.push({
        kind: "ride_reservation",
        reservationId: reservation.reservationId,
        title: reservation.direction === "to_airport" ? "Ride to airport" : "Ride from airport",
        status: "reserved",
        actions: [],
      });
    }
  }
  return items;
}

export async function getTrip(
  deps: TravelDeps,
  actor: Actor,
  tripId: string,
): Promise<JsonRecord> {
  const trip = await deps.db.travelTrip.findUnique({ where: { id: tripId } });
  if (trip === null) {
    throw new ContractError("not_found", "no such trip", { tripId });
  }
  if (trip.userId !== actor.id && !isOpsRole(actor.role)) {
    throw new ContractError("not_found", "no such trip", { tripId });
  }
  const items = await getLinked(deps, actor, tripId);
  return {
    id: trip.id,
    title: trip.title,
    startDate: trip.startDate?.toISOString().slice(0, 10) ?? null,
    endDate: trip.endDate?.toISOString().slice(0, 10) ?? null,
    timezone: trip.timezone,
    items: [...items],
  };
}
