/**
 * The HTTP marketplace port against a real socket (tests/ride-upstream.ts):
 *
 *   - identity: every call carries exactly the signed internal context
 *     ride-service's RequireIdentity verifies — `x-auth-user-id`,
 *     `x-auth-user-role`, `x-auth-city-id`, `x-auth-issued-at`,
 *     `x-auth-signature` — and none of the legacy `X-User-*` / `X-Service-Key`
 *     headers. With a pinned clock the wire headers equal the cross-language
 *     vectors ride-service's Go tests accept (tests/ride-context-vectors.ts);
 *   - an undelegable principal (admin/service/ops, unsignable fields) never
 *     reaches the network;
 *   - strict financial parsing: ride-service's real shapes parse; a missing,
 *     bare, fractional, stringly, negative or cross-currency amount — or a
 *     missing `withdrawn` flag — is refused, never defaulted. An unreadable
 *     answer to the BINDING select is an uncertain outcome (converge by
 *     querying), never a definite failure.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ContractError } from "@ubi/contracts";

import { ASK_VECTORS } from "./ride-context-vectors";
import {
  goAward,
  goOffer,
  goQuote,
  goRequest,
  goSnapshot,
  startRideUpstream,
  wireMoney,
  type RideUpstream,
} from "./ride-upstream";
import { parseRideContextKeys, signRideContext } from "../src/lib/ride-context";
import {
  createHttpMarketplacePort,
  MarketplaceMalformedResponseError,
  MarketplaceTimeoutError,
  type MarketplacePort,
  type MpPrincipal,
} from "../src/ports/marketplace-port";

const SECRET = "ask-port-test-ride-context-secret-01";

let upstream: RideUpstream;

beforeAll(async () => {
  upstream = await startRideUpstream();
});

afterAll(async () => {
  await upstream.close();
});

beforeEach(() => {
  upstream.received.length = 0;
  upstream.reply = () => ({
    status: 404,
    body: { code: "not_found", message: "no such request" },
  });
});

function rider(): MpPrincipal {
  return { id: randomUUID(), role: "rider", cityId: "LOS" };
}

function portWith(
  options: {
    keys?: readonly string[];
    now?: () => Date;
    timeoutMs?: number;
  } = {},
): MarketplacePort {
  return createHttpMarketplacePort({
    baseUrl: upstream.url,
    signingKeys: options.keys ?? [SECRET],
    now: options.now,
    timeoutMs: options.timeoutMs,
  });
}

const QUOTE_INPUT = {
  service: "ride",
  vehicleClass: "go",
  pickupLat: 6.6,
  pickupLng: 3.35,
  dropoffLat: 6.51,
  dropoffLng: 3.38,
} as const;

const IDENTITY_HEADERS = [
  "x-auth-city-id",
  "x-auth-issued-at",
  "x-auth-signature",
  "x-auth-user-id",
  "x-auth-user-role",
];

function identityHeaderNames(headers: Readonly<Record<string, string>>) {
  return Object.keys(headers)
    .filter((name) => name.startsWith("x-auth-"))
    .sort();
}

// ---------------------------------------------------------------------------
// The delegated identity on the wire
// ---------------------------------------------------------------------------

describe("the delegated identity on the wire", () => {
  it.each(ASK_VECTORS)(
    "is exactly the vector ride-service's verifier accepts: $name",
    async (vector) => {
      const port = portWith({
        keys: parseRideContextKeys(vector.secret),
        now: () => new Date(vector.issuedAt * 1000),
      });
      const principal: MpPrincipal = {
        id: vector.userId,
        role: vector.role,
        cityId: vector.cityId,
      };

      expect(await port.getAward(principal, randomUUID())).toBeNull();

      expect(upstream.received).toHaveLength(1);
      const { headers } = upstream.received[0] as {
        headers: Record<string, string>;
      };
      expect(identityHeaderNames(headers)).toEqual(IDENTITY_HEADERS);
      expect(headers["x-auth-user-id"]).toBe(vector.userId);
      expect(headers["x-auth-user-role"]).toBe(vector.role);
      expect(headers["x-auth-city-id"]).toBe(vector.cityId);
      expect(headers["x-auth-issued-at"]).toBe(String(vector.issuedAt));
      expect(headers["x-auth-signature"]).toBe(vector.signature);
      // The legacy header set ride-service never read, and the service key it
      // has no use for, are gone.
      for (const legacy of [
        "x-user-id",
        "x-user-role",
        "x-service-key",
        "x-internal-service",
      ]) {
        expect(headers[legacy]).toBeUndefined();
      }
    },
  );

  it("signs every call afresh at send time, so a retry is never a replay", async () => {
    let clock = 1_790_000_000_000;
    const port = portWith({
      now: () => {
        clock += 61_000;
        return new Date(clock);
      },
    });
    const principal = rider();
    await port.getAward(principal, randomUUID());
    await port.getAward(principal, randomUUID());

    const [first, second] = upstream.received;
    expect(first?.headers["x-auth-issued-at"]).not.toBe(
      second?.headers["x-auth-issued-at"],
    );
    for (const request of [first, second]) {
      const issuedAt = Number(request?.headers["x-auth-issued-at"]);
      expect(request?.headers["x-auth-signature"]).toBe(
        signRideContext(SECRET, principal.id, "rider", "LOS", issuedAt),
      );
    }
  });

  it("keeps the idempotency key on money/state POSTs alongside the identity", async () => {
    const principal = rider();
    upstream.reply = () => ({
      status: 201,
      body: goRequest({ requesterId: principal.id }),
    });
    await portWith().prepareRequest(principal, {
      quoteId: "q-1",
      requestedFareMinor: 200_000,
      currency: "NGN",
      paymentMethodId: "pm_wallet",
      idempotencyKey: "mp.prepare:stable-key-1",
    });

    const [request] = upstream.received;
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/v1/mp/requests");
    expect(request?.headers["idempotency-key"]).toBe("mp.prepare:stable-key-1");
    expect(identityHeaderNames(request?.headers ?? {})).toEqual(
      IDENTITY_HEADERS,
    );
    expect(JSON.parse(request?.body ?? "{}")).toMatchObject({
      quoteId: "q-1",
      requestedFareMinor: { amountMinor: 200_000, currency: "NGN" },
    });
  });

  it("sends the identity unsigned only when no key is configured (development)", async () => {
    await portWith({ keys: [] }).getAward(rider(), randomUUID());
    const [request] = upstream.received;
    expect(identityHeaderNames(request?.headers ?? {})).toEqual([
      "x-auth-city-id",
      "x-auth-user-id",
      "x-auth-user-role",
    ]);
  });

  it("never sends an elevated or unsignable principal to ride-service", async () => {
    const port = portWith();
    const refused: MpPrincipal[] = [
      { id: randomUUID(), role: "admin", cityId: "LOS" },
      { id: randomUUID(), role: "service", cityId: "LOS" },
      { id: randomUUID(), role: "ops_admin", cityId: "LOS" },
      { id: `${randomUUID()}|admin`, role: "rider", cityId: "LOS" },
      { id: randomUUID(), role: "rider", cityId: "" },
    ];
    for (const principal of refused) {
      await expect(
        port.viewOffers(principal, randomUUID()),
      ).rejects.toMatchObject({
        code: "forbidden",
      });
      // The binding call surfaces the refusal as a refusal — it is NOT dressed
      // up as an uncertain outcome that would trigger an award query.
      const selection = port.select(principal, {
        requestId: randomUUID(),
        bidId: randomUUID(),
        requestVersion: 1,
        bidVersion: 1,
        idempotencyKey: "mp.select:k",
      });
      await expect(selection).rejects.toMatchObject({ code: "forbidden" });
      await expect(selection).rejects.not.toBeInstanceOf(
        MarketplaceTimeoutError,
      );
    }
    expect(upstream.received).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Strict financial parsing
// ---------------------------------------------------------------------------

describe("ride-service's real response shapes", () => {
  it("parse into the port's minor-unit values", async () => {
    const principal = rider();
    const port = portWith();
    const request = goRequest({ requesterId: principal.id });
    const withFee = goOffer({
      amountMinor: wireMoney(250_000),
      bookingFeeMinor: wireMoney(5_000),
      totalMinor: wireMoney(255_000),
      whyRecommended: "Closest verified driver",
    });
    const plain = goOffer({ amountMinor: wireMoney(240_000), withdrawn: true });
    const award = goAward({
      requestId: String(request.requestId),
      bidId: String(withFee.bidId),
      requesterId: principal.id,
    });

    upstream.reply = (incoming) => {
      if (incoming.path.startsWith("/v1/mp/quote")) {
        return { status: 200, body: goQuote() };
      }
      if (incoming.path.endsWith("/select")) {
        return { status: 202, body: { award, pickupPin: "4821" } };
      }
      if (incoming.path.endsWith("/award")) {
        return { status: 200, body: award };
      }
      if (incoming.path.endsWith("/cancel")) {
        return {
          status: 200,
          body: { ...request, state: "cancelled", closeReason: "cancelled" },
        };
      }
      return { status: 200, body: goSnapshot(request, [withFee, plain]) };
    };

    const quote = await port.quote(principal, QUOTE_INPUT);
    expect(quote).toMatchObject({
      currency: "NGN",
      suggestedFareMinor: 200_000,
      minimumFareMinor: 150_000,
      maximumFareMinor: 400_000,
      policyVersion: 3,
    });

    const snapshot = await port.viewOffers(
      principal,
      String(request.requestId),
    );
    expect(snapshot?.request).toMatchObject({
      requesterId: principal.id,
      requestedFareMinor: 200_000,
      currency: "NGN",
      revision: 1,
      version: 1,
    });
    expect(snapshot?.request.closeReason).toBeUndefined();
    expect(snapshot?.award).toBeNull();
    expect(snapshot?.offers).toHaveLength(2);
    expect(snapshot?.offers[0]).toMatchObject({
      amountMinor: 250_000,
      totalMinor: 255_000,
      currency: "NGN",
      withdrawn: false,
      whyRecommended: "Closest verified driver",
    });
    expect(snapshot?.offers[1]).toMatchObject({
      amountMinor: 240_000,
      withdrawn: true,
    });
    // No booking fee and no server total: the total is simply not stated.
    expect(snapshot?.offers[1]?.totalMinor).toBeUndefined();
    expect(snapshot?.offers[1]?.whyRecommended).toBeUndefined();

    const selected = await port.select(principal, {
      requestId: String(request.requestId),
      bidId: String(withFee.bidId),
      requestVersion: 1,
      bidVersion: 1,
      idempotencyKey: "mp.select:k",
    });
    expect(selected.pickupPin).toBe("4821");
    expect(selected.award).toMatchObject({
      fareMinor: 250_000,
      commissionMinor: 25_000,
      slot: "current",
      state: "pending",
    });
    expect(selected.award.resolvedAt).toBeUndefined();

    expect(
      await port.getAward(principal, String(request.requestId)),
    ).toMatchObject({ awardId: award.awardId, fareMinor: 250_000 });
    expect(
      await port.cancel(principal, String(request.requestId), "k"),
    ).toMatchObject({ state: "cancelled", closeReason: "cancelled" });
  });
});

describe("malformed financial data fails closed", () => {
  const quoteCases: readonly [string, Record<string, unknown>][] = [
    ["a missing envelope currency", { currency: undefined }],
    ["a lowercase currency", { currency: "ngn" }],
    ["a bare-number fare (no currency)", { suggestedFareMinor: 200_000 }],
    [
      "a stringly amount",
      { suggestedFareMinor: { amountMinor: "200000", currency: "NGN" } },
    ],
    ["a fractional amount", { suggestedFareMinor: wireMoney(199_999.5) }],
    ["a negative floor", { minimumFareMinor: wireMoney(-1) }],
    ["a zero suggested fare", { suggestedFareMinor: wireMoney(0) }],
    ["a missing maximum", { maximumFareMinor: undefined }],
    [
      "an amount without a currency",
      { maximumFareMinor: { amountMinor: 400_000 } },
    ],
    [
      "a cross-currency amount",
      { maximumFareMinor: wireMoney(400_000, "GHS") },
    ],
    [
      "inverted bounds",
      {
        minimumFareMinor: wireMoney(500_000),
        maximumFareMinor: wireMoney(400_000),
      },
    ],
    ["a missing policy version", { policyVersion: undefined }],
  ];

  it.each(quoteCases)("quote: %s", async (_name, overrides) => {
    upstream.reply = () => ({ status: 200, body: goQuote(overrides) });
    const attempt = portWith().quote(rider(), QUOTE_INPUT);
    await expect(attempt).rejects.toBeInstanceOf(
      MarketplaceMalformedResponseError,
    );
    await expect(attempt).rejects.toMatchObject({
      code: "service_unavailable",
      details: { reason: "malformed_marketplace_response", what: "quote" },
    });
  });

  const principal = rider();
  const snapshotCases: readonly [string, () => Record<string, unknown>][] = [
    [
      "an offer without an amount",
      () =>
        goSnapshot(goRequest({ requesterId: principal.id }), [
          goOffer({ amountMinor: undefined }),
        ]),
    ],
    [
      "an offer without the withdrawn flag",
      () =>
        goSnapshot(goRequest({ requesterId: principal.id }), [
          goOffer({ withdrawn: undefined }),
        ]),
    ],
    [
      "an offer in another currency than the request",
      () =>
        goSnapshot(goRequest({ requesterId: principal.id }), [
          goOffer({ amountMinor: wireMoney(250_000, "KES") }),
        ]),
    ],
    [
      "a booking fee without the server total",
      () =>
        goSnapshot(goRequest({ requesterId: principal.id }), [
          goOffer({ bookingFeeMinor: wireMoney(5_000) }),
        ]),
    ],
    [
      "a total in another currency than the bid",
      () =>
        goSnapshot(goRequest({ requesterId: principal.id }), [
          goOffer({ totalMinor: wireMoney(255_000, "USD") }),
        ]),
    ],
    [
      "a request without its requested fare",
      () =>
        goSnapshot(
          goRequest({
            requesterId: principal.id,
            requestedFareMinor: undefined,
          }),
          [goOffer()],
        ),
    ],
    [
      "a request fare as a bare number",
      () =>
        goSnapshot(
          goRequest({ requesterId: principal.id, requestedFareMinor: 200_000 }),
          [goOffer()],
        ),
    ],
    [
      "no offers list at all",
      () => ({ request: goRequest({ requesterId: principal.id }), seq: 1 }),
    ],
    [
      "a request version of zero",
      () =>
        goSnapshot(goRequest({ requesterId: principal.id, version: 0 }), []),
    ],
  ];

  it.each(snapshotCases)("offer snapshot: %s", async (_name, body) => {
    upstream.reply = () => ({ status: 200, body: body() });
    await expect(
      portWith().viewOffers(principal, randomUUID()),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      details: { reason: "malformed_marketplace_response" },
    });
  });

  const awardCases: readonly [string, Record<string, unknown>][] = [
    ["a missing commission", { commissionMinor: undefined }],
    ["a commission above the fare", { commissionMinor: wireMoney(300_000) }],
    [
      "a commission in another currency",
      { commissionMinor: wireMoney(25_000, "GHS") },
    ],
    ["a bare-number fare", { fareMinor: 250_000 }],
    ["an unknown award state", { state: "settled" }],
    ["an unknown slot", { slot: "later" }],
  ];

  it.each(awardCases)("award: %s", async (_name, overrides) => {
    upstream.reply = () => ({
      status: 200,
      body: goAward({
        requestId: randomUUID(),
        bidId: randomUUID(),
        requesterId: principal.id,
        ...overrides,
      }),
    });
    await expect(
      portWith().getAward(principal, randomUUID()),
    ).rejects.toBeInstanceOf(MarketplaceMalformedResponseError);
  });

  it("an unreadable answer to an ACCEPTED select is uncertain, never a definite failure", async () => {
    upstream.reply = (incoming) => ({
      status: 202,
      body: {
        award: goAward({
          requestId: randomUUID(),
          bidId: randomUUID(),
          requesterId: incoming.headers["x-auth-user-id"] ?? "",
          fareMinor: undefined,
        }),
      },
    });
    const attempt = portWith().select(principal, {
      requestId: randomUUID(),
      bidId: randomUUID(),
      requestVersion: 1,
      bidVersion: 1,
      idempotencyKey: "mp.select:k",
    });
    // The ops layer converges on an uncertain select by QUERYING the award.
    await expect(attempt).rejects.toBeInstanceOf(MarketplaceTimeoutError);
    await expect(attempt).rejects.toMatchObject({
      details: { reason: "malformed_select_response" },
    });
  });

  it("a select that does not answer in time is uncertain too", async () => {
    upstream.reply = () => ({ status: 202, body: {}, delayMs: 500 });
    const attempt = portWith({ timeoutMs: 50 }).select(principal, {
      requestId: randomUUID(),
      bidId: randomUUID(),
      requestVersion: 1,
      bidVersion: 1,
      idempotencyKey: "mp.select:k",
    });
    await expect(attempt).rejects.toBeInstanceOf(MarketplaceTimeoutError);
    await expect(attempt).rejects.toMatchObject({
      details: { reason: "marketplace_timeout" },
    });
  });
});

describe("ride-service refusals", () => {
  it("report an identity refusal as the assistant's outage, never as the user's 401", async () => {
    upstream.reply = () => ({
      status: 401,
      body: {
        code: "unauthorized",
        message: "this request's caller identity is not signed by the gateway",
      },
    });
    await expect(portWith().quote(rider(), QUOTE_INPUT)).rejects.toMatchObject({
      code: "service_unavailable",
      details: { reason: "delegation_refused", status: 401 },
    });
  });

  it("preserve the marketplace's canonical refusal codes", async () => {
    upstream.reply = () => ({
      status: 422,
      body: {
        code: "fare_out_of_bounds",
        message: "the requested fare is outside the server bounds",
        details: { maximumFareMinor: 400_000 },
      },
    });
    await expect(
      portWith().prepareRequest(rider(), {
        quoteId: "q-1",
        requestedFareMinor: 900_000,
        currency: "NGN",
        paymentMethodId: "pm_wallet",
        idempotencyKey: "mp.prepare:k",
      }),
    ).rejects.toMatchObject({
      code: "fare_out_of_bounds",
      details: { maximumFareMinor: 400_000 },
    });

    upstream.reply = () => ({
      status: 409,
      body: { code: "award_unresolved", message: "a selection is pending" },
    });
    await expect(
      portWith().select(rider(), {
        requestId: randomUUID(),
        bidId: randomUUID(),
        requestVersion: 1,
        bidVersion: 1,
        idempotencyKey: "mp.select:k",
      }),
    ).rejects.toMatchObject({ code: "award_unresolved" });
  });

  it("map a code outside the contract to service_unavailable", async () => {
    upstream.reply = () => ({
      status: 418,
      body: { code: "teapot", message: "no" },
    });
    const attempt = portWith().getAward(rider(), randomUUID());
    await expect(attempt).rejects.toBeInstanceOf(ContractError);
    await expect(attempt).rejects.toMatchObject({
      code: "service_unavailable",
      details: { status: 418 },
    });
  });

  it("treat a 2xx that is not JSON as unavailable, never as data", async () => {
    upstream.reply = () => ({ status: 200, raw: "<html>proxy error</html>" });
    await expect(portWith().quote(rider(), QUOTE_INPUT)).rejects.toMatchObject({
      code: "service_unavailable",
    });
  });
});
