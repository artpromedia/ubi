/**
 * The assistant's travel actions on travel-service's REAL API (round 9,
 * ASK-TRAVEL).
 *
 * Round 7 made ask-service present the right identity, but its travel port
 * still called `/flights/search`, `/stays/search`, `/offers/:ref` and
 * `POST /orders` — routes travel-service does not serve — so every assistant
 * search, review and booking 404'd in production. The port now speaks the
 * client API in tests/routes.manifest: searches, the cached-offer read
 * (`GET /v1/travel/searches/:searchId/offers/:offerKey`, ops/search.ts
 * readSearchOffer), carts → passengers → checkout, and the order read.
 *
 * Everything here is real: the REAL ask-service HTTP travel port calls the
 * REAL travel-service app (createApp, in-process via app.fetch) against real
 * Postgres, with contexts minted by the REAL gateway signer and relayed
 * exactly as ask-service's gatewayAuth relays them. The signature is
 * enforced on every hop — travel-service verifies a present `x-ubi-identity`
 * in every environment and refuses a forged one (pinned below) — and the port
 * never sends a plain identity beside it. The one thing production would
 * add, refusing unsigned callers outright, is pinned in
 * tests/ask-travel-relay.test.ts; it cannot run here because production also
 * refuses the fixture supplier (adapters/registry.ts), which is the
 * deterministic supplier these flows book against, driven by its seeded
 * config. The payment port is the helpers' FakePayment (payment-service's
 * /v1/finance/travel item semantics). The only thing a test changes in
 * transit is the wire itself — a lost or corrupted answer — never a route.
 *
 * Pinned:
 *   - search → cached-offer read → cart → passengers → checkout → order read,
 *     each on a route travel-service serves, each as the signed traveller;
 *   - the reviewed price is the only price charged: a reprice before the
 *     checkout or at the moment of purchase, a sold-out or an expired offer
 *     is a refusal with its reason and nothing charged;
 *   - limited mode / a session without travel:book is refused with its
 *     reason (searches stay open);
 *   - a traveller cannot read or book another traveller's cached offer;
 *   - money that does not read is never shown and never taken as a result;
 *   - a lost checkout answer is reconciled to the ONE order — never a second
 *     booking, never a fabricated failure.
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

import { ContractError } from "@ubi/contracts";

import {
  identityVerificationKeys as askVerificationKeys,
  verifyIdentityContext as askVerify,
} from "../../ask-service/src/lib/identity-context";
import {
  runWithIdentityRelay,
  type IdentityRelay,
} from "../../ask-service/src/lib/identity-relay";
import {
  createHttpTravelPort,
  type BookInput,
  type ResolvedOffer,
  type TravelOffer,
  type TravelPort,
} from "../../ask-service/src/ports/travel-port";
import {
  closeTestDb,
  FakePayment,
  gatewayContext,
  gatewayHeaders,
  makeDeps,
  resetTravel,
  rider,
  seedCity,
  seedFlightSupplier,
  seedStaySupplier,
  setControl,
  stubIdentityKeys,
  testDb,
  uid,
} from "./helpers";
import { createApp } from "../src/index";
import { CACHED_OFFER_MAX_AGE_MS } from "../src/ops/search";

const db = testDb();

interface Hop {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  /** 0 when the answer never reached the port. */
  readonly status: number;
}

type Forward = () => Promise<Response>;
type Intercept = (
  hop: { readonly method: string; readonly path: string },
  forward: Forward,
) => Promise<Response>;

interface World {
  readonly cityId: string;
  readonly traveller: { id: string; role: string };
  readonly other: { id: string; role: string };
  readonly flightSupplierId: string;
  readonly staySupplierId: string;
  readonly payment: FakePayment;
  readonly clock: { now: Date };
  readonly hops: Hop[];
  readonly app: ReturnType<typeof createApp>;
}

const ADA = {
  givenNames: "Ada",
  surname: "Obi",
  dateOfBirth: "1990-04-21",
  phone: "+2348030000001",
  gender: "f" as const,
  email: "ada@example.com",
};

