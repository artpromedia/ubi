/**
 * Issue and refund integration tests. These prove the two money guarantees of
 * the slice against the real double-entry trigger:
 *   - a merchant accepting an issue refunds each item at the captured menu price;
 *   - an issue the merchant ignores is auto-accepted after the response window
 *     and refunded the same way by the background sweep.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addItem } from "../../src/bites/services/carts";
import {
  acceptOrder,
  advanceOrder,
  deliverOrder,
  handoverOrder,
  placeOrder,
  reportIssue,
  respondIssue,
  sweepDueIssues,
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
  seedWallet,
  testDb,
  uid,
  walletBalanceMinor,
  type Clock,
} from "./helpers";

import type { BitesDeps } from "../../src/bites/context";
import type { Actor, BitesDb } from "../../src/bites/lib/types";

let db: BitesDb;

beforeAll(() => {
  db = testDb();
});
afterAll(async () => {
  await closeTestDb();
});

interface Delivered {
  readonly orderId: string;
  readonly itemId: string;
  readonly rider: Actor;
  readonly merchantId: string;
  readonly cityId: string;
  readonly currency: string;
  readonly walletId: string;
}

async function deliverAnOrder(
  deps: BitesDeps,
  unitPriceMinor: number,
  quantity: number,
): Promise<Delivered> {
  const { cityId, currency } = await seedCity(db);
  const { merchantId, outletId } = await seedMerchant(db);
  const item = await seedMenuItem(db, outletId, {
    priceMinor: unitPriceMinor,
    currency,
  });
  const rider: Actor = { id: uid("rider"), role: "rider" };
  const walletId = await seedWallet(db, rider.id, currency);
  const cartId = uid("cart");
  await addItem(deps, {
    actor: rider,
    cityId,
    cartId,
    itemId: item.itemId,
    quantity,
    optionIds: [],
    correlationId: null,
  });
  const order = await placeOrder(deps, {
    actor: rider,
    cityId,
    cartId,
    addressId: uid("addr"),
    paymentMethodId: "wallet",
    idempotencyKey: idemKey(),
    correlationId: null,
  });
  const orderId = order.orderId;
  const merchant: Actor = { id: merchantId, role: "merchant" };
  const courier: Actor = { id: uid("courier"), role: "driver" };
  await acceptOrder(deps, {
    actor: merchant,
    cityId,
    orderId,
    correlationId: null,
  });
  await advanceOrder(deps, {
    actor: merchant,
    cityId,
    orderId,
    to: "preparing",
    correlationId: null,
  });
  await advanceOrder(deps, {
    actor: merchant,
    cityId,
    orderId,
    to: "ready",
    correlationId: null,
  });
  const row = await db.bitesOrder.findUnique({ where: { id: orderId } });
  await handoverOrder(deps, {
    actor: courier,
    cityId,
    orderId,
    handoverCode: row?.handoverCode ?? "",
    correlationId: null,
  });
  await deliverOrder(deps, {
    actor: courier,
    cityId,
    orderId,
    deliveryCode: row?.deliveryCode ?? "",
    photoRef: null,
    correlationId: null,
  });
  return {
    orderId,
    itemId: item.itemId,
    rider,
    merchantId,
    cityId,
    currency,
    walletId,
  };
}

describe("2h auto-accept sweep", () => {
  it("auto-accepts a stale issue and refunds one item at the menu price", async () => {
    const payments = new FakePayments(db);
    const clock: Clock = { t: new Date("2026-02-01T09:00:00Z") };
    const deps = makeDeps(db, payments, clock);

    const fx = await deliverAnOrder(deps, 250_000, 2);

    // The customer reports one missing unit. Refund must be the menu price of
    // one item — 250,000 — not the whole order, and not a client figure.
    const issue = await reportIssue(deps, {
      actor: fx.rider,
      cityId: fx.cityId,
      orderId: fx.orderId,
      items: [{ itemId: fx.itemId, quantity: 1 }],
      type: "missing_item",
      photoRef: null,
      correlationId: null,
    });
    expect(issue.requestedMinor).toBe(250_000);

    // Nothing due yet.
    expect(await sweepDueIssues(deps)).toBe(0);

    // Advance past the 120-minute window and sweep.
    clock.t = new Date(clock.t.getTime() + 121 * 60 * 1000);
    const handled = await sweepDueIssues(deps);
    expect(handled).toBe(1);

    const order = await db.bitesOrder.findUnique({ where: { id: fx.orderId } });
    expect(order?.status).toBe("refunded");
    const stored = await db.orderIssue.findUnique({
      where: { id: issue.issueId },
    });
    expect(stored?.status).toBe("auto_refunded");

    expect(payments.refunds).toHaveLength(1);
    expect(payments.refunds[0]?.amount.amountMinor).toBe(250_000);
    // The refund really moved the wallet, through the double-entry trigger.
    expect(await walletBalanceMinor(db, fx.walletId)).toBe(250_000);
    expect(await journalLinesForOrder(db, fx.orderId)).toBe(2);

    // Repeated missing-item reports lower the merchant's rank.
    const merchant = await db.bitesMerchant.findUnique({
      where: { id: fx.merchantId },
    });
    expect(Number(merchant?.rankScore)).toBeLessThan(0);

    const events = await db.outboxEvent.findMany({
      where: { aggregateId: fx.orderId },
    });
    expect(events.map((e) => e.name)).toContain("refund.posted");
  });

  it("is idempotent: a second sweep does not refund again", async () => {
    const payments = new FakePayments(db);
    const clock: Clock = { t: new Date("2026-02-01T09:00:00Z") };
    const deps = makeDeps(db, payments, clock);
    const fx = await deliverAnOrder(deps, 250_000, 1);
    await reportIssue(deps, {
      actor: fx.rider,
      cityId: fx.cityId,
      orderId: fx.orderId,
      items: [{ itemId: fx.itemId, quantity: 1 }],
      type: "wrong_item",
      photoRef: null,
      correlationId: null,
    });
    clock.t = new Date(clock.t.getTime() + 121 * 60 * 1000);
    expect(await sweepDueIssues(deps)).toBe(1);
    expect(await sweepDueIssues(deps)).toBe(0);
    expect(payments.refunds).toHaveLength(1);
    expect(await walletBalanceMinor(db, fx.walletId)).toBe(250_000);
  });
});

describe("merchant responds within the window", () => {
  it("accepting refunds every reported item at the menu price", async () => {
    const payments = new FakePayments(db);
    const clock: Clock = { t: new Date("2026-02-01T09:00:00Z") };
    const deps = makeDeps(db, payments, clock);
    const fx = await deliverAnOrder(deps, 250_000, 2);

    const issue = await reportIssue(deps, {
      actor: fx.rider,
      cityId: fx.cityId,
      orderId: fx.orderId,
      items: [{ itemId: fx.itemId, quantity: 2 }],
      type: "damaged",
      photoRef: null,
      correlationId: null,
    });

    const merchant: Actor = { id: fx.merchantId, role: "merchant" };
    const resolved = await respondIssue(deps, {
      actor: merchant,
      cityId: fx.cityId,
      orderId: fx.orderId,
      issueId: issue.issueId,
      decision: "accept",
      correlationId: null,
    });
    expect(resolved.status).toBe("resolved_refund");

    const order = await db.bitesOrder.findUnique({ where: { id: fx.orderId } });
    expect(order?.status).toBe("refunded");
    // 250,000 x2 reported = 500,000 refunded to the wallet.
    expect(payments.refunds[0]?.amount.amountMinor).toBe(500_000);
    expect(await walletBalanceMinor(db, fx.walletId)).toBe(500_000);

    const events = await db.outboxEvent.findMany({
      where: { aggregateId: fx.orderId },
    });
    const names = events.map((e) => e.name);
    expect(names).toContain("merchant.responded");
    expect(names).toContain("refund.posted");
  });

  it("redeliver returns the order to delivered without a refund", async () => {
    const payments = new FakePayments(db);
    const clock: Clock = { t: new Date("2026-02-01T09:00:00Z") };
    const deps = makeDeps(db, payments, clock);
    const fx = await deliverAnOrder(deps, 250_000, 1);
    const issue = await reportIssue(deps, {
      actor: fx.rider,
      cityId: fx.cityId,
      orderId: fx.orderId,
      items: [{ itemId: fx.itemId, quantity: 1 }],
      type: "not_delivered",
      photoRef: null,
      correlationId: null,
    });
    const merchant: Actor = { id: fx.merchantId, role: "merchant" };
    await respondIssue(deps, {
      actor: merchant,
      cityId: fx.cityId,
      orderId: fx.orderId,
      issueId: issue.issueId,
      decision: "redeliver",
      correlationId: null,
    });
    const order = await db.bitesOrder.findUnique({ where: { id: fx.orderId } });
    expect(order?.status).toBe("delivered");
    expect(payments.refunds).toHaveLength(0);
  });
});
