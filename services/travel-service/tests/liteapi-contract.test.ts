/**
 * Nuitee / LiteAPI (stays) live-shape contract tests.
 *
 * Responses are the example payloads from LiteAPI's official reference
 * (tests/fixtures/supplier-docs/liteapi, each naming its page), served over
 * real HTTP by a local stub; requests are asserted against the documented
 * request shapes. Variants of an example are made on a copy in the test with
 * the reason beside them.
 *
 * Covered: rates search and per-hotel rates (occupancy validation, JSON-number
 * amounts → exact minor units, pay-at-property fees itemised apart), prebook
 * as the rate check (reprice / changed-terms flags, the quote TTL), booking
 * with our reference as LiteAPI's idempotency key, the ambiguous-booking
 * lookup by client reference, lookup/status, cancellation quoted from the live
 * policy before the PUT, and the typed unsupported fallbacks.
 *
 * This file sets a TRAVEL_SECRET_* variable on purpose, so the turbo
 * env-declaration lint does not apply.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ContractError, money } from "@ubi/contracts";

import {
  SupplierHttpError,
  SupplierPreflightError,
  SupplierUnsupportedError,
} from "../src/adapters/errors";
import { createNuiteeStayAdapter } from "../src/adapters/liteapi";
import { toContractError } from "../src/ops/errors";

import { docPayload } from "./supplier-docs";
import { SupplierStub } from "./supplier-stub";

import type { StaySearchParams, SupplierContext } from "../src/adapters/types";
import type { JsonRecord } from "../src/ops/types";

const SECRET_REF = "liteapi_contract";
const SECRET_ENV = `TRAVEL_SECRET_${SECRET_REF.toUpperCase()}`;
const KEY = "sand_contract-key";
const NOW = new Date("2026-06-01T09:00:00Z");

const stub = new SupplierStub();

beforeAll(async () => {
  await stub.start();
  process.env[SECRET_ENV] = KEY;
});
afterAll(async () => {
  delete process.env[SECRET_ENV];
  await stub.stop();
});
afterEach(() => {
  stub.reset();
});

function ctx(now: Date = NOW, extra: JsonRecord = {}): SupplierContext {
  return {
    supplierId: "sup_liteapi_contract",
    config: {
      baseUrl: stub.url,
      bookBaseUrl: stub.url,
      secretRef: SECRET_REF,
      currency: "USD",
      guestNationality: "US",
      countryCode: "US",
      paymentMethod: "ACC_CREDIT_CARD",
      timeoutMs: 1_500,
      bookTimeoutMs: 1_500,
      ...extra,
    },
    now: () => now,
  };
}

const PARAMS: StaySearchParams = {
  city: "NYC",
  checkIn: "2026-08-10",
  checkOut: "2026-08-12",
  guests: 2,
};

/**
 * The docs' prebook example, minus the add-on and voucher UBI never requests
 * (with them the example's `price` is 213.66 = 163.66 + 70 − 20; see the
 * refusal test below).
 */
function prebookWithoutExtras(): { data: Record<string, unknown> } {
  const body = docPayload<{ data: Record<string, unknown> }>(
    "liteapi/prebook.json",
  );
  delete body.data.addonsRequest;
  delete body.data.voucherCode;
  delete body.data.voucherTotalAmount;
  delete body.data.addonsTotalAmount;
  body.data.price = 163.66;
  return body;
}

function guest(overrides: JsonRecord = {}): JsonRecord {
  return {
    givenNames: "Steve",
    surname: "Doe",
    email: "s.doe@liteapi.travel",
    phone: "+2348012345678",
    dateOfBirth: "1990-01-01",
    ...overrides,
  };
}

async function quotedSnapshot(): Promise<JsonRecord> {
  stub.on("POST", /^\/rates\/prebook$/, () => ({
    status: 200,
    body: prebookWithoutExtras(),
  }));
  const validation = await createNuiteeStayAdapter().refreshOffer(
    ctx(),
    "offer_from_search",
  );
  stub.reset();
  return validation.offer.snapshot;
}

