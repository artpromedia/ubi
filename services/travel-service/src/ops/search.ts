/**
 * Flight and stay searches (contracts/openapi/travel-v2.yaml).
 *
 * A search stores a `travel_searches` row with `prices_as_of` and, when the
 * supplier's terms allow it, a `cache_until` (CLAUDE.md #23 / slice NEW-02). The
 * cache is a display convenience only: it NEVER replaces the revalidation every
 * item goes through at checkout. `prices_as_of` is returned so the client can
 * show a "LIVE PRICE (age)" label from the server's own timestamp.
 *
 * OFFER KEYS. Every bookable offer a search returns — a flight fare, or a
 * stay rate once `GET /stays/:propertyId/rates` has priced it — carries an
 * `offerKey`: a short, stable handle for that offer WITHIN its search
 * (`offerKeyFor`). A supplier's own purchase reference can run to hundreds of
 * characters (a LiteAPI offer id), which an assistant cannot be trusted to
 * copy; the key is what ask-service names an offer by, and
 * `GET /v1/travel/searches/:searchId/offers/:offerKey` (`readSearchOffer`)
 * reads that ONE cached offer back — for the caller's own search only,
 * refused once it has expired, and only while its vertical is open. Stay
 * rates are cached on their search row for that read when they are priced;
 * a property's "from" price is never bookable and never gets a key.
 */
import { createHash } from "node:crypto";

import { ContractError, money, type Money } from "@ubi/contracts";

import { termsForCapabilities, VERTICAL_FLAG } from "./carts";
import { assertFlagEnabled } from "./config";
import { cleanJson, toJson } from "./json";
import { withOutbox } from "./outbox";
import {
  contextFor,
  flightAdapterFor,
  loadSupplier,
  pickSupplier,
  stayAdapterFor,
} from "./suppliers";
import { generateId } from "../lib/ids";

import type { TravelDeps } from "./context";
import type { Actor, JsonRecord, JsonValue } from "./types";
import type {
  AdapterOffer,
  FlightSearchParams,
  StaySearchParams,
} from "../adapters/types";

/**
 * The handle one bookable offer is named by within its search: `of_` + the
 * first 12 hex digits of its purchase reference's SHA-256. Unique within a
 * search (a few hundred offers at most) and meaningless outside it — every
 * read that takes a key is also scoped by the search id and its owner.
 */
export function offerKeyFor(purchaseRef: string): string {
  const digest = createHash("sha256").update(purchaseRef, "utf8").digest("hex");
  return `of_${digest.slice(0, 12)}`;
}

/** The newest stay rates one search keeps cached for `readSearchOffer`. */
const MAX_CACHED_RATES = 120;

/**
 * The longest a cached offer is read back for a review, whatever the
 * supplier's own cache terms say. A supplier that states no display cache
 * window (LiteAPI) still gets this bound; the checkout revalidation is what
 * decides the price charged either way.
 */
export const CACHED_OFFER_MAX_AGE_MS = 30 * 60 * 1000;

function serializeOffer(
  offer: AdapterOffer,
  options: { readonly bookable: boolean; readonly pricedAt?: Date },
): JsonRecord {
  return {
    offerRef: offer.offerRef,
    bookable: options.bookable,
    ...(options.pricedAt === undefined
      ? {}
      : { pricedAt: options.pricedAt.toISOString() }),
    kind: offer.kind,
    snapshot: offer.snapshot,
    priceMinor: offer.price.amountMinor,
    currency: offer.price.currency,
    supplierPriceMinor: offer.supplierPrice?.amountMinor ?? null,
    supplierCurrency: offer.supplierPrice?.currency ?? null,
    fx: offer.fx
      ? { rate: offer.fx.rate, lockedUntil: offer.fx.lockedUntil }
      : null,
    payAtPropertyMinor: offer.payAtProperty?.amountMinor ?? null,
    capabilities: offer.capabilities as unknown as JsonValue,
    policy: offer.policy,
    soldOut: offer.soldOut ?? false,
  };
}

export interface FlightSearchResult {
  readonly searchId: string;
  readonly pricesAsOf: string;
  readonly cacheUntil: string | null;
  readonly offers: readonly JsonRecord[];
}

