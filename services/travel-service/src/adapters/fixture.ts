/**
 * The DEV/TEST fixture supply adapter.
 *
 * It implements `FlightSupplyAdapter` and `StaySupplyAdapter` deterministically:
 * given the same supplier config and the same refs, it always returns the same
 * offers, the same book outcome and the same lookup result. There are NO delays,
 * NO randomness and NO hard-coded prices or personas in this file — the catalog
 * (Air Peace P4 7120, Ibom Air QI 0312/0316, Transcorp Hilton, Fraser Suites)
 * and every outcome live in the `travel_suppliers.config` JSON, seeded by tests
 * and by a dev seed. This adapter is only ever selected when a supplier row's
 * `adapter` column is `fixture`; a production supplier uses the Duffel / Nuitee
 * HTTP shells instead.
 *
 * The `control` block in the config is how a test drives a specific outcome —
 * a repriced offer, a supplier timeout that must reconcile, a PNR that is not
 * yet a ticket, a refund the supplier rejects — without any mock inside a route.
 */
import { z } from "zod";

import { money } from "@ubi/contracts";

import type { JsonRecord } from "../ops/types";
import type {
  AdapterOffer,
  BookRequest,
  BookResult,
  CancelRequest,
  CancelResult,
  ChangeRequest,
  ChangeResult,
  FlightSearchParams,
  FlightSupplyAdapter,
  HoldResult,
  LookupResult,
  OfferValidation,
  ProviderHealth,
  RefundRequest,
  RefundResult,
  SearchResult,
  StaySearchParams,
  StaySupplyAdapter,
  StatusResult,
  SupplierContext,
  SupplyCapabilities,
} from "./types";

// ---------------------------------------------------------------------------
// Config schema (the supplier row's `config` JSON)
// ---------------------------------------------------------------------------

const capabilitiesSchema = z.object({
  holdSupported: z.boolean(),
  holdExpiresAt: z.string().optional(),
  priceGuaranteeUntil: z.string().optional(),
  merchantOfRecord: z.enum(["ubi", "supplier"]),
  changeSupported: z.boolean(),
  refundSupported: z.boolean(),
  currency: z.string(),
  payAtProperty: z.boolean().optional(),
  currencies: z.array(z.string()).optional(),
  coverage: z.string().optional(),
});

const fareFamilySchema = z.object({
  id: z.string(),
  name: z.string(),
  priceMinor: z.number().int(),
  baseMinor: z.number().int().optional(),
  taxesMinor: z.number().int().optional(),
  baggage: z.string(),
  changeRule: z.string(),
  refundRule: z.string(),
  protectionOffered: z.boolean().optional(),
  seatsLeft: z.number().int().optional(),
});

const flightSchema = z.object({
  offerRef: z.string(),
  carrier: z.string(),
  flightNumber: z.string(),
  aircraft: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  departAt: z.string(),
  arriveAt: z.string(),
  departTerminal: z.string().optional(),
  arriveTerminal: z.string().optional(),
  durationMin: z.number().int(),
  stops: z.number().int(),
  fareFamilies: z.array(fareFamilySchema).min(1),
  capabilities: capabilitiesSchema,
  protectionRuleId: z.string().optional(),
});

const propertySchema = z.object({
  id: z.string(),
  name: z.string(),
  area: z.string(),
  distanceKm: z.number(),
  distanceTo: z.string().optional(),
  fromPriceMinor: z.number().int(),
  photos: z.array(z.string()).optional(),
});

const cancellationSchema = z.object({
  freeUntil: z.string(),
  penaltyAfter: z.string(),
});

