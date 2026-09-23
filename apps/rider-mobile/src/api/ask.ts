import {
  api,
  openEventStream,
  type Money,
  type SseEvent,
} from "@ubi/mobile-core";
export type CardStatus = "suggestion" | "live" | "expired";
export type Card = {
  id: string;
  kind: "flight" | "stay" | "ride_estimate" | "ride_quote" | "policy";
  status: CardStatus;
  quotedAt?: string;
  title: string;
  subtitle?: string;
  price?: Money;
  warnings?: string[];
  offerRef?: string;
  editInForm?: { route: string; params: Record<string, unknown> };
};
export type ClarifyField = {
  key: string;
  label: string;
  kind: "chips" | "passenger" | "date" | "text";
  options?: string[];
  required?: boolean;
};
export type Source = {
  title: string;
  ref: string;
  version?: string;
  updatedAt?: string;
};
export type AskEvent = SseEvent &
  (
    | { type: "token"; text: string }
    | { type: "card"; card: Card }
    | { type: "clarify"; fields: ClarifyField[] }
    | { type: "sources"; sources: Source[] }
    | {
        type: "review_ready";
        reviewId: string;
        totals: Money;
        /** Which sheet to open. Absent on older servers = travel. */
        reviewKind?: "travel" | "marketplace";
      }
    | { type: "refused"; deepLink: string; policy: string }
    | { type: "done" }
  );
export type ReviewItem = {
  kind: "flight" | "stay" | "ride_reservation" | "mp_selection" | "mp_publish";
  title: string;
  detail?: string;
  price: Money;
  priceBreakdown?: { label: string; amount: Money }[];
  terms: { text: string; tone: "neutral" | "positive" | "warning" }[];
};
export type Adjustment = {
  type: "fare_discount" | "fee_waiver" | "credit" | "referral_reward";
  label: string;
  amount: Money;
  fundedBy?: string;
  capNote?: string;
  reasonCode?: string;
};
/**
 * The structured marketplace review (ask-service ops/mp-review.ts). Every
 * amount is the server's; the client renders it and never derives one.
 */
export type MarketplaceReview = {
  stage: "select" | "publish";
  action: "mp.select" | "mp.prepare";
  /** "I can't set prices or book without your OK." — server copy. */
  statement: string;
  /** The persisted, server-derived scope the confirm will mint. */
  scope: {
    fingerprint: string;
    actions: string[];
    service: "ride" | "delivery";
    cityId: string;
    cap: Money;
    vehicleClass: string | null;
    quoteId: string;
  };
  price: Money;
  awardsNothing: boolean;
  selection?: {
    requestId: string;
    requestRevision: number;
    requestVersion: number;
    bidId: string;
    bidVersion: number;
    bidAmount: Money;
    offerExpiresAt: string;
    vehicle: string;
    driverRating: string;
    driverProfileStatus: string;
    commission: {
      payer: "driver";
      addedToYourPrice: false;
      /** Known once the award exists; null before. */
      amount: Money | null;
      note: string;
    };
  };
  publish?: {
    quoteId: string;
    service: "ride" | "delivery";
    vehicleClass: string;
    bounds: { minimum: Money; suggested: Money; maximum: Money };
    quoteExpiresAt: string;
    paymentMethodId: string;
  };
  /** The conventional flow when the assistant cannot finish (never a dead end). */
  conventionalFlow: string;
};
export type Review = {
  id: string;
  kind?: "travel" | "marketplace";
  status: "awaiting_confirmation" | "expired" | "superseded";
  termsVersion: string;
  expiresAt: string;
  items: ReviewItem[];
  adjustments?: Adjustment[];
  total: Money;
  paymentMethod: { id: string; label: string };
  assuranceRequired?: "pin" | "biometric";
  notes?: string[];
  marketplace?: MarketplaceReview;
};
export type ExecutionItemState =
  | "authorized"
  | "submitted"
  | "supplier_pending"
  | "confirmed"
  | "ticketed"
  | "failed_released"
  | "unknown_reconciling"
  | "reserved"
  | "reservation_failed"
  // Marketplace orders: distinct words for distinct facts.
  | "published"
  | "cancelled"
  | "award_pending"
  | "driver_confirmed"
  | "award_failed"
  | "failed";