export async function flightSearch(
  deps: TravelDeps,
  input: {
    readonly actor: Actor;
    readonly cityId: string;
    readonly params: FlightSearchParams;
    readonly correlationId: string | null;
  },
): Promise<FlightSearchResult> {
  const config = await deps.config.load(input.cityId);
  assertFlagEnabled(config.flags, "flights_booking");

  const supplier = await pickSupplier(deps.db, "flight");
  const adapter = flightAdapterFor(supplier);
  const result = await adapter.search(
    contextFor(supplier, deps.now),
    input.params,
  );

  const searchId = generateId("tsr");
  const offers = result.offers.map((offer) =>
    serializeOffer(offer, { bookable: true }),
  );

  await withOutbox(deps.db, async (tx) => {
    await tx.travelSearch.create({
      data: {
        id: searchId,
        userId: input.actor.id,
        kind: "flight",
        params: cleanJson(input.params),
        supplierId: supplier.id,
        pricesAsOf: result.pricesAsOf,
        offers: toJson(offers),
        cacheUntil: result.cacheUntil,
      },
    });
    return {
      result: undefined,
      events: [
        {
          name: "travel.search.completed",
          aggregateType: "travel_search",
          aggregateId: searchId,
          fromVersion: null,
          toVersion: 1,
          actor: input.actor,
          actorType: "rider",
          cityId: input.cityId,
          idempotencyKey: `travel.search.completed:${searchId}`,
          correlationId: input.correlationId,
          occurredAt: result.pricesAsOf,
          payload: {
            searchId,
            supplier: supplier.id,
            kind: "flight",
            offers: offers.length,
            latencyMs: result.latencyMs,
          },
        },
      ],
    };
  });

  return {
    searchId,
    pricesAsOf: result.pricesAsOf.toISOString(),
    cacheUntil: result.cacheUntil?.toISOString() ?? null,
    offers: offers.map(offerViewWithKey),
  };
}

/** A bookable offer as a search answers it: its snapshot plus its key. */
function offerViewWithKey(offer: JsonRecord): JsonRecord {
  return {
    ...(offer.snapshot as JsonRecord),
    offerKey: offerKeyFor(String(offer.offerRef)),
  };
}

export async function refreshFlightSearch(
  deps: TravelDeps,
  actor: Actor,
  searchId: string,
): Promise<FlightSearchResult> {
  const row = await deps.db.travelSearch.findUnique({
    where: { id: searchId },
  });
  if (row === null || row.kind !== "flight") {
    throw new ContractError("not_found", "no such flight search", { searchId });
  }
  if (row.userId !== actor.id) {
    throw new ContractError("not_found", "no such flight search", { searchId });
  }
  if (row.supplierId === null) {
    throw new ContractError(
      "service_unavailable",
      "the search has no supplier",
    );
  }
  const supplier = await pickSupplierById(deps, row.supplierId);
  const adapter = flightAdapterFor(supplier);
  const params = row.params as unknown as FlightSearchParams;
  const result = await adapter.search(contextFor(supplier, deps.now), params);
  const offers = result.offers.map((offer) =>
    serializeOffer(offer, { bookable: true }),
  );

  await deps.db.travelSearch.update({
    where: { id: searchId },
    data: {
      pricesAsOf: result.pricesAsOf,
      offers: toJson(offers),
      cacheUntil: result.cacheUntil,
    },
  });

  return {
    searchId,
    pricesAsOf: result.pricesAsOf.toISOString(),
    cacheUntil: result.cacheUntil?.toISOString() ?? null,
    offers: offers.map(offerViewWithKey),
  };
}

export interface StaySearchResult {
  readonly searchId: string;
  readonly properties: readonly JsonRecord[];
}

