/**
 * Every travel route family reads its caller from the gateway-signed identity
 * context (slice T-GW).
 *
 * Round 5 moved the airport-transfer routes onto the signed `x-ubi-identity`
 * context; checkout, orders and the ops console still trusted plain
 * `X-User-ID` / `X-User-Role` and a client-declared `X-City-ID` in production.
 * This file pins the rule for EVERY client and ops family
 * (src/middleware/auth.ts):
 *
 *   - production: a valid signed context is accepted and its claims beat the
 *     plain mirrors; a missing, forged, tampered, expired, wrong-audience,
 *     wrong-issuer or unsigned context is refused (401) and nothing is written;
 *   - a declared `X-City-ID` that disagrees with the verified city is refused
 *     (403 `city_mismatch`) on every route, reads included;
 *   - the ops console opens only for an ops role FROM THE SIGNED CONTEXT;
 *   - a presented context with no usable key is an outage (503), never a
 *     fall back to the plain headers — and production refuses to boot without
 *     UBI_IDENTITY_SECRET;
 *   - development/test keeps the documented unsigned mode (plain mirrors);
 *   - supplier webhooks keep their own signatures and are unaffected.
 *
 * Valid contexts are minted by the REAL gateway signer
 * (services/api-gateway/src/identity/context.ts, via tests/helpers.ts), so an
 * issuer/verifier drift turns this file red. The refusal cases that need a
 * claim the gateway never mints (wrong audience, wrong issuer, alg `none`)
 * are hand-built with the right key, and a hand-built CONTROL with correct
 * claims is accepted — so each refusal is down to the one altered claim.
 * Real Postgres, the real app, the real routes.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import path from "node:path";

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
  gatewayContext,
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
  TEST_IDENTITY_SECRET,
  testDb,
  TRAVELLER_SCOPES,
  uid,
} from "./helpers";
import { computeSignature } from "../src/adapters/signature";
import { createApp } from "../src/index";
import { assertIdentityConfigured } from "../src/lib/identity-context";
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
});

afterAll(closeTestDb);

function app() {
  return createApp(makeDeps(db).deps);
}

function production(): void {
  vi.stubEnv("NODE_ENV", "production");
}

const FLIGHT_SEARCH = {
  from: "LOS",
  to: "ABV",
  departDate: "2026-09-12",
  passengers: 1,
};

async function body(response: Response): Promise<JsonRecord> {
  return (await response.json()) as JsonRecord;
}

/** A confirmed flight order owned by `actor`, booked through the ops layer. */
async function confirmedOrder(
  cityId: string,
  actor: { id: string; role: string },
): Promise<string> {
  await seedFlightSupplier(db, {
    control: {
      "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" },
    },
  });
  const { deps } = makeDeps(db);
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
  if (result.kind !== "ok") {
    throw new Error("expected a booked order");
  }
  return result.orders[0]?.id ?? "";
}

// ---------------------------------------------------------------------------
// Hand-built contexts (for claims the gateway never mints)
// ---------------------------------------------------------------------------

function segment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function craft(
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  key: string | null,
): string {
  const signingInput = `${segment(header)}.${segment(claims)}`;
  const signature =
    key === null
      ? ""
      : createHmac("sha256", key).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

function claimsFor(
  actor: { id: string; role: string },
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: actor.id,
    role: actor.role,
    scp: [...TRAVELLER_SCOPES],
    mod: [],
    city: null,
    rid: `req-${uid("rid")}`,
    iss: "ubi-gateway",
    aud: "ubi-internal",
    iat: now,
    exp: now + 120,
    ...overrides,
  };
}

const HS256 = { alg: "HS256", typ: "UBI-IC", kid: "test-k1" };

type Credential = (actor: {
  id: string;
  role: string;
}) => Record<string, string> | Promise<Record<string, string>>;

/** A request carrying `x-ubi-identity: token` and correct-looking mirrors. */
function withToken(
  actor: { id: string; role: string },
  token: string,
): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-ubi-identity": token,
    "x-user-id": actor.id,
    "x-user-role": actor.role,
  };
}

