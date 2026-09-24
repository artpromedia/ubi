// Travel (travel-service THROUGH the gateway, contracts/openapi/travel-v2.yaml). Only
// routes travel-service actually serves are called here: there is no cart GET (the cart
// view comes back from POST /v1/travel/carts and PUT …/passengers, and screens read it
// from that answer) and no pickup "suggestion" — an airport transfer is the strict
// CreateAirportTransfer intent below, whose pickup window the SERVER derives from the
// flight leg. Both old calls are pinned as known client gaps in
// services/api-gateway/tests/route-contract.test.ts.
import { api, type Money } from "@ubi/mobile-core";
export type Capabilities = {
  holdSupported: boolean;
  priceGuaranteeUntil?: string;
  merchantOfRecord: "ubi" | "supplier";
  changeSupported: boolean;
  refundSupported: boolean;
  currency: string;
  payAtProperty?: boolean;
};
export type FareFamily = {
  id: string;
  name: string;
  price: Money;
  base?: Money;
  taxes?: Money;
  baggage: string;
  changeRule: string;
  refundRule: string;
  protectionOffered?: boolean;
  seatsLeft?: number;
};
export type FlightOffer = {
  offerRef: string;
  carrier: string;
  flightNumber: string;
  aircraft?: string;
  departAt: string;
  arriveAt: string;
  departTerminal?: string;
  arriveTerminal?: string;
  durationMin: number;
  stops: number;
  soldOut?: boolean;
  soldOutNote?: string;
  fareFamilies: FareFamily[];
  capabilities: Capabilities;
};
export type FlightSearch = {
  searchId: string;
  pricesAsOf: string;
  from: string;
  to: string;
  date: string;
  passengers: number;
  offers: FlightOffer[];
};
export type Rate = {
  id: string;
  roomName: string;
  board?: string;
  occupancy: {
    minAdults: number;
    maxAdults: number;
    bookable: boolean;
    reason?: string;
  };
  payNow: Money;
  payAtProperty: Money;
  supplierPrice?: Money;
  fx?: { rate: number; lockedUntil: string };
  taxesNote?: string;
  cancellation: { freeUntil: string; penaltyAfter: string };
  capabilities: Capabilities;
  approximate?: boolean;
};
export type Property = {
  id: string;
  name: string;
  area: string;
  distanceKm: number;
  distanceTo: string;
  checkIn: string;
  checkOut: string;
  nights: number;
};
export type CartItem = {
  kind: "flight" | "stay";
  title: string;
  detail: string;
  price: Money;
  previousPrice?: Money | null;
  terms: string[];
};
/**
 * The cart as travel-service serves it (ops/carts.ts cartView). `paymentMethod`,
 * `termsSummary` and `termsLinks` are not part of that view today, so they are optional:
 * a screen shows them only when a server sends them, never an invented default.
 */
export type Cart = {
  id: string;
  status:
    | "building"
    | "priced"
    | "repriced"
    | "paying"
    | "checked_out"
    | "expired";
  items: CartItem[];
  fees: { label: string; amount: Money }[];
  adjustments: { label: string; amount?: Money; note?: string }[];
  total: Money;
  previousTotal?: Money | null;
  paymentMethod?: { id: string; label: string; detail: string };
  termsSummary?: string[];
  termsLinks?: string[];
};
/** Query key the cart view is held under (seeded from the create / passengers answers). */
export const cartKey = (cartId: string) => ["travel", "cart", cartId] as const;
export type LadderStepDto = {
  step: string;
  label: string;
  state: "done" | "active" | "pending" | "skipped";
  at?: string;
  detail?: string;
};
export type OrderState =
  | "payment_authorized"
  | "submitted"
  | "supplier_pending"
  | "confirmed"
  | "ticketed"
  | "failed_released"
  | "unknown_reconciling"
  | "disrupted"
  | "cancelled"
  | "refunded"
  | "completed";