describe("LiteAPI rates — POST /hotels/rates", () => {
  it("maps a stay search onto the documented request and parses the documented response exactly", async () => {
    stub.on("POST", /^\/hotels\/rates$/, () => ({
      status: 200,
      body: docPayload("liteapi/hotel-rates.json"),
    }));
    const result = await createNuiteeStayAdapter().search(ctx(), PARAMS);

    const [request] = stub.requestsTo("POST", /^\/hotels\/rates$/);
    expect(request?.headers["x-api-key"]).toBe(KEY);
    expect(request?.body).toEqual({
      occupancies: [{ adults: 2 }],
      currency: "USD",
      guestNationality: "US",
      checkin: "2026-08-10",
      checkout: "2026-08-12",
      timeout: 8,
      iataCode: "NYC",
      maxRatesPerHotel: 1,
    });
    expect(result.offers).toHaveLength(1);
    const property = result.offers[0];
    expect(property?.offerRef).toBe("lp1897");
    expect(property?.price).toEqual(money(16_366, "USD"));
    expect(property?.snapshot).toMatchObject({
      id: "lp1897",
      name: "Hotel Example NYC",
      rating: 8.5,
      fromPrice: { amountMinor: 16_366, currency: "USD" },
    });
    expect(result.cacheUntil).toBeNull();
  });

  it("parses rates with taxes itemised, fees payable at the property kept out of the charge, and GMT deadlines as UTC", async () => {
    stub.on("POST", /^\/hotels\/rates$/, () => ({
      status: 200,
      body: docPayload("liteapi/hotel-rates.json"),
    }));
    const rates = await createNuiteeStayAdapter().rates(
      ctx(),
      "lp1897",
      PARAMS,
    );

    expect(stub.requests[0]?.body).toMatchObject({
      hotelIds: ["lp1897"],
      occupancies: [{ adults: 2 }],
    });
    expect(rates).toHaveLength(1);
    const rate = rates[0];
    expect(rate?.price).toEqual(money(16_366, "USD"));
    expect(rate?.payAtProperty).toEqual(money(4_361, "USD"));
    expect(rate?.snapshot.taxesAndFees).toEqual([
      {
        description: "NYC Javits Center Fee",
        included: true,
        amountMinor: 162,
        currency: "USD",
      },
      {
        description: "NYC Occupancy Tax",
        included: true,
        amountMinor: 216,
        currency: "USD",
      },
      {
        description: "NY State Tax",
        included: true,
        amountMinor: 1_188,
        currency: "USD",
      },
      {
        description: "NY City Tax",
        included: true,
        amountMinor: 787,
        currency: "USD",
      },
      {
        description: "Facility Fee",
        included: false,
        amountMinor: 4_361,
        currency: "USD",
      },
    ]);
    expect(rate?.snapshot.occupancy).toEqual({
      adults: 2,
      children: 0,
      maxAdults: 2,
      bookable: true,
    });
    expect(rate?.snapshot.cancellation).toMatchObject({
      refundableTag: "RFN",
      freeUntil: "2026-07-30T02:00:00.000Z",
      steps: [
        {
          fromUtc: "2026-07-30T02:00:00.000Z",
          penalty: { amountMinor: 16_366, currency: "USD" },
        },
      ],
    });
    expect(rate?.capabilities).toMatchObject({
      refundSupported: true,
      payAtProperty: true,
      merchantOfRecord: "ubi",
    });
    expect(rate?.snapshot.board).toBe("Room Only");
  });

  it("never offers a room that does not match the party (occupancy validation)", async () => {
    stub.on("POST", /^\/hotels\/rates$/, () => ({
      status: 200,
      body: docPayload("liteapi/hotel-rates.json"),
    }));
    // The example room is for two adults; a party of one gets no such offer.
    const rates = await createNuiteeStayAdapter().rates(ctx(), "lp1897", {
      ...PARAMS,
      guests: 1,
    });
    expect(rates).toHaveLength(0);
  });

  it("reads LiteAPI's no-availability answer as an empty result", async () => {
    stub.on("POST", /^\/hotels\/rates$/, () => ({
      status: 200,
      body: { error: { code: 2001, message: "no availability found" } },
    }));
    const result = await createNuiteeStayAdapter().search(ctx(), PARAMS);
    expect(result.offers).toEqual([]);
  });

  it.each([
    ["a check-in in the past", { checkIn: "2026-05-01" }, "checkIn"],
    ["a stay longer than the limit", { checkOut: "2026-09-30" }, "checkOut"],
    ["an impossible date", { checkIn: "2026-02-30" }, "checkIn"],
    ["no guests", { guests: 0 }, "guests"],
  ] as const)(
    "refuses %s before any provider call",
    async (_label, change, fieldName) => {
      const failure = await createNuiteeStayAdapter()
        .search(ctx(), { ...PARAMS, ...change })
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(failure).toBeInstanceOf(SupplierPreflightError);
      expect((failure as SupplierPreflightError).details.fields).toContain(
        fieldName,
      );
      expect(stub.requests).toHaveLength(0);
    },
  );
});

