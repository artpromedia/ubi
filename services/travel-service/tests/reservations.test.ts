/**
 * Linked airport rides are a separate order: a ride is reserved against a booked
 * flight, and honestly fails when the flight is not booked.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createCart } from "../src/ops/carts";
import { checkout } from "../src/ops/checkout";
import { createReservation } from "../src/ops/reservations";

import {
  closeTestDb,
  idemKey,
  makeDeps,
  resetTravel,
  rider,
  seedCity,
  seedFlightSupplier,
  testDb,
} from "./helpers";

const db = testDb();
afterAll(closeTestDb);
beforeEach(() => resetTravel(db));

async function flightOrder(bookOutcome: "confirmed" | "failed") {
  const cityId = await seedCity(db);
  await seedFlightSupplier(db, {
    control: { "AP-P4-7120#saver": { bookOutcome, pnr: "AP7QX2" } },
  });
  const { deps } = makeDeps(db);
  const actor = rider();
  const cart = await createCart(deps, {
    actor,
    cityId,
    items: [{ kind: "flight", offerRef: "AP-P4-7120", fareFamilyId: "saver" }],
    idempotencyKey: idemKey(),
    correlationId: null,
  });
  const result = await checkout(deps, {
    actor,
    cityId,
    cartId: cart.id,
    paymentMethodId: "wallet",
    grantId: "grant_test",
    assuranceMethod: null,
    expectedTotal: null,
    idempotencyKey: idemKey(),
    correlationId: null,
  });
  if (result.kind !== "ok") throw new Error("expected ok");
  return { cityId, deps, actor, orderId: result.orders[0]?.id ?? "" };
}

describe("linked airport reservations", () => {
  it("reserves a ride against a booked flight, as a separate order", async () => {
    const { cityId, deps, actor, orderId } = await flightOrder("confirmed");
    const reservation = await createReservation(deps, {
      actor,
      cityId,
      linkedOrderId: orderId,
      pickupAt: "2026-09-12T05:00:00+01:00",
      classId: "comfort",
      direction: "to_airport",
      idempotencyKey: idemKey(),
      correlationId: null,
    });
    expect(reservation.status).toBe("reserved");
    expect(reservation.compensationPolicy).toContain("separate booking");
    const link = await db.rideReservationLink.findUnique({
      where: { reservationId: reservation.reservationId },
    });
    expect(link?.orderId).toBe(orderId);
  });

  it("fails the reservation honestly when the flight is not booked", async () => {
    const { cityId, deps, actor, orderId } = await flightOrder("failed");
    const reservation = await createReservation(deps, {
      actor,
      cityId,
      linkedOrderId: orderId,
      pickupAt: "2026-09-12T05:00:00+01:00",
      classId: "comfort",
      direction: "to_airport",
      idempotencyKey: idemKey(),
      correlationId: null,
    });
    expect(reservation.status).toBe("reservation_failed");
    const link = await db.rideReservationLink.findUnique({
      where: { reservationId: reservation.reservationId },
    });
    expect(link).toBeNull(); // no link row created for a failed reservation
  });
});