/** Every way a production caller can fail to prove who it is. */
const UNPROVEN: readonly (readonly [string, Credential])[] = [
  [
    "no signed context (plain mirrors only)",
    (actor) => ({
      "content-type": "application/json",
      "X-User-ID": actor.id,
      "X-User-Role": actor.role,
    }),
  ],
  [
    "a context signed with a key the gateway does not hold (forged)",
    (actor) =>
      withToken(
        actor,
        craft(
          HS256,
          claimsFor(actor),
          "an-attacker-held-key-that-is-long-0001",
        ),
      ),
  ],
  [
    "a genuine context with a swapped subject (tampered)",
    async (actor) => {
      const genuine = await gatewayContext(actor);
      const [head, , signature] = genuine.split(".");
      const swapped = segment(claimsFor({ id: "usr_victim", role: "rider" }));
      return withToken(actor, `${head}.${swapped}.${signature}`);
    },
  ],
  [
    "a genuine context past its expiry",
    async (actor) =>
      withToken(actor, await gatewayContext(actor, { ttlSeconds: -1 })),
  ],
  [
    "a context for another audience",
    (actor) =>
      withToken(
        actor,
        craft(
          HS256,
          claimsFor(actor, { aud: "ubi-api" }),
          TEST_IDENTITY_SECRET,
        ),
      ),
  ],
  [
    "a context from another issuer",
    (actor) =>
      withToken(
        actor,
        craft(
          HS256,
          claimsFor(actor, { iss: "ubi.africa" }),
          TEST_IDENTITY_SECRET,
        ),
      ),
  ],
  [
    "an unsigned context (alg none)",
    (actor) =>
      withToken(
        actor,
        craft({ alg: "none", typ: "UBI-IC" }, claimsFor(actor), null),
      ),
  ],
];

interface Probe {
  readonly family: string;
  readonly method: string;
  readonly path: string;
  readonly actor: () => { id: string; role: string };
  readonly body?: unknown;
}

/** One representative request per route of every client and ops family. */
const PROBES: readonly Probe[] = [
  // Traveller — /v1/travel/*
  {
    family: "travel",
    method: "POST",
    path: "/v1/travel/flights/searches",
    actor: rider,
    body: FLIGHT_SEARCH,
  },
  {
    family: "travel",
    method: "POST",
    path: "/v1/travel/stays/searches",
    actor: rider,
    body: {
      city: "ABV",
      checkIn: "2026-09-12",
      checkOut: "2026-09-14",
      guests: 1,
    },
  },
  {
    family: "travel",
    method: "POST",
    path: "/v1/travel/carts",
    actor: rider,
    body: { items: [{ kind: "flight", offerRef: "AP-P4-7120" }] },
  },
  {
    family: "travel",
    method: "POST",
    path: "/v1/travel/carts/tcart_x/checkout",
    actor: rider,
    body: { paymentMethodId: "wallet" },
  },
  {
    family: "travel",
    method: "GET",
    path: "/v1/travel/orders/tord_x",
    actor: rider,
  },
  {
    family: "travel",
    method: "POST",
    path: "/v1/travel/orders/tord_x/cancel",
    actor: rider,
  },
  {
    family: "travel",
    method: "GET",
    path: "/v1/travel/trips/ttrip_x/linked",
    actor: rider,
  },
  // Ops console — /v1/ops/travel/*
  {
    family: "ops",
    method: "GET",
    path: "/v1/ops/travel/exceptions",
    actor: opsActor,
  },
  {
    family: "ops",
    method: "POST",
    path: "/v1/ops/travel/exceptions/tord_x/actions",
    actor: opsActor,
    body: { action: "escalate" },
  },
  {
    family: "ops",
    method: "POST",
    path: "/v1/ops/travel/commercial-rates",
    actor: opsActor,
    body: {
      supplierId: "sup_x",
      routeOrProperty: "LOS-ABV",
      feeSchedule: {},
      source: "contract",
      effectiveDate: "2026-09-01",
    },
  },
  {
    family: "ops",
    method: "POST",
    path: "/v1/ops/travel/orders/tord_x/settlement",
    actor: opsActor,
    body: { invoicedMinor: 1 },
  },
  // Airport transfers — /v1/reservations
  {
    family: "reservations",
    method: "GET",
    path: "/v1/reservations",
    actor: rider,
  },
  {
    family: "reservations",
    method: "POST",
    path: "/v1/reservations",
    actor: rider,
    body: {},
  },
];

async function send(
  probe: Probe,
  requestHeaders: Record<string, string>,
): Promise<Response> {
  const response = await app().request(probe.path, {
    method: probe.method,
    headers: { "Idempotency-Key": idemKey(), ...requestHeaders },
    ...(probe.body === undefined ? {} : { body: JSON.stringify(probe.body) }),
  });
  return response;
}