describe("LiteAPI prebook — POST /rates/prebook (the rate check)", () => {
  it("revalidates on the documented endpoint and stamps the server-set quote expiry", async () => {
    stub.on("POST", /^\/rates\/prebook$/, () => ({
      status: 200,
      body: prebookWithoutExtras(),
    }));
    const validation = await createNuiteeStayAdapter().refreshOffer(
      ctx(),
      "offer_from_search",
    );

    expect(stub.requests[0]?.body).toEqual({
      offerId: "offer_from_search",
      usePaymentSdk: false,
    });
    expect(validation).toMatchObject({
      available: true,
      repriced: false,
      termsChanged: false,
      expired: false,
    });
    expect(validation.offer.price).toEqual(money(16_366, "USD"));
    expect(validation.offer.payAtProperty).toEqual(money(4_361, "USD"));
    expect(validation.offer.snapshot.prebookId).toBe("zzWkJcdgk");
    expect(validation.offer.snapshot.quoteExpiresAt).toBe(
      "2026-06-01T09:10:00.000Z",
    );
  });

  it("flags a moved price and changed terms for explicit consent", async () => {
    const repriced = prebookWithoutExtras();
    repriced.data.priceDifferencePercent = 4;
    stub.on("POST", /^\/rates\/prebook$/, () => ({
      status: 200,
      body: repriced,
    }));
    expect(
      (await createNuiteeStayAdapter().refreshOffer(ctx(), "o")).repriced,
    ).toBe(true);

    const changed = prebookWithoutExtras();
    changed.data.cancellationChanged = true;
    stub.on("POST", /^\/rates\/prebook$/, () => ({
      status: 200,
      body: changed,
    }));
    expect(
      (await createNuiteeStayAdapter().refreshOffer(ctx(), "o")).termsChanged,
    ).toBe(true);
  });

  it("refuses the verbatim docs prebook: its total includes an add-on and voucher UBI never asked for", async () => {
    stub.on("POST", /^\/rates\/prebook$/, () => ({
      status: 200,
      body: docPayload("liteapi/prebook.json"),
    }));
    const failure = await createNuiteeStayAdapter()
      .refreshOffer(ctx(), "o")
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect((failure as ContractError).code).toBe("service_unavailable");
    expect((failure as ContractError).details).toMatchObject({
      detail: "prebook total does not match its rates",
    });
  });

  it("maps the documented outdated-offer error to offer_expired", async () => {
    stub.on("POST", /^\/rates\/prebook$/, () => ({
      status: 408,
      body: docPayload("liteapi/prebook-outdated-offer.json"),
    }));
    const failure = await createNuiteeStayAdapter()
      .refreshOffer(ctx(), "o")
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect((failure as ContractError).code).toBe("offer_expired");
  });
});

