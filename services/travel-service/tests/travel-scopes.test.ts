/**
 * Defense in depth on the signed context (round 7, X-SEC item 2).
 *
 * The gateway already refuses money-moving travel routes without
 * `travel:book` and strips that scope in limited mode. travel-service now
 * applies the same rule itself (src/middleware/scopes.ts), so a caller that
 * reaches it without passing the gateway's table — ask-service relaying the
 * user's context, any other internal hop — cannot price a cart, set
 * passengers, check out, cancel or switch on a context that did not grant it.
 *
 * And the ops console (src/middleware/operator-city.ts): an operator whose
 * signed context is bound to no city may name the action's city only if UBI
 * operates there, and the accepted city is recorded as operator-declared
 * together with the operator's id.
 *
 * Real Postgres, the real app, contexts minted by the real gateway signer.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { Hono } from "hono";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  closeTestDb,
  gatewayHeaders,
  headers,
  idemKey,
  makeDeps,
  opsActor,
  resetTravel,
  rider,
  seedCity,
  seedFlightSupplier,
  stubIdentityKeys,
  testDb,
  TRAVELLER_SCOPES,
  uid,
} from "./helpers";
import { createApp } from "../src/index";
import {
  cityProvenanceOf,
  failure,
  gatewayAuth,
  setSupportedCityLookup,
} from "../src/middleware";
import { createCart } from "../src/ops/carts";
import { checkout } from "../src/ops/checkout";

import type { JsonRecord } from "../src/ops/types";

const db = testDb();

beforeEach(async () => {
  await resetTravel(db);
  stubIdentityKeys();
});

afterEach(() => {
  vi.unstubAllEnvs();
  setSupportedCityLookup(undefined);
});

afterAll(closeTestDb);

function production(): void {
  vi.stubEnv("NODE_ENV", "production");
}

function app() {
  return createApp(makeDeps(db).deps);
}

async function body(response: Response): Promise<JsonRecord> {
  return (await response.json()) as JsonRecord;
}

const WITHOUT_BOOK = TRAVELLER_SCOPES.filter(
  (scope) => scope !== "travel:book",
);

const CART_BODY = JSON.stringify({
  items: [{ kind: "flight", offerRef: "AP-P4-7120", fareFamilyId: "saver" }],
});

const PASSENGERS_BODY = JSON.stringify([
  {
    givenNames: "Ada",
    surname: "Okafor",
    dateOfBirth: "1990-01-01",
    phone: "+2348000000000",
    gender: "f",
    email: "ada@example.test",
  },
]);

async function seedWorld(): Promise<{
  cityId: string;
  traveller: { id: string; role: string };
  cartId: string;
  orderId: string;
}> {
  const cityId = await seedCity(db);
  await seedFlightSupplier(db, {
    control: {
      "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" },
    },
  });
  const traveller = rider();
  const { deps } = makeDeps(db);
  const cart = await createCart(deps, {
    actor: traveller,
    cityId,
    items: [{ kind: "flight", offerRef: "AP-P4-7120", fareFamilyId: "saver" }],
    idempotencyKey: idemKey(),
    correlationId: null,
  });
  const booked = await createCart(deps, {
    actor: traveller,
    cityId,
    items: [{ kind: "flight", offerRef: "AP-P4-7120", fareFamilyId: "saver" }],
    idempotencyKey: idemKey(),
    correlationId: null,
  });
  const result = await checkout(deps, {
    actor: traveller,
    cityId,
    cartId: booked.id,
    paymentMethodId: "wallet",
    grantId: "grant_test",
    assuranceMethod: null,
    expectedTotal: null,
    idempotencyKey: idemKey(),
    correlationId: null,
  });
  if (result.kind !== "ok") {
    throw new Error("expected a booked order");
  }
  return {
    cityId,
    traveller,
    cartId: cart.id,
    orderId: result.orders[0]?.id ?? "",
  };
}

/** The five money-moving travel routes, as a client calls them. */
function moneyRoutes(world: { cartId: string; orderId: string }) {
  return [
    { method: "POST", path: "/v1/travel/carts", body: CART_BODY },
    {
      method: "PUT",
      path: `/v1/travel/carts/${world.cartId}/passengers`,
      body: PASSENGERS_BODY,
    },
    {
      method: "POST",
      path: `/v1/travel/carts/${world.cartId}/checkout`,
      body: JSON.stringify({ paymentMethodId: "wallet", grantId: "grant_x" }),
    },
    {
      method: "POST",
      path: `/v1/travel/orders/${world.orderId}/cancel`,
      body: JSON.stringify({}),
    },
    {
      method: "POST",
      path: `/v1/travel/orders/${world.orderId}/switch`,
      body: JSON.stringify({ alternativeId: "alt_1" }),
    },
  ] as const;
}