async function writesNothing(): Promise<void> {
  expect(await db.travelSearch.count()).toBe(0);
  expect(await db.travelCart.count()).toBe(0);
  expect(await db.travelOrder.count()).toBe(0);
  expect(await db.travelCommercialRate.count()).toBe(0);
  expect(await db.travelSettlement.count()).toBe(0);
  expect(await db.airportTransfer.count()).toBe(0);
  expect(await db.outboxEvent.count()).toBe(0);
}

// ---------------------------------------------------------------------------

describe("in production every client and ops family refuses an unproven caller", () => {
  it("accepts the hand-built control context (correct claims, correct key)", async () => {
    production();
    const actor = rider();
    // Authenticated: the order is simply not there (a 401 would mean the
    // hand-built context itself is wrong, and every refusal below moot).
    const response = await app().request("/v1/travel/orders/tord_missing", {
      headers: withToken(
        actor,
        craft(HS256, claimsFor(actor), TEST_IDENTITY_SECRET),
      ),
    });
    expect(response.status).toBe(404);
    expect((await body(response)).code).toBe("not_found");
  });

  it.each(UNPROVEN.map(([label, credential]) => [label, credential]))(
    "refuses %s on every route (401) and writes nothing",
    async (_label, credential) => {
      production();
      const cityId = await seedCity(db);
      const refused: string[] = [];
      for (const probe of PROBES) {
        const response = await send(probe, {
          ...(await credential(probe.actor())),
          "X-City-ID": cityId,
        });
        const answer = await body(response);
        if (response.status !== 401 || answer.code !== "unauthorized") {
          refused.push(
            `${probe.method} ${probe.path} → ${response.status} ${String(answer.code)}`,
          );
        }
      }
      expect(refused, "every probe must be refused as unauthorized").toEqual(
        [],
      );
      await writesNothing();
    },
  );
});

