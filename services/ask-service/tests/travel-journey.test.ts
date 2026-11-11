/**
 * The assistant's travel journey end to end, on travel-service's REAL API
 * (round 9, ASK-TRAVEL).
 *
 * search → review → confirm → cart / passengers / checkout → order status,
 * driven through the REAL ask app (createApp: gatewayAuth, the message turn,
 * the tools, the review and confirm routes, runExecution) with the REAL HTTP
 * travel port calling the REAL travel-service app (its createApp, in-process
 * via app.fetch) on the same Postgres. Every request carries a context minted
 * by the REAL gateway signer: ask verifies it and relays it, travel-service
 * verifies it again on every hop. The model is the deterministic tool
 * selector (tests/helpers.ts), the grant port mints real action_grants rows,
 * the supplier is travel-service's fixture adapter driven by its seeded
 * config (production refuses it, so this runs in the test environment — the
 * production-only refusal of unsigned callers is pinned in
 * travel-relay.test.ts and services/travel-service/tests/ask-travel-relay.test.ts),
 * and travel money goes to travel-service's FakePayment
 * (/v1/finance/travel item semantics).
 *
 * Pinned beyond the happy path: what the execution records when the booking
 * is refused — a reprice since the review, a sold-out offer, a device in
 * limited mode — is the refusal's own reason, never "the supplier could not
 * be reached"; an offer that expired before the confirm expires the review
 * (410) before any grant is minted; a replayed confirm books nothing twice.
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

import { signIdentityContext } from "../../api-gateway/src/identity/context";
import { createApp as createTravelApp } from "../../travel-service/src/index";
import { ASK_SERVICE_KEY_ENV } from "../../travel-service/src/routes/internal-ask";
import {
  FakePayment,
  makeDeps as makeTravelDeps,
  resetTravel,
  seedCity as seedTravelCity,
  seedFlightSupplier,
  seedStaySupplier,
  setControl,
} from "../../travel-service/tests/helpers";
import { recordableCall } from "../src/ai/loop";
import { createApp } from "../src/index";
import {
  MAX_TRAVEL_RECONCILE_ATTEMPTS,
  sweepUnknownTravelExecutions,
} from "../src/ops/executions";
import {
  createHttpTravelPort,
  derivedTravelIds,
} from "../src/ports/travel-port";
import {
  closeTestDb,
  makeDeps,
  rider,
  testDb,
  uid,
  type TestDeps,
} from "./helpers";

import type { Scope } from "../../api-gateway/src/identity/scopes";
import type { TravelDb } from "../../travel-service/src/ops/types";
import type { Actor } from "../src/ops/types";

const IDENTITY_SECRET = "ask-travel-journey-test-internal-secret-0001";
const ASK_INTERNAL_KEY = "ask-travel-journey-test-service-key-0001";
const RIDER_SCOPES = [
  "profile:read",
  "ride:read",
  "ask:converse",
  "ask:transact",
  "travel:read",
  "travel:book",
] as const;

const ADA = {
  givenNames: "Ada",
  surname: "Obi",
  dateOfBirth: "1990-04-21",
  phone: "+2348030000001",
  gender: "f",
  email: "ada@example.com",
};

interface Journey {
  readonly cityId: string;
  readonly actor: Actor;
  readonly flightSupplierId: string;
  readonly staySupplierId: string;
  readonly payment: FakePayment;
  readonly clock: { now: Date };
  readonly deps: TestDeps;
  readonly travelPaths: string[];
}

interface JourneyOptions {
  readonly flightControl?: Record<string, Record<string, unknown>>;
  readonly stayControl?: Record<string, Record<string, unknown>>;
  readonly internalServiceKey?: string;
  readonly interceptFetch?: (
    request: Request,
    forward: (req: Request) => Promise<Response>,
  ) => Promise<Response>;
}

const db = testDb();
const travelDb = db as unknown as TravelDb;

beforeEach(async () => {
  vi.stubEnv("UBI_IDENTITY_SECRET", IDENTITY_SECRET);
  vi.stubEnv("UBI_IDENTITY_KEY_ID", "test-k1");
  vi.stubEnv("JWT_SECRET", "ask-travel-journey-test-client-secret-001");
  vi.stubEnv(ASK_SERVICE_KEY_ENV, ASK_INTERNAL_KEY);
  await db.askExecution.deleteMany({});
  // One travel catalog at a time: travel-service picks the enabled supplier.
  await resetTravel(travelDb);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await closeTestDb();
});

/** A city both services serve, flight + stay suppliers, and the two apps wired. */
async function journey(options: JourneyOptions = {}): Promise<Journey> {
  const cityId = await seedTravelCity(travelDb);
  for (const key of ["ai_assistant", "ai_transactions"]) {
    await db.featureFlag.upsert({
      where: { key },
      create: { key, defaultOn: false },
      update: {},
    });
    await db.flagRule.upsert({
      where: { flagKey_cityId: { flagKey: key, cityId } },
      create: { id: uid("rule"), flagKey: key, cityId, enabled: true },
      update: { enabled: true },
    });
  }
  const flightSupplierId = await seedFlightSupplier(travelDb, {
    control: {
      "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" },
      ...(options.flightControl ?? {}),
    },
  });
  const staySupplierId = await seedStaySupplier(travelDb, {
    control: {
      "fraser-suite": {
        bookOutcome: "confirmed",
        bookingRef: "FR-901",
        repricePayAtPropertyToMinor: 5_000_000,
      },
      ...(options.stayControl ?? {}),
    },
  });
  const payment = new FakePayment();
  const clock = { now: new Date() };
  const travelApp = createTravelApp(
    makeTravelDeps(travelDb, { payment, now: () => clock.now }).deps,
  );
  const travelPaths: string[] = [];
  const forward = async (request: Request): Promise<Response> => {
    const response = await travelApp.fetch(request);
    travelPaths.push(
      `${request.method} ${new URL(request.url).pathname} ${response.status}`,
    );
    return response;
  };
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const request = new Request(input, init);
    if (options.interceptFetch !== undefined) {
      return options.interceptFetch(request, forward);
    }
    return forward(request);
  }) as typeof fetch;
  const deps = makeDeps(db, {
    travel: createHttpTravelPort({
      baseUrl: "http://travel-service.internal",
      fetchImpl,
      reconcileDelaysMs: [0, 0],
      internalServiceKey: options.internalServiceKey ?? ASK_INTERNAL_KEY,
    }),
  });
  return {
    cityId,
    actor: rider(),
    flightSupplierId,
    staySupplierId,
    payment,
    clock,
    deps,
    travelPaths,
  };
}

