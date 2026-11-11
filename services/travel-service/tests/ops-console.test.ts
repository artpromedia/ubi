/**
 * The travel-ops console's state POSTs (round 8): exactly once per
 * Idempotency-Key, and every outbox and audit row they write says whose word
 * the city rests on (src/ops/console.ts, src/routes/ops.ts).
 *
 * Everything runs through the REAL app (createApp → gatewayAuth → opsOnly →
 * the console routes) against real Postgres, in PRODUCTION mode with
 * contexts minted by the REAL gateway signer, so the city provenance under
 * test is the one production resolves: an operator bound to no city declares
 * a supported city (`operator_declared`, with the operator's id), a bound one
 * acts in the city the gateway signed (`verified`).
 */
/* eslint-disable turbo/no-undeclared-env-vars */
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
  idemKey,
  makeDeps,
  resetTravel,
  rider,
  seedCity,
  seedFlightSupplier,
  stubIdentityKeys,
  testDb,
  uid,
} from "./helpers";
import { createApp } from "../src/index";
import { createCart } from "../src/ops/carts";
import { checkout } from "../src/ops/checkout";
import { cancelOrder } from "../src/ops/orders";

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

function production(): void {
  vi.stubEnv("NODE_ENV", "production");
}

/**
 * A booked, then cancelled, flight order with a refund in `requested` — made
 * through the ops layer with the fixture supplier (a test-only adapter
 * production never serves), after which the test runs in production.
 */
async function bookedOrder(): Promise<{ cityId: string; orderId: string }> {
  const cityId = await seedCity(db);
  await seedFlightSupplier(db, {
    control: {
      "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" },
    },
  });
  const { deps } = makeDeps(db);
  const actor = rider();
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
  const orderId = result.orders[0]?.id ?? "";
  // A cancel opens a refund in `requested` for the console to chase.
  await cancelOrder(deps, {
    actor,
    cityId,
    orderId,
    idempotencyKey: idemKey(),
    correlationId: null,
  });
  production();
  return { cityId, orderId };
}

const unboundAdmin = () => ({ id: uid("adm"), role: "admin" });

interface Answer {
  readonly status: number;
  readonly body: JsonRecord;
  readonly replayed: boolean;
}

async function post(
  path: string,
  requestHeaders: Record<string, string>,
  payload: unknown,
): Promise<Answer> {
  const response = await createApp(makeDeps(db).deps).request(path, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(payload),
  });
  return {
    status: response.status,
    body: (await response.json()) as JsonRecord,
    replayed: response.headers.get("Idempotent-Replayed") === "true",
  };
}

async function consoleRecords(subjectId: string) {
  return db.auditLog.findMany({
    where: { subjectId, action: { startsWith: "travel.ops." } },
    orderBy: { createdAt: "asc" },
  });
}

