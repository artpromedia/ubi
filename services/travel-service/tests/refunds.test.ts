/**
 * Refund ladder: a cancel opens a refund in `requested` with the supplier's
 * penalty applied; the refund advances one contract hop at a time and only pays
 * out to the wallet at `refunded_to_wallet`. Skipping a stage is refused.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createCart } from "../src/ops/carts";
import { checkout } from "../src/ops/checkout";
import { cancelOrder } from "../src/ops/orders";
import { advanceRefund } from "../src/ops/refunds";

import {
  closeTestDb,
  idemKey,
  makeDeps,
  resetTravel,
  rider,
  seedCity,
  seedFlightSupplier,
  setControl,
  testDb,
} from "./helpers";

const db = testDb();
afterAll(closeTestDb);
beforeEach(() => resetTravel(db));

async function confirmedOrder(penaltyMinor: number) {
  const cityId = await seedCity(db);
  const supplierId = await seedFlightSupplier(db, {
    control: { "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" } },
  });
  const { deps, payment } = makeDeps(db);
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
  const orderId = result.orders[0]?.id ?? "";
  // The supplier's cancel penalty is keyed on our own order reference.
  if (penaltyMinor > 0) {
    await setControl(db, supplierId, orderId, { cancelPenaltyMinor: penaltyMinor });
  }
  return { cityId, deps, payment, actor, orderId };
}

describe("refunds", () => {
  it("cancel opens a refund with the penalty applied, then pays out at the last hop", async () => {
    const { cityId, deps, payment, actor, orderId } = await confirmedOrder(1_500_000);

    const refund = await cancelOrder(deps, {
      actor,
      cityId,
      orderId,
      idempotencyKey: idemKey(),
      correlationId: null,
    });
    expect(refund.stage).toBe("requested");
    expect(refund.penalty.amountMinor).toBe(1_500_000);
    expect(refund.amount.amountMinor).toBe(14_850_000 - 1_500_000);

    const order = await db.travelOrder.findUnique({ where: { id: orderId } });
    expect(order?.state).toBe("cancelled");

    // Advance the ladder one legal hop at a time.
    await advanceRefund(deps, { refundId: refund.id, to: "supplier_confirmed", actor, cityId, correlationId: null });
    await advanceRefund(deps, { refundId: refund.id, to: "supplier_refund_pending", actor, cityId, correlationId: null });
    const paidOut = await advanceRefund(deps, {
      refundId: refund.id,
      to: "refunded_to_wallet",
      actor,
      cityId,
      correlationId: null,
    });

    expect(paidOut.stage).toBe("refunded_to_wallet");
    expect(payment.countOp("refund")).toBe(1);
    const row = await db.travelRefund.findUnique({ where: { id: refund.id } });
    expect(row?.ledgerEntryId).not.toBeNull();
  });

  it("refuses to skip a refund stage", async () => {
    const { cityId, deps, actor, orderId } = await confirmedOrder(0);
    const refund = await cancelOrder(deps, {
      actor,
      cityId,
      orderId,
      idempotencyKey: idemKey(),
      correlationId: null,
    });
    await expect(
      advanceRefund(deps, { refundId: refund.id, to: "refunded_to_wallet", actor, cityId, correlationId: null }),
    ).rejects.toMatchObject({ code: "illegal_transition" });
  });

  it("replays a cancel: the same refund is returned, not a second one", async () => {
    const { cityId, deps, actor, orderId } = await confirmedOrder(0);
    const key = idemKey();
    const first = await cancelOrder(deps, { actor, cityId, orderId, idempotencyKey: key, correlationId: null });
    const second = await cancelOrder(deps, { actor, cityId, orderId, idempotencyKey: key, correlationId: null });
    expect(second.id).toBe(first.id);
    const count = await db.travelRefund.count({ where: { orderId } });
    expect(count).toBe(1);
  });
});