const rateSchema = z.object({
  id: z.string(),
  propertyId: z.string(),
  roomName: z.string(),
  board: z.string().optional(),
  occupancy: z
    .object({
      minAdults: z.number().int().optional(),
      maxAdults: z.number().int().optional(),
      bookable: z.boolean().optional(),
      reason: z.string().optional(),
    })
    .optional(),
  payNowMinor: z.number().int(),
  payAtPropertyMinor: z.number().int().optional(),
  supplierPriceMinor: z.number().int().optional(),
  supplierCurrency: z.string().optional(),
  fxRate: z.number().optional(),
  fxLockedUntil: z.string().optional(),
  taxesNote: z.string().optional(),
  cancellation: cancellationSchema,
  capabilities: capabilitiesSchema,
  protectionRuleId: z.string().optional(),
});

const controlSchema = z.object({
  bookOutcome: z
    .enum(["confirmed", "supplier_pending", "failed", "unknown"])
    .optional(),
  documentsIssued: z.boolean().optional(),
  repriceToMinor: z.number().int().optional(),
  soldOut: z.boolean().optional(),
  lookupState: z
    .enum(["confirmed", "ticketed", "failed", "pending", "unknown"])
    .optional(),
  lookupDocumentsIssued: z.boolean().optional(),
  pnr: z.string().optional(),
  bookingRef: z.string().optional(),
  orderRef: z.string().optional(),
  ticketNumbers: z.array(z.string()).optional(),
  invoicedMinor: z.number().int().optional(),
  refundStage: z.enum(["supplier_confirmed", "rejected"]).optional(),
  cancelPenaltyMinor: z.number().int().optional(),
  cancelAccepted: z.boolean().optional(),
});

const fixtureConfigSchema = z.object({
  currency: z.string(),
  webhookSecret: z.string().optional(),
  cacheSeconds: z.number().int().nonnegative().optional(),
  liveCallsBlocked: z.boolean().optional(),
  catalog: z
    .object({
      flights: z.array(flightSchema).optional(),
      properties: z.array(propertySchema).optional(),
      rates: z.array(rateSchema).optional(),
    })
    .optional(),
  control: z.record(controlSchema).optional(),
});

type FixtureConfig = z.infer<typeof fixtureConfigSchema>;
type FixtureFlight = z.infer<typeof flightSchema>;
type FixtureRate = z.infer<typeof rateSchema>;
type FixtureCapabilities = z.infer<typeof capabilitiesSchema>;
type Control = z.infer<typeof controlSchema>;

function parseConfig(ctx: SupplierContext): FixtureConfig {
  return fixtureConfigSchema.parse(ctx.config);
}

function toCapabilities(c: FixtureCapabilities): SupplyCapabilities {
  return {
    holdSupported: c.holdSupported,
    holdExpiresAt: c.holdExpiresAt ?? null,
    priceGuaranteeUntil: c.priceGuaranteeUntil ?? null,
    merchantOfRecord: c.merchantOfRecord,
    changeSupported: c.changeSupported,
    refundSupported: c.refundSupported,
    currency: c.currency,
    payAtProperty: c.payAtProperty ?? false,
    currencies: c.currencies ?? [c.currency],
    coverage: c.coverage ?? null,
  };
}

/** The same capability record as a plain, JSON-safe object for `offer_snapshot`. */
function capsJson(c: FixtureCapabilities): JsonRecord {
  return {
    holdSupported: c.holdSupported,
    holdExpiresAt: c.holdExpiresAt ?? null,
    priceGuaranteeUntil: c.priceGuaranteeUntil ?? null,
    merchantOfRecord: c.merchantOfRecord,
    changeSupported: c.changeSupported,
    refundSupported: c.refundSupported,
    currency: c.currency,
    payAtProperty: c.payAtProperty ?? false,
    currencies: c.currencies ?? [c.currency],
    coverage: c.coverage ?? null,
  };
}

/** A purchasable flight fare is keyed `offerRef#fareFamilyId`; a stay by rate id. */
function splitFlightRef(purchaseRef: string): {
  offerRef: string;
  fareFamilyId: string | null;
} {
  const hashIndex = purchaseRef.indexOf("#");
  if (hashIndex === -1) {
    return { offerRef: purchaseRef, fareFamilyId: null };
  }
  return {
    offerRef: purchaseRef.slice(0, hashIndex),
    fareFamilyId: purchaseRef.slice(hashIndex + 1),
  };
}

