/**
 * Travel / Ask / Benefits contract types for the consumer web app.
 *
 * Mirrors the client-facing shapes the RN apps consume (apps/rider-mobile/src/api/*.ts),
 * which are the authoritative projection of contracts/openapi/{travel-v2,ask,promotions}.yaml.
 * Web renders these values only — status, price and eligibility are computed by the server.
 *
 * Pure module: no React/react-query imports, so it is safe to import from Server
 * Components (the trips page) and Client Components alike. Data fetching lives in ./api.
 */

export type Money = { amountMinor: number; currency: string };

/**
 * Render money using the currency the server returned — never a hard-coded ₦ symbol.
 * (CLAUDE.md money non-negotiable: clients render money, currency comes from the server.)
 * Minor-unit exponent is assumed to be 2 here; the true value comes from city config —
 * see the reported gap.
 */
export function formatMoney(m: Money): string {
  const major = m.amountMinor / 100;
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: m.currency,
      maximumFractionDigits: 0,
    }).format(major);
  } catch {
    return `${Math.round(major).toLocaleString("en-NG")} ${m.currency}`;
  }
}

/** web.* testIDs — the canonical ids from @ubi/contracts `web` group (test-ids.ts). */
export const WEB_TEST_IDS = {
  ask: { panel: "web.ask.panel" },
  handoff: {
    banner: "web.handoff.banner",
    fallback: "web.handoff.fallback",
    open: "web.handoff.open",
  },
  /** The guest passenger's trip link page (/trip-link). */
  tripLink: {
    screen: "web.tripLink.screen",
    loading: "web.tripLink.loading",
    status: "web.tripLink.status",
    eta: "web.tripLink.eta",
    route: "web.tripLink.route",
    driver: "web.tripLink.driver",
    noDriver: "web.tripLink.noDriver",
    pin: "web.tripLink.pin",
    pinReveal: "web.tripLink.pinReveal",
    pinUnavailable: "web.tripLink.pinUnavailable",
    verification: "web.tripLink.verification",
    support: "web.tripLink.support",
    decline: "web.tripLink.decline",
    declineConfirm: "web.tripLink.declineConfirm",
    declineCancel: "web.tripLink.declineCancel",
    declined: "web.tripLink.declined",
    refusal: "web.tripLink.refusal",
    expired: "web.tripLink.expired",
    revoked: "web.tripLink.revoked",
    invalid: "web.tripLink.invalid",
    missing: "web.tripLink.missing",
    error: "web.tripLink.error",
    retry: "web.tripLink.retry",
  },
} as const;

// ---------------------------------------------------------------------------
// Travel — travel-v2.yaml (flights + trips)
// ---------------------------------------------------------------------------

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
  from?: string;
  to?: string;
  date?: string;
  passengers?: number;
  offers: FlightOffer[];
};

export type FlightSearchInput = {
  from: string;
  to: string;
  departDate: string;
  returnDate?: string;
  passengers: number;
  cabin?: "economy" | "business";
};

/**
 * travel-v2.yaml LinkedItem.status. An airport transfer is `pending_unassigned` (no driver
 * yet) → `requested` (sent to drivers, no driver yet) → `awarded` (the traveller's own
 * selected award: the ONLY driver-confirmed state), or `failed` / `cancelled`.
 */
export type TripItemStatus =
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
 * travel-v2.yaml LinkedItem. `airport_transfer` items carry `transferId` and `driverSecured`
 * (true ONLY when awarded); `ride_reservation` is the legacy link (never a marketplace
 * request; status not_reserved).
 */
export type TripItem = {
  kind:
    | "flight"
    | "stay"
    | "airport_transfer"
    | "ride_reservation"
    | "return_flight_placeholder";
  orderId?: string;
  transferId?: string;
  driverSecured?: boolean;
  reservationId?: string;
  title: string;
  subtitle?: string;
  dateLabel?: string;
  status: TripItemStatus;
  charged?: Money;
  policy?: string;
  disruption?: string;
  refs?: string;
  actions?: { key: string; label: string; primary?: boolean }[];
};

/** The contract's name for one item of a trip. */
export type LinkedItem = TripItem;

export type Trip = {
  id: string;
  title: string;
  dates: string;
  timezone: string;
  items: TripItem[];
};

// ---------------------------------------------------------------------------
// Benefits — promotions.yaml
// ---------------------------------------------------------------------------

export type Credit = {
  amount: Money;
  expiresAt: string;
  perRideCap: Money;
  scope: "rides" | "airport_rides";
  restrictions?: string[];
};

export type BenefitOffer = {
  id: string;
  type: "fare_discount" | "fee_waiver" | "credit";
  title: string;
  status: "active" | "scheduled" | "used_up" | "expired" | "ineligible";
  statusAt?: string;
  description: string;
  campaignVersionId?: string;
};

export type BenefitChange = {
  id: string;
  kind: "earned" | "reversed" | "expired";
  amount: Money;
  at?: string;
  title: string;
  explanation: string;
  reasonCode?: string;
  termsRef?: { title: string; section?: string; url?: string };
  disputable?: boolean;
};

export type Benefits = {
  credits: Credit[];
  creditTotal: Money;
  offers: BenefitOffer[];
  changes: BenefitChange[];
};

// ---------------------------------------------------------------------------
// Ask — ask.yaml (SSE thread). Web renders the same event vocabulary as the app.
// ---------------------------------------------------------------------------

export type AskCard = {
  id: string;
  kind: "flight" | "stay" | "ride_estimate" | "ride_quote" | "policy";
  status: "suggestion" | "live" | "expired";
  quotedAt?: string;
  title: string;
  subtitle?: string;
  price?: Money;
  warnings?: string[];
  offerRef?: string;
};

export type AskClarifyField = {
  key: string;
  label: string;
  kind: "chips" | "passenger" | "date" | "text";
  options?: string[];
  required?: boolean;
};

export type AskSource = {
  title: string;
  ref: string;
  version?: string;
  updatedAt?: string;
};

export type AskEvent =
  | { type: "token"; text: string }
  | { type: "card"; card: AskCard }
  | { type: "clarify"; fields: AskClarifyField[] }
  | { type: "sources"; sources: AskSource[] }
  | { type: "review_ready"; reviewId: string; totals: Money }
  | { type: "refused"; deepLink: string; policy: string }
  | { type: "done" };

export type AskThread = { id: string; createdAt?: string };

/** Thread context — travel-v2 links a thread to a live search / order / trip. */
export type AskContext = {
  searchId?: string;
  tripId?: string;
  orderId?: string;
};