describe("the traveller routes act on the signed context", () => {
  // Production never serves the fixture supply adapter (adapters/registry.ts),
  // so the supplier-backed steps run under NODE_ENV=test here. The signed
  // context is verified identically in every environment — the only
  // production difference, refusing a request WITHOUT one, is the matrix
  // above — and production itself is exercised on the routes that resolve
  // no supplier (passengers, order and trip reads, the ops console).
  it("books search → cart → checkout → order over HTTP as the signed traveller, whatever the mirrors say", async () => {
    const cityId = await seedCity(db);
    await seedFlightSupplier(db, {
      control: {
        "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" },
      },
    });
    const traveller = rider();
    const victim = rider();
    // Mirrors rewritten to another user and an ops role: the signed claims win.
    const forgedMirrors = {
      "x-user-id": victim.id,
      "x-user-role": "travel_ops",
      "x-auth-user-id": victim.id,
      "x-auth-user-role": "travel_ops",
    };
    const as = async (extra: Record<string, string> = {}) => {
      const signed = await gatewayHeaders(traveller, {
        cityId,
        extra: { ...forgedMirrors, ...extra },
      });
      return signed;
    };
    const server = app();

    const search = await server.request("/v1/travel/flights/searches", {
      method: "POST",
      headers: await as(),
      body: JSON.stringify(FLIGHT_SEARCH),
    });
    expect(search.status).toBe(201);
    const searchId = String((await body(search)).searchId);
    expect(
      (await db.travelSearch.findUniqueOrThrow({ where: { id: searchId } }))
        .userId,
    ).toBe(traveller.id);

    const cart = await server.request("/v1/travel/carts", {
      method: "POST",
      headers: await as({ "Idempotency-Key": idemKey() }),
      body: JSON.stringify({
        items: [
          { kind: "flight", offerRef: "AP-P4-7120", fareFamilyId: "saver" },
        ],
      }),
    });
    expect(cart.status).toBe(201);
    const cartId = String((await body(cart)).id);

    const paid = await server.request(`/v1/travel/carts/${cartId}/checkout`, {
      method: "POST",
      headers: await as({ "Idempotency-Key": idemKey() }),
      body: JSON.stringify({
        paymentMethodId: "wallet",
        grantId: "grant_test",
      }),
    });
    expect(paid.status).toBe(202);
    const orders = (await body(paid)).orders as { id: string }[];
    const orderId = orders[0]?.id ?? "";
    const stored = await db.travelOrder.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(stored.userId).toBe(traveller.id);
    // No city was declared: the signed claim is the city (without it, a
    // cart could not have been priced for any city at all).
    expect(stored.cityId).toBe(cityId);

    const read = await server.request(`/v1/travel/orders/${orderId}`, {
      headers: await as(),
    });
    expect(read.status).toBe(200);
    // The victim, signed as themself, cannot see it.
    const other = await server.request(`/v1/travel/orders/${orderId}`, {
      headers: await gatewayHeaders(victim, { cityId }),
    });
    expect(other.status).toBe(404);
  });

  it("in production serves the signed traveller their cart, order and trip — and never another traveller's", async () => {
    const cityId = await seedCity(db);
    const traveller = rider();
    const victim = rider();
    const orderId = await confirmedOrder(cityId, traveller);
    const order = await db.travelOrder.findUniqueOrThrow({
      where: { id: orderId },
    });
    const { deps } = makeDeps(db);
    const cart = await createCart(deps, {
      actor: traveller,
      cityId,
      items: [
        { kind: "flight", offerRef: "AP-P4-7120", fareFamilyId: "saver" },
      ],
      idempotencyKey: idemKey(),
      correlationId: null,
    });

    production();
    const server = app();
    const passengers = JSON.stringify([
      {
        givenNames: "Amaka",
        surname: "Obi",
        dateOfBirth: "1990-01-01",
        phone: "+2348000000000",
      },
    ]);
    // The victim's id in every mirror; the signed traveller still owns it.
    const owner = await gatewayHeaders(traveller, {
      cityId,
      extra: { "x-user-id": victim.id, "x-auth-user-id": victim.id },
    });
    const put = await server.request(`/v1/travel/carts/${cart.id}/passengers`, {
      method: "PUT",
      headers: owner,
      body: passengers,
    });
    expect(put.status).toBe(200);
    for (const target of [
      `/v1/travel/orders/${orderId}`,
      `/v1/travel/trips/${order.tripId ?? ""}`,
    ]) {
      expect((await server.request(target, { headers: owner })).status).toBe(
        200,
      );
    }

    const intruder = await gatewayHeaders(victim, {
      cityId,
      extra: { "x-user-id": traveller.id, "x-auth-user-id": traveller.id },
    });
    const stolen = await server.request(
      `/v1/travel/carts/${cart.id}/passengers`,
      { method: "PUT", headers: intruder, body: passengers },
    );
    expect(stolen.status).toBe(404);
    expect(
      (
        await server.request(`/v1/travel/orders/${orderId}`, {
          headers: intruder,
        })
      ).status,
    ).toBe(404);
  });

  it("refuses a declared city that disagrees with the verified one on every route, reads included (403 city_mismatch)", async () => {
    production();
    const cityId = await seedCity(db);
    const otherCity = await seedCity(db);
    await seedFlightSupplier(db);
    const actor = rider();
    const mismatched = [
      // The client declares another city.
      await gatewayHeaders(actor, { cityId, declaredCityId: otherCity }),
      // A city mirror that disagrees with the signed claim.
      await gatewayHeaders(actor, {
        cityId,
        extra: { "x-ubi-city-id": otherCity },
      }),
      // A city mirror beside a context bound to no city: the gateway writes
      // the mirrors only from a claim, so this one did not come from it.
      await gatewayHeaders(actor, {
        cityId: null,
        extra: { "x-auth-city-id": cityId },
      }),
    ];
    for (const requestHeaders of mismatched) {
      for (const [method, target, payload] of [
        ["POST", "/v1/travel/flights/searches", FLIGHT_SEARCH],
        ["GET", "/v1/travel/orders/tord_x", undefined],
        ["GET", "/v1/travel/trips/ttrip_x", undefined],
        ["GET", "/v1/reservations", undefined],
      ] as const) {
        const response = await app().request(target, {
          method,
          headers: requestHeaders,
          ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        });
        expect(response.status, `${method} ${target}`).toBe(403);
        const answer = await body(response);
        expect(answer.code).toBe("forbidden");
        expect(answer.details).toMatchObject({ reason: "city_mismatch" });
      }
    }
    expect(await db.travelSearch.count()).toBe(0);
  });

  it("never lets a traveller name a city the gateway did not vouch for in production; development accepts the declared city", async () => {
    const cityId = await seedCity(db);
    await seedFlightSupplier(db);
    const actor = rider();
    const cityless = async () => {
      const signed = await gatewayHeaders(actor, {
        cityId: null,
        declaredCityId: cityId,
      });
      return signed;
    };

    production();
    const refused = await app().request("/v1/travel/flights/searches", {
      method: "POST",
      headers: await cityless(),
      body: JSON.stringify(FLIGHT_SEARCH),
    });
    expect(refused.status).toBe(404);
    expect((await body(refused)).code).toBe("city_unsupported");
    // A read needs no city: the caller is authenticated, the order is simply
    // not theirs (or not there).
    const read = await app().request("/v1/travel/orders/tord_missing", {
      headers: await cityless(),
    });
    expect(read.status).toBe(404);
    expect((await body(read)).code).toBe("not_found");
    expect(await db.travelSearch.count()).toBe(0);

    // Outside production (no gateway in front) the declared city is enough.
    vi.stubEnv("NODE_ENV", "development");
    const accepted = await app().request("/v1/travel/flights/searches", {
      method: "POST",
      headers: await cityless(),
      body: JSON.stringify(FLIGHT_SEARCH),
    });
    expect(accepted.status).toBe(201);
  });
});

