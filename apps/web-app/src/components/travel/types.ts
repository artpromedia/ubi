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

export type TripItemStatus =
  | "ticketed"
  | "confirmed"
  | "supplier_pending"
  | "not_reserved"
  | "reserved"
  | "assigned"
  | "completed"
  | "cancelled"
  | "refunded"
  | "not_booked";

export type TripItem = {
  kind: "flight" | "stay" | "ride_reservation" | "return_flight_placeholder";
  orderId?: string;
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
