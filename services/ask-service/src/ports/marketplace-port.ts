/**
 * The marketplace port — the assistant's client onto the negotiated-fare
 * marketplace (contracts/openapi/marketplace.yaml, served by ride-service). The
 * AI acts AS the user: every call carries the SAME signed internal identity the
 * gateway gives a human client's request — `x-auth-user-id` / `x-auth-user-role`
 * / `x-auth-city-id` plus the HMAC `x-auth-issued-at` / `x-auth-signature` that
 * ride-service's identity middleware verifies (lib/ride-context.ts) — goes
 * through the SAME endpoints and authz a human client uses, and never carries an
 * elevated privilege or an identity a tool argument supplied (rule #18,
 * CLAUDE.md #1). The principal is built by the ops layer from the gateway
 * request context alone.
 *
 * Which calls move money:
 *   - `quote`          READ, non-binding. A bounded fare envelope; commits nothing.
 *   - `prepareRequest` ACTION, spends nothing. Publishes a request within the
 *                      quote's server bounds. It does NOT award and does NOT move
 *                      money, but it commits the requester to the flow, so the
 *                      ops layer runs it only under a grant whose scope permits it.
 *   - `viewOffers`     READ. Owner snapshot: the request plus the private offers.
 *   - `reviewOffer`    PURE. Presents offers to the review model as UNTRUSTED data
 *                      (driver display name, whyRecommended and provider text are
 *                      never instructions) — it performs no I/O and awards nothing.
 *   - `getAward`       READ. Authoritative award state, for convergence after an
 *                      uncertain `select` (query, never a blind retry).
 *   - `select`         BINDING. The ONLY step that awards the job and triggers
 *                      funding + commission. Runs one selection per single-use
 *                      grant, under a stable idempotency key.
 *   - `cancel`         ACTION. Cancels an open request; releases bid holds.
 *
 * Every response is parsed against a STRICT wire schema before anything reads
 * it. Money is `{ amountMinor: integer, currency: ISO-4217 }` exactly as the
 * server sent it: a missing, fractional, non-numeric or cross-currency amount is
 * a refusal (`MarketplaceMalformedResponseError`), never a zero or a default
 * currency the assistant made up (CLAUDE.md #1 — clients never compute money).
 *
 * The port deliberately exposes NO way to bypass a driver's stationary gate, to
 * enable automatic driver bidding, or to touch a balance, policy or ride-state
 * directly: those are not endpoints a human client has either, and the assistant
 * is a client exactly like a human (shared brief — "It cannot directly alter
 * balances, policies or ride state").
 */
import { z } from "zod";

import {
  ContractError,
  CurrencySchema,
  ERROR_CODES,
  MP_AWARD_STATES,
  MP_SERVICES,
  MP_BID_SLOTS,
  MoneySchema,
  type ErrorCode,
} from "@ubi/contracts";

import { toolLogger } from "../lib/logger";
import { delegatedIdentityHeaders } from "../lib/ride-context";

import type { Actor } from "../ops/types";

export type MpService = "ride" | "delivery";

export interface MpQuoteInput {
  readonly service: MpService;
  readonly vehicleClass: string;
  readonly pickupLat: number;
  readonly pickupLng: number;
  readonly dropoffLat: number;
  readonly dropoffLng: number;
  readonly weightKg?: number;
}

export interface MpQuote {
  readonly quoteId: string;
  readonly service: string;
  readonly vehicleClass: string;
  readonly cityId: string;
  readonly currency: string;
  readonly suggestedFareMinor: number;
  readonly minimumFareMinor: number;
  readonly maximumFareMinor: number;
  readonly expiresAt: string;
  readonly pricingVersion: string;
  readonly policyVersion: number;
}

export interface MpPrepareInput {
  readonly quoteId: string;
  readonly requestedFareMinor: number;
  readonly currency: string;
  readonly paymentMethodId: string;
  readonly weightKg?: number;
  /** Stable per-negotiation key; a replay converges on the same request. */
  readonly idempotencyKey: string;
}

export interface MpRequest {
  readonly requestId: string;
  readonly state: string;
  readonly revision: number;
  readonly version: number;
  readonly service: string;
  readonly vehicleClass: string;
  readonly cityId: string;
  readonly currency: string;
  readonly requesterId: string;
  readonly quoteId: string;
  readonly requestedFareMinor: number;
  readonly expiresAt: string;
  readonly closeReason?: string;
}