describe("LiteAPI booking — POST /rates/book", () => {
  it("books with our reference as the client reference and parses the documented confirmation", async () => {
    const snapshot = await quotedSnapshot();
    stub.on("POST", /^\/rates\/book$/, () => ({
      status: 200,
      body: docPayload("liteapi/book.json"),
    }));
    // The docs example answers clientReference "REF123": book as that reference.
    const result = await createNuiteeStayAdapter().book(ctx(), {
      ourRef: "REF123",
      offerRef: "offer_from_search",
      offerSnapshot: snapshot,
      passengers: [guest()],
      idempotencyKey: "k-book",
    });
    expect(stub.requests[0]?.body).toEqual({
      prebookId: "zzWkJcdgk",
      clientReference: "REF123",
      holder: {
        firstName: "Steve",
        lastName: "Doe",
        email: "s.doe@liteapi.travel",
        phone: "+2348012345678",
      },
      guests: [
        {
          occupancyNumber: 1,
          firstName: "Steve",
          lastName: "Doe",
          email: "s.doe@liteapi.travel",
          phone: "+2348012345678",
        },
      ],
      payment: { method: "ACC_CREDIT_CARD" },
    });
    expect(result).toEqual({
      outcome: "confirmed",
      supplierRefs: { bookingRef: "ABC123", orderRef: "HOTEL123" },
      documentsIssued: true,
      invoiced: money(10_000, "USD"),
    });
  });

  it("refuses an expired quote and a missing guest email before any provider call", async () => {
    const snapshot = await quotedSnapshot();
    const expired = await createNuiteeStayAdapter()
      .book(ctx(new Date("2026-06-01T09:10:01Z")), {
        ourRef: "tord_s1",
        offerRef: "o",
        offerSnapshot: snapshot,
        passengers: [guest()],
        idempotencyKey: "k1",
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect((expired as SupplierPreflightError).code).toBe("offer_expired");

    const noEmail = await createNuiteeStayAdapter()
      .book(ctx(), {
        ourRef: "tord_s2",
        offerRef: "o",
        offerSnapshot: snapshot,
        passengers: [guest({ email: undefined })],
        idempotencyKey: "k2",
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect((noEmail as SupplierPreflightError).details).toMatchObject({
      field: "email",
    });

    const noMethod = await createNuiteeStayAdapter()
      .book(ctx(NOW, { paymentMethod: undefined }), {
        ourRef: "tord_s3",
        offerRef: "o",
        offerSnapshot: snapshot,
        passengers: [guest()],
        idempotencyKey: "k3",
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect((noMethod as SupplierPreflightError).reason).toBe(
      "payment_method_not_configured",
    );
    expect(stub.requests).toHaveLength(0);
  });

  it("maps documented no-availability as a definitive failure", async () => {
    const snapshot = await quotedSnapshot();
    stub.on("POST", /^\/rates\/book$/, () => ({
      status: 409,
      body: { error: { code: 2001, message: "no availability found" } },
    }));
    const result = await createNuiteeStayAdapter().book(ctx(), {
      ourRef: "tord_na",
      offerRef: "o",
      offerSnapshot: snapshot,
      passengers: [guest()],
      idempotencyKey: "k-na",
    });
    expect(result).toMatchObject({ outcome: "failed", reason: "liteapi_2001" });
    expect(stub.requestsTo("GET", /^\/bookings$/)).toHaveLength(0);
  });

  it("on a duplicate client reference reads the earlier booking instead of booking again", async () => {
    const snapshot = await quotedSnapshot();
    const ourRef = "tord_dup";
    stub.on("POST", /^\/rates\/book$/, () => ({
      status: 400,
      body: docPayload("liteapi/book-duplicate-client-reference.json"),
    }));
    stub.on("GET", /^\/bookings$/, (request) => {
      // The docs' list example as the booking our earlier attempt made:
      // our client reference, still confirmed.
      const listed = docPayload<{ data: Record<string, unknown>[] }>(
        "liteapi/list-bookings.json",
      );
      const booking = {
        ...listed.data[0],
        clientReference: request.query.get("clientReference"),
        status: "CONFIRMED",
      };
      return { status: 200, body: { data: [booking] } };
    });
    const result = await createNuiteeStayAdapter().book(ctx(), {
      ourRef,
      offerRef: "o",
      offerSnapshot: snapshot,
      passengers: [guest()],
      idempotencyKey: "k-dup",
    });
    expect(stub.requestsTo("POST", /^\/rates\/book$/)).toHaveLength(1);
    expect(
      stub.requestsTo("GET", /^\/bookings$/)[0]?.query.get("clientReference"),
    ).toBe(ourRef);
    expect(result).toMatchObject({
      outcome: "confirmed",
      supplierRefs: { bookingRef: "9EjIcpy7K", orderRef: "9348208430284093" },
    });
  });

  it.each([
    ["booking incomplete (2014)", "liteapi/book-incomplete.json"],
    [
      "booking not confirmed (code 2010, not in the documented error table)",
      "liteapi/book-not-confirmed.json",
    ],
  ])(
    "treats %s as ambiguous: looks up by our reference, never books twice",
    async (_label, fixture) => {
      const snapshot = await quotedSnapshot();
      stub.on("POST", /^\/rates\/book$/, () => ({
        status: 400,
        body: docPayload(fixture),
      }));
      stub.on("GET", /^\/bookings$/, () => ({
        status: 200,
        body: { data: [] },
      }));
      const result = await createNuiteeStayAdapter().book(ctx(), {
        ourRef: "tord_amb",
        offerRef: "o",
        offerSnapshot: snapshot,
        passengers: [guest()],
        idempotencyKey: "k-amb",
      });
      expect(result.outcome).toBe("unknown");
      expect(stub.requestsTo("POST", /^\/rates\/book$/)).toHaveLength(1);
      expect(stub.requestsTo("GET", /^\/bookings$/)).toHaveLength(1);
    },
  );
});

describe("LiteAPI lookup / status / cancellation", () => {
  it("looks a booking up by our reference and by LiteAPI's booking id", async () => {
    stub.on("GET", /^\/bookings$/, () => {
      const listed = docPayload<{ data: Record<string, unknown>[] }>(
        "liteapi/list-bookings.json",
      );
      return { status: 200, body: listed };
    });
    stub.on("GET", /^\/bookings\/[^/]+$/, () => ({
      status: 200,
      body: docPayload("liteapi/get-booking-confirmed.json"),
    }));
    const adapter = createNuiteeStayAdapter();

    // The docs list example is a CANCELLED booking under that client reference.
    const byRef = await adapter.lookup(
      ctx(),
      "6b462947-b183-450b-8113-098a674f7f86",
    );
    expect(byRef).toMatchObject({
      found: true,
      state: "cancelled",
      supplierRefs: { bookingRef: "9EjIcpy7K" },
    });
    const other = await adapter.lookup(ctx(), "tord_not_there");
    expect(other.found).toBe(false);

    const status = await adapter.status(ctx(), "REF123", {
      supplierRefs: { bookingRef: "hSq2gVDrf" },
    });
    expect(stub.requestsTo("GET", /^\/bookings\/hSq2gVDrf$/)).toHaveLength(1);
    expect(status).toMatchObject({ state: "confirmed", documentsIssued: true });
  });

  it("quotes the live penalty from the booking's policy before cancelling", async () => {
    stub.on("GET", /^\/bookings\/[^/]+$/, () => ({
      status: 200,
      body: docPayload("liteapi/get-booking-confirmed.json"),
    }));
    const adapter = createNuiteeStayAdapter();
    const refs = { bookingRef: "hSq2gVDrf" };

    // Before the 2024-11-15 (GMT) step: free, and the quote holds until then.
    const early = await adapter.quoteCancel!(
      ctx(new Date("2024-11-01T00:00:00Z")),
      {
        ourRef: "REF123",
        supplierRefs: refs,
        idempotencyKey: "k",
      },
    );
    expect(early).toEqual({
      quoteRef: null,
      penalty: money(0, "USD"),
      refundable: money(11_500, "USD"),
      expiresAt: "2024-11-15T00:00:00.000Z",
      refundTo: null,
    });
    // After it: 100.00 of the 115.00 stay.
    const late = await adapter.quoteCancel!(ctx(), {
      ourRef: "REF123",
      supplierRefs: refs,
      idempotencyKey: "k",
    });
    expect(late.penalty).toEqual(money(10_000, "USD"));
    expect(late.refundable).toEqual(money(1_500, "USD"));
    expect(stub.requestsTo("PUT", /^\/bookings\//)).toHaveLength(0);
  });

  it("cancels only when the live penalty equals the accepted one, and reports what LiteAPI charged", async () => {
    stub.on("GET", /^\/bookings\/[^/]+$/, () => ({
      status: 200,
      body: docPayload("liteapi/get-booking-confirmed.json"),
    }));
    stub.on("PUT", /^\/bookings\/[^/]+$/, () => ({
      status: 200,
      body: docPayload("liteapi/cancel-refundable.json"),
    }));
    const adapter = createNuiteeStayAdapter();
    const refs = { bookingRef: "hSq2gVDrf" };

    const moved = await adapter.cancel(ctx(), {
      ourRef: "REF123",
      supplierRefs: refs,
      idempotencyKey: "k",
      acceptedPenalty: money(0, "USD"),
    });
    expect(moved).toMatchObject({ accepted: false, reason: "penalty_changed" });
    expect(stub.requestsTo("PUT", /^\/bookings\//)).toHaveLength(0);

    const done = await adapter.cancel(ctx(), {
      ourRef: "REF123",
      supplierRefs: refs,
      idempotencyKey: "k",
      acceptedPenalty: money(10_000, "USD"),
    });
    expect(stub.requestsTo("PUT", /^\/bookings\/hSq2gVDrf$/)).toHaveLength(1);
    // The docs' refundable cancellation answer: fee 25, refund 125.
    expect(done).toEqual({
      accepted: true,
      penalty: money(2_500, "USD"),
      refundable: money(12_500, "USD"),
    });
  });

  it("a 5xx on the cancellation PUT is ambiguous — never reported as a refusal", async () => {
    stub.on("GET", /^\/bookings\/[^/]+$/, () => ({
      status: 200,
      body: docPayload("liteapi/get-booking-confirmed.json"),
    }));
    stub.on("PUT", /^\/bookings\/[^/]+$/, () => ({
      status: 500,
      body: { error: { code: 5000, message: "Unable to process request" } },
    }));
    const adapter = createNuiteeStayAdapter();
    const outcome = await adapter
      .cancel(ctx(), {
        ourRef: "REF123",
        supplierRefs: { bookingRef: "hSq2gVDrf" },
        idempotencyKey: "k",
        acceptedPenalty: money(10_000, "USD"),
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(outcome).toBeInstanceOf(SupplierHttpError);
    expect(toContractError(outcome).details).toMatchObject({
      operation: "cancel",
      status: 500,
      supplierCode: "5000",
      ambiguous: true,
    });
  });

  it("change and refund are typed unsupported fallbacks naming the alternative", async () => {
    const adapter = createNuiteeStayAdapter();
    const change = await adapter
      .change(ctx(), {
        ourRef: "r",
        offerSnapshot: {},
        alternativeRef: "a",
        idempotencyKey: "k",
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(change).toBeInstanceOf(SupplierUnsupportedError);
    expect(toContractError(change).details).toMatchObject({
      alternative: "cancel_and_rebook",
      supported: false,
    });
    const refund = await adapter
      .refund(ctx(), {
        ourRef: "r",
        supplierRefs: {},
        amount: money(1, "USD"),
        idempotencyKey: "k",
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect((refund as SupplierUnsupportedError).alternative).toBe(
      "cancel_order",
    );
    expect(stub.requests).toHaveLength(0);
  });
});
