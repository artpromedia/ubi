/**
 * HTTP surface: feature-flag gating (a disabled vertical 404s), ops-only access,
 * and the happy path search → cart → checkout → order over the real routes.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/index";

import {
  closeTestDb,
  headers,
  idemKey,
  makeDeps,
  opsActor,
  resetTravel,
  rider,
  seedCity,
  seedFlightSupplier,
  seedStaySupplier,
  testDb,
} from "./helpers";

const db = testDb();
afterAll(closeTestDb);
beforeEach(() => resetTravel(db));

function app() {
  const { deps } = makeDeps(db);
  return createApp(deps);
}

describe("travel HTTP surface", () => {
  it("404s a disabled vertical (deep links must not reveal it)", async () => {
    const cityId = await seedCity(db, { flags: { flights_booking: false, stays_booking: true } });
    await seedFlightSupplier(db);
    const res = await app().request("/v1/travel/flights/searches", {
      method: "POST",
      headers: headers(rider(), cityId),
      body: JSON.stringify({ from: "LOS", to: "ABV", departDate: "2026-09-12", passengers: 1 }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("feature_disabled");
  });

  it("keeps the ops console admin-only", async () => {
    const cityId = await seedCity(db);
    const riderRes = await app().request("/v1/ops/travel/exceptions", {
      headers: headers(rider(), cityId),
    });
    expect(riderRes.status).toBe(403);

    const opsRes = await app().request("/v1/ops/travel/exceptions", {
      headers: headers(opsActor(), cityId),
    });
    expect(opsRes.status).toBe(200);
    expect(await opsRes.json()).toEqual([]);
  });

  it("runs search → cart → checkout → order over HTTP", async () => {
    const cityId = await seedCity(db);
    await seedFlightSupplier(db, {
      control: { "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" } },
    });
    await seedStaySupplier(db);
    const server = app();
    const actor = rider();

    const searchRes = await server.request("/v1/travel/flights/searches", {
      method: "POST",
      headers: headers(actor, cityId),
      body: JSON.stringify({ from: "LOS", to: "ABV", departDate: "2026-09-12", passengers: 1 }),
    });
    expect(searchRes.status).toBe(201);
    const search = (await searchRes.json()) as { searchId: string; pricesAsOf: string; offers: unknown[] };
    expect(search.offers.length).toBeGreaterThan(0);
    expect(typeof search.pricesAsOf).toBe("string");

    const cartRes = await server.request("/v1/travel/carts", {
      method: "POST",
      headers: headers(actor, cityId, { "Idempotency-Key": idemKey() }),
      body: JSON.stringify({ items: [{ kind: "flight", offerRef: "AP-P4-7120", fareFamilyId: "saver" }] }),
    });
    expect(cartRes.status).toBe(201);
    const cart = (await cartRes.json()) as { id: string; total: { amountMinor: number } };
    expect(cart.total.amountMinor).toBe(14_850_000);

    const checkoutRes = await server.request(`/v1/travel/carts/${cart.id}/checkout`, {
      method: "POST",
      headers: headers(actor, cityId, { "Idempotency-Key": idemKey() }),
      body: JSON.stringify({ paymentMethodId: "wallet", grantId: "grant_test" }),
    });
    expect(checkoutRes.status).toBe(202);
    const checkout = (await checkoutRes.json()) as {
      tripId: string;
      orders: { id: string; state: string }[];
    };
    expect(checkout.orders).toHaveLength(1);
    const orderId = checkout.orders[0]?.id ?? "";
    expect(checkout.orders[0]?.state).toBe("confirmed");

    const orderRes = await server.request(`/v1/travel/orders/${orderId}`, {
      headers: headers(actor, cityId),
    });
    expect(orderRes.status).toBe(200);

    // Another traveller cannot read it.
    const otherRes = await server.request(`/v1/travel/orders/${orderId}`, {
      headers: headers(rider(), cityId),
    });
    expect(otherRes.status).toBe(404);

    // Checkout requires a confirmation (grant or PIN).
    const noGrant = await server.request(`/v1/travel/carts/${cart.id}/checkout`, {
      method: "POST",
      headers: headers(actor, cityId, { "Idempotency-Key": idemKey() }),
      body: JSON.stringify({ paymentMethodId: "wallet" }),
    });
    expect(noGrant.status).toBe(422);
  });

  it("records a settlement difference through the ops route", async () => {
    const cityId = await seedCity(db);
    await seedFlightSupplier(db, {
      control: { "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" } },
    });
    const server = app();
    const actor = rider();

    const cartRes = await server.request("/v1/travel/carts", {
      method: "POST",
      headers: headers(actor, cityId, { "Idempotency-Key": idemKey() }),
      body: JSON.stringify({ items: [{ kind: "flight", offerRef: "AP-P4-7120", fareFamilyId: "saver" }] }),
    });
    const cart = (await cartRes.json()) as { id: string };
    const checkoutRes = await server.request(`/v1/travel/carts/${cart.id}/checkout`, {
      method: "POST",
      headers: headers(actor, cityId, { "Idempotency-Key": idemKey() }),
      body: JSON.stringify({ paymentMethodId: "wallet", grantId: "grant_test" }),
    });
    const checkout = (await checkoutRes.json()) as { orders: { id: string }[] };
    const orderId = checkout.orders[0]?.id ?? "";

    const res = await server.request(`/v1/ops/travel/orders/${orderId}/settlement`, {
      method: "POST",
      headers: headers(opsActor(), cityId),
      body: JSON.stringify({ invoicedMinor: 14_800_000 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { differenceMinor: number };
    expect(body.differenceMinor).toBe(14_850_000 - 14_800_000);

    const health = await server.request("/v1/ops/travel/providers/health", {
      headers: headers(opsActor(), cityId),
    });
    expect(health.status).toBe(200);
    const healthBody = (await health.json()) as { unresolvedSettlementDifferenceMinor: number };
    expect(healthBody.unresolvedSettlementDifferenceMinor).toBe(50_000);
  });
});