function controlFor(cfg: FixtureConfig, ...keys: string[]): Control {
  const control = cfg.control ?? {};
  for (const key of keys) {
    const entry = control[key];
    if (entry !== undefined) {
      return entry;
    }
  }
  return {};
}

// ---------------------------------------------------------------------------
// Flight adapter
// ---------------------------------------------------------------------------

function flightOfferView(flight: FixtureFlight): JsonRecord {
  return {
    offerRef: flight.offerRef,
    carrier: flight.carrier,
    flightNumber: flight.flightNumber,
    aircraft: flight.aircraft ?? null,
    departAt: flight.departAt,
    arriveAt: flight.arriveAt,
    departTerminal: flight.departTerminal ?? null,
    arriveTerminal: flight.arriveTerminal ?? null,
    durationMin: flight.durationMin,
    stops: flight.stops,
    soldOut: false,
    fareFamilies: flight.fareFamilies.map((family) => ({
      id: family.id,
      name: family.name,
      price: { amountMinor: family.priceMinor, currency: flight.capabilities.currency },
      base:
        family.baseMinor === undefined
          ? null
          : { amountMinor: family.baseMinor, currency: flight.capabilities.currency },
      taxes:
        family.taxesMinor === undefined
          ? null
          : { amountMinor: family.taxesMinor, currency: flight.capabilities.currency },
      baggage: family.baggage,
      changeRule: family.changeRule,
      refundRule: family.refundRule,
      protectionOffered: family.protectionOffered ?? false,
      seatsLeft: family.seatsLeft ?? null,
    })),
    capabilities: capsJson(flight.capabilities),
  };
}

function flightFareOffer(
  cfg: FixtureConfig,
  flight: FixtureFlight,
  fareFamilyId: string,
  now: Date,
): AdapterOffer {
  const family =
    flight.fareFamilies.find((f) => f.id === fareFamilyId) ??
    flight.fareFamilies[0];
  if (family === undefined) {
    throw new Error(`flight ${flight.offerRef} has no fare families`);
  }
  const currency = flight.capabilities.currency;
  const purchaseRef = `${flight.offerRef}#${family.id}`;
  const control = controlFor(cfg, purchaseRef, flight.offerRef);
  const priceMinor = control.repriceToMinor ?? family.priceMinor;
  void now;
  return {
    offerRef: purchaseRef,
    kind: "flight",
    snapshot: {
      ...flightOfferView(flight),
      chosenFareFamilyId: family.id,
      protectionRuleId: flight.protectionRuleId ?? null,
    },
    price: money(priceMinor, currency),
    capabilities: toCapabilities(flight.capabilities),
    soldOut: control.soldOut ?? false,
    policy: {
      cancellation: family.refundRule,
      change: family.changeRule,
    },
  };
}

function bookResultFrom(
  control: Control,
  ourRef: string,
  currency: string,
): BookResult {
  const outcome = control.bookOutcome ?? "confirmed";
  if (outcome === "failed") {
    return {
      outcome,
      supplierRefs: {},
      documentsIssued: false,
      reason: "supplier rejected the booking",
    };
  }
  if (outcome === "unknown") {
    // A timeout: the supplier may or may not have taken the booking. We must
    // never assume either way — reconcile by our own reference (CLAUDE.md #24).
    return { outcome, supplierRefs: {}, documentsIssued: false };
  }
  const supplierRefs = {
    ...(control.pnr === undefined ? {} : { pnr: control.pnr }),
    ...(control.bookingRef === undefined ? {} : { bookingRef: control.bookingRef }),
    ...(control.orderRef === undefined
      ? { orderRef: `SUP-${ourRef}` }
      : { orderRef: control.orderRef }),
    ...(control.ticketNumbers === undefined
      ? {}
      : { ticketNumbers: control.ticketNumbers }),
  };
  return {
    outcome,
    supplierRefs,
    documentsIssued: control.documentsIssued ?? false,
    invoiced:
      control.invoicedMinor === undefined
        ? null
        : money(control.invoicedMinor, currency),
  };
}