export type Order = {
  id: string;
  tripId: string;
  kind: "flight" | "stay";
  title: string;
  state: OrderState;
  headline: string;
  body: string;
  ladder: LadderStepDto[];
  supplierRefs: {
    pnr?: string;
    ticketNumbers?: string[];
    bookingRef?: string;
    orderRef?: string;
  };
  price: Money;
  held?: Money;
  charged?: Money;
  released?: Money;
  policy: { cancellation: string; change?: string; freeUntil?: string };
  siblingNote?: string;
};
export type Refund = {
  id: string;
  orderId: string;
  amount: Money;
  stage:
    | "requested"
    | "supplier_confirmed"
    | "supplier_refund_pending"
    | "refunded_to_wallet"
    | "rejected";
  expectedBy?: string;
  penalty?: Money;
  headline: string;
  body: string;
  steps: LadderStepDto[];
  footnote?: string;
};
export type Alternative = {
  id: string;
  carrier: string;
  flightNumber: string;
  departAt: string;
  arriveAt: string;
  fareFamily?: string;
  baggage?: string;
  seatsLeft?: number;
  price: Money;
  covered?: Money;
  customerPays: Money;
  heldUntil?: string;
  note?: string;
};
export type Disruption = {
  cause: "airline_cancelled" | "schedule_change" | "delay_major";
  verifiedAt: string;
  headline: string;
  body: string;
  eligibility: {
    covered: boolean;
    ruleId?: string;
    fundedBy?: string;
    cap?: Money;
    title: string;
    text: string;
  };
  airlineOptions: Alternative[];
  alternatives: Alternative[];
  refund: { amount: Money; path: string; etaDays: string; title: string };
  linkedRideImpact?: string;
  footnote?: string;
};
/** travel-v2.yaml LinkedItem.status. */
export type LinkedItemStatus =
  | "ticketed"
  | "confirmed"
  | "supplier_pending"
  | "not_reserved"
  | "pending_unassigned"
  | "requested"
  | "awarded"
  | "failed"
  | "reserved"
  | "assigned"
  | "completed"
  | "cancelled"
  | "refunded"
  | "not_booked";
/**
 * travel-v2.yaml LinkedItem. `airport_transfer` items carry `transferId` and
 * `driverSecured` (true ONLY when awarded); `ride_reservation` is the legacy link
 * (never a marketplace request; status not_reserved).
 */
export type LinkedItem = {
  kind:
    | "flight"
    | "stay"
    | "airport_transfer"
    | "ride_reservation"
    | "return_flight_placeholder";
  orderId?: string;
  transferId?: string;
  reservationId?: string;
  driverSecured?: boolean;
  title: string;
  subtitle?: string;
  dateLabel?: string;
  status: LinkedItemStatus;
  charged?: Money;
  policy?: string;
  disruption?: string;
  refs?: string;
  actions?: { key: string; label: string; primary?: boolean }[];
};
export type Trip = {
  id: string;
  title: string;
  dates: string;
  timezone: string;
  items: LinkedItem[];
};
// ── Airport transfers (T03 contract: travel-v2.yaml CreateAirportTransfer / AirportTransfer) ──

export type TransferDirection = "arrival_pickup" | "departure_dropoff";
export type TransferPlace = { lat: number; lng: number; label?: string };

/**
 * POST /v1/reservations body — STRICT (additionalProperties: false). Never a pickup time,
 * a user, a role, a city or a fare bound: those come from the gateway context and the
 * server's airport policy. `maxFareMinor` is the traveller's approved spend limit, which
 * every retime of the transfer stays within.
 */
export type CreateAirportTransfer = {
  linkedOrderId: string;
  legIndex?: number;
  direction: TransferDirection;
  airportPoint: TransferPlace;
  place: TransferPlace;
  vehicleClass: string;
  maxFareMinor: Money;
  requestedFareMinor?: Money;
  paymentMethodId: string;
};

export type TransferStatus =
  | "pending_unassigned"
  | "requested"
  | "awarded"
  | "failed"
  | "cancelled";
export type TransferChoiceKey =
  | "keep"
  | "cancel"
  | "rerequest"
  | "approve_limit";

/** travel-v2.yaml AirportTransfer — every label and notice is server-phrased. */
export type AirportTransfer = {
  transferId: string;
  linkedOrderId: string;
  direction: TransferDirection;
  legIndex?: number;
  flightNumber?: string | null;
  airportCode?: string;
  status: TransferStatus;
  /** True ONLY when status is awarded. */
  driverSecured: boolean;
  statusLabel: string;
  notice: string;
  pickup?: TransferPlace | null;
  dropoff?: TransferPlace | null;
  pickupWindow?: {
    start: string;
    end: string;
    timeZone: string;
    label: string;
  } | null;
  arriveBy?: { at: string; timeZone: string; label: string } | null;
  flight?: {
    departAt?: string | null;
    arriveAt?: string | null;
    status?: "scheduled" | "delayed" | "cancelled" | null;
  };
  vehicleClass?: string;
  approvedMaxFareMinor?: Money;
  paymentMethodId?: string;
  policyVersion?: string;
  ride?: {
    scheduledRequestId?: string | null;
    requestId?: string | null;
    state?: string | null;
    requestState?: string | null;
  } | null;
  retimedCount?: number;
  actionRequired?: {
    reason?:
      | "flight_changed_after_award"
      | "flight_changed_after_publication"
      | "flight_cancelled"
      | "fare_above_approval"
      | "ride_needs_approval";
    message?: string;
    choices?: { key: TransferChoiceKey; label: string }[];
    minimumFareMinor?: Money;
  } | null;
  outcome?: { reason?: string; message?: string } | null;
  terms: string[];
  createdAt?: string;
  updatedAt?: string;
};

