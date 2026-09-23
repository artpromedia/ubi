/**
 * Client → REAL API gateway → REAL travel-service, end to end (slice T-GW).
 *
 * Until round 6 no gateway rule reached travel-service, so every travel,
 * airport-transfer and travel-ops call from the rider app, the web app and the
 * admin console answered the gateway's own 404 — and travel-service's own
 * non-transfer routes still trusted plain headers. This file puts the two
 * real apps back to back: the gateway's `createApp` (strip, bearer auth,
 * identity signing, scope matrix, proxy map) forwarding over a socket to
 * travel-service's `createApp` (signed-context verification, city check, ops
 * role) on the real database. Nothing is stubbed between a client bearer token
 * and the travel rows.
 *
 * The supplier-backed booking steps run under NODE_ENV=test (production never
 * serves the fixture supply adapter); everything else runs with
 * NODE_ENV=production, where travel-service accepts nothing but the gateway's
 * signed context.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { createHmac } from "node:crypto";

import { serve, type ServerType } from "@hono/node-server";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  closeTestDb,
  idemKey,
  makeDeps,
  resetTravel,
  seedCity,
  seedFlightSupplier,
  stubIdentityKeys,
  TEST_CLIENT_SECRET,
  testDb,
  uid,
} from "./helpers";
import { createApp } from "../src/index";
import { createCart } from "../src/ops/carts";
import { checkout } from "../src/ops/checkout";

import type { JsonRecord } from "../src/ops/types";
import type { Hono } from "hono";

const db = testDb();
let travelServer: ServerType | undefined;
let gateway: Hono;
const savedRedisUrl = process.env.REDIS_URL;
let ipCounter = 0;

beforeAll(async () => {
  const port = await new Promise<number>((resolve) => {
    travelServer = serve(
      {
        fetch: createApp(makeDeps(db).deps).fetch,
        port: 0,
        hostname: "127.0.0.1",
      },
      (info) => {
        resolve(info.port);
      },
    );
  });
  process.env.TRAVEL_SERVICE_URL = `http://127.0.0.1:${port}`;
  // The gateway's rate limiter binds its store at import: keep it in memory
  // (no Redis socket) for this file.
  delete process.env.REDIS_URL;
  const gatewayApp = await import("../../api-gateway/src/app");
  const gatewayRedis = await import("../../api-gateway/src/lib/redis");
  // Nobody here is in wallet safe mode.
  gatewayRedis.setIdentityStateStore({
    get: async () => {
      const none = await Promise.resolve(null);
      return none;
    },
  });
  gateway = gatewayApp.createApp("test");
});

afterAll(async () => {
  if (savedRedisUrl === undefined) {
    delete process.env.REDIS_URL;
  } else {
    process.env.REDIS_URL = savedRedisUrl;
  }
  delete process.env.TRAVEL_SERVICE_URL;
  await new Promise<void>((resolve) => {
    if (travelServer === undefined) {
      resolve();
      return;
    }
    travelServer.close(() => {
      resolve();
    });
  });
  await closeTestDb();
});

beforeEach(async () => {
  await resetTravel(db);
  stubIdentityKeys();
  // The gateway's request logger (hono/logger) writes every hop to stdout.
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * A client access token exactly as user-service issues one
 * (services/user-service/src/identity/tokens.ts): HS256 over the client-facing
 * JWT_SECRET, issuer ubi.africa, audience ubi-api.
 */
function clientToken(claims: {
  readonly sub: string;
  readonly role: string;
  readonly cityId?: string;
  readonly mode?: "full" | "limited";
}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    sub: claims.sub,
    role: claims.role,
    email: `${claims.sub}@example.test`,
    permissions: [],
    mode: claims.mode ?? "full",
    iss: "ubi.africa",
    aud: "ubi-api",
    iat: now,
    exp: now + 900,
  };
  if (claims.cityId !== undefined) {
    payload.cityId = claims.cityId;
  }
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const signingInput = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}`;
  const signature = createHmac("sha256", TEST_CLIENT_SECRET)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

async function viaGateway(
  method: string,
  path: string,
  token: string,
  options: {
    readonly body?: unknown;
    readonly headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: JsonRecord }> {
  ipCounter += 1;
  const response = await gateway.fetch(
    new Request(`http://gateway.test${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-forwarded-for": `10.88.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
        ...(options.headers ?? {}),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    body: text.length === 0 ? {} : (JSON.parse(text) as JsonRecord),
  };
}

