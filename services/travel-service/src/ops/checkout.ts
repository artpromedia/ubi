/**
 * Checkout (contracts/openapi/travel-v2.yaml, POST /v1/travel/carts/:id/checkout).
 *
 * Per vertical, per city: a flight item needs `flights_booking` and a stay item
 * `stays_booking` switched on before anything is revalidated or authorized
 * (deny-by-default; payment-service's own gate accepts either switch, so the
 * vertical is enforced here).
 *
 * Two rules from CLAUDE.md shape this whole module:
 *
 *  #23 — the cart's price is NEVER the price charged. Checkout revalidates every
 *  item with its supplier at the moment of purchase. If the supplier's price has
 *  moved and the traveller has not already accepted the new total, checkout
 *  stops with a repriced cart (409) and charges nothing.
 *
 *  #25 — there is NO atomicity across suppliers. Each item becomes its OWN order
 *  with its own money, state and policy, processed independently. One item can be
 *  confirmed while another fails or is still pending; a hard failure on one item
 *  never rolls back an item that already succeeded.
 *
 * And #24 — a supplier timeout is `unknown_reconciling`, not a failure and not a
 * silent success. The hold is left in place, nothing is released, nothing is
 * re-purchased; the order is resolved later by a lookup on UBI's own reference.
 * The reverse holds too: when `book()` refuses BEFORE any provider call (an
 * expired quote, passenger data the supplier would reject, missing
 * credentials) nothing can exist at the supplier, so the order fails
 * definitively and the hold is released at once.
 *
 * CONSENT. A moved price, a changed term (board, cancellation policy) or a
 * price surfaced by an earlier 409 is charged only when the traveller sends
 * back exactly that total as `expectedTotal` — never auto-accepted. An expired
 * or sold-out offer is surfaced and never booked.
 *
 * MONEY. Every posting goes through ./payment-settle.ts: one key per order
 * (`<orderId>:auth|:cap|:rel`, shared with reconcile and webhooks) and, after
 * an ambiguous or 409 answer, convergence through payment-service's recorded
 * state. A hold is authorized BEFORE the order row exists, so an order in
 * `payment_authorized` always has a real hold behind it.
 */
import {
  canTransition,
  ContractError,
  scopedIdempotencyKey,
  type Money,
  type TravelOrderState,
} from "@ubi/contracts";

import {
  cartView,
  termsFor,
  VERTICAL_FLAG,
  type CartView,
  type PricedItem,
} from "./carts";
import { assertFlagEnabled } from "./config";
import { escalate, writeDocumentsOnce } from "./converge";
import { toJson } from "./json";
import {
  advanceOrder,
  orderView,
  type OrderRow,
  type OrderView,
} from "./ladder";
import { withOutbox } from "./outbox";
import { settlePayment } from "./payment-settle";
import { adapterFor, contextFor, loadSupplier } from "./suppliers";
import { isPreCallRefusal } from "../adapters/errors";
import { deterministicId } from "../lib/ids";
import { orderLogger } from "../lib/logger";

import type { TravelDeps } from "./context";
import type { Actor, JsonRecord, JsonValue } from "./types";
import type { BookResult, OfferValidation } from "../adapters/types";

export type CheckoutResult =
  | { readonly kind: "repriced"; readonly cart: CartView }
  | {
      readonly kind: "ok";
      readonly tripId: string;
      readonly orders: readonly OrderView[];
    };

export interface CheckoutInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly cartId: string;
  readonly paymentMethodId: string;
  readonly grantId: string | null;
  readonly assuranceMethod: string | null;
  readonly expectedTotal: Money | null;
  readonly idempotencyKey: string;
  readonly correlationId: string | null;
}

interface RevalidatedItem {
  readonly priced: PricedItem;
  readonly validation: OfferValidation;
}

async function revalidate(
  deps: TravelDeps,
  priced: PricedItem,
): Promise<RevalidatedItem> {
  const supplier = await loadSupplier(deps.db, priced.supplierId);
  const adapter = adapterFor(supplier);
  const validation = await adapter.refreshOffer(
    contextFor(supplier, deps.now),
    priced.purchaseRef,
  );
  return { priced, validation };
}

