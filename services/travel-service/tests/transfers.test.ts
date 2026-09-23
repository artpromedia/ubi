/**
 * Airport transfers (P16 / recheck T03): intent → signed scheduled request on
 * ride-service → requester-approved award, with flight disruptions.
 *
 * Real Postgres (the transfer rows, the version guards, the outbox and the
 * dedupe index are enforced by the database) and the REAL HTTP ride port over
 * a socket against tests/ride-stub.ts, which verifies every call's signed
 * identity with ride-service's algorithm and validates the documented request
 * and response shapes. The flight order is booked through the real cart and
 * checkout flows (fixture supplier, fake payment port — see helpers.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/index";
import { parseRideContextKeys } from "../src/lib/ride-context";
import { createCart } from "../src/ops/carts";
import { checkout } from "../src/ops/checkout";
import { recordFlightStatus } from "../src/ops/flight-status";
import {
  advanceTransfer,
  runTransferSweep,
} from "../src/ops/transfer-orchestrator";
import {
  createTransfer,
  decideTransfer,
  getTransfer,
  type CreateTransferBody,
} from "../src/ops/transfers";
import { getLinked } from "../src/ops/trips";
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
  seedStaySupplier,
  testDb,
  uuidRider,
} from "./helpers";
import { startRideStub, type RideStub } from "./ride-stub";

import type { TravelDeps } from "../src/ops/context";
import type { JsonRecord } from "../src/ops/types";

const db = testDb();
const SECRET = "travel-transfer-test-key-0002,travel-transfer-test-key-0001";

// AP-P4-7120 (fixture catalog): LOS 05:45Z → ABV 07:00Z on 2026-09-12.
const LANDING = new Date("2026-09-12T07:00:00Z");
const DEPARTURE = new Date("2026-09-12T05:45:00Z");
const TWO_DAYS_BEFORE = new Date("2026-09-10T08:00:00Z");

let clock = TWO_DAYS_BEFORE;
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
  clock = TWO_DAYS_BEFORE;
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
});

function transferDeps(signingSecret = SECRET): TravelDeps {
  const rides = createHttpRidePort({
    baseUrl: stub.url,
    signingKeys: parseRideContextKeys(signingSecret),
  });
  return makeDeps(db, { rides, now }).deps;
}

async function bookFlight(
  deps: TravelDeps,
  actor: { id: string; role: string },
  cityId: string,
  bookOutcome: "confirmed" | "failed" = "confirmed",
): Promise<string> {
  await seedFlightSupplier(db, {
    control: { "AP-P4-7120#saver": { bookOutcome, pnr: "AP7QX2" } },
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
  return result.orders[0]?.id ?? "";
}

function arrivalBody(
  orderId: string,
  overrides: Partial<CreateTransferBody> = {},
): CreateTransferBody {
  return {
    linkedOrderId: orderId,
    legIndex: 0,
    direction: "arrival_pickup",
    airportPoint: { lat: 9.0068, lng: 7.2632, label: "ABV arrivals" },
    place: { lat: 9.0579, lng: 7.4951, label: "Hotel" },
    vehicleClass: "go",
    maxFareMinor: { amountMinor: 1_500_000, currency: "NGN" },
    paymentMethodId: "wallet",
    ...overrides,
  };
}

interface Setup {
  readonly deps: TravelDeps;
  readonly actor: { id: string; role: string };
  readonly cityId: string;
  readonly orderId: string;
}

async function setup(flags?: Record<string, boolean>): Promise<Setup> {
  const cityId = await seedCity(db, {
    marketplace: true,
    ...(flags === undefined ? {} : { flags }),
  });
  const deps = transferDeps();
  const actor = uuidRider();
  const orderId = await bookFlight(deps, actor, cityId);
  return { deps, actor, cityId, orderId };
}

async function create(
  s: Setup,
  body: CreateTransferBody = arrivalBody(s.orderId),
  key = idemKey("trf"),
): Promise<string> {
  const answer = await createTransfer(s.deps, {
    actor: s.actor,
    cityId: s.cityId,
    body,
    idempotencyKey: key,
    correlationId: null,
  });
  return String(answer.body.transferId);
}

async function row(transferId: string) {
  const found = await db.airportTransfer.findUnique({
    where: { id: transferId },
  });
  if (found === null) throw new Error("no transfer");
  return found;
}

async function requested(
  s: Setup,
  body?: CreateTransferBody,
): Promise<{ transferId: string; srId: string }> {
  const transferId = await create(s, body);
  await advanceTransfer(s.deps, transferId);
  const current = await row(transferId);
  expect(current.state).toBe("requested");
  return { transferId, srId: current.scheduledRequestId as string };
}

async function events(transferId: string): Promise<string[]> {
  const rows = await db.outboxEvent.findMany({
    where: { aggregateId: transferId },
    orderBy: [{ occurredAt: "asc" }, { toVersion: "asc" }],
  });
  return rows.map((event) => event.name);
}

/** The outbox rows of one event name for a transfer, oldest first. */
async function eventRows(transferId: string, name: string) {
  return db.outboxEvent.findMany({
    where: { aggregateId: transferId, name },
    orderBy: [{ occurredAt: "asc" }, { toVersion: "asc" }],
  });
}

