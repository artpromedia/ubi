/**
 * Duffel (flights) live-shape contract tests.
 *
 * Every response the adapter parses here is an example payload from Duffel's
 * official API reference (tests/fixtures/supplier-docs/duffel, each file
 * naming its page), served over real HTTP by a local stub the adapter's
 * `baseUrl` points at. Every request the adapter makes is asserted field by
 * field against the documented request shape. Where a test needs a variant of
 * an example — an order that is not cancelled, an order carrying the metadata
 * UBI writes — the change is made on a copy in the test, with the reason.
 *
 * Covered: request mapping and response parsing for every implemented
 * capability; decimal → minor units with itemised taxes; local vs UTC times;
 * error mapping; expired-quote refusal and passenger validation before any
 * provider call; the ambiguous-booking lookup that never books twice; the
 * typed unsupported fallback for refund.
 *
 * This file sets a TRAVEL_SECRET_* variable on purpose (the credential is the
 * point), so the turbo env-declaration lint does not apply.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ContractError, money } from "@ubi/contracts";

import {
  createDuffelFlightAdapter,
  DUFFEL_API_VERSION,
  mapDuffelOrder,
  DuffelOrderSchema,
} from "../src/adapters/duffel";
import {
  SupplierHttpError,
  SupplierPreflightError,
  SupplierUnsupportedError,
} from "../src/adapters/errors";
import { toContractError } from "../src/ops/errors";

import { docPayload } from "./supplier-docs";
import { SupplierStub } from "./supplier-stub";

import type { SupplierContext } from "../src/adapters/types";
import type { JsonRecord } from "../src/ops/types";

const SECRET_REF = "duffel_contract";
const SECRET_ENV = `TRAVEL_SECRET_${SECRET_REF.toUpperCase()}`;
const TOKEN = "duffel_test_contract_token";
/** Before the docs offer's `expires_at` (2020-01-17T10:42:14.545Z). */
const BEFORE_EXPIRY = new Date("2020-01-17T10:20:00Z");
const OFFER_ID = "off_00009htYpSCXrwaB9DnUm0";

const stub = new SupplierStub();

beforeAll(async () => {
  await stub.start();
  process.env[SECRET_ENV] = TOKEN;
});
afterAll(async () => {
  delete process.env[SECRET_ENV];
  await stub.stop();
});
afterEach(() => {
  stub.reset();
});

function ctx(
  now: Date = BEFORE_EXPIRY,
  extra: JsonRecord = {},
): SupplierContext {
  return {
    supplierId: "sup_duffel_contract",
    config: {
      baseUrl: stub.url,
      secretRef: SECRET_REF,
      currency: "GBP",
      bookTimeoutMs: 1_500,
      timeoutMs: 1_500,
      ...extra,
    },
    now: () => now,
  };
}

function offerResponse(): { data: Record<string, unknown> } {
  return docPayload("duffel/get-offer.json");
}

/** The docs' create-order example as a just-created order: not cancelled. */
function createdOrder(ourRef: string): { data: Record<string, unknown> } {
  const body = docPayload<{ data: Record<string, unknown> }>(
    "duffel/create-order.json",
  );
  // The reference example fills every optional field, including a
  // cancellation; a freshly created order has none.
  body.data.cancelled_at = null;
  body.data.cancellation = null;
  // UBI writes its order reference into metadata on create, and pays an
  // `instant` order from the balance, so nothing awaits payment.
  body.data.metadata = { ubi_order_ref: ourRef };
  body.data.payment_status = {
    ...(body.data.payment_status as object),
    awaiting_payment: false,
  };
  return body;
}

function passenger(overrides: JsonRecord = {}): JsonRecord {
  return {
    title: "mrs",
    givenNames: "Amelia",
    surname: "Earhart",
    gender: "f",
    email: "amelia@duffel.com",
    phone: "+442080160509",
    dateOfBirth: "1987-07-24",
    ...overrides,
  };
}

async function refreshedSnapshot(): Promise<JsonRecord> {
  stub.on("GET", /^\/air\/offers\/off_/, () => ({
    status: 200,
    body: offerResponse(),
  }));
  const adapter = createDuffelFlightAdapter();
  const validation = await adapter.refreshOffer(ctx(), `${OFFER_ID}#fare`);
  stub.reset();
  return validation.offer.snapshot;
}

