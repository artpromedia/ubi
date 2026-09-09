/**
 * The policy / support knowledge base for RAG (rule #18 — retrieval of versioned
 * policy docs filtered by role/market with citations).
 *
 * This is content, not mock money: each document is a versioned, role- and
 * market-scoped policy note, the kind of material a support answer must cite
 * rather than invent. Live facts — quotes, availability, booking status,
 * eligibility, balances — never come from here; they come from the read tools.
 * This corpus only answers "what is the policy", and every answer that leans on
 * it carries a citation back to the exact doc id and version.
 *
 * A seeded, on-disk corpus is explicitly sanctioned by the slice. In production
 * this same shape is loaded from the docs service; the retrieval code does not
 * care where the rows came from.
 */
export interface PolicyDoc {
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly updatedAt: string;
  readonly topic: string;
  /** Roles allowed to retrieve this doc. Empty means all end-user roles. */
  readonly roles: readonly string[];
  /** Markets (city ids or country codes) this doc applies to. Empty means all. */
  readonly markets: readonly string[];
  readonly body: string;
}

export const POLICY_DOCS: readonly PolicyDoc[] = [
  {
    id: "doc_refunds_travel",
    title: "Travel refunds and cancellations",
    version: "3",
    updatedAt: "2026-07-01",
    topic: "travel_refunds",
    roles: [],
    markets: [],
    body: "Flight and stay bookings are separate orders with separate refund rules that come from the specific offer, not from a blanket policy. A confirmed booking holds a PNR or booking reference; a ticket is issued only when travel documents are issued. If an order is in unknown_reconciling we resolve it by looking it up on our own reference before any refund or repurchase; we never ask a traveller to pay again.",
  },
  {
    id: "doc_ride_cancellation",
    title: "Ride cancellation windows and fees",
    version: "5",
    updatedAt: "2026-08-15",
    topic: "ride_policy",
    roles: [],
    markets: [],
    body: "A rider may cancel free of charge inside the free window after a driver is assigned; the exact window and any cancellation fee come from city config, never from a fixed number. Wait-time fees begin only after the free waiting period. All amounts are computed server-side and shown as adjustments.",
  },
  {
    id: "doc_journey_protection",
    title: "Journey Protection eligibility",
    version: "2",
    updatedAt: "2026-06-20",
    topic: "travel_protection",
    roles: [],
    markets: [],
    body: "Journey Protection and any zero-cost switching appear only when eligibility.covered is true under a funded rule id on that specific offer. Absence of coverage is shown honestly as unavailable; coverage is never implied when the adapter did not promise it.",
  },
  {
    id: "doc_driver_incentives",
    title: "Driver incentives and rebates",
    version: "4",
    updatedAt: "2026-08-30",
    topic: "driver_incentives",
    roles: ["driver"],
    markets: [],
    body: "Driver rebates are separate journal lines against the base commission, which never changes for a promotion. A posting states percentage_points or percent_of_commission explicitly and excludes tips, tolls and taxes. Whether you have reached a cap, and the cash-netting total, come from the incentive posting for your account and are explained by the driver.incentive.explain tool, not estimated.",
  },
  {
    id: "doc_p2p_scope",
    title: "What the assistant cannot do",
    version: "1",
    updatedAt: "2026-05-10",
    topic: "assistant_scope",
    roles: [],
    markets: [],
    body: "The assistant cannot send money between people, administer your account, or change campaigns, budgets or feature flags. These are handled in their own screens with their own confirmation and are out of the assistant's reach; a request for one is answered with a link to the right flow.",
  },
  {
    id: "doc_promotions_eligibility",
    title: "Promotion eligibility and stacking",
    version: "6",
    updatedAt: "2026-09-01",
    topic: "promotions",
    roles: [],
    markets: [],
    body: "A benefit's eligibility, minimum spend, cap, expiry and stacking rules are evaluated server-side from the campaign version. The assistant reports whether you currently qualify from the promotion.eligibility tool and never promises a discount it has not confirmed against a funded campaign.",
  },
];

export function docsForMarket(cityId: string): readonly PolicyDoc[] {
  return POLICY_DOCS.filter(
    (doc) => doc.markets.length === 0 || doc.markets.includes(cityId),
  );
}
