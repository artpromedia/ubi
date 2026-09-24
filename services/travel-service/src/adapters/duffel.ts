/**
 * Duffel — FLIGHTS ONLY (https://duffel.com/docs/api, API version v2).
 *
 * Every capability maps to a documented Duffel endpoint or refuses with a
 * typed alternative; nothing here fabricates a success.
 *
 *   search        POST /air/offer_requests?return_offers=true&supplier_timeout=…
 *   refreshOffer  GET  /air/offers/{id}  ("complete, up-to-date information")
 *   book          POST /air/orders  (type `instant`, paid from the Duffel balance)
 *   lookup/status GET  /air/orders/{id}, or GET /air/orders?offer_id=… matched
 *                 on our `metadata.ubi_order_ref` when only the offer is known
 *   change        POST /air/order_changes + /air/order_changes/{id}/actions/confirm
 *                 (change offers from POST /air/order_change_requests)
 *   quoteCancel   POST /air/order_cancellations  (a PENDING cancellation — its
 *                 refund is known before anything is cancelled)
 *   cancel        POST /air/order_cancellations/{id}/actions/confirm
 *   refund        unsupported: Duffel returns the refundable amount when a
 *                 cancellation is confirmed; there is no separate refund call
 *   hold          not offered by this build (instant orders only)
 *
 * BOOKING AMBIGUITY, per Duffel's "Order creation response handling": 201 is a
 * created order; 200 and 202 mean the booking was taken but is not yet
 * readable (never retry — a retry can double-book); 503 means "we know for
 * sure that no booking was created"; 500/502/504 and timeouts are unknown and
 * must NOT be retried. So an ambiguous book immediately asks Duffel whether an
 * order exists for the offer (matched on our reference); only an order it can
 * see closes the question, and absence alone leaves the order unresolved for
 * reconciliation — never a second booking.
 *
 * MONEY. Duffel quotes decimal strings with an explicit currency; they become
 * integer minor units via ./money.ts (no float), with base fare and taxes
 * itemised beside the exact total. The payment sent to Duffel is the offer's
 * own `total_amount` string, byte for byte. An offer priced in a currency the
 * supplier row does not settle in is not sold (FX is never guessed).
 *
 * TIME. Duffel schedule times are local airport wall-clock times; each is
 * stored with its offset and as a UTC instant (./time.ts).
 */
import { z } from "zod";

import { ContractError, money, type Money } from "@ubi/contracts";

import {
  SupplierHttpError,
  SupplierPreflightError,
  SupplierUnsupportedError,
} from "./errors";
import {
  assertCallable,
  httpConfigSchema,
  httpSupplierHealth,
  isProductionEnv,
  resolveBaseUrl,
  resolveSecret,
  supplierRequest,
  type CapabilitySpec,
  type HttpSupplierHealth,
  type SupplierEndpoint,
  type SupplierResponse,
} from "./http-supplier";
import { decimalToMinor, SupplierAmountError } from "./money";
import {
  ageOn,
  daysBetween,
  earliestCurrentDate,
  isCalendarDate,
  zonedLocalToUtc,
} from "./time";
import { adapterLogger } from "../lib/logger";

import type {
  AdapterOffer,
  BookRequest,
  BookResult,
  CancelQuote,
  CancelRequest,
  CancelResult,
  ChangeRequest,
  ChangeResult,
  FlightSearchParams,
  FlightSupplyAdapter,
  LookupHint,
  LookupResult,
  OfferValidation,
  RefundResult,
  SearchResult,
  StatusResult,
  SupplierContext,
  SupplierRefs,
  SupplyCapabilities,
} from "./types";
import type { JsonRecord, JsonValue } from "../ops/types";

export const DUFFEL_ENDPOINT: SupplierEndpoint = {
  adapter: "duffel",
  defaultBaseUrl: "https://api.duffel.com",
  officialHosts: ["api.duffel.com"],
  // Duffel access tokens name their mode: `duffel_test_…` / `duffel_live_…`.
  testCredentialPrefixes: ["duffel_test_"],
};

export const DUFFEL_API_VERSION = "v2";

/** Duffel limits a single order to nine passengers. */
const MAX_PASSENGERS = 9;
/** The one fare family a Duffel offer carries (an offer IS one fare). */
export const DUFFEL_FARE_ID = "fare";

const duffelConfigSchema = httpConfigSchema.extend({
  /** Per-airline search timeout Duffel honours (`supplier_timeout`, ms). */
  supplierTimeoutMs: z.number().int().min(2_000).max(60_000).optional(),
  maxConnections: z.number().int().min(0).max(2).optional(),
  maxOffers: z.number().int().min(1).max(200).optional(),
  /** Signed-webhook timestamp tolerance, seconds. */
  webhookToleranceSec: z.number().int().min(30).max(3_600).optional(),
  /**
   * How long after the offer expired an order that Duffel still cannot show
   * us is treated as never created. Duffel documents that an order from an
   * ambiguous creation "might take a couple of hours to show up".
   */
  lookupFailAfterHours: z.number().int().min(3).max(168).optional(),
});

type DuffelConfig = z.infer<typeof duffelConfigSchema>;