export async function checkout(
  deps: TravelDeps,
  input: CheckoutInput,
): Promise<CheckoutResult> {
  // Confirmation is mandatory: a transactional action needs a server-minted
  // grant (from an Ask review) or a PIN assurance (CLAUDE.md #18).
  if (input.grantId === null && input.assuranceMethod === null) {
    throw new ContractError(
      "validation_failed",
      "checkout needs a confirmation: an action grant or a PIN",
    );
  }

  const cart = await deps.db.travelCart.findUnique({
    where: { id: input.cartId },
  });
  if (cart === null || cart.userId !== input.actor.id) {
    throw new ContractError("not_found", "no such cart", {
      cartId: input.cartId,
    });
  }

  const scoped = scopedIdempotencyKey(
    `travel.checkout:${input.cartId}`,
    input.actor.id,
    input.idempotencyKey,
  );
  const tripId = deterministicId("trip", scoped);

  // Whole-checkout replay: the trip already exists, so return the orders the
  // first attempt created rather than booking again.
  const existingTrip = await deps.db.travelTrip.findUnique({
    where: { id: tripId },
  });
  if (existingTrip !== null) {
    const orders = await deps.db.travelOrder.findMany({
      where: { tripId },
      orderBy: { createdAt: "asc" },
    });
    return {
      kind: "ok",
      tripId,
      orders: orders.map((order) => orderView(order as unknown as OrderRow)),
    };
  }

  const items = Array.isArray(cart.items)
    ? (cart.items as unknown as PricedItem[])
    : [];
  if (items.length === 0) {
    throw new ContractError("validation_failed", "this cart has no items");
  }
  const currency = cart.currency ?? items[0]?.currency ?? "NGN";

  // Each item's vertical must be open in this city before any supplier or
  // payment call (deny-by-default).
  const config = await deps.config.load(input.cityId);
  for (const kind of new Set(items.map((item) => item.kind))) {
    assertFlagEnabled(config.flags, VERTICAL_FLAG[kind]);
  }

  // Revalidate every item. The cache never gets us here (CLAUDE.md #23).
  const revalidated: RevalidatedItem[] = [];
  for (const priced of items) {
    revalidated.push(await revalidate(deps, priced));
  }

  const revalidatedTotal = revalidated.reduce(
    (sum, item) => sum + item.validation.offer.price.amountMinor,
    0,
  );
  const cartTotal = Number(cart.totalMinor ?? 0n);
  const anyRepriced = revalidated.some((item) => item.validation.repriced);
  const anySoldOut = revalidated.some((item) => item.validation.soldOut);
  const anyExpired = revalidated.some(
    (item) => item.validation.expired === true || !item.validation.available,
  );
  const anyTermsChanged = revalidated.some(
    (item) => item.validation.termsChanged === true,
  );
  const priceMoved = revalidatedTotal !== cartTotal;
  // A price the last 409 surfaced has not been agreed to until it is echoed.
  const surfacedUnconfirmed = cart.status === "repriced";
  const consented =
    input.expectedTotal !== null &&
    input.expectedTotal.currency === currency &&
    input.expectedTotal.amountMinor === revalidatedTotal;
  const needsConsent =
    anyRepriced || priceMoved || anyTermsChanged || surfacedUnconfirmed;
  // A changed term must have been SHOWN (a prior 409) before it can be agreed.
  const consentValid = consented && (!anyTermsChanged || surfacedUnconfirmed);

  if (anySoldOut || anyExpired || (needsConsent && !consentValid)) {
    // Surface the new prices and terms and charge nothing.
    const repricedItems: PricedItem[] = revalidated.map((item) => ({
      ...item.priced,
      previousPriceMinor: item.priced.priceMinor,
      priceMinor: item.validation.offer.price.amountMinor,
      capabilities: item.validation.offer.capabilities as unknown as JsonRecord,
      policy: item.validation.offer.policy,
      offerSnapshot: item.validation.offer.snapshot,
      terms: termsFor(item.validation.offer),
    }));
    const updated = await withOutbox(deps.db, async (tx) => {
      const row = await tx.travelCart.update({
        where: { id: input.cartId },
        data: {
          status: "repriced",
          items: toJson(repricedItems),
          previousTotalMinor: BigInt(cartTotal),
          totalMinor: BigInt(revalidatedTotal),
        },
      });
      return {
        result: row,
        events: [
          {
            name: "travel.cart.repriced" as const,
            aggregateType: "travel_cart",
            aggregateId: input.cartId,
            fromVersion: null,
            toVersion: 1,
            actor: input.actor,
            actorType: "rider",
            cityId: input.cityId,
            idempotencyKey: `travel.cart.repriced:${input.cartId}:${Date.now()}`,
            correlationId: input.correlationId,
            occurredAt: deps.now(),
            payload: {
              cartId: input.cartId,
              previousTotal: cartTotal,
              newTotal: revalidatedTotal,
              soldOut: anySoldOut,
              expired: anyExpired,
              termsChanged: anyTermsChanged,
            },
          },
        ],
      };
    });
    return { kind: "repriced", cart: cartView(updated) };
  }

  // Prices hold. Create the trip, then process each item independently.
  const passengers = Array.isArray(cart.passengers)
    ? (cart.passengers as JsonRecord[])
    : [];

  // The trip is created with the first order, after that order's hold is
  // real: a checkout whose first authorization is refused leaves nothing
  // behind, so a retry with the same key runs again rather than replaying an
  // empty trip.
  const ensureTrip = async (): Promise<void> => {
    const existing = await deps.db.travelTrip.findUnique({
      where: { id: tripId },
    });
    if (existing === null) {
      await deps.db.travelTrip.create({
        data: {
          id: tripId,
          userId: input.actor.id,
          title: tripTitle(revalidated),
        },
      });
    }
  };

  const orders: OrderView[] = [];
  for (let index = 0; index < revalidated.length; index += 1) {
    const item = revalidated[index];
    if (item === undefined) {
      continue;
    }
    const order = await executeItem(deps, {
      input,
      scoped,
      index,
      tripId,
      currency,
      item,
      passengers,
      ensureTrip,
    });
    orders.push(order);
  }

  await deps.db.travelCart.update({
    where: { id: input.cartId },
    data: { status: "checked_out" },
  });

  return { kind: "ok", tripId, orders };
}

