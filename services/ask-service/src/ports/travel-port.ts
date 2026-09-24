/**
 * The travel port — flight/stay search, offer resolution, booking status and the
 * transactional booking step run inside an execution.
 *
 * Two rules from the handoff shape this interface:
 *  - Adapter capability is the only source of promises (rule #23): an offer
 *    carries its own price age, warnings and terms; the assistant never adds a
 *    guarantee the offer did not make.
 *  - No atomicity across suppliers (rule #25): `book` is per-item and returns
 *    that item's own state, so a partial outcome stays partial.
 *
 * Search volume is capped by the caller (rule #18). Ownership on `bookingStatus`
 * is enforced by travel-service against the forwarded actor; a foreign order id
 * returns `null`.
 *
 * THE API IT SPEAKS is travel-service's own client API
 * (services/travel-service/tests/routes.manifest) — the same routes the apps
 * use, so nothing here can drift onto a path that does not exist. Before round
 * 9 this port called `/flights/search`, `/stays/search`, `/offers/:ref` and
 * `POST /orders`, none of which travel-service serves, so every assistant
 * search, review and booking 404'd in production.
 *
 *   search   POST /v1/travel/flights/searches
 *            POST /v1/travel/stays/searches, then
 *            GET  /v1/travel/stays/:propertyId/rates?searchId=  (a few
 *                 properties, cheapest bookable rate each)
 *   resolve  GET  /v1/travel/searches/:searchId/offers/:offerKey — the ONE
 *            cached offer the search priced, for the caller's own search,
 *            refused once expired (travel-service ops/search.ts
 *            readSearchOffer). An assistant `offerRef` is
 *            `<searchId>.<offerKey>`: short enough for a model to carry, and
 *            meaningless without the caller's own identity.
 *   book     POST /v1/travel/carts                  (prices it live, 1 item)
 *            PUT  /v1/travel/carts/:id/passengers   (the reviewed travellers)
 *            POST /v1/travel/carts/:id/checkout     (grant + expectedTotal)
 *   status   GET  /v1/travel/orders/:id
 *
 * BOOKING KEEPS THE REVIEWED TERMS. The user approved one price. The cart is
 * priced live by the supplier: a total that is not exactly the reviewed one
 * stops the booking before checkout (`repriced`), and checkout is sent with
 * the reviewed total as `expectedTotal` and `reviewedTermsOnly`, so a price
 * that moves at the moment of purchase, or a term the supplier reports
 * changed, is refused by travel-service (409) rather than charged — also on
 * a replay after a lost answer, which could otherwise find a change the lost
 * 409 "surfaced" and agree to it unseen. A reprice, a changed term, a
 * sold-out or an expired offer therefore always needs a fresh review — never
 * a silent charge.
 *
 * IDEMPOTENT ACROSS RETRIES. The cart and checkout keys derive from the
 * execution item's own key, so a retried item lands on the same cart and the
 * same trip: travel-service answers a replayed checkout with the orders the
 * first attempt made and never books twice. When a checkout's answer is lost
 * (timeout, reset, 5xx, an unreadable body) the outcome is RECONCILED, not
 * guessed: the checkout is replayed under the same key and each order it
 * names is read back through `GET /v1/travel/orders/:id`. If that still does
 * not settle it, the item is `unknown_reconciling` — never "failed, nothing
 * charged".
 *
 * WHAT `book` THROWS is always a refusal that happened BEFORE any money could
 * move (the cart and passengers steps move none; a checkout refused on its
 * first attempt charged nothing), as a ContractError whose `details.reason`
 * says why — `limited_mode`, `scope_missing`, `repriced`, `sold_out`,
 * `offer_expired`, `terms_changed`, `travellers_missing` (a booking with no
 * travellers is refused before anything is sent: every real supplier would
 * refuse it only after the hold), … — and whose message says so and that
 * nothing was booked or charged. Anything after a checkout was sent comes back as the order's
 * real state instead. Every upstream body is parsed against a strict schema;
 * money that does not read (non-integer minor units, a missing or malformed
 * currency) is never shown as a price and never taken as a result.
 *
 * WHO THE CALL IS MADE AS. travel-service believes one caller identity: the
 * gateway-signed `x-ubi-identity` context, required in production
 * (services/travel-service/src/middleware/auth.ts). This port therefore
 * RELAYS the context the user's own request arrived with — the one ask's
 * `gatewayAuth` verified and put in the request's identity relay scope
 * (lib/identity-relay.ts) — together with the city mirrors the gateway writes
 * from its claim and the request id. It never sends a plain `X-User-ID` /
 * `X-User-Role` in production, never presents the service key as a user, and
 * never takes an identity from a tool argument (tools only ever pass the
 * gateway-derived Actor and resource ids). Before round 7 it sent exactly
 * those plain headers plus `X-Service-Key`, which production travel-service
 * refuses (401), so every assistant travel call failed there.
 *
 *   - A relay for a different user than the Actor is refused here.
 *   - No relay (work outside a request, e.g. a background sweep) is refused
 *     here in production, before anything is sent. Outside production the
 *     documented unsigned development mode still sends the plain mirrors.
 *   - A relayed context past its 120 s lifetime is refused by travel-service
 *     (401), reported here as `unauthorized` — never as an outage, never
 *     retried under another identity.
 *   - A context travel-service accepts but does not ALLOW (403: its
 *     `travel:book` re-check — the session lacks the scope, or the device is
 *     in limited mode — or a city the session is not in) is reported as the
 *     permission refusal it is (`limited_mode` / `forbidden`, with a reason
 *     the assistant can explain) — never as `service_unavailable`, never
 *     retried.
 *
 * BACKGROUND READS. `executionOrderStatus` is the one call made with NO user
 * behind it: the service-key surface travel-service exposes for exactly this
 * (GET /internal/ask/grants/:grantId/orders/:orderId,
 * services/travel-service/src/routes/internal-ask.ts). It is addressed by the
 * order and grant ids on ask's persisted execution record, carries no
 * identity, and checks the owner travel-service reads from the order against
 * the actor on that record.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import { ContractError, type ErrorCode } from "@ubi/contracts";

import {
  currentIdentityRelay,
  signedRelayHeaders,
} from "../lib/identity-relay";
import { toolLogger } from "../lib/logger";
import { isProductionEnvironment } from "../lib/ride-context";

import type { Actor } from "../ops/types";

export type TravelKind = "flight" | "stay";

export interface TravelOffer {
  readonly offerRef: string;
  readonly kind: TravelKind;
  readonly title: string;
  readonly subtitle: string | null;
  readonly priceMinor: number;
  readonly currency: string;
  readonly quotedAt: string;
  readonly warnings: readonly string[];
}

/**
 * Exactly what travel-service's cart prices for one offer — a flight fare or
 * a stay rate. Opaque supplier references; never shown to the model.
 */
