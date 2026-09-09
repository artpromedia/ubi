/**
 * A search cache is a display convenience; it NEVER bypasses the checkout
 * revalidation. Even with a live `cache_until`, checkout re-prices with the
 * supplier and stops with a repriced cart (charging nothing) when the price has
 * moved and the traveller has not already accepted the new total.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createCart } from "../src/ops/carts";
import { checkout } from "../src/ops/checkout";
import { staySearch } from "../src/ops/search";

import {
  closeTestDb,
  idemKey,
  makeDeps,
  money,
  resetTravel,
  rider,
  seedCity,
  seedStaySupplier,
  setControl,
  testDb,
} from "./helpers";

const db = testDb();
afterAll(closeTestDb);
beforeEach(() => resetTravel(db));

describe("search cache never bypasses checkout revalidation", () => {
  it("stores cache_until on a search but re-prices at checkout", async () => {
    const cityId = await seedCity(db);
    const supplierId = await seedStaySupplier(db, { cacheSeconds: 1800 });
    const { deps } = makeDeps(db);
    const actor = rider();

    const search = await staySearch(deps, {
      actor,
      cityId,
      params: { city: "Abuja", checkIn: "2026-09-12", checkOut: "2026-09-14", guests: 2 },
      correlationId: null,
    });
    const searchRow = await db.travelSearch.findUnique({ where: { id: search.searchId } });
    expect(searchRow?.cacheUntil).not.toBeNull(); // a cache exists...

    // Two carts priced at the original ₦370,000.
    const cart1 = await createCart(deps, {
      actor,
      cityId,
      items: [{ kind: "stay", offerRef: "transcorp-king", rateId: "transcorp-king" }],
      idempotencyKey: idemKey(),
      correlationId: null,
    });
    const cart2 = await createCart(deps, {
      actor,
      cityId,
      items: [{ kind: "stay", offerRef: "transcorp-king", rateId: "transcorp-king" }],
      idempotencyKey: idemKey(),
      correlationId: null,
    });
    expect(cart1.total.amountMinor).toBe(37_000_000);

    // The supplier's price moves after the search was cached.
    await setControl(db, supplierId, "transcorp-king", { repriceToMinor: 40_000_000 });

    // ...yet checkout revalidates and refuses to charge the stale price.
    const repriced = await checkout(deps, {
      actor,
      cityId,
      cartId: cart1.id,
      paymentMethodId: "wallet",
      grantId: "grant_test",
      assuranceMethod: null,
      expectedTotal: null,
      idempotencyKey: idemKey(),
      correlationId: null,
    });
    expect(repriced.kind).toBe("repriced");
    if (repriced.kind === "repriced") {
      expect(repriced.cart.total.amountMinor).toBe(40_000_000);
      expect(repriced.cart.previousTotal?.amountMinor).toBe(37_000_000);
    }
    const orders1 = await db.travelOrder.count({ where: { cartId: cart1.id } });
    expect(orders1).toBe(0); // nothing was booked, nothing charged

    // When the traveller accepts the revalidated total, checkout proceeds.
    const ok = await checkout(deps, {
      actor,
      cityId,
      cartId: cart2.id,
      paymentMethodId: "wallet",
      grantId: "grant_test",
      assuranceMethod: null,
      expectedTotal: money(40_000_000, "NGN"),
      idempotencyKey: idemKey(),
      correlationId: null,
    });
    expect(ok.kind).toBe("ok");
    if (ok.kind === "ok") {
      expect(ok.orders[0]?.state).toBe("confirmed");
      expect(ok.orders[0]?.price.amountMinor).toBe(40_000_000);
    }
  });
});