const transferPath = (transferId: string) =>
  "/v1/reservations/" + encodeURIComponent(transferId);

export const travelApi = {
  searchFlights: (params: {
    from: string;
    to: string;
    departDate: string;
    returnDate?: string;
    passengers: number;
    cabin?: string;
  }) => api<FlightSearch>("POST", "/v1/travel/flights/searches", params),
  refreshFlights: (searchId: string) =>
    api<FlightSearch>("GET", "/v1/travel/flights/searches/" + searchId),
  rates: (propertyId: string, searchId: string) =>
    api<{ property: Property; rates: Rate[] }>(
      "GET",
      "/v1/travel/stays/" + propertyId + "/rates?searchId=" + searchId,
    ),
  createCart: (
    items: {
      kind: "flight" | "stay";
      offerRef: string;
      fareFamilyId?: string;
      rateId?: string;
    }[],
  ) => api<Cart>("POST", "/v1/travel/carts", { items }),
  // PUT answers the updated cart view — the one the checkout screen reads.
  putPassengers: (cartId: string, passengers: unknown[]) =>
    api<Cart>("PUT", "/v1/travel/carts/" + cartId + "/passengers", passengers),
  checkout: (
    cartId: string,
    paymentMethodId: string,
    proof: string,
    expectedTotal: Money,
  ) =>
    api<{ tripId: string; orders: Order[] }>(
      "POST",
      "/v1/travel/carts/" + cartId + "/checkout",
      { paymentMethodId, assurance: { method: "pin", proof }, expectedTotal },
    ),
  order: (orderId: string) => api<Order>("GET", "/v1/travel/orders/" + orderId),
  trip: (tripId: string) => api<Trip>("GET", "/v1/travel/trips/" + tripId),
  linked: (tripId: string) =>
    api<Trip>("GET", "/v1/travel/trips/" + tripId + "/linked"),
  refund: (refundId: string) =>
    api<Refund>("GET", "/v1/travel/refunds/" + refundId),
  disruption: (orderId: string) =>
    api<Disruption>("GET", "/v1/travel/orders/" + orderId + "/disruption"),
  switchTo: (orderId: string, alternativeId: string) =>
    api<Order>("POST", "/v1/travel/orders/" + orderId + "/switch", {
      alternativeId,
    }),
  requestRefund: (orderId: string) =>
    api<Refund>("POST", "/v1/travel/orders/" + orderId + "/cancel"),
  // Airport transfers. 202 answers the pending intent (no driver yet); a replay under the
  // same caller-held key answers the stored result. Behind the `reservations` flag
  // (404 feature_disabled while off).
  createTransfer: (body: CreateAirportTransfer, idempotencyKey: string) =>
    api<AirportTransfer>("POST", "/v1/reservations", body, { idempotencyKey }),
  transfers: (linkedOrderId?: string) =>
    api<{ items: AirportTransfer[] }>(
      "GET",
      "/v1/reservations" +
        (linkedOrderId
          ? "?linkedOrderId=" + encodeURIComponent(linkedOrderId)
          : ""),
    ),
  transfer: (transferId: string) =>
    api<AirportTransfer>("GET", transferPath(transferId)),
  // Only a choice `actionRequired` offers (cancel is always allowed while live).
  // `approve_limit` carries the traveller's NEW typed limit; no other choice sends money.
  decideTransfer: (
    transferId: string,
    choice: TransferChoiceKey,
    idempotencyKey: string,
    maxFareMinor?: Money,
  ) =>
    api<AirportTransfer>(
      "POST",
      transferPath(transferId) + "/decision",
      maxFareMinor ? { choice, maxFareMinor } : { choice },
      { idempotencyKey },
    ),
  cancelTransfer: (transferId: string, idempotencyKey: string) =>
    api<AirportTransfer>(
      "POST",
      transferPath(transferId) + "/cancel",
      undefined,
      { idempotencyKey },
    ),
};