export type TravelPurchaseRef =
  | {
      readonly kind: "flight";
      readonly offerRef: string;
      readonly fareFamilyId: string;
    }
  | {
      readonly kind: "stay";
      readonly offerRef: string;
      readonly rateId: string;
    };

export interface ResolvedOffer {
  readonly offerRef: string;
  readonly kind: TravelKind;
  readonly title: string;
  readonly detail: string | null;
  readonly priceMinor: number;
  readonly currency: string;
  readonly termsVersion: string;
  readonly terms: readonly { text: string; tone: string }[];
  /**
   * What the booking will price, pinned when the review is built so a retry
   * never depends on the cached offer still being readable.
   */
  readonly purchase?: TravelPurchaseRef;
}

export interface BookingStatusResult {
  readonly orderId: string;
  readonly state: string;
  readonly supplierRef: string | null;
}

/** One booked item's outcome. A partial failure is its own released state. */
export interface BookedItem {
  readonly kind: TravelKind;
  readonly state: string;
  readonly orderId: string | null;
  readonly supplierRef: string | null;
  readonly chargedMinor: number | null;
  readonly releasedMinor: number | null;
  readonly detail: string | null;
  /** Why the item is not (yet) booked, when it is not. */
  readonly reasonCode?: string | null;
}

export interface FlightSearchInput {
  readonly origin: string;
  readonly destination: string;
  readonly departDate: string;
  readonly passengers: number;
}

export interface StaySearchInput {
  readonly city: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly guests: number;
}

/**
 * A traveller as the review carries them, in travel-service's passenger shape
 * (PUT /v1/travel/carts/:id/passengers). No identity documents: those are
 * never collected by the assistant (rule #20).
 */
export interface Traveller {
  readonly givenNames: string;
  readonly surname: string;
  readonly dateOfBirth: string;
  readonly phone: string;
  readonly title?: string;
  readonly gender?: "m" | "f";
  readonly email?: string;
}

export interface BookInput {
  readonly grantId: string;
  readonly offerRef: string;
  /** Stable per execution item: a retry lands on the same cart and trip. */
  readonly idempotencyKey: string;
  readonly paymentMethodId: string;
  readonly kind: TravelKind;
  /** The exact price the user approved on the review — never charged otherwise. */
  readonly priceMinor: number;
  readonly currency: string;
  readonly travellers: readonly Traveller[];
  /** The review's pinned purchase; resolved from the offer when absent. */
  readonly purchase?: TravelPurchaseRef | null;
}

/**
 * What a background status read is addressed by — all of it from ask's own
 * persisted execution record, none of it from a caller or a model.
 */
export interface ExecutionOrderRef {
  readonly orderId: string;
  /** The grant the execution booked the order under. */
  readonly grantId: string;
  /** The execution's actor: the order must belong to this user. */
  readonly actorId: string;
}

export interface TravelPort {
  searchFlights(
    actor: Actor,
    input: FlightSearchInput,
    limit: number,
  ): Promise<readonly TravelOffer[]>;
  searchStays(
    actor: Actor,
    input: StaySearchInput,
    limit: number,
  ): Promise<readonly TravelOffer[]>;
  /**
   * The offer as its search priced it; `null` when it is not the caller's,
   * does not exist, has expired or sold out — the user searches again.
   */
  resolveOffer(actor: Actor, offerRef: string): Promise<ResolvedOffer | null>;
  bookingStatus(
    actor: Actor,
    orderId: string,
  ): Promise<BookingStatusResult | null>;
  /**
   * Books one reviewed item. Throws only a refusal made before any money
   * could move (see the module comment); every other outcome — including an
   * unresolved one — is returned as the item's state.
   */
  book(actor: Actor, input: BookInput): Promise<BookedItem>;
  /**
   * The state of one order an execution booked, read with NO user request
   * behind it (a background sweep). `null` when travel-service has no such
   * order under that grant, or it belongs to someone other than the
   * execution's actor.
   */
  executionOrderStatus(
    ref: ExecutionOrderRef,
  ): Promise<BookingStatusResult | null>;
}

interface TravelHttpOptions {
  readonly baseUrl: string;
  /**
   * The key for travel-service's background-read surface
   * (TRAVEL_ASK_SERVICE_KEY there). Used ONLY by `executionOrderStatus`;
   * request-scoped calls relay the user's gateway context instead.
   */
  readonly internalServiceKey?: string;
  readonly timeoutMs?: number;
  /**
   * The checkout's own timeout: it runs the supplier booking synchronously,
   * so it may take far longer than a read. Well inside the relayed context's
   * 120 s lifetime, with room for the reconciliation that follows a lost
   * answer.
   */
  readonly checkoutTimeoutMs?: number;
  /** Pauses before each checkout replay after a lost answer. */
  readonly reconcileDelaysMs?: readonly number[];
  readonly fetchImpl?: typeof fetch;
}

// ---------------------------------------------------------------------------
// Strict upstream schemas
// ---------------------------------------------------------------------------

/** Integer minor units, never negative, in an ISO-4217-shaped currency. */
const MoneySchema = z
  .object({
    amountMinor: z
      .number()
      .int()
      .nonnegative()
      .refine((value) => Number.isSafeInteger(value)),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .passthrough();

/** A price someone can be charged: strictly positive. */
const PriceSchema = MoneySchema.refine((value) => value.amountMinor > 0);

const TimestampSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)));

const OFFER_KEY = /^of_[0-9a-f]{12}$/;
const SEARCH_ID = /^[A-Za-z0-9_-]{1,64}$/;

const FareFamilySchema = z
  .object({ id: z.string().min(1), name: z.string(), price: MoneySchema })
  .passthrough();

const FlightOfferSchema = z
  .object({
    offerKey: z.string().regex(OFFER_KEY),
    offerRef: z.string().min(1),
    carrier: z.string(),
    flightNumber: z.string(),
    departAt: z.string(),
    from: z.string().nullable().optional(),
    to: z.string().nullable().optional(),
    stops: z.number().int().nonnegative().optional(),
    soldOut: z.boolean().optional(),
    chosenFareFamilyId: z.string().min(1).nullable().optional(),
    fareFamilies: z.array(FareFamilySchema).min(1),
  })
  .passthrough();

const FlightSearchSchema = z
  .object({
    searchId: z.string().regex(SEARCH_ID),
    pricesAsOf: TimestampSchema,
    offers: z.array(FlightOfferSchema),
  })
  .passthrough();

const PropertySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().nullable().optional(),
    area: z.string().nullable().optional(),
    fromPrice: MoneySchema,
  })
  .passthrough();

