/**
 * The marketplace port — the assistant's client onto the negotiated-fare
 * marketplace (contracts/openapi/marketplace.yaml, served by ride-service behind
 * the gateway). The AI acts AS the user: every call forwards the actor from the
 * gateway context (`X-User-ID` / `X-User-Role`), goes through the SAME endpoints
 * and authz a human client uses, and never carries an elevated privilege or an
 * identity a tool argument supplied (rule #18, CLAUDE.md #1).
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
 * The port deliberately exposes NO way to bypass a driver's stationary gate, to
 * enable automatic driver bidding, or to touch a balance, policy or ride-state
 * directly: those are not endpoints a human client has either, and the assistant
 * is a client exactly like a human (shared brief — "It cannot directly alter
 * balances, policies or ride state").
 */
import { ContractError } from "@ubi/contracts";

import { toolLogger } from "../lib/logger";

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

export interface MarketplacePort {
  quote(actor: Actor, input: MpQuoteInput): Promise<MpQuote>;
  prepareRequest(actor: Actor, input: MpPrepareInput): Promise<MpRequest>;
  viewOffers(actor: Actor, requestId: string): Promise<MpSnapshot | null>;
  /**
   * Pure presentation of untrusted offers for the review model. Identical across
   * implementations — it performs no I/O — and clearly marks every free-text
   * field as untrusted so no offer text can pose as an instruction.
   */
  reviewOffer(offers: readonly MpOffer[]): readonly SanitizedOffer[];
  getAward(actor: Actor, requestId: string): Promise<MpAward | null>;
  select(actor: Actor, input: MpSelectInput): Promise<MpSelectResult>;
  cancel(
    actor: Actor,
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
  readonly serviceKey?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/** Thrown when a marketplace call did not return a definite outcome in time. */
export class MarketplaceTimeoutError extends ContractError {
  constructor(message: string) {
    super("service_unavailable", message, { reason: "marketplace_timeout" });
    this.name = "MarketplaceTimeoutError";
  }
}

function actorHeaders(
  actor: Actor,
  serviceKey?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "X-User-ID": actor.id,
    "X-User-Role": actor.role,
  };
  if (serviceKey !== undefined) {
    headers["X-Service-Key"] = serviceKey;
  }
  return headers;
}

export function createHttpMarketplacePort(
  options: MarketplaceHttpOptions,
): MarketplacePort {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const base = options.baseUrl.replace(/\/+$/, "");

  async function call(
    path: string,
    method: "GET" | "POST",
    actor: Actor,
    extraHeaders?: Record<string, string>,
    body?: unknown,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      return await doFetch(`${base}${path}`, {
        method,
        headers: {
          ...actorHeaders(actor, options.serviceKey),
          ...extraHeaders,
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
    return (
      error instanceof DOMException === false &&
      error instanceof Error &&
      error.name === "AbortError"
    );
  }

  return {
    async quote(actor, input): Promise<MpQuote> {
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
          actor,
        );
        if (!response.ok) {
          unavailable();
        }
        return normalizeQuote(await response.json());
      } catch (error) {
        if (error instanceof ContractError) {
          throw error;
        }
        toolLogger.error({ err: error }, "marketplace quote failed");
        unavailable();
      }
    },

    async prepareRequest(actor, input): Promise<MpRequest> {
      try {
        const response = await call(
          "/v1/mp/requests",
          "POST",
          actor,
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
        return normalizeRequest(await response.json());
      } catch (error) {
        if (error instanceof ContractError) {
          throw error;
        }
        toolLogger.error({ err: error }, "marketplace prepare failed");
        unavailable();
      }
    },

    async viewOffers(actor, requestId): Promise<MpSnapshot | null> {
      try {
        const response = await call(
          `/v1/mp/requests/${encodeURIComponent(requestId)}`,
          "GET",
          actor,
        );
        if (response.status === 404) {
          return null;
        }
        if (!response.ok) {
          unavailable();
        }
        return normalizeSnapshot(await response.json());
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

    async getAward(actor, requestId): Promise<MpAward | null> {
      try {
        const response = await call(
          `/v1/mp/requests/${encodeURIComponent(requestId)}/award`,
          "GET",
          actor,
        );
        if (response.status === 404) {
          return null;
        }
        if (!response.ok) {
          unavailable();
        }
        return normalizeAward(await response.json());
      } catch (error) {
        if (error instanceof ContractError) {
          throw error;
        }
        toolLogger.error({ err: error }, "marketplace getAward failed");
        unavailable();
      }
    },

    async select(actor, input): Promise<MpSelectResult> {
      try {
        const response = await call(
          `/v1/mp/requests/${encodeURIComponent(input.requestId)}/select`,
          "POST",
          actor,
          { "idempotency-key": input.idempotencyKey },
          {
            bidId: input.bidId,
            requestVersion: input.requestVersion,
            bidVersion: input.bidVersion,
          },
        );
        if (!response.ok) {
          throw await errorFrom(response, "the selection could not be awarded");
        }
        const body = (await response.json()) as {
          award?: unknown;
          pickupPin?: unknown;
        };
        return {
          award: normalizeAward(body.award),
          pickupPin:
            typeof body.pickupPin === "string" ? body.pickupPin : undefined,
        };
      } catch (error) {
        // A timed-out select is an UNCERTAIN outcome — the caller must query the
        // authoritative award state, never resubmit the selection blindly.
        if (isAbort(error)) {
          throw new MarketplaceTimeoutError(
            "the selection did not confirm in time; querying the award",
          );
        }
        if (error instanceof ContractError) {
          throw error;
        }
        toolLogger.error({ err: error }, "marketplace select failed");
        throw new MarketplaceTimeoutError(
          "the selection outcome is unknown; querying the award",
        );
      }
    },

    async cancel(actor, requestId, idempotencyKey): Promise<MpRequest> {
      try {
        const response = await call(
          `/v1/mp/requests/${encodeURIComponent(requestId)}/cancel`,
          "POST",
          actor,
          { "idempotency-key": idempotencyKey },
        );
        if (!response.ok) {
          throw await errorFrom(response, "the request could not be cancelled");
        }
        return normalizeRequest(await response.json());
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
// Wire normalisers — the Money wrapper flattens to a bare minor integer here.
// ---------------------------------------------------------------------------

function minorOf(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (value !== null && typeof value === "object" && "amountMinor" in value) {
    const amount = (value as { amountMinor?: unknown }).amountMinor;
    return typeof amount === "number" ? amount : 0;
  }
  return 0;
}

function currencyOf(value: unknown, fallback: string): string {
  if (value !== null && typeof value === "object" && "currency" in value) {
    const currency = (value as { currency?: unknown }).currency;
    return typeof currency === "string" ? currency : fallback;
  }
  return fallback;
}

function normalizeQuote(raw: unknown): MpQuote {
  const q = (raw ?? {}) as Record<string, unknown>;
  const currency = typeof q.currency === "string" ? q.currency : "NGN";
  return {
    quoteId: String(q.quoteId ?? ""),
    service: String(q.service ?? "ride"),
    vehicleClass: String(q.vehicleClass ?? ""),
    cityId: String(q.cityId ?? ""),
    currency,
    suggestedFareMinor: minorOf(q.suggestedFareMinor),
    minimumFareMinor: minorOf(q.minimumFareMinor),
    maximumFareMinor: minorOf(q.maximumFareMinor),
    expiresAt: String(q.expiresAt ?? ""),
    pricingVersion: String(q.pricingVersion ?? ""),
    policyVersion: typeof q.policyVersion === "number" ? q.policyVersion : 0,
  };
}

function normalizeRequest(raw: unknown): MpRequest {
  const r = (raw ?? {}) as Record<string, unknown>;
  const currency = typeof r.currency === "string" ? r.currency : "NGN";
  return {
    requestId: String(r.requestId ?? ""),
    state: String(r.state ?? ""),
    revision: typeof r.revision === "number" ? r.revision : 0,
    version: typeof r.version === "number" ? r.version : 0,
    service: String(r.service ?? "ride"),
    vehicleClass: String(r.vehicleClass ?? ""),
    cityId: String(r.cityId ?? ""),
    currency,
    requesterId: String(r.requesterId ?? ""),
    quoteId: String(r.quoteId ?? ""),
    requestedFareMinor: minorOf(r.requestedFareMinor),
    expiresAt: String(r.expiresAt ?? ""),
    closeReason: typeof r.closeReason === "string" ? r.closeReason : undefined,
  };
}

function normalizeOffer(raw: unknown): MpOffer {
  const o = (raw ?? {}) as Record<string, unknown>;
  const driver = (o.driver ?? {}) as Record<string, unknown>;
  const currency = currencyOf(o.amountMinor, "NGN");
  return {
    bidId: String(o.bidId ?? ""),
    bidVersion: typeof o.bidVersion === "number" ? o.bidVersion : 0,
    requestRevision:
      typeof o.requestRevision === "number" ? o.requestRevision : 0,
    amountMinor: minorOf(o.amountMinor),
    currency,
    kind: String(o.kind ?? ""),
    driver: {
      displayName: String(driver.displayName ?? ""),
      initials: String(driver.initials ?? ""),
      rating: String(driver.rating ?? ""),
      completedTrips:
        typeof driver.completedTrips === "number" ? driver.completedTrips : 0,
      vehicle: String(driver.vehicle ?? ""),
      plateMasked: String(driver.plateMasked ?? ""),
      profileStatus: String(driver.profileStatus ?? "unavailable"),
    },
    pickupLabel: String(o.pickupLabel ?? ""),
    expiresAt: String(o.expiresAt ?? ""),
    withdrawn: o.withdrawn === true,
    whyRecommended:
      typeof o.whyRecommended === "string" ? o.whyRecommended : undefined,
    totalMinor: o.totalMinor === undefined ? undefined : minorOf(o.totalMinor),
  };
}

function normalizeAward(raw: unknown): MpAward {
  const a = (raw ?? {}) as Record<string, unknown>;
  return {
    awardId: String(a.awardId ?? ""),
    requestId: String(a.requestId ?? ""),
    bidId: String(a.bidId ?? ""),
    state: String(a.state ?? ""),
    requestVersion: typeof a.requestVersion === "number" ? a.requestVersion : 0,
    bidVersion: typeof a.bidVersion === "number" ? a.bidVersion : 0,
    driverId: String(a.driverId ?? ""),
    requesterId: String(a.requesterId ?? ""),
    fareMinor: minorOf(a.fareMinor),
    commissionMinor: minorOf(a.commissionMinor),
    slot: String(a.slot ?? ""),
    createdAt: String(a.createdAt ?? ""),
    resolvedAt: typeof a.resolvedAt === "string" ? a.resolvedAt : undefined,
    failReason: typeof a.failReason === "string" ? a.failReason : undefined,
  };
}

function normalizeSnapshot(raw: unknown): MpSnapshot {
  const s = (raw ?? {}) as Record<string, unknown>;
  const offers = Array.isArray(s.offers) ? s.offers.map(normalizeOffer) : [];
  return {
    request: normalizeRequest(s.request),
    offers,
    award:
      s.award === undefined || s.award === null
        ? null
        : normalizeAward(s.award),
    seq: typeof s.seq === "number" ? s.seq : 0,
  };
}

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
    if (typeof body.code === "string") {
      // Preserve the marketplace's canonical code so deterministic refusals
      // (fare_out_of_bounds, version_conflict, award_unresolved …) survive.
      return new ContractError(
        body.code as ContractError["code"],
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