export interface MpOfferDriver {
  readonly displayName: string;
  readonly initials: string;
  readonly rating: string;
  readonly completedTrips: number;
  readonly vehicle: string;
  readonly plateMasked: string;
  readonly profileStatus: string;
}

export interface MpOffer {
  readonly bidId: string;
  readonly bidVersion: number;
  readonly requestRevision: number;
  readonly amountMinor: number;
  readonly currency: string;
  readonly kind: string;
  readonly driver: MpOfferDriver;
  readonly pickupLabel: string;
  readonly expiresAt: string;
  readonly withdrawn: boolean;
  readonly whyRecommended?: string;
  readonly totalMinor?: number;
}

export interface MpAward {
  readonly awardId: string;
  readonly requestId: string;
  readonly bidId: string;
  readonly state: string;
  readonly requestVersion: number;
  readonly bidVersion: number;
  readonly driverId: string;
  readonly requesterId: string;
  readonly fareMinor: number;
  readonly commissionMinor: number;
  readonly slot: string;
  readonly createdAt: string;
  readonly resolvedAt?: string;
  readonly failReason?: string;
}

export interface MpSnapshot {
  readonly request: MpRequest;
  readonly offers: readonly MpOffer[];
  readonly award: MpAward | null;
  readonly seq: number;
}

export interface MpSelectInput {
  readonly requestId: string;
  readonly bidId: string;
  readonly requestVersion: number;
  readonly bidVersion: number;
  /** Derived from the grant, STABLE across retries (never regenerated). */
  readonly idempotencyKey: string;
}

export interface MpSelectResult {
  readonly award: MpAward;
  /** Present only on the call that confirmed a current-slot ride award. */
  readonly pickupPin?: string;
}

/**
 * A driver/provider display value the assistant must treat as DATA, never as an
 * instruction. Wrapping it makes its untrusted origin explicit wherever it is
 * presented to the review model (rule #19, #20).
 */
export interface UntrustedText {
  readonly untrusted: true;
  readonly value: string;
}

export interface SanitizedOffer {
  readonly bidId: string;
  readonly bidVersion: number;
  readonly requestRevision: number;
  readonly amountMinor: number;
  readonly totalMinor: number;
  readonly currency: string;
  readonly kind: string;
  readonly pickupLabel: string;
  readonly expiresAt: string;
  readonly withdrawn: boolean;
  /** Server-verified display facts. */
  readonly driverRating: string;
  readonly driverProfileStatus: string;
  readonly vehicle: string;
  /** Untrusted, driver/provider-authored free text — data, not instructions. */
  readonly driverDisplayName: UntrustedText;
  readonly whyRecommended: UntrustedText | null;
}

/**
 * Who a marketplace call is made AS: the authenticated Ask user (id and role
 * from the gateway identity) in the gateway-verified city of the Ask session.
 * It is exactly what the delegated identity signs, so ride-service sees the
 * principal a direct client request from the same user would carry. The ops
 * layer builds it from request context — never from a tool argument or model
 * output (rule #18).
 */
export interface MpPrincipal extends Actor {
  readonly cityId: string;
}

export interface MarketplacePort {
  quote(principal: MpPrincipal, input: MpQuoteInput): Promise<MpQuote>;
  prepareRequest(
    principal: MpPrincipal,
    input: MpPrepareInput,
  ): Promise<MpRequest>;
  viewOffers(
    principal: MpPrincipal,
    requestId: string,
  ): Promise<MpSnapshot | null>;
  /**
   * Pure presentation of untrusted offers for the review model. Identical across
   * implementations — it performs no I/O — and clearly marks every free-text
   * field as untrusted so no offer text can pose as an instruction.
   */
  reviewOffer(offers: readonly MpOffer[]): readonly SanitizedOffer[];
  getAward(principal: MpPrincipal, requestId: string): Promise<MpAward | null>;
  select(principal: MpPrincipal, input: MpSelectInput): Promise<MpSelectResult>;
  cancel(
    principal: MpPrincipal,
    requestId: string,
    idempotencyKey: string,
  ): Promise<MpRequest>;
}

