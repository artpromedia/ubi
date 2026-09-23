/**
 * Airport transfers — who travel-service may sign for, and read-back
 * robustness (verifier fixes on P16).
 *
 * travel-service re-signs the transfer's traveller identity for ride-service
 * (lib/ride-context.ts), so the transfer routes must only ever act on what the
 * GATEWAY proved: the signed `x-ubi-identity` context (required in production)
 * whose claims beat any plain mirror, a verified city that a client-declared
 * `X-City-ID` cannot override, and the gateway's `mp:request` scope for every
 * action that makes or cancels a ride (limited mode strips it, exactly as it
 * denies `/v1/mp` at the edge). The context is minted by the REAL gateway
 * signer (services/api-gateway/src/identity/context.ts), so an issuer/verifier
 * drift turns this file red.
 *
 * Also: ride-service's needs_rider_approval hand-off (refreshed terms above the
 * approved maximum) and a bare 404 on read-back that must not be mistaken for
 * "no such ride". Real Postgres and the real HTTP ride port against
 * tests/ride-stub.ts, as in transfers.test.ts.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { randomUUID } from "node:crypto";

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

import { signIdentityContext } from "../../api-gateway/src/identity/context";
import { createApp } from "../src/index";
import { parseRideContextKeys } from "../src/lib/ride-context";
import { createCart } from "../src/ops/carts";
import { checkout } from "../src/ops/checkout";
import { advanceTransfer } from "../src/ops/transfer-orchestrator";
import {
  createTransfer,
  decideTransfer,
  type CreateTransferBody,
} from "../src/ops/transfers";
import { createHttpRidePort } from "../src/ports/ride-port";

import {
  closeTestDb,
  headers,
  idemKey,
  makeDeps,
  opsActor,
  resetTravel,
  seedCity,
  seedFlightSupplier,
  testDb,
  uuidRider,
} from "./helpers";
import { startRideStub, type RideStub } from "./ride-stub";

import type { Scope } from "../../api-gateway/src/identity/scopes";
import type { TravelDeps } from "../src/ops/context";
import type { JsonRecord } from "../src/ops/types";

const db = testDb();
const SECRET = "travel-transfer-test-key-0002";
const IDENTITY_SECRET = "travel-identity-context-test-internal-secret-01";
const RIDER_SCOPES = ["profile:read", "ride:read", "mp:request"] as const;
const LIMITED_SCOPES = ["profile:read", "ride:read"] as const;

let clock = new Date("2026-09-10T08:00:00Z");
const now = (): Date => clock;
let stub: RideStub;

beforeAll(async () => {
  stub = await startRideStub({
    secret: SECRET,
    now,
    policy: {
      timeZone: "Africa/Lagos",
      currency: "NGN",
      minLeadSec: 3_600,
      maxHorizonSec: 1_209_600,
      publishLeadSec: 1_800,
      minWindowSec: 300,
      maxWindowSec: 1_800,
    },
  });
});

afterAll(async () => {
  await stub.close();
  await closeTestDb();
});

beforeEach(async () => {
  await resetTravel(db);
  clock = new Date("2026-09-10T08:00:00Z");
  stub.scheduled.clear();
  stub.calls.length = 0;
  stub.refusedIdentities.length = 0;
  stub.terms = {
    suggestedMinor: 1_200_000,
    minMinor: 900_000,
    maxMinor: 2_400_000,
    routedDurationSec: 2_700,
  };
  stub.awardedCancel = "refuse";
  vi.stubEnv("UBI_IDENTITY_SECRET", IDENTITY_SECRET);
  vi.stubEnv("UBI_IDENTITY_KEY_ID", "test-k1");
  vi.stubEnv("JWT_SECRET", "travel-identity-context-test-client-secret-01");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function transferDeps(): TravelDeps {
  const rides = createHttpRidePort({
    baseUrl: stub.url,
    signingKeys: parseRideContextKeys(SECRET),
  });
  return makeDeps(db, { rides, now }).deps;
}

interface Setup {
  readonly deps: TravelDeps;
  readonly actor: { id: string; role: string };
  readonly cityId: string;
  readonly orderId: string;
}

async function setup(): Promise<Setup> {
  const cityId = await seedCity(db, { marketplace: true });
  const deps = transferDeps();
  const actor = uuidRider();
  await seedFlightSupplier(db, {
    control: {
      "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" },
    },
  });
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
  if (result.kind !== "ok") throw new Error("expected a booked order");
  return { deps, actor, cityId, orderId: result.orders[0]?.id ?? "" };
}

function arrivalBody(orderId: string): CreateTransferBody {
  return {
    linkedOrderId: orderId,
    legIndex: 0,
    direction: "arrival_pickup",
    airportPoint: { lat: 9.0068, lng: 7.2632, label: "ABV arrivals" },
    place: { lat: 9.0579, lng: 7.4951, label: "Hotel" },
    vehicleClass: "go",
    maxFareMinor: { amountMinor: 1_500_000, currency: "NGN" },
    paymentMethodId: "wallet",
  };
}

async function signed(
  userId: string,
  options: {
    readonly role?: string;
    readonly cityId?: string | null;
    readonly scopes?: readonly string[];
    readonly modes?: readonly string[];
  } = {},
): Promise<string> {
  return signIdentityContext({
    userId,
    role: options.role ?? "rider",
    scopes: [...(options.scopes ?? RIDER_SCOPES)] as Scope[],
    modes: [...(options.modes ?? [])] as never[],
    cityId: options.cityId === undefined ? null : options.cityId,
    tenantId: null,
    sessionId: null,
    deviceId: null,
    requestId: `req-${randomUUID()}`,
  });
}

// ---------------------------------------------------------------------------

describe("the transfer routes sign only what the gateway proved", () => {
  it("in production refuse the plain mirrors: nothing is created and ride-service is never called", async () => {
    const s = await setup();
    vi.stubEnv("NODE_ENV", "production");
    const app = createApp(s.deps);
    const create = await app.request("/v1/reservations", {
      method: "POST",
      headers: headers(s.actor, s.cityId, { "Idempotency-Key": idemKey() }),
      body: JSON.stringify(arrivalBody(s.orderId)),
    });
    expect(create.status).toBe(401);
    const list = await app.request("/v1/reservations", {
      headers: headers(s.actor, s.cityId),
    });
    expect(list.status).toBe(401);
    // The ops flight-status route drives ride calls signed as travellers:
    // the same rule applies to it.
    const flight = await app.request("/v1/ops/travel/flight-status", {
      method: "POST",
      headers: headers(opsActor(), s.cityId),
      body: JSON.stringify({
        eventId: "evt-prod-mirror",
        orderId: s.orderId,
        legIndex: 0,
        status: "cancelled",
        observedAt: clock.toISOString(),
      }),
    });
    expect(flight.status).toBe(401);
    expect(await db.airportTransfer.count()).toBe(0);
    expect(await db.travelFlightStatusEvent.count()).toBe(0);
    expect(stub.calls).toHaveLength(0);
  });

  it("in production act on the signed context: its user and city are what ride-service sees, whatever the mirrors say", async () => {
    const s = await setup();
    vi.stubEnv("NODE_ENV", "production");
    const app = createApp(s.deps);
    const token = await signed(s.actor.id, { cityId: s.cityId });
    // Forged mirrors (another user, an ops role) lose to the signed claims.
    const forged = { id: randomUUID(), role: "travel_ops" };
    const response = await app.request("/v1/reservations", {
      method: "POST",
      headers: {
        ...headers(forged, s.cityId, { "Idempotency-Key": idemKey() }),
        "x-ubi-identity": token,
      },
      body: JSON.stringify(arrivalBody(s.orderId)),
    });
    expect(response.status).toBe(202);
    const created = (await response.json()) as JsonRecord;
    const stored = await db.airportTransfer.findUniqueOrThrow({
      where: { id: String(created.transferId) },
    });
    expect(stored.userId).toBe(s.actor.id);
    expect(stored.cityId).toBe(s.cityId);
    const createCall = stub.calls.find(
      (call) =>
        `${call.method} ${call.path}` === "POST /v1/mp/scheduled-requests",
    );
    expect(createCall?.identity).toEqual({
      userId: s.actor.id,
      role: "rider",
      cityId: s.cityId,
    });
  });

  it("refuses a declared city that differs from the verified one, a tampered context, and a declared city alone in production", async () => {
    const s = await setup();
    const otherCity = await seedCity(db, { marketplace: true });
    const app = createApp(s.deps);
    const token = await signed(s.actor.id, { cityId: s.cityId });

    const mismatch = await app.request("/v1/reservations", {
      method: "POST",
      headers: {
        ...headers(s.actor, otherCity, { "Idempotency-Key": idemKey() }),
        "x-ubi-identity": token,
      },
      body: JSON.stringify(arrivalBody(s.orderId)),
    });
    expect(mismatch.status).toBe(403);
    expect(((await mismatch.json()) as JsonRecord).details).toMatchObject({
      reason: "city_mismatch",
    });

    const [head, payload] = token.split(".");
    const tampered = `${head}.${payload}.${"A".repeat(43)}`;
    const refused = await app.request("/v1/reservations", {
      method: "POST",
      headers: {
        ...headers(s.actor, s.cityId, { "Idempotency-Key": idemKey() }),
        "x-ubi-identity": tampered,
      },
      body: JSON.stringify(arrivalBody(s.orderId)),
    });
    expect(refused.status).toBe(401);

    // A context bound to no city: in production a client-declared city is
    // not enough to sign a ride identity for.
    vi.stubEnv("NODE_ENV", "production");
    const cityless = await signed(s.actor.id, { cityId: null });
    const declaredOnly = await app.request("/v1/reservations", {
      method: "POST",
      headers: {
        ...headers(s.actor, s.cityId, { "Idempotency-Key": idemKey() }),
        "x-ubi-identity": cityless,
      },
      body: JSON.stringify(arrivalBody(s.orderId)),
    });
    expect(declaredOnly.status).not.toBe(202);
    expect(((await declaredOnly.json()) as JsonRecord).code).toBe(
      "city_unsupported",
    );
    expect(await db.airportTransfer.count()).toBe(0);
    expect(stub.calls).toHaveLength(0);
  });

  it("keeps a limited-mode session (no mp:request) from making or cancelling a ride, while it can still read", async () => {
    const s = await setup();
    const app = createApp(s.deps);
    const transferId = String(
      (
        await createTransfer(s.deps, {
          actor: s.actor,
          cityId: s.cityId,
          body: arrivalBody(s.orderId),
          idempotencyKey: idemKey(),
          correlationId: null,
        })
      ).body.transferId,
    );
    const limited = await signed(s.actor.id, {
      cityId: s.cityId,
      scopes: LIMITED_SCOPES,
      modes: ["limited"],
    });
    const hdrs = {
      ...headers(s.actor, s.cityId, { "Idempotency-Key": idemKey() }),
      "x-ubi-identity": limited,
    };
    const create = await app.request("/v1/reservations", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify(arrivalBody(s.orderId)),
    });
    expect(create.status).toBe(403);
    expect(((await create.json()) as JsonRecord).code).toBe("limited_mode");
    const cancel = await app.request(`/v1/reservations/${transferId}/cancel`, {
      method: "POST",
      headers: hdrs,
    });
    expect(cancel.status).toBe(403);
    const read = await app.request(`/v1/reservations/${transferId}`, {
      headers: hdrs,
    });
    expect(read.status).toBe(200);
    expect(await db.airportTransfer.count()).toBe(1);
    expect(
      (
        await db.airportTransfer.findUniqueOrThrow({
          where: { id: transferId },
        })
      ).state,
    ).toBe("pending_unassigned");
  });

  it("accepts a signed ops context on the flight-status route in production, and refuses a signed rider", async () => {
    const s = await setup();
    vi.stubEnv("NODE_ENV", "production");
    const app = createApp(s.deps);
    const body = JSON.stringify({
      eventId: "evt-prod-signed",
      orderId: s.orderId,
      legIndex: 0,
      status: "delayed",
      arriveAt: new Date("2026-09-12T08:00:00Z").toISOString(),
      observedAt: clock.toISOString(),
    });
    const ops = opsActor();
    const rider = await app.request("/v1/ops/travel/flight-status", {
      method: "POST",
      headers: {
        // The mirrors claim ops; the signed context says rider — it wins.
        ...headers(ops, s.cityId),
        "x-ubi-identity": await signed(s.actor.id, { cityId: s.cityId }),
      },
      body,
    });
    expect(rider.status).toBe(403);
    const accepted = await app.request("/v1/ops/travel/flight-status", {
      method: "POST",
      headers: {
        ...headers(ops, s.cityId),
        "x-ubi-identity": await signed(ops.id, {
          role: "travel_ops",
          cityId: null,
          scopes: [],
        }),
      },
      body,
    });
    expect(accepted.status).toBe(201);
    expect(await db.travelFlightStatusEvent.count()).toBe(1);
  });
});

describe("reading ride-service back", () => {
  it("carries ride-service's needs_rider_approval to the traveller and their approval back, against the version shown", async () => {
    const s = await setup();
    const transferId = String(
      (
        await createTransfer(s.deps, {
          actor: s.actor,
          cityId: s.cityId,
          body: arrivalBody(s.orderId),
          idempotencyKey: idemKey(),
          correlationId: null,
        })
      ).body.transferId,
    );
    await advanceTransfer(s.deps, transferId);
    const requested = await db.airportTransfer.findUniqueOrThrow({
      where: { id: transferId },
    });
    const srId = requested.scheduledRequestId as string;
    // ride-service's refresh found a minimum above the approved 15,000.00.
    const shownVersion = stub.needsApproval(srId, 1_700_000).version;
    await advanceTransfer(s.deps, transferId);
    let current = await db.airportTransfer.findUniqueOrThrow({
      where: { id: transferId },
    });
    expect(current.state).toBe("requested");
    const action = current.actionRequired as JsonRecord;
    expect(action.reason).toBe("ride_needs_approval");
    expect(action.rideVersion).toBe(shownVersion);
    expect(
      (action.choices as JsonRecord[]).map((choice) => choice.key),
    ).toEqual(["approve_limit", "cancel"]);

    // Below the refreshed minimum: refused here, nothing sent.
    const low = await decideTransfer(s.deps, {
      actor: s.actor,
      transferId,
      choice: "approve_limit",
      maxFareMinor: { amountMinor: 1_600_000, currency: "NGN" },
      idempotencyKey: idemKey(),
      correlationId: null,
    }).catch((error: unknown) => error);
    expect(low).toMatchObject({ code: "fare_out_of_bounds" });

    const approved = await decideTransfer(s.deps, {
      actor: s.actor,
      transferId,
      choice: "approve_limit",
      maxFareMinor: { amountMinor: 1_800_000, currency: "NGN" },
      idempotencyKey: idemKey(),
      correlationId: null,
    });
    expect(approved.body).toMatchObject({
      status: "requested",
      driverSecured: false,
      actionRequired: null,
    });
    current = await db.airportTransfer.findUniqueOrThrow({
      where: { id: transferId },
    });
    expect(Number(current.maxFareMinor)).toBe(1_800_000);
    const approveCalls = stub.calls.filter((call) =>
      /\/approve$/.test(call.path),
    );
    expect(approveCalls).toHaveLength(1);
    expect(approveCalls[0]?.body).toEqual({
      expectedVersion: shownVersion,
      maxFareMinor: { amountMinor: 1_800_000, currency: "NGN" },
    });
    expect(stub.scheduled.get(srId)?.state).toBe("scheduled_unassigned");
  });

  it("does not mistake a bare 404 (no ride-service answer) for a missing ride: the transfer stays live", async () => {
    const s = await setup();
    const transferId = String(
      (
        await createTransfer(s.deps, {
          actor: s.actor,
          cityId: s.cityId,
          body: arrivalBody(s.orderId),
          idempotencyKey: idemKey(),
          correlationId: null,
        })
      ).body.transferId,
    );
    await advanceTransfer(s.deps, transferId);
    stub.failNext("GET /v1/mp/scheduled-requests/", {
      status: 404,
      body: "404 page not found",
    });
    clock = new Date(clock.getTime() + 2 * 60_000);
    await advanceTransfer(s.deps, transferId);
    let current = await db.airportTransfer.findUniqueOrThrow({
      where: { id: transferId },
    });
    expect(current.state).toBe("requested");
    expect(current.lastError).toContain("service_unavailable");

    // ride-service's own canonical not_found is an answer: no such ride.
    stub.scheduled.clear();
    clock = new Date(clock.getTime() + 10 * 60_000);
    await advanceTransfer(s.deps, transferId);
    current = await db.airportTransfer.findUniqueOrThrow({
      where: { id: transferId },
    });
    expect(current.state).toBe("failed");
    expect((current.outcome as JsonRecord).reason).toBe("ride_request_missing");
  });
});
