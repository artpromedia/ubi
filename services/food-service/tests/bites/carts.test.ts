/**
 * Cart integration tests against real Postgres: the server recompute (a lying
 * client price is ignored), required-option enforcement, sold-out items, and the
 * single-merchant rule.
 */
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addItem } from "../../src/bites/services/carts";
import { createCartRoutes } from "../../src/bites/routes";
import {
  closeTestDb,
  makeDeps,
  seedCity,
  seedMenuItem,
  seedMerchant,
  testDb,
  uid,
  FakePayments,
  type Clock,
} from "./helpers";

import type { BitesDb } from "../../src/bites/lib/types";

let db: BitesDb;
const clock: Clock = { t: new Date("2026-02-01T09:00:00Z") };

beforeAll(() => {
  db = testDb();
});
afterAll(async () => {
  await closeTestDb();
});

function deps() {
  return makeDeps(db, new FakePayments(db), clock);
}

describe("server-side price recompute", () => {
  it("ignores a client-supplied price and charges the menu price + option deltas", async () => {
    const { cityId, currency } = await seedCity(db);
    const { outletId } = await seedMerchant(db);
    const item = await seedMenuItem(db, outletId, {
      priceMinor: 250_000,
      currency,
      groups: [
        {
          required: true,
          minSelect: 1,
          maxSelect: 1,
          options: [{ priceDeltaMinor: 150_000 }],
        },
      ],
    });
    const group = item.groups[0];
    if (group === undefined) throw new Error("seed missing group");
    const optionId = group.optionIds[0];

    const app = new Hono();
    app.route("/v1/carts", createCartRoutes(deps()));

    const userId = uid("rider");
    const cartId = uid("cart");
    const response = await app.request(`/v1/carts/${cartId}/items`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-User-ID": userId,
        "X-User-Role": "rider",
        "X-City-ID": cityId,
      },
      // The client lies: price says 1 kobo. It must be ignored entirely.
      body: JSON.stringify({
        itemId: item.itemId,
        quantity: 2,
        optionIds: [optionId],
        price: 1,
      }),
    });

    expect(response.status).toBe(200);
    const cart = (await response.json()) as {
      subtotalMinor: number;
      lines: { unitPriceMinor: number; lineTotalMinor: number }[];
    };
    // 250,000 + 150,000 = 400,000 per unit, x2 = 800,000. Never 1.
    expect(cart.lines[0]?.unitPriceMinor).toBe(400_000);
    expect(cart.lines[0]?.lineTotalMinor).toBe(800_000);
    expect(cart.subtotalMinor).toBe(800_000);

    const stored = await db.cart.findUnique({ where: { id: cartId } });
    expect(Number(stored?.subtotalMinor)).toBe(800_000);
  });
});

describe("cart guards", () => {
  it("refuses an item whose required option group is unmet", async () => {
    const { cityId, currency } = await seedCity(db);
    const { outletId } = await seedMerchant(db);
    const item = await seedMenuItem(db, outletId, {
      priceMinor: 100_000,
      currency,
      groups: [
        {
          required: true,
          minSelect: 1,
          maxSelect: 1,
          options: [{ priceDeltaMinor: 0 }],
        },
      ],
    });
    await expect(
      addItem(deps(), {
        actor: { id: uid("rider"), role: "rider" },
        cityId,
        cartId: uid("cart"),
        itemId: item.itemId,
        quantity: 1,
        optionIds: [],
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("refuses a sold-out item", async () => {
    const { cityId, currency } = await seedCity(db);
    const { outletId } = await seedMerchant(db);
    const item = await seedMenuItem(db, outletId, {
      priceMinor: 100_000,
      currency,
      soldOutUntil: new Date(clock.t.getTime() + 60 * 60 * 1000),
    });
    await expect(
      addItem(deps(), {
        actor: { id: uid("rider"), role: "rider" },
        cityId,
        cartId: uid("cart"),
        itemId: item.itemId,
        quantity: 1,
        optionIds: [],
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("keeps a cart to a single merchant", async () => {
    const { cityId, currency } = await seedCity(db);
    const first = await seedMerchant(db);
    const second = await seedMerchant(db);
    const itemA = await seedMenuItem(db, first.outletId, {
      priceMinor: 100_000,
      currency,
    });
    const itemB = await seedMenuItem(db, second.outletId, {
      priceMinor: 120_000,
      currency,
    });

    const rider = { id: uid("rider"), role: "rider" as const };
    const cartId = uid("cart");
    await addItem(deps(), {
      actor: rider,
      cityId,
      cartId,
      itemId: itemA.itemId,
      quantity: 1,
      optionIds: [],
      correlationId: null,
    });
    await expect(
      addItem(deps(), {
        actor: rider,
        cityId,
        cartId,
        itemId: itemB.itemId,
        quantity: 1,
        optionIds: [],
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("merges an identical item + option selection into one line", async () => {
    const { cityId, currency } = await seedCity(db);
    const { outletId } = await seedMerchant(db);
    const item = await seedMenuItem(db, outletId, {
      priceMinor: 100_000,
      currency,
    });
    const rider = { id: uid("rider"), role: "rider" as const };
    const cartId = uid("cart");
    const base = {
      actor: rider,
      cityId,
      cartId,
      itemId: item.itemId,
      quantity: 1,
      optionIds: [] as string[],
      correlationId: null,
    };
    await addItem(deps(), base);
    const cart = await addItem(deps(), base);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.quantity).toBe(2);
    expect(cart.subtotalMinor).toBe(200_000);
  });
});