async function snapshot(world: { cartId: string; orderId: string }) {
  const [carts, cart, order, events] = await Promise.all([
    db.travelCart.count(),
    db.travelCart.findUniqueOrThrow({ where: { id: world.cartId } }),
    db.travelOrder.findUniqueOrThrow({ where: { id: world.orderId } }),
    db.outboxEvent.count(),
  ]);
  return {
    carts,
    passengers: JSON.stringify(cart.passengers),
    cartStatus: cart.status,
    orderState: order.state,
    events,
  };
}

describe("money-moving travel routes need travel:book on the signed context", () => {
  it("refuses every one of them to a context without travel:book, writing nothing", async () => {
    const world = await seedWorld();
    production();
    const before = await snapshot(world);
    const server = app();
    for (const route of moneyRoutes(world)) {
      const response = await server.request(route.path, {
        method: route.method,
        headers: await gatewayHeaders(world.traveller, {
          cityId: world.cityId,
          scopes: WITHOUT_BOOK,
          extra: { "Idempotency-Key": idemKey() },
        }),
        body: route.body,
      });
      expect(response.status, `${route.method} ${route.path}`).toBe(403);
      const refused = await body(response);
      expect(refused.code).toBe("forbidden");
      expect(refused.details).toMatchObject({ required: ["travel:book"] });
    }
    expect(await snapshot(world)).toEqual(before);
  });

  it("refuses them in limited mode as a mode restriction — even if the context claims the scope", async () => {
    const world = await seedWorld();
    production();
    const before = await snapshot(world);
    const server = app();
    for (const route of moneyRoutes(world)) {
      const response = await server.request(route.path, {
        method: route.method,
        headers: await gatewayHeaders(world.traveller, {
          cityId: world.cityId,
          scopes: TRAVELLER_SCOPES,
          modes: ["limited"],
          extra: { "Idempotency-Key": idemKey() },
        }),
        body: route.body,
      });
      expect(response.status, `${route.method} ${route.path}`).toBe(403);
      expect((await body(response)).code).toBe("limited_mode");
    }
    expect(await snapshot(world)).toEqual(before);
  });

  // The positive cases run outside production: production refuses the
  // fixture supply adapter these tests book against (adapters/production-
  // guard.ts). A presented context is verified — and its scopes enforced —
  // in every environment.
  it("still serves searches and reads to a limited, read-only context", async () => {
    const world = await seedWorld();
    const server = app();
    const readOnly = async () =>
      gatewayHeaders(world.traveller, {
        cityId: world.cityId,
        scopes: ["travel:read", "ride:read"],
        modes: ["limited"],
      });
    const search = await server.request("/v1/travel/flights/searches", {
      method: "POST",
      headers: await readOnly(),
      body: JSON.stringify({
        from: "LOS",
        to: "ABV",
        departDate: "2026-09-12",
        passengers: 1,
      }),
    });
    expect(search.status).toBe(201);
    const read = await server.request(`/v1/travel/orders/${world.orderId}`, {
      headers: await readOnly(),
    });
    expect(read.status).toBe(200);
  });

  it("lets a full-mode context holding travel:book through", async () => {
    const world = await seedWorld();
    const response = await app().request("/v1/travel/carts", {
      method: "POST",
      headers: await gatewayHeaders(world.traveller, {
        cityId: world.cityId,
        extra: { "Idempotency-Key": idemKey() },
      }),
      body: CART_BODY,
    });
    expect(response.status).toBe(201);
  });

  it("leaves the documented unsigned development mode to the flags", async () => {
    const world = await seedWorld();
    const response = await app().request("/v1/travel/carts", {
      method: "POST",
      headers: headers(world.traveller, world.cityId, {
        "Idempotency-Key": idemKey(),
      }),
      body: CART_BODY,
    });
    expect(response.status).toBe(201);
  });
});