/**
 * The flight ACTION REQUIRED announcement (reservation.pickup_moved): the
 * reason code and the choice keys, never the copy.
 */
async function actionEvents(transferId: string) {
  return (await eventRows(transferId, "reservation.pickup_moved")).map(
    (event) => ({
      actorType: event.actorType,
      actorId: event.actorId,
      payload: event.payload as JsonRecord,
    }),
  );
}

const CREATE = "POST /v1/mp/scheduled-requests";
const CANCEL_SCHEDULED = /^POST \/v1\/mp\/scheduled-requests\/[^/]+\/cancel$/;
const CANCEL_REQUEST = /^POST \/v1\/mp\/requests\/[^/]+\/cancel$/;

// ---------------------------------------------------------------------------

describe("creating a transfer intent", () => {
  it("refuses a stay order: a transfer links to a FLIGHT order only", async () => {
    const cityId = await seedCity(db, { marketplace: true });
    const deps = transferDeps();
    const actor = uuidRider();
    await seedStaySupplier(db);
    const cart = await createCart(deps, {
      actor,
      cityId,
      items: [
        { kind: "stay", offerRef: "transcorp-king", rateId: "transcorp-king" },
      ],
      idempotencyKey: idemKey(),
      correlationId: null,
    });
    const booked = await checkout(deps, {
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
    if (booked.kind !== "ok") throw new Error("expected a booked stay");
    const stayOrderId = booked.orders[0]?.id ?? "";
    const stay = await db.travelOrder.findUnique({
      where: { id: stayOrderId },
    });
    expect(stay?.kind).toBe("stay");
    expect(["confirmed", "ticketed"]).toContain(stay?.state);

    await expect(
      createTransfer(deps, {
        actor,
        cityId,
        body: arrivalBody(stayOrderId),
        idempotencyKey: idemKey(),
        correlationId: null,
      }),
    ).rejects.toMatchObject({
      code: "validation_failed",
      details: { reason: "linked_order_not_flight" },
    });
    expect(await db.airportTransfer.count()).toBe(0);
    expect(stub.calls).toHaveLength(0);
  });

  it("refuses a flight that is not booked", async () => {
    const cityId = await seedCity(db, { marketplace: true });
    const deps = transferDeps();
    const actor = uuidRider();
    const failedOrder = await bookFlight(deps, actor, cityId, "failed");
    await expect(
      createTransfer(deps, {
        actor,
        cityId,
        body: arrivalBody(failedOrder),
        idempotencyKey: idemKey(),
        correlationId: null,
      }),
    ).rejects.toMatchObject({
      code: "conflict",
      details: { reason: "flight_not_booked" },
    });
    expect(await db.airportTransfer.count()).toBe(0);
  });

  it("refuses another traveller's flight, another city's, and an ops principal", async () => {
    const { deps, actor, cityId, orderId: booked } = await setup();
    await expect(
      createTransfer(deps, {
        actor: uuidRider(),
        cityId,
        body: arrivalBody(booked),
        idempotencyKey: idemKey(),
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "not_found" });

    const otherCity = await seedCity(db, { marketplace: true });
    await expect(
      createTransfer(deps, {
        actor,
        cityId: otherCity,
        body: arrivalBody(booked),
        idempotencyKey: idemKey(),
        correlationId: null,
      }),
    ).rejects.toMatchObject({
      code: "validation_failed",
      details: { reason: "order_city_mismatch" },
    });

    // Ops can read transfers, never arrange one for a traveller.
    await expect(
      createTransfer(deps, {
        actor: opsActor(),
        cityId,
        body: arrivalBody(booked),
        idempotencyKey: idemKey(),
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await db.airportTransfer.count()).toBe(0);
  });

  it("derives the pickup window from the flight leg and stores an honest pending intent", async () => {
    const s = await setup();
    const answer = await createTransfer(s.deps, {
      actor: s.actor,
      cityId: s.cityId,
      body: arrivalBody(s.orderId),
      idempotencyKey: idemKey(),
      correlationId: null,
    });
    expect(answer.status).toBe(202);
    const view = answer.body;
    expect(view.status).toBe("pending_unassigned");
    expect(view.driverSecured).toBe(false);
    expect(String(view.statusLabel)).toContain("no driver");
    expect(JSON.stringify(view)).not.toMatch(
      /\breserved\b|confirmed transport|no charge/i,
    );
    // Landing 07:00Z + the city's 45-minute arrival buffer; a 10-minute window.
    expect(view.pickupWindow).toMatchObject({
      start: "2026-09-12T07:45:00.000Z",
      end: "2026-09-12T07:55:00.000Z",
      timeZone: "Africa/Lagos",
    });
    expect(view.airportCode).toBe("ABV");
    expect(view.approvedMaxFareMinor).toEqual({
      amountMinor: 1_500_000,
      currency: "NGN",
    });
    expect(String(view.policyVersion)).toMatch(
      /^airport-transfer\.v1\/cfg\.1\/mp\.3$/,
    );
    const terms = (view.terms as string[]).join(" ");
    expect(terms).toContain("No driver is secured until you choose");
    expect(terms).not.toMatch(/at no charge|only the ride is refunded/);
    expect(await events(String(view.transferId))).toEqual([
      "reservation.requested",
    ]);
  });

  it("is idempotent: a retry answers the stored result; a conflicting retry is 409 and never echoes the new values", async () => {
    const s = await setup();
    const key = idemKey("same");
    const first = await createTransfer(s.deps, {
      actor: s.actor,
      cityId: s.cityId,
      body: arrivalBody(s.orderId),
      idempotencyKey: key,
      correlationId: null,
    });
    const transferId = String(first.body.transferId);
    // The transfer moves on (a scheduled request is made)…
    await advanceTransfer(s.deps, transferId);
    expect((await row(transferId)).state).toBe("requested");
    // …yet the replay answers the immutable stored result.
    const replay = await createTransfer(s.deps, {
      actor: s.actor,
      cityId: s.cityId,
      body: arrivalBody(s.orderId),
      idempotencyKey: key,
      correlationId: null,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.body).toEqual(first.body);

    const conflicting = arrivalBody(s.orderId, {
      place: { lat: 9.1, lng: 7.4, label: "Somewhere else" },
      maxFareMinor: { amountMinor: 9_000_000, currency: "NGN" },
    });
    const refusal = await createTransfer(s.deps, {
      actor: s.actor,
      cityId: s.cityId,
      body: conflicting,
      idempotencyKey: key,
      correlationId: null,
    }).catch((error: unknown) => error);
    expect(refusal).toMatchObject({
      code: "idempotency_key_reuse",
      status: 409,
    });
    expect(JSON.stringify(refusal)).not.toContain("Somewhere else");
    const stored = await row(transferId);
    expect(Number(stored.maxFareMinor)).toBe(1_500_000);
    expect(await db.airportTransfer.count()).toBe(1);
    expect(stub.count(CREATE)).toBe(1);

    // Same over HTTP.
    const app = createApp(s.deps);
    const httpKey = idemKey("http");
    const post = (body: CreateTransferBody) =>
      app.request("/v1/reservations", {
        method: "POST",
        headers: headers(s.actor, s.cityId, { "Idempotency-Key": httpKey }),
        body: JSON.stringify(body),
      });
    const a = await post(arrivalBody(s.orderId));
    expect(a.status).toBe(202);
    const b = await post(arrivalBody(s.orderId));
    expect(b.status).toBe(202);
    expect(await b.json()).toEqual(await a.json());
    const c = await post(conflicting);
    expect(c.status).toBe(409);
    expect(((await c.json()) as JsonRecord).code).toBe("idempotency_key_reuse");
  });
});

describe("orchestration through ride-service's Book for Later", () => {
  it("waits as an intent until the market horizon, then makes a signed scheduled request as the traveller", async () => {
    clock = new Date("2026-08-01T08:00:00Z"); // 42 days before the flight
    const s = await setup();
    const transferId = await create(s);
    await runTransferSweep(s.deps);
    expect((await row(transferId)).state).toBe("pending_unassigned");
    // Nothing exists anywhere on ride-service days ahead: no driver's slot
    // can be held by this transfer.
    expect(stub.calls).toHaveLength(0);

    clock = new Date("2026-08-30T08:00:00Z"); // inside the 14-day horizon
    await runTransferSweep(s.deps);
    const current = await row(transferId);
    expect(current.state).toBe("requested");
    expect(stub.refusedIdentities).toHaveLength(0);
    const createCall = stub.calls.find(
      (call) => `${call.method} ${call.path}` === CREATE,
    );
    expect(createCall?.identity).toEqual({
      userId: s.actor.id,
      role: "rider",
      cityId: s.cityId,
    });
    expect(createCall?.idempotencyKey).toBe(`${transferId}:g1`);
    expect(createCall?.body).toMatchObject({
      requestedFareMinor: { amountMinor: 1_200_000, currency: "NGN" },
      maxFareMinor: { amountMinor: 1_500_000, currency: "NGN" },
      paymentMethodId: "wallet",
      schedule: {
        localDate: "2026-09-12",
        localTime: "08:45",
        timeZone: "Africa/Lagos",
        windowMinutes: 10,
      },
    });
    const sr = stub.scheduled.get(current.scheduledRequestId as string);
    // ride-service resolved the local time to exactly the derived instant,
    // and publishes only at its lead time before pickup.
    expect(sr?.pickupAt.toISOString()).toBe("2026-09-12T07:45:00.000Z");
    expect(sr?.publishAt.toISOString()).toBe("2026-09-12T07:15:00.000Z");
    expect(sr?.maxFareMinor).toBe(1_500_000);

    const view = await getTransfer(s.deps, s.actor, transferId);
    expect(view.driverSecured).toBe(false);
    expect(String(view.statusLabel)).toBe("Scheduled — no driver secured yet");
    expect(await events(transferId)).toEqual([
      "reservation.requested",
      "reservation.requested",
    ]);
  });

  it("never starts a ride for a flight booking cancelled while the intent waited for the horizon", async () => {
    clock = new Date("2026-08-01T08:00:00Z"); // 42 days before the flight
    const s = await setup();
    const transferId = await create(s);
    // The traveller cancels the flight booking itself (the order's own
    // servicing flow; the transfer is a separate order and is not touched).
    await db.travelOrder.update({
      where: { id: s.orderId },
      data: { state: "cancelled" },
    });
    clock = new Date("2026-08-30T08:00:00Z"); // inside the 14-day horizon
    await runTransferSweep(s.deps);
    const current = await row(transferId);
    expect(current.state).toBe("cancelled");
    expect((current.outcome as JsonRecord).reason).toBe("flight_cancelled");
    expect(stub.calls).toHaveLength(0);
  });

  it("derives a departure pickup from the routed drive time so it reaches the airport before check-in closes", async () => {
    const s = await setup();
    const { transferId } = await requested(s, {
      ...arrivalBody(s.orderId),
      direction: "departure_dropoff",
      airportPoint: { lat: 6.5774, lng: 3.3212, label: "LOS departures" },
      place: { lat: 6.4541, lng: 3.4218, label: "Home" },
    });
    const current = await row(transferId);
    // Departure 05:45Z − 60 min check-in cutoff − 30 min traffic = 04:15Z;
    // the window ends a 45-minute routed drive earlier.
    expect(current.arriveBy?.toISOString()).toBe("2026-09-12T04:15:00.000Z");
    expect(current.windowEnd?.toISOString()).toBe("2026-09-12T03:30:00.000Z");
    expect(current.pickupAt?.toISOString()).toBe("2026-09-12T03:20:00.000Z");
    expect(current.airportCode).toBe("LOS");
    expect(
      DEPARTURE.getTime() - (current.windowEnd as Date).getTime(),
    ).toBeGreaterThan(2_700_000);
  });

  it("is refused by ride-service's verifier when signed with a key it does not hold — and nothing is created", async () => {
    const cityId = await seedCity(db, { marketplace: true });
    const deps = transferDeps("a-key-ride-service-never-issued");
    const actor = uuidRider();
    const orderId = await bookFlight(deps, actor, cityId);
    const transferId = await create({ deps, actor, cityId, orderId });
    await advanceTransfer(deps, transferId);
    const current = await row(transferId);
    expect(current.state).toBe("pending_unassigned");
    expect(current.lastError).toContain("service_unavailable");
    expect(stub.refusedIdentities.length).toBeGreaterThan(0);
    expect(stub.refusedIdentities[0]?.status).toBe(401);
    expect(stub.scheduled.size).toBe(0);
  });

  it("reports awarded ONLY once ride-service reports the traveller's selected award", async () => {
    const s = await setup();
    const { transferId, srId } = await requested(s);
    stub.publish(srId);
    await advanceTransfer(s.deps, transferId);
    let current = await row(transferId);
    expect(current.state).toBe("requested");
    expect((await getTransfer(s.deps, s.actor, transferId)).statusLabel).toBe(
      "Sent to drivers — no driver secured yet",
    );

    stub.award(srId);
    await advanceTransfer(s.deps, transferId);
    current = await row(transferId);
    expect(current.state).toBe("awarded");
    expect(current.rideRequestId).toBe(stub.scheduled.get(srId)?.requestId);
    const view = await getTransfer(s.deps, s.actor, transferId);
    expect(view.driverSecured).toBe(true);
    expect(view.statusLabel).toBe("Driver secured");
    expect(await events(transferId)).toContain("reservation.assigned");

    const items = await getLinked(
      s.deps,
      s.actor,
      (await db.travelOrder.findUniqueOrThrow({ where: { id: s.orderId } }))
        .tripId as string,
    );
    const ride = items.find((item) => item.kind === "airport_transfer");
    expect(ride).toMatchObject({ status: "awarded", driverSecured: true });
    expect(items.some((item) => item.status === "reserved")).toBe(false);
  });

  it("fails honestly when no driver took it", async () => {
    const s = await setup();
    const { transferId, srId } = await requested(s);
    stub.publish(srId);
    stub.unfulfill(srId);
    await advanceTransfer(s.deps, transferId);
    const current = await row(transferId);
    expect(current.state).toBe("failed");
    const view = await getTransfer(s.deps, s.actor, transferId);
    expect(view.driverSecured).toBe(false);
    expect(view.outcome).toMatchObject({ reason: "no_driver_found" });
    expect(String(view.notice)).toContain("Nothing was charged for the ride");
    expect(String(view.notice)).toContain("flight booking is separate");
    expect(await events(transferId)).toContain(
      "reservation.reservation_failed",
    );
  });

  it("fails honestly when the pickup window passes with no award, withdrawing the live request", async () => {
    const s = await setup();
    const { transferId, srId } = await requested(s);
    stub.publish(srId);
    await advanceTransfer(s.deps, transferId);
    clock = new Date(LANDING.getTime() + 60 * 60_000); // past the 07:45–07:55 window
    await runTransferSweep(s.deps);
    const current = await row(transferId);
    expect(current.state).toBe("failed");
    expect((current.outcome as JsonRecord).reason).toBe("pickup_window_passed");
    expect(stub.count(CANCEL_REQUEST)).toBe(1);
    expect(stub.scheduled.get(srId)?.requestState).toBe("cancelled");
  });

  it("waits for the traveller when the fare now needs more than the approved limit, and sends nothing to drivers", async () => {
    const s = await setup();
    stub.terms = {
      ...stub.terms,
      minMinor: 1_800_000,
      suggestedMinor: 2_000_000,
    };
    const transferId = await create(s);
    await advanceTransfer(s.deps, transferId);
    let current = await row(transferId);
    expect(current.state).toBe("pending_unassigned");
    expect(stub.count(CREATE)).toBe(0);
    const action = current.actionRequired as JsonRecord;
    expect(action.reason).toBe("fare_above_approval");
    expect(action.minimumFareMinor).toEqual({
      amountMinor: 1_800_000,
      currency: "NGN",
    });
    expect(String(action.message)).toContain("NGN 18000.00");

    const approved = await decideTransfer(s.deps, {
      actor: s.actor,
      transferId,
      choice: "approve_limit",
      maxFareMinor: { amountMinor: 2_100_000, currency: "NGN" },
      idempotencyKey: idemKey(),
      correlationId: null,
    });
    expect(approved.body.status).toBe("requested");
    current = await row(transferId);
    expect(Number(current.maxFareMinor)).toBe(2_100_000);
    expect(
      stub.scheduled.get(current.scheduledRequestId as string)?.maxFareMinor,
    ).toBe(2_100_000);
  });
});

describe("flight disruptions", () => {
  async function delay(
    s: Setup,
    eventId: string,
    arriveAt: Date,
    observedAt = clock,
  ) {
    return recordFlightStatus(s.deps, {
      actor: opsActor(),
      source: "ops:airline_notice",
      eventId,
      orderId: s.orderId,
      legIndex: 0,
      status: "delayed",
      departAt: new Date(arriveAt.getTime() - 75 * 60_000),
      arriveAt,
      observedAt,
      correlationId: null,
    });
  }

  it("retimes exactly once before publication, keeping the approved limit, and ignores a duplicate event", async () => {
    const s = await setup();
    const { transferId, srId } = await requested(s);
    const newLanding = new Date(LANDING.getTime() + 2 * 3_600_000);

    const first = await delay(s, "evt-delay-1", newLanding);
    expect(first).toEqual({
      duplicate: false,
      applied: [{ transferId, outcome: "retime_pending" }],
    });
    const duplicate = await delay(s, "evt-delay-1", newLanding);
    expect(duplicate).toEqual({ duplicate: true, applied: [] });

    await runTransferSweep(s.deps);
    await runTransferSweep(s.deps);
    clock = new Date(clock.getTime() + 5 * 60_000);
    await runTransferSweep(s.deps);

    const current = await row(transferId);
    expect(current.state).toBe("requested");
    expect(current.retimedCount).toBe(1);
    expect(current.generation).toBe(2);
    expect(stub.count(CANCEL_SCHEDULED)).toBe(1);
    expect(stub.count(CREATE)).toBe(2);
    expect(stub.scheduled.get(srId)?.state).toBe("cancelled");
    const replacement = stub.scheduled.get(
      current.scheduledRequestId as string,
    );
    expect(replacement?.id).not.toBe(srId);
    expect(replacement?.pickupAt.toISOString()).toBe(
      "2026-09-12T09:45:00.000Z",
    );
    expect(replacement?.maxFareMinor).toBe(1_500_000);
    expect(current.pickupAt?.toISOString()).toBe("2026-09-12T09:45:00.000Z");
    expect(await db.travelFlightStatusEvent.count()).toBe(1);

    // An older observation arriving late changes nothing (monotonic).
    const stale = await delay(
      s,
      "evt-delay-0",
      new Date(LANDING.getTime() + 30 * 60_000),
      TWO_DAYS_BEFORE,
    );
    expect(stale.applied).toEqual([{ transferId, outcome: "ignored_stale" }]);
    expect((await row(transferId)).retimedCount).toBe(1);
    expect(
      (await events(transferId)).filter(
        (name) => name === "reservation.retimed",
      ),
    ).toHaveLength(1);
  });

  it("offers choices when drivers were already asked, instead of moving the live request", async () => {
    const s = await setup();
    const { transferId, srId } = await requested(s);
    stub.publish(srId); // travel has not read it back yet
    await delay(s, "evt-delay-pub", new Date(LANDING.getTime() + 3_600_000));
    await runTransferSweep(s.deps);
    const current = await row(transferId);
    expect(current.state).toBe("requested");
    expect(stub.count(CREATE)).toBe(1);
    expect(current.pickupAt?.toISOString()).toBe("2026-09-12T07:45:00.000Z");
    const action = current.actionRequired as JsonRecord;
    expect(action.reason).toBe("flight_changed_after_publication");
    expect(
      (action.choices as JsonRecord[]).map((choice) => choice.key),
    ).toEqual(["rerequest", "cancel", "keep"]);
    expect((action.proposal as JsonRecord).pickupAt).toBe(
      "2026-09-12T08:45:00.000Z",
    );
    // Nothing was retimed, so nothing is counted or announced as retimed.
    expect(current.retimedCount).toBe(0);
    expect(await events(transferId)).not.toContain("reservation.retimed");
    // The choice IS announced — once, by the orchestrator, with no driver
    // secured and no copy in the event.
    const announced = await actionEvents(transferId);
    expect(announced).toHaveLength(1);
    expect(announced[0]).toMatchObject({
      actorType: "system",
      actorId: "travel-service",
      payload: {
        transferId,
        state: "requested",
        driverSecured: false,
        actionRequired: "flight_changed_after_publication",
        choices: ["rerequest", "cancel", "keep"],
        proposal: { pickupAt: "2026-09-12T08:45:00.000Z" },
      },
    });
    expect(announced[0]?.payload).not.toHaveProperty("message");
    expect(
      await db.auditLog.count({
        where: {
          subjectId: transferId,
          action: "airport_transfer.choices_offered",
        },
      }),
    ).toBe(1);
  });

  it("announces the choice when drivers were asked before the retime could withdraw the old request — and restates it on the award", async () => {
    const s = await setup();
    const { transferId, srId } = await requested(s);
    // travel still believes nothing was published: the delay is a retime...
    const changed = await delay(
      s,
      "evt-retime-race",
      new Date(LANDING.getTime() + 2 * 3_600_000),
    );
    expect(changed.applied).toEqual([
      { transferId, outcome: "retime_pending" },
    ]);
    // ...but the traveller's selection won the race on ride-service.
    stub.publish(srId);
    stub.award(srId);
    await runTransferSweep(s.deps);

    const current = await row(transferId);
    expect(current.state).toBe("awarded");
    expect((current.actionRequired as JsonRecord).reason).toBe(
      "flight_changed_after_award",
    );
    expect(stub.scheduled.get(srId)?.requestState).toBe("awarded");
    // The choice was announced when it was offered (drivers were asked)...
    const announced = await actionEvents(transferId);
    expect(announced).toHaveLength(1);
    expect(announced[0]).toMatchObject({
      actorType: "system",
      payload: {
        state: "requested",
        driverSecured: false,
        actionRequired: "flight_changed_after_publication",
        choices: ["rerequest", "cancel", "keep"],
      },
    });
    // ...and the award that secured the ride restates it, with the choices
    // a secured ride has.
    const [assigned] = await eventRows(transferId, "reservation.assigned");
    expect(assigned?.payload).toMatchObject({
      state: "awarded",
      driverSecured: true,
      actionRequired: "flight_changed_after_award",
      choices: ["keep", "cancel", "rerequest"],
    });
  });

  it("after an award: never a silent change — the traveller keeps, cancels under the ride's rules, or re-requests", async () => {
    const s = await setup();
    const { transferId, srId } = await requested(s);
    stub.publish(srId);
    stub.award(srId);
    await advanceTransfer(s.deps, transferId);
    expect((await row(transferId)).state).toBe("awarded");
    const accepted = stub.scheduled.get(srId);
    const callsBefore = stub.calls.length;

    const changed = await delay(
      s,
      "evt-after-award",
      new Date(LANDING.getTime() + 2 * 3_600_000),
    );
    expect(changed.applied).toEqual([
      { transferId, outcome: "choices_offered" },
    ]);
    // Announced in the flight event's own transaction, as the operator who
    // recorded the verified status, with the driver still secured.
    const announced = await actionEvents(transferId);
    expect(announced).toHaveLength(1);
    expect(announced[0]).toMatchObject({
      actorType: "agent",
      payload: {
        state: "awarded",
        driverSecured: true,
        actionRequired: "flight_changed_after_award",
        choices: ["keep", "cancel", "rerequest"],
        flightEventId: "evt-after-award",
        flightStatus: "delayed",
      },
    });
    await runTransferSweep(s.deps);
    let current = await row(transferId);
    expect(current.state).toBe("awarded");
    expect(current.pickupAt?.toISOString()).toBe("2026-09-12T07:45:00.000Z");
    expect(current.retimedCount).toBe(0);
    // Only read-backs went to ride-service: nothing was cancelled, re-made or
    // re-priced, and the accepted terms are untouched.
    expect(
      stub.calls.slice(callsBefore).every((call) => call.method === "GET"),
    ).toBe(true);
    expect(stub.scheduled.get(srId)).toEqual(accepted);
    const view = await getTransfer(s.deps, s.actor, transferId);
    expect((view.actionRequired as JsonRecord).reason).toBe(
      "flight_changed_after_award",
    );
    expect(String(view.notice)).toContain("stay exactly as you accepted them");
    expect(String(view.notice)).toContain("a new driver is not guaranteed");
    // Re-requesting replaces the SECURED ride: its label says the current one
    // is cancelled under its own rules first.
    const rerequestChoice = (
      (view.actionRequired as JsonRecord).choices as JsonRecord[]
    ).find((choice) => choice.key === "rerequest");
    expect(String(rerequestChoice?.label)).toContain(
      "Cancel this ride under its own cancellation rules",
    );

    // Keep: nothing moves.
    clock = new Date(clock.getTime() + 60_000);
    const kept = await decideTransfer(s.deps, {
      actor: s.actor,
      transferId,
      choice: "keep",
      idempotencyKey: idemKey(),
      correlationId: null,
    });
    expect(kept.body).toMatchObject({
      status: "awarded",
      actionRequired: null,
    });
    expect(await events(transferId)).toContain("driver.kept");

    // A later change: cancelling is ride-service's call under its own rules.
    clock = new Date(clock.getTime() + 60_000);
    const later = await delay(
      s,
      "evt-after-award-2",
      new Date(LANDING.getTime() + 3 * 3_600_000),
    );
    expect(later.applied).toEqual([{ transferId, outcome: "choices_offered" }]);
    expect(await actionEvents(transferId)).toHaveLength(2);
    const refused = await decideTransfer(s.deps, {
      actor: s.actor,
      transferId,
      choice: "cancel",
      idempotencyKey: idemKey(),
      correlationId: null,
    }).catch((error: unknown) => error);
    expect(refused).toMatchObject({ code: "request_closed" });
    expect((await row(transferId)).state).toBe("awarded");

    // Re-request, where ride-service allows the cancellation: the old ride is
    // cancelled under its rules and a NEW scheduled request is made for the
    // new time with the same approved limit — no driver is promised.
    stub.awardedCancel = "allow";
    const key = idemKey("rereq");
    const rerequested = await decideTransfer(s.deps, {
      actor: s.actor,
      transferId,
      choice: "rerequest",
      idempotencyKey: key,
      correlationId: null,
    });
    expect(rerequested.body).toMatchObject({
      status: "requested",
      driverSecured: false,
    });
    current = await row(transferId);
    expect(current.scheduledRequestId).not.toBe(srId);
    const fresh = stub.scheduled.get(current.scheduledRequestId as string);
    expect(fresh?.pickupAt.toISOString()).toBe("2026-09-12T10:45:00.000Z");
    expect(fresh?.maxFareMinor).toBe(1_500_000);
    expect(stub.scheduled.get(srId)?.requestState).toBe("cancelled");
    // The action is idempotent: a replay answers the stored result.
    const replay = await decideTransfer(s.deps, {
      actor: s.actor,
      transferId,
      choice: "rerequest",
      idempotencyKey: key,
      correlationId: null,
    });
    expect(replay.replayed).toBe(true);
    expect(stub.count(CREATE)).toBe(2);
  });

  it("a cancelled flight withdraws a not-yet-secured ride for free, but never cancels a secured one", async () => {
    const s = await setup();
    const pending = await requested(s);
    const secured = await requested(s);
    stub.publish(secured.srId);
    stub.award(secured.srId);
    await advanceTransfer(s.deps, secured.transferId);

    const result = await recordFlightStatus(s.deps, {
      actor: opsActor(),
      source: "ops:airline_notice",
      eventId: "evt-cancel",
      orderId: s.orderId,
      legIndex: 0,
      status: "cancelled",
      departAt: null,
      arriveAt: null,
      observedAt: clock,
      correlationId: null,
    });
    expect(result.applied).toEqual([
      { transferId: pending.transferId, outcome: "cancel_pending" },
      { transferId: secured.transferId, outcome: "choices_offered" },
    ]);
    await runTransferSweep(s.deps);
    const withdrawn = await row(pending.transferId);
    expect(withdrawn.state).toBe("cancelled");
    expect((withdrawn.outcome as JsonRecord).reason).toBe("flight_cancelled");
    expect(stub.scheduled.get(pending.srId)?.state).toBe("cancelled");
    const kept = await row(secured.transferId);
    expect(kept.state).toBe("awarded");
    expect((kept.actionRequired as JsonRecord).reason).toBe("flight_cancelled");
    expect(stub.scheduled.get(secured.srId)?.requestState).toBe("awarded");
    // Only the secured ride asks the traveller anything.
    const announced = await actionEvents(secured.transferId);
    expect(announced).toHaveLength(1);
    expect(announced[0]?.payload).toMatchObject({
      actionRequired: "flight_cancelled",
      choices: ["cancel", "keep"],
      driverSecured: true,
    });
    expect(await actionEvents(pending.transferId)).toHaveLength(0);
  });
});

describe("cancellation races", () => {
  it("cancels the published request when ride-service published it before the cancel arrived", async () => {
    const s = await setup();
    const { transferId, srId } = await requested(s);
    stub.publish(srId); // travel still believes it is unpublished
    const answer = await decideTransfer(s.deps, {
      actor: s.actor,
      transferId,
      choice: "cancel",
      idempotencyKey: idemKey(),
      correlationId: null,
    });
    expect(answer.body).toMatchObject({
      status: "cancelled",
      driverSecured: false,
    });
    expect((answer.body.outcome as JsonRecord).reason).toBe(
      "cancelled_by_traveller",
    );
    expect(stub.count(CANCEL_SCHEDULED)).toBe(1);
    expect(stub.count(CANCEL_REQUEST)).toBe(1);
    expect(stub.scheduled.get(srId)?.requestState).toBe("cancelled");
  });

  it("reports the award honestly when the traveller's selection won the race", async () => {
    const s = await setup();
    const { transferId, srId } = await requested(s);
    stub.publish(srId);
    stub.award(srId);
    const refusal = await decideTransfer(s.deps, {
      actor: s.actor,
      transferId,
      choice: "cancel",
      idempotencyKey: idemKey(),
      correlationId: null,
    }).catch((error: unknown) => error);
    expect(refusal).toMatchObject({
      code: "conflict",
      details: { reason: "driver_secured" },
    });
    const current = await row(transferId);
    expect(current.state).toBe("awarded");
    expect(stub.scheduled.get(srId)?.requestState).toBe("awarded");
  });
});

describe("the deny-by-default reservations flag", () => {
  it("refuses every transfer route while the flag is off (or has no rule)", async () => {
    const s = await setup();
    const transferId = await create(s);
    const flagSets: Record<string, boolean>[] = [{ reservations: false }, {}];
    for (const flags of flagSets) {
      const cityId = await seedCity(db, { marketplace: true, flags });
      const app = createApp(s.deps);
      const hdrs = headers(s.actor, cityId, { "Idempotency-Key": idemKey() });
      const responses = await Promise.all([
        app.request("/v1/reservations", {
          method: "POST",
          headers: hdrs,
          body: JSON.stringify(arrivalBody(s.orderId)),
        }),
        app.request("/v1/reservations", { headers: hdrs }),
        app.request(`/v1/reservations/${transferId}`, { headers: hdrs }),
        app.request(`/v1/reservations/${transferId}/cancel`, {
          method: "POST",
          headers: hdrs,
        }),
        app.request(`/v1/reservations/${transferId}/decision`, {
          method: "POST",
          headers: hdrs,
          body: JSON.stringify({ choice: "keep" }),
        }),
      ]);
      for (const response of responses) {
        expect(response.status).toBe(404);
        expect(((await response.json()) as JsonRecord).code).toBe(
          "feature_disabled",
        );
      }
    }
    expect((await row(transferId)).state).not.toBe("cancelled");
  });

  it("switching the flag off stops NEW ride requests: an intent never sent is closed honestly", async () => {
    clock = new Date("2026-08-01T08:00:00Z");
    const s = await setup();
    const transferId = await create(s);
    await db.flagRule.updateMany({
      where: { flagKey: "reservations", cityId: s.cityId },
      data: { enabled: false },
    });
    clock = new Date("2026-08-30T08:00:00Z");
    await runTransferSweep(s.deps);
    const current = await row(transferId);
    expect(current.state).toBe("failed");
    expect((current.outcome as JsonRecord).reason).toBe("market_unavailable");
    expect(stub.calls).toHaveLength(0);
  });

  it("serves the routes when the flag is on: create, kick, read", async () => {
    const s = await setup();
    const app = createApp(s.deps);
    const response = await app.request("/v1/reservations", {
      method: "POST",
      headers: headers(s.actor, s.cityId, { "Idempotency-Key": idemKey() }),
      body: JSON.stringify(arrivalBody(s.orderId)),
    });
    expect(response.status).toBe(202);
    const created = (await response.json()) as JsonRecord;
    expect(created.status).toBe("pending_unassigned");
    const read = await app.request(
      `/v1/reservations/${String(created.transferId)}`,
      {
        headers: headers(s.actor, s.cityId),
      },
    );
    expect(read.status).toBe(200);
    expect(((await read.json()) as JsonRecord).status).toBe("requested");

    // A body may not smuggle a pickup time, a user or a fare bound.
    const smuggled = await app.request("/v1/reservations", {
      method: "POST",
      headers: headers(s.actor, s.cityId, { "Idempotency-Key": idemKey() }),
      body: JSON.stringify({
        ...arrivalBody(s.orderId),
        pickupAt: "2026-09-12T06:00:00Z",
      }),
    });
    expect(smuggled.status).toBe(422);
  });

  it("records verified flight status through the ops console, once", async () => {
    const s = await setup();
    const { transferId } = await requested(s);
    const app = createApp(s.deps);
    const ops = opsActor();
    const body = JSON.stringify({
      eventId: "airline-notice-77",
      orderId: s.orderId,
      legIndex: 0,
      status: "delayed",
      arriveAt: new Date(LANDING.getTime() + 3_600_000).toISOString(),
      observedAt: clock.toISOString(),
      source: "airline_notice",
    });
    const first = await app.request("/v1/ops/travel/flight-status", {
      method: "POST",
      headers: headers(ops, s.cityId),
      body,
    });
    expect(first.status).toBe(201);
    const again = await app.request("/v1/ops/travel/flight-status", {
      method: "POST",
      headers: headers(ops, s.cityId),
      body,
    });
    expect(again.status).toBe(200);
    expect(((await again.json()) as JsonRecord).duplicate).toBe(true);
    const traveller = await app.request("/v1/ops/travel/flight-status", {
      method: "POST",
      headers: headers(s.actor, s.cityId),
      body,
    });
    expect(traveller.status).toBe(403);
    // The first delivery already carried the retime to ride-service.
    const current = await row(transferId);
    expect(current.retimedCount).toBe(1);
    expect(current.pickupAt?.toISOString()).toBe("2026-09-12T08:45:00.000Z");
  });
});