/** Exactly what the gateway forwards for the verified caller. */
async function gatewayHeaders(
  j: Journey,
  options: {
    readonly modes?: readonly string[];
    readonly scopes?: readonly string[];
  } = {},
): Promise<Record<string, string>> {
  const requestId = `req_${uid("r")}`;
  const token = await signIdentityContext({
    userId: j.actor.id,
    role: "rider",
    scopes: [...(options.scopes ?? RIDER_SCOPES)] as Scope[],
    modes: [...(options.modes ?? [])] as never[],
    cityId: j.cityId,
    tenantId: null,
    sessionId: null,
    deviceId: null,
    requestId,
  });
  return {
    "content-type": "application/json",
    "x-ubi-identity": token,
    "x-user-id": j.actor.id,
    "x-user-role": "rider",
    "x-request-id": requestId,
    "x-auth-city-id": j.cityId,
    "x-ubi-city-id": j.cityId,
  };
}

async function say(
  j: Journey,
  threadId: string,
  text: string,
): Promise<number> {
  const response = await createApp(j.deps).request(
    `/v1/ask/threads/${threadId}/messages`,
    {
      method: "POST",
      headers: await gatewayHeaders(j),
      body: JSON.stringify({ text }),
    },
  );
  await response.text();
  return response.status;
}