export async function staySearch(
  deps: TravelDeps,
  input: {
    readonly actor: Actor;
    readonly cityId: string;
    readonly params: StaySearchParams;
    readonly correlationId: string | null;
  },
): Promise<StaySearchResult> {
  const config = await deps.config.load(input.cityId);
  assertFlagEnabled(config.flags, "stays_booking");

  const supplier = await pickSupplier(deps.db, "stay");
  const adapter = stayAdapterFor(supplier);
  const result = await adapter.search(
    contextFor(supplier, deps.now),
    input.params,
  );

  const searchId = generateId("tsr");
  // A property's "from" price is a starting point, never a bookable offer.
  const offers = result.offers.map((offer) =>
    serializeOffer(offer, { bookable: false }),
  );

  await withOutbox(deps.db, async (tx) => {
    await tx.travelSearch.create({
      data: {
        id: searchId,
        userId: input.actor.id,
        kind: "stay",
        params: cleanJson(input.params),
        supplierId: supplier.id,
        pricesAsOf: result.pricesAsOf,
        offers: toJson(offers),
        cacheUntil: result.cacheUntil,
      },
    });
    return {
      result: undefined,
      events: [
        {
          name: "travel.search.completed",
          aggregateType: "travel_search",
          aggregateId: searchId,
          fromVersion: null,
          toVersion: 1,
          actor: input.actor,
          actorType: "rider",
          cityId: input.cityId,
          idempotencyKey: `travel.search.completed:${searchId}`,
          correlationId: input.correlationId,
          occurredAt: result.pricesAsOf,
          payload: {
            searchId,
            supplier: supplier.id,
            kind: "stay",
            offers: offers.length,
            latencyMs: result.latencyMs,
          },
        },
      ],
    };
  });

  return {
    searchId,
    properties: offers.map((offer) => offer.snapshot as JsonRecord),
  };
}

export async function stayRates(
  deps: TravelDeps,
  actor: Actor,
  propertyId: string,
  searchId: string,
): Promise<readonly JsonRecord[]> {
  const row = await deps.db.travelSearch.findUnique({
    where: { id: searchId },
  });
  if (row === null || row.kind !== "stay" || row.userId !== actor.id) {
    throw new ContractError("not_found", "no such stay search", { searchId });
  }
  if (row.supplierId === null) {
    throw new ContractError(
      "service_unavailable",
      "the search has no supplier",
    );
  }
  const supplier = await pickSupplierById(deps, row.supplierId);
  const adapter = stayAdapterFor(supplier);
  const params = row.params as unknown as StaySearchParams;
  const rates = await adapter.rates(
    contextFor(supplier, deps.now),
    propertyId,
    params,
  );
  const pricedAt = deps.now();
  const serialized = rates.map((rate) =>
    serializeOffer(rate, { bookable: true, pricedAt }),
  );
  await cacheRates(deps, searchId, serialized);
  return serialized.map(offerViewWithKey);
}

/**
 * Keeps the rates just priced on their search row, so `readSearchOffer` can
 * read one back by key. Under a row lock: two rate reads for different
 * properties of one search must not overwrite each other's rates. A rate
 * priced again replaces its older copy; only the newest MAX_CACHED_RATES are
 * kept.
 */
