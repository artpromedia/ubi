/**
 * Nuitee / LiteAPI — STAYS ONLY (https://docs.liteapi.travel, API v3.0).
 *
 * LiteAPI also sells flights on some accounts; this adapter never touches
 * them. Flight support is never inferred from the hotel API (CLAUDE.md) —
 * flights are Duffel's (./duffel.ts), behind a separate interface.
 *
 *   search        POST api/v3.0/hotels/rates  (location + maxRatesPerHotel=1)
 *   rates         POST api/v3.0/hotels/rates  (one hotelId, every offer)
 *   refreshOffer  POST book/v3.0/rates/prebook  (the documented rate check:
 *                 availability, final price, `priceDifferencePercent`,
 *                 `cancellationChanged`, `boardChanged`)
 *   book          POST book/v3.0/rates/book with `clientReference` = UBI's
 *                 order id — LiteAPI's documented idempotency key (a second
 *                 booking with the same reference is refused with 4005)
 *   lookup        GET  book/v3.0/bookings?clientReference=… (by OUR reference)
 *   status        GET  book/v3.0/bookings/{bookingId}
 *   quoteCancel   GET  book/v3.0/bookings/{bookingId} → the live penalty from
 *                 its cancellation policies (LiteAPI has no pending-cancel step)
 *   cancel        PUT  book/v3.0/bookings/{bookingId}, only after the live
 *                 penalty still equals the one the traveller accepted
 *   change        unsupported here → cancel under the policy and rebook
 *   refund        unsupported → the refund follows the cancellation policy
 *
 * MONEY. LiteAPI sends amounts as JSON numbers; each becomes exact integer
 * minor units via ./money.ts (the number's shortest decimal form, refused
 * rather than rounded if the currency cannot hold it). `retailRate.total` is
 * the pay-now price; `taxesAndFees` with `included: false` are payable at the
 * property and are itemised apart, never added to the charge.
 *
 * TIME. Check-in/out are calendar dates at the property. Cancellation
 * deadlines are GMT ("Always GMT, even if not listed"), converted to UTC
 * instants.
 *
 * QUOTE EXPIRY. LiteAPI states no expiry for a prebook, so the adapter applies
 * its own server-set quote TTL (`quoteTtlSeconds`, default 10 minutes): a
 * quote older than that is revalidated, never booked.
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
  resolveBaseUrl,
  resolveSecret,
  supplierRequest,
  type CapabilitySpec,
  type HealthExtras,
  type HttpSupplierHealth,
  type SupplierEndpoint,
  type SupplierResponse,
} from "./http-supplier";
import { decimalToMinor, minorToDecimal } from "./money";
import {
  daysBetween,
  earliestCurrentDate,
  isCalendarDate,
  isValidTimeZone,
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
  ChangeResult,
  LookupHint,
  LookupResult,
  OfferValidation,
  RefundResult,
  SearchResult,
  StaySearchParams,
  StaySupplyAdapter,
  StatusResult,
  SupplierContext,
  SupplierRefs,
  SupplyCapabilities,
} from "./types";
import type { JsonRecord, JsonValue } from "../ops/types";

/** LiteAPI sandbox keys are `sand_…` (production keys are `prod_…`). */
const LITEAPI_TEST_KEY_PREFIXES = ["sand_"] as const;

export const LITEAPI_ENDPOINT: SupplierEndpoint = {
  adapter: "nuitee",
  defaultBaseUrl: "https://api.liteapi.travel/v3.0",
  officialHosts: ["api.liteapi.travel", "book.liteapi.travel"],
  testCredentialPrefixes: LITEAPI_TEST_KEY_PREFIXES,
};

export const LITEAPI_BOOK_ENDPOINT: SupplierEndpoint = {
  adapter: "nuitee",
  defaultBaseUrl: "https://book.liteapi.travel/v3.0",
  officialHosts: ["book.liteapi.travel"],
  testCredentialPrefixes: LITEAPI_TEST_KEY_PREFIXES,
};

const liteConfigSchema = httpConfigSchema.extend({
  /** Override of the booking host (prebook / book / bookings). */
  bookBaseUrl: z.string().url().optional(),
  /** `guestNationality` LiteAPI requires on every rates request (ISO 3166-1 alpha-2). */
  guestNationality: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  /** Country for a city-name search (ISO 3166-1 alpha-2). */
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  /**
   * How UBI pays LiteAPI. Never defaulted: a live key must name its method
   * explicitly (`ACC_CREDIT_CARD` simulates payment on a sandbox key).
   */
  paymentMethod: z.enum(["ACC_CREDIT_CARD", "WALLET", "CREDIT"]).optional(),
  quoteTtlSeconds: z.number().int().min(60).max(3_600).optional(),
  maxNights: z.number().int().min(1).max(90).optional(),
  maxAdultsPerRoom: z.number().int().min(1).max(12).optional(),
  /** LiteAPI's own `timeout` for rates (seconds; documented 6–12). */
  searchTimeoutSec: z.number().int().min(2).max(30).optional(),
  lookupFailAfterHours: z.number().int().min(1).max(168).optional(),
});

type LiteConfig = z.infer<typeof liteConfigSchema>;

function liteConfig(ctx: SupplierContext): LiteConfig & { currency: string } {
  const parsed = liteConfigSchema.safeParse(ctx.config);
  if (!parsed.success || parsed.data.currency === undefined) {
    throw new SupplierPreflightError(
      "service_unavailable",
      "config_invalid",
      "the LiteAPI supplier configuration is not valid (it must name its settlement currency); no provider call was made",
      { supplierId: ctx.supplierId },
    );
  }
  return { ...parsed.data, currency: parsed.data.currency };
}