function lookupResultFrom(control: Control, currency: string): LookupResult {
  const state = control.lookupState ?? "unknown";
  if (state === "unknown") {
    return { found: false, state, supplierRefs: {}, documentsIssued: false };
  }
  const supplierRefs = {
    ...(control.pnr === undefined ? {} : { pnr: control.pnr }),
    ...(control.bookingRef === undefined ? {} : { bookingRef: control.bookingRef }),
    ...(control.ticketNumbers === undefined
      ? {}
      : { ticketNumbers: control.ticketNumbers }),
  };
  return {
    found: state !== "failed",
    state,
    supplierRefs,
    documentsIssued: control.lookupDocumentsIssued ?? state === "ticketed",
    invoiced:
      control.invoicedMinor === undefined
        ? null
        : money(control.invoicedMinor, currency),
  };
}

const servicingMixin = {
  async hold(_ctx: SupplierContext, _offerRef: string): Promise<HoldResult> {
    // The fixture catalog holds no live inventory, so it never claims a hold.
    return { held: false };
  },

  async lookup(ctx: SupplierContext, ourRef: string): Promise<LookupResult> {
    const cfg = parseConfig(ctx);
    return lookupResultFrom(controlFor(cfg, ourRef), cfg.currency);
  },

  async reconcile(ctx: SupplierContext, ourRef: string): Promise<LookupResult> {
    const cfg = parseConfig(ctx);
    return lookupResultFrom(controlFor(cfg, ourRef), cfg.currency);
  },

  async status(ctx: SupplierContext, ourRef: string): Promise<StatusResult> {
    const cfg = parseConfig(ctx);
    const result = lookupResultFrom(controlFor(cfg, ourRef), cfg.currency);
    return {
      state: result.state,
      supplierRefs: result.supplierRefs,
      documentsIssued: result.documentsIssued,
    };
  },

  async cancel(ctx: SupplierContext, request: CancelRequest): Promise<CancelResult> {
    const cfg = parseConfig(ctx);
    const control = controlFor(cfg, request.ourRef);
    const penaltyMinor = control.cancelPenaltyMinor ?? 0;
    return {
      accepted: control.cancelAccepted ?? true,
      penalty: money(penaltyMinor, cfg.currency),
      refundable: money(0, cfg.currency),
    };
  },

  async refund(ctx: SupplierContext, request: RefundRequest): Promise<RefundResult> {
    const cfg = parseConfig(ctx);
    const control = controlFor(cfg, request.ourRef);
    const stage = control.refundStage ?? "supplier_confirmed";
    return stage === "rejected"
      ? { stage, reason: "supplier declined the refund" }
      : { stage, supplierRef: `RF-${request.ourRef}` };
  },

  async change(ctx: SupplierContext, request: ChangeRequest): Promise<ChangeResult> {
    const cfg = parseConfig(ctx);
    const control = controlFor(cfg, request.alternativeRef, request.ourRef);
    const supplierRefs = {
      ...(control.pnr === undefined ? {} : { pnr: control.pnr }),
      ...(control.ticketNumbers === undefined
        ? {}
        : { ticketNumbers: control.ticketNumbers }),
      orderRef: `SUP-${request.ourRef}`,
    };
    return {
      outcome: "changed",
      supplierRefs,
      documentsIssued: control.documentsIssued ?? true,
    };
  },
};