describe("the ops console opens only for a signed ops role", () => {
  it("refuses plain mirrors in production, and a signed traveller whatever the mirrors claim", async () => {
    production();
    const cityId = await seedCity(db);
    const server = app();

    const mirrors = await server.request("/v1/ops/travel/exceptions", {
      headers: headers(opsActor(), cityId),
    });
    expect(mirrors.status).toBe(401);

    for (const role of ["rider", "driver"]) {
      const traveller = { id: uid(role), role };
      const refused = await server.request("/v1/ops/travel/exceptions", {
        headers: await gatewayHeaders(traveller, {
          declaredCityId: cityId,
          // The mirrors claim an ops role; the signed context says otherwise.
          extra: { "x-user-role": "travel_ops", "x-auth-user-role": "admin" },
        }),
      });
      expect(refused.status, role).toBe(403);
      expect((await body(refused)).code).toBe("forbidden");
    }

    for (const operator of [{ id: uid("adm"), role: "admin" }, opsActor()]) {
      for (const target of [
        "/v1/ops/travel/exceptions",
        "/v1/ops/travel/providers/health",
        "/v1/ops/travel/commercial-rates",
      ]) {
        const opened = await server.request(target, {
          headers: await gatewayHeaders(operator, { scopes: [] }),
        });
        expect(opened.status, `${operator.role} ${target}`).toBe(200);
      }
    }
  });

  it("records a console action as the signed operator, in its bound city or — unbound — the operating city it declares", async () => {
    const cityId = await seedCity(db);
    const otherCity = await seedCity(db);
    const traveller = rider();
    const orderId = await confirmedOrder(cityId, traveller);
    production();
    const charged = Number(
      (await db.travelOrder.findUniqueOrThrow({ where: { id: orderId } }))
        .chargedMinor,
    );
    const admin = { id: uid("adm"), role: "admin" };
    const settle = async (requestHeaders: Record<string, string>) => {
      const response = await app().request(
        `/v1/ops/travel/orders/${orderId}/settlement`,
        {
          method: "POST",
          headers: requestHeaders,
          body: JSON.stringify({ invoicedMinor: charged - 5_000 }),
        },
      );
      return response;
    };

    // Unbound operator, declared operating city, forged mirrors.
    const unbound = await settle(
      await gatewayHeaders(admin, {
        scopes: [],
        declaredCityId: cityId,
        extra: { "x-user-id": "usr_someone_else" },
      }),
    );
    expect(unbound.status).toBe(201);
    const first = String((await body(unbound)).settlementId);
    const firstEvent = await db.outboxEvent.findFirstOrThrow({
      where: { aggregateId: first },
    });
    expect(firstEvent.actorId).toBe(admin.id);
    expect(firstEvent.cityId).toBe(cityId);

    // Unbound and silent about the city: nothing to act in.
    const silent = await settle(await gatewayHeaders(admin, { scopes: [] }));
    expect(silent.status).toBe(404);
    expect((await body(silent)).code).toBe("city_unsupported");

    // Bound to a city: that city, and a different declared one is refused.
    const bound = await settle(
      await gatewayHeaders(admin, { scopes: [], cityId }),
    );
    expect(bound.status).toBe(201);
    const second = String((await body(bound)).settlementId);
    expect(
      (
        await db.outboxEvent.findFirstOrThrow({
          where: { aggregateId: second },
        })
      ).cityId,
    ).toBe(cityId);
    const mismatch = await settle(
      await gatewayHeaders(admin, {
        scopes: [],
        cityId,
        declaredCityId: otherCity,
      }),
    );
    expect(mismatch.status).toBe(403);
    expect((await body(mismatch)).details).toMatchObject({
      reason: "city_mismatch",
    });

    // The operator exception is for operators only: a signed traveller who
    // declares a city is refused by role before any city is read.
    const travellerAttempt = await settle(
      await gatewayHeaders(traveller, { declaredCityId: cityId }),
    );
    expect(travellerAttempt.status).toBe(403);
    expect(await db.travelSettlement.count()).toBe(2);
  });
});

