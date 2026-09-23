/**
 * Checkout: per-item orders, partial success across suppliers, a PNR that is not
 * a ticket, and a supplier timeout that reconciles before any re-purchase.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ContractError } from "@ubi/contracts";

import type { PaymentPort } from "../src/ports/payment-port";

import { createCart } from "../src/ops/carts";
import { checkout } from "../src/ops/checkout";
import { reconcileOrder as reconcile } from "../src/ops/reconcile";

import {
  closeTestDb,
  makeDeps,
  idemKey,
  money,
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

const GRANT = {
  grantId: "grant_test",
  assuranceMethod: null,
  expectedTotal: null,
};

describe("checkout", () => {
  it("creates one order per item, and partial success is possible across suppliers", async () => {
    const cityId = await seedCity(db);
    await seedFlightSupplier(db, {
      control: {
        "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" },
      },
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
      control: {
        "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" },
      },
    });
    const { deps } = makeDeps(db);
    const actor = rider();

    const cart = await createCart(deps, {
      actor,
      cityId,
      items: [
        { kind: "flight", offerRef: "AP-P4-7120", fareFamilyId: "saver" },
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
    if (result.kind !== "ok") throw new Error("expected ok");
    const order = result.orders[0];
    expect(order?.state).toBe("confirmed");

    const docs = await db.travelDocument.count({
      where: { orderId: order?.id },
    });
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
      items: [
        { kind: "flight", offerRef: "AP-P4-7120", fareFamilyId: "saver" },
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
    if (result.kind !== "ok") throw new Error("expected ok");
    const orderId = result.orders[0]?.id ?? "";
    expect(result.orders[0]?.state).toBe("unknown_reconciling");

    // The hold is left in place: nothing captured, nothing released.
    expect(payment.countOp("authorize")).toBe(1);
    expect(payment.countOp("capture")).toBe(0);
    expect(payment.countOp("release")).toBe(0);

    // The supplier now confirms the booking under OUR reference.
    await setControl(db, supplierId, orderId, {
      lookupState: "confirmed",
      pnr: "AP9ZZ1",
    });
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
      control: {
        "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" },
      },
    });
    const { deps, payment } = makeDeps(db);
    const actor = rider();

    const cart = await createCart(deps, {
      actor,
      cityId,
      items: [
        { kind: "flight", offerRef: "AP-P4-7120", fareFamilyId: "saver" },
      ],
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
    if (first.kind !== "ok" || second.kind !== "ok")
      throw new Error("expected ok");
    expect(second.tripId).toBe(first.tripId);
    expect(second.orders[0]?.id).toBe(first.orders[0]?.id);
    // The replay did not authorize or capture a second time.
    expect(payment.countOp("authorize")).toBe(1);
    expect(payment.countOp("capture")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// One capture key, and convergence through payment-service's recorded state
// ---------------------------------------------------------------------------

async function flightCart(
  deps: ReturnType<typeof makeDeps>["deps"],
  cityId: string,
  actor: { id: string; role: string },
) {
  return createCart(deps, {
    actor,
    cityId,
    items: [{ kind: "flight", offerRef: "AP-P4-7120", fareFamilyId: "saver" }],
    idempotencyKey: idemKey(),
    correlationId: null,
  });
}

async function runCheckout(
  deps: ReturnType<typeof makeDeps>["deps"],
  cityId: string,
  actor: { id: string; role: string },
  cartId: string,
) {
  const result = await checkout(deps, {
    actor,
    cityId,
    cartId,
    paymentMethodId: "wallet",
    ...GRANT,
    idempotencyKey: idemKey(),
    correlationId: null,
  });
  if (result.kind !== "ok") throw new Error("expected ok");
  return result;
}

describe("checkout, reconcile and webhooks share ONE payment key per order", () => {
  it("every posting for an order uses <orderId>:auth / :cap / :rel, whichever path makes it", async () => {
    const cityId = await seedCity(db);
    const supplierId = await seedFlightSupplier(db, {
      control: { "AP-P4-7120#saver": { bookOutcome: "unknown" } },
    });
    const { deps, payment } = makeDeps(db);
    const actor = rider();
    const cart = await flightCart(deps, cityId, actor);
    const result = await runCheckout(deps, cityId, actor, cart.id);
    const orderId = result.orders[0]?.id ?? "";

    await setControl(db, supplierId, orderId, {
      lookupState: "confirmed",
      pnr: "AP9ZZ1",
    });
    await reconcile(deps, { actor, cityId, orderId, correlationId: null });

    expect(payment.calls.map((call) => [call.op, call.idempotencyKey])).toEqual(
      [
        ["authorize", `${orderId}:auth`],
        ["capture", `${orderId}:cap`],
      ],
    );
  });

  it("a capture that landed but lost its response is repeated by a later path as a replay — never a 409, never twice", async () => {
    const cityId = await seedCity(db);
    const supplierId = await seedFlightSupplier(db, {
      control: { "AP-P4-7120#saver": { bookOutcome: "unknown" } },
    });
    const { deps, payment } = makeDeps(db);
    const actor = rider();
    const cart = await flightCart(deps, cityId, actor);
    const result = await runCheckout(deps, cityId, actor, cart.id);
    const orderId = result.orders[0]?.id ?? "";

    // An earlier capture under the canonical key reached payment-service but
    // its caller never saw the answer.
    await payment.capture({
      orderId,
      userId: actor.id,
      amount: money(14_850_000, "NGN"),
      cityId,
      reason: "earlier capture",
      idempotencyKey: `${orderId}:cap`,
      actor,
    });
    // The pre-fix scheme (checkout's per-item key) would now be refused:
    const itemKeyed = await payment
      .capture({
        orderId,
        userId: actor.id,
        amount: money(14_850_000, "NGN"),
        cityId,
        reason: "item-keyed capture",
        idempotencyKey: `travel.checkout:item:0:cap`,
        actor,
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(itemKeyed).toMatchObject({
      details: { status: 409, paymentCode: "illegal_transition" },
    });

    await setControl(db, supplierId, orderId, {
      lookupState: "confirmed",
      pnr: "AP9ZZ1",
    });
    const reconciled = await reconcile(deps, {
      actor,
      cityId,
      orderId,
      correlationId: null,
    });
    expect(reconciled.state).toBe("confirmed");
    expect(reconciled.charged.amountMinor).toBe(14_850_000);
    expect(payment.appliedOps(orderId, "capture")).toBe(1);
  });
});

describe("payment postings converge through status() after an ambiguous answer", () => {
  it.each(["lose_response", "no_answer"] as const)(
    "checkout's capture after a confirmed booking converges when the answer is %s",
    async (mode) => {
      const cityId = await seedCity(db);
      await seedFlightSupplier(db, {
        control: {
          "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" },
        },
      });
      const { deps, payment } = makeDeps(db);
      const actor = rider();
      const cart = await flightCart(deps, cityId, actor);
      payment.failNext("capture", mode);
      const result = await runCheckout(deps, cityId, actor, cart.id);
      const order = result.orders[0];
      expect(order?.state).toBe("confirmed");
      expect(order?.charged.amountMinor).toBe(14_850_000);
      expect(payment.appliedOps(order?.id ?? "", "capture")).toBe(1);
      expect(payment.itemState(order?.id ?? "")).toBe("captured");
    },
  );

  it.each(["lose_response", "no_answer"] as const)(
    "checkout's authorization converges when the answer is %s — one hold, not two",
    async (mode) => {
      const cityId = await seedCity(db);
      await seedFlightSupplier(db, {
        control: {
          "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" },
        },
      });
      const { deps, payment } = makeDeps(db);
      const actor = rider();
      const cart = await flightCart(deps, cityId, actor);
      payment.failNext("authorize", mode);
      const result = await runCheckout(deps, cityId, actor, cart.id);
      const orderId = result.orders[0]?.id ?? "";
      expect(result.orders[0]?.state).toBe("confirmed");
      expect(result.orders[0]?.held.amountMinor).toBe(14_850_000);
      expect(payment.appliedOps(orderId, "authorize")).toBe(1);
    },
  );

  it("a release whose answer was lost converges to failed_released without a second release", async () => {
    const cityId = await seedCity(db);
    await seedFlightSupplier(db, {
      control: { "AP-P4-7120#saver": { bookOutcome: "failed" } },
    });
    const { deps, payment } = makeDeps(db);
    const actor = rider();
    const cart = await flightCart(deps, cityId, actor);
    payment.failNext("release", "lose_response");
    const result = await runCheckout(deps, cityId, actor, cart.id);
    const orderId = result.orders[0]?.id ?? "";
    expect(result.orders[0]?.state).toBe("failed_released");
    expect(payment.appliedOps(orderId, "release")).toBe(1);
    expect(payment.itemState(orderId)).toBe("released");
  });

  it("reconcile's capture converges too when its answer is lost", async () => {
    const cityId = await seedCity(db);
    const supplierId = await seedFlightSupplier(db, {
      control: { "AP-P4-7120#saver": { bookOutcome: "unknown" } },
    });
    const { deps, payment } = makeDeps(db);
    const actor = rider();
    const cart = await flightCart(deps, cityId, actor);
    const result = await runCheckout(deps, cityId, actor, cart.id);
    const orderId = result.orders[0]?.id ?? "";
    await setControl(db, supplierId, orderId, {
      lookupState: "confirmed",
      pnr: "AP9ZZ1",
    });
    payment.failNext("capture", "lose_response");
    const reconciled = await reconcile(deps, {
      actor,
      cityId,
      orderId,
      correlationId: null,
    });
    expect(reconciled.state).toBe("confirmed");
    expect(payment.appliedOps(orderId, "capture")).toBe(1);
  });

  it("a definitive authorization refusal leaves no order and no trip behind; the same key can run again", async () => {
    const cityId = await seedCity(db);
    await seedFlightSupplier(db, {
      control: {
        "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" },
      },
    });
    const { deps, payment } = makeDeps(db);
    const actor = rider();
    const cart = await flightCart(deps, cityId, actor);
    const key = idemKey();
    // payment-service refuses the hold outright (a definitive 422).
    const refusing: PaymentPort = {
      authorize: () =>
        Promise.reject(
          new ContractError(
            "service_unavailable",
            "payment-service could not authorize this order",
            {
              status: 422,
              paymentCode: "insufficient_funds",
            },
          ),
        ),
      capture: (request) => payment.capture(request),
      release: (request) => payment.release(request),
      refund: (request) => payment.refund(request),
      status: (orderId) => payment.status(orderId),
    };
    const failed = await checkout(
      { ...deps, payment: refusing },
      {
        actor,
        cityId,
        cartId: cart.id,
        paymentMethodId: "wallet",
        ...GRANT,
        idempotencyKey: key,
        correlationId: null,
      },
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failed).toMatchObject({
      details: { paymentCode: "insufficient_funds" },
    });
    expect(await db.travelOrder.count({ where: { cartId: cart.id } })).toBe(0);
    expect(await db.travelTrip.count({ where: { userId: actor.id } })).toBe(0);

    const retried = await checkout(deps, {
      actor,
      cityId,
      cartId: cart.id,
      paymentMethodId: "wallet",
      ...GRANT,
      idempotencyKey: key,
      correlationId: null,
    });
    expect(retried.kind).toBe("ok");
    if (retried.kind === "ok")
      expect(retried.orders[0]?.state).toBe("confirmed");
  });
});

describe("authorizations are gated per vertical", () => {
  it("a stay needs stays_booking — flights_booking alone opens no stay money", async () => {
    const cityId = await seedCity(db, {
      flags: { flights_booking: true, stays_booking: false },
    });
    await seedStaySupplier(db);
    const { deps, payment } = makeDeps(db);
    const actor = rider();
    await expect(
      createCart(deps, {
        actor,
        cityId,
        items: [
          {
            kind: "stay",
            offerRef: "transcorp-king",
            rateId: "transcorp-king",
          },
        ],
        idempotencyKey: idemKey(),
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "feature_disabled" });
    expect(payment.countOp("authorize")).toBe(0);
  });

  it("a vertical switched off after the cart was built stops checkout before any authorization", async () => {
    const cityId = await seedCity(db);
    await seedFlightSupplier(db, {
      control: {
        "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" },
      },
    });
    const { deps, payment } = makeDeps(db);
    const actor = rider();
    const cart = await flightCart(deps, cityId, actor);
    await db.flagRule.update({
      where: { flagKey_cityId: { flagKey: "flights_booking", cityId } },
      data: { enabled: false },
    });
    await expect(
      checkout(deps, {
        actor,
        cityId,
        cartId: cart.id,
        paymentMethodId: "wallet",
        ...GRANT,
        idempotencyKey: idemKey(),
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "feature_disabled" });
    expect(payment.countOp("authorize")).toBe(0);
    expect(await db.travelOrder.count({ where: { cartId: cart.id } })).toBe(0);
  });
});

describe("repricing needs explicit consent", () => {
  it("a surfaced new price is charged only when echoed exactly — a wrong or missing total is surfaced again", async () => {
    const cityId = await seedCity(db);
    const supplierId = await seedFlightSupplier(db);
    const { deps, payment } = makeDeps(db);
    const actor = rider();
    const cart = await flightCart(deps, cityId, actor);
    await setControl(db, supplierId, "AP-P4-7120#saver", {
      bookOutcome: "confirmed",
      pnr: "AP7QX2",
      repriceToMinor: 15_400_000,
    });
    const attempt = (expected: number | null) =>
      checkout(deps, {
        actor,
        cityId,
        cartId: cart.id,
        paymentMethodId: "wallet",
        grantId: "grant_test",
        assuranceMethod: null,
        expectedTotal: expected === null ? null : money(expected, "NGN"),
        idempotencyKey: idemKey(),
        correlationId: null,
      });

    expect((await attempt(null)).kind).toBe("repriced");
    expect((await attempt(null)).kind).toBe("repriced");
    expect((await attempt(14_850_000)).kind).toBe("repriced"); // the OLD total is not consent
    expect(payment.countOp("authorize")).toBe(0);

    const accepted = await attempt(15_400_000);
    expect(accepted.kind).toBe("ok");
    if (accepted.kind === "ok") {
      expect(accepted.orders[0]?.charged.amountMinor).toBe(15_400_000);
    }
  });
});