function duffelConfig(ctx: SupplierContext): DuffelConfig {
  const parsed = duffelConfigSchema.safeParse(ctx.config);
  if (!parsed.success) {
    throw new SupplierPreflightError(
      "service_unavailable",
      "config_invalid",
      "the Duffel supplier configuration is not valid; no provider call was made",
      { supplierId: ctx.supplierId },
    );
  }
  return parsed.data;
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Duffel-Version": DUFFEL_API_VERSION,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

// ---------------------------------------------------------------------------
// Response schemas (only what UBI relies on; unknown fields pass through)
// ---------------------------------------------------------------------------

const Place = z
  .object({
    iata_code: z.string().nullable().optional(),
    time_zone: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
  })
  .passthrough();

const Carrier = z
  .object({
    name: z.string(),
    iata_code: z.string().nullable().optional(),
  })
  .passthrough();

const Baggage = z.object({ type: z.string(), quantity: z.number().int() });

const SegmentPassenger = z
  .object({
    passenger_id: z.string(),
    baggages: z.array(Baggage).optional(),
    cabin_class: z.string().nullable().optional(),
    cabin_class_marketing_name: z.string().nullable().optional(),
  })
  .passthrough();

const Segment = z
  .object({
    id: z.string(),
    origin: Place,
    destination: Place,
    departing_at: z.string(),
    arriving_at: z.string(),
    origin_terminal: z.string().nullable().optional(),
    destination_terminal: z.string().nullable().optional(),
    operating_carrier: Carrier,
    marketing_carrier: Carrier,
    operating_carrier_flight_number: z.string().nullable().optional(),
    marketing_carrier_flight_number: z.string().nullable().optional(),
    aircraft: z
      .object({ name: z.string() })
      .passthrough()
      .nullable()
      .optional(),
    passengers: z.array(SegmentPassenger).optional(),
  })
  .passthrough();

const Slice = z
  .object({
    id: z.string(),
    origin: Place,
    destination: Place,
    segments: z.array(Segment).min(1),
    fare_brand_name: z.string().nullable().optional(),
  })
  .passthrough();

const Condition = z
  .object({
    allowed: z.boolean().nullable().optional(),
    penalty_amount: z.string().nullable().optional(),
    penalty_currency: z.string().nullable().optional(),
  })
  .passthrough()
  .nullable()
  .optional();

const OfferPassenger = z
  .object({
    id: z.string(),
    type: z.string().nullable().optional(),
    age: z.number().nullable().optional(),
  })
  .passthrough();

const TaxLine = z
  .object({
    amount: z.string(),
    currency: z.string(),
    code: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  })
  .passthrough();

export const DuffelOfferSchema = z
  .object({
    id: z.string(),
    total_amount: z.string(),
    total_currency: z.string(),
    base_amount: z.string().nullable().optional(),
    base_currency: z.string().nullable().optional(),
    tax_amount: z.string().nullable().optional(),
    tax_currency: z.string().nullable().optional(),
    tax_breakdown: z.array(TaxLine).nullable().optional(),
    expires_at: z.string(),
    live_mode: z.boolean().optional(),
    owner: Carrier.optional(),
    slices: z.array(Slice).min(1),
    passengers: z.array(OfferPassenger).min(1),
    conditions: z
      .object({
        refund_before_departure: Condition,
        change_before_departure: Condition,
      })
      .passthrough()
      .nullable()
      .optional(),
    payment_requirements: z
      .object({
        requires_instant_payment: z.boolean().nullable().optional(),
        price_guarantee_expires_at: z.string().nullable().optional(),
        payment_required_by: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    passenger_identity_documents_required: z.boolean().nullable().optional(),
  })
  .passthrough();

type DuffelOffer = z.infer<typeof DuffelOfferSchema>;

const OrderDocument = z
  .object({
    type: z.string(),
    unique_identifier: z.string(),
    passenger_ids: z.array(z.string()).optional(),
  })
  .passthrough();

export const DuffelOrderSchema = z
  .object({
    id: z.string(),
    offer_id: z.string().nullable().optional(),
    booking_reference: z.string().nullable().optional(),
    total_amount: z.string(),
    total_currency: z.string(),
    cancelled_at: z.string().nullable().optional(),
    documents: z.array(OrderDocument).nullable().optional(),
    passengers: z.array(z.object({ id: z.string() }).passthrough()).optional(),
    metadata: z.record(z.unknown()).nullable().optional(),
    payment_status: z
      .object({ awaiting_payment: z.boolean().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    type: z.string().nullable().optional(),
    live_mode: z.boolean().optional(),
  })
  .passthrough();

type DuffelOrder = z.infer<typeof DuffelOrderSchema>;

const DuffelCancellationSchema = z
  .object({
    id: z.string(),
    order_id: z.string(),
    refund_amount: z.string().nullable().optional(),
    refund_currency: z.string().nullable().optional(),
    refund_to: z.string().nullable().optional(),
    expires_at: z.string().nullable().optional(),
    confirmed_at: z.string().nullable().optional(),
  })
  .passthrough();

const DuffelOrderChangeSchema = z
  .object({
    id: z.string(),
    order_id: z.string(),
    change_total_amount: z.string(),
    change_total_currency: z.string(),
    new_total_amount: z.string().nullable().optional(),
    new_total_currency: z.string().nullable().optional(),
    penalty_total_amount: z.string().nullable().optional(),
    penalty_total_currency: z.string().nullable().optional(),
    expires_at: z.string().nullable().optional(),
    confirmed_at: z.string().nullable().optional(),
  })
  .passthrough();

const DuffelChangeOfferSchema = z
  .object({
    id: z.string(),
    change_total_amount: z.string(),
    change_total_currency: z.string(),
    new_total_amount: z.string().nullable().optional(),
    new_total_currency: z.string().nullable().optional(),
    penalty_total_amount: z.string().nullable().optional(),
    penalty_total_currency: z.string().nullable().optional(),
    expires_at: z.string().nullable().optional(),
  })
  .passthrough();

const ErrorBody = z
  .object({
    errors: z
      .array(
        z
          .object({
            type: z.string().nullable().optional(),
            code: z.string().nullable().optional(),
            title: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

function supplierErrorCode(body: unknown): string | null {
  const parsed = ErrorBody.safeParse(body);
  if (!parsed.success) {
    return null;
  }
  const first = parsed.data.errors?.[0];
  return first?.code ?? first?.type ?? null;
}

function dataOf(body: unknown): unknown {
  return typeof body === "object" && body !== null
    ? (body as { data?: unknown }).data
    : undefined;
}

/** A Duffel reply UBI cannot read is a provider fault, never a guessed success. */
function unreadable(operation: string, detail: string): ContractError {
  return new ContractError(
    "service_unavailable",
    `Duffel returned a ${operation} response this service cannot read`,
    { adapter: "duffel", operation, detail, providerCalled: true },
  );
}

/** Maps a non-2xx reply to a read/search operation onto a contract error. */
function readFailure(
  operation: string,
  response: SupplierResponse,
): ContractError {
  const code = supplierErrorCode(response.body);
  const details = {
    adapter: "duffel",
    operation,
    status: response.status,
    supplierCode: code,
    providerCalled: true,
  };
  if (response.status === 404) {
    return new ContractError(
      "not_found",
      "Duffel has no such resource",
      details,
    );
  }
  if (response.status === 429) {
    return new ContractError(
      "rate_limited",
      "Duffel is rate limiting this service; try again shortly",
      details,
    );
  }
  if (response.status === 400 || response.status === 422) {
    return new ContractError(
      "validation_failed",
      "Duffel refused the request as invalid",
      details,
    );
  }
  return new ContractError(
    "service_unavailable",
    `Duffel could not complete ${operation}`,
    details,
  );
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function minor(raw: string, currency: string): number {
  return decimalToMinor(raw, currency);
}

function conditionText(
  condition: z.infer<typeof Condition>,
  verb: "refund" | "change",
): string {
  if (condition === null || condition === undefined) {
    return `${verb} terms not stated by the airline`;
  }
  if (condition.allowed === false) {
    return verb === "refund" ? "non-refundable" : "changes not allowed";
  }
  if (condition.allowed !== true) {
    return `${verb} terms not stated by the airline`;
  }
  const penalty =
    condition.penalty_amount !== null &&
    condition.penalty_amount !== undefined &&
    typeof condition.penalty_currency === "string"
      ? `; penalty ${condition.penalty_currency} ${condition.penalty_amount}`
      : "";
  return verb === "refund"
    ? `refundable before departure${penalty}`
    : `changes allowed before departure${penalty}`;
}

function conditionJson(condition: z.infer<typeof Condition>): JsonValue {
  if (condition === null || condition === undefined) {
    return null;
  }
  let penalty: JsonValue = null;
  if (
    typeof condition.penalty_amount === "string" &&
    typeof condition.penalty_currency === "string"
  ) {
    try {
      penalty = {
        amountMinor: minor(
          condition.penalty_amount,
          condition.penalty_currency,
        ),
        currency: condition.penalty_currency,
      };
    } catch {
      penalty = null;
    }
  }
  return { allowed: condition.allowed ?? null, penalty };
}

function baggageText(segment: z.infer<typeof Segment>): string {
  const passenger = segment.passengers?.[0];
  if (passenger === undefined || passenger.baggages === undefined) {
    return "baggage allowance not stated by the airline";
  }
  const counts = new Map<string, number>();
  for (const bag of passenger.baggages) {
    counts.set(bag.type, (counts.get(bag.type) ?? 0) + bag.quantity);
  }
  const checked = counts.get("checked") ?? 0;
  const carryOn = counts.get("carry_on") ?? 0;
  const parts: string[] = [];
  parts.push(checked > 0 ? `${checked} checked` : "no checked bag");
  if (carryOn > 0) {
    parts.push(`${carryOn} carry-on`);
  }
  return parts.join(", ");
}

interface MappedSegment {
  readonly json: JsonRecord;
  readonly departUtc: string;
  readonly arriveUtc: string;
  readonly departLocal: string;
  readonly arriveLocal: string;
}

function mapSegment(segment: z.infer<typeof Segment>): MappedSegment {
  const departZone = segment.origin.time_zone ?? "";
  const arriveZone = segment.destination.time_zone ?? "";
  const depart = zonedLocalToUtc(segment.departing_at, departZone);
  const arrive = zonedLocalToUtc(segment.arriving_at, arriveZone);
  if (depart === null || arrive === null) {
    // A schedule time without a usable zone cannot be placed in time; the
    // offer is refused rather than shown at a guessed hour.
    throw new Error(`segment ${segment.id} has no usable airport time zone`);
  }
  const marketing =
    `${segment.marketing_carrier.iata_code ?? ""} ${segment.marketing_carrier_flight_number ?? ""}`.trim();
  return {
    departUtc: depart.utc,
    arriveUtc: arrive.utc,
    departLocal: depart.local,
    arriveLocal: arrive.local,
    json: {
      id: segment.id,
      from: segment.origin.iata_code ?? null,
      to: segment.destination.iata_code ?? null,
      departAt: depart.local,
      departAtUtc: depart.utc,
      departTimeZone: departZone,
      arriveAt: arrive.local,
      arriveAtUtc: arrive.utc,
      arriveTimeZone: arriveZone,
      departTerminal: segment.origin_terminal ?? null,
      arriveTerminal: segment.destination_terminal ?? null,
      // US regulations: the operating carrier is shown prominently.
      operatingCarrier: segment.operating_carrier.name,
      marketingCarrier: segment.marketing_carrier.name,
      flightNumber: marketing,
      aircraft: segment.aircraft?.name ?? null,
      baggage: baggageText(segment),
    },
  };
}

function minutesBetween(fromUtc: string, toUtc: string): number {
  return Math.round((Date.parse(toUtc) - Date.parse(fromUtc)) / 60_000);
}

interface Breakdown {
  readonly total: Money;
  readonly base: Money | null;
  readonly taxes: Money | null;
  readonly reconciles: boolean;
}

function breakdownOf(offer: {
  total_amount: string;
  total_currency: string;
  base_amount?: string | null;
  base_currency?: string | null;
  tax_amount?: string | null;
  tax_currency?: string | null;
}): Breakdown {
  const currency = offer.total_currency;
  const total = money(minor(offer.total_amount, currency), currency);
  const base =
    typeof offer.base_amount === "string" && offer.base_currency === currency
      ? money(minor(offer.base_amount, currency), currency)
      : null;
  const taxes =
    typeof offer.tax_amount === "string" && offer.tax_currency === currency
      ? money(minor(offer.tax_amount, currency), currency)
      : null;
  // Itemisation is only presented as exact when the parts add up to the
  // payable total; otherwise the total alone is authoritative.
  const reconciles =
    base !== null &&
    taxes !== null &&
    base.amountMinor + taxes.amountMinor === total.amountMinor;
  return { total, base, taxes, reconciles };
}

function moneyJson(value: Money | null): JsonValue {
  return value === null
    ? null
    : { amountMinor: value.amountMinor, currency: value.currency };
}

function capabilitiesOf(offer: DuffelOffer): SupplyCapabilities {
  return {
    // UBI books instant orders only; it never claims a seat hold.
    holdSupported: false,
    holdExpiresAt: null,
    priceGuaranteeUntil: null,
    // UBI pays Duffel from its balance and charges the traveller.
    merchantOfRecord: "ubi",
    changeSupported:
      offer.conditions?.change_before_departure?.allowed === true,
    refundSupported:
      offer.conditions?.refund_before_departure?.allowed === true,
    currency: offer.total_currency,
    currencies: [offer.total_currency],
    coverage: null,
  };
}

/**
 * Maps one Duffel offer onto UBI's offer shape. Throws when the offer cannot
 * be sold exactly (unusable time zone, an amount the currency cannot hold).
 */
export function mapDuffelOffer(offer: DuffelOffer): AdapterOffer {
  const breakdown = breakdownOf(offer);
  const slices = offer.slices.map((slice) => {
    const segments = slice.segments.map(mapSegment);
    const first = segments[0];
    const last = segments[segments.length - 1];
    if (first === undefined || last === undefined) {
      throw new Error(`slice ${slice.id} has no segments`);
    }
    return {
      raw: slice,
      first,
      last,
      json: {
        id: slice.id,
        from: slice.origin.iata_code ?? null,
        to: slice.destination.iata_code ?? null,
        departAt: first.departLocal,
        departAtUtc: first.departUtc,
        arriveAt: last.arriveLocal,
        arriveAtUtc: last.arriveUtc,
        durationMin: minutesBetween(first.departUtc, last.arriveUtc),
        stops: segments.length - 1,
        fareBrand: slice.fare_brand_name ?? null,
        segments: segments.map((segment) => segment.json),
      } as JsonRecord,
    };
  });
  const outbound = slices[0];
  if (outbound === undefined) {
    throw new Error("offer has no slices");
  }
  const firstSegment = outbound.raw.segments[0];
  if (firstSegment === undefined) {
    throw new Error("offer has no segments");
  }
  const capabilities = capabilitiesOf(offer);
  const refundRule = conditionText(
    offer.conditions?.refund_before_departure,
    "refund",
  );
  const changeRule = conditionText(
    offer.conditions?.change_before_departure,
    "change",
  );
  const fareName =
    outbound.raw.fare_brand_name ??
    firstSegment.passengers?.[0]?.cabin_class_marketing_name ??
    "Fare";
  const lastSlice = slices[slices.length - 1] ?? outbound;

  const snapshot: JsonRecord = {
    offerRef: offer.id,
    supplierOfferId: offer.id,
    carrier: firstSegment.operating_carrier.name,
    marketingCarrier: firstSegment.marketing_carrier.name,
    owner: offer.owner?.name ?? null,
    flightNumber:
      `${firstSegment.marketing_carrier.iata_code ?? ""} ${firstSegment.marketing_carrier_flight_number ?? ""}`.trim(),
    aircraft: firstSegment.aircraft?.name ?? null,
    from: outbound.raw.origin.iata_code ?? null,
    to: outbound.raw.destination.iata_code ?? null,
    departAt: outbound.first.departLocal,
    departAtUtc: outbound.first.departUtc,
    arriveAt: outbound.last.arriveLocal,
    arriveAtUtc: outbound.last.arriveUtc,
    departTerminal: firstSegment.origin_terminal ?? null,
    arriveTerminal:
      outbound.raw.segments[outbound.raw.segments.length - 1]
        ?.destination_terminal ?? null,
    durationMin: minutesBetween(
      outbound.first.departUtc,
      outbound.last.arriveUtc,
    ),
    stops: outbound.raw.segments.length - 1,
    /** The last slice's departure — the date passenger ages are judged on. */
    lastDepartureDate: lastSlice.first.departLocal.slice(0, 10),
    slices: slices.map((slice) => slice.json),
    soldOut: false,
    fareFamilies: [
      {
        id: DUFFEL_FARE_ID,
        name: fareName,
        price: moneyJson(breakdown.total),
        base: moneyJson(breakdown.base),
        taxes: moneyJson(breakdown.taxes),
        baggage: baggageText(firstSegment),
        changeRule,
        refundRule,
        protectionOffered: false,
        seatsLeft: null,
      },
    ],
    priceBreakdown: {
      total: moneyJson(breakdown.total),
      base: moneyJson(breakdown.base),
      taxes: moneyJson(breakdown.taxes),
      taxLines: (offer.tax_breakdown ?? [])
        .filter((line) => line.currency === offer.total_currency)
        .map((line) => ({
          code: line.code ?? null,
          description: line.description ?? null,
          amountMinor: minor(line.amount, line.currency),
          currency: line.currency,
        })),
      // False when Duffel's base + tax do not add up to the total: the total
      // is then the only authoritative figure and no fee line is invented.
      reconciles: breakdown.reconciles,
    },
    /** The exact decimal Duffel expects in `payments[].amount`. */
    supplierTotal: {
      amount: offer.total_amount,
      currency: offer.total_currency,
    },
    passengers: offer.passengers.map((passenger) => ({
      id: passenger.id,
      type: passenger.type ?? null,
    })),
    documentsRequired: offer.passenger_identity_documents_required === true,
    quoteExpiresAt: offer.expires_at,
    liveMode: offer.live_mode ?? null,
    chosenFareFamilyId: DUFFEL_FARE_ID,
    protectionRuleId: null,
    capabilities: {
      holdSupported: capabilities.holdSupported,
      holdExpiresAt: null,
      priceGuaranteeUntil: null,
      merchantOfRecord: capabilities.merchantOfRecord,
      changeSupported: capabilities.changeSupported,
      refundSupported: capabilities.refundSupported,
      currency: capabilities.currency,
      payAtProperty: false,
      currencies: [capabilities.currency],
      coverage: null,
    },
  };
  return {
    offerRef: `${offer.id}#${DUFFEL_FARE_ID}`,
    supplierOfferRef: offer.id,
    kind: "flight",
    snapshot,
    price: breakdown.total,
    supplierPrice: breakdown.total,
    capabilities,
    soldOut: false,
    policy: {
      cancellation: refundRule,
      change: changeRule,
      refundBeforeDeparture: conditionJson(
        offer.conditions?.refund_before_departure,
      ),
      changeBeforeDeparture: conditionJson(
        offer.conditions?.change_before_departure,
      ),
      quoteExpiresAt: offer.expires_at,
    },
  };
}

function offerIdOf(purchaseRef: string): string {
  const hash = purchaseRef.indexOf("#");
  const id = hash === -1 ? purchaseRef : purchaseRef.slice(0, hash);
  const family = hash === -1 ? DUFFEL_FARE_ID : purchaseRef.slice(hash + 1);
  if (!/^off_[A-Za-z0-9]+$/.test(id) || family !== DUFFEL_FARE_ID) {
    throw new SupplierPreflightError(
      "validation_failed",
      "offer_ref_invalid",
      "that is not a Duffel offer reference",
      { purchaseRef },
    );
  }
  return id;
}

// ---------------------------------------------------------------------------
// Search validation and request mapping
// ---------------------------------------------------------------------------

export function duffelOfferRequestBody(
  params: FlightSearchParams,
  config: DuffelConfig,
): JsonRecord {
  const slices: JsonRecord[] = [
    {
      origin: params.from,
      destination: params.to,
      departure_date: params.departDate,
    },
  ];
  if (params.returnDate !== undefined) {
    slices.push({
      origin: params.to,
      destination: params.from,
      departure_date: params.returnDate,
    });
  }
  const passengers: JsonRecord[] = [];
  for (let index = 0; index < params.passengers; index += 1) {
    // UBI searches adults only; a child or infant is priced by age, which
    // this search surface does not collect yet.
    passengers.push({ type: "adult" });
  }
  return {
    data: {
      slices,
      passengers,
      cabin_class: params.cabin ?? "economy",
      max_connections: config.maxConnections ?? 1,
    },
  };
}

function validateSearch(params: FlightSearchParams, now: Date): void {
  const iata = /^[A-Z]{3}$/;
  const problems: string[] = [];
  if (!iata.test(params.from)) {
    problems.push("from");
  }
  if (!iata.test(params.to)) {
    problems.push("to");
  }
  if (params.from === params.to) {
    problems.push("to");
  }
  if (!isCalendarDate(params.departDate)) {
    problems.push("departDate");
  }
  if (params.returnDate !== undefined && !isCalendarDate(params.returnDate)) {
    problems.push("returnDate");
  }
  if (
    !Number.isInteger(params.passengers) ||
    params.passengers < 1 ||
    params.passengers > MAX_PASSENGERS
  ) {
    problems.push("passengers");
  }
  if (problems.length === 0) {
    const earliest = earliestCurrentDate(now);
    if (params.departDate < earliest) {
      problems.push("departDate");
    }
    if (
      params.returnDate !== undefined &&
      daysBetween(params.departDate, params.returnDate) < 0
    ) {
      problems.push("returnDate");
    }
  }
  if (problems.length > 0) {
    throw new SupplierPreflightError(
      "validation_failed",
      "search_invalid",
      "the flight search is not valid for Duffel",
      { fields: [...new Set(problems)] },
    );
  }
}

// ---------------------------------------------------------------------------
// Passenger validation (Duffel "Create an order" passenger requirements)
// ---------------------------------------------------------------------------

const TITLES = new Set(["mr", "ms", "mrs", "miss", "dr"]);
// Space, hyphen, apostrophe and letters from ASCII, Latin-1 Supplement and
// Latin Extended-A, minus Æ æ Ĳ ĳ Œ œ Þ ð — 1 to 20 characters.
const NAME = /^[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017F '-]{1,20}$/u;
const NAME_EXCLUDED = /[\u00C6\u00E6\u0132\u0133\u0152\u0153\u00DE\u00F0]/u;
const E164 = /^\+[1-9]\d{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function field(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function passengerProblem(index: number, name: string): never {
  // Never echo the value: passenger data is PII (CLAUDE.md #12).
  throw new SupplierPreflightError(
    "validation_failed",
    "passenger_invalid",
    `passenger ${index + 1} ${name} does not meet the airline's requirements`,
    { passengerIndex: index, field: name },
  );
}

export function duffelPassengers(
  passengers: readonly JsonRecord[],
  offerPassengers: readonly { id: string }[],
  lastDepartureDate: string,
  today: string,
): JsonRecord[] {
  if (passengers.length !== offerPassengers.length) {
    throw new SupplierPreflightError(
      "validation_failed",
      "passenger_count_mismatch",
      `this offer is priced for ${offerPassengers.length} passenger(s); ${passengers.length} were given`,
      { expected: offerPassengers.length, given: passengers.length },
    );
  }
  return passengers.map((passenger, index) => {
    const offerPassenger = offerPassengers[index];
    if (offerPassenger === undefined) {
      return passengerProblem(index, "id");
    }
    const title = field(passenger.title)?.toLowerCase().replace(/\.$/, "");
    if (title === undefined || !TITLES.has(title)) {
      passengerProblem(index, "title");
    }
    const given = field(passenger.givenNames);
    if (given === null || !NAME.test(given) || NAME_EXCLUDED.test(given)) {
      passengerProblem(index, "givenNames");
    }
    const family = field(passenger.surname);
    if (family === null || !NAME.test(family) || NAME_EXCLUDED.test(family)) {
      passengerProblem(index, "surname");
    }
    const gender = field(passenger.gender);
    if (gender !== "m" && gender !== "f") {
      passengerProblem(index, "gender");
    }
    const email = field(passenger.email);
    if (email === null || !EMAIL.test(email)) {
      passengerProblem(index, "email");
    }
    const phone = field(passenger.phone);
    if (phone === null || !E164.test(phone)) {
      passengerProblem(index, "phone");
    }
    const bornOn = field(passenger.dateOfBirth);
    if (bornOn === null || !isCalendarDate(bornOn) || bornOn >= today) {
      passengerProblem(index, "dateOfBirth");
    }
    // The search priced adults; Duffel judges age on the final slice's date.
    if (ageOn(bornOn, lastDepartureDate) < 18) {
      passengerProblem(index, "dateOfBirth");
    }
    return {
      id: offerPassenger.id,
      title: title as string,
      given_name: given,
      family_name: family,
      gender,
      born_on: bornOn,
      email,
      phone_number: phone,
    };
  });
}

// ---------------------------------------------------------------------------
// Order mapping
// ---------------------------------------------------------------------------

function refsOfOrder(order: DuffelOrder): SupplierRefs {
  const tickets = (order.documents ?? [])
    .filter((document) => document.type === "electronic_ticket")
    .map((document) => document.unique_identifier);
  return {
    ...(typeof order.booking_reference === "string"
      ? { pnr: order.booking_reference }
      : {}),
    orderRef: order.id,
    ...(tickets.length > 0 ? { ticketNumbers: tickets } : {}),
  };
}

/** True when every passenger holds an e-ticket — a PNR alone is not a ticket. */
function ticketsCoverPassengers(order: DuffelOrder): boolean {
  const tickets = (order.documents ?? []).filter(
    (document) => document.type === "electronic_ticket",
  );
  if (tickets.length === 0) {
    return false;
  }
  const passengerIds = (order.passengers ?? []).map(
    (passenger) => passenger.id,
  );
  if (passengerIds.length === 0) {
    return true;
  }
  const covered = new Set(
    tickets.flatMap((ticket) => ticket.passenger_ids ?? []),
  );
  return passengerIds.every((id) => covered.has(id));
}

export function mapDuffelOrder(order: DuffelOrder): LookupResult {
  const refs = refsOfOrder(order);
  let invoiced: Money | null = null;
  try {
    invoiced = money(
      minor(order.total_amount, order.total_currency),
      order.total_currency,
    );
  } catch {
    invoiced = null;
  }
  if (typeof order.cancelled_at === "string") {
    return {
      found: true,
      state: "cancelled",
      supplierRefs: refs,
      documentsIssued: false,
      invoiced,
    };
  }
  if (ticketsCoverPassengers(order)) {
    return {
      found: true,
      state: "ticketed",
      supplierRefs: refs,
      documentsIssued: true,
      invoiced,
    };
  }
  if (order.payment_status?.awaiting_payment === true) {
    return {
      found: true,
      state: "pending",
      supplierRefs: refs,
      documentsIssued: false,
      invoiced,
    };
  }
  if (typeof order.booking_reference === "string") {
    return {
      found: true,
      state: "confirmed",
      supplierRefs: refs,
      documentsIssued: false,
      invoiced,
    };
  }
  return {
    found: true,
    state: "pending",
    supplierRefs: refs,
    documentsIssued: false,
    invoiced,
  };
}

function metadataRef(order: DuffelOrder): string | null {
  const value = order.metadata?.ubi_order_ref;
  return typeof value === "string" ? value : null;
}

const NOT_FOUND: LookupResult = {
  found: false,
  state: "unknown",
  supplierRefs: {},
  documentsIssued: false,
};

function snapshotString(
  snapshot: JsonRecord | null | undefined,
  key: string,
): string | null {
  const value = snapshot?.[key];
  return typeof value === "string" ? value : null;
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export interface DuffelChangeOffer {
  readonly id: string;
  readonly changeTotal: Money;
  readonly newTotal: Money | null;
  readonly penalty: Money | null;
  readonly expiresAt: string | null;
}

export interface DuffelFlightAdapter extends FlightSupplyAdapter {
  /** Change offers for an order (POST /air/order_change_requests). */
  changeOffers(
    ctx: SupplierContext,
    supplierOrderRef: string,
    change: {
      readonly removeSliceIds: readonly string[];
      readonly add: readonly {
        readonly from: string;
        readonly to: string;
        readonly departDate: string;
        readonly cabin?: "economy" | "business";
      }[];
    },
  ): Promise<readonly DuffelChangeOffer[]>;
}

export const DUFFEL_CAPABILITIES: Readonly<Record<string, CapabilitySpec>> = {
  search: { implemented: true },
  refreshOffer: { implemented: true },
  book: { implemented: true },
  lookup: { implemented: true },
  status: { implemented: true },
  reconcile: { implemented: true },
  change: { implemented: true },
  changeOffers: { implemented: true },
  quoteCancel: { implemented: true },
  cancel: { implemented: true },
  refund: { implemented: false, alternative: "cancel_order" },
  hold: { implemented: false, alternative: "instant_booking" },
};

export function createDuffelFlightAdapter(): DuffelFlightAdapter {
  function timeouts(config: DuffelConfig): { read: number; book: number } {
    return {
      read: config.timeoutMs ?? 20_000,
      book: config.bookTimeoutMs ?? 90_000,
    };
  }

  async function getOrder(
    ctx: SupplierContext,
    orderId: string,
  ): Promise<DuffelOrder | null> {
    const call = assertCallable(ctx, DUFFEL_ENDPOINT, "lookup");
    const response = await supplierRequest({
      adapter: "duffel",
      operation: "lookup",
      method: "GET",
      url: `${call.baseUrl}/air/orders/${encodeURIComponent(orderId)}`,
      headers: headers(call.token),
      timeoutMs: timeouts(duffelConfig(ctx)).read,
    });
    if (response.status === 404) {
      return null;
    }
    if (response.status !== 200) {
      throw readFailure("lookup", response);
    }
    const parsed = DuffelOrderSchema.safeParse(dataOf(response.body));
    if (!parsed.success) {
      throw unreadable("lookup", "order");
    }
    return parsed.data;
  }

  /** Orders Duffel holds for an offer that carry our reference. */
  async function ordersForOffer(
    ctx: SupplierContext,
    offerId: string,
    ourRef: string,
  ): Promise<DuffelOrder | null> {
    const call = assertCallable(ctx, DUFFEL_ENDPOINT, "lookup");
    const url = new URL(`${call.baseUrl}/air/orders`);
    url.searchParams.set("offer_id", offerId);
    url.searchParams.set("limit", "50");
    const response = await supplierRequest({
      adapter: "duffel",
      operation: "lookup",
      method: "GET",
      url: url.toString(),
      headers: headers(call.token),
      timeoutMs: timeouts(duffelConfig(ctx)).read,
    });
    if (response.status !== 200) {
      throw readFailure("lookup", response);
    }
    const list = dataOf(response.body);
    if (!Array.isArray(list)) {
      throw unreadable("lookup", "order list");
    }
    for (const entry of list) {
      const parsed = DuffelOrderSchema.safeParse(entry);
      if (!parsed.success) {
        continue;
      }
      // One offer can be booked once; our metadata makes the match explicit.
      const ref = metadataRef(parsed.data);
      if (ref === ourRef) {
        return parsed.data;
      }
    }
    return null;
  }

  async function lookup(
    ctx: SupplierContext,
    ourRef: string,
    hint: LookupHint = {},
  ): Promise<LookupResult> {
    // The same readiness gate as every other operation, even when there is
    // nothing to ask: health and behaviour must agree.
    assertCallable(ctx, DUFFEL_ENDPOINT, "lookup");
    const config = duffelConfig(ctx);
    const orderRef = hint.supplierRefs?.orderRef;
    if (typeof orderRef === "string" && orderRef.startsWith("ord_")) {
      const order = await getOrder(ctx, orderRef);
      if (order === null) {
        return NOT_FOUND;
      }
      const ref = metadataRef(order);
      if (ref !== null && ref !== ourRef) {
        // The supplier order is someone else's: never adopt it.
        adapterLogger.error(
          { supplierId: ctx.supplierId, ourRef },
          "Duffel order carries a different UBI reference",
        );
        return NOT_FOUND;
      }
      return mapDuffelOrder(order);
    }
    const offerId =
      hint.supplierOfferRef ??
      snapshotString(hint.offerSnapshot, "supplierOfferId");
    if (offerId === null) {
      return NOT_FOUND;
    }
    const order = await ordersForOffer(ctx, offerId, ourRef);
    if (order !== null) {
      return mapDuffelOrder(order);
    }
    // No order visible. Only once the offer is long expired — beyond the
    // hours Duffel says an ambiguous order may take to appear — is absence
    // definitive.
    const expiresAt = snapshotString(hint.offerSnapshot, "quoteExpiresAt");
    const horizonHours = config.lookupFailAfterHours ?? 24;
    if (
      expiresAt !== null &&
      ctx.now().getTime() > Date.parse(expiresAt) + horizonHours * 3_600_000
    ) {
      return {
        found: false,
        state: "failed",
        supplierRefs: {},
        documentsIssued: false,
      };
    }
    return NOT_FOUND;
  }

  async function refreshOffer(
    ctx: SupplierContext,
    purchaseRef: string,
  ): Promise<OfferValidation> {
    const offerId = offerIdOf(purchaseRef);
    const call = assertCallable(ctx, DUFFEL_ENDPOINT, "refreshOffer");
    const config = duffelConfig(ctx);
    const url = new URL(
      `${call.baseUrl}/air/offers/${encodeURIComponent(offerId)}`,
    );
    url.searchParams.set("return_available_services", "false");
    const response = await supplierRequest({
      adapter: "duffel",
      operation: "refreshOffer",
      method: "GET",
      url: url.toString(),
      headers: headers(call.token),
      timeoutMs: timeouts(config).read,
    });
    const code = supplierErrorCode(response.body);
    if (
      response.status === 404 ||
      (response.status === 422 && code === "offer_no_longer_available")
    ) {
      throw new ContractError(
        "conflict",
        "that flight offer is no longer available; search again",
        {
          adapter: "duffel",
          reason: "offer_no_longer_available",
          providerCalled: true,
        },
      );
    }
    if (response.status !== 200) {
      throw readFailure("refreshOffer", response);
    }
    const parsed = DuffelOfferSchema.safeParse(dataOf(response.body));
    if (!parsed.success) {
      throw unreadable("refreshOffer", "offer");
    }
    if (parsed.data.live_mode === false && isProductionEnv()) {
      // A test-mode offer is not a flight anyone can board: never sold here.
      throw new ContractError(
        "service_unavailable",
        "this flight offer comes from the supplier's test mode and cannot be sold",
        { adapter: "duffel", reason: "test_mode_offer", providerCalled: true },
      );
    }
    assertSettleable(parsed.data, config);
    let offer: AdapterOffer;
    try {
      offer = mapDuffelOffer(parsed.data);
    } catch (error) {
      if (error instanceof SupplierAmountError) {
        throw error;
      }
      throw unreadable("refreshOffer", (error as Error).message);
    }
    const expired = Date.parse(parsed.data.expires_at) <= ctx.now().getTime();
    return {
      available: !expired,
      repriced: false,
      soldOut: false,
      expired,
      offer,
    };
  }

  return {
    adapter: "duffel",
    kind: "flight",

    async search(
      ctx: SupplierContext,
      params: FlightSearchParams,
    ): Promise<SearchResult> {
      validateSearch(params, ctx.now());
      const call = assertCallable(ctx, DUFFEL_ENDPOINT, "search");
      const config = duffelConfig(ctx);
      const url = new URL(`${call.baseUrl}/air/offer_requests`);
      url.searchParams.set("return_offers", "true");
      url.searchParams.set(
        "supplier_timeout",
        String(config.supplierTimeoutMs ?? 10_000),
      );
      const started = Date.now();
      const response = await supplierRequest({
        adapter: "duffel",
        operation: "search",
        method: "POST",
        url: url.toString(),
        headers: headers(call.token),
        body: duffelOfferRequestBody(params, config),
        timeoutMs: Math.max(
          timeouts(config).read,
          (config.supplierTimeoutMs ?? 10_000) + 10_000,
        ),
      });
      if (response.status !== 200 && response.status !== 201) {
        throw readFailure("search", response);
      }
      const data = dataOf(response.body) as { offers?: unknown } | undefined;
      if (data === undefined || !Array.isArray(data.offers)) {
        throw unreadable("search", "offer request");
      }
      const offers: AdapterOffer[] = [];
      let skipped = 0;
      for (const raw of data.offers) {
        const parsed = DuffelOfferSchema.safeParse(raw);
        if (!parsed.success || !settleable(parsed.data, config)) {
          skipped += 1;
          continue;
        }
        try {
          offers.push(mapDuffelOffer(parsed.data));
        } catch {
          skipped += 1;
        }
      }
      if (skipped > 0) {
        adapterLogger.info(
          { supplierId: ctx.supplierId, skipped, kept: offers.length },
          "Duffel offers not sellable here were left out (currency, amount precision or time zone)",
        );
      }
      offers.sort((a, b) => a.price.amountMinor - b.price.amountMinor);
      const kept = offers.slice(0, config.maxOffers ?? 50);
      const expiries = kept
        .map((offer) => snapshotString(offer.snapshot, "quoteExpiresAt"))
        .filter((value): value is string => value !== null)
        .map((value) => Date.parse(value));
      return {
        offers: kept,
        pricesAsOf: ctx.now(),
        // Offers are valid until they expire; display caching never outlives
        // the earliest expiry and never replaces revalidation.
        cacheUntil:
          expiries.length === 0 ? null : new Date(Math.min(...expiries)),
        latencyMs: Date.now() - started,
      };
    },

    refreshOffer,

    async book(
      ctx: SupplierContext,
      request: BookRequest,
    ): Promise<BookResult> {
      // --- Preflight: nothing is sent unless every check passes. ---
      const call = assertCallable(ctx, DUFFEL_ENDPOINT, "book");
      const config = duffelConfig(ctx);
      const snapshot = request.offerSnapshot;
      const offerId = snapshotString(snapshot, "supplierOfferId");
      const expiresAt = snapshotString(snapshot, "quoteExpiresAt");
      const total = snapshot.supplierTotal as
        | { amount?: unknown; currency?: unknown }
        | undefined;
      if (
        offerId === null ||
        expiresAt === null ||
        typeof total?.amount !== "string" ||
        typeof total.currency !== "string" ||
        !Array.isArray(snapshot.passengers)
      ) {
        throw new SupplierPreflightError(
          "validation_failed",
          "offer_snapshot_incomplete",
          "the revalidated Duffel offer is incomplete; no provider call was made",
        );
      }
      if (Date.parse(expiresAt) <= ctx.now().getTime()) {
        throw new SupplierPreflightError(
          "offer_expired",
          "offer_expired",
          "this flight offer has expired and was not booked; search again",
          { expiredAt: expiresAt },
        );
      }
      if (snapshot.documentsRequired === true) {
        throw new SupplierPreflightError(
          "validation_failed",
          "identity_documents_required",
          "this airline needs identity documents at booking, which UBI does not forward; choose an offer that does not require them",
          { alternative: "choose_offer_without_document_requirement" },
        );
      }
      const offerPassengers = (snapshot.passengers as JsonRecord[]).map(
        (passenger) => ({
          id: String(passenger.id),
        }),
      );
      const passengers = duffelPassengers(
        request.passengers,
        offerPassengers,
        snapshotString(snapshot, "lastDepartureDate") ??
          snapshotString(snapshot, "departAt")?.slice(0, 10) ??
          "",
        ctx.now().toISOString().slice(0, 10),
      );

      const body = {
        data: {
          type: "instant",
          selected_offers: [offerId],
          payments: [
            { type: "balance", currency: total.currency, amount: total.amount },
          ],
          passengers,
          metadata: {
            ubi_order_ref: request.ourRef,
            ubi_idempotency_key: request.idempotencyKey,
          },
        },
      };

      let response: SupplierResponse;
      try {
        response = await supplierRequest({
          adapter: "duffel",
          operation: "book",
          method: "POST",
          url: `${call.baseUrl}/air/orders`,
          headers: headers(call.token),
          body,
          timeoutMs: timeouts(config).book,
        });
      } catch (error) {
        if (error instanceof SupplierHttpError && error.ambiguous) {
          return resolveAmbiguous(ctx, request, offerId, snapshot, "timeout");
        }
        throw error;
      }

      if (response.status === 201) {
        const parsed = DuffelOrderSchema.safeParse(dataOf(response.body));
        if (!parsed.success) {
          // Created, but unreadable: look it up rather than guess.
          return resolveAmbiguous(
            ctx,
            request,
            offerId,
            snapshot,
            "unreadable_201",
          );
        }
        const ref = metadataRef(parsed.data);
        if (ref !== null && ref !== request.ourRef) {
          // Not the order we asked for: never adopt it — resolve by lookup.
          return resolveAmbiguous(
            ctx,
            request,
            offerId,
            snapshot,
            "foreign_order",
          );
        }
        const mapped = mapDuffelOrder(parsed.data);
        if (mapped.state === "cancelled" || mapped.state === "failed") {
          // A booking that is already cancelled is not a booking to charge for.
          return {
            outcome: "failed",
            supplierRefs: mapped.supplierRefs,
            documentsIssued: false,
            reason: "supplier_order_cancelled",
          };
        }
        return {
          outcome:
            mapped.state === "pending" ? "supplier_pending" : "confirmed",
          supplierRefs: mapped.supplierRefs,
          documentsIssued: mapped.documentsIssued,
          invoiced: mapped.invoiced ?? null,
        };
      }
      if (response.status === 200 || response.status === 202) {
        // Booked (200) or accepted (202) but not yet readable. Never retry.
        return {
          outcome: "supplier_pending",
          supplierRefs: {},
          documentsIssued: false,
        };
      }
      const code = supplierErrorCode(response.body);
      if (response.status === 503) {
        return {
          outcome: "failed",
          supplierRefs: {},
          documentsIssued: false,
          reason: "supplier_unavailable_no_booking",
        };
      }
      if (response.status === 429) {
        return {
          outcome: "failed",
          supplierRefs: {},
          documentsIssued: false,
          reason: "supplier_rate_limited",
        };
      }
      if (response.status >= 400 && response.status < 500) {
        return {
          outcome: "failed",
          supplierRefs: {},
          documentsIssued: false,
          reason: code ?? `supplier_rejected_${response.status}`,
        };
      }
      // 500 / 502 / 504 / anything else: Duffel says do not retry; the order
      // may exist. Ask by our reference instead.
      return resolveAmbiguous(
        ctx,
        request,
        offerId,
        snapshot,
        `http_${response.status}`,
      );
    },

    lookup,

    async status(
      ctx: SupplierContext,
      ourRef: string,
      hint?: LookupHint,
    ): Promise<StatusResult> {
      const result = await lookup(ctx, ourRef, hint);
      return {
        state: result.state,
        supplierRefs: result.supplierRefs,
        documentsIssued: result.documentsIssued,
      };
    },

    reconcile: lookup,

    async changeOffers(
      ctx: SupplierContext,
      supplierOrderRef: string,
      change,
    ): Promise<readonly DuffelChangeOffer[]> {
      const call = assertCallable(ctx, DUFFEL_ENDPOINT, "changeOffers");
      const config = duffelConfig(ctx);
      const response = await supplierRequest({
        adapter: "duffel",
        operation: "changeOffers",
        method: "POST",
        url: `${call.baseUrl}/air/order_change_requests`,
        headers: headers(call.token),
        body: {
          data: {
            order_id: supplierOrderRef,
            slices: {
              remove: change.removeSliceIds.map((sliceId) => ({
                slice_id: sliceId,
              })),
              add: change.add.map((slice) => ({
                origin: slice.from,
                destination: slice.to,
                departure_date: slice.departDate,
                cabin_class: slice.cabin ?? "economy",
              })),
            },
          },
        },
        timeoutMs: timeouts(config).read,
      });
      if (response.status !== 200 && response.status !== 201) {
        throw readFailure("changeOffers", response);
      }
      const data = dataOf(response.body) as
        | { order_change_offers?: unknown }
        | undefined;
      if (data === undefined || !Array.isArray(data.order_change_offers)) {
        throw unreadable("changeOffers", "order change request");
      }
      const result: DuffelChangeOffer[] = [];
      for (const raw of data.order_change_offers) {
        const parsed = DuffelChangeOfferSchema.safeParse(raw);
        if (!parsed.success) {
          continue;
        }
        const offer = parsed.data;
        result.push({
          id: offer.id,
          changeTotal: money(
            minor(offer.change_total_amount, offer.change_total_currency),
            offer.change_total_currency,
          ),
          newTotal:
            typeof offer.new_total_amount === "string" &&
            typeof offer.new_total_currency === "string"
              ? money(
                  minor(offer.new_total_amount, offer.new_total_currency),
                  offer.new_total_currency,
                )
              : null,
          penalty:
            typeof offer.penalty_total_amount === "string" &&
            typeof offer.penalty_total_currency === "string"
              ? money(
                  minor(
                    offer.penalty_total_amount,
                    offer.penalty_total_currency,
                  ),
                  offer.penalty_total_currency,
                )
              : null,
          expiresAt: offer.expires_at ?? null,
        });
      }
      return result;
    },

    async change(
      ctx: SupplierContext,
      request: ChangeRequest,
    ): Promise<ChangeResult> {
      if (!/^oco_[A-Za-z0-9]+$/.test(request.alternativeRef)) {
        throw new SupplierPreflightError(
          "validation_failed",
          "change_offer_ref_invalid",
          "that is not a Duffel order change offer",
          { alternativeRef: request.alternativeRef },
        );
      }
      const call = assertCallable(ctx, DUFFEL_ENDPOINT, "change");
      const config = duffelConfig(ctx);
      const pending = await supplierRequest({
        adapter: "duffel",
        operation: "change",
        method: "POST",
        url: `${call.baseUrl}/air/order_changes`,
        headers: headers(call.token),
        body: { data: { selected_order_change_offer: request.alternativeRef } },
        timeoutMs: timeouts(config).read,
      });
      if (pending.status !== 200 && pending.status !== 201) {
        return {
          outcome: "failed",
          supplierRefs: {},
          documentsIssued: false,
          reason:
            supplierErrorCode(pending.body) ??
            `supplier_rejected_${pending.status}`,
        };
      }
      const parsed = DuffelOrderChangeSchema.safeParse(dataOf(pending.body));
      if (!parsed.success) {
        throw unreadable("change", "order change");
      }
      const changeOrder = parsed.data;
      const quoted = money(
        minor(
          changeOrder.change_total_amount,
          changeOrder.change_total_currency,
        ),
        changeOrder.change_total_currency,
      );
      const accepted = request.acceptedChangeTotal ?? null;
      if (
        quoted.amountMinor > 0 &&
        (accepted === null ||
          accepted.currency !== quoted.currency ||
          accepted.amountMinor < quoted.amountMinor)
      ) {
        // Never charge a change nobody agreed to: the pending change lapses.
        return {
          outcome: "failed",
          supplierRefs: {},
          documentsIssued: false,
          reason: "change_total_not_accepted",
          quotedTotal: quoted,
        };
      }
      let confirmed: SupplierResponse;
      try {
        confirmed = await supplierRequest({
          adapter: "duffel",
          operation: "change",
          method: "POST",
          url: `${call.baseUrl}/air/order_changes/${encodeURIComponent(changeOrder.id)}/actions/confirm`,
          headers: headers(call.token),
          body:
            quoted.amountMinor > 0
              ? {
                  data: {
                    payment: {
                      type: "balance",
                      currency: changeOrder.change_total_currency,
                      amount: changeOrder.change_total_amount,
                    },
                  },
                }
              : { data: {} },
          timeoutMs: timeouts(config).book,
        });
      } catch (error) {
        if (error instanceof SupplierHttpError && error.ambiguous) {
          return {
            outcome: "unknown",
            supplierRefs: {},
            documentsIssued: false,
            quotedTotal: quoted,
          };
        }
        throw error;
      }
      if (confirmed.status >= 500) {
        return {
          outcome: "unknown",
          supplierRefs: {},
          documentsIssued: false,
          quotedTotal: quoted,
        };
      }
      if (confirmed.status !== 200 && confirmed.status !== 201) {
        return {
          outcome: "failed",
          supplierRefs: {},
          documentsIssued: false,
          reason:
            supplierErrorCode(confirmed.body) ??
            `supplier_rejected_${confirmed.status}`,
          quotedTotal: quoted,
        };
      }
      const order = await getOrder(ctx, changeOrder.order_id);
      if (order === null) {
        return {
          outcome: "unknown",
          supplierRefs: {},
          documentsIssued: false,
          quotedTotal: quoted,
        };
      }
      const mapped = mapDuffelOrder(order);
      return {
        outcome: "changed",
        supplierRefs: mapped.supplierRefs,
        documentsIssued: mapped.documentsIssued,
        quotedTotal: quoted,
      };
    },

    async quoteCancel(
      ctx: SupplierContext,
      request: CancelRequest,
    ): Promise<CancelQuote> {
      const orderId = request.supplierRefs.orderRef;
      if (typeof orderId !== "string" || !orderId.startsWith("ord_")) {
        throw new SupplierPreflightError(
          "conflict",
          "supplier_order_unknown",
          "this order has no Duffel order reference to cancel",
        );
      }
      const call = assertCallable(ctx, DUFFEL_ENDPOINT, "quoteCancel");
      const config = duffelConfig(ctx);
      const order = await getOrder(ctx, orderId);
      if (order === null) {
        throw new ContractError("not_found", "Duffel has no such order", {
          adapter: "duffel",
          providerCalled: true,
        });
      }
      const response = await supplierRequest({
        adapter: "duffel",
        operation: "quoteCancel",
        method: "POST",
        url: `${call.baseUrl}/air/order_cancellations`,
        headers: headers(call.token),
        body: { data: { order_id: orderId } },
        timeoutMs: timeouts(config).read,
      });
      if (response.status !== 200 && response.status !== 201) {
        throw readFailure("quoteCancel", response);
      }
      const parsed = DuffelCancellationSchema.safeParse(dataOf(response.body));
      if (!parsed.success) {
        throw unreadable("quoteCancel", "order cancellation");
      }
      return cancelQuoteOf(order, parsed.data);
    },

    async cancel(
      ctx: SupplierContext,
      request: CancelRequest,
    ): Promise<CancelResult> {
      const quoteRef = request.quoteRef ?? null;
      if (quoteRef === null || !quoteRef.startsWith("ore_")) {
        throw new SupplierPreflightError(
          "conflict",
          "cancellation_quote_required",
          "a Duffel cancellation must be quoted and consented to before it is confirmed",
        );
      }
      const call = assertCallable(ctx, DUFFEL_ENDPOINT, "cancel");
      const config = duffelConfig(ctx);
      const orderId = request.supplierRefs.orderRef;
      const order =
        typeof orderId === "string" ? await getOrder(ctx, orderId) : null;
      if (order === null) {
        throw new ContractError("not_found", "Duffel has no such order", {
          adapter: "duffel",
          providerCalled: true,
        });
      }
      const response = await supplierRequest({
        adapter: "duffel",
        operation: "cancel",
        method: "POST",
        url: `${call.baseUrl}/air/order_cancellations/${encodeURIComponent(quoteRef)}/actions/confirm`,
        headers: headers(call.token),
        timeoutMs: timeouts(config).book,
      });
      if (response.status >= 500) {
        // Like a timeout, a 5xx on confirm may or may not have cancelled the
        // order: never reported as "the supplier refused". The confirmation
        // webhook or a lookup settles it; the traveller is told it is unknown.
        throw new SupplierHttpError(
          "duffel",
          "cancel",
          response.status,
          supplierErrorCode(response.body),
          true,
          "Duffel did not confirm the cancellation (server error); whether it took effect is unknown",
        );
      }
      if (response.status !== 200 && response.status !== 201) {
        const quoteless = money(0, order.total_currency);
        return {
          accepted: false,
          penalty: quoteless,
          refundable: quoteless,
          reason:
            supplierErrorCode(response.body) ??
            `supplier_rejected_${response.status}`,
        };
      }
      const parsed = DuffelCancellationSchema.safeParse(dataOf(response.body));
      if (!parsed.success) {
        throw unreadable("cancel", "order cancellation");
      }
      const quote = cancelQuoteOf(order, parsed.data);
      return {
        accepted: true,
        penalty: quote.penalty,
        refundable: quote.refundable,
      };
    },

    // eslint-disable-next-line require-await -- async by the adapter contract; an unsupported capability refuses at once
    async refund(): Promise<RefundResult> {
      throw new SupplierUnsupportedError(
        "duffel",
        "refund",
        "cancel_order",
        "Duffel has no stand-alone refund: the refundable amount is returned when an order cancellation is confirmed",
      );
    },

    async providerHealth(ctx: SupplierContext): Promise<HttpSupplierHealth> {
      const health = await httpSupplierHealth(
        ctx,
        DUFFEL_ENDPOINT,
        DUFFEL_CAPABILITIES,
        async () => {
          // Lightweight authenticated read: one airline record.
          const config = duffelConfig(ctx);
          const token = resolveSecret(config.secretRef);
          const base = resolveBaseUrl(DUFFEL_ENDPOINT, config.baseUrl);
          if (token === null || !base.permitted) {
            return false;
          }
          const response = await supplierRequest({
            adapter: "duffel",
            operation: "probe",
            method: "GET",
            url: `${base.url}/air/airlines?limit=1`,
            headers: headers(token),
            timeoutMs: 5_000,
          });
          return response.status === 200;
        },
        { configValid: duffelConfigSchema.safeParse(ctx.config).success },
      );
      return health;
    },
  };

  async function resolveAmbiguous(
    ctx: SupplierContext,
    request: BookRequest,
    offerId: string,
    snapshot: JsonRecord,
    cause: string,
  ): Promise<BookResult> {
    adapterLogger.warn(
      { supplierId: ctx.supplierId, ourRef: request.ourRef, cause },
      "Duffel booking outcome ambiguous; looking the order up by our reference (never re-booking)",
    );
    try {
      const found = await lookup(ctx, request.ourRef, {
        supplierOfferRef: offerId,
        offerSnapshot: snapshot,
      });
      if (
        found.found &&
        (found.state === "confirmed" || found.state === "ticketed")
      ) {
        return {
          outcome: "confirmed",
          supplierRefs: found.supplierRefs,
          documentsIssued: found.documentsIssued,
          invoiced: found.invoiced ?? null,
        };
      }
      if (found.found && found.state === "pending") {
        return {
          outcome: "supplier_pending",
          supplierRefs: found.supplierRefs,
          documentsIssued: false,
        };
      }
    } catch (error) {
      adapterLogger.warn(
        { supplierId: ctx.supplierId, ourRef: request.ourRef, err: error },
        "Duffel lookup after an ambiguous booking failed; the order stays unresolved",
      );
    }
    return {
      outcome: "unknown",
      supplierRefs: {},
      documentsIssued: false,
      reason: cause,
    };
  }
}

function settleable(offer: DuffelOffer, config: DuffelConfig): boolean {
  return (
    config.currency === undefined || offer.total_currency === config.currency
  );
}

function assertSettleable(offer: DuffelOffer, config: DuffelConfig): void {
  if (!settleable(offer, config)) {
    throw new ContractError(
      "validation_failed",
      "this offer is priced in a currency this supplier does not settle in here",
      {
        adapter: "duffel",
        reason: "currency_not_settleable",
        offerCurrency: offer.total_currency,
        settlementCurrency: config.currency ?? null,
        providerCalled: true,
      },
    );
  }
}

const CASH_REFUND_DESTINATIONS = new Set([
  "balance",
  "arc_bsp_cash",
  "card",
  "original_form_of_payment",
]);

/**
 * A pending (or confirmed) Duffel cancellation as UBI's quote. A refund that
 * goes to airline credits or a voucher is not cash UBI receives, so it is not
 * refundable money here; the penalty is everything that does not come back.
 */
function cancelQuoteOf(
  order: DuffelOrder,
  cancellation: z.infer<typeof DuffelCancellationSchema>,
): CancelQuote {
  const currency = order.total_currency;
  const total = minor(order.total_amount, currency);
  const refundTo = cancellation.refund_to ?? null;
  let refundableMinor = 0;
  if (
    typeof cancellation.refund_amount === "string" &&
    cancellation.refund_currency === currency &&
    refundTo !== null &&
    CASH_REFUND_DESTINATIONS.has(refundTo)
  ) {
    refundableMinor = Math.min(
      minor(cancellation.refund_amount, currency),
      total,
    );
  }
  return {
    quoteRef: cancellation.id,
    penalty: money(total - refundableMinor, currency),
    refundable: money(refundableMinor, currency),
    expiresAt: cancellation.expires_at ?? null,
    refundTo,
  };
}