describe("an unbound operator may name only a supported city", () => {
  async function settle(
    orderId: string,
    requestHeaders: Record<string, string>,
  ): Promise<Response> {
    const response = await app().request(
      `/v1/ops/travel/orders/${orderId}/settlement`,
      {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({ invoicedMinor: 1_000 }),
      },
    );
    return response;
  }

  it("refuses a city UBI does not operate in — unknown or inactive — before anything is recorded", async () => {
    const world = await seedWorld();
    const paused = await seedCity(db);
    await db.city.update({ where: { id: paused }, data: { active: false } });
    production();
    const admin = { id: uid("adm"), role: "admin" };
    const eventsBefore = await db.outboxEvent.count();

    for (const declared of [uid("nowhere"), paused]) {
      const response = await settle(
        world.orderId,
        await gatewayHeaders(admin, { scopes: [], declaredCityId: declared }),
      );
      expect(response.status, declared).toBe(404);
      const refused = await body(response);
      expect(refused.code).toBe("city_unsupported");
      expect(refused.details).toMatchObject({
        cityId: declared,
        reason: "operator_declared_city_unsupported",
      });
    }
    expect(await db.travelSettlement.count()).toBe(0);
    expect(await db.outboxEvent.count()).toBe(eventsBefore);

    // A supported city is accepted, as the signed operator.
    const accepted = await settle(
      world.orderId,
      await gatewayHeaders(admin, { scopes: [], declaredCityId: world.cityId }),
    );
    expect(accepted.status).toBe(201);
    const settlementId = String((await body(accepted)).settlementId);
    const event = await db.outboxEvent.findFirstOrThrow({
      where: { aggregateId: settlementId },
    });
    expect(event.actorId).toBe(admin.id);
  });

  it("treats a city lookup that fails as an outage, never as a yes", async () => {
    const world = await seedWorld();
    production();
    setSupportedCityLookup(async () => {
      throw new Error("database unreachable");
    });
    const response = await settle(
      world.orderId,
      await gatewayHeaders(opsActor(), {
        scopes: [],
        declaredCityId: world.cityId,
      }),
    );
    expect(response.status).toBe(503);
    expect((await body(response)).code).toBe("service_unavailable");
    expect(await db.travelSettlement.count()).toBe(0);
  });

  it("records whose word the city rests on: verified, or operator-declared with the operator's id", async () => {
    const world = await seedWorld();
    production();
    const probe = new Hono();
    probe.use("*", gatewayAuth);
    probe.get("/probe", (c) => {
      try {
        return c.json(cityProvenanceOf(c));
      } catch (error) {
        return failure(c, error);
      }
    });
    const admin = { id: uid("adm"), role: "admin" };

    const declared = await probe.request("/probe", {
      headers: await gatewayHeaders(admin, {
        scopes: [],
        declaredCityId: world.cityId,
      }),
    });
    expect(await body(declared)).toEqual({
      cityId: world.cityId,
      provenance: "operator_declared",
      declaredBy: admin.id,
    });

    const bound = await probe.request("/probe", {
      headers: await gatewayHeaders(admin, {
        scopes: [],
        cityId: world.cityId,
      }),
    });
    expect(await body(bound)).toEqual({
      cityId: world.cityId,
      provenance: "verified",
      declaredBy: null,
    });

    // A traveller never gets the operator exception.
    const traveller = await probe.request("/probe", {
      headers: await gatewayHeaders(world.traveller, {
        declaredCityId: world.cityId,
      }),
    });
    expect(traveller.status).toBe(404);
    expect((await body(traveller)).code).toBe("city_unsupported");
  });
});