export function createFixtureFlightAdapter(): FlightSupplyAdapter {
  return {
    adapter: "fixture",
    kind: "flight",

    async search(
      ctx: SupplierContext,
      params: FlightSearchParams,
    ): Promise<SearchResult> {
      const cfg = parseConfig(ctx);
      const now = ctx.now();
      const flights = cfg.catalog?.flights ?? [];
      const matching = flights.filter(
        (flight) =>
          (flight.from === undefined || flight.from === params.from) &&
          (flight.to === undefined || flight.to === params.to),
      );
      const offers = matching.map((flight) => {
        const first = flight.fareFamilies[0];
        return flightFareOffer(cfg, flight, first === undefined ? "" : first.id, now);
      });
      const cacheSeconds = cfg.cacheSeconds ?? 0;
      return {
        offers,
        pricesAsOf: now,
        cacheUntil:
          cacheSeconds > 0 ? new Date(now.getTime() + cacheSeconds * 1000) : null,
        latencyMs: 0,
      };
    },

    async refreshOffer(
      ctx: SupplierContext,
      offerRef: string,
    ): Promise<OfferValidation> {
      const cfg = parseConfig(ctx);
      const { offerRef: baseRef, fareFamilyId } = splitFlightRef(offerRef);
      const flight = (cfg.catalog?.flights ?? []).find(
        (f) => f.offerRef === baseRef,
      );
      if (flight === undefined) {
        throw new Error(`unknown flight offer ${offerRef}`);
      }
      const offer = flightFareOffer(
        cfg,
        flight,
        fareFamilyId ?? (flight.fareFamilies[0]?.id ?? ""),
        ctx.now(),
      );
      const control = controlFor(cfg, offerRef, baseRef);
      const repriced = control.repriceToMinor !== undefined;
      const soldOut = control.soldOut ?? false;
      return { available: !soldOut, repriced, soldOut, offer };
    },

    async book(ctx: SupplierContext, request: BookRequest): Promise<BookResult> {
      const cfg = parseConfig(ctx);
      const control = controlFor(cfg, request.offerRef, request.ourRef);
      return bookResultFrom(control, request.ourRef, cfg.currency);
    },

    async providerHealth(ctx: SupplierContext): Promise<ProviderHealth> {
      const cfg = parseConfig(ctx);
      return {
        supplierId: ctx.supplierId,
        adapter: "fixture",
        reachable: true,
        liveCallsBlocked: cfg.liveCallsBlocked ?? false,
        note: "deterministic fixture adapter",
      };
    },

    ...servicingMixin,
  };
}

// ---------------------------------------------------------------------------
// Stay adapter
// ---------------------------------------------------------------------------

function rateOffer(cfg: FixtureConfig, rate: FixtureRate): AdapterOffer {
  const currency = rate.capabilities.currency;
  const control = controlFor(cfg, rate.id);
  const priceMinor = control.repriceToMinor ?? rate.payNowMinor;
  const supplierPrice =
    rate.supplierPriceMinor !== undefined && rate.supplierCurrency !== undefined
      ? money(rate.supplierPriceMinor, rate.supplierCurrency)
      : null;
  const fx =
    rate.fxRate !== undefined && rate.fxLockedUntil !== undefined
      ? { rate: rate.fxRate, lockedUntil: rate.fxLockedUntil }
      : null;
  return {
    offerRef: rate.id,
    kind: "stay",
    snapshot: {
      id: rate.id,
      propertyId: rate.propertyId,
      roomName: rate.roomName,
      board: rate.board ?? null,
      occupancy: rate.occupancy ?? null,
      payNow: { amountMinor: priceMinor, currency },
      payAtProperty:
        rate.payAtPropertyMinor === undefined
          ? null
          : { amountMinor: rate.payAtPropertyMinor, currency },
      supplierPrice:
        supplierPrice === null
          ? null
          : { amountMinor: supplierPrice.amountMinor, currency: supplierPrice.currency },
      fx: fx === null ? null : { rate: fx.rate, lockedUntil: fx.lockedUntil },
      taxesNote: rate.taxesNote ?? null,
      cancellation: { freeUntil: rate.cancellation.freeUntil, penaltyAfter: rate.cancellation.penaltyAfter },
      capabilities: capsJson(rate.capabilities),
      protectionRuleId: rate.protectionRuleId ?? null,
    },
    price: money(priceMinor, currency),
    supplierPrice,
    fx,
    payAtProperty:
      rate.payAtPropertyMinor === undefined
        ? null
        : money(rate.payAtPropertyMinor, currency),
    capabilities: toCapabilities(rate.capabilities),
    soldOut: control.soldOut ?? false,
    policy: {
      cancellation: `free until ${rate.cancellation.freeUntil}; ${rate.cancellation.penaltyAfter}`,
      freeUntil: rate.cancellation.freeUntil,
    },
  };
}

