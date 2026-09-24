/**
 * Live-supplier flows end to end: checkout → booking → signed webhooks →
 * convergence, with real supplier rows (`duffel`, `nuitee`) whose adapters
 * make real HTTP calls to a local stub serving the official docs' example
 * payloads, a real Postgres, and the payment-service-shaped fake port.
 *
 * Covered: Duffel's timestamped signature (accept, bad signature, stale
 * timestamp, missing header) and LiteAPI's token; duplicate delivery; events
 * out of order converging to one end state with one capture; a supplier's
 * "creation failed" releasing the hold; the ambiguous booking that is looked
 * up (never re-booked) and later reconciled; a pre-call refusal failing the
 * order and releasing at once; an expired quote refused at checkout.
 *
 * This file sets TRAVEL_SECRET_* variables on purpose, so the turbo
 * env-declaration lint does not apply.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  computeDuffelSignature,
  parseDuffelEvent,
} from "../src/adapters/webhook-codecs";
import { createCart, setPassengers } from "../src/ops/carts";
import { checkout } from "../src/ops/checkout";
import { cancelOrder, getCancellationQuote } from "../src/ops/orders";
import { reconcileOrder } from "../src/ops/reconcile";
import {
  receiveSupplierWebhook,
  type WebhookOutcome,
} from "../src/ops/webhooks";

import {
  closeTestDb,
  idemKey,
  makeDeps,
  resetTravel,
  rider,
  seedCity,
  testDb,
  uid,
  type FakePayment,
} from "./helpers";
import { docPayload } from "./supplier-docs";
import { SupplierStub } from "./supplier-stub";

import type { TravelDeps } from "../src/ops/context";
import type { JsonRecord } from "../src/ops/types";

const db = testDb();
const stub = new SupplierStub();

const DUFFEL_TOKEN_ENV = "TRAVEL_SECRET_DUFFEL_WH_API";
const DUFFEL_HOOK_ENV = "TRAVEL_SECRET_DUFFEL_WH_HOOK";
const LITE_KEY_ENV = "TRAVEL_SECRET_LITE_WH_API";
const LITE_HOOK_ENV = "TRAVEL_SECRET_LITE_WH_HOOK";
const DUFFEL_WEBHOOK_SECRET = "54vFWvaSbbzYpxXPeB4YEw=="; // the guide's example secret
const LITE_WEBHOOK_TOKEN = "lite-dashboard-auth-token";

const OFFER_ID = "off_00009htYpSCXrwaB9DnUm0";
const DUFFEL_ORDER_ID = "ord_00009hthhsUZ8W4LxQgkjo";
const NOW = new Date("2020-01-17T10:20:00Z");

beforeAll(async () => {
  await stub.start();
  process.env[DUFFEL_TOKEN_ENV] = "duffel_test_wh";
  process.env[DUFFEL_HOOK_ENV] = DUFFEL_WEBHOOK_SECRET;
  process.env[LITE_KEY_ENV] = "sand_wh";
  process.env[LITE_HOOK_ENV] = LITE_WEBHOOK_TOKEN;
});
afterAll(async () => {
  for (const name of [
    DUFFEL_TOKEN_ENV,
    DUFFEL_HOOK_ENV,
    LITE_KEY_ENV,
    LITE_HOOK_ENV,
  ]) {
    delete process.env[name];
  }
  await stub.stop();
  await closeTestDb();
});
beforeEach(() => resetTravel(db));
afterEach(() => stub.reset());

// ---------------------------------------------------------------------------
// Duffel fixtures
// ---------------------------------------------------------------------------

async function seedDuffel(): Promise<string> {
  const id = uid("supDuffel");
  await db.travelSupplier.create({
    data: {
      id,
      kind: "flight",
      adapter: "duffel",
      enabled: true,
      config: {
        baseUrl: stub.url,
        secretRef: "duffel_wh_api",
        webhookSecretRef: "duffel_wh_hook",
        currency: "GBP",
        timeoutMs: 1_500,
        bookTimeoutMs: 1_500,
        webhookToleranceSec: 300,
      } as never,
    },
  });
  return id;
}

/** The docs order as Duffel would hold OUR booking: not cancelled, our metadata. */
function duffelOrder(
  ourRef: string,
  ticketed: boolean,
): Record<string, unknown> {
  const order = docPayload<{ data: Record<string, unknown> }>(
    "duffel/get-order.json",
  ).data;
  order.cancelled_at = null;
  order.cancellation = null;
  order.metadata = { ubi_order_ref: ourRef };
  // UBI books `instant` orders paid from the balance: nothing awaits payment.
  order.payment_status = {
    ...(order.payment_status as object),
    awaiting_payment: false,
  };
  if (!ticketed) {
    order.documents = [];
  }
  return order;
}

function serveOffer(): void {
  stub.on("GET", /^\/air\/offers\/off_/, () => ({
    status: 200,
    body: docPayload("duffel/get-offer.json"),
  }));
}

const PASSENGER: JsonRecord = {
  title: "mrs",
  givenNames: "Amelia",
  surname: "Earhart",
  gender: "f",
  email: "amelia@duffel.com",
  phone: "+442080160509",
  dateOfBirth: "1987-07-24",
};