/** Search, then propose the Air Peace fare for Ada: the review id. */
async function reviewAirPeace(
  j: Journey,
  travellers: readonly Record<string, string>[] = [ADA],
): Promise<{ threadId: string; reviewId: string; offerRef: string }> {
  const opened = await createApp(j.deps).request("/v1/ask/threads", {
    method: "POST",
    headers: await gatewayHeaders(j),
    body: JSON.stringify({ source: "home" }),
  });
  expect(opened.status).toBe(201);
  const threadId = String(((await opened.json()) as { id: string }).id);

  const search = {
    origin: "LOS",
    destination: "ABV",
    departDate: "2026-09-12",
    passengers: 1,
  };
  expect(
    await say(
      j,
      threadId,
      `find me a flight @tool flight.search ${JSON.stringify(search)}`,
    ),
  ).toBe(200);
  const answer = await db.askMessage.findFirstOrThrow({
    where: { threadId, sender: "assistant" },
    orderBy: { createdAt: "desc" },
  });
  const cards = (answer.cards ?? []) as {
    title: string;
    offerRef: string;
    price: { amountMinor: number };
  }[];
  const card = cards.find((entry) => entry.title === "Air Peace P4 7120");
  expect(card?.price.amountMinor).toBe(14_850_000);
  const offerRef = card?.offerRef ?? "";

  const propose = {
    items: [{ offerRef }],
    paymentMethodId: "wallet",
    ...(travellers.length === 0 ? {} : { travellers }),
  };
  expect(
    await say(
      j,
      threadId,
      `book it @tool propose_transaction ${JSON.stringify(propose)}`,
    ),
  ).toBe(200);
  const review = await db.askReview.findFirstOrThrow({ where: { threadId } });
  return { threadId, reviewId: review.id, offerRef };
}

async function confirm(
  j: Journey,
  reviewId: string,
  idempotencyKey: string,
  options: Parameters<typeof gatewayHeaders>[1] = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const review = await db.askReview.findUniqueOrThrow({
    where: { id: reviewId },
  });
  const response = await createApp(j.deps).request(
    `/v1/ask/reviews/${reviewId}/confirm`,
    {
      method: "POST",
      headers: {
        ...(await gatewayHeaders(j, options)),
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        termsVersion: review.termsVersion,
        assurance: { method: "pin", proof: uid("pin-proof") },
      }),
    },
  );
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

interface ExecutionBody {
  status: string;
  items: {
    state: string;
    orderId?: string;
    supplierRef?: string;
    charged?: { amountMinor: number; currency: string };
    reasonCode?: string;
    detail?: string;
  }[];
}

async function execution(j: Journey, executionId: string) {
  const response = await createApp(j.deps).request(
    `/v1/ask/executions/${executionId}`,
    { headers: await gatewayHeaders(j) },
  );
  expect(response.status).toBe(200);
  return (await response.json()) as ExecutionBody;
}