function headers(key: string): Record<string, string> {
  return {
    "X-API-Key": key,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const Amount = z
  .object({ amount: z.number(), currency: z.string() })
  .passthrough();

const TaxFee = z
  .object({
    included: z.boolean(),
    description: z.string().nullable().optional(),
    amount: z.number(),
    currency: z.string(),
  })
  .passthrough();

const CancelPolicy = z
  .object({
    cancelTime: z.string(),
    amount: z.number(),
    currency: z.string(),
    type: z.string().nullable().optional(),
    timezone: z.string().nullable().optional(),
  })
  .passthrough();

const CancellationPolicies = z
  .object({
    cancelPolicyInfos: z.array(CancelPolicy).nullable().optional(),
    refundableTag: z.string().nullable().optional(),
  })
  .passthrough()
  .nullable()
  .optional();

const Rate = z
  .object({
    rateId: z.string(),
    occupancyNumber: z.number().int(),
    name: z.string(),
    maxOccupancy: z.number().int(),
    adultCount: z.number().int(),
    childCount: z.number().int().optional(),
    boardType: z.string().nullable().optional(),
    boardName: z.string().nullable().optional(),
    retailRate: z
      .object({
        total: z.array(Amount).min(1),
        taxesAndFees: z.array(TaxFee).nullable().optional(),
      })
      .passthrough(),
    cancellationPolicies: CancellationPolicies,
  })
  .passthrough();

const RoomType = z
  .object({
    offerId: z.string(),
    rates: z.array(Rate).min(1),
    offerRetailRate: Amount.optional(),
  })
  .passthrough();

const HotelRates = z
  .object({ hotelId: z.string(), roomTypes: z.array(RoomType) })
  .passthrough();

const HotelInfo = z
  .object({
    id: z.string(),
    name: z.string().nullable().optional(),
    main_photo: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    rating: z.number().nullable().optional(),
  })
  .passthrough();

export const LiteRatesResponseSchema = z
  .object({
    data: z.array(HotelRates).optional(),
    hotels: z.array(HotelInfo).optional(),
    error: z.object({ code: z.number() }).passthrough().optional(),
  })
  .passthrough();

export const LitePrebookSchema = z
  .object({
    prebookId: z.string(),
    offerId: z.string(),
    hotelId: z.string(),
    checkin: z.string().optional(),
    checkout: z.string().optional(),
    currency: z.string(),
    roomTypes: z
      .array(z.object({ rates: z.array(Rate).min(1) }).passthrough())
      .min(1),
    price: z.number().optional(),
    priceDifferencePercent: z.number().nullable().optional(),
    cancellationChanged: z.boolean().nullable().optional(),
    boardChanged: z.boolean().nullable().optional(),
  })
  .passthrough();

export const LiteBookingSchema = z
  .object({
    bookingId: z.string(),
    clientReference: z.string().nullable().optional(),
    status: z.string(),
    hotelConfirmationCode: z.string().nullable().optional(),
    price: z.number().nullable().optional(),
    currency: z.string().nullable().optional(),
    checkin: z.string().nullable().optional(),
    cancellationPolicies: CancellationPolicies,
  })
  .passthrough();

type LiteBooking = z.infer<typeof LiteBookingSchema>;

const LiteCancelSchema = z
  .object({
    bookingId: z.string(),
    status: z.string(),
    cancellation_fee: z.number().nullable().optional(),
    refund_amount: z.number().nullable().optional(),
    currency: z.string(),
  })
  .passthrough();

function errorCode(body: unknown): number | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const error = (body as { error?: { code?: unknown } }).error;
  return typeof error?.code === "number" ? error.code : null;
}

function dataOf(body: unknown): unknown {
  return typeof body === "object" && body !== null
    ? (body as { data?: unknown }).data
    : undefined;
}

function unreadable(operation: string, detail: string): ContractError {
  return new ContractError(
    "service_unavailable",
    `LiteAPI returned a ${operation} response this service cannot read`,
    { adapter: "nuitee", operation, detail, providerCalled: true },
  );
}

function readFailure(
  operation: string,
  response: SupplierResponse,
): ContractError {
  const code = errorCode(response.body);
  const details = {
    adapter: "nuitee",
    operation,
    status: response.status,
    supplierCode: code === null ? null : String(code),
    providerCalled: true,
  };
  if (response.status === 429 || code === 4290) {
    return new ContractError(
      "rate_limited",
      "LiteAPI is rate limiting this service; try again shortly",
      details,
    );
  }
  if (
    response.status === 400 &&
    (code === 4000 || code === 4002 || code === 4003)
  ) {
    return new ContractError(
      "validation_failed",
      "LiteAPI refused the request as invalid",
      details,
    );
  }
  if (response.status === 404 || response.status === 204 || code === 4004) {
    return new ContractError(
      "not_found",
      "LiteAPI has no such resource",
      details,
    );
  }
  return new ContractError(
    "service_unavailable",
    `LiteAPI could not complete ${operation}`,
    details,
  );
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function toMinor(amount: number, currency: string): number {
  return decimalToMinor(amount, currency);
}

/** A cancellation deadline as a UTC instant (GMT unless a real zone is named). */
export function policyInstant(
  cancelTime: string,
  timezone: string | null | undefined,
): string | null {
  const text = cancelTime.trim();
  const local = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? `${text}T00:00:00`
    : text.replace(" ", "T");
  const zone =
    timezone === null ||
    timezone === undefined ||
    timezone === "" ||
    /^(GMT|UTC)$/i.test(timezone)
      ? "UTC"
      : timezone;
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(local)) {
    const parsed = Date.parse(local);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  if (!isValidTimeZone(zone)) {
    return null;
  }
  return zonedLocalToUtc(local, zone)?.utc ?? null;
}

export interface PenaltyStep {
  readonly fromUtc: string;
  readonly penalty: Money;
}

export interface ParsedCancellation {
  readonly refundable: boolean;
  readonly steps: readonly PenaltyStep[];
  /** Last instant a cancellation costs nothing; null when never free. */
  readonly freeUntil: string | null;
}

export function parseCancellation(
  policies: z.infer<typeof CancellationPolicies>,
  currency: string,
): ParsedCancellation {
  const refundable = policies?.refundableTag === "RFN";
  const steps: PenaltyStep[] = [];
  for (const info of policies?.cancelPolicyInfos ?? []) {
    // A 0-amount policy is a placeholder (LiteAPI "Canceling a Booking").
    if (info.amount <= 0 || info.currency !== currency) {
      continue;
    }
    const fromUtc = policyInstant(info.cancelTime, info.timezone);
    if (fromUtc === null) {
      continue;
    }
    steps.push({
      fromUtc,
      penalty: money(toMinor(info.amount, currency), currency),
    });
  }
  steps.sort((a, b) => Date.parse(a.fromUtc) - Date.parse(b.fromUtc));
  const first = steps[0];
  return {
    refundable,
    steps,
    freeUntil: first?.fromUtc ?? null,
  };
}

/**
 * The penalty a cancellation costs at `now`: the most recently passed policy
 * step; nothing before the first step on a refundable rate; the whole price on
 * a non-refundable rate with no stated steps.
 */
export function penaltyAt(
  parsed: ParsedCancellation,
  price: Money,
  now: Date,
): Money {
  let penalty: Money | null = null;
  for (const step of parsed.steps) {
    if (Date.parse(step.fromUtc) <= now.getTime()) {
      penalty = step.penalty;
    }
  }
  if (penalty === null) {
    penalty =
      parsed.refundable || parsed.steps.length > 0
        ? money(0, price.currency)
        : price;
  }
  return money(
    Math.min(penalty.amountMinor, price.amountMinor),
    price.currency,
  );
}

function cancellationText(
  parsed: ParsedCancellation,
  currency: string,
): string {
  const first = parsed.steps[0];
  if (first === undefined) {
    return parsed.refundable ? "free cancellation" : "non-refundable";
  }
  return `free cancellation until ${first.fromUtc} (UTC); after that ${currency} ${minorToDecimal(first.penalty.amountMinor, currency)} is charged`;
}

interface RateOfferInput {
  readonly offerId: string;
  readonly hotelId: string;
  readonly rates: readonly z.infer<typeof Rate>[];
  readonly checkIn: string | null;
  readonly checkOut: string | null;
  readonly currency: string;
}

/** One LiteAPI offer (one room here) as UBI's stay offer, or null when unsellable. */
export function mapLiteOffer(input: RateOfferInput): AdapterOffer {
  const rate = input.rates[0];
  if (rate === undefined) {
    throw new Error("offer has no rates");
  }
  let payNowMinor = 0;
  let payAtPropertyMinor = 0;
  const taxes: JsonRecord[] = [];
  for (const each of input.rates) {
    const total = each.retailRate.total[0];
    if (total === undefined || total.currency !== input.currency) {
      throw new Error("rate total is not in the settlement currency");
    }
    payNowMinor += toMinor(total.amount, input.currency);
    for (const fee of each.retailRate.taxesAndFees ?? []) {
      if (fee.currency !== input.currency) {
        // A fee in another currency is shown, never converted or summed.
        taxes.push({
          description: fee.description ?? null,
          included: fee.included,
          amountMinor: null,
          currency: fee.currency,
        });
        continue;
      }
      const amountMinor = toMinor(fee.amount, input.currency);
      if (!fee.included) {
        payAtPropertyMinor += amountMinor;
      }
      taxes.push({
        description: fee.description ?? null,
        included: fee.included,
        amountMinor,
        currency: fee.currency,
      });
    }
  }
  const price = money(payNowMinor, input.currency);
  const cancellation = parseCancellation(
    rate.cancellationPolicies,
    input.currency,
  );
  const capabilities: SupplyCapabilities = {
    holdSupported: false,
    holdExpiresAt: null,
    priceGuaranteeUntil: null,
    merchantOfRecord: "ubi",
    changeSupported: false,
    refundSupported: cancellation.refundable,
    currency: input.currency,
    payAtProperty: payAtPropertyMinor > 0,
    currencies: [input.currency],
    coverage: null,
  };
  const firstStep = cancellation.steps[0];
  let penaltyAfter = cancellation.refundable
    ? "no penalty stated"
    : "the full price is charged";
  if (firstStep !== undefined) {
    penaltyAfter = `${input.currency} ${minorToDecimal(firstStep.penalty.amountMinor, input.currency)} charged`;
  }
  const snapshot: JsonRecord = {
    id: input.offerId,
    supplierOfferId: input.offerId,
    propertyId: input.hotelId,
    roomName: rate.name,
    board: rate.boardName ?? null,
    boardType: rate.boardType ?? null,
    occupancy: {
      adults: rate.adultCount,
      children: rate.childCount ?? 0,
      maxAdults: rate.maxOccupancy,
      bookable: true,
    },
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    payNow: { amountMinor: price.amountMinor, currency: price.currency },
    payAtProperty:
      payAtPropertyMinor > 0
        ? { amountMinor: payAtPropertyMinor, currency: input.currency }
        : null,
    supplierPrice: { amountMinor: price.amountMinor, currency: price.currency },
    fx: null,
    taxesAndFees: taxes,
    taxesNote:
      payAtPropertyMinor > 0
        ? "some taxes/fees are payable at the property and are not in the pay-now price"
        : null,
    cancellation: {
      refundableTag: rate.cancellationPolicies?.refundableTag ?? null,
      freeUntil: cancellation.freeUntil,
      penaltyAfter,
      steps: cancellation.steps.map((step) => ({
        fromUtc: step.fromUtc,
        penalty: {
          amountMinor: step.penalty.amountMinor,
          currency: step.penalty.currency,
        },
      })) as JsonValue,
    },
    capabilities: {
      holdSupported: false,
      holdExpiresAt: null,
      priceGuaranteeUntil: null,
      merchantOfRecord: "ubi",
      changeSupported: false,
      refundSupported: cancellation.refundable,
      currency: input.currency,
      payAtProperty: payAtPropertyMinor > 0,
      currencies: [input.currency],
      coverage: null,
    },
    protectionRuleId: null,
  };
  return {
    offerRef: input.offerId,
    supplierOfferRef: input.offerId,
    kind: "stay",
    snapshot,
    price,
    supplierPrice: price,
    fx: null,
    payAtProperty:
      payAtPropertyMinor > 0 ? money(payAtPropertyMinor, input.currency) : null,
    capabilities,
    soldOut: false,
    policy: {
      cancellation: cancellationText(cancellation, input.currency),
      freeUntil: cancellation.freeUntil,
      refundableTag: rate.cancellationPolicies?.refundableTag ?? null,
    },
  };
}

export function liteRatesBody(
  params: StaySearchParams,
  config: LiteConfig & { currency: string },
  target: {
    readonly hotelIds?: readonly string[];
    readonly maxRatesPerHotel?: number;
  },
): JsonRecord {
  const body: JsonRecord = {
    occupancies: [{ adults: params.guests }],
    currency: config.currency,
    guestNationality: config.guestNationality ?? "",
    checkin: params.checkIn,
    checkout: params.checkOut,
    timeout: config.searchTimeoutSec ?? 8,
  };
  if (target.hotelIds !== undefined) {
    body.hotelIds = [...target.hotelIds];
  } else if (/^[A-Z]{3}$/.test(params.city)) {
    body.iataCode = params.city;
  } else {
    body.cityName = params.city;
    body.countryCode = config.countryCode ?? "";
  }
  if (target.maxRatesPerHotel !== undefined) {
    body.maxRatesPerHotel = target.maxRatesPerHotel;
  }
  return body;
}

function validateStay(
  params: StaySearchParams,
  config: LiteConfig,
  now: Date,
): void {
  const problems: string[] = [];
  if (!isCalendarDate(params.checkIn)) {
    problems.push("checkIn");
  }
  if (!isCalendarDate(params.checkOut)) {
    problems.push("checkOut");
  }
  const maxAdults = config.maxAdultsPerRoom ?? 8;
  if (
    !Number.isInteger(params.guests) ||
    params.guests < 1 ||
    params.guests > maxAdults
  ) {
    problems.push("guests");
  }
  if (params.city.trim() === "") {
    problems.push("city");
  }
  if (problems.length === 0) {
    const nights = daysBetween(params.checkIn, params.checkOut);
    if (params.checkIn < earliestCurrentDate(now)) {
      problems.push("checkIn");
    }
    if (nights < 1 || nights > (config.maxNights ?? 30)) {
      problems.push("checkOut");
    }
  }
  if (config.guestNationality === undefined) {
    problems.push("guestNationality(config)");
  }
  if (!/^[A-Z]{3}$/.test(params.city) && config.countryCode === undefined) {
    problems.push("countryCode(config)");
  }
  if (problems.length > 0) {
    throw new SupplierPreflightError(
      "validation_failed",
      "search_invalid",
      "the stay search is not valid for LiteAPI",
      { fields: [...new Set(problems)] },
    );
  }
}

function refsOfBooking(booking: LiteBooking): SupplierRefs {
  return {
    bookingRef: booking.bookingId,
    ...(typeof booking.hotelConfirmationCode === "string" &&
    booking.hotelConfirmationCode !== ""
      ? { orderRef: booking.hotelConfirmationCode }
      : {}),
  };
}

export function mapLiteBooking(booking: LiteBooking): LookupResult {
  const refs = refsOfBooking(booking);
  let invoiced: Money | null = null;
  if (
    typeof booking.price === "number" &&
    typeof booking.currency === "string"
  ) {
    try {
      invoiced = money(
        toMinor(booking.price, booking.currency),
        booking.currency,
      );
    } catch {
      invoiced = null;
    }
  }
  const status = booking.status.toUpperCase();
  if (status === "CONFIRMED") {
    // For a stay the confirmation IS the document.
    return {
      found: true,
      state: "confirmed",
      supplierRefs: refs,
      documentsIssued: true,
      invoiced,
    };
  }
  if (status.startsWith("CANCEL")) {
    return {
      found: true,
      state: "cancelled",
      supplierRefs: refs,
      documentsIssued: false,
      invoiced,
    };
  }
  if (status === "FAILED") {
    return {
      found: true,
      state: "failed",
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

const NOT_FOUND: LookupResult = {
  found: false,
  state: "unknown",
  supplierRefs: {},
  documentsIssued: false,
};

/** Book errors that prove no booking was made (LiteAPI "API Errors for booking workflow"). */
const DEFINITIVE_BOOK_CODES = new Set([
  401, 2001, 4000, 4002, 4003, 4006, 4007, 4012, 4290, 40010, 40011, 40012,
  40013, 40014, 40021, 40302,
]);

const NAME = /^[\p{L}][\p{L} .'-]{0,49}$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 ()-]{6,20}$/;

function leadGuest(passengers: readonly JsonRecord[]): {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
} {
  const lead = passengers[0];
  const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  const problem = (fieldName: string): never => {
    throw new SupplierPreflightError(
      "validation_failed",
      "guest_invalid",
      `the lead guest's ${fieldName} does not meet the hotel supplier's requirements`,
      { passengerIndex: 0, field: fieldName },
    );
  };
  if (lead === undefined) {
    return problem("presence");
  }
  const firstName = text(lead.givenNames);
  if (firstName === null || !NAME.test(firstName)) {
    problem("givenNames");
  }
  const lastName = text(lead.surname);
  if (lastName === null || !NAME.test(lastName)) {
    problem("surname");
  }
  const email = text(lead.email);
  if (email === null || !EMAIL.test(email)) {
    problem("email");
  }
  const phone = text(lead.phone);
  if (phone === null || !PHONE.test(phone)) {
    problem("phone");
  }
  return {
    firstName: firstName as string,
    lastName: lastName as string,
    email: email as string,
    phone: phone as string,
  };
}

function snapshotString(
  snapshot: JsonRecord | null | undefined,
  key: string,
): string | null {
  const value = snapshot?.[key];
  return typeof value === "string" ? value : null;
}

/** What each capability needs beyond credentials, mirrored into health. */
function liteHealthExtras(ctx: SupplierContext): HealthExtras {
  const parsed = liteConfigSchema.safeParse(ctx.config);
  if (!parsed.success || parsed.data.currency === undefined) {
    return { configValid: false };
  }
  const blockers: Record<string, string> = {};
  if (parsed.data.guestNationality === undefined) {
    blockers.search = "guest_nationality_not_configured";
    blockers.rates = "guest_nationality_not_configured";
  }
  if (parsed.data.paymentMethod === undefined) {
    blockers.book = "payment_method_not_configured";
  }
  return { configValid: true, capabilityBlockers: blockers };
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export const LITEAPI_CAPABILITIES: Readonly<Record<string, CapabilitySpec>> = {
  search: { implemented: true },
  rates: { implemented: true },
  refreshOffer: { implemented: true },
  book: { implemented: true },
  lookup: { implemented: true },
  status: { implemented: true },
  reconcile: { implemented: true },
  quoteCancel: { implemented: true },
  cancel: { implemented: true },
  change: { implemented: false, alternative: "cancel_and_rebook" },
  refund: { implemented: false, alternative: "cancel_order" },
  hold: { implemented: false, alternative: "instant_booking" },
};

export function createNuiteeStayAdapter(): StaySupplyAdapter {
  function readTimeout(config: LiteConfig): number {
    return (
      config.timeoutMs ??
      Math.max(15_000, ((config.searchTimeoutSec ?? 8) + 7) * 1_000)
    );
  }

  async function rateSearch(
    ctx: SupplierContext,
    params: StaySearchParams,
    target: {
      readonly hotelIds?: readonly string[];
      readonly maxRatesPerHotel?: number;
    },
    operation: "search" | "rates",
  ): Promise<{
    response: z.infer<typeof LiteRatesResponseSchema>;
    latencyMs: number;
  }> {
    const config = liteConfig(ctx);
    validateStay(params, config, ctx.now());
    const call = assertCallable(ctx, LITEAPI_ENDPOINT, operation);
    const started = Date.now();
    const response = await supplierRequest({
      adapter: "nuitee",
      operation,
      method: "POST",
      url: `${call.baseUrl}/hotels/rates`,
      headers: headers(call.token),
      body: liteRatesBody(params, config, target),
      timeoutMs: readTimeout(config),
    });
    const latencyMs = Date.now() - started;
    // "No availability" is HTTP 200 with code 2001, or a 204 (documented).
    if (response.status === 204 || errorCode(response.body) === 2001) {
      return { response: { data: [], hotels: [] }, latencyMs };
    }
    if (response.status !== 200) {
      throw readFailure(operation, response);
    }
    const parsed = LiteRatesResponseSchema.safeParse(response.body);
    if (!parsed.success) {
      throw unreadable(operation, "rates");
    }
    return { response: parsed.data, latencyMs };
  }

  /** Offers for the requested occupancy only — a room that cannot sleep the party is never offered. */
  function offersFor(
    hotel: z.infer<typeof HotelRates>,
    params: StaySearchParams,
    currency: string,
  ): AdapterOffer[] {
    const offers: AdapterOffer[] = [];
    for (const roomType of hotel.roomTypes) {
      const rate = roomType.rates[0];
      if (
        rate === undefined ||
        roomType.rates.length !== 1 ||
        rate.adultCount !== params.guests ||
        rate.maxOccupancy < params.guests
      ) {
        continue;
      }
      try {
        offers.push(
          mapLiteOffer({
            offerId: roomType.offerId,
            hotelId: hotel.hotelId,
            rates: roomType.rates,
            checkIn: params.checkIn,
            checkOut: params.checkOut,
            currency,
          }),
        );
      } catch {
        // Unsellable exactly (currency / precision): left out, never rounded.
      }
    }
    return offers.sort((a, b) => a.price.amountMinor - b.price.amountMinor);
  }

  async function bookingsByReference(
    ctx: SupplierContext,
    ourRef: string,
  ): Promise<LiteBooking | null> {
    const config = liteConfig(ctx);
    const call = assertCallable(
      ctx,
      LITEAPI_BOOK_ENDPOINT,
      "lookup",
      config.bookBaseUrl,
    );
    const url = new URL(`${call.baseUrl}/bookings`);
    url.searchParams.set("clientReference", ourRef);
    const response = await supplierRequest({
      adapter: "nuitee",
      operation: "lookup",
      method: "GET",
      url: url.toString(),
      headers: headers(call.token),
      timeoutMs: readTimeout(config),
    });
    if (response.status === 204) {
      return null;
    }
    if (response.status !== 200) {
      throw readFailure("lookup", response);
    }
    const list = dataOf(response.body);
    if (!Array.isArray(list)) {
      throw unreadable("lookup", "booking list");
    }
    for (const entry of list) {
      const parsed = LiteBookingSchema.safeParse(entry);
      if (parsed.success && parsed.data.clientReference === ourRef) {
        return parsed.data;
      }
    }
    return null;
  }

  async function bookingById(
    ctx: SupplierContext,
    bookingId: string,
    operation: string,
  ): Promise<LiteBooking | null> {
    const config = liteConfig(ctx);
    const call = assertCallable(
      ctx,
      LITEAPI_BOOK_ENDPOINT,
      operation,
      config.bookBaseUrl,
    );
    const response = await supplierRequest({
      adapter: "nuitee",
      operation,
      method: "GET",
      url: `${call.baseUrl}/bookings/${encodeURIComponent(bookingId)}`,
      headers: headers(call.token),
      timeoutMs: readTimeout(config),
    });
    if (response.status === 204 || response.status === 404) {
      return null;
    }
    if (response.status !== 200) {
      throw readFailure(operation, response);
    }
    const parsed = LiteBookingSchema.safeParse(dataOf(response.body));
    if (!parsed.success) {
      throw unreadable(operation, "booking");
    }
    return parsed.data;
  }

  async function lookup(
    ctx: SupplierContext,
    ourRef: string,
    hint: LookupHint = {},
  ): Promise<LookupResult> {
    const config = liteConfig(ctx);
    const booking = await bookingsByReference(ctx, ourRef);
    if (booking !== null) {
      return mapLiteBooking(booking);
    }
    // Absence becomes definitive only well after the quote could have been
    // booked at all.
    const expiresAt = snapshotString(hint.offerSnapshot, "quoteExpiresAt");
    const horizonHours = config.lookupFailAfterHours ?? 2;
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

  async function liveQuote(
    ctx: SupplierContext,
    request: CancelRequest,
  ): Promise<{ quote: CancelQuote; booking: LiteBooking }> {
    const bookingId = request.supplierRefs.bookingRef;
    if (typeof bookingId !== "string" || bookingId === "") {
      throw new SupplierPreflightError(
        "conflict",
        "supplier_booking_unknown",
        "this order has no LiteAPI booking reference to cancel",
      );
    }
    const booking = await bookingById(ctx, bookingId, "quoteCancel");
    if (
      booking === null ||
      typeof booking.price !== "number" ||
      typeof booking.currency !== "string"
    ) {
      throw new ContractError("not_found", "LiteAPI has no such booking", {
        adapter: "nuitee",
        providerCalled: true,
      });
    }
    const price = money(
      toMinor(booking.price, booking.currency),
      booking.currency,
    );
    const parsed = parseCancellation(
      booking.cancellationPolicies,
      booking.currency,
    );
    const now = ctx.now();
    const penalty = penaltyAt(parsed, price, now);
    const next = parsed.steps.find(
      (step) => Date.parse(step.fromUtc) > now.getTime(),
    );
    return {
      booking,
      quote: {
        quoteRef: null,
        penalty,
        refundable: money(
          price.amountMinor - penalty.amountMinor,
          price.currency,
        ),
        // The quote holds until the next penalty step begins.
        expiresAt: next?.fromUtc ?? null,
        refundTo: null,
      },
    };
  }

  return {
    adapter: "nuitee",
    kind: "stay",

    async search(
      ctx: SupplierContext,
      params: StaySearchParams,
    ): Promise<SearchResult> {
      const config = liteConfig(ctx);
      const { response, latencyMs } = await rateSearch(
        ctx,
        params,
        { maxRatesPerHotel: 1 },
        "search",
      );
      const info = new Map(
        (response.hotels ?? []).map((hotel) => [hotel.id, hotel]),
      );
      const offers: AdapterOffer[] = [];
      for (const hotel of response.data ?? []) {
        const cheapest = offersFor(hotel, params, config.currency)[0];
        if (cheapest === undefined) {
          continue;
        }
        const meta = info.get(hotel.hotelId);
        offers.push({
          offerRef: hotel.hotelId,
          kind: "stay",
          snapshot: {
            id: hotel.hotelId,
            name: meta?.name ?? null,
            area: meta?.address ?? null,
            distanceKm: null,
            distanceTo: null,
            rating: meta?.rating ?? null,
            fromPrice: {
              amountMinor: cheapest.price.amountMinor,
              currency: cheapest.price.currency,
            },
            photos:
              typeof meta?.main_photo === "string" ? [meta.main_photo] : [],
          },
          price: cheapest.price,
          capabilities: {
            holdSupported: false,
            merchantOfRecord: "ubi",
            changeSupported: false,
            refundSupported: cheapest.capabilities.refundSupported,
            currency: config.currency,
          },
          policy: {},
        });
      }
      return {
        offers: offers.sort(
          (a, b) => a.price.amountMinor - b.price.amountMinor,
        ),
        pricesAsOf: ctx.now(),
        // LiteAPI's terms state no display cache window; revalidation (prebook) is always required.
        cacheUntil: null,
        latencyMs,
      };
    },

    async rates(
      ctx: SupplierContext,
      propertyId: string,
      params: StaySearchParams,
    ): Promise<readonly AdapterOffer[]> {
      const config = liteConfig(ctx);
      const { response } = await rateSearch(
        ctx,
        params,
        { hotelIds: [propertyId] },
        "rates",
      );
      const hotel = (response.data ?? []).find(
        (entry) => entry.hotelId === propertyId,
      );
      return hotel === undefined
        ? []
        : offersFor(hotel, params, config.currency);
    },

    async refreshOffer(
      ctx: SupplierContext,
      offerId: string,
    ): Promise<OfferValidation> {
      const config = liteConfig(ctx);
      const call = assertCallable(
        ctx,
        LITEAPI_BOOK_ENDPOINT,
        "refreshOffer",
        config.bookBaseUrl,
      );
      const response = await supplierRequest({
        adapter: "nuitee",
        operation: "refreshOffer",
        method: "POST",
        url: `${call.baseUrl}/rates/prebook`,
        headers: headers(call.token),
        body: { offerId, usePaymentSdk: false },
        timeoutMs: readTimeout(config),
      });
      const code = errorCode(response.body);
      if (code === 2001) {
        throw new ContractError(
          "conflict",
          "that room is no longer available; search again",
          {
            adapter: "nuitee",
            reason: "no_availability",
            providerCalled: true,
          },
        );
      }
      if (code === 4040) {
        throw new ContractError(
          "offer_expired",
          "that room offer is outdated; search again",
          {
            adapter: "nuitee",
            reason: "outdated_offer",
            providerCalled: true,
          },
        );
      }
      if (response.status !== 200) {
        throw readFailure("refreshOffer", response);
      }
      const parsed = LitePrebookSchema.safeParse(dataOf(response.body));
      if (!parsed.success) {
        throw unreadable("refreshOffer", "prebook");
      }
      const prebook = parsed.data;
      if (prebook.currency !== config.currency) {
        throw new ContractError(
          "validation_failed",
          "this room is priced in a currency this supplier does not settle in here",
          {
            adapter: "nuitee",
            reason: "currency_not_settleable",
            providerCalled: true,
          },
        );
      }
      const rates = prebook.roomTypes.flatMap((roomType) => roomType.rates);
      let offer: AdapterOffer;
      try {
        offer = mapLiteOffer({
          offerId: prebook.offerId,
          hotelId: prebook.hotelId,
          rates,
          checkIn: prebook.checkin ?? null,
          checkOut: prebook.checkout ?? null,
          currency: prebook.currency,
        });
      } catch (error) {
        throw unreadable("refreshOffer", (error as Error).message);
      }
      // The prebook's own total must be the sum of its room totals — a price
      // UBI cannot explain is not a price UBI charges.
      if (
        typeof prebook.price === "number" &&
        toMinor(prebook.price, prebook.currency) !== offer.price.amountMinor
      ) {
        throw unreadable(
          "refreshOffer",
          "prebook total does not match its rates",
        );
      }
      const now = ctx.now();
      const ttl = config.quoteTtlSeconds ?? 600;
      const quoted: AdapterOffer = {
        ...offer,
        snapshot: {
          ...offer.snapshot,
          prebookId: prebook.prebookId,
          quotedAt: now.toISOString(),
          quoteExpiresAt: new Date(now.getTime() + ttl * 1_000).toISOString(),
        },
      };
      const repriced = (prebook.priceDifferencePercent ?? 0) !== 0;
      const termsChanged =
        prebook.cancellationChanged === true || prebook.boardChanged === true;
      return {
        available: true,
        repriced,
        soldOut: false,
        expired: false,
        termsChanged,
        offer: quoted,
      };
    },

    async book(
      ctx: SupplierContext,
      request: BookRequest,
    ): Promise<BookResult> {
      // --- Preflight ---
      const config = liteConfig(ctx);
      const call = assertCallable(
        ctx,
        LITEAPI_BOOK_ENDPOINT,
        "book",
        config.bookBaseUrl,
      );
      const snapshot = request.offerSnapshot;
      const prebookId = snapshotString(snapshot, "prebookId");
      const expiresAt = snapshotString(snapshot, "quoteExpiresAt");
      if (prebookId === null || expiresAt === null) {
        throw new SupplierPreflightError(
          "validation_failed",
          "offer_snapshot_incomplete",
          "the revalidated room quote is incomplete; no provider call was made",
        );
      }
      if (Date.parse(expiresAt) <= ctx.now().getTime()) {
        throw new SupplierPreflightError(
          "offer_expired",
          "offer_expired",
          "this room quote has expired and was not booked; check the price again",
          { expiredAt: expiresAt },
        );
      }
      if (config.paymentMethod === undefined) {
        throw new SupplierPreflightError(
          "service_unavailable",
          "payment_method_not_configured",
          "the LiteAPI supplier row names no payment method; no provider call was made",
        );
      }
      const guest = leadGuest(request.passengers);

      const body = {
        prebookId,
        clientReference: request.ourRef,
        holder: guest,
        guests: [{ occupancyNumber: 1, ...guest }],
        payment: { method: config.paymentMethod },
      };
      let response: SupplierResponse;
      try {
        response = await supplierRequest({
          adapter: "nuitee",
          operation: "book",
          method: "POST",
          url: `${call.baseUrl}/rates/book`,
          headers: headers(call.token),
          body,
          timeoutMs: config.bookTimeoutMs ?? 90_000,
        });
      } catch (error) {
        if (error instanceof SupplierHttpError && error.ambiguous) {
          return resolveAmbiguous(ctx, request, "timeout");
        }
        throw error;
      }

      if (response.status === 200) {
        const parsed = LiteBookingSchema.safeParse(dataOf(response.body));
        if (!parsed.success) {
          return resolveAmbiguous(ctx, request, "unreadable_200");
        }
        if (
          typeof parsed.data.clientReference === "string" &&
          parsed.data.clientReference !== request.ourRef
        ) {
          // Not the booking we asked for: never adopt it — resolve by lookup.
          return resolveAmbiguous(ctx, request, "foreign_booking");
        }
        const mapped = mapLiteBooking(parsed.data);
        if (mapped.state === "confirmed") {
          return {
            outcome: "confirmed",
            supplierRefs: mapped.supplierRefs,
            documentsIssued: true,
            invoiced: mapped.invoiced ?? null,
          };
        }
        if (mapped.state === "failed" || mapped.state === "cancelled") {
          return {
            outcome: "failed",
            supplierRefs: mapped.supplierRefs,
            documentsIssued: false,
            reason: "booking_not_confirmed",
          };
        }
        return {
          outcome: "supplier_pending",
          supplierRefs: mapped.supplierRefs,
          documentsIssued: false,
        };
      }
      const code = errorCode(response.body);
      if (code === 4005) {
        // A booking already exists under our reference: it is the earlier
        // attempt's. Read it, never book again.
        return resolveAmbiguous(ctx, request, "duplicate_client_reference");
      }
      if (
        (code !== null && DEFINITIVE_BOOK_CODES.has(code)) ||
        response.status === 401 ||
        response.status === 403 ||
        response.status === 429
      ) {
        return {
          outcome: "failed",
          supplierRefs: {},
          documentsIssued: false,
          reason:
            code === null
              ? `supplier_rejected_${response.status}`
              : `liteapi_${code}`,
        };
      }
      // 2013 / 2014 / 5000 / other 5xx: the booking may or may not exist.
      return resolveAmbiguous(
        ctx,
        request,
        code === null ? `http_${response.status}` : `liteapi_${code}`,
      );
    },

    lookup,

    async status(
      ctx: SupplierContext,
      ourRef: string,
      hint?: LookupHint,
    ): Promise<StatusResult> {
      const bookingId = hint?.supplierRefs?.bookingRef;
      const result =
        typeof bookingId === "string" && bookingId !== ""
          ? await bookingById(ctx, bookingId, "status").then((booking) =>
              booking === null ? NOT_FOUND : mapLiteBooking(booking),
            )
          : await lookup(ctx, ourRef, hint);
      return {
        state: result.state,
        supplierRefs: result.supplierRefs,
        documentsIssued: result.documentsIssued,
      };
    },

    reconcile: lookup,

    // eslint-disable-next-line require-await -- async by the adapter contract; an unsupported capability refuses at once
    async change(): Promise<ChangeResult> {
      throw new SupplierUnsupportedError(
        "nuitee",
        "change",
        "cancel_and_rebook",
        "this hotel supplier's change flow is not offered here: cancel under the booking's policy and book the new stay",
      );
    },

    async quoteCancel(
      ctx: SupplierContext,
      request: CancelRequest,
    ): Promise<CancelQuote> {
      const { quote } = await liveQuote(ctx, request);
      return quote;
    },

    async cancel(
      ctx: SupplierContext,
      request: CancelRequest,
    ): Promise<CancelResult> {
      const config = liteConfig(ctx);
      const { quote, booking } = await liveQuote(ctx, request);
      const accepted = request.acceptedPenalty ?? null;
      if (
        quote.penalty.amountMinor > 0 &&
        (accepted === null ||
          accepted.currency !== quote.penalty.currency ||
          accepted.amountMinor !== quote.penalty.amountMinor)
      ) {
        // The penalty moved since the traveller saw it: nothing is cancelled.
        return {
          accepted: false,
          penalty: quote.penalty,
          refundable: quote.refundable,
          reason: "penalty_changed",
        };
      }
      const call = assertCallable(
        ctx,
        LITEAPI_BOOK_ENDPOINT,
        "cancel",
        config.bookBaseUrl,
      );
      const response = await supplierRequest({
        adapter: "nuitee",
        operation: "cancel",
        method: "PUT",
        url: `${call.baseUrl}/bookings/${encodeURIComponent(booking.bookingId)}`,
        headers: headers(call.token),
        timeoutMs: config.bookTimeoutMs ?? 60_000,
      });
      if (response.status >= 500) {
        // Ambiguous, like a timeout: the booking may already be cancelled.
        // Never reported as a refusal; the booking.cancel webhook or a lookup
        // settles it.
        const code = errorCode(response.body);
        throw new SupplierHttpError(
          "nuitee",
          "cancel",
          response.status,
          code === null ? null : String(code),
          true,
          "LiteAPI did not confirm the cancellation (server error); whether it took effect is unknown",
        );
      }
      if (response.status !== 200) {
        return {
          accepted: false,
          penalty: quote.penalty,
          refundable: quote.refundable,
          reason: `liteapi_${errorCode(response.body) ?? response.status}`,
        };
      }
      const parsed = LiteCancelSchema.safeParse(dataOf(response.body));
      if (
        !parsed.success ||
        !parsed.data.status.toUpperCase().startsWith("CANCEL")
      ) {
        throw unreadable("cancel", "cancellation");
      }
      const fee = money(
        toMinor(parsed.data.cancellation_fee ?? 0, parsed.data.currency),
        parsed.data.currency,
      );
      const refund = money(
        toMinor(parsed.data.refund_amount ?? 0, parsed.data.currency),
        parsed.data.currency,
      );
      if (fee.amountMinor !== quote.penalty.amountMinor) {
        adapterLogger.error(
          {
            supplierId: ctx.supplierId,
            ourRef: request.ourRef,
            quoted: quote.penalty.amountMinor,
            charged: fee.amountMinor,
          },
          "LiteAPI charged a cancellation fee different from the quoted penalty; recorded for settlement review",
        );
      }
      return { accepted: true, penalty: fee, refundable: refund };
    },

    // eslint-disable-next-line require-await -- async by the adapter contract; an unsupported capability refuses at once
    async refund(): Promise<RefundResult> {
      throw new SupplierUnsupportedError(
        "nuitee",
        "refund",
        "cancel_order",
        "LiteAPI refunds follow the booking's cancellation policy; there is no stand-alone refund call",
      );
    },

    async providerHealth(ctx: SupplierContext): Promise<HttpSupplierHealth> {
      const health = await httpSupplierHealth(
        ctx,
        LITEAPI_ENDPOINT,
        LITEAPI_CAPABILITIES,
        async () => {
          const parsed = liteConfigSchema.safeParse(ctx.config);
          if (!parsed.success) {
            return false;
          }
          const key = resolveSecret(parsed.data.secretRef);
          const base = resolveBaseUrl(LITEAPI_ENDPOINT, parsed.data.baseUrl);
          if (key === null || !base.permitted) {
            return false;
          }
          const response = await supplierRequest({
            adapter: "nuitee",
            operation: "probe",
            method: "GET",
            url: `${base.url}/data/currencies`,
            headers: headers(key),
            timeoutMs: 5_000,
          });
          return response.status === 200;
        },
        liteHealthExtras(ctx),
      );
      return health;
    },
  };

  async function resolveAmbiguous(
    ctx: SupplierContext,
    request: BookRequest,
    cause: string,
  ): Promise<BookResult> {
    adapterLogger.warn(
      { supplierId: ctx.supplierId, ourRef: request.ourRef, cause },
      "LiteAPI booking outcome ambiguous; looking it up by our client reference (never re-booking)",
    );
    try {
      const found = await lookup(ctx, request.ourRef, {
        offerSnapshot: request.offerSnapshot,
      });
      if (found.found && found.state === "confirmed") {
        return {
          outcome: "confirmed",
          supplierRefs: found.supplierRefs,
          documentsIssued: true,
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
        "LiteAPI lookup after an ambiguous booking failed; the order stays unresolved",
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
