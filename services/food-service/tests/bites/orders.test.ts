/**
 * Order integration tests: pre-authorized placement, idempotent replay, the
 * reject → pre-auth release (no transfer) guard, and the courier happy path.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addItem } from "../../src/bites/services/carts";
import {
  acceptOrder,
  advanceOrder,
  deliverOrder,
  handoverOrder,
  placeOrder,
  rejectOrder,
} from "../../src/bites/services/orders";
import {
  closeTestDb,
  FakePayments,
  idemKey,
  journalLinesForOrder,
  makeDeps,
  seedCity,
  seedMenuItem,
  seedMerchant,
  testDb,
  uid,
  type Clock,
} from "./helpers";

import type { BitesDb } from "../../src/bites/lib/types";
import type { Actor } from "../../src/bites/lib/types";

let db: BitesDb;
const clock: Clock = { t: new Date("2026-02-01T09:00:00Z") };

beforeAll(() => {
  db = testDb();
});
afterAll(async () => {
  await closeTestDb();
});

interface Fixture {
  readonly cityId: string;
  readonly currency: string;
  readonly merchantId: string;
  readonly outletId: string;
  readonly itemId: string;
  readonly rider: Actor;
  readonly cartId: string;
  readonly payments: FakePayments;
}

async function stockedCart(payments: FakePayments, priceMinor = 250_000): Promise<Fixture> {
  const { cityId, currency } = await seedCity(db);
  const { merchantId, outletId } = await seedMerchant(db);
  const item = await seedMenuItem(db, outletId, { priceMinor, currency });
  const rider: Actor = { id: uid("rider"), role: "rider" };
  const cartId = uid("cart");
  await addItem(makeDeps(db, payments, clock), {
    actor: rider,
    cityId,
    cartId,
    itemId: item.itemId,
    quantity: 2,
    optionIds: [],
    correlationId: null,
  });
  return { cityId, currency, merchantId, outletId, itemId: item.itemId, rider, cartId, payments };
}

describe("placement", () => {
  it("creates a pre-authorized, not-captured order with server-computed totals", async () => {
    const payments = new FakePayments(db);
    const fx = await stockedCart(payments);
    const deps = makeDeps(db, payments, clock);

    const order = await placeOrder(deps, {
      actor: fx.rider,
      cityId: fx.cityId,
      cartId: fx.cartId,
      addressId: uid("addr"),
      paymentMethodId: "wallet",
      idempotencyKey: idemKey(),
      correlationId: null,
    });

    expect(order.status).toBe("placed");
    expect(order.authCaptured).toBe(false);
    // subtotal 500,000 (250,000 x2); service fee 20% = 100,000; delivery 50,000.
    expect(order.totals.subtotalMinor).toBe(500_000);
    expect(order.totals.serviceFeeMinor).toBe(100_000);
    expect(order.totals.deliveryFeeMinor).toBe(50_000);
    expect(order.totals.totalMinor).toBe(650_000);
    // The customer sees the delivery code, never the counter hand-over code.
    expect(order.deliveryCode).toBeTypeOf("string");
    expect(order.handoverCode).toBeUndefined();

    expect(payments.authorizations).toHaveLength(1);
    expect(payments.authorizations[0]?.amount.amountMinor).toBe(650_000);
    expect(payments.captures).toHaveLength(0);

    const row = await db.bitesOrder.findUnique({ where: { id: order.orderId } });
    expect(row?.authCaptured).toBe(false);
    expect(row?.paymentIntentId).toBeTruthy();
    expect(await journalLinesForOrder(db, order.orderId)).toBe(0);
  });

  it("returns the original order on an idempotent replay and holds only once", async () => {
    const payments = new FakePayments(db);
    const fx = await stockedCart(payments);
    const deps = makeDeps(db, payments, clock);
    const key = idemKey();
    const body = {
      actor: fx.rider,
      cityId: fx.cityId,
      cartId: fx.cartId,
      addressId: uid("addr"),
      paymentMethodId: "wallet",
      idempotencyKey: key,
      correlationId: null,
    };
    const first = await placeOrder(deps, body);
    const second = await placeOrder(deps, body);
    expect(second.orderId).toBe(first.orderId);
    expect(payments.authorizations).toHaveLength(1);
    const count = await db.bitesOrder.count({ where: { id: first.orderId } });
    expect(count).toBe(1);
  });

  it("refuses an unavailable payment method", async () => {
    const payments = new FakePayments(db);
    const fx = await stockedCart(payments);
    const deps = makeDeps(db, payments, clock);
    await expect(
      placeOrder(deps, {
        actor: fx.rider,
        cityId: fx.cityId,
        cartId: fx.cartId,
        addressId: uid("addr"),
        paymentMethodId: "card",
        idempotencyKey: idemKey(),
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "payment_method_unavailable" });
    expect(payments.authorizations).toHaveLength(0);
  });
});

describe("reject releases the pre-auth", () => {
  it("releases the hold, captures nothing, and posts no ledger line", async () => {
    const payments = new FakePayments(db);
    const fx = await stockedCart(payments);
    const deps = makeDeps(db, payments, clock);

    const order = await placeOrder(deps, {
      actor: fx.rider,
      cityId: fx.cityId,
      cartId: fx.cartId,
      addressId: uid("addr"),
      paymentMethodId: "wallet",
      idempotencyKey: idemKey(),
      correlationId: null,
    });

    const merchant: Actor = { id: fx.merchantId, role: "merchant" };
    const rejected = await rejectOrder(deps, {
      actor: merchant,
      cityId: fx.cityId,
      orderId: order.orderId,
      reason: "item_sold_out",
      itemId: fx.itemId,
      pausedUntil: null,
      correlationId: null,
    });

    expect(rejected.status).toBe("auth_released");
    expect(rejected.authCaptured).toBe(false);
    expect(payments.releases).toHaveLength(1);
    expect(payments.captures).toHaveLength(0);
    expect(payments.refunds).toHaveLength(0);
    // No transfer, no journal posting at all for a rejected order.
    expect(await journalLinesForOrder(db, order.orderId)).toBe(0);

    // Side effect: the rejected item is sold out, and the events are emitted.
    const item = await db.bitesMenuItem.findUnique({ where: { id: fx.itemId } });
    expect(item?.soldOutUntil).not.toBeNull();
    const events = await db.outboxEvent.findMany({
      where: { aggregateId: order.orderId },
    });
    const names = events.map((e) => e.name);
    expect(names).toContain("merchant.rejected");
    expect(names).toContain("payment.auth_released");
  });
});

describe("courier happy path", () => {
  it("accept → preparing → ready → handover → deliver captures on delivery", async () => {
    const payments = new FakePayments(db);
    const fx = await stockedCart(payments);
    const deps = makeDeps(db, payments, clock);
    const merchant: Actor = { id: fx.merchantId, role: "merchant" };
    const courier: Actor = { id: uid("courier"), role: "driver" };

    const order = await placeOrder(deps, {
      actor: fx.rider,
      cityId: fx.cityId,
      cartId: fx.cartId,
      addressId: uid("addr"),
      paymentMethodId: "wallet",
      idempotencyKey: idemKey(),
      correlationId: null,
    });
    const orderId = order.orderId;

    await acceptOrder(deps, { actor: merchant, cityId: fx.cityId, orderId, correlationId: null });
    await advanceOrder(deps, {
      actor: merchant,
      cityId: fx.cityId,
      orderId,
      to: "preparing",
      correlationId: null,
    });
    await advanceOrder(deps, {
      actor: merchant,
      cityId: fx.cityId,
      orderId,
      to: "ready",
      correlationId: null,
    });

    const row = await db.bitesOrder.findUnique({ where: { id: orderId } });
    const handoverCode = row?.handoverCode ?? "";
    const deliveryCode = row?.deliveryCode ?? "";

    await expect(
      handoverOrder(deps, {
        actor: courier,
        cityId: fx.cityId,
        orderId,
        handoverCode: "000000-wrong",
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    const pickedUp = await handoverOrder(deps, {
      actor: courier,
      cityId: fx.cityId,
      orderId,
      handoverCode,
      correlationId: null,
    });
    expect(pickedUp.status).toBe("picked_up");

    const delivered = await deliverOrder(deps, {
      actor: courier,
      cityId: fx.cityId,
      orderId,
      deliveryCode,
      photoRef: null,
      correlationId: null,
    });
    expect(delivered.status).toBe("delivered");
    expect(delivered.authCaptured).toBe(true);
    expect(payments.captures).toHaveLength(1);

    const events = await db.outboxEvent.findMany({ where: { aggregateId: orderId } });
    const names = events.map((e) => e.name);
    expect(names).toContain("order.placed");
    expect(names).toContain("merchant.accepted");
    expect(names).toContain("order.picked_up");
    expect(names).toContain("order.delivered");
  });
});
