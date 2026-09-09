/**
 * Supply adapter contracts — the ONLY source of promises (CLAUDE.md #23).
 *
 * Every promise a traveller sees on a specific offer — whether it can be held
 * and for how long, whether the price is guaranteed, who the merchant of record
 * is, whether it can be changed or refunded, which currency it settles in,
 * whether it is covered by a funded rule — comes from a capability record the
 * adapter returns on that offer. Nothing in the routes or ops modules invents a
 * promise; they read it from here.
 *
 * A `FlightSupplyAdapter` and a `StaySupplyAdapter` are deliberately separate
 * interfaces: a hotel API's shape is not a flight API's shape, and flight
 * support is never inferred from a stay adapter (CLAUDE.md — "do NOT infer
 * Nuitee flight support from a hotel API"). They share the servicing surface
 * (book / lookup / change / cancel / refund / status / reconcile / health)
 * because an order, once created, is serviced the same way whatever it holds.
 */
import type { Money } from "@ubi/contracts";
import type { JsonRecord } from "../ops/types";

/**
 * The capability record stamped on every offer. `merchantOfRecord` decides who
 * carries the charge; `priceGuaranteeUntil` is a price promise, never a seat
 * reservation (hold is `holdSupported` + `holdExpiresAt`).
 */
export interface SupplyCapabilities {
  readonly holdSupported: boolean;
  /** Actual hold expiry, present only when the supplier really holds inventory. */
  readonly holdExpiresAt?: string | null;
  /** Only when the adapter guarantees the price; never a seat reservation. */
  readonly priceGuaranteeUntil?: string | null;
  readonly merchantOfRecord: "ubi" | "supplier";
  readonly changeSupported: boolean;
  readonly refundSupported: boolean;
  readonly currency: string;
  readonly payAtProperty?: boolean;
  /** Currencies the supplier can settle this offer in. */
  readonly currencies?: readonly string[];
  /** Free-form coverage note the supplier attaches (e.g. statutory scheme). */
  readonly coverage?: string | null;
}

export interface FxQuote {
  readonly rate: number;
  readonly lockedUntil: string;
}

/** A validated, re-priced offer returned by search or a refresh. */
export interface AdapterOffer {
  readonly offerRef: string;
  readonly kind: "flight" | "stay";
  /** The full offer document persisted as `offer_snapshot`. */
  readonly snapshot: JsonRecord;
  readonly price: Money;
  readonly supplierPrice?: Money | null;
  readonly fx?: FxQuote | null;
  readonly payAtProperty?: Money | null;
  readonly capabilities: SupplyCapabilities;
  readonly soldOut?: boolean;
  /** Cancellation / change policy text, persisted on the order. */
  readonly policy: JsonRecord;
}

export interface SearchResult {
  readonly offers: readonly AdapterOffer[];
  readonly pricesAsOf: Date;
  /** How long the supplier's terms permit caching; never replaces revalidation. */
  readonly cacheUntil: Date | null;
  readonly latencyMs: number;
}

/** Outcome of revalidating one offer at checkout (CLAUDE.md #23 — cache never bypasses this). */
export interface OfferValidation {
  /** Still purchasable at the same price. */
  readonly available: boolean;
  /** Available but the price moved — checkout must surface the diff, never charge silently. */
  readonly repriced: boolean;
  readonly soldOut: boolean;
  readonly offer: AdapterOffer;
}

export interface HoldResult {
  readonly held: boolean;
  readonly holdRef?: string;
  readonly expiresAt?: string;
}

export interface BookRequest {
  /** UBI's own canonical order id — the reference every lookup uses (CLAUDE.md #24). */
  readonly ourRef: string;
  readonly offerRef: string;
  readonly offerSnapshot: JsonRecord;
  /** Opaque, already-validated passenger refs; documents are never forwarded. */
  readonly passengers: JsonRecord[];
  readonly idempotencyKey: string;
}

export type BookOutcome =
  | "confirmed"
  | "supplier_pending"
  | "failed"
  | "unknown";

export interface SupplierRefs {
  readonly pnr?: string;
  readonly bookingRef?: string;
  readonly orderRef?: string;
  readonly ticketNumbers?: readonly string[];
}

