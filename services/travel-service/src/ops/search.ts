/**
 * Flight and stay searches (contracts/openapi/travel-v2.yaml).
 *
 * A search stores a `travel_searches` row with `prices_as_of` and, when the
 * supplier's terms allow it, a `cache_until` (CLAUDE.md #23 / slice NEW-02). The
 * cache is a display convenience only: it NEVER replaces the revalidation every
 * item goes through at checkout. `prices_as_of` is returned so the client can
 * show a "LIVE PRICE (age)" label from the server's own timestamp.
 */
import { ContractError } from "@ubi/contracts";

import { generateId } from "../lib/ids";
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

import type { AdapterOffer, FlightSearchParams, StaySearchParams } from "../adapters/types";
import type { TravelDeps } from "./context";
import type { Actor, JsonRecord, JsonValue } from "./types";

function serializeOffer(offer: AdapterOffer): JsonRecord {
  return {
    offerRef: offer.offerRef,
    kind: offer.kind,
    snapshot: offer.snapshot,
    priceMinor: offer.price.amountMinor,
    currency: offer.price.currency,
    supplierPriceMinor: offer.supplierPrice?.amountMinor ?? null,
    supplierCurrency: offer.supplierPrice?.currency ?? null,
    fx: offer.fx ? { rate: offer.fx.rate, lockedUntil: offer.fx.lockedUntil } : null,
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
  const result = await adapter.search(contextFor(supplier, deps.now), input.params);

  const searchId = generateId("tsr");
  const offers = result.offers.map(serializeOffer);

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
    offers: offers.map((offer) => offer.snapshot as JsonRecord),
  };
}

export async function refreshFlightSearch(
  deps: TravelDeps,
  actor: Actor,
  searchId: string,
): Promise<FlightSearchResult> {
  const row = await deps.db.travelSearch.findUnique({ where: { id: searchId } });
  if (row === null || row.kind !== "flight") {
    throw new ContractError("not_found", "no such flight search", { searchId });
  }
  if (row.userId !== actor.id) {
    throw new ContractError("not_found", "no such flight search", { searchId });
  }
  if (row.supplierId === null) {
    throw new ContractError("service_unavailable", "the search has no supplier");
  }
  const supplier = await pickSupplierById(deps, row.supplierId);
  const adapter = flightAdapterFor(supplier);
  const params = row.params as unknown as FlightSearchParams;
  const result = await adapter.search(contextFor(supplier, deps.now), params);
  const offers = result.offers.map(serializeOffer);

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
    offers: offers.map((offer) => offer.snapshot as JsonRecord),
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
  const result = await adapter.search(contextFor(supplier, deps.now), input.params);

  const searchId = generateId("tsr");
  const offers = result.offers.map(serializeOffer);

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
  const row = await deps.db.travelSearch.findUnique({ where: { id: searchId } });
  if (row === null || row.kind !== "stay" || row.userId !== actor.id) {
    throw new ContractError("not_found", "no such stay search", { searchId });
  }
  if (row.supplierId === null) {
    throw new ContractError("service_unavailable", "the search has no supplier");
  }
  const supplier = await pickSupplierById(deps, row.supplierId);
  const adapter = stayAdapterFor(supplier);
  const params = row.params as unknown as StaySearchParams;
  const rates = await adapter.rates(contextFor(supplier, deps.now), propertyId, params);
  return rates.map((rate) => serializeOffer(rate).snapshot as JsonRecord);
}

function pickSupplierById(deps: TravelDeps, supplierId: string) {
  return loadSupplier(deps.db, supplierId);
}
