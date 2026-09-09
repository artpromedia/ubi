/**
 * Checkout (contracts/openapi/travel-v2.yaml, POST /v1/travel/carts/:id/checkout).
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
 */
import {
  ContractError,
  scopedIdempotencyKey,
  type Money,
  type TravelOrderState,
} from "@ubi/contracts";

import { deterministicId, generateId } from "../lib/ids";
import { orderLogger } from "../lib/logger";
import { advanceOrder, orderView, type OrderRow, type OrderView } from "./ladder";
import { withOutbox } from "./outbox";
import { adapterFor, contextFor, loadSupplier } from "./suppliers";
import { cartView, type CartView, type PricedItem } from "./carts";
import { toJson } from "./json";

import type { BookResult, OfferValidation } from "../adapters/types";
import type { TravelDeps } from "./context";
import type { Actor, JsonRecord, JsonValue } from "./types";

export type CheckoutResult =
  | { readonly kind: "repriced"; readonly cart: CartView }
  | { readonly kind: "ok"; readonly tripId: string; readonly orders: readonly OrderView[] };

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

  const cart = await deps.db.travelCart.findUnique({ where: { id: input.cartId } });
  if (cart === null || cart.userId !== input.actor.id) {
    throw new ContractError("not_found", "no such cart", { cartId: input.cartId });
  }

  const scoped = scopedIdempotencyKey(
    `travel.checkout:${input.cartId}`,
    input.actor.id,
    input.idempotencyKey,
  );
  const tripId = deterministicId("trip", scoped);

  // Whole-checkout replay: the trip already exists, so return the orders the
  // first attempt created rather than booking again.
  const existingTrip = await deps.db.travelTrip.findUnique({ where: { id: tripId } });
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

  const items = Array.isArray(cart.items) ? (cart.items as unknown as PricedItem[]) : [];
  if (items.length === 0) {
    throw new ContractError("validation_failed", "this cart has no items");
  }
  const currency = cart.currency ?? items[0]?.currency ?? "NGN";

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
  const priceMoved = revalidatedTotal !== cartTotal;
  const acceptedNewTotal =
    input.expectedTotal !== null &&
    input.expectedTotal.amountMinor === revalidatedTotal &&
    !anySoldOut;

  if (anySoldOut || ((anyRepriced || priceMoved) && !acceptedNewTotal)) {
    // Surface the new prices and charge nothing.
    const repricedItems: PricedItem[] = revalidated.map((item) => ({
      ...item.priced,
      previousPriceMinor: item.priced.priceMinor,
      priceMinor: item.validation.offer.price.amountMinor,
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

  await deps.db.travelTrip.create({
    data: {
      id: tripId,
      userId: input.actor.id,
      title: tripTitle(revalidated),
    },
  });

  const orders: OrderView[] = [];
  for (let index = 0; index < revalidated.length; index += 1) {
    const item = revalidated[index];
    if (item === undefined) continue;
    const order = await executeItem(deps, {
      input,
      scoped,
      index,
      tripId,
      currency,
      item,
      passengers,
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
}

async function executeItem(
  deps: TravelDeps,
  args: ExecuteItemInput,
): Promise<OrderView> {
  const { input, scoped, index, tripId, item } = args;
  const orderId = deterministicId("tord", `${scoped}:${index}`);

  // Per-item replay: this item was already processed on an earlier attempt.
  const existing = await deps.db.travelOrder.findUnique({ where: { id: orderId } });
  if (existing !== null) {
    return orderView(existing as unknown as OrderRow);
  }

  const offer = item.validation.offer;
  const priceMinor = offer.price.amountMinor;
  const itemKey = `${scoped}:${index}`;

  // 1. Create the order in payment_authorized (the initial ladder state).
  await deps.db.travelOrder.create({
    data: {
      id: orderId,
      tripId,
      cartId: input.cartId,
      userId: input.actor.id,
      kind: item.priced.kind,
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
      fxLockedUntil: offer.fx?.lockedUntil ? new Date(offer.fx.lockedUntil) : null,
      payAtPropertyMinor: BigInt(offer.payAtProperty?.amountMinor ?? 0),
      policy: toJson(offer.policy),
      protectionRuleId: item.priced.protectionRuleId,
      grantId: input.grantId,
      idempotencyKey: itemKey,
    },
  });

  // 2. Authorize the hold for exactly the revalidated price (server-computed).
  const hold = await deps.payment.authorize({
    orderId,
    userId: input.actor.id,
    amount: offer.price,
    cityId: input.cityId,
    reason: `travel ${item.priced.kind} hold`,
    idempotencyKey: `${itemKey}:auth`,
    actor: input.actor,
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
    const release = await deps.payment.release({
      orderId,
      userId: input.actor.id,
      amount: offer.price,
      cityId: input.cityId,
      reason: `travel ${item.priced.kind} release`,
      idempotencyKey: `${itemKey}:rel`,
      actor: input.actor,
    });
    current = await transition(deps, {
      orderId,
      to: "failed_released",
      input,
      detail: { reason: book.reason ?? "supplier_rejected", releaseRef: release.ref },
      releasedMinor: release.amount.amountMinor,
    });
    return orderView(current);
  }

  if (book.outcome === "unknown") {
    current = await transition(deps, {
      orderId,
      to: "unknown_reconciling",
      input,
      detail: { reason: "supplier_timeout" },
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
  // ticket). Capture the hold now that the booking is real.
  const capture = await deps.payment.capture({
    orderId,
    userId: input.actor.id,
    amount: offer.price,
    cityId: input.cityId,
    reason: `travel ${item.priced.kind} capture`,
    idempotencyKey: `${itemKey}:cap`,
    actor: input.actor,
  });
  current = await transition(deps, {
    orderId,
    to: "confirmed",
    input,
    detail: { supplierRefs: book.supplierRefs as unknown as JsonValue, captureRef: capture.ref },
    supplierRefs: book.supplierRefs as unknown as JsonRecord,
    chargedMinor: capture.amount.amountMinor,
  });

  // Documents already issued at book time → ticketed. For flights this is the
  // e-ticket; for stays we record the confirmation but the order stays confirmed.
  if (book.documentsIssued) {
    if (item.priced.kind === "flight") {
      await writeDocuments(deps, orderId, book, item.priced.kind);
      current = await transition(deps, {
        orderId,
        to: "ticketed",
        input,
        detail: { supplierRefs: book.supplierRefs as unknown as JsonValue },
        supplierRefs: book.supplierRefs as unknown as JsonRecord,
      });
    } else {
      await writeDocuments(deps, orderId, book, item.priced.kind);
    }
  }

  return orderView(current);
}

async function writeDocuments(
  deps: TravelDeps,
  orderId: string,
  book: BookResult,
  kind: string,
): Promise<void> {
  const now = deps.now();
  if (kind === "flight") {
    const tickets = book.supplierRefs.ticketNumbers ?? [];
    let index = 0;
    for (const number of tickets) {
      await deps.db.travelDocument.create({
        data: {
          id: generateId("tdoc"),
          orderId,
          kind: "eticket",
          number,
          passengerIndex: index,
          issuedAt: now,
        },
      });
      index += 1;
    }
    return;
  }
  const ref = book.supplierRefs.bookingRef ?? book.supplierRefs.orderRef ?? orderId;
  await deps.db.travelDocument.create({
    data: {
      id: generateId("tdoc"),
      orderId,
      kind: "booking_confirmation",
      number: ref,
      issuedAt: now,
    },
  });
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

async function transition(
  deps: TravelDeps,
  args: TransitionArgs,
): Promise<OrderRow> {
  return withOutbox(deps.db, async (tx) => {
    const order = await tx.travelOrder.findUnique({ where: { id: args.orderId } });
    if (order === null) {
      throw new ContractError("not_found", "order vanished mid-checkout", {
        orderId: args.orderId,
      });
    }
    const result = await advanceOrder(tx, {
      order: order as unknown as OrderRow,
      to: args.to,
      actor: args.input.actor,
      actorType: "rider",
      cityId: args.input.cityId,
      detail: args.detail,
      occurredAt: deps.now(),
      correlationId: args.input.correlationId,
      ...(args.supplierRefs === undefined ? {} : { supplierRefs: args.supplierRefs }),
      ...(args.heldMinor === undefined ? {} : { heldMinor: args.heldMinor }),
      ...(args.chargedMinor === undefined ? {} : { chargedMinor: args.chargedMinor }),
      ...(args.releasedMinor === undefined ? {} : { releasedMinor: args.releasedMinor }),
    });
    return { result: result.order, events: result.events };
  });
}