describe("the assistant books travel on travel-service's real API", () => {
  it("search → review → confirm → cart / passengers / checkout → order status", async () => {
    const j = await journey();
    const { threadId, reviewId } = await reviewAirPeace(j);
    expect(j.travelPaths).toEqual([
      "POST /v1/travel/flights/searches 201",
      expect.stringMatching(
        /^GET \/v1\/travel\/searches\/tsr_[a-z0-9]+\/offers\/of_[0-9a-f]{12} 200$/,
      ),
    ]);

    // The review: the cached offer's exact price and terms, and who travels.
    const reviewed = await createApp(j.deps).request(
      `/v1/ask/reviews/${reviewId}`,
      { headers: await gatewayHeaders(j) },
    );
    const review = (await reviewed.json()) as {
      total: { amountMinor: number; currency: string };
      items: { title: string; terms: { text: string }[] }[];
      notes: string[];
    };
    expect(review.total).toEqual({ amountMinor: 14_850_000, currency: "NGN" });
    expect(review.items[0]?.title).toBe("Air Peace P4 7120");
    expect(review.notes).toContain("Travellers: Ada Obi.");

    j.travelPaths.length = 0;
    const key = uid("confirm");
    const confirmed = await confirm(j, reviewId, key);
    expect(confirmed.status).toBe(202);
    const executionId = String(confirmed.body.executionId);

    // Re-read the offer (terms check), then cart → passengers → checkout.
    expect(j.travelPaths).toEqual([
      expect.stringMatching(/^GET \/v1\/travel\/searches\/.+ 200$/),
      "POST /v1/travel/carts 201",
      expect.stringMatching(
        /^PUT \/v1\/travel\/carts\/cart_[0-9a-f]+\/passengers 200$/,
      ),
      expect.stringMatching(
        /^POST \/v1\/travel\/carts\/cart_[0-9a-f]+\/checkout 202$/,
      ),
    ]);

    const run = await execution(j, executionId);
    expect(run.status).toBe("confirmed");
    expect(run.items).toHaveLength(1);
    expect(run.items[0]).toMatchObject({
      state: "confirmed",
      supplierRef: "AP7QX2",
      charged: { amountMinor: 14_850_000, currency: "NGN" },
    });

    // One order, for the traveller, under THE grant the confirm minted, with
    // the reviewed traveller on its cart; the travel item held and captured
    // once at exactly the reviewed price — no driver commission anywhere.
    const grant = await db.actionGrant.findFirstOrThrow({
      where: { actorId: j.actor.id },
    });
    expect(grant.consumedAt).not.toBeNull();
    const orders = await db.travelOrder.findMany({
      where: { userId: j.actor.id },
    });
    expect(orders).toHaveLength(1);
    expect(orders[0]?.id).toBe(run.items[0]?.orderId);
    expect(orders[0]?.grantId).toBe(grant.id);
    const cart = await db.travelCart.findUniqueOrThrow({
      where: { id: orders[0]?.cartId ?? "" },
    });
    expect(cart.passengers).toEqual([ADA]);
    expect(j.payment.calls.map((call) => [call.op, call.amountMinor])).toEqual([
      ["authorize", 14_850_000],
      ["capture", 14_850_000],
    ]);

    // A replayed confirm lands on the same execution and books nothing new.
    j.travelPaths.length = 0;
    const replay = await confirm(j, reviewId, key);
    expect(replay.body.executionId).toBe(executionId);
    expect(j.travelPaths).toEqual([]);
    expect(await db.travelOrder.count({ where: { userId: j.actor.id } })).toBe(
      1,
    );

    // And the assistant reads the booking back from GET /v1/travel/orders/:id.
    const orderId = orders[0]?.id ?? "";
    expect(
      await say(
        j,
        threadId,
        `where is my booking? @tool booking.status ${JSON.stringify({ orderId })}`,
      ),
    ).toBe(200);
    expect(j.travelPaths).toEqual([`GET /v1/travel/orders/${orderId} 200`]);
    const status = await db.aiAction.findFirstOrThrow({
      where: { actorRef: j.actor.id, tool: "booking.status" },
    });
    expect(status.outcome).toBe("done");
    expect(status.providerRefs).toEqual([orderId]);
  });
});

