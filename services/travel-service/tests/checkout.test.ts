/**
 * Checkout: per-item orders, partial success across suppliers, a PNR that is not
 * a ticket, and a supplier timeout that reconciles before any re-purchase.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createCart } from "../src/ops/carts";
import { checkout } from "../src/ops/checkout";
import { reconcileOrder as reconcile } from "../src/ops/reconcile";

import {
  closeTestDb,
  makeDeps,
  idemKey,
  resetTravel,
  rider,
  seedCity,
  seedFlightSupplier,
  seedStaySupplier,
  setControl,
  testDb,
} from "./helpers";

const db = testDb();
afterAll(closeTestDb);
beforeEach(() => resetTravel(db));

const GRANT = { grantId: "grant_test", assuranceMethod: null, expectedTotal: null };

describe("checkout", () => {
  it("creates one order per item, and partial success is possible across suppliers", async () => {
    const cityId = await seedCity(db);
    await seedFlightSupplier(db, {
      control: { "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" } },
    });
    await seedStaySupplier(db, {
      control: { "transcorp-king": { bookOutcome: "failed" } },
    });
    const { deps, payment } = makeDeps(db);
    const actor = rider();

    const cart = await createCart(deps, {
      actor,
      cityId,
      items: [
        { kind: "flight", offerRef: "AP-P4-7120", fareFamilyId: "saver" },
        { kind: "stay", offerRef: "transcorp-king", rateId: "transcorp-king" },
      ],
      idempotencyKey: idemKey(),
      correlationId: null,
    });

    const result = await checkout(deps, {
      actor,
      cityId,
      cartId: cart.id,
      paymentMethodId: "wallet",
      ...GRANT,
      idempotencyKey: idemKey(),
      correlationId: null,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.orders).toHaveLength(2);

    const flight = result.orders.find((o) => o.kind === "flight");
    const stay = result.orders.find((o) => o.kind === "stay");
    expect(flight?.state).toBe("confirmed");
    expect(stay?.state).toBe("failed_released");

    // Money moved per item: two holds, the confirmed one captured, the failed one released.
    expect(payment.countOp("authorize")).toBe(2);
    expect(payment.countOp("capture")).toBe(1);
    expect(payment.countOp("release")).toBe(1);
    expect(flight?.charged.amountMinor).toBe(14_850_000);
    expect(stay?.released.amountMinor).toBe(37_000_000);
  });

  it("a PNR (confirmed) is not a ticket — no documents until ticketing", async () => {
    const cityId = await seedCity(db);
    await seedFlightSupplier(db, {
      control: { "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" } },
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
      ...GRANT,
      idempotencyKey: idemKey(),
      correlationId: null,
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    const order = result.orders[0];
    expect(order?.state).toBe("confirmed");

    const docs = await db.travelDocument.count({ where: { orderId: order?.id } });
    expect(docs).toBe(0);

    // The ladder shows supplier_confirmed done/active but ticketed still pending.
    const ticketedStep = order?.ladder.find((s) => s.step === "ticketed");
    expect(ticketedStep?.state).toBe("pending");
  });

  it("a supplier timeout reconciles by our reference and never re-purchases", async () => {
    const cityId = await seedCity(db);
    const supplierId = await seedFlightSupplier(db, {
      control: { "AP-P4-7120#saver": { bookOutcome: "unknown" } },
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
      ...GRANT,
      idempotencyKey: idemKey(),
      correlationId: null,
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    const orderId = result.orders[0]?.id ?? "";
    expect(result.orders[0]?.state).toBe("unknown_reconciling");

    // The hold is left in place: nothing captured, nothing released.
    expect(payment.countOp("authorize")).toBe(1);
    expect(payment.countOp("capture")).toBe(0);
    expect(payment.countOp("release")).toBe(0);

    // The supplier now confirms the booking under OUR reference.
    await setControl(db, supplierId, orderId, { lookupState: "confirmed", pnr: "AP9ZZ1" });
    const reconciled = await reconcile(deps, {
      actor,
      cityId,
      orderId,
      correlationId: null,
    });

    expect(reconciled.state).toBe("confirmed");
    expect(reconciled.charged.amountMinor).toBe(14_850_000);
    // Reconcile captured the existing hold; it did NOT authorize a second time.
    expect(payment.countOp("authorize")).toBe(1);
    expect(payment.countOp("capture")).toBe(1);
    // Same order, not a new one.
    const orders = await db.travelOrder.count({ where: { cartId: cart.id } });
    expect(orders).toBe(1);
  });

  it("replays the same trip and orders for a repeated idempotency key", async () => {
    const cityId = await seedCity(db);
    await seedFlightSupplier(db, {
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
    const key = idemKey();
    const first = await checkout(deps, {
      actor,
      cityId,
      cartId: cart.id,
      paymentMethodId: "wallet",
      ...GRANT,
      idempotencyKey: key,
      correlationId: null,
    });
    const second = await checkout(deps, {
      actor,
      cityId,
      cartId: cart.id,
      paymentMethodId: "wallet",
      ...GRANT,
      idempotencyKey: key,
      correlationId: null,
    });
    if (first.kind !== "ok" || second.kind !== "ok") throw new Error("expected ok");
    expect(second.tripId).toBe(first.tripId);
    expect(second.orders[0]?.id).toBe(first.orders[0]?.id);
    // The replay did not authorize or capture a second time.
    expect(payment.countOp("authorize")).toBe(1);
    expect(payment.countOp("capture")).toBe(1);
  });
});