async function duffelCheckout(
  deps: TravelDeps,
  cityId: string,
  passenger: JsonRecord = PASSENGER,
) {
  const actor = rider();
  serveOffer();
  const cart = await createCart(deps, {
    actor,
    cityId,
    items: [{ kind: "flight", offerRef: OFFER_ID, fareFamilyId: "fare" }],
    idempotencyKey: idemKey(),
    correlationId: null,
  });
  await setPassengers(deps, {
    actor,
    cartId: cart.id,
    passengers: [passenger],
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
  return { actor, cart, result };
}

function signedDuffel(
  event: Record<string, unknown>,
  at: Date = NOW,
  secret: string = DUFFEL_WEBHOOK_SECRET,
): { rawBody: string; header: string } {
  const rawBody = JSON.stringify(event);
  const t = String(Math.floor(at.getTime() / 1000));
  return {
    rawBody,
    header: `t=${t},v1=${computeDuffelSignature(secret, t, rawBody)}`,
  };
}

function duffelEvent(
  type: string,
  object: Record<string, unknown>,
  id = uid("wev"),
): Record<string, unknown> {
  // The general event shape from Duffel's Webhooks page, with the
  // documented data.object for this event type.
  const event = docPayload<Record<string, unknown>>(
    "duffel/webhook-event-shape.json",
  );
  return {
    ...event,
    id,
    type,
    live_mode: false,
    data: { object },
    idempotency_key: String(object.id ?? object.order_id ?? object.offer_id),
  };
}

async function deliverDuffel(
  deps: TravelDeps,
  supplierId: string,
  delivery: { rawBody: string; header: string | null },
): Promise<WebhookOutcome> {
  return receiveSupplierWebhook(deps, {
    supplierId,
    rawBody: delivery.rawBody,
    header: (name) =>
      name.toLowerCase() === "x-duffel-signature" ? delivery.header : null,
    cityId: null,
    parseEnvelope: () => {
      throw new Error("a live supplier never uses the fixture envelope");
    },
  });
}

async function orderOf(orderId: string) {
  return db.travelOrder.findUnique({ where: { id: orderId } });
}

// ---------------------------------------------------------------------------

describe("Duffel webhooks — signed, deduped, converged", () => {
  it("accepts a correctly signed order.created, looks the order up and converges (capture once, e-ticket once)", async () => {
    const cityId = await seedCity(db);
    const supplierId = await seedDuffel();
    const { deps, payment } = makeDeps(db, { now: () => NOW });
    stub.on("POST", /^\/air\/orders$/, () => ({
      status: 202,
      body: { data: { message: "accepted" } },
    }));

    const { result } = await duffelCheckout(deps, cityId);
    if (result.kind !== "ok") throw new Error("expected ok");
    const orderId = result.orders[0]?.id ?? "";
    expect(result.orders[0]?.state).toBe("supplier_pending");
    const stored = await orderOf(orderId);
    expect(stored?.cityId).toBe(cityId);
    expect(stored?.supplierOfferRef).toBe(OFFER_ID);

    stub.on("GET", /^\/air\/orders\/ord_/, () => ({
      status: 200,
      body: { data: duffelOrder(orderId, true) },
    }));
    const created = duffelEvent("order.created", {
      id: DUFFEL_ORDER_ID,
      offer_id: OFFER_ID,
    });
    const delivery = signedDuffel(created);
    const outcome = await deliverDuffel(deps, supplierId, delivery);
    expect(outcome).toEqual({ result: "processed", action: "ticketed" });

    const after = await orderOf(orderId);
    expect(after?.state).toBe("ticketed");
    expect(after?.supplierRefs).toMatchObject({
      pnr: "RZPNX8",
      orderRef: DUFFEL_ORDER_ID,
    });
    expect(Number(after?.chargedMinor)).toBe(4_500);
    expect(payment.appliedOps(orderId, "capture")).toBe(1);
    expect(await db.travelDocument.count({ where: { orderId } })).toBe(1);

    // The same delivery again (Duffel retries): a duplicate, a no-op.
    const again = await deliverDuffel(deps, supplierId, signedDuffel(created));
    expect(again).toEqual({ result: "duplicate" });
    // A later, different event about the same order converges to the same state.
    const changed = duffelEvent("air.order.changed", {
      order_id: DUFFEL_ORDER_ID,
    });
    const late = await deliverDuffel(deps, supplierId, signedDuffel(changed));
    expect(late).toEqual({ result: "processed", action: "already_resolved" });
    expect(payment.appliedOps(orderId, "capture")).toBe(1);
    expect(await db.travelDocument.count({ where: { orderId } })).toBe(1);

    const row = await db.travelWebhook.findFirst({
      where: { supplierId, externalId: created.id as string },
    });
    expect(row).toMatchObject({
      signatureOk: true,
      eventType: "order.created",
      objectRef: DUFFEL_ORDER_ID,
      outcome: "ticketed",
    });
  });

  it("converges events that arrive out of order — a newer ticketing event first, the older creation event late", async () => {
    const cityId = await seedCity(db);
    const supplierId = await seedDuffel();
    const { deps, payment } = makeDeps(db, { now: () => NOW });
    let ticketed = false;
    stub.on("POST", /^\/air\/orders$/, (request) => {
      const ref = (
        request.body as { data: { metadata: { ubi_order_ref: string } } }
      ).data.metadata.ubi_order_ref;
      return { status: 201, body: { data: duffelOrder(ref, false) } };
    });
    const { result } = await duffelCheckout(deps, cityId);
    if (result.kind !== "ok") throw new Error("expected ok");
    const orderId = result.orders[0]?.id ?? "";
    // Booked with a PNR, not yet ticketed: confirmed and captured.
    expect(result.orders[0]?.state).toBe("confirmed");
    stub.on("GET", /^\/air\/orders\/ord_/, () => ({
      status: 200,
      body: { data: duffelOrder(orderId, ticketed) },
    }));

    ticketed = true;
    const newer = duffelEvent("air.order.changed", {
      order_id: DUFFEL_ORDER_ID,
    });
    newer.created_at = "2020-01-17T10:19:00Z";
    const older = duffelEvent("order.created", {
      id: DUFFEL_ORDER_ID,
      offer_id: OFFER_ID,
    });
    older.created_at = "2020-01-17T10:10:00Z";

    expect(await deliverDuffel(deps, supplierId, signedDuffel(newer))).toEqual({
      result: "processed",
      action: "ticketed",
    });
    expect(await deliverDuffel(deps, supplierId, signedDuffel(older))).toEqual({
      result: "processed",
      action: "already_resolved",
    });

    const after = await orderOf(orderId);
    expect(after?.state).toBe("ticketed");
    expect(payment.appliedOps(orderId, "capture")).toBe(1);
    const events = await db.travelOrderEvent.findMany({
      where: { orderId },
      orderBy: { id: "asc" },
    });
    expect(events.map((event) => event.toState)).toEqual([
      "submitted",
      "confirmed",
      "ticketed",
    ]);
  });

  it("two events racing for one order converge once — one capture, one step each on the audit trail", async () => {
    const cityId = await seedCity(db);
    const supplierId = await seedDuffel();
    const { deps, payment } = makeDeps(db, { now: () => NOW });
    stub.on("POST", /^\/air\/orders$/, () => ({
      status: 202,
      body: { data: {} },
    }));
    const { actor, result } = await duffelCheckout(deps, cityId);
    if (result.kind !== "ok") throw new Error("expected ok");
    const orderId = result.orders[0]?.id ?? "";
    stub.on("GET", /^\/air\/orders\/ord_/, () => ({
      status: 200,
      body: { data: duffelOrder(orderId, true) },
    }));
    stub.on("GET", /^\/air\/orders$/, () => ({
      status: 200,
      body: { meta: { limit: 50 }, data: [duffelOrder(orderId, true)] },
    }));

    const created = duffelEvent("order.created", {
      id: DUFFEL_ORDER_ID,
      offer_id: OFFER_ID,
    });
    const retried = duffelEvent("order.created", {
      id: DUFFEL_ORDER_ID,
      offer_id: OFFER_ID,
    });
    await Promise.all([
      deliverDuffel(deps, supplierId, signedDuffel(created)),
      deliverDuffel(deps, supplierId, signedDuffel(retried)),
      reconcileOrder(deps, { actor, cityId, orderId, correlationId: null }),
    ]);

    expect((await orderOf(orderId))?.state).toBe("ticketed");
    expect(payment.appliedOps(orderId, "capture")).toBe(1);
    const steps = await db.travelOrderEvent.findMany({
      where: { orderId },
      orderBy: { id: "asc" },
    });
    expect(steps.map((step) => step.toState)).toEqual([
      "submitted",
      "supplier_pending",
      "confirmed",
      "ticketed",
    ]);
    expect(await db.travelDocument.count({ where: { orderId } })).toBe(1);
  });

  it("releases the hold when Duffel says the accepted booking failed (order.creation_failed)", async () => {
    const cityId = await seedCity(db);
    const supplierId = await seedDuffel();
    const { deps, payment } = makeDeps(db, { now: () => NOW });
    stub.on("POST", /^\/air\/orders$/, () => ({
      status: 202,
      body: { data: {} },
    }));
    const { result } = await duffelCheckout(deps, cityId);
    if (result.kind !== "ok") throw new Error("expected ok");
    const orderId = result.orders[0]?.id ?? "";

    // Duffel shows no order for the offer, and says the attempt failed.
    stub.on("GET", /^\/air\/orders$/, () => ({
      status: 200,
      body: { meta: { limit: 50 }, data: [] },
    }));
    const failed = duffelEvent("order.creation_failed", {
      offer_id: OFFER_ID,
      order_creation_attempted_at: "2020-01-17T10:19:00Z",
    });
    const outcome = await deliverDuffel(deps, supplierId, signedDuffel(failed));
    expect(outcome).toEqual({ result: "processed", action: "failed_released" });
    expect((await orderOf(orderId))?.state).toBe("failed_released");
    expect(payment.appliedOps(orderId, "release")).toBe(1);
    expect(payment.itemState(orderId)).toBe("released");
  });

  it.each([
    [
      "a wrong signature",
      (event: Record<string, unknown>) =>
        signedDuffel(event, NOW, "not-the-secret"),
      "signature_invalid",
    ],
    [
      "a stale timestamp (replayed later)",
      (event: Record<string, unknown>) =>
        signedDuffel(event, new Date(NOW.getTime() - 600_000)),
      "signature_timestamp_out_of_tolerance",
    ],
    [
      "no signature header",
      (event: Record<string, unknown>) => ({
        rawBody: JSON.stringify(event),
        header: null,
      }),
      "signature_missing",
    ],
  ] as const)(
    "rejects %s and advances nothing",
    async (_label, sign, reason) => {
      const cityId = await seedCity(db);
      const supplierId = await seedDuffel();
      const { deps, payment } = makeDeps(db, { now: () => NOW });
      stub.on("POST", /^\/air\/orders$/, () => ({
        status: 202,
        body: { data: {} },
      }));
      const { result } = await duffelCheckout(deps, cityId);
      if (result.kind !== "ok") throw new Error("expected ok");
      const orderId = result.orders[0]?.id ?? "";
      stub.on("GET", /^\/air\/orders\/ord_/, () => ({
        status: 200,
        body: { data: duffelOrder(orderId, true) },
      }));

      const event = duffelEvent("order.created", {
        id: DUFFEL_ORDER_ID,
        offer_id: OFFER_ID,
      });
      const outcome = await deliverDuffel(deps, supplierId, sign(event));
      expect(outcome).toEqual({ result: "rejected", reason });
      expect((await orderOf(orderId))?.state).toBe("supplier_pending");
      expect(payment.appliedOps(orderId, "capture")).toBe(0);
      // The claimed event id was not consumed: the genuine delivery still works.
      expect(
        await db.travelWebhook.count({
          where: { supplierId, externalId: event.id as string },
        }),
      ).toBe(0);
      const genuine = await deliverDuffel(
        deps,
        supplierId,
        signedDuffel(event),
      );
      expect(genuine).toEqual({ result: "processed", action: "ticketed" });
    },
  );
});

describe("Duffel booking at checkout — ambiguity and definitive refusals", () => {
  it("an ambiguous 500 is looked up, left reconciling with the hold in place, then reconciled — booked exactly once", async () => {
    const cityId = await seedCity(db);
    await seedDuffel();
    const { deps, payment } = makeDeps(db, { now: () => NOW });
    let visible = false;
    let bookedRef = "";
    stub.on("POST", /^\/air\/orders$/, (request) => {
      bookedRef = (
        request.body as { data: { metadata: { ubi_order_ref: string } } }
      ).data.metadata.ubi_order_ref;
      return {
        status: 500,
        body: {
          errors: [{ type: "api_error", code: "internal_server_error" }],
        },
      };
    });
    stub.on("GET", /^\/air\/orders$/, () => ({
      status: 200,
      body: {
        meta: { limit: 50 },
        data: visible ? [duffelOrder(bookedRef, false)] : [],
      },
    }));

    const { actor, result } = await duffelCheckout(deps, cityId);
    if (result.kind !== "ok") throw new Error("expected ok");
    const orderId = result.orders[0]?.id ?? "";
    expect(result.orders[0]?.state).toBe("unknown_reconciling");
    expect(payment.appliedOps(orderId, "authorize")).toBe(1);
    expect(payment.itemState(orderId)).toBe("authorized");

    // Hours later the order shows up at Duffel under our reference.
    visible = true;
    const reconciled = await reconcileOrder(deps, {
      actor,
      cityId,
      orderId,
      correlationId: null,
    });
    expect(reconciled.state).toBe("confirmed");
    expect(reconciled.supplierRefs).toMatchObject({
      pnr: "RZPNX8",
      orderRef: DUFFEL_ORDER_ID,
    });
    expect(payment.appliedOps(orderId, "capture")).toBe(1);
    // Never a second booking request.
    expect(stub.requestsTo("POST", /^\/air\/orders$/)).toHaveLength(1);
  });

  it("a refusal before any provider call fails the order definitively and releases the hold at once", async () => {
    const cityId = await seedCity(db);
    await seedDuffel();
    const { deps, payment } = makeDeps(db, { now: () => NOW });
    const { gender: _dropped, ...withoutGender } = PASSENGER;
    const { result } = await duffelCheckout(deps, cityId, withoutGender);
    if (result.kind !== "ok") throw new Error("expected ok");
    const orderId = result.orders[0]?.id ?? "";

    expect(result.orders[0]?.state).toBe("failed_released");
    expect(result.orders[0]?.released.amountMinor).toBe(4_500);
    expect(payment.appliedOps(orderId, "release")).toBe(1);
    expect(payment.itemState(orderId)).toBe("released");
    expect(stub.requestsTo("POST", /^\/air\/orders$/)).toHaveLength(0);
    const events = await db.travelOrderEvent.findMany({
      where: { orderId },
      orderBy: { id: "asc" },
    });
    expect(events.at(-1)?.detail).toMatchObject({
      reason: "passenger_invalid",
      providerCalled: false,
    });
  });

  it("an expired quote is surfaced at checkout and never authorized or booked", async () => {
    const cityId = await seedCity(db);
    await seedDuffel();
    let now = NOW;
    const { deps, payment } = makeDeps(db, { now: () => now });
    const actor = rider();
    serveOffer();
    const cart = await createCart(deps, {
      actor,
      cityId,
      items: [{ kind: "flight", offerRef: OFFER_ID, fareFamilyId: "fare" }],
      idempotencyKey: idemKey(),
      correlationId: null,
    });
    await setPassengers(deps, {
      actor,
      cartId: cart.id,
      passengers: [PASSENGER],
    });
    now = new Date("2020-01-17T10:45:00Z"); // after expires_at
    const result = await checkout(deps, {
      actor,
      cityId,
      cartId: cart.id,
      paymentMethodId: "wallet",
      grantId: "grant_test",
      assuranceMethod: null,
      // Even a matching total cannot buy an expired quote.
      expectedTotal: { amountMinor: 4_500, currency: "GBP" },
      idempotencyKey: idemKey(),
      correlationId: null,
    });
    expect(result.kind).toBe("repriced");
    expect(payment.countOp("authorize")).toBe(0);
    expect(stub.requestsTo("POST", /^\/air\/orders$/)).toHaveLength(0);
    expect(await db.travelOrder.count({ where: { cartId: cart.id } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// LiteAPI
// ---------------------------------------------------------------------------

async function seedLite(): Promise<string> {
  const id = uid("supLite");
  await db.travelSupplier.create({
    data: {
      id,
      kind: "stay",
      adapter: "nuitee",
      enabled: true,
      config: {
        baseUrl: stub.url,
        bookBaseUrl: stub.url,
        secretRef: "lite_wh_api",
        webhookSecretRef: "lite_wh_hook",
        currency: "USD",
        guestNationality: "US",
        countryCode: "US",
        paymentMethod: "ACC_CREDIT_CARD",
        timeoutMs: 1_500,
        bookTimeoutMs: 1_500,
      } as never,
    },
  });
  return id;
}

function prebook(): { data: Record<string, unknown> } {
  // The docs prebook minus the add-on/voucher UBI never requests (see
  // liteapi-contract.test.ts).
  const body = docPayload<{ data: Record<string, unknown> }>(
    "liteapi/prebook.json",
  );
  for (const key of [
    "addonsRequest",
    "voucherCode",
    "voucherTotalAmount",
    "addonsTotalAmount",
  ]) {
    delete body.data[key];
  }
  body.data.price = 163.66;
  return body;
}

async function liteCheckout(
  deps: TravelDeps,
  cityId: string,
  payment: FakePayment,
) {
  const actor = rider();
  stub.on("POST", /^\/rates\/prebook$/, () => ({
    status: 200,
    body: prebook(),
  }));
  const cart = await createCart(deps, {
    actor,
    cityId,
    items: [{ kind: "stay", offerRef: "lite_offer_1" }],
    idempotencyKey: idemKey(),
    correlationId: null,
  });
  await setPassengers(deps, {
    actor,
    cartId: cart.id,
    passengers: [
      {
        givenNames: "Steve",
        surname: "Doe",
        email: "s.doe@liteapi.travel",
        phone: "+2348012345678",
        dateOfBirth: "1990-01-01",
      },
    ],
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
  void payment;
  return { actor, result };
}

function liteEvent(
  eventName: string,
  request: Record<string, unknown>,
  response: Record<string, unknown>,
  sandbox = true,
) {
  // The guide's envelope: request/response are stringified JSON.
  const shape = docPayload<Record<string, unknown>>(
    "liteapi/webhook-event-shape.json",
  );
  return {
    ...shape,
    event_id: uid("evt"),
    event_name: eventName,
    request: JSON.stringify(request),
    response: JSON.stringify(response),
    sandbox,
  };
}

async function deliverLite(
  deps: TravelDeps,
  supplierId: string,
  event: Record<string, unknown>,
  token: string | null,
) {
  return receiveSupplierWebhook(deps, {
    supplierId,
    rawBody: JSON.stringify(event),
    header: (name) => (name.toLowerCase() === "authorization" ? token : null),
    cityId: null,
    parseEnvelope: () => {
      throw new Error("a live supplier never uses the fixture envelope");
    },
  });
}

describe("LiteAPI webhooks — shared token, converged by client reference", () => {
  it("resolves an ambiguous booking from a booking.book event by looking it up — never trusting the payload", async () => {
    const cityId = await seedCity(db);
    const supplierId = await seedLite();
    const { deps, payment } = makeDeps(db, {
      now: () => new Date("2026-06-01T09:00:00Z"),
    });
    let bookingVisible = false;
    stub.on("POST", /^\/rates\/book$/, () => ({
      status: 500,
      body: { error: { code: 5000, message: "unable to process request" } },
    }));
    stub.on("GET", /^\/bookings$/, (request) => {
      if (!bookingVisible) return { status: 200, body: { data: [] } };
      const booking = docPayload<{ data: Record<string, unknown> }>(
        "liteapi/get-booking-confirmed.json",
      ).data;
      return {
        status: 200,
        body: {
          data: [
            {
              ...booking,
              clientReference: request.query.get("clientReference"),
            },
          ],
        },
      };
    });

    const { result } = await liteCheckout(deps, cityId, payment);
    if (result.kind !== "ok") throw new Error("expected ok");
    const orderId = result.orders[0]?.id ?? "";
    expect(result.orders[0]?.state).toBe("unknown_reconciling");
    expect(stub.requestsTo("POST", /^\/rates\/book$/)).toHaveLength(1);

    // A wrong token is rejected and changes nothing.
    const event = liteEvent(
      "booking.book",
      { clientReference: orderId, prebookId: "zzWkJcdgk" },
      { bookingId: "hSq2gVDrf" },
    );
    expect(await deliverLite(deps, supplierId, event, "wrong-token")).toEqual({
      result: "rejected",
      reason: "signature_invalid",
    });
    expect((await orderOf(orderId))?.state).toBe("unknown_reconciling");

    bookingVisible = true;
    expect(
      await deliverLite(deps, supplierId, event, LITE_WEBHOOK_TOKEN),
    ).toEqual({ result: "processed", action: "confirmed" });
    const after = await orderOf(orderId);
    expect(after?.state).toBe("confirmed");
    expect(after?.supplierRefs).toMatchObject({ bookingRef: "hSq2gVDrf" });
    expect(payment.appliedOps(orderId, "capture")).toBe(1);
    expect(
      await db.travelDocument.count({
        where: { orderId, kind: "booking_confirmation" },
      }),
    ).toBe(1);
    expect(stub.requestsTo("POST", /^\/rates\/book$/)).toHaveLength(1);

    // Redelivery with the same event id: duplicate.
    expect(
      await deliverLite(deps, supplierId, event, LITE_WEBHOOK_TOKEN),
    ).toEqual({ result: "duplicate" });
  });

  it("never applies a live-mode event outside production, nor a flight event to a stay", async () => {
    const cityId = await seedCity(db);
    const supplierId = await seedLite();
    const { deps } = makeDeps(db, {
      now: () => new Date("2026-06-01T09:00:00Z"),
    });
    const live = liteEvent(
      "booking.book",
      { clientReference: "tord_x" },
      { bookingId: "b1" },
      false,
    );
    expect(
      await deliverLite(deps, supplierId, live, LITE_WEBHOOK_TOKEN),
    ).toEqual({ result: "processed", action: "mode_mismatch" });
    const flight = liteEvent(
      "flight.book.confirmed",
      { clientReference: "tord_y" },
      { bookingId: "f1" },
    );
    expect(
      await deliverLite(deps, supplierId, flight, LITE_WEBHOOK_TOKEN),
    ).toEqual({ result: "processed", action: "recorded" });
    void cityId;
  });
});

describe("final repricing consent against live suppliers", () => {
  it("Duffel: a moved price is surfaced, a bare retry is surfaced again, and only the echoed total books", async () => {
    const cityId = await seedCity(db);
    await seedDuffel();
    const { deps, payment } = makeDeps(db, { now: () => NOW });
    const actor = rider();
    let total = "45.00";
    stub.on("GET", /^\/air\/offers\/off_/, () => {
      const offer = docPayload<{ data: Record<string, unknown> }>(
        "duffel/get-offer.json",
      );
      offer.data.total_amount = total;
      return { status: 200, body: offer };
    });
    stub.on("POST", /^\/air\/orders$/, (request) => {
      const ref = (
        request.body as { data: { metadata: { ubi_order_ref: string } } }
      ).data.metadata.ubi_order_ref;
      return { status: 201, body: { data: duffelOrder(ref, false) } };
    });
    const cart = await createCart(deps, {
      actor,
      cityId,
      items: [{ kind: "flight", offerRef: OFFER_ID, fareFamilyId: "fare" }],
      idempotencyKey: idemKey(),
      correlationId: null,
    });
    await setPassengers(deps, {
      actor,
      cartId: cart.id,
      passengers: [PASSENGER],
    });
    const attempt = (expected: number | null) =>
      checkout(deps, {
        actor,
        cityId,
        cartId: cart.id,
        paymentMethodId: "wallet",
        grantId: "grant_test",
        assuranceMethod: null,
        expectedTotal:
          expected === null ? null : { amountMinor: expected, currency: "GBP" },
        idempotencyKey: idemKey(),
        correlationId: null,
      });

    total = "52.30"; // the airline moved the price after the cart was built
    const first = await attempt(null);
    expect(first.kind).toBe("repriced");
    if (first.kind === "repriced") {
      expect(first.cart.total).toEqual({ amountMinor: 5_230, currency: "GBP" });
      expect(first.cart.previousTotal).toEqual({
        amountMinor: 4_500,
        currency: "GBP",
      });
    }
    // Duffel does not flag a reprice itself, and the cart now shows 52.30 —
    // yet a retry without the total is still not consent.
    expect((await attempt(null)).kind).toBe("repriced");
    expect(payment.countOp("authorize")).toBe(0);
    expect(stub.requestsTo("POST", /^\/air\/orders$/)).toHaveLength(0);

    const accepted = await attempt(5_230);
    expect(accepted.kind).toBe("ok");
    const [booking] = stub.requestsTo("POST", /^\/air\/orders$/);
    expect(
      (booking?.body as { data: { payments: unknown[] } }).data.payments,
    ).toEqual([{ type: "balance", currency: "GBP", amount: "52.30" }]);
  });

  it("LiteAPI: changed terms must be shown before they can be agreed, even at the same price", async () => {
    const cityId = await seedCity(db);
    await seedLite();
    const { deps, payment } = makeDeps(db, {
      now: () => new Date("2026-06-01T09:00:00Z"),
    });
    const actor = rider();
    let cancellationChanged = false;
    stub.on("POST", /^\/rates\/prebook$/, () => {
      const body = prebook();
      body.data.cancellationChanged = cancellationChanged;
      return { status: 200, body };
    });
    stub.on("POST", /^\/rates\/book$/, (request) => {
      const booking = docPayload<{ data: Record<string, unknown> }>(
        "liteapi/book.json",
      );
      booking.data.clientReference = (
        request.body as { clientReference: string }
      ).clientReference;
      return { status: 200, body: booking };
    });
    const cart = await createCart(deps, {
      actor,
      cityId,
      items: [{ kind: "stay", offerRef: "lite_offer_1" }],
      idempotencyKey: idemKey(),
      correlationId: null,
    });
    await setPassengers(deps, {
      actor,
      cartId: cart.id,
      passengers: [
        {
          givenNames: "Steve",
          surname: "Doe",
          email: "s.doe@liteapi.travel",
          phone: "+2348012345678",
          dateOfBirth: "1990-01-01",
        },
      ],
    });
    const attempt = () =>
      checkout(deps, {
        actor,
        cityId,
        cartId: cart.id,
        paymentMethodId: "wallet",
        grantId: "grant_test",
        assuranceMethod: null,
        expectedTotal: { amountMinor: 16_366, currency: "USD" },
        idempotencyKey: idemKey(),
        correlationId: null,
      });

    cancellationChanged = true;
    // Same price, echoed — but the new cancellation terms were never shown.
    expect((await attempt()).kind).toBe("repriced");
    expect(payment.countOp("authorize")).toBe(0);
    // Shown now (the cart carries them); the same echo is consent.
    const accepted = await attempt();
    expect(accepted.kind).toBe("ok");
    if (accepted.kind === "ok") {
      expect(accepted.orders[0]?.state).toBe("confirmed");
      expect(accepted.orders[0]?.charged).toEqual({
        amountMinor: 16_366,
        currency: "USD",
      });
      expect(accepted.orders[0]?.payAtProperty).toEqual({
        amountMinor: 4_361,
        currency: "USD",
      });
    }
  });
});

describe("Duffel cancellation end to end — penalty surfaced first", () => {
  it("quotes via a pending cancellation, refuses without consent, confirms the quoted one, and the confirmation webhook moves the refund", async () => {
    const cityId = await seedCity(db);
    const supplierId = await seedDuffel();
    const { deps } = makeDeps(db, { now: () => NOW });
    stub.on("POST", /^\/air\/orders$/, (request) => {
      const ref = (
        request.body as { data: { metadata: { ubi_order_ref: string } } }
      ).data.metadata.ubi_order_ref;
      return { status: 201, body: { data: duffelOrder(ref, true) } };
    });
    const { actor, result } = await duffelCheckout(deps, cityId);
    if (result.kind !== "ok") throw new Error("expected ok");
    const orderId = result.orders[0]?.id ?? "";
    expect(result.orders[0]?.state).toBe("ticketed");

    // The order as Duffel holds it (total 90.80 in the docs example) and a
    // pending cancellation that returns 60.80 of it to the balance.
    stub.on("GET", /^\/air\/orders\/ord_/, () => ({
      status: 200,
      body: { data: duffelOrder(orderId, true) },
    }));
    const pending = docPayload<{ data: Record<string, unknown> }>(
      "duffel/create-order-cancellation.json",
    );
    pending.data.refund_amount = "60.80";
    pending.data.refund_to = "balance";
    stub.on("POST", /^\/air\/order_cancellations$/, () => ({
      status: 201,
      body: pending,
    }));
    stub.on(
      "POST",
      /^\/air\/order_cancellations\/ore_[^/]+\/actions\/confirm$/,
      () => ({ status: 200, body: pending }),
    );

    const quote = await getCancellationQuote(deps, actor, orderId);
    expect(quote).toMatchObject({
      penalty: { amountMinor: 3_000, currency: "GBP" },
      consentRequired: true,
      quoteRef: "ore_00009qzZWzjDipIkqpaUAj",
      refundTo: "balance",
    });
    const refused = await cancelOrder(deps, {
      actor,
      cityId,
      orderId,
      idempotencyKey: idemKey(),
      correlationId: null,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toMatchObject({
      code: "conflict",
      details: {
        reason: "cancellation_penalty_consent_required",
        penalty: { amountMinor: 3_000 },
      },
    });
    expect(stub.requestsTo("POST", /actions\/confirm$/)).toHaveLength(0);
    expect((await orderOf(orderId))?.state).toBe("ticketed");

    const refund = await cancelOrder(deps, {
      actor,
      cityId,
      orderId,
      idempotencyKey: idemKey(),
      correlationId: null,
      acceptedPenalty: { amountMinor: 3_000, currency: "GBP" },
    });
    expect(stub.requestsTo("POST", /actions\/confirm$/)[0]?.path).toBe(
      "/air/order_cancellations/ore_00009qzZWzjDipIkqpaUAj/actions/confirm",
    );
    expect((await orderOf(orderId))?.state).toBe("cancelled");
    expect(refund).toMatchObject({
      stage: "requested",
      penalty: { amountMinor: 3_000 },
      amount: { amountMinor: 1_500 },
    });

    const confirmed = duffelEvent("order_cancellation.confirmed", {
      id: "ore_00009qzZWzjDipIkqpaUAj",
      order_id: DUFFEL_ORDER_ID,
    });
    expect(
      await deliverDuffel(deps, supplierId, signedDuffel(confirmed)),
    ).toEqual({
      result: "processed",
      action: "refund_supplier_confirmed",
    });
    const row = await db.travelRefund.findUnique({ where: { id: refund.id } });
    expect(row?.stage).toBe("supplier_confirmed");
  });
});

describe("verifier regressions — races, retries and consent", () => {
  it("a webhook that converges the order while the booking call is still answering leaves checkout a no-op — no 500, one capture, one step each", async () => {
    const cityId = await seedCity(db);
    const supplierId = await seedDuffel();
    const { deps, payment } = makeDeps(db, { now: () => NOW });
    let webhook: Promise<WebhookOutcome> | null = null;
    let bookedRef = "";
    stub.on("GET", /^\/air\/orders\/ord_/, () => ({
      status: 200,
      body: { data: duffelOrder(bookedRef, true) },
    }));
    stub.on("POST", /^\/air\/orders$/, (request) => {
      bookedRef = (
        request.body as { data: { metadata: { ubi_order_ref: string } } }
      ).data.metadata.ubi_order_ref;
      // Duffel fires order.created as the booking is made; it reaches us
      // before the 201 does.
      webhook = deliverDuffel(
        deps,
        supplierId,
        signedDuffel(
          duffelEvent("order.created", {
            id: DUFFEL_ORDER_ID,
            offer_id: OFFER_ID,
          }),
        ),
      );
      return {
        status: 201,
        body: { data: duffelOrder(bookedRef, true) },
        delayMs: 1_000,
      };
    });

    const { result } = await duffelCheckout(deps, cityId);
    if (result.kind !== "ok") throw new Error("expected ok");
    const orderId = result.orders[0]?.id ?? "";
    // The webhook, not checkout, moved the order: the race really happened.
    expect(webhook).not.toBeNull();
    expect(await webhook).toEqual({ result: "processed", action: "ticketed" });
    expect(result.orders[0]?.state).toBe("ticketed");

    expect(payment.appliedOps(orderId, "capture")).toBe(1);
    expect(await db.travelDocument.count({ where: { orderId } })).toBe(1);
    const steps = await db.travelOrderEvent.findMany({
      where: { orderId },
      orderBy: { id: "asc" },
    });
    const moves = steps.map((step) => step.toState);
    expect(moves.filter((state) => state === "confirmed")).toHaveLength(1);
    expect(moves.filter((state) => state === "ticketed")).toHaveLength(1);
    expect(stub.requestsTo("POST", /^\/air\/orders$/)).toHaveLength(1);
  });

  it("a webhook whose supplier lookup fails answers 503 and keeps no dedupe slot — Duffel's redelivery of the same event converges the order", async () => {
    const cityId = await seedCity(db);
    const supplierId = await seedDuffel();
    const { deps, payment } = makeDeps(db, { now: () => NOW });
    stub.on("POST", /^\/air\/orders$/, () => ({
      status: 202,
      body: { data: { message: "accepted" } },
    }));
    const { result } = await duffelCheckout(deps, cityId);
    if (result.kind !== "ok") throw new Error("expected ok");
    const orderId = result.orders[0]?.id ?? "";
    expect(result.orders[0]?.state).toBe("supplier_pending");

    let duffelUp = false;
    stub.on("GET", /^\/air\/orders\/ord_/, () =>
      duffelUp
        ? { status: 200, body: { data: duffelOrder(orderId, true) } }
        : {
            status: 500,
            body: {
              errors: [{ type: "api_error", code: "internal_server_error" }],
            },
          },
    );
    const created = duffelEvent("order.created", {
      id: DUFFEL_ORDER_ID,
      offer_id: OFFER_ID,
    });

    const first = await deliverDuffel(
      deps,
      supplierId,
      signedDuffel(created),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(first).toMatchObject({
      code: "service_unavailable",
      details: { retryable: true },
    });
    expect((await orderOf(orderId))?.state).toBe("supplier_pending");
    expect(
      await db.travelWebhook.count({
        where: { supplierId, externalId: created.id as string },
      }),
    ).toBe(0);
    const kept = await db.travelWebhook.findFirst({
      where: { supplierId, externalId: { startsWith: "retry:" } },
    });
    expect(kept).toMatchObject({ signatureOk: true, outcome: "lookup_failed" });

    // Duffel redelivers the same event once it is reachable again.
    duffelUp = true;
    const again = await deliverDuffel(deps, supplierId, signedDuffel(created));
    expect(again).toEqual({ result: "processed", action: "ticketed" });
    expect((await orderOf(orderId))?.state).toBe("ticketed");
    expect(payment.appliedOps(orderId, "capture")).toBe(1);
    // …and a third delivery is now a true duplicate.
    expect(
      await deliverDuffel(deps, supplierId, signedDuffel(created)),
    ).toEqual({ result: "duplicate" });
  });

  it("a supplier that applies more than the consented penalty never takes it from the traveller — the refund follows the consent and ops is told", async () => {
    const cityId = await seedCity(db);
    await seedDuffel();
    const { deps } = makeDeps(db, { now: () => NOW });
    stub.on("POST", /^\/air\/orders$/, (request) => {
      const ref = (
        request.body as { data: { metadata: { ubi_order_ref: string } } }
      ).data.metadata.ubi_order_ref;
      return { status: 201, body: { data: duffelOrder(ref, true) } };
    });
    const { actor, result } = await duffelCheckout(deps, cityId);
    if (result.kind !== "ok") throw new Error("expected ok");
    const orderId = result.orders[0]?.id ?? "";

    stub.on("GET", /^\/air\/orders\/ord_/, () => ({
      status: 200,
      body: { data: duffelOrder(orderId, true) },
    }));
    // Quoted: 60.80 back of 90.80 (penalty 30.00)…
    const pending = docPayload<{ data: Record<string, unknown> }>(
      "duffel/create-order-cancellation.json",
    );
    pending.data.refund_amount = "60.80";
    pending.data.refund_to = "balance";
    stub.on("POST", /^\/air\/order_cancellations$/, () => ({
      status: 201,
      body: pending,
    }));
    // …but the confirmation returns only 50.80 (penalty 40.00).
    const confirmed = docPayload<{ data: Record<string, unknown> }>(
      "duffel/create-order-cancellation.json",
    );
    confirmed.data.refund_amount = "50.80";
    confirmed.data.refund_to = "balance";
    stub.on(
      "POST",
      /^\/air\/order_cancellations\/ore_[^/]+\/actions\/confirm$/,
      () => ({ status: 200, body: confirmed }),
    );

    const refund = await cancelOrder(deps, {
      actor,
      cityId,
      orderId,
      idempotencyKey: idemKey(),
      correlationId: null,
      acceptedPenalty: { amountMinor: 3_000, currency: "GBP" },
    });
    // Charged 45.00; the traveller consented to 30.00, so 15.00 comes back.
    expect(refund).toMatchObject({
      penalty: { amountMinor: 3_000 },
      amount: { amountMinor: 1_500 },
    });
    const escalations = await db.travelOrderEvent.findMany({
      where: { orderId },
    });
    expect(
      escalations.some(
        (row) =>
          (row.detail as Record<string, unknown>).reason ===
          "supplier_penalty_above_consent",
      ),
    ).toBe(true);
  });

  it("reads the order id of Duffel's own example order.created event, whose data.object is empty, from its ord_ idempotency key only", () => {
    const example = docPayload<Record<string, unknown>>(
      "duffel/webhook-event-shape.json",
    );
    expect(parseDuffelEvent(example)).toMatchObject({
      eventType: "order.created",
      supplierOrderRef: "ord_0000ABd6wggSct7BoraU1o",
      action: "converge",
    });
    // Any other key shape is never taken for an order id.
    expect(
      parseDuffelEvent({ ...example, idempotency_key: "aic_0000ApoiwggSbt" })
        .supplierOrderRef,
    ).toBeNull();
  });
});