export type ExecutionItem = {
  kind:
    | "payment"
    | "flight"
    | "stay"
    | "ride_reservation"
    | "mp_selection"
    | "mp_publish";
  title: string;
  state: ExecutionItemState;
  supplierRef?: string;
  orderId?: string;
  charged?: Money;
  released?: Money;
  /** Marketplace: the awarded fare, as the server reports it. */
  fare?: Money;
  /** Marketplace: the DRIVER's commission, shown separately. */
  commission?: Money;
  reasonCode?: string;
  detail?: string;
  alternatives?: Card[];
};
export type MarketplaceExecution = {
  stage: "select" | "publish";
  requestId: string | null;
  intent: { status: string; attempts: number; awardId: string | null } | null;
  reconcilable: boolean;
  conventionalFlow: string;
};
export type Execution = {
  id: string;
  status: "processing" | "confirmed" | "partly_booked" | "failed";
  startedAt: string;
  items: ExecutionItem[];
  marketplace?: MarketplaceExecution;
};
/** The persisted scope/revision the client rendered, echoed on confirm. */
export type ConfirmExpectation = {
  scopeFingerprint?: string;
  requestRevision?: number;
  bidId?: string;
};
export type MarketplaceQuoteInput = {
  service: "ride" | "delivery";
  vehicleClass: string;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  weightKg?: number;
};
export type MarketplaceQuote = {
  quoteId: string;
  service: string;
  vehicleClass: string;
  cityId: string;
  suggested: Money;
  minimum: Money;
  maximum: Money;
  expiresAt: string;
};

/** Where a marketplace proposal's conventional screen is (ubi://marketplace/...). */
export function conventionalMarketplaceTarget(
  link: string | undefined,
):
  | { screen: "Offers"; params: { requestId: string } }
  | { screen: "Details"; params?: undefined } {
  const match = /^ubi:\/\/marketplace\/requests\/([^/?#]+)/.exec(link ?? "");
  return match?.[1]
    ? {
        screen: "Offers",
        params: { requestId: decodeURIComponent(match[1]) },
      }
    : { screen: "Details" };
}

export const askApi = {
  openThread: (source: string) =>
    api<{ id: string }>("POST", "/v1/ask/threads", { source }),
  stream: (
    threadId: string,
    text: string,
    clarifications: Record<string, unknown> | undefined,
    onEvent: (e: AskEvent) => void,
    onDone: (err?: Error) => void,
  ) =>
    openEventStream(
      "/v1/ask/threads/" + threadId + "/messages",
      { text, clarifications },
      onEvent as (e: SseEvent) => void,
      onDone,
    ),
  getReview: (reviewId: string) =>
    api<Review>("GET", "/v1/ask/reviews/" + reviewId),
  /**
   * The explicit approval. For a marketplace review it echoes the persisted
   * scope/revision the user saw; a retry of the SAME approval passes the same
   * idempotency key, so it lands on the same execution.
   */
  confirmReview: (
    reviewId: string,
    termsVersion: string,
    proof: string,
    options: { expect?: ConfirmExpectation; idempotencyKey?: string } = {},
  ) =>
    api<{ executionId: string }>(
      "POST",
      "/v1/ask/reviews/" + reviewId + "/confirm",
      {
        termsVersion,
        assurance: { method: "pin", proof },
        ...(options.expect ? { expect: options.expect } : {}),
      },
      { idempotencyKey: options.idempotencyKey },
    ),
  getExecution: (executionId: string) =>
    api<Execution>("GET", "/v1/ask/executions/" + executionId),
  /** Settles an ambiguous marketplace outcome; never selects twice. */
  reconcileExecution: (executionId: string) =>
    api<Execution>(
      "POST",
      "/v1/ask/executions/" + executionId + "/reconcile",
      {},
    ),
  quoteMarketplace: (input: MarketplaceQuoteInput) =>
    api<MarketplaceQuote>("POST", "/v1/ask/mp/quotes", input),
  proposeSelection: (threadId: string, requestId: string, bidId: string) =>
    api<Review>("POST", "/v1/ask/mp/reviews", {
      stage: "select",
      threadId,
      requestId,
      bidId,
    }),
  proposePublish: (
    threadId: string,
    quote: MarketplaceQuoteInput,
    paymentMethodId: string,
    requestedFare?: Money,
  ) =>
    api<Review>("POST", "/v1/ask/mp/reviews", {
      stage: "publish",
      threadId,
      quote,
      paymentMethodId,
      ...(requestedFare ? { requestedFare } : {}),
    }),
  cancelMarketplaceRequest: (requestId: string, proof: string) =>
    api<{ requestId: string; state: string }>(
      "POST",
      "/v1/ask/mp/requests/" + encodeURIComponent(requestId) + "/cancel",
      { assurance: { method: "pin", proof } },
    ),
  handoff: (threadId: string, includeTranscript: boolean) =>
    api<{ supportCaseId: string; estimatedWaitSec: number }>(
      "POST",
      "/v1/ask/threads/" + threadId + "/handoff",
      { includeTranscript },
    ),
};