beforeEach(async () => {
  await resetTravel(db);
  stubIdentityKeys();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(closeTestDb);

async function world(): Promise<World> {
  const cityId = await seedCity(db);
  const flightSupplierId = await seedFlightSupplier(db, {
    control: {
      "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" },
    },
  });
  const staySupplierId = await seedStaySupplier(db, {
    control: {
      "transcorp-king": { bookOutcome: "confirmed", bookingRef: "TH-4471" },
    },
  });
  const payment = new FakePayment();
  const clock = { now: new Date() };
  const { deps } = makeDeps(db, { payment, now: () => clock.now });
  return {
    cityId,
    traveller: rider(),
    other: rider(),
    flightSupplierId,
    staySupplierId,
    payment,
    clock,
    hops: [],
    app: createApp(deps),
  };
}

/** The REAL ask travel port, reaching the world's app over `app.fetch`. */
function askPort(w: World, intercept?: Intercept): TravelPort {
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const request = new Request(input, init);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      headers[name] = value;
    });
    const hop = { method: request.method, path: new URL(request.url).pathname };
    let status = 0;
    const forward: Forward = async () => {
      const response = await w.app.fetch(request.clone());
      status = response.status;
      return response;
    };
    try {
      return await (intercept ?? ((_hop, go) => go()))(hop, forward);
    } finally {
      w.hops.push({ ...hop, headers, status });
    }
  }) as typeof fetch;
  return createHttpTravelPort({
    baseUrl: "http://travel-service.internal",
    fetchImpl,
    reconcileDelaysMs: [0, 0],
  });
}

/** The relay ask-service's gatewayAuth builds from a verified context. */
function relayFrom(token: string): IdentityRelay {
  const identity = askVerify(token, askVerificationKeys(process.env));
  return {
    kind: "signed",
    token,
    userId: identity.userId,
    role: identity.role,
    cityId: identity.cityId,
    requestId: identity.requestId,
  };
}

/** Runs `work` inside `actor`'s own signed request, as ask-service would. */
async function as<T>(
  w: World,
  actor: { id: string; role: string },
  work: () => Promise<T>,
  options: {
    readonly modes?: readonly string[];
    readonly scopes?: readonly string[];
  } = {},
): Promise<T> {
  const token = await gatewayContext(actor, { cityId: w.cityId, ...options });
  return runWithIdentityRelay(relayFrom(token), work);
}

async function refusal(work: Promise<unknown>): Promise<ContractError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ContractError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to be refused");
}

const FLIGHT = {
  origin: "los",
  destination: "abv",
  departDate: "2026-09-12",
  passengers: 1,
};

async function searchAirPeace(
  w: World,
  port: TravelPort,
): Promise<TravelOffer> {
  const offers = await as(w, w.traveller, () =>
    port.searchFlights(w.traveller, FLIGHT, 5),
  );
  const offer = offers.find((entry) => entry.title === "Air Peace P4 7120");
  if (offer === undefined) {
    throw new Error("the search returned no Air Peace fare");
  }
  return offer;
}

async function resolved(
  w: World,
  port: TravelPort,
  offerRef: string,
): Promise<ResolvedOffer> {
  const offer = await as(w, w.traveller, () =>
    port.resolveOffer(w.traveller, offerRef),
  );
  if (offer === null) {
    throw new Error("the offer did not resolve");
  }
  return offer;
}

/** One reviewed item, exactly as ask's runExecution books it. */
function reviewed(
  offer: ResolvedOffer,
  overrides: Partial<BookInput> = {},
): BookInput {
  return {
    grantId: uid("grn"),
    offerRef: offer.offerRef,
    idempotencyKey: `${uid("exec")}:0:${offer.offerRef}`,
    paymentMethodId: "wallet",
    kind: offer.kind,
    priceMinor: offer.priceMinor,
    currency: offer.currency,
    travellers: [ADA],
    purchase: offer.purchase ?? null,
    ...overrides,
  };
}

function paths(w: World): string[] {
  return w.hops.map((hop) => `${hop.method} ${hop.path} ${hop.status}`);
}

async function ordersOf(userId: string) {
  return db.travelOrder.findMany({ where: { userId } });
}