export interface BookResult {
  readonly outcome: BookOutcome;
  readonly supplierRefs: SupplierRefs;
  /** Flights: true only when documents (tickets) are already issued. A PNR is not a ticket. */
  readonly documentsIssued: boolean;
  /** The invoiced amount, when the supplier returns it at book time. */
  readonly invoiced?: Money | null;
  readonly reason?: string;
}

/** Resolving an order by UBI's own reference — the only way `unknown_reconciling` is closed. */
export interface LookupResult {
  readonly found: boolean;
  readonly state: "confirmed" | "ticketed" | "failed" | "pending" | "unknown";
  readonly supplierRefs: SupplierRefs;
  readonly documentsIssued: boolean;
  readonly invoiced?: Money | null;
}

export interface ChangeRequest {
  readonly ourRef: string;
  readonly offerSnapshot: JsonRecord;
  readonly alternativeRef: string;
  readonly idempotencyKey: string;
}

export interface ChangeResult {
  readonly outcome: "changed" | "failed" | "unknown";
  readonly supplierRefs: SupplierRefs;
  readonly documentsIssued: boolean;
}

export interface CancelRequest {
  readonly ourRef: string;
  readonly supplierRefs: SupplierRefs;
  readonly idempotencyKey: string;
}

export interface CancelResult {
  readonly accepted: boolean;
  /** Penalty the supplier applies to the refund, in the order currency. */
  readonly penalty: Money;
  readonly refundable: Money;
  readonly reason?: string;
}

export interface RefundRequest {
  readonly ourRef: string;
  readonly supplierRefs: SupplierRefs;
  readonly amount: Money;
  readonly idempotencyKey: string;
}

export interface RefundResult {
  readonly stage: "supplier_confirmed" | "rejected";
  readonly supplierRef?: string;
  readonly reason?: string;
}

export interface StatusResult {
  readonly state: LookupResult["state"];
  readonly supplierRefs: SupplierRefs;
  readonly documentsIssued: boolean;
}

export interface ProviderHealth {
  readonly supplierId: string;
  readonly adapter: string;
  readonly reachable: boolean;
  readonly liveCallsBlocked: boolean;
  readonly note?: string;
}

/** Context handed to every adapter call: the supplier row's id and its config. */
export interface SupplierContext {
  readonly supplierId: string;
  readonly config: JsonRecord;
  readonly now: () => Date;
}

/** Servicing surface shared by both kinds once an order exists. */
export interface ServicingAdapter {
  readonly adapter: string;
  refreshOffer(ctx: SupplierContext, offerRef: string): Promise<OfferValidation>;
  /** Optional inventory hold / prebook; absent when the supplier does not hold. */
  hold?(ctx: SupplierContext, offerRef: string): Promise<HoldResult>;
  book(ctx: SupplierContext, request: BookRequest): Promise<BookResult>;
  /** Resolve an order by UBI's own reference (CLAUDE.md #24 — never re-purchase). */
  lookup(ctx: SupplierContext, ourRef: string): Promise<LookupResult>;
  change(ctx: SupplierContext, request: ChangeRequest): Promise<ChangeResult>;
  cancel(ctx: SupplierContext, request: CancelRequest): Promise<CancelResult>;
  refund(ctx: SupplierContext, request: RefundRequest): Promise<RefundResult>;
  status(ctx: SupplierContext, ourRef: string): Promise<StatusResult>;
  reconcile(ctx: SupplierContext, ourRef: string): Promise<LookupResult>;
  providerHealth(ctx: SupplierContext): Promise<ProviderHealth>;
}

export interface FlightSearchParams {
  readonly from: string;
  readonly to: string;
  readonly departDate: string;
  readonly returnDate?: string;
  readonly passengers: number;
  readonly cabin?: "economy" | "business";
}

export interface StaySearchParams {
  readonly city: string;
  readonly near?: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly guests: number;
}

export interface FlightSupplyAdapter extends ServicingAdapter {
  readonly kind: "flight";
  search(ctx: SupplierContext, params: FlightSearchParams): Promise<SearchResult>;
}

export interface StaySupplyAdapter extends ServicingAdapter {
  readonly kind: "stay";
  search(ctx: SupplierContext, params: StaySearchParams): Promise<SearchResult>;
  /** Rooms/rates for one property within a prior search. */
  rates(
    ctx: SupplierContext,
    propertyId: string,
    searchParams: StaySearchParams,
  ): Promise<readonly AdapterOffer[]>;
}

export type SupplyAdapter = FlightSupplyAdapter | StaySupplyAdapter;