const StaySearchSchema = z
  .object({
    searchId: z.string().regex(SEARCH_ID),
    properties: z.array(PropertySchema),
  })
  .passthrough();

const RateSchema = z
  .object({
    offerKey: z.string().regex(OFFER_KEY),
    id: z.string().min(1),
    propertyId: z.string().min(1),
    roomName: z.string(),
    board: z.string().nullable().optional(),
    payNow: PriceSchema,
    payAtProperty: MoneySchema.nullable().optional(),
    occupancy: z
      .object({ bookable: z.boolean().optional() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const RatesSchema = z.array(RateSchema);

const PurchaseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("flight"),
      offerRef: z.string().min(1),
      fareFamilyId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("stay"),
      offerRef: z.string().min(1),
      rateId: z.string().min(1),
    })
    .strict(),
]);

/** travel-service ops/search.ts SearchOfferView. */
const SearchOfferSchema = z
  .object({
    searchId: z.string(),
    offerKey: z.string(),
    kind: z.enum(["flight", "stay"]),
    cartItem: PurchaseSchema,
    title: z.string().min(1).max(300),
    detail: z.string().max(600).nullable(),
    price: PriceSchema,
    payAtProperty: MoneySchema.nullable(),
    terms: z.array(z.string().max(300)).max(20),
    rules: z.array(z.string().max(1000)).max(10),
    pricesAsOf: TimestampSchema,
    expiresAt: TimestampSchema,
  })
  .strict();

/** travel-service ops/carts.ts CartView. */
const CartSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().min(1),
    items: z.array(
      z
        .object({
          kind: z.enum(["flight", "stay"]),
          price: MoneySchema,
          previousPrice: MoneySchema.nullable().optional(),
          unavailable: z.enum(["sold_out", "expired"]).nullable().optional(),
        })
        .passthrough(),
    ),
    total: MoneySchema,
    previousTotal: MoneySchema.nullable().optional(),
  })
  .passthrough();

type Cart = z.infer<typeof CartSchema>;

/** travel-service ops/ladder.ts OrderView. */
const OrderSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1),
    state: z.string().min(1),
    supplierRefs: z.record(z.unknown()),
    price: MoneySchema,
    held: MoneySchema,
    charged: MoneySchema,
    released: MoneySchema,
  })
  .passthrough();

type Order = z.infer<typeof OrderSchema>;

const CheckoutSchema = z
  .object({ tripId: z.string().min(1), orders: z.array(OrderSchema) })
  .passthrough();

/** travel-service routes/internal-ask.ts AskOrderStatus. */
const AskOrderStatusSchema = z
  .object({
    orderId: z.string().min(1),
    state: z.string().min(1),
    supplierRefs: z.record(z.unknown()),
    ownerId: z.string().min(1),
  })
  .passthrough();