describe("console state POSTs take an Idempotency-Key", () => {
  it("refuses a state POST without one, before anything is recorded", async () => {
    const { cityId, orderId } = await bookedOrder();
    const admin = unboundAdmin();
    const bare = await gatewayHeaders(admin, {
      scopes: [],
      declaredCityId: cityId,
    });
    for (const [path, payload] of [
      [`/v1/ops/travel/orders/${orderId}/settlement`, { invoicedMinor: 1 }],
      [
        `/v1/ops/travel/exceptions/${orderId}/actions`,
        { action: "chase_refund" },
      ],
      [
        "/v1/ops/travel/commercial-rates",
        {
          supplierId: "sup_x",
          routeOrProperty: "LOS-ABV",
          feeSchedule: {},
          source: "contract",
          effectiveDate: "2026-09-01",
        },
      ],
    ] as const) {
      const refused = await post(path, bare, payload);
      expect(refused.status, path).toBe(422);
      expect(refused.body.code).toBe("validation_failed");
    }
    expect(await db.travelSettlement.count()).toBe(0);
    expect(
      (await db.travelRefund.findFirstOrThrow({ where: { orderId } })).stage,
    ).toBe("requested");
    expect(await consoleRecords(orderId)).toHaveLength(0);
  });

  it("records a settlement once: a replay answers the same settlement; another body under the key is refused", async () => {
    const { cityId, orderId } = await bookedOrder();
    const admin = unboundAdmin();
    const key = idemKey("settle");
    const requestHeaders = await gatewayHeaders(admin, {
      scopes: [],
      declaredCityId: cityId,
      extra: { "Idempotency-Key": key },
    });
    const path = `/v1/ops/travel/orders/${orderId}/settlement`;

    const first = await post(path, requestHeaders, { invoicedMinor: 1_000 });
    expect(first.status).toBe(201);
    expect(first.replayed).toBe(false);
    const replay = await post(path, requestHeaders, { invoicedMinor: 1_000 });
    expect(replay).toEqual({ ...first, replayed: true });

    const reused = await post(path, requestHeaders, { invoicedMinor: 2_000 });
    expect(reused.status).toBe(409);
    expect(reused.body.code).toBe("idempotency_key_reuse");
    expect(reused.body).not.toHaveProperty("settlementId");

    expect(await db.travelSettlement.count({ where: { orderId } })).toBe(1);
    expect(
      await db.outboxEvent.count({
        where: { name: "travel.settlement.difference" },
      }),
    ).toBe(1);

    // The ONE console record: the operator, the declared city and whose
    // word it rests on.
    const [record, ...more] = await consoleRecords(orderId);
    expect(more).toHaveLength(0);
    expect(record?.action).toBe("travel.ops.settlement_recorded");
    expect(record?.actorId).toBe(admin.id);
    expect(record?.after).toMatchObject({
      status: 201,
      result: { settlementId: first.body.settlementId },
      cityId,
      cityProvenance: "operator_declared",
      cityDeclaredBy: admin.id,
    });
  });

  it("records one settlement when the same request races itself", async () => {
    const { cityId, orderId } = await bookedOrder();
    const requestHeaders = await gatewayHeaders(unboundAdmin(), {
      scopes: [],
      declaredCityId: cityId,
      extra: { "Idempotency-Key": idemKey("race") },
    });
    const answers = await Promise.all(
      Array.from({ length: 5 }, () =>
        post(`/v1/ops/travel/orders/${orderId}/settlement`, requestHeaders, {
          invoicedMinor: 1_000,
        }),
      ),
    );
    expect(new Set(answers.map((answer) => answer.status))).toEqual(
      new Set([201]),
    );
    expect(
      new Set(answers.map((answer) => String(answer.body.settlementId))).size,
    ).toBe(1);
    expect(await db.travelSettlement.count({ where: { orderId } })).toBe(1);
    expect(
      await db.outboxEvent.count({
        where: { name: "travel.settlement.difference" },
      }),
    ).toBe(1);
  });

  it("chases a refund exactly one stage per key, and its event says who declared the city", async () => {
    const { cityId, orderId } = await bookedOrder();
    const admin = unboundAdmin();
    const firstKey = idemKey("chase");
    const chase = async (key: string, action = "chase_refund") =>
      post(
        `/v1/ops/travel/exceptions/${orderId}/actions`,
        await gatewayHeaders(admin, {
          scopes: [],
          declaredCityId: cityId,
          extra: { "Idempotency-Key": key },
        }),
        { action },
      );

    const first = await chase(firstKey);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ stage: "supplier_confirmed" });

    // A retry never advances the refund a second stage.
    const replay = await chase(firstKey);
    expect(replay).toEqual({ ...first, replayed: true });
    const refund = await db.travelRefund.findFirstOrThrow({
      where: { orderId },
    });
    expect(refund.stage).toBe("supplier_confirmed");
    const reused = await chase(firstKey, "escalate");
    expect(reused.status).toBe(409);
    expect(reused.body.code).toBe("idempotency_key_reuse");

    const event = await db.outboxEvent.findFirstOrThrow({
      where: {
        name: "travel.refund.supplier_confirmed",
        aggregateId: refund.id,
      },
    });
    expect(event.actorId).toBe(admin.id);
    expect(event.cityId).toBe(cityId);
    expect(event.payload).toMatchObject({
      cityProvenance: "operator_declared",
      cityDeclaredBy: admin.id,
    });

    // A new key is a new action: one more stage.
    const next = await chase(idemKey("chase"));
    expect(next.body).toMatchObject({ stage: "supplier_refund_pending" });
    expect(
      await db.outboxEvent.count({
        where: {
          aggregateId: refund.id,
          name: { startsWith: "travel.refund." },
        },
      }),
    ).toBe(3); // requested (the cancel) + two chased stages
    expect(await consoleRecords(orderId)).toHaveLength(2);
  });

  it("resolves a settlement difference once: the replay does not look for another one to resolve", async () => {
    const { cityId, orderId } = await bookedOrder();
    const admin = { id: uid("adm"), role: "admin" };
    // An operator bound to the city acts in the city the gateway signed.
    const bound = async (key: string) =>
      gatewayHeaders(admin, {
        scopes: [],
        cityId,
        extra: { "Idempotency-Key": key },
      });
    await post(
      `/v1/ops/travel/orders/${orderId}/settlement`,
      await bound(idemKey("settle")),
      { invoicedMinor: 1_000 },
    );
    const key = idemKey("accept");
    const path = `/v1/ops/travel/exceptions/${orderId}/actions`;
    const accepted = await post(path, await bound(key), {
      action: "accept_difference",
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ resolution: "accepted" });
    // Without the record, a retry would find no open difference (404).
    const replay = await post(path, await bound(key), {
      action: "accept_difference",
    });
    expect(replay).toEqual({ ...accepted, replayed: true });

    const records = await consoleRecords(orderId);
    expect(records.map((record) => record.action)).toEqual([
      "travel.ops.settlement_recorded",
      "travel.ops.accept_difference",
    ]);
    for (const record of records) {
      expect(record.after).toMatchObject({
        cityId,
        cityProvenance: "verified",
        cityDeclaredBy: null,
      });
    }
  });

  it("escalates and looks up once per key", async () => {
    const { cityId, orderId } = await bookedOrder();
    const admin = unboundAdmin();
    const path = `/v1/ops/travel/exceptions/${orderId}/actions`;
    const escalateKey = idemKey("escalate");
    const escalateHeaders = await gatewayHeaders(admin, {
      scopes: [],
      declaredCityId: cityId,
      extra: { "Idempotency-Key": escalateKey },
    });
    const escalated = await post(path, escalateHeaders, {
      action: "escalate",
      note: "supplier has not answered",
    });
    expect(escalated.status).toBe(200);
    expect(
      await post(path, escalateHeaders, {
        action: "escalate",
        note: "supplier has not answered",
      }),
    ).toEqual({ ...escalated, replayed: true });
    const escalations = (
      await db.travelOrderEvent.findMany({ where: { orderId } })
    ).filter((step) => (step.detail as JsonRecord | null)?.escalated === true);
    expect(escalations).toHaveLength(1);
    expect(escalations[0]?.detail).toMatchObject({
      cityId,
      cityProvenance: "operator_declared",
      cityDeclaredBy: admin.id,
    });

    const lookupHeaders = await gatewayHeaders(admin, {
      scopes: [],
      declaredCityId: cityId,
      extra: { "Idempotency-Key": idemKey("lookup") },
    });
    const looked = await post(path, lookupHeaders, {
      action: "lookup_by_our_ref",
    });
    expect(looked.status).toBe(200);
    expect(
      await post(path, lookupHeaders, { action: "lookup_by_our_ref" }),
    ).toEqual({ ...looked, replayed: true });
    expect(await consoleRecords(orderId)).toHaveLength(2);
  });

  it("stores a commercial rate once; a supplier-level rate may name no city", async () => {
    const supplierId = await seedFlightSupplier(db);
    production();
    const admin = unboundAdmin();
    const requestHeaders = await gatewayHeaders(admin, {
      scopes: [],
      extra: { "Idempotency-Key": idemKey("rate") },
    });
    const rate = {
      supplierId,
      routeOrProperty: "LOS-ABV",
      feeSchedule: { markupBps: 150 },
      source: "contract-2026",
      effectiveDate: "2026-09-01",
    };
    const stored = await post(
      "/v1/ops/travel/commercial-rates",
      requestHeaders,
      rate,
    );
    expect(stored.status).toBe(201);
    const replay = await post(
      "/v1/ops/travel/commercial-rates",
      requestHeaders,
      rate,
    );
    expect(replay).toEqual({ ...stored, replayed: true });
    expect(await db.travelCommercialRate.count({ where: { supplierId } })).toBe(
      1,
    );
    const [record] = await consoleRecords(supplierId);
    expect(record?.after).toMatchObject({
      cityId: null,
      cityProvenance: null,
      cityDeclaredBy: null,
      result: { id: stored.body.id },
    });
  });
});