function tripTitle(items: readonly RevalidatedItem[]): string {
  const first = items[0]?.validation.offer.snapshot;
  if (first !== undefined && typeof first.carrier === "string") {
    return `Trip · ${first.carrier}`;
  }
  return "Trip";
}

interface ExecuteItemInput {
  readonly input: CheckoutInput;
  readonly scoped: string;
  readonly index: number;
  readonly tripId: string;
  readonly currency: string;
  readonly item: RevalidatedItem;
  readonly passengers: readonly JsonRecord[];
  readonly ensureTrip: () => Promise<void>;
}

async function executeItem(
  deps: TravelDeps,
  args: ExecuteItemInput,
): Promise<OrderView> {
  const { input, scoped, index, tripId, item } = args;
  const orderId = deterministicId("tord", `${scoped}:${index}`);

  // Per-item replay: this item was already processed on an earlier attempt.
  const existing = await deps.db.travelOrder.findUnique({
    where: { id: orderId },
  });
  if (existing !== null) {
    return orderView(existing as unknown as OrderRow);
  }

  const offer = item.validation.offer;
  const priceMinor = offer.price.amountMinor;
  const itemKey = `${scoped}:${index}`;
  const kind = item.priced.kind;

  // 1. Authorize the hold for exactly the revalidated price (server-computed),
  //    under the order's canonical key, BEFORE the order row exists. A
  //    refusal (insufficient funds, a closed vertical) leaves no order behind.
  const hold = await settlePayment(deps, "authorize", {
    orderId,
    userId: input.actor.id,
    amount: offer.price,
    cityId: input.cityId,
    reason: `travel ${kind} hold`,
    actor: input.actor,
  });

  // 2. The order, in payment_authorized — now backed by a real hold.
  await args.ensureTrip();
  await deps.db.travelOrder.create({
    data: {
      id: orderId,
      tripId,
      cartId: input.cartId,
      userId: input.actor.id,
      kind,
      supplierId: item.priced.supplierId,
      state: "payment_authorized",
      supplierRefs: toJson({}),
      offerSnapshot: toJson(offer.snapshot),
      capabilities: toJson(offer.capabilities),
      priceMinor: BigInt(priceMinor),
      currency: offer.price.currency,
      supplierPriceMinor:
        offer.supplierPrice === null || offer.supplierPrice === undefined
          ? null
          : BigInt(offer.supplierPrice.amountMinor),
      supplierCurrency: offer.supplierPrice?.currency ?? null,
      fxRate: offer.fx?.rate ?? null,
      fxLockedUntil: offer.fx?.lockedUntil
        ? new Date(offer.fx.lockedUntil)
        : null,
      payAtPropertyMinor: BigInt(offer.payAtProperty?.amountMinor ?? 0),
      policy: toJson(offer.policy),
      protectionRuleId: item.priced.protectionRuleId,
      grantId: input.grantId,
      idempotencyKey: itemKey,
      cityId: input.cityId,
      supplierOfferRef: offer.supplierOfferRef ?? null,
    },
  });

  // 3. submitted (hold recorded).
  let current = await transition(deps, {
    orderId,
    to: "submitted",
    input,
    detail: { holdRef: hold.ref },
    heldMinor: hold.amount.amountMinor,
  });

  // 4. Ask the supplier to book, on OUR reference.
  let book: BookResult;
  try {
    const supplier = await loadSupplier(deps.db, item.priced.supplierId);
    const adapter = adapterFor(supplier);
    book = await adapter.book(contextFor(supplier, deps.now), {
      ourRef: orderId,
      offerRef: item.priced.purchaseRef,
      offerSnapshot: offer.snapshot,
      passengers: [...args.passengers],
      idempotencyKey: itemKey,
    });
  } catch (error) {
    if (isPreCallRefusal(error)) {
      // Refused before any provider call: nothing can exist at the supplier.
      // Fail definitively and give the traveller their money back now.
      orderLogger.warn(
        {
          orderId,
          reason: error.name,
          code: "reason" in error ? error.reason : error.capability,
        },
        "book refused before any provider call; failing the order and releasing the hold",
      );
      return releaseAndFail(deps, {
        orderId,
        input,
        kind,
        amount: offer.price,
        reason:
          "reason" in error ? error.reason : `unsupported_${error.capability}`,
        providerCalled: false,
      });
    }
    // We do not know whether the supplier took the booking. Never assume, never
    // re-purchase: go to unknown_reconciling and leave the hold (CLAUDE.md #24).
    orderLogger.error({ err: error, orderId }, "book call failed; reconciling");
    current = await transition(deps, {
      orderId,
      to: "unknown_reconciling",
      input,
      detail: { reason: "book_call_failed" },
    });
    return orderView(current);
  }

  // 5. Map the outcome onto the ladder.
  if (book.outcome === "failed") {
    return releaseAndFail(deps, {
      orderId,
      input,
      kind,
      amount: offer.price,
      reason: book.reason ?? "supplier_rejected",
      providerCalled: true,
    });
  }

  if (book.outcome === "unknown") {
    current = await transition(deps, {
      orderId,
      to: "unknown_reconciling",
      input,
      detail: { reason: book.reason ?? "supplier_timeout" },
    });
    return orderView(current);
  }

  if (book.outcome === "supplier_pending") {
    current = await transition(deps, {
      orderId,
      to: "supplier_pending",
      input,
      detail: { supplierRefs: book.supplierRefs as unknown as JsonValue },
      supplierRefs: book.supplierRefs as unknown as JsonRecord,
    });
    return orderView(current);
  }

  // confirmed: the supplier accepted and returned a reference (a PNR is not a
  // ticket). Capture the hold now that the booking is real — under the same
  // key reconcile and webhooks use, converging on an ambiguous answer.
  let capture;
  try {
    capture = await settlePayment(deps, "capture", {
      orderId,
      userId: input.actor.id,
      amount: offer.price,
      cityId: input.cityId,
      reason: `travel ${kind} capture`,
      actor: input.actor,
    });
  } catch (error) {
    // The booking is real but the capture is unresolved: record the refs and
    // let reconcile (lookup → converging capture, same key) finish it.
    orderLogger.error(
      { err: error, orderId },
      "capture unresolved after a confirmed booking; reconciling",
    );
    current = await transition(deps, {
      orderId,
      to: "unknown_reconciling",
      input,
      detail: {
        reason: "capture_unresolved",
        supplierRefs: book.supplierRefs as unknown as JsonValue,
      },
      supplierRefs: book.supplierRefs as unknown as JsonRecord,
    });
    return orderView(current);
  }
  current = await transition(deps, {
    orderId,
    to: "confirmed",
    input,
    detail: {
      supplierRefs: book.supplierRefs as unknown as JsonValue,
      captureRef: capture.ref,
    },
    supplierRefs: book.supplierRefs as unknown as JsonRecord,
    chargedMinor: capture.amount.amountMinor,
  });

  // Documents already issued at book time → ticketed. For flights this is the
  // e-ticket; for stays we record the confirmation but the order stays confirmed.
  if (book.documentsIssued) {
    await writeDocumentsOnce(deps, orderId, kind, book.supplierRefs);
    if (kind === "flight") {
      current = await transition(deps, {
        orderId,
        to: "ticketed",
        input,
        detail: { supplierRefs: book.supplierRefs as unknown as JsonValue },
        supplierRefs: book.supplierRefs as unknown as JsonRecord,
      });
    }
  }

  return orderView(current);
}