const ErrorBodySchema = z
  .object({
    code: z.string(),
    details: z.record(z.unknown()).optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * travel-service's order view carries `supplierRefs`; the assistant shows the
 * one a traveller quotes — the PNR or the hotel's booking reference before the
 * supplier's own order id.
 */
const SUPPLIER_REF_KEYS = ["pnr", "bookingRef", "orderRef"] as const;

function supplierRefOf(refs: Readonly<Record<string, unknown>>): string | null {
  for (const key of SUPPLIER_REF_KEYS) {
    const value = refs[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

/** An assistant offer reference: `<searchId>.<offerKey>`. */
function parseOfferRef(
  offerRef: string,
): { searchId: string; offerKey: string } | null {
  const dot = offerRef.lastIndexOf(".");
  if (dot <= 0) {
    return null;
  }
  const searchId = offerRef.slice(0, dot);
  const offerKey = offerRef.slice(dot + 1);
  return SEARCH_ID.test(searchId) && OFFER_KEY.test(offerKey)
    ? { searchId, offerKey }
    : null;
}

function assistantOfferRef(searchId: string, offerKey: string): string {
  return `${searchId}.${offerKey}`;
}

/**
 * The cart and checkout keys for one execution item: url-safe, bounded (the
 * travel keys are ≤ 64 characters) and the same on every retry.
 */
function itemKeys(idempotencyKey: string): {
  cart: string;
  checkout: string;
} {
  const digest = createHash("sha256")
    .update(`ask.travel.book:${idempotencyKey}`, "utf8")
    .digest("hex")
    .slice(0, 40);
  return { cart: `ask-${digest}-cart`, checkout: `ask-${digest}-checkout` };
}

function capitalise(text: string): string {
  return text.length === 0 ? text : `${text[0]?.toUpperCase()}${text.slice(1)}`;
}

const WARNING_TERMS = /non-refundable|no changes|payable at the property/i;

function reviewTerms(
  view: z.infer<typeof SearchOfferSchema>,
): { text: string; tone: string }[] {
  const terms = view.terms.map((text) => ({
    text: capitalise(text),
    tone: WARNING_TERMS.test(text) ? "warning" : "neutral",
  }));
  if (view.payAtProperty !== null && view.payAtProperty.amountMinor > 0) {
    terms.push({
      text: `${view.payAtProperty.amountMinor} ${view.payAtProperty.currency} is payable at the property, on top of this price`,
      tone: "warning",
    });
  }
  for (const rule of view.rules) {
    terms.push({ text: rule, tone: "neutral" });
  }
  return terms;
}

/**
 * A digest of every term the review shows and the booking will price: any
 * change to the price, the terms or the exact purchase changes it, which
 * supersedes a review built on the old one (ops/reviews.ts).
 */
function termsVersionOf(view: z.infer<typeof SearchOfferSchema>): string {
  const material = JSON.stringify([
    view.kind,
    view.cartItem,
    view.price.amountMinor,
    view.price.currency,
    view.payAtProperty?.amountMinor ?? null,
    view.terms,
    view.rules,
    view.title,
    view.detail,
  ]);
  const digest = createHash("sha256").update(material, "utf8").digest("hex");
  return `t${digest.slice(0, 10)}`;
}

function identityRefused(): ContractError {
  return new ContractError(
    "unauthorized",
    "the travel service did not accept this request's identity; please ask again",
    { reason: "identity_not_accepted" },
  );
}

/** travel-service's scope for moving travel money (its middleware/scopes.ts). */
const TRAVEL_BOOK_SCOPE = "travel:book";

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function bodyOf(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * travel-service's 403 as a permission refusal the assistant can explain.
 * travel-service answers `{code, message, details}` (ContractError.toBody):
 * `limited_mode` for an unverified device, `forbidden` with
 * `details.required: ["travel:book"]` for a session without the scope, or
 * `forbidden` with `details.reason: "city_mismatch"`. The message is built
 * here, from the code and reason only — upstream text never reaches the
 * model verbatim — and says nothing was booked or charged, which holds: the
 * refusal happens before any travel handler runs.
 */
function permissionRefused(body: unknown): ContractError {
  const upstream = recordOf(body);
  const details = recordOf(upstream.details);
  const required = Array.isArray(details.required)
    ? details.required.filter(
        (scope): scope is string => typeof scope === "string",
      )
    : [];
  if (upstream.code === "limited_mode") {
    return new ContractError(
      "limited_mode",
      "The travel service refused this because the user's device is not verified yet (limited mode). They can finish the security check in the UBI app, then book, cancel or change travel. Nothing was booked, changed or charged.",
      {
        reason: "limited_mode",
        required: required.length > 0 ? required : [TRAVEL_BOOK_SCOPE],
      },
    );
  }
  if (details.reason === "city_mismatch") {
    return new ContractError(
      "forbidden",
      "The travel service refused this because the request's city is not the signed-in session's city. Nothing was booked, changed or charged.",
      { reason: "city_mismatch" },
    );
  }
  if (required.includes(TRAVEL_BOOK_SCOPE)) {
    return new ContractError(
      "forbidden",
      "The travel service refused this because the user's session is not allowed to book travel (it lacks travel:book). Nothing was booked, changed or charged.",
      { reason: "scope_missing", required },
    );
  }
  return new ContractError(
    "forbidden",
    "The travel service refused this action for the signed-in user. Nothing was booked, changed or charged.",
    { reason: "travel_refused" },
  );
}

/** A booking refusal made before any money could move. */
function refused(
  code: ErrorCode,
  reason: string,
  sentence: string,
  extra: Readonly<Record<string, unknown>> = {},
): ContractError {
  return new ContractError(code, `${sentence} Nothing was booked or charged.`, {
    ...extra,
    reason,
  });
}

/**
 * Any refusal raised on the way to a checkout (identity, permission) as a
 * booking refusal: its code and reason kept, and a message that says nothing
 * was booked or charged — true, because no checkout had been sent.
 */
function asBookingRefusal(error: ContractError): ContractError {
  const reason =
    typeof error.details?.reason === "string"
      ? error.details.reason
      : error.code;
  if (error.message.includes("Nothing was booked")) {
    return error;
  }
  const sentence = error.message.endsWith(".")
    ? capitalise(error.message)
    : `${capitalise(error.message)}.`;
  return refused(error.code, reason, sentence, error.details ?? {});
}

/** The reasons a supplier gives for an offer that can no longer be bought. */
const SOLD_OUT_REASONS: ReadonlySet<string> = new Set([
  "sold_out",
  "no_availability",
  "offer_no_longer_available",
]);

function soldOut(): ContractError {
  return refused(
    "conflict",
    "sold_out",
    "That offer is sold out. Search again for what is available now.",
  );
}

function offerExpired(): ContractError {
  return refused(
    "offer_expired",
    "offer_expired",
    "That offer has expired. Search again for a current price.",
  );
}

/**
 * Why a cart (the 409 a checkout answers when it will not charge) was not
 * bought: an item the supplier no longer sells, a price that is not the
 * reviewed one, or — at the reviewed price — a changed term.
 */
function cartRefusal(
  cart: Cart,
  expected: { readonly priceMinor: number; readonly currency: string },
): ContractError {
  const reasons = new Set(cart.items.map((item) => item.unavailable ?? null));
  if (reasons.has("sold_out")) {
    return soldOut();
  }
  if (reasons.has("expired")) {
    return offerExpired();
  }
  if (
    cart.total.amountMinor !== expected.priceMinor ||
    cart.total.currency !== expected.currency
  ) {
    return refused(
      "conflict",
      "repriced",
      `The price changed from ${expected.priceMinor} ${expected.currency} to ${cart.total.amountMinor} ${cart.total.currency} since the review. It needs a fresh review before anything is booked — search again for the current price.`,
      {
        reviewedMinor: expected.priceMinor,
        currentMinor: cart.total.amountMinor,
        currency: cart.total.currency,
      },
    );
  }
  return refused(
    "conflict",
    "terms_changed",
    "The supplier changed this offer's terms (such as its cancellation policy or board) since the review. It needs a fresh review before anything is booked.",
  );
}

/** Codes a checkout answers BEFORE any money moves, whatever its attempt. */
const PRE_PAYMENT_CHECKOUT_CODES: ReadonlySet<string> = new Set([
  "validation_failed",
  "feature_disabled",
  "config_unavailable",
  "city_unsupported",
]);

const DONE_DETAIL: Readonly<Record<string, string | null>> = {
  confirmed: null,
  ticketed: null,
  submitted:
    "The booking is with the supplier and not confirmed yet. Do not book it again.",
  payment_authorized:
    "The booking is with the supplier and not confirmed yet. Do not book it again.",
  supplier_pending:
    "The supplier has not confirmed this booking yet. Do not book it again; it will update here.",
  unknown_reconciling:
    "The supplier did not say whether it took this booking, so it is being checked with them. Do not book it again.",
  failed_released:
    "The supplier did not take this booking. The hold was released and nothing was charged.",
};

function bookedFromOrder(
  order: Order,
  input: BookInput,
  reasonCode: string | null = null,
): BookedItem {
  let detail = DONE_DETAIL[order.state] ?? null;
  let reason =
    reasonCode ??
    (order.state === "failed_released" ? "supplier_declined" : null);
  if (
    order.price.currency !== input.currency ||
    order.price.amountMinor !== input.priceMinor
  ) {
    // travel-service charges only the expectedTotal it was sent; anything
    // else is a contract breach — reported as it is, never hidden.
    toolLogger.error(
      { orderId: order.id, state: order.state },
      "a travel order's price is not the reviewed price",
    );
    detail =
      "This order's price is not the one you reviewed. Our team has been alerted; contact support before booking again.";
    reason = "price_mismatch";
  }
  return {
    kind: input.kind,
    state: order.state,
    orderId: order.id,
    supplierRef: supplierRefOf(order.supplierRefs),
    chargedMinor:
      order.charged.amountMinor > 0 ? order.charged.amountMinor : null,
    releasedMinor:
      order.released.amountMinor > 0 ? order.released.amountMinor : null,
    detail,
    reasonCode: reason,
  };
}

/**
 * A checkout whose answer was lost and could not be recovered: the booking
 * may exist, so it is neither failed nor "nothing was charged".
 */
function unresolvedItem(input: BookInput): BookedItem {
  return {
    kind: input.kind,
    state: "unknown_reconciling",
    orderId: null,
    supplierRef: null,
    chargedMinor: null,
    releasedMinor: null,
    detail:
      "We could not confirm whether this booking went through. Do not book it again — check your trips; it will update here once the travel service answers.",
    reasonCode: "outcome_unknown",
  };
}

function toTravellerBody(traveller: Traveller): Record<string, string> {
  const body: Record<string, string> = {
    givenNames: traveller.givenNames,
    surname: traveller.surname,
    dateOfBirth: traveller.dateOfBirth,
    phone: traveller.phone,
  };
  if (traveller.title !== undefined) {
    body.title = traveller.title;
  }
  if (traveller.gender !== undefined) {
    body.gender = traveller.gender;
  }
  if (traveller.email !== undefined) {
    body.email = traveller.email;
  }
  return body;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function stopsText(stops: number | undefined): string | null {
  if (stops === undefined) {
    return null;
  }
  return stops === 0 ? "non-stop" : `${stops} stop${stops === 1 ? "" : "s"}`;
}

type CheckoutAnswer =
  | { readonly kind: "orders"; readonly orders: readonly Order[] }
  | { readonly kind: "refused"; readonly error: ContractError }
  | { readonly kind: "unresolved" };

// ---------------------------------------------------------------------------
// The HTTP port
// ---------------------------------------------------------------------------

export function createHttpTravelPort(options: TravelHttpOptions): TravelPort {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const checkoutTimeoutMs = options.checkoutTimeoutMs ?? 45_000;
  const reconcileDelaysMs = options.reconcileDelaysMs ?? [1_000, 3_000];
  const base = options.baseUrl.replace(/\/+$/, "");

  /**
   * The identity headers for one request-scoped call, from the current
   * request's relay (lib/identity-relay.ts). Throws — before anything is
   * sent — when there is no relay in production, or the relay is for a
   * different user than the Actor the ops layer is acting for.
   */
  function identityHeaders(actor: Actor): Record<string, string> {
    const relay = currentIdentityRelay();
    if (relay !== undefined && relay.userId !== actor.id) {
      throw new ContractError(
        "forbidden",
        "the assistant can only act as the signed-in user",
        { reason: "relay_actor_mismatch" },
      );
    }
    if (relay?.kind === "signed") {
      return signedRelayHeaders(relay);
    }
    if (isProductionEnvironment(process.env.NODE_ENV)) {
      // Fail closed: production travel-service believes only the gateway's
      // signed context, and nothing here may stand in for it.
      throw new ContractError(
        "unauthorized",
        "no verified caller identity to present to the travel service",
        { reason: "no_identity_relay" },
      );
    }
    // The documented unsigned development mode (no gateway in front).
    const headers: Record<string, string> = {
      "X-User-ID": actor.id,
      "X-User-Role": actor.role,
    };
    if (relay?.cityId !== undefined && relay.cityId !== null) {
      headers["X-City-ID"] = relay.cityId;
    }
    if (relay?.requestId !== undefined && relay.requestId !== null) {
      headers["X-Request-ID"] = relay.requestId;
    }
    return headers;
  }

  async function send(
    path: string,
    method: "GET" | "POST" | "PUT",
    headers: Record<string, string>,
    body?: unknown,
    timeout: number = timeoutMs,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeout);
    try {
      return await doFetch(`${base}${path}`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** A read or search: 401/403 become the refusals they are. */
  async function call(
    path: string,
    method: "GET" | "POST",
    actor: Actor,
    body?: unknown,
  ): Promise<Response> {
    const response = await send(path, method, identityHeaders(actor), body);
    if (response.status === 401) {
      // Expired (past the context's 120 s), or otherwise not accepted: the
      // user asks again; nothing is retried under another identity.
      throw identityRefused();
    }
    if (response.status === 403) {
      // Accepted but not allowed: a permission refusal, not an outage.
      throw permissionRefused(await bodyOf(response));
    }
    return response;
  }

  function unavailable(what = "travel search"): never {
    throw new ContractError(
      "service_unavailable",
      `${what} is not available right now`,
    );
  }

  /** A search the travel service would not run, as something the model can fix. */
  async function searchRefused(
    response: Response,
    what: "flight" | "stay",
  ): Promise<never> {
    const body = ErrorBodySchema.safeParse(await bodyOf(response));
    const code = body.success ? body.data.code : null;
    if (response.status === 422 || code === "validation_failed") {
      throw new ContractError(
        "validation_failed",
        what === "flight"
          ? "the travel service could not run that flight search: use 3-letter airport codes (e.g. LOS) and a YYYY-MM-DD date in the future"
          : "the travel service could not run that stay search: use a city name and YYYY-MM-DD check-in / check-out dates in the future",
      );
    }
    if (code === "feature_disabled") {
      throw new ContractError(
        "feature_disabled",
        `${what === "flight" ? "flight" : "stay"} booking is not available in this city`,
      );
    }
    return unavailable(`${what} search`);
  }

  function searchFailure(error: unknown, what: string): never {
    if (error instanceof ContractError) {
      throw error;
    }
    toolLogger.error({ err: error }, `${what} failed`);
    return unavailable(what);
  }

  /** GET one cached offer; `null` for anything the caller may not buy. */
  async function readOffer(
    actor: Actor,
    ref: { searchId: string; offerKey: string },
  ): Promise<z.infer<typeof SearchOfferSchema> | null> {
    const response = await call(
      `/v1/travel/searches/${encodeURIComponent(ref.searchId)}/offers/${encodeURIComponent(ref.offerKey)}`,
      "GET",
      actor,
    );
    if (response.status === 404 || response.status === 409) {
      // Not theirs / gone (404), expired or sold out (409): search again.
      return null;
    }
    if (!response.ok) {
      unavailable("offer lookup");
    }
    const parsed = SearchOfferSchema.safeParse(await bodyOf(response));
    if (
      !parsed.success ||
      parsed.data.searchId !== ref.searchId ||
      parsed.data.offerKey !== ref.offerKey ||
      parsed.data.cartItem.kind !== parsed.data.kind ||
      (parsed.data.payAtProperty !== null &&
        parsed.data.payAtProperty.currency !== parsed.data.price.currency)
    ) {
      toolLogger.error(
        { searchId: ref.searchId },
        "travel-service answered an offer read the port cannot verify; refusing it",
      );
      unavailable("offer lookup");
    }
    return parsed.data;
  }

  function orderFrom(value: unknown): Order | null {
    const parsed = OrderSchema.safeParse(value);
    if (!parsed.success) {
      return null;
    }
    const currency = parsed.data.price.currency;
    const moneyAgrees = [
      parsed.data.held,
      parsed.data.charged,
      parsed.data.released,
    ].every((amount) => amount.currency === currency);
    return moneyAgrees ? parsed.data : null;
  }

  /**
   * One checkout answer, classified. `first` is whether this is the
   * item's first checkout attempt in this call: a refusal on the first
   * attempt provably moved no money; after an answer was lost, only orders
   * settle the outcome.
   */
  async function classifyCheckout(
    response: Response,
    input: BookInput,
    first: boolean,
  ): Promise<CheckoutAnswer> {
    const body = await bodyOf(response);
    if (response.status === 202 || response.status === 200) {
      const parsed = CheckoutSchema.safeParse(body);
      if (!parsed.success) {
        return { kind: "unresolved" };
      }
      const orders = parsed.data.orders.map(orderFrom);
      if (orders.length !== 1 || orders.some((order) => order === null)) {
        // One item per cart, so exactly one order — anything else is not
        // an answer this port can stand behind.
        return { kind: "unresolved" };
      }
      return { kind: "orders", orders: orders as Order[] };
    }
    if (!first) {
      return { kind: "unresolved" };
    }
    if (response.status === 409) {
      const cart = CartSchema.safeParse(body);
      if (cart.success) {
        return { kind: "refused", error: cartRefusal(cart.data, input) };
      }
      // The real suppliers refuse the checkout's revalidation outright when
      // the offer is gone (Duffel `offer_no_longer_available`, LiteAPI
      // `no_availability` or an outdated offer): an error body, answered
      // before any hold — every later supplier error is caught into the
      // order's own state. Any other 409 is not proof nothing moved.
      const refusal = ErrorBodySchema.safeParse(body);
      if (refusal.success) {
        const reason = recordOf(refusal.data.details).reason;
        if (typeof reason === "string" && SOLD_OUT_REASONS.has(reason)) {
          return { kind: "refused", error: soldOut() };
        }
        if (
          refusal.data.code === "offer_expired" ||
          refusal.data.code === "quote_expired"
        ) {
          return { kind: "refused", error: offerExpired() };
        }
      }
      return { kind: "unresolved" };
    }
    if (response.status === 401) {
      // The identity middleware refused it before any handler ran.
      return {
        kind: "refused",
        error: refused(
          "unauthorized",
          "identity_not_accepted",
          "The travel service did not accept this request's sign-in (it may have timed out). Ask again to retry.",
        ),
      };
    }
    if (response.status === 403) {
      return { kind: "refused", error: permissionRefused(body) };
    }
    const error = ErrorBodySchema.safeParse(body);
    if (error.success) {
      const code = error.data.code;
      if (
        response.status < 500 &&
        PRE_PAYMENT_CHECKOUT_CODES.has(code) &&
        response.status !== 409
      ) {
        return {
          kind: "refused",
          error: refused(
            code === "feature_disabled"
              ? "feature_disabled"
              : "validation_failed",
            code,
            code === "feature_disabled"
              ? "Booking this kind of travel is not available in this city right now."
              : "The travel service would not check this booking out.",
          ),
        };
      }
      // The wallet refused the hold outright (e.g. insufficient funds): a
      // definitive 4xx from payment-service, relayed as travel-service's
      // 503 before any order or hold exists.
      const status = recordOf(error.data.details).status;
      if (
        response.status === 503 &&
        typeof status === "number" &&
        status >= 400 &&
        status < 500 &&
        status !== 409
      ) {
        return {
          kind: "refused",
          error: refused(
            "payment_method_unavailable",
            "payment_refused",
            "The payment method did not authorise this amount.",
          ),
        };
      }
    }
    return { kind: "unresolved" };
  }

  /** The order's latest state, read back — `null` when that read fails. */
  async function readOrder(
    actor: Actor,
    orderId: string,
  ): Promise<Order | null> {
    try {
      const response = await send(
        `/v1/travel/orders/${encodeURIComponent(orderId)}`,
        "GET",
        identityHeaders(actor),
      );
      if (!response.ok) {
        return null;
      }
      return orderFrom(await bodyOf(response));
    } catch (error) {
      toolLogger.warn(
        { err: error, orderId },
        "reading a travel order back after a lost checkout answer failed",
      );
      return null;
    }
  }

  /**
   * Checkout under the item's own key; after a lost answer, replays it under
   * the same key (travel-service answers with the orders the first attempt
   * made, never a second booking) and reads each order back.
   */
  async function checkoutItem(
    actor: Actor,
    headers: Record<string, string>,
    cartId: string,
    input: BookInput,
    checkoutKey: string,
  ): Promise<BookedItem> {
    const path = `/v1/travel/carts/${encodeURIComponent(cartId)}/checkout`;
    const body = {
      paymentMethodId: input.paymentMethodId,
      grantId: input.grantId,
      expectedTotal: {
        amountMinor: input.priceMinor,
        currency: input.currency,
      },
      // The user approved the review, not anything a 409 surfaces to this
      // port: no replay after a lost answer may agree to a changed term.
      reviewedTermsOnly: true,
    };
    const attempt = async (first: boolean): Promise<CheckoutAnswer> => {
      try {
        const response = await send(
          path,
          "POST",
          { ...headers, "Idempotency-Key": checkoutKey },
          body,
          checkoutTimeoutMs,
        );
        return await classifyCheckout(response, input, first);
      } catch (error) {
        toolLogger.warn(
          { err: error, cartId },
          "a travel checkout answer was lost; reconciling under the same key",
        );
        return { kind: "unresolved" };
      }
    };

    const answer = await attempt(true);
    if (answer.kind === "orders") {
      const [order] = answer.orders;
      return bookedFromOrder(order as Order, input);
    }
    if (answer.kind === "refused") {
      throw answer.error;
    }

    for (const delay of reconcileDelaysMs) {
      await sleep(delay);
      const replay = await attempt(false);
      if (replay.kind !== "orders") {
        continue;
      }
      const [order] = replay.orders as [Order];
      const latest = await readOrder(actor, order.id);
      return bookedFromOrder(latest ?? order, input, "reconciled");
    }
    return unresolvedItem(input);
  }

  return {
    async searchFlights(actor, input, limit): Promise<readonly TravelOffer[]> {
      try {
        const response = await call(
          "/v1/travel/flights/searches",
          "POST",
          actor,
          {
            from: input.origin.toUpperCase(),
            to: input.destination.toUpperCase(),
            departDate: input.departDate,
            passengers: input.passengers,
          },
        );
        if (!response.ok) {
          await searchRefused(response, "flight");
        }
        const parsed = FlightSearchSchema.safeParse(await bodyOf(response));
        if (!parsed.success) {
          toolLogger.error(
            { issues: parsed.error.issues.length },
            "travel-service answered a flight search the port cannot verify; refusing it",
          );
          return unavailable("flight search");
        }
        const search = parsed.data;
        const offers: TravelOffer[] = [];
        for (const offer of search.offers) {
          if (offer.soldOut === true) {
            continue;
          }
          const chosen = offer.chosenFareFamilyId ?? offer.fareFamilies[0]?.id;
          const fare = offer.fareFamilies.find(
            (family) => family.id === chosen,
          );
          if (fare === undefined || fare.price.amountMinor <= 0) {
            // A fare the search did not price is not something to show.
            return unavailable("flight search");
          }
          const route =
            offer.from !== null &&
            offer.from !== undefined &&
            offer.to !== null &&
            offer.to !== undefined
              ? `${offer.from} → ${offer.to}`
              : null;
          const stops = stopsText(offer.stops);
          offers.push({
            offerRef: assistantOfferRef(search.searchId, offer.offerKey),
            kind: "flight",
            title: `${offer.carrier} ${offer.flightNumber}`.trim(),
            subtitle: [route, `departs ${offer.departAt}`, stops, fare.name]
              .filter((part): part is string => part !== null && part !== "")
              .join(" · "),
            priceMinor: fare.price.amountMinor,
            currency: fare.price.currency,
            quotedAt: search.pricesAsOf,
            warnings: [],
          });
        }
        return offers.slice(0, limit);
      } catch (error) {
        return searchFailure(error, "flight search");
      }
    },

    async searchStays(actor, input, limit): Promise<readonly TravelOffer[]> {
      try {
        const response = await call(
          "/v1/travel/stays/searches",
          "POST",
          actor,
          {
            city: input.city,
            checkIn: input.checkIn,
            checkOut: input.checkOut,
            guests: input.guests,
          },
        );
        if (!response.ok) {
          await searchRefused(response, "stay");
        }
        const parsed = StaySearchSchema.safeParse(await bodyOf(response));
        if (!parsed.success) {
          toolLogger.error(
            { issues: parsed.error.issues.length },
            "travel-service answered a stay search the port cannot verify; refusing it",
          );
          return unavailable("stay search");
        }
        const search = parsed.data;
        // A property's "from" price is not bookable: price a few properties'
        // rooms (bounded supplier calls) and offer each one's cheapest
        // bookable rate, which the rates read caches for the review.
        const properties = search.properties.slice(0, Math.min(limit, 3));
        const offers: TravelOffer[] = [];
        let reachable = properties.length === 0;
        for (const property of properties) {
          const rates = await call(
            `/v1/travel/stays/${encodeURIComponent(property.id)}/rates?searchId=${encodeURIComponent(search.searchId)}`,
            "GET",
            actor,
          );
          if (!rates.ok) {
            continue;
          }
          reachable = true;
          const rows = RatesSchema.safeParse(await bodyOf(rates));
          if (!rows.success) {
            toolLogger.error(
              { issues: rows.error.issues.length },
              "travel-service answered stay rates the port cannot verify; refusing them",
            );
            return unavailable("stay search");
          }
          const cheapest = rows.data
            .filter(
              (rate) =>
                rate.propertyId === property.id &&
                rate.occupancy?.bookable !== false,
            )
            .sort((a, b) => a.payNow.amountMinor - b.payNow.amountMinor)[0];
          if (cheapest === undefined) {
            continue;
          }
          const name =
            property.name !== null && property.name !== undefined
              ? property.name
              : "Hotel";
          const payAtProperty = cheapest.payAtProperty ?? null;
          offers.push({
            offerRef: assistantOfferRef(search.searchId, cheapest.offerKey),
            kind: "stay",
            title: `${name} · ${cheapest.roomName}`,
            subtitle:
              [cheapest.board ?? null, property.area ?? null]
                .filter((part): part is string => part !== null && part !== "")
                .join(" · ") || null,
            priceMinor: cheapest.payNow.amountMinor,
            currency: cheapest.payNow.currency,
            quotedAt: new Date().toISOString(),
            warnings:
              payAtProperty !== null && payAtProperty.amountMinor > 0
                ? [
                    `A further ${payAtProperty.amountMinor} ${payAtProperty.currency} is payable at the property.`,
                  ]
                : [],
          });
        }
        if (!reachable) {
          return unavailable("stay search");
        }
        return offers.slice(0, limit);
      } catch (error) {
        return searchFailure(error, "stay search");
      }
    },

    async resolveOffer(actor, offerRef): Promise<ResolvedOffer | null> {
      const ref = parseOfferRef(offerRef);
      if (ref === null) {
        // Not an offer a travel search handed the assistant.
        return null;
      }
      try {
        const view = await readOffer(actor, ref);
        if (view === null) {
          return null;
        }
        return {
          offerRef,
          kind: view.kind,
          title: view.title,
          detail: view.detail,
          priceMinor: view.price.amountMinor,
          currency: view.price.currency,
          termsVersion: termsVersionOf(view),
          terms: reviewTerms(view),
          purchase: view.cartItem,
        };
      } catch (error) {
        return searchFailure(error, "offer lookup");
      }
    },

    async bookingStatus(actor, orderId): Promise<BookingStatusResult | null> {
      try {
        const response = await call(
          `/v1/travel/orders/${encodeURIComponent(orderId)}`,
          "GET",
          actor,
        );
        if (response.status === 404) {
          return null;
        }
        if (!response.ok) {
          unavailable("booking status");
        }
        const order = orderFrom(await bodyOf(response));
        if (order === null) {
          toolLogger.error(
            { orderId },
            "travel-service answered an order the port cannot verify; refusing it",
          );
          unavailable("booking status");
        }
        return {
          orderId: order.id,
          state: order.state,
          supplierRef: supplierRefOf(order.supplierRefs),
        };
      } catch (error) {
        return searchFailure(error, "booking status");
      }
    },

    async book(actor, input): Promise<BookedItem> {
      const ref = parseOfferRef(input.offerRef);
      if (ref === null) {
        throw refused(
          "validation_failed",
          "offer_ref_invalid",
          "That is not an offer a travel search returned.",
        );
      }
      if (input.travellers.length === 0) {
        // Every real supplier refuses a booking without its travellers
        // (Duffel per passenger, LiteAPI the lead guest) — but only after
        // checkout has placed the hold. Refuse here instead: no hold, and
        // the reason the user can act on.
        throw refused(
          "validation_failed",
          "travellers_missing",
          "The booking needs who is travelling: each traveller's name, date of birth and phone. Ask for them, then review again.",
        );
      }
      const keys = itemKeys(input.idempotencyKey);

      let headers: Record<string, string>;
      let cart: Cart;
      try {
        headers = identityHeaders(actor);

        // 1. What to buy: pinned on the review, or read back from the search.
        let purchase = input.purchase ?? null;
        if (purchase === null) {
          const view = await readOffer(actor, ref);
          if (view === null) {
            throw refused(
              "conflict",
              "offer_unavailable",
              "That offer is no longer available (it may have expired or sold out). Search again.",
            );
          }
          purchase = view.cartItem;
        }
        if (purchase.kind !== input.kind) {
          throw refused(
            "validation_failed",
            "offer_kind_mismatch",
            "That offer is not the kind of travel that was reviewed.",
          );
        }

        // 2. The cart: priced live by the supplier, one item, one order.
        cart = await createCart(headers, purchase, input, keys.cart);

        // 3. The travellers the user reviewed (a checked-out cart — a retry
        //    after the booking went through — takes none: checkout replays).
        if (cart.status !== "checked_out") {
          await putPassengers(headers, cart.id, input);
        }
      } catch (error) {
        if (error instanceof ContractError) {
          throw asBookingRefusal(error);
        }
        toolLogger.error(
          { err: error },
          "travel booking failed before checkout",
        );
        throw refused(
          "service_unavailable",
          "service_unavailable",
          "The travel service could not be reached.",
        );
      }

      // 4. Checkout under the grant, at exactly the reviewed total.
      return checkoutItem(actor, headers, cart.id, input, keys.checkout);
    },

    async executionOrderStatus(ref): Promise<BookingStatusResult | null> {
      const key = options.internalServiceKey;
      if (key === undefined || key.length === 0) {
        // Never an unauthenticated request, and never a user identity
        // borrowed for a read no user asked for.
        throw new ContractError(
          "service_unavailable",
          "background travel reads are not configured",
        );
      }
      try {
        // The service key and nothing else: no relay, no user mirror, no city.
        const response = await send(
          `/internal/ask/grants/${encodeURIComponent(ref.grantId)}/orders/${encodeURIComponent(ref.orderId)}`,
          "GET",
          { "X-Service-Key": key },
        );
        if (response.status === 404) {
          return null;
        }
        if (response.status === 401) {
          throw new ContractError(
            "unauthorized",
            "the travel service refused the background read's service key",
          );
        }
        if (!response.ok) {
          unavailable("booking status");
        }
        const parsed = AskOrderStatusSchema.safeParse(await bodyOf(response));
        if (!parsed.success) {
          toolLogger.error(
            { orderId: ref.orderId },
            "travel-service answered a background order read the port cannot verify; refusing it",
          );
          unavailable("booking status");
        }
        // travel-service names the owner from the order itself; it must be
        // the actor ask recorded on the execution.
        if (parsed.data.ownerId !== ref.actorId) {
          toolLogger.warn(
            { orderId: ref.orderId },
            "a background travel read returned an order owned by someone else; ignoring it",
          );
          return null;
        }
        return {
          orderId: parsed.data.orderId,
          state: parsed.data.state,
          supplierRef: supplierRefOf(parsed.data.supplierRefs),
        };
      } catch (error) {
        return searchFailure(error, "background booking status");
      }
    },
  };

  /**
   * POST /v1/travel/carts for the one reviewed item. A cart moves no money,
   * so every failure here is a refusal before anything was charged; the
   * price it comes back with must be the reviewed one.
   */
  async function createCart(
    headers: Record<string, string>,
    purchase: TravelPurchaseRef,
    input: BookInput,
    cartKey: string,
  ): Promise<Cart> {
    let response: Response;
    try {
      response = await send(
        "/v1/travel/carts",
        "POST",
        { ...headers, "Idempotency-Key": cartKey },
        { items: [purchase] },
      );
    } catch (error) {
      toolLogger.warn({ err: error }, "travel cart request failed");
      throw refused(
        "service_unavailable",
        "service_unavailable",
        "The travel service could not be reached to price this offer.",
      );
    }
    const body = await bodyOf(response);
    if (response.status === 401) {
      throw identityRefused();
    }
    if (response.status === 403) {
      throw permissionRefused(body);
    }
    if (response.status !== 201 && response.status !== 200) {
      const error = ErrorBodySchema.safeParse(body);
      const code = error.success ? error.data.code : null;
      const reason = error.success
        ? recordOf(error.data.details).reason
        : undefined;
      if (typeof reason === "string" && SOLD_OUT_REASONS.has(reason)) {
        throw soldOut();
      }
      if (code === "offer_expired" || code === "quote_expired") {
        throw offerExpired();
      }
      if (code === "feature_disabled") {
        throw refused(
          "feature_disabled",
          "feature_disabled",
          "Booking this kind of travel is not available in this city right now.",
        );
      }
      throw refused(
        "service_unavailable",
        "service_unavailable",
        "The travel service could not price this offer right now.",
      );
    }
    const parsed = CartSchema.safeParse(body);
    if (!parsed.success) {
      toolLogger.error(
        { issues: parsed.error.issues.length },
        "travel-service answered a cart the port cannot verify; refusing it",
      );
      throw refused(
        "service_unavailable",
        "service_unavailable",
        "The travel service answered with a price that could not be verified.",
      );
    }
    const cart = parsed.data;
    if (cart.status === "checked_out") {
      // A retry after this item's checkout went through: the checkout
      // replay answers with that booking.
      return cart;
    }
    const [item] = cart.items;
    if (cart.items.length !== 1 || item?.kind !== input.kind) {
      throw refused(
        "service_unavailable",
        "service_unavailable",
        "The travel service priced something other than the reviewed offer.",
      );
    }
    if (
      cart.total.amountMinor !== input.priceMinor ||
      cart.total.currency !== input.currency ||
      item.price.amountMinor !== input.priceMinor
    ) {
      throw cartRefusal(cart, input);
    }
    return cart;
  }

  /** PUT the reviewed travellers onto the cart (no money moves). */
  async function putPassengers(
    headers: Record<string, string>,
    cartId: string,
    input: BookInput,
  ): Promise<void> {
    let response: Response;
    try {
      response = await send(
        `/v1/travel/carts/${encodeURIComponent(cartId)}/passengers`,
        "PUT",
        headers,
        input.travellers.map(toTravellerBody),
      );
    } catch (error) {
      toolLogger.warn({ err: error }, "travel passengers request failed");
      throw refused(
        "service_unavailable",
        "service_unavailable",
        "The travel service could not be reached to add the travellers.",
      );
    }
    if (response.ok) {
      return;
    }
    const body = await bodyOf(response);
    if (response.status === 401) {
      throw identityRefused();
    }
    if (response.status === 403) {
      throw permissionRefused(body);
    }
    if (response.status === 409) {
      // The cart is past editing (a checkout already ran for it): the
      // checkout replay decides what happened.
      return;
    }
    if (response.status === 422) {
      throw refused(
        "validation_failed",
        "traveller_details_invalid",
        "The travel service did not accept the traveller details (name, date of birth, phone or email).",
      );
    }
    throw refused(
      "service_unavailable",
      "service_unavailable",
      "The travel service could not add the travellers right now.",
    );
  }
}