/**
 * The shared, deterministic offer presentation both the HTTP port and the test
 * fake delegate to. Numeric/id fields — the only things a tool argument may name
 * — stay as verified data; every free-text field is wrapped as untrusted.
 */
export function presentOffersForReview(
  offers: readonly MpOffer[],
): readonly SanitizedOffer[] {
  return offers.map((offer) => ({
    bidId: offer.bidId,
    bidVersion: offer.bidVersion,
    requestRevision: offer.requestRevision,
    amountMinor: offer.amountMinor,
    totalMinor: offer.totalMinor ?? offer.amountMinor,
    currency: offer.currency,
    kind: offer.kind,
    pickupLabel: offer.pickupLabel,
    expiresAt: offer.expiresAt,
    withdrawn: offer.withdrawn,
    driverRating: offer.driver.rating,
    driverProfileStatus: offer.driver.profileStatus,
    vehicle: offer.driver.vehicle,
    driverDisplayName: { untrusted: true, value: offer.driver.displayName },
    whyRecommended:
      offer.whyRecommended === undefined || offer.whyRecommended.length === 0
        ? null
        : { untrusted: true, value: offer.whyRecommended },
  }));
}

interface MarketplaceHttpOptions {
  readonly baseUrl: string;
  /**
   * The RIDE_INTERNAL_CONTEXT_SECRET key list; the FIRST key signs. Required so
   * a caller decides explicitly: an empty list sends the identity unsigned,
   * which only development ride-service accepts (the wiring refuses to boot
   * that way in production — lib/ride-context.ts `loadRideContextKeys`).
   */
  readonly signingKeys: readonly string[];
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  /** The signing clock; injectable so a test can pin a wire vector. */
  readonly now?: () => Date;
}

/** Thrown when a marketplace call did not return a definite outcome in time. */
export class MarketplaceTimeoutError extends ContractError {
  constructor(message: string, reason = "marketplace_timeout") {
    super("service_unavailable", message, { reason });
    this.name = "MarketplaceTimeoutError";
  }
}

/**
 * Thrown when a marketplace response does not match its wire schema — above all
 * when money is missing, fractional, non-numeric or in the wrong currency. The
 * assistant fails closed rather than acting on an amount it had to guess.
 */
export class MarketplaceMalformedResponseError extends ContractError {
  constructor(what: string, issues: readonly string[]) {
    super(
      "service_unavailable",
      `the marketplace returned an unreadable ${what}`,
      { reason: "malformed_marketplace_response", what, issues: [...issues] },
    );
    this.name = "MarketplaceMalformedResponseError";
  }
}