async function releaseAndFail(
  deps: TravelDeps,
  args: {
    readonly orderId: string;
    readonly input: CheckoutInput;
    readonly kind: string;
    readonly amount: Money;
    readonly reason: string;
    readonly providerCalled: boolean;
  },
): Promise<OrderView> {
  let release;
  try {
    release = await settlePayment(deps, "release", {
      orderId: args.orderId,
      userId: args.input.actor.id,
      amount: args.amount,
      cityId: args.input.cityId,
      reason: `travel ${args.kind} release`,
      actor: args.input.actor,
    });
  } catch (error) {
    // The release itself is unresolved: the booking is definitively not
    // taken, but the money state is unknown — reconcile finishes it.
    orderLogger.error(
      { err: error, orderId: args.orderId },
      "release unresolved after a definitive booking failure; reconciling",
    );
    const current = await transition(deps, {
      orderId: args.orderId,
      to: "unknown_reconciling",
      input: args.input,
      detail: { reason: "release_unresolved", bookingFailure: args.reason },
    });
    return orderView(current);
  }
  const current = await transition(deps, {
    orderId: args.orderId,
    to: "failed_released",
    input: args.input,
    detail: {
      reason: args.reason,
      providerCalled: args.providerCalled,
      releaseRef: release.ref,
    },
    releasedMinor: release.amount.amountMinor,
  });
  return orderView(current);
}