async function cacheRates(
  deps: TravelDeps,
  searchId: string,
  rates: readonly JsonRecord[],
): Promise<void> {
  if (rates.length === 0) {
    return;
  }
  const incoming = new Set(rates.map((rate) => String(rate.offerRef)));
  await deps.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM travel_searches WHERE id = ${searchId} FOR UPDATE`;
    const row = await tx.travelSearch.findUnique({ where: { id: searchId } });
    if (row === null) {
      return;
    }
    const existing = Array.isArray(row.offers)
      ? (row.offers as JsonRecord[])
      : [];
    const kept = existing.filter(
      (entry) =>
        !(entry.bookable === true && incoming.has(String(entry.offerRef))),
    );
    const merged = [...kept, ...rates];
    let excess =
      merged.filter((entry) => entry.bookable === true).length -
      MAX_CACHED_RATES;
    const trimmed = merged.filter((entry) => {
      if (excess > 0 && entry.bookable === true) {
        excess -= 1;
        return false;
      }
      return true;
    });
    await tx.travelSearch.update({
      where: { id: searchId },
      data: { offers: toJson(trimmed) },
    });
  });
}

// ---------------------------------------------------------------------------
// One cached offer, read back by key
// ---------------------------------------------------------------------------

/** What POST /v1/travel/carts takes to price this exact offer. */
export interface CartItemRef {
  readonly kind: "flight" | "stay";
  readonly offerRef: string;
  readonly fareFamilyId?: string;
  readonly rateId?: string;
}

/**
 * One cached, bookable offer as `readSearchOffer` answers it. Every figure is
 * the one the search priced (a display price, CLAUDE.md #23): the cart prices
 * it again with the supplier and checkout revalidates it before anything is
 * charged.
 */
export interface SearchOfferView {
  readonly searchId: string;
  readonly offerKey: string;
  readonly kind: "flight" | "stay";
  readonly cartItem: CartItemRef;
  readonly title: string;
  readonly detail: string | null;
  readonly price: Money;
  readonly payAtProperty: Money | null;
  /** The promises the offer's capability record makes (carts.ts terms). */
  readonly terms: readonly string[];
  /** The supplier's own cancellation / change rules, verbatim. */
  readonly rules: readonly string[];
  readonly pricesAsOf: string;
  /** After this the offer is not read back: search again. */
  readonly expiresAt: string;
}

function text(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function record(value: JsonValue | undefined): JsonRecord {
  return value !== null &&
    value !== undefined &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value
    : {};
}

function earliest(dates: readonly (Date | null)[]): Date {
  const valid = dates.filter(
    (date): date is Date => date !== null && !Number.isNaN(date.getTime()),
  );
  return new Date(Math.min(...valid.map((date) => date.getTime())));
}

function cartItemFor(
  kind: "flight" | "stay",
  purchaseRef: string,
): CartItemRef | null {
  if (kind === "stay") {
    return { kind, offerRef: purchaseRef, rateId: purchaseRef };
  }
  // A flight fare is `offerRef#fareFamilyId` (carts.ts purchaseRefFor).
  const hash = purchaseRef.indexOf("#");
  if (hash <= 0 || hash === purchaseRef.length - 1) {
    return null;
  }
  return {
    kind,
    offerRef: purchaseRef.slice(0, hash),
    fareFamilyId: purchaseRef.slice(hash + 1),
  };
}