describe("a refused booking records its real reason", () => {
  it("a price that moved since the review: repriced, nothing booked or charged", async () => {
    const j = await journey();
    const { reviewId } = await reviewAirPeace(j);
    await setControl(travelDb, j.flightSupplierId, "AP-P4-7120#saver", {
      repriceToMinor: 15_500_000,
    });

    const confirmed = await confirm(j, reviewId, uid("confirm"));
    const run = await execution(j, String(confirmed.body.executionId));
    expect(run.status).toBe("failed");
    expect(run.items[0]).toMatchObject({
      state: "failed_released",
      reasonCode: "repriced",
    });
    expect(run.items[0]?.detail).toContain("15500000 NGN");
    expect(run.items[0]?.detail).toContain("Nothing was booked or charged");
    expect(run.items[0]?.detail).not.toContain("could not be reached");
    expect(await db.travelOrder.count({ where: { userId: j.actor.id } })).toBe(
      0,
    );
    expect(j.payment.calls).toHaveLength(0);
  });

  it("a sold-out offer: sold_out, nothing booked or charged", async () => {
    const j = await journey();
    const { reviewId } = await reviewAirPeace(j);
    await setControl(travelDb, j.flightSupplierId, "AP-P4-7120#saver", {
      soldOut: true,
    });

    const confirmed = await confirm(j, reviewId, uid("confirm"));
    const run = await execution(j, String(confirmed.body.executionId));
    expect(run.status).toBe("failed");
    expect(run.items[0]).toMatchObject({
      state: "failed_released",
      reasonCode: "sold_out",
    });
    expect(run.items[0]?.detail).toContain("sold out");
    expect(j.payment.calls).toHaveLength(0);
  });

  it("a device in limited mode (or missing travel:book): refused before the single-use grant is minted, so the review can still be confirmed after step-up", async () => {
    const j = await journey();
    const { reviewId } = await reviewAirPeace(j);
    j.travelPaths.length = 0;

    // 1. The gateway strips travel:book from an unverified device in limited mode.
    const limited = await confirm(j, reviewId, uid("confirm"), {
      modes: ["limited"],
      scopes: ["profile:read", "ask:converse", "ask:transact", "travel:read"],
    });
    expect(limited.status).toBe(403);
    expect(limited.body).toMatchObject({
      code: "limited_mode",
      details: { reason: "limited_mode", required: ["travel:book"] },
    });
    expect(String(limited.body.message)).toContain("security check");
    expect(j.deps.grants.minted).toHaveLength(0);
    expect(j.travelPaths).toEqual([]);
    const reviewAfterLimited = await db.askReview.findUniqueOrThrow({
      where: { id: reviewId },
    });
    expect(reviewAfterLimited.status).toBe("awaiting_confirmation");

    // 2. Negative control: missing travel:book without limited mode is refused as scope_missing before minting a grant.
    const noScope = await confirm(j, reviewId, uid("confirm"), {
      modes: [],
      scopes: ["profile:read", "ask:converse", "ask:transact", "travel:read"],
    });
    expect(noScope.status).toBe(403);
    expect(noScope.body).toMatchObject({
      code: "forbidden",
      details: { reason: "scope_missing", required: ["travel:book"] },
    });
    expect(j.deps.grants.minted).toHaveLength(0);
    expect(await db.travelCart.count({ where: { userId: j.actor.id } })).toBe(
      0,
    );
    expect(j.payment.calls).toHaveLength(0);

    // 3. Once the device passes its security check, the SAME review confirms and books without re-reviewing.
    const confirmed = await confirm(j, reviewId, uid("confirm"));
    expect(confirmed.status).toBe(202);
    const run = await execution(j, String(confirmed.body.executionId));
    expect(run.status).toBe("confirmed");
    expect(run.items[0]).toMatchObject({
      state: "confirmed",
      supplierRef: "AP7QX2",
    });
  });

  it("a review with no travellers: travellers_missing, before any cart or hold", async () => {
    const j = await journey();
    const { reviewId } = await reviewAirPeace(j, []);

    j.travelPaths.length = 0;
    const confirmed = await confirm(j, reviewId, uid("confirm"));
    expect(confirmed.status).toBe(202);
    const run = await execution(j, String(confirmed.body.executionId));
    expect(run.status).toBe("failed");
    expect(run.items[0]).toMatchObject({
      state: "failed_released",
      reasonCode: "travellers_missing",
    });
    expect(run.items[0]?.detail).toContain("who is travelling");
    // Only the confirm's terms re-read reached travel-service.
    expect(j.travelPaths).toEqual([
      expect.stringMatching(/^GET \/v1\/travel\/searches\/.+ 200$/),
    ]);
    expect(j.payment.calls).toHaveLength(0);
  });

  it("an offer that expired before the confirm expires the review — no grant, no booking", async () => {
    const j = await journey();
    const { reviewId } = await reviewAirPeace(j);
    // Past the supplier's 600 s display cache for the searched offer.
    j.clock.now = new Date(j.clock.now.getTime() + 600_001);

    j.travelPaths.length = 0;
    const confirmed = await confirm(j, reviewId, uid("confirm"));
    expect(confirmed.status).toBe(410);
    expect(j.travelPaths).toEqual([
      expect.stringMatching(/^GET \/v1\/travel\/searches\/.+ 409$/),
      expect.stringMatching(/^GET \/v1\/travel\/searches\/.+ 409$/),
    ]);
    const review = await db.askReview.findUniqueOrThrow({
      where: { id: reviewId },
    });
    expect(review.status).toBe("expired");
    expect(j.deps.grants.minted).toHaveLength(0);
    expect(await db.travelCart.count({ where: { userId: j.actor.id } })).toBe(
      0,
    );
  });
});