describe("the assistant books on the routes travel-service serves", () => {
  it("searches, resolves the cached offer and books a flight through cart → passengers → checkout", async () => {
    const w = await world();
    const port = askPort(w);

    const found = await searchAirPeace(w, port);
    expect(found).toMatchObject({
      kind: "flight",
      priceMinor: 14_850_000,
      currency: "NGN",
    });
    const search = await db.travelSearch.findFirstOrThrow({
      where: { userId: w.traveller.id },
    });
    expect(found.offerRef).toMatch(
      new RegExp(`^${search.id}\\.of_[0-9a-f]{12}$`),
    );

    const offer = await resolved(w, port, found.offerRef);
    expect(offer).toMatchObject({
      offerRef: found.offerRef,
      kind: "flight",
      title: "Air Peace P4 7120",
      priceMinor: 14_850_000,
      currency: "NGN",
      purchase: {
        kind: "flight",
        offerRef: "AP-P4-7120",
        fareFamilyId: "saver",
      },
    });
    expect(offer.detail).toContain("LOS → ABV");
    expect(offer.terms).toContainEqual({
      text: "UBI is the merchant of record",
      tone: "neutral",
    });
    expect(offer.terms).toContainEqual({
      text: "Non-refundable",
      tone: "warning",
    });
    expect(offer.terms.map((term) => term.text)).toContain(
      "Cancellation: non-refundable (taxes refundable)",
    );
    // The same cached offer reads back to the same terms version.
    expect((await resolved(w, port, found.offerRef)).termsVersion).toBe(
      offer.termsVersion,
    );

    w.hops.length = 0;
    const input = reviewed(offer);
    const booked = await as(w, w.traveller, () =>
      port.book(w.traveller, input),
    );

    expect(booked).toMatchObject({
      kind: "flight",
      state: "confirmed",
      supplierRef: "AP7QX2",
      chargedMinor: 14_850_000,
      releasedMinor: null,
      reasonCode: null,
    });
    const cartHop = w.hops[0] as Hop;
    expect(paths(w)).toEqual([
      "POST /v1/travel/carts 201",
      expect.stringMatching(
        /^PUT \/v1\/travel\/carts\/cart_[0-9a-f]+\/passengers 200$/,
      ),
      expect.stringMatching(
        /^POST \/v1\/travel\/carts\/cart_[0-9a-f]+\/checkout 202$/,
      ),
    ]);
    // Every step as the signed traveller; the writes carry their own keys.
    for (const hop of w.hops) {
      expect(hop.headers["x-ubi-identity"]).toBeDefined();
      expect(hop.headers["x-user-id"]).toBeUndefined();
      expect(hop.headers["x-service-key"]).toBeUndefined();
    }
    expect(cartHop.headers["idempotency-key"]).toMatch(
      /^ask-[0-9a-f]{40}-cart$/,
    );
    expect(w.hops[2]?.headers["idempotency-key"]).toMatch(
      /^ask-[0-9a-f]{40}-checkout$/,
    );

    // One order, under the grant, for the traveller, with the reviewed
    // traveller on its cart — and the travel item's money moved once each
    // way it should: a hold and its capture, at exactly the reviewed price.
    const orders = await ordersOf(w.traveller.id);
    expect(orders).toHaveLength(1);
    const order = orders[0];
    expect(order?.id).toBe(booked.orderId);
    expect(order?.grantId).toBe(input.grantId);
    expect(Number(order?.priceMinor)).toBe(14_850_000);
    const cart = await db.travelCart.findUniqueOrThrow({
      where: { id: order?.cartId ?? "" },
    });
    expect(cart.passengers).toEqual([ADA]);
    expect(w.payment.calls.map((call) => [call.op, call.amountMinor])).toEqual([
      ["authorize", 14_850_000],
      ["capture", 14_850_000],
    ]);

    // The booking reads back through GET /v1/travel/orders/:id.
    w.hops.length = 0;
    const status = await as(w, w.traveller, () =>
      port.bookingStatus(w.traveller, booked.orderId ?? ""),
    );
    expect(status).toEqual({
      orderId: booked.orderId,
      state: "confirmed",
      supplierRef: "AP7QX2",
    });
    expect(paths(w)).toEqual([`GET /v1/travel/orders/${booked.orderId} 200`]);

    // The signature is checked on these hops: a relay whose claims were
    // rewritten to the traveller is refused, whatever it names.
    const genuine = await gatewayContext(w.other, { cityId: w.cityId });
    const [head, payload, signature] = genuine.split(".");
    const claims = JSON.parse(
      Buffer.from(payload ?? "", "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    claims.sub = w.traveller.id;
    const forged = `${head}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${signature}`;
    const denied = await refusal(
      runWithIdentityRelay(
        {
          kind: "signed",
          token: forged,
          userId: w.traveller.id,
          role: "rider",
          cityId: w.cityId,
          requestId: null,
        },
        () => port.bookingStatus(w.traveller, booked.orderId ?? ""),
      ),
    );
    expect(denied.code).toBe("unauthorized");
    expect(w.hops.at(-1)?.status).toBe(401);
  });

  it("books a stay from its priced rate, and each reviewed item is its own order", async () => {
    const w = await world();
    const port = askPort(w);

    const stays = await as(w, w.traveller, () =>
      port.searchStays(
        w.traveller,
        {
          city: "Abuja",
          checkIn: "2026-09-12",
          checkOut: "2026-09-14",
          guests: 2,
        },
        5,
      ),
    );
    expect(stays.map((stay) => [stay.title, stay.priceMinor])).toEqual([
      ["Transcorp Hilton · King Deluxe", 37_000_000],
      ["Fraser Suites · One-Bedroom Suite", 41_260_000],
    ]);
    // The property search, then each property's rooms priced (and cached).
    expect(paths(w)).toEqual([
      "POST /v1/travel/stays/searches 201",
      expect.stringMatching(/^GET \/v1\/travel\/stays\/transcorp\/rates 200$/),
      expect.stringMatching(/^GET \/v1\/travel\/stays\/fraser\/rates 200$/),
    ]);

    const stay = await resolved(w, port, stays[0]?.offerRef ?? "");
    expect(stay).toMatchObject({
      kind: "stay",
      title: "Transcorp Hilton · King Deluxe",
      detail: "breakfast included · 2026-09-12 → 2026-09-14",
      priceMinor: 37_000_000,
      purchase: {
        kind: "stay",
        offerRef: "transcorp-king",
        rateId: "transcorp-king",
      },
    });
    const flight = await resolved(
      w,
      port,
      (await searchAirPeace(w, port)).offerRef,
    );

    const execution = uid("exec");
    const bookedStay = await as(w, w.traveller, () =>
      port.book(
        w.traveller,
        reviewed(stay, { idempotencyKey: `${execution}:0:${stay.offerRef}` }),
      ),
    );
    const bookedFlight = await as(w, w.traveller, () =>
      port.book(
        w.traveller,
        reviewed(flight, {
          idempotencyKey: `${execution}:1:${flight.offerRef}`,
        }),
      ),
    );
    expect(bookedStay).toMatchObject({
      state: "confirmed",
      supplierRef: "TH-4471",
    });
    expect(bookedFlight).toMatchObject({
      state: "confirmed",
      supplierRef: "AP7QX2",
    });

    // Separate orders, separate carts, separate trips — no atomicity across
    // suppliers — each with its own money.
    const orders = await ordersOf(w.traveller.id);
    expect(orders).toHaveLength(2);
    expect(new Set(orders.map((order) => order.cartId)).size).toBe(2);
    expect(new Set(orders.map((order) => order.tripId)).size).toBe(2);
    expect(
      orders.map((order) => [order.kind, Number(order.chargedMinor)]).sort(),
    ).toEqual([
      ["flight", 14_850_000],
      ["stay", 37_000_000],
    ]);
  });

  it("refuses a booking with no travellers before anything is sent — no hold, the reason to act on", async () => {
    const w = await world();
    const port = askPort(w);
    const offer = await resolved(
      w,
      port,
      (await searchAirPeace(w, port)).offerRef,
    );
    w.hops.length = 0;

    const error = await refusal(
      as(w, w.traveller, () =>
        port.book(w.traveller, reviewed(offer, { travellers: [] })),
      ),
    );
    expect(error.code).toBe("validation_failed");
    expect(error.details).toMatchObject({ reason: "travellers_missing" });
    expect(error.message).toContain("Nothing was booked or charged");
    expect(w.hops).toHaveLength(0);
    expect(w.payment.calls).toHaveLength(0);
  });

  it("reads a booking back only for its owner", async () => {
    const w = await world();
    const port = askPort(w);
    const offer = await resolved(
      w,
      port,
      (await searchAirPeace(w, port)).offerRef,
    );
    const booked = await as(w, w.traveller, () =>
      port.book(w.traveller, reviewed(offer)),
    );
    expect(
      await as(w, w.other, () =>
        port.bookingStatus(w.other, booked.orderId ?? ""),
      ),
    ).toBeNull();
    expect(w.hops.at(-1)?.status).toBe(404);
  });

  it("reports a booking the supplier declined as released, never as booked", async () => {
    const w = await world();
    const port = askPort(w);
    const offer = await resolved(
      w,
      port,
      (await searchAirPeace(w, port)).offerRef,
    );
    await setControl(db, w.flightSupplierId, "AP-P4-7120#saver", {
      bookOutcome: "failed",
    });

    const booked = await as(w, w.traveller, () =>
      port.book(w.traveller, reviewed(offer)),
    );
    expect(booked).toMatchObject({
      state: "failed_released",
      chargedMinor: null,
      releasedMinor: 14_850_000,
      reasonCode: "supplier_declined",
    });
    expect(booked.detail).toContain("nothing was charged");
    // The hold was taken and released — never captured.
    expect(w.payment.calls.map((call) => call.op)).toEqual([
      "authorize",
      "release",
    ]);
  });
});

describe("the reviewed price is the only price charged", () => {
  it("a price that moved since the review stops before checkout: repriced, nothing charged", async () => {
    const w = await world();
    const port = askPort(w);
    const offer = await resolved(
      w,
      port,
      (await searchAirPeace(w, port)).offerRef,
    );

    await setControl(db, w.flightSupplierId, "AP-P4-7120#saver", {
      repriceToMinor: 15_500_000,
    });
    w.hops.length = 0;
    const error = await refusal(
      as(w, w.traveller, () => port.book(w.traveller, reviewed(offer))),
    );

    expect(error.code).toBe("conflict");
    expect(error.details).toMatchObject({
      reason: "repriced",
      reviewedMinor: 14_850_000,
      currentMinor: 15_500_000,
    });
    expect(error.message).toContain("15500000 NGN");
    expect(error.message).toContain("Nothing was booked or charged");
    // Priced, compared, stopped: no travellers sent, no checkout.
    expect(paths(w)).toEqual(["POST /v1/travel/carts 201"]);
    expect(await ordersOf(w.traveller.id)).toHaveLength(0);
    expect(w.payment.calls).toHaveLength(0);
  });

  it("a price that moves at the moment of purchase is refused by checkout, never charged", async () => {
    const w = await world();
    const offer = await resolved(
      w,
      askPort(w),
      (await searchAirPeace(w, askPort(w))).offerRef,
    );
    const port = askPort(w, async (hop, forward) => {
      if (hop.method === "POST" && hop.path.endsWith("/checkout")) {
        // The supplier re-prices between the cart and the purchase.
        await setControl(db, w.flightSupplierId, "AP-P4-7120#saver", {
          repriceToMinor: 15_500_000,
        });
      }
      return forward();
    });
    w.hops.length = 0;

    const error = await refusal(
      as(w, w.traveller, () => port.book(w.traveller, reviewed(offer))),
    );
    expect(error.details).toMatchObject({
      reason: "repriced",
      currentMinor: 15_500_000,
    });
    // The checkout ran with the reviewed total as expectedTotal and refused.
    expect(w.hops.at(-1)?.status).toBe(409);
    expect(w.hops.at(-1)?.path).toMatch(/\/checkout$/);
    expect(await ordersOf(w.traveller.id)).toHaveLength(0);
    expect(w.payment.calls).toHaveLength(0);
  });

  it("a sold-out offer is refused — when pricing the cart and when checking out", async () => {
    const w = await world();
    const offer = await resolved(
      w,
      askPort(w),
      (await searchAirPeace(w, askPort(w))).offerRef,
    );

    await setControl(db, w.flightSupplierId, "AP-P4-7120#saver", {
      soldOut: true,
    });
    const atCart = await refusal(
      as(w, w.traveller, () => askPort(w).book(w.traveller, reviewed(offer))),
    );
    expect(atCart.details).toMatchObject({ reason: "sold_out" });
    expect(w.hops.at(-1)).toMatchObject({
      path: "/v1/travel/carts",
      status: 409,
    });

    await setControl(db, w.flightSupplierId, "AP-P4-7120#saver", {
      bookOutcome: "confirmed",
    });
    const port = askPort(w, async (hop, forward) => {
      if (hop.method === "POST" && hop.path.endsWith("/checkout")) {
        await setControl(db, w.flightSupplierId, "AP-P4-7120#saver", {
          soldOut: true,
        });
      }
      return forward();
    });
    const atCheckout = await refusal(
      as(w, w.traveller, () => port.book(w.traveller, reviewed(offer))),
    );
    expect(atCheckout.details).toMatchObject({ reason: "sold_out" });
    expect(atCheckout.message).toContain("Nothing was booked or charged");
    expect(w.hops.at(-1)?.status).toBe(409);
    expect(await ordersOf(w.traveller.id)).toHaveLength(0);
    expect(w.payment.calls).toHaveLength(0);
  });

  it("an offer the provider says is gone or outdated at checkout is sold_out / offer_expired — never 'unknown'", async () => {
    // Duffel (offer_no_longer_available) and LiteAPI (no_availability, an
    // outdated offer) refuse the checkout's revalidation outright rather
    // than flag the offer sold out: a 409 error body, before any money.
    for (const [refusalKind, reason] of [
      ["no_longer_available", "sold_out"],
      ["offer_expired", "offer_expired"],
    ] as const) {
      const w = await world();
      const offer = await resolved(
        w,
        askPort(w),
        (await searchAirPeace(w, askPort(w))).offerRef,
      );
      const port = askPort(w, async (hop, forward) => {
        if (hop.method === "POST" && hop.path.endsWith("/checkout")) {
          await setControl(db, w.flightSupplierId, "AP-P4-7120#saver", {
            refreshRefusal: refusalKind,
          });
        }
        return forward();
      });
      w.hops.length = 0;

      const error = await refusal(
        as(w, w.traveller, () => port.book(w.traveller, reviewed(offer))),
      );
      expect(error.details).toMatchObject({ reason });
      expect(error.message).toContain("Nothing was booked or charged");
      // Refused on the first answer: no replay, no order, no money.
      expect(paths(w).filter((line) => line.includes("/checkout"))).toEqual([
        expect.stringMatching(/checkout 409$/),
      ]);
      expect(await ordersOf(w.traveller.id)).toHaveLength(0);
      expect(w.payment.calls).toHaveLength(0);
      await resetTravel(db);
    }
  });

  it("terms that changed at the reviewed price are refused by checkout: terms_changed, nothing charged", async () => {
    const w = await world();
    const port = askPort(w);
    const offer = await resolved(
      w,
      port,
      (await searchAirPeace(w, port)).offerRef,
    );
    // The supplier now reports a changed cancellation policy / board.
    await setControl(db, w.flightSupplierId, "AP-P4-7120#saver", {
      bookOutcome: "confirmed",
      termsChanged: true,
    });
    w.hops.length = 0;

    const error = await refusal(
      as(w, w.traveller, () => port.book(w.traveller, reviewed(offer))),
    );
    expect(error.code).toBe("conflict");
    expect(error.details).toMatchObject({ reason: "terms_changed" });
    expect(error.message).toContain("Nothing was booked or charged");
    expect(w.hops.at(-1)).toMatchObject({ status: 409 });
    expect(w.hops.at(-1)?.path).toMatch(/\/checkout$/);
    expect(await ordersOf(w.traveller.id)).toHaveLength(0);
    expect(w.payment.calls).toHaveLength(0);
  });

  it("limited mode and a session without travel:book are refused with their reason; searches stay open", async () => {
    const w = await world();
    const port = askPort(w);
    const offer = await resolved(
      w,
      port,
      (await searchAirPeace(w, port)).offerRef,
    );

    // An unverified device may still search (a read)...
    const limitedSearch = await as(
      w,
      w.traveller,
      () => port.searchFlights(w.traveller, FLIGHT, 5),
      { modes: ["limited"] },
    );
    expect(limitedSearch.length).toBeGreaterThan(0);

    // ...but not book.
    const limited = await refusal(
      as(w, w.traveller, () => port.book(w.traveller, reviewed(offer)), {
        modes: ["limited"],
      }),
    );
    expect(limited.code).toBe("limited_mode");
    expect(limited.details).toMatchObject({ reason: "limited_mode" });
    expect(limited.message).toContain("security check");

    const unscoped = await refusal(
      as(w, w.traveller, () => port.book(w.traveller, reviewed(offer)), {
        scopes: ["profile:read", "travel:read"],
      }),
    );
    expect(unscoped.code).toBe("forbidden");
    expect(unscoped.details).toMatchObject({ reason: "scope_missing" });

    expect(w.hops.at(-1)).toMatchObject({
      path: "/v1/travel/carts",
      status: 403,
    });
    expect(
      await db.travelCart.count({ where: { userId: w.traveller.id } }),
    ).toBe(0);
    expect(w.payment.calls).toHaveLength(0);
  });
});

describe("the cached offer read", () => {
  it("serves an offer only until it expires, then refuses it rather than the stale price", async () => {
    const w = await world();
    const port = askPort(w);
    const found = await searchAirPeace(w, port);
    const [searchId, offerKey] = found.offerRef.split(".") as [string, string];
    const path = `/v1/travel/searches/${searchId}/offers/${offerKey}`;

    const live = await w.app.request(path, {
      headers: await gatewayHeaders(w.traveller, { cityId: w.cityId }),
    });
    expect(live.status).toBe(200);
    const view = (await live.json()) as Record<string, unknown>;
    // The fixture supplier permits a 600 s display cache.
    expect(Date.parse(String(view.expiresAt)) - w.clock.now.getTime()).toBe(
      600_000,
    );

    w.clock.now = new Date(w.clock.now.getTime() + 600_001);
    expect(
      await as(w, w.traveller, () =>
        port.resolveOffer(w.traveller, found.offerRef),
      ),
    ).toBeNull();
    const stale = await w.app.request(path, {
      headers: await gatewayHeaders(w.traveller, { cityId: w.cityId }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: "offer_expired",
      details: { reason: "offer_expired" },
    });

    // A supplier with no cache window of its own still gets a bound.
    expect(CACHED_OFFER_MAX_AGE_MS).toBe(30 * 60 * 1000);
  });

  it("never lets another traveller read or book the offer", async () => {
    const w = await world();
    const port = askPort(w);
    const found = await searchAirPeace(w, port);
    const [searchId, offerKey] = found.offerRef.split(".") as [string, string];

    const foreign = await w.app.request(
      `/v1/travel/searches/${searchId}/offers/${offerKey}`,
      { headers: await gatewayHeaders(w.other, { cityId: w.cityId }) },
    );
    expect(foreign.status).toBe(404);

    w.hops.length = 0;
    expect(
      await as(w, w.other, () => port.resolveOffer(w.other, found.offerRef)),
    ).toBeNull();
    // Booking by reference alone (nothing pinned) needs the offer read first,
    // and that read is the owner's only.
    const error = await refusal(
      as(w, w.other, () =>
        port.book(w.other, {
          grantId: uid("grn"),
          offerRef: found.offerRef,
          idempotencyKey: `${uid("exec")}:0:${found.offerRef}`,
          paymentMethodId: "wallet",
          kind: "flight",
          priceMinor: found.priceMinor,
          currency: found.currency,
          travellers: [ADA],
          purchase: null,
        }),
      ),
    );
    expect(error.details).toMatchObject({ reason: "offer_unavailable" });
    expect(paths(w).every((line) => line.includes("/searches/"))).toBe(true);
    expect(paths(w).every((line) => line.endsWith(" 404"))).toBe(true);
    expect(await db.travelCart.count({ where: { userId: w.other.id } })).toBe(
      0,
    );
  });

  it("never shows money that does not read, and never takes it as a result", async () => {
    const w = await world();
    const corrupt =
      (mutate: (body: Record<string, unknown>) => void): Intercept =>
      async (_hop, forward) => {
        const response = await forward();
        const body = (await response.json()) as Record<string, unknown>;
        mutate(body);
        return new Response(JSON.stringify(body), {
          status: response.status,
          headers: { "content-type": "application/json" },
        });
      };

    // A fractional minor-unit fare in the search: no offer is shown at all.
    const search = await refusal(
      as(w, w.traveller, () =>
        askPort(
          w,
          corrupt((body) => {
            const offers = body.offers as Record<string, unknown>[];
            const families = offers[0]?.fareFamilies as Record<
              string,
              unknown
            >[];
            (families[0]?.price as Record<string, unknown>).amountMinor =
              14_850_000.5;
          }),
        ).searchFlights(w.traveller, FLIGHT, 5),
      ),
    );
    expect(search.code).toBe("service_unavailable");

    // A price written as a string in the offer read: never a review price.
    const found = await searchAirPeace(w, askPort(w));
    const read = await refusal(
      as(w, w.traveller, () =>
        askPort(
          w,
          corrupt((body) => {
            (body.price as Record<string, unknown>).amountMinor = "14850000";
          }),
        ).resolveOffer(w.traveller, found.offerRef),
      ),
    );
    expect(read.code).toBe("service_unavailable");

    // A checkout answer whose charge does not read is not a result: it is
    // reconciled from travel-service's own record instead.
    const offer = await resolved(w, askPort(w), found.offerRef);
    let corrupted = false;
    const port = askPort(w, async (hop, forward) => {
      if (
        !corrupted &&
        hop.method === "POST" &&
        hop.path.endsWith("/checkout")
      ) {
        corrupted = true;
        return corrupt((body) => {
          const orders = body.orders as Record<string, unknown>[];
          (orders[0]?.charged as Record<string, unknown>).amountMinor = -1;
        })(hop, forward);
      }
      return forward();
    });
    w.hops.length = 0;
    const booked = await as(w, w.traveller, () =>
      port.book(w.traveller, reviewed(offer)),
    );
    expect(booked).toMatchObject({
      state: "confirmed",
      chargedMinor: 14_850_000,
      reasonCode: "reconciled",
    });
    expect(paths(w).slice(-3)).toEqual([
      expect.stringMatching(/checkout 202$/),
      expect.stringMatching(/checkout 202$/),
      `GET /v1/travel/orders/${booked.orderId} 200`,
    ]);
    expect(await ordersOf(w.traveller.id)).toHaveLength(1);
  });
});

describe("retries and lost answers land on the one order", () => {
  it("reconciles a checkout answer lost after it applied", async () => {
    const w = await world();
    const offer = await resolved(
      w,
      askPort(w),
      (await searchAirPeace(w, askPort(w))).offerRef,
    );
    let lost = false;
    const port = askPort(w, async (hop, forward) => {
      if (!lost && hop.method === "POST" && hop.path.endsWith("/checkout")) {
        lost = true;
        await forward(); // travel-service books…
        throw new TypeError("fetch failed: socket hang up"); // …the answer is lost
      }
      return forward();
    });
    w.hops.length = 0;

    const booked = await as(w, w.traveller, () =>
      port.book(w.traveller, reviewed(offer)),
    );
    expect(booked).toMatchObject({
      state: "confirmed",
      supplierRef: "AP7QX2",
      reasonCode: "reconciled",
    });
    expect(paths(w)).toEqual([
      "POST /v1/travel/carts 201",
      expect.stringMatching(/passengers 200$/),
      expect.stringMatching(/checkout 202$/), // applied, answer lost
      expect.stringMatching(/checkout 202$/), // the replay: the same trip
      `GET /v1/travel/orders/${booked.orderId} 200`,
    ]);
    const orders = await ordersOf(w.traveller.id);
    expect(orders.map((order) => order.id)).toEqual([booked.orderId]);
    expect(w.payment.appliedOps(booked.orderId ?? "", "authorize")).toBe(1);
    expect(w.payment.appliedOps(booked.orderId ?? "", "capture")).toBe(1);
  });

  it("never lets a replay agree to a changed term whose 409 was lost — the user never saw it", async () => {
    const w = await world();
    const offer = await resolved(
      w,
      askPort(w),
      (await searchAirPeace(w, askPort(w))).offerRef,
    );
    await setControl(db, w.flightSupplierId, "AP-P4-7120#saver", {
      bookOutcome: "confirmed",
      termsChanged: true,
    });
    let lost = false;
    const port = askPort(w, async (hop, forward) => {
      if (!lost && hop.method === "POST" && hop.path.endsWith("/checkout")) {
        lost = true;
        await forward(); // travel-service surfaces the change (409)…
        throw new TypeError("fetch failed: socket hang up"); // …unseen
      }
      return forward();
    });
    w.hops.length = 0;

    const item = await as(w, w.traveller, () =>
      port.book(w.traveller, reviewed(offer)),
    );
    // The replays under the same key are refused too: the change a lost
    // 409 "surfaced" is not consent. The outcome of a lost answer is never
    // guessed, so the item is unknown — and nothing was booked or held.
    expect(item.state).not.toBe("confirmed");
    expect(item).toMatchObject({
      state: "unknown_reconciling",
      orderId: null,
      chargedMinor: null,
    });
    expect(paths(w).filter((line) => line.includes("/checkout"))).toEqual([
      expect.stringMatching(/checkout 409$/),
      expect.stringMatching(/checkout 409$/),
      expect.stringMatching(/checkout 409$/),
    ]);
    expect(await ordersOf(w.traveller.id)).toHaveLength(0);
    expect(w.payment.calls).toHaveLength(0);
  });

  it("replays a checkout that never arrived, booking once", async () => {
    const w = await world();
    const offer = await resolved(
      w,
      askPort(w),
      (await searchAirPeace(w, askPort(w))).offerRef,
    );
    let dropped = false;
    const port = askPort(w, async (hop, forward) => {
      if (!dropped && hop.method === "POST" && hop.path.endsWith("/checkout")) {
        dropped = true;
        throw new TypeError("fetch failed: connect ETIMEDOUT");
      }
      return forward();
    });

    const booked = await as(w, w.traveller, () =>
      port.book(w.traveller, reviewed(offer)),
    );
    expect(booked.state).toBe("confirmed");
    expect(await ordersOf(w.traveller.id)).toHaveLength(1);
    expect(w.payment.countOp("authorize")).toBe(1);
  });

  it("lands a retried item on the same cart and the same order", async () => {
    const w = await world();
    const port = askPort(w);
    const offer = await resolved(
      w,
      port,
      (await searchAirPeace(w, port)).offerRef,
    );
    const input = reviewed(offer);

    const first = await as(w, w.traveller, () => port.book(w.traveller, input));
    w.hops.length = 0;
    const again = await as(w, w.traveller, () => port.book(w.traveller, input));

    expect(again.orderId).toBe(first.orderId);
    expect(again.state).toBe("confirmed");
    // The cart replays checked out, so no travellers are re-sent; the
    // checkout replays the trip the first attempt made.
    expect(paths(w)).toEqual([
      "POST /v1/travel/carts 201",
      expect.stringMatching(/checkout 202$/),
    ]);
    expect(await ordersOf(w.traveller.id)).toHaveLength(1);
    expect(w.payment.appliedOps(first.orderId ?? "", "authorize")).toBe(1);
    expect(w.payment.appliedOps(first.orderId ?? "", "capture")).toBe(1);
  });

  it("reports an outcome it cannot recover as unknown — never failed — and the next attempt finds the one order", async () => {
    const w = await world();
    const offer = await resolved(
      w,
      askPort(w),
      (await searchAirPeace(w, askPort(w))).offerRef,
    );
    const input = reviewed(offer);
    // Every checkout answer is lost, the first one after it applied.
    const port = askPort(w, async (hop, forward) => {
      if (hop.method === "POST" && hop.path.endsWith("/checkout")) {
        await forward();
        throw new TypeError("fetch failed: socket hang up");
      }
      return forward();
    });

    const unresolved = await as(w, w.traveller, () =>
      port.book(w.traveller, input),
    );
    expect(unresolved).toMatchObject({
      state: "unknown_reconciling",
      orderId: null,
      chargedMinor: null,
      reasonCode: "outcome_unknown",
    });
    expect(unresolved.detail).toContain("Do not book it again");
    expect(unresolved.detail).not.toContain("nothing was charged");
    const orders = await ordersOf(w.traveller.id);
    expect(orders).toHaveLength(1);

    const settled = await as(w, w.traveller, () =>
      askPort(w).book(w.traveller, input),
    );
    expect(settled).toMatchObject({
      state: "confirmed",
      orderId: orders[0]?.id,
    });
    expect(await ordersOf(w.traveller.id)).toHaveLength(1);
    expect(w.payment.appliedOps(orders[0]?.id ?? "", "capture")).toBe(1);
  });
});