describe("Duffel search — POST /air/offer_requests", () => {
  it("maps the search onto the documented request and parses the documented offer exactly", async () => {
    // The create response is an offer request whose `offers` are Offer
    // objects: the docs' offer-request example with the docs' offer in it.
    const listed = docPayload<{ data: Record<string, unknown>[] }>(
      "duffel/list-offer-requests.json",
    );
    const offerRequest = { ...listed.data[0], offers: [offerResponse().data] };
    stub.on("POST", /^\/air\/offer_requests$/, () => ({
      status: 201,
      body: { data: offerRequest },
    }));

    const adapter = createDuffelFlightAdapter();
    const result = await adapter.search(ctx(), {
      from: "LHR",
      to: "JFK",
      departDate: "2020-06-13",
      passengers: 1,
      cabin: "economy",
    });

    const [request] = stub.requestsTo("POST", /^\/air\/offer_requests$/);
    expect(request?.query.get("return_offers")).toBe("true");
    expect(request?.query.get("supplier_timeout")).toBe("10000");
    expect(request?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(request?.headers["duffel-version"]).toBe(DUFFEL_API_VERSION);
    expect(request?.body).toEqual({
      data: {
        slices: [
          { origin: "LHR", destination: "JFK", departure_date: "2020-06-13" },
        ],
        passengers: [{ type: "adult" }],
        cabin_class: "economy",
        max_connections: 1,
      },
    });

    expect(result.offers).toHaveLength(1);
    const offer = result.offers[0];
    expect(offer?.offerRef).toBe(`${OFFER_ID}#fare`);
    expect(offer?.supplierOfferRef).toBe(OFFER_ID);
    // "45.00" GBP → 4500 minor units; base "30.20" and tax "40.80" itemised.
    expect(offer?.price).toEqual(money(4_500, "GBP"));
    const breakdown = offer?.snapshot.priceBreakdown as JsonRecord;
    expect(breakdown.base).toEqual({ amountMinor: 3_020, currency: "GBP" });
    expect(breakdown.taxes).toEqual({ amountMinor: 4_080, currency: "GBP" });
    expect(breakdown.taxLines).toEqual([
      {
        code: "GB",
        description: expect.stringContaining("Air Passenger Duty"),
        amountMinor: 2_600,
        currency: "GBP",
      },
    ]);
    // The docs example's base + tax (71.00) do not add up to its total
    // (45.00): the total stays authoritative and no fee line is invented.
    expect(breakdown.reconciles).toBe(false);
    expect(offer?.snapshot.supplierTotal).toEqual({
      amount: "45.00",
      currency: "GBP",
    });

    // Local airport wall-clock time with its offset, plus the UTC instant.
    expect(offer?.snapshot.departAt).toBe("2020-06-13T16:38:02+01:00");
    expect(offer?.snapshot.departAtUtc).toBe("2020-06-13T15:38:02.000Z");
    expect(offer?.snapshot.arriveAt).toBe("2020-06-13T16:38:02-04:00");
    expect(offer?.snapshot.arriveAtUtc).toBe("2020-06-13T20:38:02.000Z");
    expect(offer?.snapshot.durationMin).toBe(300);
    expect(offer?.snapshot.carrier).toBe("British Airways");
    expect(offer?.snapshot.flightNumber).toBe("BA 1234");

    const fare = (offer?.snapshot.fareFamilies as JsonRecord[])[0];
    expect(fare?.baggage).toBe("1 checked");
    expect(fare?.refundRule).toBe(
      "refundable before departure; penalty GBP 100.00",
    );
    expect(fare?.changeRule).toBe(
      "changes allowed before departure; penalty GBP 100.00",
    );
    expect(offer?.capabilities).toMatchObject({
      holdSupported: false,
      merchantOfRecord: "ubi",
      refundSupported: true,
      changeSupported: true,
      currency: "GBP",
    });
    expect(offer?.policy.refundBeforeDeparture).toEqual({
      allowed: true,
      penalty: { amountMinor: 10_000, currency: "GBP" },
    });
    expect(offer?.snapshot.quoteExpiresAt).toBe("2020-01-17T10:42:14.545Z");
    expect(result.cacheUntil?.toISOString()).toBe("2020-01-17T10:42:14.545Z");
  });

  it("leaves out an offer priced in a currency the supplier row does not settle in", async () => {
    const listed = docPayload<{ data: Record<string, unknown>[] }>(
      "duffel/list-offer-requests.json",
    );
    stub.on("POST", /^\/air\/offer_requests$/, () => ({
      status: 201,
      body: { data: { ...listed.data[0], offers: [offerResponse().data] } },
    }));
    const result = await createDuffelFlightAdapter().search(
      ctx(BEFORE_EXPIRY, { currency: "NGN" }),
      {
        from: "LHR",
        to: "JFK",
        departDate: "2020-06-13",
        passengers: 1,
      },
    );
    expect(result.offers).toHaveLength(0);
  });

  it("refuses an invalid search before any provider call", async () => {
    const failure = await createDuffelFlightAdapter()
      .search(ctx(), {
        from: "LHR",
        to: "JFK",
        departDate: "2019-12-31",
        passengers: 1,
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(failure).toBeInstanceOf(SupplierPreflightError);
    expect((failure as SupplierPreflightError).details).toMatchObject({
      fields: ["departDate"],
    });
    expect(stub.requests).toHaveLength(0);
  });

  it("maps Duffel's documented errors onto contract codes", async () => {
    stub.on("POST", /^\/air\/offer_requests$/, () => ({
      status: 429,
      body: docPayload("duffel/rate-limit-error.json"),
    }));
    const limited = await createDuffelFlightAdapter()
      .search(ctx(), {
        from: "LHR",
        to: "JFK",
        departDate: "2020-06-13",
        passengers: 1,
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(limited).toBeInstanceOf(ContractError);
    expect((limited as ContractError).code).toBe("rate_limited");
    expect((limited as ContractError).details).toMatchObject({
      supplierCode: "rate_limit_exceeded",
    });

    stub.on("POST", /^\/air\/offer_requests$/, () => ({
      status: 422,
      body: {
        errors: [
          {
            type: "validation_error",
            code: "invalid_slices",
            title: "Invalid",
          },
        ],
      },
    }));
    const invalid = await createDuffelFlightAdapter()
      .search(ctx(), {
        from: "LHR",
        to: "JFK",
        departDate: "2020-06-13",
        passengers: 1,
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect((invalid as ContractError).code).toBe("validation_failed");
  });
});

describe("Duffel revalidation — GET /air/offers/{id}", () => {
  it("revalidates on the documented endpoint and flags a quote that has expired", async () => {
    stub.on("GET", /^\/air\/offers\/off_/, () => ({
      status: 200,
      body: offerResponse(),
    }));
    const adapter = createDuffelFlightAdapter();

    const fresh = await adapter.refreshOffer(ctx(), `${OFFER_ID}#fare`);
    const [request] = stub.requestsTo("GET", /^\/air\/offers\//);
    expect(request?.path).toBe(`/air/offers/${OFFER_ID}`);
    expect(request?.query.get("return_available_services")).toBe("false");
    expect(fresh).toMatchObject({
      available: true,
      expired: false,
      soldOut: false,
    });
    expect(fresh.offer.price).toEqual(money(4_500, "GBP"));

    const late = await adapter.refreshOffer(
      ctx(new Date("2020-01-17T10:43:00Z")),
      `${OFFER_ID}#fare`,
    );
    expect(late).toMatchObject({ available: false, expired: true });
  });

  it("reports an offer the airline withdrew as no longer available", async () => {
    stub.on("GET", /^\/air\/offers\/off_/, () => ({
      status: 422,
      body: {
        errors: [{ type: "airline_error", code: "offer_no_longer_available" }],
      },
    }));
    const failure = await createDuffelFlightAdapter()
      .refreshOffer(ctx(), `${OFFER_ID}#fare`)
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect((failure as ContractError).code).toBe("conflict");
    expect((failure as ContractError).details).toMatchObject({
      reason: "offer_no_longer_available",
    });
  });
});

describe("Duffel booking — POST /air/orders", () => {
  it("maps passengers and payment onto the documented request and parses the created order", async () => {
    const snapshot = await refreshedSnapshot();
    stub.on("POST", /^\/air\/orders$/, () => ({
      status: 201,
      body: createdOrder("tord_contract_1"),
    }));

    const result = await createDuffelFlightAdapter().book(ctx(), {
      ourRef: "tord_contract_1",
      offerRef: `${OFFER_ID}#fare`,
      offerSnapshot: snapshot,
      passengers: [passenger()],
      idempotencyKey: "travel.checkout:item:0",
    });

    const [request] = stub.requestsTo("POST", /^\/air\/orders$/);
    expect(request?.body).toEqual({
      data: {
        type: "instant",
        selected_offers: [OFFER_ID],
        // The offer's own decimal string, byte for byte.
        payments: [{ type: "balance", currency: "GBP", amount: "45.00" }],
        passengers: [
          {
            id: "pas_00009hj8USM7Ncg31cBCL",
            title: "mrs",
            given_name: "Amelia",
            family_name: "Earhart",
            gender: "f",
            born_on: "1987-07-24",
            email: "amelia@duffel.com",
            phone_number: "+442080160509",
          },
        ],
        metadata: {
          ubi_order_ref: "tord_contract_1",
          ubi_idempotency_key: "travel.checkout:item:0",
        },
      },
    });
    expect(result).toEqual({
      outcome: "confirmed",
      supplierRefs: {
        pnr: "RZPNX8",
        orderRef: "ord_00009hthhsUZ8W4LxQgkjo",
        ticketNumbers: ["1252106312810"],
      },
      // Every passenger holds an electronic ticket in the example.
      documentsIssued: true,
      invoiced: money(9_080, "GBP"),
    });
  });

  it("reads the verbatim docs order as cancelled (it carries cancelled_at) — never a booking to charge", async () => {
    const parsed = DuffelOrderSchema.parse(
      docPayload<{ data: unknown }>("duffel/get-order.json").data,
    );
    expect(mapDuffelOrder(parsed).state).toBe("cancelled");

    const snapshot = await refreshedSnapshot();
    const verbatim = docPayload<{ data: Record<string, unknown> }>(
      "duffel/create-order.json",
    );
    verbatim.data.metadata = { ubi_order_ref: "tord_contract_c" };
    stub.on("POST", /^\/air\/orders$/, () => ({ status: 201, body: verbatim }));
    const result = await createDuffelFlightAdapter().book(ctx(), {
      ourRef: "tord_contract_c",
      offerRef: `${OFFER_ID}#fare`,
      offerSnapshot: snapshot,
      passengers: [passenger()],
      idempotencyKey: "k-cancelled",
    });
    expect(result.outcome).toBe("failed");
    expect(result.reason).toBe("supplier_order_cancelled");
  });

  it("refuses an expired quote before any provider call", async () => {
    const snapshot = await refreshedSnapshot();
    const failure = await createDuffelFlightAdapter()
      .book(ctx(new Date("2020-01-17T10:42:15Z")), {
        ourRef: "tord_expired",
        offerRef: `${OFFER_ID}#fare`,
        offerSnapshot: snapshot,
        passengers: [passenger()],
        idempotencyKey: "k-expired",
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(failure).toBeInstanceOf(SupplierPreflightError);
    expect((failure as SupplierPreflightError).code).toBe("offer_expired");
    expect(toContractError(failure).details).toMatchObject({
      providerCalled: false,
    });
    expect(stub.requestsTo("POST", /^\/air\/orders$/)).toHaveLength(0);
  });

  it.each([
    ["gender", { gender: undefined }],
    ["email", { email: "not-an-email" }],
    ["phone", { phone: "08012345678" }],
    ["title", { title: "sir" }],
    ["givenNames", { givenNames: "Æsa" }],
    ["surname", { surname: "A-name-that-is-far-too-long" }],
    ["dateOfBirth", { dateOfBirth: "2010-01-01" }],
  ])(
    "refuses passenger %s the airline would reject, before any provider call",
    async (fieldName, overrides) => {
      const snapshot = await refreshedSnapshot();
      const failure = await createDuffelFlightAdapter()
        .book(ctx(), {
          ourRef: "tord_pax",
          offerRef: `${OFFER_ID}#fare`,
          offerSnapshot: snapshot,
          passengers: [passenger(overrides as JsonRecord)],
          idempotencyKey: "k-pax",
        })
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(failure).toBeInstanceOf(SupplierPreflightError);
      expect((failure as SupplierPreflightError).details).toMatchObject({
        field: fieldName,
      });
      // PII never appears in the error.
      expect((failure as Error).message).not.toMatch(
        /Amelia|Earhart|duffel\.com/,
      );
      expect(stub.requestsTo("POST", /^\/air\/orders$/)).toHaveLength(0);
    },
  );

  it("refuses an offer that needs identity documents UBI does not forward", async () => {
    const snapshot = {
      ...(await refreshedSnapshot()),
      documentsRequired: true,
    };
    const failure = await createDuffelFlightAdapter()
      .book(ctx(), {
        ourRef: "tord_docs",
        offerRef: `${OFFER_ID}#fare`,
        offerSnapshot: snapshot,
        passengers: [passenger()],
        idempotencyKey: "k-docs",
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect((failure as SupplierPreflightError).reason).toBe(
      "identity_documents_required",
    );
    expect(stub.requests).toHaveLength(0);
  });

  it.each([
    [503, "supplier_unavailable_no_booking", "failed"],
    [422, "offer_no_longer_available", "failed"],
    [202, undefined, "supplier_pending"],
  ] as const)(
    "maps a %i answer per Duffel's order-creation guidance",
    async (status, reason, outcome) => {
      const snapshot = await refreshedSnapshot();
      stub.on("POST", /^\/air\/orders$/, () => ({
        status,
        body:
          status === 422
            ? {
                errors: [
                  {
                    type: "invalid_state_error",
                    code: "offer_no_longer_available",
                  },
                ],
              }
            : status === 202
              ? { data: { message: "accepted" } }
              : {
                  errors: [{ type: "api_error", code: "service_unavailable" }],
                },
      }));
      const result = await createDuffelFlightAdapter().book(ctx(), {
        ourRef: `tord_${status}`,
        offerRef: `${OFFER_ID}#fare`,
        offerSnapshot: snapshot,
        passengers: [passenger()],
        idempotencyKey: `k-${status}`,
      });
      expect(result.outcome).toBe(outcome);
      if (reason !== undefined) expect(result.reason).toBe(reason);
      // A 503 / 4xx is definitive and a 202 must not be retried: one call only.
      expect(stub.requestsTo("POST", /^\/air\/orders$/)).toHaveLength(1);
      expect(stub.requestsTo("GET", /^\/air\/orders$/)).toHaveLength(0);
    },
  );

  it("after a 500 asks Duffel for the order by offer and our reference — and never books twice", async () => {
    const snapshot = await refreshedSnapshot();
    const ourRef = "tord_ambiguous_500";
    stub.on("POST", /^\/air\/orders$/, () => ({
      status: 500,
      body: { errors: [{ type: "api_error", code: "internal_server_error" }] },
    }));
    stub.on("GET", /^\/air\/orders$/, () => {
      // The docs' list-orders example; one order carries OUR reference in
      // metadata, as the create request wrote it.
      const listed = docPayload<{ data: Record<string, unknown>[] }>(
        "duffel/list-orders.json",
      );
      const mine = {
        ...listed.data[0],
        cancelled_at: null,
        metadata: { ubi_order_ref: ourRef },
      };
      const someoneElses = {
        ...listed.data[0],
        id: "ord_other",
        cancelled_at: null,
        metadata: { ubi_order_ref: "tord_other" },
      };
      return { status: 200, body: { ...listed, data: [someoneElses, mine] } };
    });

    const result = await createDuffelFlightAdapter().book(ctx(), {
      ourRef,
      offerRef: `${OFFER_ID}#fare`,
      offerSnapshot: snapshot,
      passengers: [passenger()],
      idempotencyKey: "k-ambiguous",
    });
    expect(stub.requestsTo("POST", /^\/air\/orders$/)).toHaveLength(1);
    const [lookup] = stub.requestsTo("GET", /^\/air\/orders$/);
    expect(lookup?.query.get("offer_id")).toBe(OFFER_ID);
    expect(result.outcome).toBe("confirmed");
    expect(result.supplierRefs.orderRef).toBe("ord_00009hthhsUZ8W4LxQgkjo");
    expect(result.supplierRefs.pnr).toBe("RZPNX8");
  });

  it("after a timeout with no order visible reports unknown — one booking attempt, no retry", async () => {
    const snapshot = await refreshedSnapshot();
    stub.on("POST", /^\/air\/orders$/, () => ({
      status: 201,
      body: createdOrder("x"),
      delayMs: 3_000,
    }));
    stub.on("GET", /^\/air\/orders$/, () => ({
      status: 200,
      body: { meta: { limit: 50 }, data: [] },
    }));
    const result = await createDuffelFlightAdapter().book(ctx(), {
      ourRef: "tord_timeout",
      offerRef: `${OFFER_ID}#fare`,
      offerSnapshot: snapshot,
      passengers: [passenger()],
      idempotencyKey: "k-timeout",
    });
    expect(result).toMatchObject({ outcome: "unknown", reason: "timeout" });
    expect(stub.requestsTo("POST", /^\/air\/orders$/)).toHaveLength(1);
  });
});

describe("Duffel lookup / status — GET /air/orders/{id}", () => {
  it("reads an order by its Duffel id and refuses to adopt one that carries another UBI reference", async () => {
    const order = docPayload<{ data: Record<string, unknown> }>(
      "duffel/get-order.json",
    );
    order.data.cancelled_at = null;
    order.data.metadata = { ubi_order_ref: "tord_lookup" };
    stub.on("GET", /^\/air\/orders\/ord_/, () => ({
      status: 200,
      body: order,
    }));
    const adapter = createDuffelFlightAdapter();

    const found = await adapter.lookup(ctx(), "tord_lookup", {
      supplierRefs: { orderRef: "ord_00009hthhsUZ8W4LxQgkjo" },
    });
    expect(found).toMatchObject({
      found: true,
      state: "ticketed",
      documentsIssued: true,
    });
    expect(stub.requests[0]?.path).toBe(
      "/air/orders/ord_00009hthhsUZ8W4LxQgkjo",
    );

    const status = await adapter.status(ctx(), "tord_lookup", {
      supplierRefs: { orderRef: "ord_00009hthhsUZ8W4LxQgkjo" },
    });
    expect(status.state).toBe("ticketed");

    const foreign = await adapter.lookup(ctx(), "tord_somebody_else", {
      supplierRefs: { orderRef: "ord_00009hthhsUZ8W4LxQgkjo" },
    });
    expect(foreign.found).toBe(false);
  });

  it("treats a never-seen order as failed only long after its offer expired", async () => {
    stub.on("GET", /^\/air\/orders$/, () => ({
      status: 200,
      body: { meta: { limit: 50 }, data: [] },
    }));
    const adapter = createDuffelFlightAdapter();
    const hint = {
      supplierOfferRef: OFFER_ID,
      offerSnapshot: {
        supplierOfferId: OFFER_ID,
        quoteExpiresAt: "2020-01-17T10:42:14.545Z",
      },
    };
    const soon = await adapter.reconcile(
      ctx(new Date("2020-01-17T12:00:00Z")),
      "tord_x",
      hint,
    );
    expect(soon.state).toBe("unknown");
    const later = await adapter.reconcile(
      ctx(new Date("2020-01-18T11:00:00Z")),
      "tord_x",
      hint,
    );
    expect(later.state).toBe("failed");
  });
});

describe("Duffel cancellation — pending then confirmed", () => {
  it("quotes via a PENDING cancellation (nothing cancelled) and confirms only the quoted one", async () => {
    const order = docPayload<{ data: Record<string, unknown> }>(
      "duffel/get-order.json",
    );
    order.data.cancelled_at = null;
    stub.on("GET", /^\/air\/orders\/ord_/, () => ({
      status: 200,
      body: order,
    }));
    stub.on("POST", /^\/air\/order_cancellations$/, () => ({
      status: 201,
      body: docPayload("duffel/create-order-cancellation.json"),
    }));
    stub.on(
      "POST",
      /^\/air\/order_cancellations\/ore_[^/]+\/actions\/confirm$/,
      () => ({
        status: 200,
        body: docPayload("duffel/confirm-order-cancellation.json"),
      }),
    );
    const adapter = createDuffelFlightAdapter();
    const refs = { orderRef: "ord_00009hthhsUZ8W4LxQgkjo", pnr: "RZPNX8" };

    const quote = await adapter.quoteCancel!(ctx(), {
      ourRef: "tord_cancel",
      supplierRefs: refs,
      idempotencyKey: "k-q",
    });
    const [create] = stub.requestsTo("POST", /^\/air\/order_cancellations$/);
    expect(create?.body).toEqual({
      data: { order_id: "ord_00009hthhsUZ8W4LxQgkjo" },
    });
    // refund "90.80" of a "90.80" order, to a cash destination: no penalty.
    expect(quote).toEqual({
      quoteRef: "ore_00009qzZWzjDipIkqpaUAj",
      penalty: money(0, "GBP"),
      refundable: money(9_080, "GBP"),
      expiresAt: "2020-01-17T10:42:14Z",
      refundTo: "arc_bsp_cash",
    });
    expect(stub.requestsTo("POST", /actions\/confirm$/)).toHaveLength(0);

    const cancelled = await adapter.cancel(ctx(), {
      ourRef: "tord_cancel",
      supplierRefs: refs,
      idempotencyKey: "k-c",
      quoteRef: quote.quoteRef,
      acceptedPenalty: quote.penalty,
    });
    expect(stub.requestsTo("POST", /actions\/confirm$/)[0]?.path).toBe(
      "/air/order_cancellations/ore_00009qzZWzjDipIkqpaUAj/actions/confirm",
    );
    expect(cancelled).toEqual({
      accepted: true,
      penalty: money(0, "GBP"),
      refundable: money(9_080, "GBP"),
    });
  });

  it("a 5xx on confirming a cancellation is ambiguous (like a timeout) — never reported as the supplier refusing", async () => {
    const order = docPayload<{ data: Record<string, unknown> }>(
      "duffel/get-order.json",
    );
    order.data.cancelled_at = null;
    stub.on("GET", /^\/air\/orders\/ord_/, () => ({
      status: 200,
      body: order,
    }));
    stub.on(
      "POST",
      /^\/air\/order_cancellations\/ore_[^/]+\/actions\/confirm$/,
      () => ({
        status: 502,
        body: { errors: [{ type: "api_error", code: "bad_gateway" }] },
      }),
    );
    const adapter = createDuffelFlightAdapter();
    const outcome = await adapter
      .cancel(ctx(), {
        ourRef: "tord_cancel",
        supplierRefs: { orderRef: "ord_00009hthhsUZ8W4LxQgkjo" },
        idempotencyKey: "k-c",
        quoteRef: "ore_00009qzZWzjDipIkqpaUAj",
        acceptedPenalty: money(0, "GBP"),
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(outcome).toBeInstanceOf(SupplierHttpError);
    expect(toContractError(outcome).details).toMatchObject({
      operation: "cancel",
      status: 502,
      ambiguous: true,
    });
    expect(stub.requestsTo("POST", /actions\/confirm$/)).toHaveLength(1);
  });

  it("counts a refund to airline credits or a voucher as no cash back (the whole fare is the penalty)", async () => {
    const order = docPayload<{ data: Record<string, unknown> }>(
      "duffel/get-order.json",
    );
    order.data.cancelled_at = null;
    const pending = docPayload<{ data: Record<string, unknown> }>(
      "duffel/create-order-cancellation.json",
    );
    // `refund_to` is an enum in the schema; "voucher" is one of its values.
    pending.data.refund_to = "voucher";
    stub.on("GET", /^\/air\/orders\/ord_/, () => ({
      status: 200,
      body: order,
    }));
    stub.on("POST", /^\/air\/order_cancellations$/, () => ({
      status: 201,
      body: pending,
    }));
    const quote = await createDuffelFlightAdapter().quoteCancel!(ctx(), {
      ourRef: "tord_voucher",
      supplierRefs: { orderRef: "ord_00009hthhsUZ8W4LxQgkjo" },
      idempotencyKey: "k-v",
    });
    expect(quote.refundable).toEqual(money(0, "GBP"));
    expect(quote.penalty).toEqual(money(9_080, "GBP"));
    expect(quote.refundTo).toBe("voucher");
  });

  it("will not confirm a cancellation that was never quoted", async () => {
    const failure = await createDuffelFlightAdapter()
      .cancel(ctx(), {
        ourRef: "tord_nq",
        supplierRefs: { orderRef: "ord_1" },
        idempotencyKey: "k",
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect((failure as SupplierPreflightError).reason).toBe(
      "cancellation_quote_required",
    );
    expect(stub.requests).toHaveLength(0);
  });
});

describe("Duffel changes — order change requests / order changes", () => {
  it("maps a change request and parses the documented change offers", async () => {
    stub.on("POST", /^\/air\/order_change_requests$/, () => ({
      status: 201,
      body: docPayload("duffel/create-order-change-request.json"),
    }));
    const offers = await createDuffelFlightAdapter().changeOffers(
      ctx(),
      "ord_0000A3bQ8FJIQoEfuC07n6",
      {
        removeSliceIds: ["sli_00009htYpSCXrwaB9Dn123"],
        add: [{ from: "LHR", to: "JFK", departDate: "2020-04-24" }],
      },
    );
    expect(stub.requests[0]?.body).toEqual({
      data: {
        order_id: "ord_0000A3bQ8FJIQoEfuC07n6",
        slices: {
          remove: [{ slice_id: "sli_00009htYpSCXrwaB9Dn123" }],
          add: [
            {
              origin: "LHR",
              destination: "JFK",
              departure_date: "2020-04-24",
              cabin_class: "economy",
            },
          ],
        },
      },
    });
    expect(offers[0]).toEqual({
      id: "oco_0000A3vUda8dKRtUSQPSXw",
      changeTotal: money(9_080, "GBP"),
      newTotal: money(3_550, "GBP"),
      penalty: money(1_050, "GBP"),
      expiresAt: "2020-01-17T10:42:14.545Z",
    });
  });

  it("never confirms a change whose price nobody agreed to", async () => {
    stub.on("POST", /^\/air\/order_changes$/, () => ({
      status: 201,
      body: docPayload("duffel/create-order-change.json"),
    }));
    const result = await createDuffelFlightAdapter().change(ctx(), {
      ourRef: "tord_change",
      offerSnapshot: {},
      alternativeRef: "oco_0000A4QasEUIjJ6jHKfhHU",
      idempotencyKey: "k-ch",
      acceptedChangeTotal: money(3_000, "GBP"),
    });
    expect(stub.requests[0]?.body).toEqual({
      data: { selected_order_change_offer: "oco_0000A4QasEUIjJ6jHKfhHU" },
    });
    expect(result).toMatchObject({
      outcome: "failed",
      reason: "change_total_not_accepted",
      quotedTotal: money(3_050, "GBP"),
    });
    expect(stub.requestsTo("POST", /actions\/confirm$/)).toHaveLength(0);
  });

  it("confirms an agreed change paying exactly the quoted decimal, then reads the order", async () => {
    const order = docPayload<{ data: Record<string, unknown> }>(
      "duffel/get-order.json",
    );
    order.data.cancelled_at = null;
    stub.on("POST", /^\/air\/order_changes$/, () => ({
      status: 201,
      body: docPayload("duffel/create-order-change.json"),
    }));
    stub.on("POST", /^\/air\/order_changes\/[^/]+\/actions\/confirm$/, () => ({
      status: 200,
      body: docPayload("duffel/confirm-order-change.json"),
    }));
    stub.on("GET", /^\/air\/orders\/ord_/, () => ({
      status: 200,
      body: order,
    }));
    const result = await createDuffelFlightAdapter().change(ctx(), {
      ourRef: "tord_change_ok",
      offerSnapshot: {},
      alternativeRef: "oco_0000A4QasEUIjJ6jHKfhHU",
      idempotencyKey: "k-ch2",
      acceptedChangeTotal: money(3_050, "GBP"),
    });
    const [confirm] = stub.requestsTo("POST", /actions\/confirm$/);
    expect(confirm?.path).toBe(
      "/air/order_changes/ocr_0000A3tQSmKyqOrcySrGbo/actions/confirm",
    );
    expect(confirm?.body).toEqual({
      data: { payment: { type: "balance", currency: "GBP", amount: "30.50" } },
    });
    expect(
      stub.requestsTo("GET", /^\/air\/orders\/ord_0000A3tQcCRZ9R8OY0QlxA$/),
    ).toHaveLength(1);
    expect(result.outcome).toBe("changed");
    expect(result.supplierRefs.pnr).toBe("RZPNX8");
  });
});

describe("Duffel capabilities it does not offer", () => {
  it("refund is a typed unsupported fallback naming the alternative — never a fabricated success", async () => {
    const failure = await createDuffelFlightAdapter()
      .refund(ctx(), {
        ourRef: "tord_r",
        supplierRefs: {},
        amount: money(100, "GBP"),
        idempotencyKey: "k-r",
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(failure).toBeInstanceOf(SupplierUnsupportedError);
    expect(toContractError(failure)).toMatchObject({
      code: "conflict",
      details: {
        capability: "refund",
        supported: false,
        alternative: "cancel_order",
      },
    });
    expect(stub.requests).toHaveLength(0);
  });
});