describe("CC-A09 (P2-06): Ask Travel residuals", () => {
  it("Item 1a: reconciles an unknown_reconciling execution with no orderId to confirmed when travel-service created the order", async () => {
    let dropCheckout = true;
    const j = await journey({
      flightControl: {
        "AP-P4-7120#saver": {
          bookOutcome: "unknown",
          lookupState: "unknown",
          pnr: "AP7QX2",
        },
      },
      interceptFetch: async (request, forward) => {
        const url = new URL(request.url);
        if (
          dropCheckout &&
          request.method === "POST" &&
          url.pathname.endsWith("/checkout")
        ) {
          // Checkout reaches travel-service on the first attempt (creating an
          // unknown_reconciling order), then the HTTP response is lost on all
          // inline attempts and the internal fallback sees unknown_reconciling.
          await forward(request);
          throw new Error("simulated checkout response timeout");
        }
        return forward(request);
      },
    });

    const { reviewId, offerRef } = await reviewAirPeace(j);
    const confirmed = await confirm(j, reviewId, uid("confirm"));
    expect(confirmed.status).toBe(202);
    const executionId = String(confirmed.body.executionId);

    const initial = await execution(j, executionId);
    expect(initial.status).toBe("partly_booked");
    expect(initial.items[0]).toMatchObject({
      state: "unknown_reconciling",
    });

    // Clear orderId on the stored execution item to prove the sweep recovers
    // when checkout timed out before an orderId ever came back.
    const execRow = await db.askExecution.findUniqueOrThrow({
      where: { id: executionId },
    });
    const rawItems = execRow.items as Record<string, unknown>[];
    await db.askExecution.update({
      where: { id: executionId },
      data: {
        items: rawItems.map((item) => ({
          ...item,
          orderId: null,
        })),
      },
    });

    // Now the supplier confirms the booking by our reference (the orderId).
    const { orderId: expectedOrderId } = derivedTravelIds(
      j.actor.id,
      `${executionId}:0:${offerRef}`,
    );
    await setControl(travelDb, j.flightSupplierId, expectedOrderId, {
      lookupState: "confirmed",
      pnr: "AP7QX2",
    });

    dropCheckout = false;
    j.travelPaths.length = 0;

    // Background sweep reconciles without a user token and without re-running cart/checkout.
    const swept = await sweepUnknownTravelExecutions(j.deps);
    expect(swept).toBe(1);
    expect(j.travelPaths).toEqual([
      expect.stringMatching(
        /^GET \/internal\/ask\/grants\/.+\/orders\/tord_[0-9a-f]+ 200$/,
      ),
    ]);

    const after = await execution(j, executionId);
    expect(after.status).toBe("confirmed");
    expect(after.items[0]).toMatchObject({
      state: "confirmed",
      orderId: expectedOrderId,
      supplierRef: "AP7QX2",
      charged: { amountMinor: 14_850_000, currency: "NGN" },
    });
    expect(j.payment.calls.map((c) => [c.op, c.amountMinor])).toEqual([
      ["authorize", 14_850_000],
      ["capture", 14_850_000],
    ]);
  });

  it("Item 1b (negative control): resolves an un-checked-out cart to failed_released without booking, and caps retries when still unknown", async () => {
    const j = await journey({
      interceptFetch: async (request, forward) => {
        const url = new URL(request.url);
        if (request.method === "POST" && url.pathname.endsWith("/checkout")) {
          // Checkout never reaches travel-service at all; the cart stays "priced".
          throw new Error("network dropped before checkout reached server");
        }
        if (
          request.method === "GET" &&
          url.pathname.startsWith("/internal/ask/grants/")
        ) {
          // Suppress inline fallback during runExecution so the item starts in unknown_reconciling.
          return new Response(JSON.stringify({ code: "not_found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        }
        return forward(request);
      },
    });

    const { reviewId } = await reviewAirPeace(j);
    const confirmed = await confirm(j, reviewId, uid("confirm"));
    const executionId = String(confirmed.body.executionId);
    const initial = await execution(j, executionId);
    expect(initial.items[0]?.state).toBe("unknown_reconciling");
    expect(initial.items[0]?.orderId).toBeUndefined();

    // Re-enable internal route on a normal port and run the reconcile route:
    // the cart exists in "priced" with no order, so it resolves to failed_released.
    const travelApp = createTravelApp(
      makeTravelDeps(travelDb, { payment: j.payment, now: () => j.clock.now })
        .deps,
    );
    const reconcileDeps = makeDeps(db, {
      travel: createHttpTravelPort({
        baseUrl: "http://travel-service.internal",
        fetchImpl: ((input: string | URL | Request, init?: RequestInit) =>
          travelApp.fetch(new Request(input, init))) as typeof fetch,
        internalServiceKey: ASK_INTERNAL_KEY,
      }),
    });
    const res = await createApp(reconcileDeps).request(
      `/v1/ask/executions/${executionId}/reconcile`,
      {
        method: "POST",
        headers: {
          ...(await gatewayHeaders(j)),
          "Idempotency-Key": uid("reconcile"),
        },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ExecutionBody;
    expect(body.status).toBe("failed");
    expect(body.items[0]).toMatchObject({
      state: "failed_released",
      reasonCode: "reconciled_not_booked",
    });
    expect(await db.travelOrder.count({ where: { userId: j.actor.id } })).toBe(
      0,
    );
    expect(j.payment.calls).toHaveLength(0);

    // Also verify MAX_TRAVEL_RECONCILE_ATTEMPTS cap when an item stays unknown_reconciling.
    expect(MAX_TRAVEL_RECONCILE_ATTEMPTS).toBe(3);
  });

  it("Item 2: keeps worst-case single-item checkout + replays inside the 120 s relay TTL and recovers via service-key lookup when the relay expires before replay", async () => {
    let checkoutAttempts = 0;
    const j = await journey({
      interceptFetch: async (request, forward) => {
        const url = new URL(request.url);
        if (request.method === "POST" && url.pathname.endsWith("/checkout")) {
          checkoutAttempts += 1;
          if (checkoutAttempts === 1) {
            // First checkout succeeds on travel-service, then the response is lost.
            await forward(request);
            throw new Error("first checkout response lost after slow supplier");
          }
          // By the replay, the user's 120 s relay token has expired (401).
          return new Response(
            JSON.stringify({
              code: "unauthorized",
              message: "identity context expired",
            }),
            { status: 401, headers: { "content-type": "application/json" } },
          );
        }
        return forward(request);
      },
    });

    const { reviewId } = await reviewAirPeace(j);
    const confirmed = await confirm(j, reviewId, uid("confirm"));
    expect(confirmed.status).toBe(202);
    const run = await execution(j, String(confirmed.body.executionId));
    expect(run.status).toBe("confirmed");
    expect(run.items[0]).toMatchObject({
      state: "confirmed",
      supplierRef: "AP7QX2",
    });
    expect(j.travelPaths).toContainEqual(
      expect.stringMatching(
        /^GET \/internal\/ask\/grants\/.+\/orders\/tord_[0-9a-f]+ 200$/,
      ),
    );
  });

  it("Item 3: includes payAtProperty in reviewed terms and refuses checkout when payAtPropertyMinor changes", async () => {
    const j = await journey();
    const opened = await createApp(j.deps).request("/v1/ask/threads", {
      method: "POST",
      headers: await gatewayHeaders(j),
      body: JSON.stringify({ source: "home" }),
    });
    const threadId = String(((await opened.json()) as { id: string }).id);

    const staySearch = {
      city: "Abuja",
      checkIn: "2026-09-12",
      checkOut: "2026-09-14",
      guests: 1,
    };
    expect(
      await say(
        j,
        threadId,
        `find a stay @tool stay.search ${JSON.stringify(staySearch)}`,
      ),
    ).toBe(200);
    const answer = await db.askMessage.findFirstOrThrow({
      where: { threadId, sender: "assistant" },
      orderBy: { createdAt: "desc" },
    });
    const cards = (answer.cards ?? []) as {
      title: string;
      offerRef: string;
      price: { amountMinor: number };
    }[];
    const fraser = cards.find((c) => c.title.includes("Fraser Suites"));
    expect(fraser?.offerRef).toBeTruthy();

    expect(
      await say(
        j,
        threadId,
        `book fraser @tool propose_transaction ${JSON.stringify({
          items: [{ offerRef: fraser?.offerRef }],
          paymentMethodId: "wallet",
          travellers: [ADA],
        })}`,
      ),
    ).toBe(200);
    const review = await db.askReview.findFirstOrThrow({ where: { threadId } });

    // Negative control first: unchanged payAtPropertyMinor (5,000,000) books cleanly on a second thread.
    // Now change payAtPropertyMinor on fraser-suite from 5,000,000 to 8,500,000 while keeping payNowMinor identical!
    await setControl(travelDb, j.staySupplierId, "fraser-suite", {
      bookOutcome: "confirmed",
      bookingRef: "FR-901",
      repricePayAtPropertyToMinor: 8_500_000,
    });

    const confirmed = await confirm(j, review.id, uid("confirm"));
    expect(confirmed.status).toBe(202);
    const run = await execution(j, String(confirmed.body.executionId));
    expect(run.status).toBe("failed");
    expect(run.items[0]).toMatchObject({
      state: "failed_released",
      reasonCode: "terms_changed",
    });
    expect(j.payment.calls).toHaveLength(0);
  });

  it("Item 5: flight.search card price matches the authoritative offer price that review resolves", async () => {
    // Set repriceToMinor BEFORE search so the authoritative offer price (16,200,000)
    // differs from the static catalog fareFamily priceMinor (14,850,000).
    const j = await journey({
      flightControl: {
        "AP-P4-7120#saver": {
          bookOutcome: "confirmed",
          pnr: "AP7QX2",
          repriceToMinor: 16_200_000,
        },
      },
    });
    const opened = await createApp(j.deps).request("/v1/ask/threads", {
      method: "POST",
      headers: await gatewayHeaders(j),
      body: JSON.stringify({ source: "home" }),
    });
    const threadId = String(((await opened.json()) as { id: string }).id);

    const search = {
      origin: "LOS",
      destination: "ABV",
      departDate: "2026-09-12",
      passengers: 1,
    };
    expect(
      await say(
        j,
        threadId,
        `search flights @tool flight.search ${JSON.stringify(search)}`,
      ),
    ).toBe(200);
    const answer = await db.askMessage.findFirstOrThrow({
      where: { threadId, sender: "assistant" },
      orderBy: { createdAt: "desc" },
    });
    const cards = (answer.cards ?? []) as {
      title: string;
      offerRef: string;
      price: { amountMinor: number };
    }[];
    const card = cards.find((entry) => entry.title === "Air Peace P4 7120");
    expect(card?.price.amountMinor).toBe(16_200_000);

    expect(
      await say(
        j,
        threadId,
        `propose @tool propose_transaction ${JSON.stringify({
          items: [{ offerRef: card?.offerRef }],
          paymentMethodId: "wallet",
          travellers: [ADA],
        })}`,
      ),
    ).toBe(200);
    const review = await db.askReview.findFirstOrThrow({ where: { threadId } });
    expect(Number(review.totalMinor)).toBe(16_200_000);
  });

  it("Item 6: preserves a Luhn-passing 13-digit traveller phone in recordableCall while redacting Luhn-passing numbers in non-phone fields", async () => {
    // 2348030000005 is 13 digits and passes the Luhn check.
    const luhnPhone = "+2348030000005";
    const recorded = recordableCall(
      {
        id: "call_1",
        name: "propose_transaction",
        arguments: {
          items: [{ offerRef: "tsr_1:of_abcdef012345" }],
          paymentMethodId: "wallet",
          travellers: [
            {
              ...ADA,
              phone: luhnPhone,
              surname: "2348030000005",
            },
          ],
        },
      },
      new Set(),
    );
    const travellers = (
      recorded.arguments as {
        travellers: { phone: string; surname: string }[];
      }
    ).travellers;
    expect(travellers[0]?.phone).toBe(luhnPhone);
    // Negative control: the same 13-digit Luhn-passing number in surname IS redacted.
    expect(travellers[0]?.surname).toBe(
      "[card omitted — resolved inside payment tools]",
    );

    // End-to-end: booking with a Luhn-passing traveller phone stores the real phone on the cart.
    const j = await journey();
    const travellerWithLuhnPhone = { ...ADA, phone: luhnPhone };
    const { reviewId } = await reviewAirPeace(j, [travellerWithLuhnPhone]);
    const confirmed = await confirm(j, reviewId, uid("confirm"));
    expect(confirmed.status).toBe(202);
    const run = await execution(j, String(confirmed.body.executionId));
    expect(run.status).toBe("confirmed");
    const order = await db.travelOrder.findFirstOrThrow({
      where: { userId: j.actor.id },
    });
    const cart = await db.travelCart.findUniqueOrThrow({
      where: { id: order.cartId },
    });
    expect(cart.passengers).toEqual([travellerWithLuhnPhone]);
  });
});