export function createFixtureStayAdapter(): StaySupplyAdapter {
  return {
    adapter: "fixture",
    kind: "stay",

    async search(
      ctx: SupplierContext,
      params: StaySearchParams,
    ): Promise<SearchResult> {
      const cfg = parseConfig(ctx);
      const now = ctx.now();
      const properties = cfg.catalog?.properties ?? [];
      const offers = properties.map((property) => ({
        offerRef: property.id,
        kind: "stay" as const,
        snapshot: {
          id: property.id,
          name: property.name,
          area: property.area,
          distanceKm: property.distanceKm,
          distanceTo: property.distanceTo ?? null,
          fromPrice: { amountMinor: property.fromPriceMinor, currency: cfg.currency },
          photos: property.photos ?? [],
        },
        price: money(property.fromPriceMinor, cfg.currency),
        capabilities: {
          holdSupported: false,
          merchantOfRecord: "supplier" as const,
          changeSupported: false,
          refundSupported: true,
          currency: cfg.currency,
        },
        policy: {},
      }));
      void params;
      const cacheSeconds = cfg.cacheSeconds ?? 0;
      return {
        offers,
        pricesAsOf: now,
        cacheUntil:
          cacheSeconds > 0 ? new Date(now.getTime() + cacheSeconds * 1000) : null,
        latencyMs: 0,
      };
    },

    async rates(
      ctx: SupplierContext,
      propertyId: string,
    ): Promise<readonly AdapterOffer[]> {
      const cfg = parseConfig(ctx);
      const rates = (cfg.catalog?.rates ?? []).filter(
        (rate) => rate.propertyId === propertyId,
      );
      return rates.map((rate) => rateOffer(cfg, rate));
    },

    async refreshOffer(
      ctx: SupplierContext,
      offerRef: string,
    ): Promise<OfferValidation> {
      const cfg = parseConfig(ctx);
      const rate = (cfg.catalog?.rates ?? []).find((r) => r.id === offerRef);
      if (rate === undefined) {
        throw new Error(`unknown stay rate ${offerRef}`);
      }
      const offer = rateOffer(cfg, rate);
      const control = controlFor(cfg, offerRef);
      const repriced = control.repriceToMinor !== undefined;
      const soldOut = control.soldOut ?? false;
      return { available: !soldOut, repriced, soldOut, offer };
    },

    async book(ctx: SupplierContext, request: BookRequest): Promise<BookResult> {
      const cfg = parseConfig(ctx);
      const control = controlFor(cfg, request.offerRef, request.ourRef);
      return bookResultFrom(control, request.ourRef, cfg.currency);
    },

    async providerHealth(ctx: SupplierContext): Promise<ProviderHealth> {
      const cfg = parseConfig(ctx);
      return {
        supplierId: ctx.supplierId,
        adapter: "fixture",
        reachable: true,
        liveCallsBlocked: cfg.liveCallsBlocked ?? false,
        note: "deterministic fixture adapter",
      };
    },

    ...servicingMixin,
  };
}