describe("the signed context stays authoritative", () => {
  it("outside production reads the plain mirrors (documented unsigned mode) but never falls back under a bad context", async () => {
    const cityId = await seedCity(db);
    await seedFlightSupplier(db);
    const actor = rider();

    const unsigned = await app().request("/v1/travel/flights/searches", {
      method: "POST",
      headers: headers(actor, cityId),
      body: JSON.stringify(FLIGHT_SEARCH),
    });
    expect(unsigned.status).toBe(201);

    const [head, payload] = (await gatewayContext(actor)).split(".");
    const tampered = await app().request("/v1/travel/flights/searches", {
      method: "POST",
      headers: {
        ...headers(actor, cityId),
        "x-ubi-identity": `${head}.${payload}.${"A".repeat(43)}`,
      },
      body: JSON.stringify(FLIGHT_SEARCH),
    });
    expect(tampered.status).toBe(401);

    const roleless = await app().request("/v1/travel/orders/tord_x", {
      headers: { "X-User-ID": actor.id, "X-City-ID": cityId },
    });
    expect(roleless.status).toBe(401);
    expect(await db.travelSearch.count()).toBe(1);
  });

  it.each(["", "too-short-to-be-a-key"])(
    "answers a presented context 503 when UBI_IDENTITY_SECRET is %j — never trusts the mirrors instead",
    async (secret) => {
      const cityId = await seedCity(db);
      const actor = rider();
      const token = await gatewayContext(actor, { cityId });
      vi.stubEnv("UBI_IDENTITY_SECRET", secret);
      for (const nodeEnv of ["production", "test"]) {
        vi.stubEnv("NODE_ENV", nodeEnv);
        const response = await app().request("/v1/travel/flights/searches", {
          method: "POST",
          headers: { ...headers(actor, cityId), "x-ubi-identity": token },
          body: JSON.stringify(FLIGHT_SEARCH),
        });
        expect(response.status, nodeEnv).toBe(503);
        expect((await body(response)).code).toBe("service_unavailable");
      }
      expect(await db.travelSearch.count()).toBe(0);
    },
  );

  it("verifies a context signed with the previous key during a rotation, and nothing else", async () => {
    production();
    const actor = rider();
    const oldKey = "travel-identity-rotation-previous-key-000001";
    const newKey = "travel-identity-rotation-current-key-0000002";
    vi.stubEnv("UBI_IDENTITY_SECRET", oldKey);
    const signedWithOld = await gatewayContext(actor);

    vi.stubEnv("UBI_IDENTITY_SECRET", newKey);
    const read = async () => {
      const response = await app().request("/v1/travel/orders/tord_missing", {
        headers: withToken(actor, signedWithOld),
      });
      return `${response.status} ${String((await body(response)).code)}`;
    };
    expect(await read()).toBe("401 unauthorized");
    vi.stubEnv("UBI_IDENTITY_SECRET_PREVIOUS", oldKey);
    // Authenticated: the order is simply not there.
    expect(await read()).toBe("404 not_found");
  });
});