export function createHttpMarketplacePort(
  options: MarketplaceHttpOptions,
): MarketplacePort {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const base = options.baseUrl.replace(/\/+$/, "");
  const now = options.now ?? (() => new Date());
  const signingKeys = [...options.signingKeys];

  async function call(
    path: string,
    method: "GET" | "POST",
    principal: MpPrincipal,
    extraHeaders?: Record<string, string>,
    body?: unknown,
  ): Promise<Response> {
    // Signed per call, at send time: ride-service bounds the timestamp's age,
    // so a retry is a fresh signature, never a replayed one. Only the id, role
    // and city are read off the principal — nothing else can reach the wire.
    const identity = delegatedIdentityHeaders(
      signingKeys,
      {
        userId: principal.id,
        role: principal.role,
        cityId: principal.cityId,
      },
      now(),
    );
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      return await doFetch(`${base}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...extraHeaders,
          // Identity last: no extra header can shadow it.
          ...identity,
        },
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  function unavailable(): never {
    throw new ContractError(
      "service_unavailable",
      "the marketplace is not available right now",
    );
  }

  function isAbort(error: unknown): boolean {
    // Node's fetch rejects an aborted call with a DOMException, which is an
    // Error subclass here.
    return error instanceof Error && error.name === "AbortError";
  }

  return {
    async quote(principal, input): Promise<MpQuote> {
      try {
        const query = new URLSearchParams({
          service: input.service,
          vehicleClass: input.vehicleClass,
          pickupLat: String(input.pickupLat),
          pickupLng: String(input.pickupLng),
          dropoffLat: String(input.dropoffLat),
          dropoffLng: String(input.dropoffLng),
        });
        if (input.weightKg !== undefined) {
          query.set("weightKg", String(input.weightKg));
        }
        const response = await call(
          `/v1/mp/quote?${query.toString()}`,
          "GET",
          principal,
        );
        if (!response.ok) {
          throw await errorFrom(
            response,
            "a marketplace quote is not available",
          );
        }
        return parseWire(QuoteWire, await response.json(), "quote");
      } catch (error) {
        if (error instanceof ContractError) {
          throw error;
        }
        toolLogger.error({ err: error }, "marketplace quote failed");
        unavailable();
      }
    },

    async prepareRequest(principal, input): Promise<MpRequest> {
      try {
        const response = await call(
          "/v1/mp/requests",
          "POST",
          principal,
          { "idempotency-key": input.idempotencyKey },
          {
            quoteId: input.quoteId,
            requestedFareMinor: {
              amountMinor: input.requestedFareMinor,
              currency: input.currency,
            },
            paymentMethodId: input.paymentMethodId,
            ...(input.weightKg === undefined
              ? {}
              : { delivery: { weightKg: input.weightKg } }),
          },
        );
        if (!response.ok) {
          throw await errorFrom(response, "the request could not be published");
        }
        return parseWire(RequestWire, await response.json(), "request");
      } catch (error) {
        if (error instanceof ContractError) {
          throw error;
        }
        toolLogger.error({ err: error }, "marketplace prepare failed");
        unavailable();
      }
    },

    async viewOffers(principal, requestId): Promise<MpSnapshot | null> {
      try {
        const response = await call(
          `/v1/mp/requests/${encodeURIComponent(requestId)}`,
          "GET",
          principal,
        );
        if (response.status === 404) {
          return null;
        }
        if (!response.ok) {
          throw await errorFrom(response, "the request could not be read");
        }
        return parseWire(SnapshotWire, await response.json(), "offer snapshot");
      } catch (error) {
        if (error instanceof ContractError) {
          throw error;
        }
        toolLogger.error({ err: error }, "marketplace viewOffers failed");
        unavailable();
      }
    },

    reviewOffer(offers): readonly SanitizedOffer[] {
      return presentOffersForReview(offers);
    },

    async getAward(principal, requestId): Promise<MpAward | null> {
      try {
        const response = await call(
          `/v1/mp/requests/${encodeURIComponent(requestId)}/award`,
          "GET",
          principal,
        );
        if (response.status === 404) {
          return null;
        }
        if (!response.ok) {
          throw await errorFrom(response, "the award could not be read");
        }
        return parseWire(AwardWire, await response.json(), "award");
      } catch (error) {
        if (error instanceof ContractError) {
          throw error;
        }
        toolLogger.error({ err: error }, "marketplace getAward failed");
        unavailable();
      }
    },

    async select(principal, input): Promise<MpSelectResult> {
      let response: Response;
      try {
        response = await call(
          `/v1/mp/requests/${encodeURIComponent(input.requestId)}/select`,
          "POST",
          principal,
          { "idempotency-key": input.idempotencyKey },
          {
            bidId: input.bidId,
            requestVersion: input.requestVersion,
            bidVersion: input.bidVersion,
          },
        );
      } catch (error) {
        if (error instanceof ContractError) {
          // Refused before anything was sent (e.g. an undelegable principal).
          throw error;
        }
        // A timed-out select is an UNCERTAIN outcome — the caller must query the
        // authoritative award state, never resubmit the selection blindly.
        if (isAbort(error)) {
          throw new MarketplaceTimeoutError(
            "the selection did not confirm in time; querying the award",
          );
        }
        toolLogger.error({ err: error }, "marketplace select failed");
        throw new MarketplaceTimeoutError(
          "the selection outcome is unknown; querying the award",
        );
      }
      if (!response.ok) {
        throw await errorFrom(response, "the selection could not be awarded");
      }
      try {
        return parseWire(SelectWire, await response.json(), "selection");
      } catch (error) {
        // The server ACCEPTED the selection but its answer is unreadable: the
        // award (and its funding + commission) may well exist. That is an
        // uncertain outcome to converge on by querying — never a definite
        // failure, and never a reason to select again.
        toolLogger.error(
          { err: error },
          "marketplace select answered with an unreadable body",
        );
        throw new MarketplaceTimeoutError(
          "the selection answer was unreadable; querying the award",
          "malformed_select_response",
        );
      }
    },

    async cancel(principal, requestId, idempotencyKey): Promise<MpRequest> {
      try {
        const response = await call(
          `/v1/mp/requests/${encodeURIComponent(requestId)}/cancel`,
          "POST",
          principal,
          { "idempotency-key": idempotencyKey },
        );
        if (!response.ok) {
          throw await errorFrom(response, "the request could not be cancelled");
        }
        return parseWire(RequestWire, await response.json(), "request");
      } catch (error) {
        if (error instanceof ContractError) {
          throw error;
        }
        toolLogger.error({ err: error }, "marketplace cancel failed");
        unavailable();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Strict wire schemas — ride-service's JSON (internal/marketplace/views.go,
// contracts/openapi/marketplace.yaml) to the port's flattened shapes.
//
// Every money field must be a real `Money` from the server: an integer
// `amountMinor` with an ISO-4217 `currency`, and every amount in one response
// must share the response's currency. Nothing here substitutes a zero, a
// default currency, a default version or a default `withdrawn: false`; a
// response that lacks a fact the assistant would decide on is refused. Unknown
// extra fields are ignored so the server can grow its views compatibly.
// ---------------------------------------------------------------------------

const NonEmpty = z.string().min(1);
const Timestamp = z.string().datetime({ offset: true });
const Version = z.number().int().min(1);

/** A fare or price: strictly positive integer minor units. */
const PositiveMoney = MoneySchema.extend({
  amountMinor: z.number().int().positive().safe(),
});
/** A fee or floor that may legitimately be zero, never negative. */
const NonNegativeMoney = MoneySchema.extend({
  amountMinor: z.number().int().nonnegative().safe(),
});

type WireMoney = z.infer<typeof MoneySchema>;

function requireCurrency(
  ctx: z.RefinementCtx,
  currency: string,
  fields: Readonly<Record<string, WireMoney | null | undefined>>,
): void {
  for (const [field, value] of Object.entries(fields)) {
    if (value !== null && value !== undefined && value.currency !== currency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field, "currency"],
        message: `expected ${currency}, received ${value.currency}`,
      });
    }
  }
}

const QuoteWire = z
  .object({
    quoteId: NonEmpty,
    service: z.enum(MP_SERVICES),
    vehicleClass: NonEmpty,
    cityId: NonEmpty,
    currency: CurrencySchema,
    suggestedFareMinor: PositiveMoney,
    minimumFareMinor: NonNegativeMoney,
    maximumFareMinor: PositiveMoney,
    expiresAt: Timestamp,
    pricingVersion: NonEmpty,
    policyVersion: z.number().int().positive(),
  })
  .superRefine((quote, ctx) => {
    requireCurrency(ctx, quote.currency, {
      suggestedFareMinor: quote.suggestedFareMinor,
      minimumFareMinor: quote.minimumFareMinor,
      maximumFareMinor: quote.maximumFareMinor,
    });
    // The server-set bounds must be a real envelope; an inverted one is not a
    // fare the assistant can reason about.
    if (
      quote.minimumFareMinor.amountMinor >
        quote.suggestedFareMinor.amountMinor ||
      quote.suggestedFareMinor.amountMinor > quote.maximumFareMinor.amountMinor
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["suggestedFareMinor"],
        message:
          "the fare bounds are not ordered minimum <= suggested <= maximum",
      });
    }
  })
  .transform(
    (quote): MpQuote => ({
      quoteId: quote.quoteId,
      service: quote.service,
      vehicleClass: quote.vehicleClass,
      cityId: quote.cityId,
      currency: quote.currency,
      suggestedFareMinor: quote.suggestedFareMinor.amountMinor,
      minimumFareMinor: quote.minimumFareMinor.amountMinor,
      maximumFareMinor: quote.maximumFareMinor.amountMinor,
      expiresAt: quote.expiresAt,
      pricingVersion: quote.pricingVersion,
      policyVersion: quote.policyVersion,
    }),
  );

const RequestObject = z
  .object({
    requestId: NonEmpty,
    state: NonEmpty,
    revision: Version,
    version: Version,
    service: z.enum(MP_SERVICES),
    vehicleClass: NonEmpty,
    cityId: NonEmpty,
    currency: CurrencySchema,
    requesterId: NonEmpty,
    quoteId: NonEmpty,
    requestedFareMinor: PositiveMoney,
    expiresAt: Timestamp,
    closeReason: NonEmpty.nullable().optional(),
  })
  .superRefine((request, ctx) => {
    requireCurrency(ctx, request.currency, {
      requestedFareMinor: request.requestedFareMinor,
    });
  });

function toRequest(request: z.infer<typeof RequestObject>): MpRequest {
  return {
    requestId: request.requestId,
    state: request.state,
    revision: request.revision,
    version: request.version,
    service: request.service,
    vehicleClass: request.vehicleClass,
    cityId: request.cityId,
    currency: request.currency,
    requesterId: request.requesterId,
    quoteId: request.quoteId,
    requestedFareMinor: request.requestedFareMinor.amountMinor,
    expiresAt: request.expiresAt,
    closeReason: request.closeReason ?? undefined,
  };
}

const RequestWire = RequestObject.transform(toRequest);

const OfferObject = z
  .object({
    bidId: NonEmpty,
    bidVersion: Version,
    requestRevision: Version,
    amountMinor: PositiveMoney,
    kind: NonEmpty,
    // Driver display facts are presentation data (and the free text in them is
    // untrusted); their types are checked, their contents are not decisions.
    driver: z.object({
      displayName: z.string(),
      initials: z.string(),
      rating: z.string(),
      completedTrips: z.number().int().nonnegative(),
      vehicle: z.string(),
      plateMasked: z.string(),
      profileStatus: NonEmpty,
    }),
    pickupLabel: z.string(),
    expiresAt: Timestamp,
    // Decides whether the offer is selectable: never defaulted.
    withdrawn: z.boolean(),
    whyRecommended: z.string().nullable().optional(),
    bookingFeeMinor: NonNegativeMoney.nullable().optional(),
    totalMinor: PositiveMoney.nullable().optional(),
  })
  .superRefine((offer, ctx) => {
    requireCurrency(ctx, offer.amountMinor.currency, {
      bookingFeeMinor: offer.bookingFeeMinor,
      totalMinor: offer.totalMinor,
    });
    // A booking fee means the rider's total differs from the bid, and only the
    // server may say what it is — the assistant never adds money up itself.
    if (
      offer.bookingFeeMinor !== null &&
      offer.bookingFeeMinor !== undefined &&
      offer.bookingFeeMinor.amountMinor > 0 &&
      (offer.totalMinor === null || offer.totalMinor === undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["totalMinor"],
        message: "a booking fee is charged but the server total is missing",
      });
    }
  });

function toOffer(offer: z.infer<typeof OfferObject>): MpOffer {
  return {
    bidId: offer.bidId,
    bidVersion: offer.bidVersion,
    requestRevision: offer.requestRevision,
    amountMinor: offer.amountMinor.amountMinor,
    currency: offer.amountMinor.currency,
    kind: offer.kind,
    driver: { ...offer.driver },
    pickupLabel: offer.pickupLabel,
    expiresAt: offer.expiresAt,
    withdrawn: offer.withdrawn,
    whyRecommended: offer.whyRecommended ?? undefined,
    totalMinor: offer.totalMinor?.amountMinor ?? undefined,
  };
}

const AwardObject = z
  .object({
    awardId: NonEmpty,
    requestId: NonEmpty,
    bidId: NonEmpty,
    state: z.enum(MP_AWARD_STATES),
    requestVersion: Version,
    bidVersion: Version,
    driverId: NonEmpty,
    requesterId: NonEmpty,
    fareMinor: PositiveMoney,
    commissionMinor: NonNegativeMoney,
    // An advance award (A03) carries slot "advance"; accept every bid slot.
    slot: z.enum(MP_BID_SLOTS),
    createdAt: Timestamp,
    resolvedAt: Timestamp.nullable().optional(),
    failReason: z.string().nullable().optional(),
  })
  .superRefine((award, ctx) => {
    requireCurrency(ctx, award.fareMinor.currency, {
      commissionMinor: award.commissionMinor,
    });
    if (award.commissionMinor.amountMinor > award.fareMinor.amountMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["commissionMinor"],
        message: "the commission exceeds the fare",
      });
    }
  });

function toAward(award: z.infer<typeof AwardObject>): MpAward {
  return {
    awardId: award.awardId,
    requestId: award.requestId,
    bidId: award.bidId,
    state: award.state,
    requestVersion: award.requestVersion,
    bidVersion: award.bidVersion,
    driverId: award.driverId,
    requesterId: award.requesterId,
    fareMinor: award.fareMinor.amountMinor,
    commissionMinor: award.commissionMinor.amountMinor,
    slot: award.slot,
    createdAt: award.createdAt,
    resolvedAt: award.resolvedAt ?? undefined,
    failReason: award.failReason ?? undefined,
  };
}

const AwardWire = AwardObject.transform(toAward);

const SnapshotWire = z
  .object({
    request: RequestObject,
    offers: z.array(OfferObject),
    award: AwardObject.nullable().optional(),
    seq: z.number().int().nonnegative(),
  })
  .superRefine((snapshot, ctx) => {
    const currency = snapshot.request.currency;
    snapshot.offers.forEach((offer, index) => {
      if (offer.amountMinor.currency !== currency) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["offers", index, "amountMinor", "currency"],
          message: `expected the request currency ${currency}, received ${offer.amountMinor.currency}`,
        });
      }
    });
    const award = snapshot.award;
    if (award !== null && award !== undefined) {
      if (award.fareMinor.currency !== currency) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["award", "fareMinor", "currency"],
          message: `expected the request currency ${currency}, received ${award.fareMinor.currency}`,
        });
      }
      if (award.requestId !== snapshot.request.requestId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["award", "requestId"],
          message: "the award belongs to a different request",
        });
      }
    }
  })
  .transform(
    (snapshot): MpSnapshot => ({
      request: toRequest(snapshot.request),
      offers: snapshot.offers.map(toOffer),
      award:
        snapshot.award === null || snapshot.award === undefined
          ? null
          : toAward(snapshot.award),
      seq: snapshot.seq,
    }),
  );

const SelectWire = z
  .object({
    award: AwardObject,
    pickupPin: NonEmpty.optional(),
  })
  .transform(
    (result): MpSelectResult => ({
      award: toAward(result.award),
      pickupPin: result.pickupPin,
    }),
  );

function parseWire<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  raw: unknown,
  what: string,
): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // Paths only: the values may be money or personal display data.
    const issues = parsed.error.issues.map(
      (issue) => issue.path.join(".") || "(root)",
    );
    toolLogger.error(
      { what, issues },
      "marketplace response failed its wire schema",
    );
    throw new MarketplaceMalformedResponseError(what, issues);
  }
  return parsed.data;
}

const CANONICAL_CODES: ReadonlySet<string> = new Set(ERROR_CODES);

async function errorFrom(
  response: Response,
  fallbackMessage: string,
): Promise<ContractError> {
  try {
    const body = (await response.json()) as {
      code?: unknown;
      message?: unknown;
      details?: unknown;
    };
    if (body.code === "unauthorized") {
      // ride-service refused the DELEGATED identity (unsigned, expired, wrong
      // key): an ask ↔ ride misconfiguration, not the end user's session. It
      // must not reach the client as a 401 that reads like "you are signed out".
      toolLogger.error(
        { status: response.status },
        "ride-service refused the assistant's delegated identity",
      );
      return new ContractError(
        "service_unavailable",
        "the marketplace is not available to the assistant right now",
        { reason: "delegation_refused", status: response.status },
      );
    }
    if (typeof body.code === "string" && CANONICAL_CODES.has(body.code)) {
      // Preserve the marketplace's canonical code so deterministic refusals
      // (fare_out_of_bounds, version_conflict, award_unresolved …) survive.
      return new ContractError(
        body.code as ErrorCode,
        typeof body.message === "string" ? body.message : fallbackMessage,
        typeof body.details === "object" && body.details !== null
          ? (body.details as Record<string, unknown>)
          : undefined,
      );
    }
  } catch {
    // fall through to a generic error
  }
  return new ContractError("service_unavailable", fallbackMessage, {
    status: response.status,
  });
}