function describeOffer(
  kind: "flight" | "stay",
  snapshot: JsonRecord,
  entries: readonly JsonRecord[],
  params: JsonRecord,
): { title: string; detail: string | null } {
  if (kind === "flight") {
    const carrier = text(snapshot.carrier) ?? "Flight";
    const number = text(snapshot.flightNumber) ?? "";
    const from = text(snapshot.from);
    const to = text(snapshot.to);
    const departAt = text(snapshot.departAt);
    const route = from !== null && to !== null ? `${from} → ${to}` : null;
    const detail = [route, departAt === null ? null : `departs ${departAt}`]
      .filter((part): part is string => part !== null)
      .join(" · ");
    return {
      title: `${carrier} ${number}`.trim(),
      detail: detail.length > 0 ? detail : null,
    };
  }
  const room = text(snapshot.roomName) ?? "Room";
  const propertyId = text(snapshot.propertyId);
  const property = entries.find(
    (entry) =>
      entry.bookable !== true &&
      propertyId !== null &&
      record(entry.snapshot).id === propertyId,
  );
  const name = text(record(property?.snapshot).name);
  const checkIn = text(params.checkIn);
  const checkOut = text(params.checkOut);
  const detail = [
    text(snapshot.board),
    checkIn !== null && checkOut !== null ? `${checkIn} → ${checkOut}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
  return {
    title: name === null ? room : `${name} · ${room}`,
    detail: detail.length > 0 ? detail : null,
  };
}

function rulesOf(policy: JsonRecord): string[] {
  const rules: string[] = [];
  const cancellation = text(policy.cancellation);
  if (cancellation !== null) {
    rules.push(`Cancellation: ${cancellation}`);
  }
  const change = text(policy.change);
  if (change !== null) {
    rules.push(`Changes: ${change}`);
  }
  return rules;
}

function amountOf(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

/**
 * GET /v1/travel/searches/:searchId/offers/:offerKey — one bookable offer
 * from the caller's OWN search, as the search priced it.
 *
 *  - Someone else's search, a search that does not exist, a key that names
 *    no bookable offer in it, or an entry whose stored money does not read:
 *    the same `not_found`, so a caller learns nothing about other travellers.
 *  - Expired — past the supplier's quote expiry, the search's `cache_until`,
 *    or CACHED_OFFER_MAX_AGE_MS after it was priced, whichever is first:
 *    `offer_expired`, never the stale price.
 *  - Sold out when searched: `conflict` (reason `sold_out`).
 *  - Its vertical closed in the caller's city since: `feature_disabled`.
 */
export async function readSearchOffer(
  deps: TravelDeps,
  input: {
    readonly actor: Actor;
    readonly cityId: string;
    readonly searchId: string;
    readonly offerKey: string;
  },
): Promise<SearchOfferView> {
  const notFound = () =>
    new ContractError("not_found", "no such offer", {
      searchId: input.searchId,
      offerKey: input.offerKey,
    });
  const row = await deps.db.travelSearch.findUnique({
    where: { id: input.searchId },
  });
  if (row === null || row.userId !== input.actor.id) {
    throw notFound();
  }
  const entries = Array.isArray(row.offers) ? (row.offers as JsonRecord[]) : [];
  const entry = entries.find(
    (candidate) =>
      // Flight fares were bookable before the flag existed; a stay entry is
      // bookable only as a priced rate, never as a property's "from" price.
      (candidate.bookable === true ||
        (candidate.bookable === undefined && candidate.kind === "flight")) &&
      typeof candidate.offerRef === "string" &&
      offerKeyFor(candidate.offerRef) === input.offerKey,
  );
  if (entry === undefined) {
    throw notFound();
  }
  const kind = entry.kind === "stay" ? "stay" : "flight";
  if (entry.kind !== kind || kind !== row.kind) {
    throw notFound();
  }
  const purchaseRef = String(entry.offerRef);
  const cartItem = cartItemFor(kind, purchaseRef);
  const priceMinor = amountOf(entry.priceMinor);
  const currency = text(entry.currency);
  if (
    cartItem === null ||
    priceMinor === null ||
    currency === null ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    throw notFound();
  }

  const config = await deps.config.load(input.cityId);
  assertFlagEnabled(config.flags, VERTICAL_FLAG[kind]);

  const snapshot = record(entry.snapshot);
  const pricedAt =
    typeof entry.pricedAt === "string" ? new Date(entry.pricedAt) : null;
  const pricedFrom =
    pricedAt !== null && !Number.isNaN(pricedAt.getTime())
      ? pricedAt
      : row.pricesAsOf;
  const quoteExpiresAt = text(snapshot.quoteExpiresAt);
  const expiresAt = earliest([
    quoteExpiresAt === null ? null : new Date(quoteExpiresAt),
    row.cacheUntil,
    new Date(pricedFrom.getTime() + CACHED_OFFER_MAX_AGE_MS),
  ]);
  if (deps.now().getTime() >= expiresAt.getTime()) {
    throw new ContractError(
      "offer_expired",
      "this offer has expired; search again",
      {
        reason: "offer_expired",
        searchId: input.searchId,
        expiredAt: expiresAt.toISOString(),
      },
    );
  }
  if (entry.soldOut === true) {
    throw new ContractError("conflict", "that offer is sold out", {
      reason: "sold_out",
      searchId: input.searchId,
    });
  }

  const payAtPropertyMinor = amountOf(entry.payAtPropertyMinor);
  const { title, detail } = describeOffer(
    kind,
    snapshot,
    entries,
    record(row.params as JsonValue),
  );
  return {
    searchId: input.searchId,
    offerKey: input.offerKey,
    kind,
    cartItem,
    title,
    detail,
    price: money(priceMinor, currency),
    payAtProperty:
      payAtPropertyMinor === null || payAtPropertyMinor === 0
        ? null
        : money(payAtPropertyMinor, currency),
    terms: termsForCapabilities(record(entry.capabilities)),
    rules: rulesOf(record(entry.policy)),
    pricesAsOf: pricedFrom.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

async function pickSupplierById(deps: TravelDeps, supplierId: string) {
  const supplier = await loadSupplier(deps.db, supplierId);
  return supplier;
}