describe("supplier webhooks keep their own authentication", () => {
  it("processes a supplier-signed callback with no gateway identity, ignores a stray context, and rejects a bad signature as a supplier failure", async () => {
    const cityId = await seedCity(db);
    const actor = rider();
    const orderId = await confirmedOrder(cityId, actor);
    const supplierId = (
      await db.travelOrder.findUniqueOrThrow({ where: { id: orderId } })
    ).supplierId;
    const envelope = JSON.stringify({
      externalId: uid("wh"),
      type: "ticket_issued",
      orderRef: orderId,
      supplierRefs: { pnr: "AP7QX2", ticketNumbers: ["0572101234567"] },
    });
    const hook = await app().request(`/v1/travel/webhooks/${supplierId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-City-ID": cityId,
        "X-Signature": computeSignature("flight-secret", envelope),
        // Not a gateway route: a stray (garbage) context is not read at all.
        "x-ubi-identity": "not.a.context",
      },
      body: envelope,
    });
    expect(hook.status).toBe(200);
    expect((await body(hook)).result).toBe("processed");
    expect(
      (await db.travelOrder.findUniqueOrThrow({ where: { id: orderId } }))
        .state,
    ).toBe("ticketed");

    const forged = await app().request(`/v1/travel/webhooks/${supplierId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-City-ID": cityId,
        "X-Signature": computeSignature("not-the-secret", envelope),
      },
      body: envelope,
    });
    expect(forged.status).toBe(400);
    expect((await body(forged)).result).toBe("rejected");
  });

  it("in production verifies a live supplier's own signature, never the gateway context", async () => {
    production();
    vi.stubEnv("TRAVEL_SECRET_DUFFEL_IDENTITY_HOOK", "duffel-webhook-secret");
    vi.stubEnv("TRAVEL_SECRET_DUFFEL_IDENTITY_API", "duffel-api-token");
    const supplierId = uid("supDuffel");
    await db.travelSupplier.create({
      data: {
        id: supplierId,
        kind: "flight",
        adapter: "duffel",
        enabled: true,
        config: {
          baseUrl: "http://127.0.0.1:9",
          secretRef: "duffel_identity_api",
          webhookSecretRef: "duffel_identity_hook",
          currency: "GBP",
          webhookToleranceSec: 300,
        } as never,
      },
    });
    const response = await app().request(`/v1/travel/webhooks/${supplierId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Duffel-Signature": "t=1,v1=00",
      },
      body: JSON.stringify({ id: "wev_x", type: "order.created", data: {} }),
    });
    // Refused by Duffel's signature check (recorded as a rejected delivery),
    // not by a missing gateway identity.
    expect(response.status).toBe(400);
    expect((await body(response)).result).toBe("rejected");
    expect(
      await db.travelWebhook.count({
        where: { supplierId, signatureOk: false },
      }),
    ).toBe(1);
  });
});

describe("production refuses to boot without UBI_IDENTITY_SECRET", () => {
  it("fails the boot check in production and reports the unsigned development mode elsewhere", () => {
    for (const nodeEnv of ["production", "prod", " Production "]) {
      expect(() => assertIdentityConfigured({ NODE_ENV: nodeEnv })).toThrow(
        /UBI_IDENTITY_SECRET environment variable is required/,
      );
      expect(() =>
        assertIdentityConfigured({
          NODE_ENV: nodeEnv,
          UBI_IDENTITY_SECRET: "short",
        }),
      ).toThrow(/at least 32 characters/);
      expect(
        assertIdentityConfigured({
          NODE_ENV: nodeEnv,
          UBI_IDENTITY_SECRET: TEST_IDENTITY_SECRET,
        }),
      ).toBe(true);
    }
    for (const nodeEnv of ["development", "test", undefined]) {
      expect(assertIdentityConfigured({ NODE_ENV: nodeEnv })).toBe(false);
    }
  });

  it("the real service process exits before serving anything", async () => {
    const serviceDir = path.resolve(__dirname, "..");
    const env: Record<string, string | undefined> = {
      ...process.env,
      NODE_ENV: "production",
      PORT: "0",
      LOG_LEVEL: "fatal",
      // Present, so the identity guard — not the ride-context guard — is
      // what refuses here.
      RIDE_INTERNAL_CONTEXT_SECRET: "boot-test-ride-context-key",
    };
    delete env.UBI_IDENTITY_SECRET;
    delete env.UBI_IDENTITY_SECRET_PREVIOUS;
    const child = spawn(
      path.resolve(serviceDir, "node_modules/.bin/tsx"),
      ["src/index.ts"],
      { cwd: serviceDir, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const code = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(null);
      }, 45_000);
      child.once("exit", (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
    expect(code, output).toBe(1);
    expect(output).toMatch(/refusing to start/);
    expect(output).toMatch(/UBI_IDENTITY_SECRET/);
  }, 60_000);
});