/** The gateway's own refusals are `{ success: false, error: { code } }`. */
function gatewayCode(body: JsonRecord): unknown {
  return (body.error as JsonRecord | undefined)?.code;
}

async function seedBookableFlight(): Promise<void> {
  await seedFlightSupplier(db, {
    control: {
      "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" },
    },
  });
}

async function confirmedOrder(
  cityId: string,
  userId: string,
): Promise<{ orderId: string; tripId: string }> {
  await seedBookableFlight();
  const { deps } = makeDeps(db);
  const actor = { id: userId, role: "rider" };
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
  return { orderId: result.orders[0]?.id ?? "", tripId: result.tripId };
}

describe("client → real gateway → real travel-service", () => {
  it("books search → cart → checkout → order through the gateway as the token's user (fixture supply, NODE_ENV=test)", async () => {
    const cityId = await seedCity(db);
    await seedBookableFlight();
    const userId = uid("usr");
    const token = clientToken({ sub: userId, role: "rider", cityId });
    // A forged identity header on every call: the gateway strips it.
    const forged = { "x-user-id": "usr_victim", "x-ubi-identity": "forged" };

    const search = await viaGateway(
      "POST",
      "/v1/travel/flights/searches",
      token,
      {
        headers: forged,
        body: {
          from: "LOS",
          to: "ABV",
          departDate: "2026-09-12",
          passengers: 1,
        },
      },
    );
    expect(search.status).toBe(201);

    const cart = await viaGateway("POST", "/v1/travel/carts", token, {
      headers: { ...forged, "Idempotency-Key": idemKey() },
      body: {
        items: [
          { kind: "flight", offerRef: "AP-P4-7120", fareFamilyId: "saver" },
        ],
      },
    });
    expect(cart.status).toBe(201);

    const paid = await viaGateway(
      "POST",
      `/v1/travel/carts/${String(cart.body.id)}/checkout`,
      token,
      {
        headers: { ...forged, "Idempotency-Key": idemKey() },
        body: { paymentMethodId: "wallet", grantId: "grant_test" },
      },
    );
    expect(paid.status).toBe(202);
    const orderId = (paid.body.orders as { id: string }[])[0]?.id ?? "";
    const stored = await db.travelOrder.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(stored.userId).toBe(userId);
    expect(stored.cityId).toBe(cityId);

    const read = await viaGateway("GET", `/v1/travel/orders/${orderId}`, token);
    expect(read.status).toBe(200);
  });

  it("in production serves a traveller their own order and trip, and nobody else's", async () => {
    const cityId = await seedCity(db);
    const userId = uid("usr");
    const { orderId, tripId } = await confirmedOrder(cityId, userId);
    production();
    const token = clientToken({ sub: userId, role: "rider", cityId });

    const order = await viaGateway(
      "GET",
      `/v1/travel/orders/${orderId}`,
      token,
      {
        headers: { "x-user-id": "usr_victim", "x-ubi-identity": "forged" },
      },
    );
    expect(order.status).toBe(200);
    expect(order.body.id).toBe(orderId);
    const trip = await viaGateway("GET", `/v1/travel/trips/${tripId}`, token);
    expect(trip.status).toBe(200);

    const stranger = clientToken({ sub: uid("usr"), role: "rider", cityId });
    const denied = await viaGateway(
      "GET",
      `/v1/travel/orders/${orderId}`,
      stranger,
      // The stranger names the owner in every identity header it can think of.
      { headers: { "x-user-id": userId, "x-auth-user-id": userId } },
    );
    expect(denied.status).toBe(404);
    expect(denied.body.code).toBe("not_found");
  });

  it("in production refuses a declared x-city-id that disagrees with the token's city, and accepts one that agrees", async () => {
    const cityId = await seedCity(db);
    const userId = uid("usr");
    const { orderId } = await confirmedOrder(cityId, userId);
    production();
    const token = clientToken({ sub: userId, role: "rider", cityId });

    const mismatch = await viaGateway(
      "GET",
      `/v1/travel/orders/${orderId}`,
      token,
      { headers: { "x-city-id": "some-other-city" } },
    );
    expect(mismatch.status).toBe(403);
    expect(mismatch.body.code).toBe("forbidden");
    expect(mismatch.body.details).toMatchObject({ reason: "city_mismatch" });

    const agreeing = await viaGateway(
      "GET",
      `/v1/travel/orders/${orderId}`,
      token,
      { headers: { "x-city-id": cityId } },
    );
    expect(agreeing.status).toBe(200);
  });

  it("in production lets a verified session edit its own cart, and stops a limited-mode session at the gateway", async () => {
    const cityId = await seedCity(db);
    await seedBookableFlight();
    const userId = uid("usr");
    const { deps } = makeDeps(db);
    const cart = await createCart(deps, {
      actor: { id: userId, role: "rider" },
      cityId,
      items: [
        { kind: "flight", offerRef: "AP-P4-7120", fareFamilyId: "saver" },
      ],
      idempotencyKey: idemKey(),
      correlationId: null,
    });
    production();
    const passengers = [
      {
        givenNames: "Amaka",
        surname: "Obi",
        dateOfBirth: "1990-01-01",
        phone: "+2348000000000",
      },
    ];

    const limited = await viaGateway(
      "PUT",
      `/v1/travel/carts/${cart.id}/passengers`,
      clientToken({ sub: userId, role: "rider", cityId, mode: "limited" }),
      { body: passengers },
    );
    expect(limited.status).toBe(403);
    expect(gatewayCode(limited.body)).toBe("limited_mode");
    expect(
      (await db.travelCart.findUniqueOrThrow({ where: { id: cart.id } }))
        .passengers,
    ).toBeNull();

    const verified = await viaGateway(
      "PUT",
      `/v1/travel/carts/${cart.id}/passengers`,
      clientToken({ sub: userId, role: "rider", cityId }),
      { body: passengers },
    );
    expect(verified.status).toBe(200);
    expect(
      (await db.travelCart.findUniqueOrThrow({ where: { id: cart.id } }))
        .passengers,
    ).toEqual(passengers);
  });

  it("in production opens the ops console for an admin token — recording its action as that admin — and refuses a rider token", async () => {
    const cityId = await seedCity(db);
    const { orderId } = await confirmedOrder(cityId, uid("usr"));
    production();
    const adminId = uid("adm");
    const admin = clientToken({ sub: adminId, role: "admin" });

    const exceptions = await viaGateway(
      "GET",
      "/v1/ops/travel/exceptions",
      admin,
    );
    expect(exceptions.status).toBe(200);

    const charged = Number(
      (await db.travelOrder.findUniqueOrThrow({ where: { id: orderId } }))
        .chargedMinor,
    );
    const settled = await viaGateway(
      "POST",
      `/v1/ops/travel/orders/${orderId}/settlement`,
      admin,
      {
        // An admin token is bound to no city: the operating city is declared.
        headers: {
          "x-city-id": cityId,
          "x-user-id": "usr_someone_else",
          "idempotency-key": idemKey("settle"),
        },
        body: { invoicedMinor: charged - 5_000 },
      },
    );
    expect(settled.status).toBe(201);
    const event = await db.outboxEvent.findFirstOrThrow({
      where: { aggregateId: String(settled.body.settlementId) },
    });
    expect(event.actorId).toBe(adminId);
    expect(event.cityId).toBe(cityId);
    expect(event.payload).toMatchObject({
      cityProvenance: "operator_declared",
      cityDeclaredBy: adminId,
    });

    const rider = await viaGateway(
      "GET",
      "/v1/ops/travel/exceptions",
      clientToken({ sub: uid("usr"), role: "rider", cityId }),
    );
    expect(rider.status).toBe(403);
    expect(gatewayCode(rider.body)).toBe("forbidden");
  });

  it("never forwards a supplier webhook", async () => {
    production();
    const hook = await viaGateway(
      "POST",
      "/v1/travel/webhooks/sup_any",
      clientToken({ sub: uid("adm"), role: "admin" }),
      { body: {} },
    );
    expect(hook.status).toBe(404);
    expect(gatewayCode(hook.body)).toBe("NOT_FOUND");
    expect(await db.travelWebhook.count()).toBe(0);
  });
});

function production(): void {
  vi.stubEnv("NODE_ENV", "production");
}