interface TransitionArgs {
  readonly orderId: string;
  readonly to: TravelOrderState;
  readonly input: CheckoutInput;
  readonly detail: JsonRecord;
  readonly supplierRefs?: JsonRecord;
  readonly heldMinor?: number;
  readonly chargedMinor?: number;
  readonly releasedMinor?: number;
}

/** Checkout moving an order towards a booking the supplier holds. */
const TOWARDS_BOOKING: ReadonlySet<TravelOrderState> = new Set([
  "supplier_pending",
  "unknown_reconciling",
  "confirmed",
  "ticketed",
]);

/**
 * Advances the order under a row lock, re-reading it first. A verified
 * supplier webhook (or an ops reconcile) can converge the same order while the
 * booking call is still answering — Duffel `order.created` and LiteAPI
 * `booking.book` fire as the booking is made. When that path already moved
 * the order, the step is a no-op and the current row is returned: never a
 * second (or backwards) step, never a 500 on a booking that succeeded. A move
 * that CONTRADICTS what the other path did (it failed the order while checkout
 * holds a booking, or the reverse) is escalated for ops, never "fixed" here.
 */
async function transition(
  deps: TravelDeps,
  args: TransitionArgs,
): Promise<OrderRow> {
  const outcome = await withOutbox<{
    readonly order: OrderRow;
    readonly moved: boolean;
  }>(deps.db, async (tx) => {
    await tx.$queryRaw`SELECT id FROM travel_orders WHERE id = ${args.orderId} FOR UPDATE`;
    const order = await tx.travelOrder.findUnique({
      where: { id: args.orderId },
    });
    if (order === null) {
      throw new ContractError("not_found", "order vanished mid-checkout", {
        orderId: args.orderId,
      });
    }
    const current = order as unknown as OrderRow;
    if (
      current.state === args.to ||
      !canTransition("travelOrder", current.state, args.to)
    ) {
      return { result: { order: current, moved: false }, events: [] };
    }
    const result = await advanceOrder(tx, {
      order: current,
      to: args.to,
      actor: args.input.actor,
      actorType: "rider",
      cityId: args.input.cityId,
      detail: args.detail,
      occurredAt: deps.now(),
      correlationId: args.input.correlationId,
      ...(args.supplierRefs === undefined
        ? {}
        : { supplierRefs: args.supplierRefs }),
      ...(args.heldMinor === undefined ? {} : { heldMinor: args.heldMinor }),
      ...(args.chargedMinor === undefined
        ? {}
        : { chargedMinor: args.chargedMinor }),
      ...(args.releasedMinor === undefined
        ? {}
        : { releasedMinor: args.releasedMinor }),
    });
    return {
      result: { order: result.order, moved: true },
      events: result.events,
    };
  });
  if (!outcome.moved && outcome.order.state !== args.to) {
    const state = outcome.order.state as TravelOrderState;
    const contradicts =
      (TOWARDS_BOOKING.has(args.to) && state === "failed_released") ||
      (args.to === "failed_released" &&
        (state === "confirmed" || state === "ticketed"));
    orderLogger.warn(
      { orderId: args.orderId, wanted: args.to, state, contradicts },
      "order already moved by another path; checkout step skipped",
    );
    if (contradicts) {
      await escalate(
        deps,
        outcome.order,
        args.input.actor,
        "checkout_contradicts_converged_state",
        { wanted: args.to, detail: args.detail },
      );
    }
  }
  return outcome.order;
}