describe("GET /v1/ops/travel/transfers — city-wide ops read (P2-12)", () => {
  async function get(
    path: string,
    requestHeaders: Record<string, string>,
  ): Promise<{ status: number; body: JsonRecord }> {
    const response = await createApp(makeDeps(db).deps).request(path, {
      method: "GET",
      headers: requestHeaders,
    });
    return {
      status: response.status,
      body: (await response.json()) as JsonRecord,
    };
  }

  it("lists action_required and failed transfers across travellers for ops without coordinates or PII", async () => {
    const { cityId, orderId } = await bookedOrder();
    const now = new Date("2026-09-25T10:00:00.000Z");
    const baseTransfer = {
      orderId,
      cityId,
      direction: "arrival_pickup",
      legIndex: 0,
      flightNumber: "P47120",
      airportCode: "LOS",
      flightDepartAt: new Date("2026-09-26T08:00:00.000Z"),
      flightArriveAt: new Date("2026-09-26T09:15:00.000Z"),
      flightStatus: "scheduled",
      pickup: { label: "LOS Terminal 2", lat: 6.5774, lng: 3.3212 },
      dropoff: { label: "Victoria Island", lat: 6.4281, lng: 3.4219 },
      timeZone: "Africa/Lagos",
      pickupAt: new Date("2026-09-26T09:45:00.000Z"),
      windowEnd: new Date("2026-09-26T10:15:00.000Z"),
      windowSec: 1800,
      vehicleClass: "go",
      currency: "NGN",
      maxFareMinor: 1_500_000n,
      paymentMethodId: "pm_secret_card",
      policyVersion: "v1",
      submitAfter: now,
      createResult: {},
    };

    const trAction = uid("tr_act");
    const trFailed = uid("tr_fail");
    const trAwarded = uid("tr_awd");

    await db.airportTransfer.create({
      data: {
        ...baseTransfer,
        id: trAction,
        userId: uid("usr_a"),
        state: "requested",
        requestHash: "h1",
        actionRequired: {
          reason: "flight_changed_after_publication",
          message: "Flight moved; keep new pickup window or cancel?",
          choices: [{ key: "keep", label: "Keep" }],
        },
        updatedAt: new Date("2026-09-25T10:02:00.000Z"),
      },
    });
    await db.airportTransfer.create({
      data: {
        ...baseTransfer,
        id: trFailed,
        userId: uid("usr_b"),
        state: "failed",
        requestHash: "h2",
        outcome: {
          reason: "no_driver",
          message: "No driver accepted in time. Nothing was charged.",
        },
        updatedAt: new Date("2026-09-25T10:01:00.000Z"),
      },
    });
    await db.airportTransfer.create({
      data: {
        ...baseTransfer,
        id: trAwarded,
        userId: uid("usr_b"),
        state: "awarded",
        requestHash: "h3",
        updatedAt: new Date("2026-09-25T10:03:00.000Z"),
      },
    });

    // Negative control: a non-ops rider is refused on the ops-wide read.
    const riderHeaders = await gatewayHeaders(rider(cityId), { scopes: [] });
    const denied = await get(
      "/v1/ops/travel/transfers?state=action_required,failed",
      riderHeaders,
    );
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("forbidden");

    const opsHeaders = await gatewayHeaders(
      { id: uid("ops"), role: "ops", cityId },
      { scopes: ["travel:ops"] },
    );

    // Invalid state token is refused with 422 validation_failed.
    const invalid = await get(
      "/v1/ops/travel/transfers?state=unknown_state",
      opsHeaders,
    );
    expect(invalid.status).toBe(422);
    expect(invalid.body.code).toBe("validation_failed");

    // Filtered city-wide read returns tr_action and tr_failed across both travellers, newest updatedAt first, omitting tr_awarded.
    const listed = await get(
      "/v1/ops/travel/transfers?state=action_required,failed",
      opsHeaders,
    );
    expect(listed.status).toBe(200);
    const rows = listed.body.rows as JsonRecord[];
    expect(rows.map((r) => r.transferId)).toEqual([trAction, trFailed]);

    // Privacy invariant: zero raw coordinates, traveller ids, or payment method ids.
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("6.5774");
    expect(serialized).not.toContain("3.3212");
    expect(serialized).not.toContain("pm_secret_card");
    for (const row of rows) {
      expect(row).not.toHaveProperty("pickup");
      expect(row).not.toHaveProperty("dropoff");
      expect(row).not.toHaveProperty("userId");
      expect(row).not.toHaveProperty("paymentMethodId");
    }

    // Cursor pagination walks deterministically across pages.
    const page1 = await get(
      "/v1/ops/travel/transfers?state=action_required,failed&limit=1",
      opsHeaders,
    );
    expect(page1.status).toBe(200);
    expect((page1.body.rows as JsonRecord[]).map((r) => r.transferId)).toEqual([
      trAction,
    ]);
    expect(typeof page1.body.nextCursor).toBe("string");

    const page2 = await get(
      `/v1/ops/travel/transfers?state=action_required,failed&limit=1&cursor=${encodeURIComponent(String(page1.body.nextCursor))}`,
      opsHeaders,
    );
    expect(page2.status).toBe(200);
    expect((page2.body.rows as JsonRecord[]).map((r) => r.transferId)).toEqual([
      trFailed,
    ]);
    expect(page2.body.nextCursor).toBeNull();
  });
});
