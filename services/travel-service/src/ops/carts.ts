/**
 * Carts (contracts/openapi/travel-v2.yaml).
 *
 * A cart is priced by revalidating every item with its supplier at build time,
 * but that price is never the price charged: checkout revalidates again, because
 * the only price a traveller may be charged is the one the supplier confirms at
 * the moment of purchase (CLAUDE.md #23, #1). The cart carries per-item money and
 * terms so the client can render them; it never computes them on device.
 *
 * There is no atomicity across suppliers (CLAUDE.md #25): each item keeps its own
 * supplier, price, currency and policy, and the cart says so before payment.
 */
import {
  ContractError,
  money,
  scopedIdempotencyKey,
  type Money,
} from "@ubi/contracts";

import { deterministicId } from "../lib/ids";
import { toJson } from "./json";
import { adapterFor, contextFor, pickSupplier } from "./suppliers";
import { isUniqueViolation } from "./errors";

import type { AdapterOffer } from "../adapters/types";
import type { TravelDeps } from "./context";
import type { Actor, JsonRecord } from "./types";

export interface CartItemInput {
  readonly kind: "flight" | "stay";
  readonly offerRef: string;
  readonly fareFamilyId?: string;
  readonly rateId?: string;
}

/** The priced form persisted on the cart and read again at checkout. */
export interface PricedItem {
  readonly kind: "flight" | "stay";
  readonly supplierId: string;
  readonly purchaseRef: string;
  readonly title: string;
  readonly detail: string;
  readonly priceMinor: number;
  readonly currency: string;
  readonly previousPriceMinor: number | null;
  readonly payAtPropertyMinor: number | null;
  readonly supplierPriceMinor: number | null;
  readonly supplierCurrency: string | null;
  readonly fxRate: number | null;
  readonly fxLockedUntil: string | null;
  readonly capabilities: JsonRecord;
  readonly policy: JsonRecord;
  readonly offerSnapshot: JsonRecord;
  readonly protectionRuleId: string | null;
  readonly terms: readonly string[];
}

function purchaseRefFor(item: CartItemInput): string {
  if (item.kind === "flight") {
    if (item.fareFamilyId === undefined) {
      throw new ContractError(
        "validation_failed",
        "a flight item must name a fareFamilyId",
        { offerRef: item.offerRef },
      );
    }
    return `${item.offerRef}#${item.fareFamilyId}`;
  }
  return item.rateId ?? item.offerRef;
}

function termsFor(offer: AdapterOffer): string[] {
  const caps = offer.capabilities;
  const terms: string[] = [];
  terms.push(
    caps.merchantOfRecord === "ubi"
      ? "UBI is the merchant of record"
      : "the supplier is the merchant of record",
  );
  terms.push(caps.refundSupported ? "refundable per fare rules" : "non-refundable");
  terms.push(caps.changeSupported ? "changes allowed per fare rules" : "no changes");
  if (caps.payAtProperty === true) terms.push("part payable at the property");
  if (caps.priceGuaranteeUntil != null) {
    terms.push(`price guaranteed until ${caps.priceGuaranteeUntil}`);
  }
  return terms;
}

function titleFor(offer: AdapterOffer): { title: string; detail: string } {
  const snap = offer.snapshot;
  if (offer.kind === "flight") {
    const carrier = typeof snap.carrier === "string" ? snap.carrier : "Flight";
    const number = typeof snap.flightNumber === "string" ? snap.flightNumber : "";
    const depart = typeof snap.departAt === "string" ? snap.departAt : "";
    return { title: `${carrier} ${number}`.trim(), detail: depart };
  }
  const room = typeof snap.roomName === "string" ? snap.roomName : "Room";
  const board = typeof snap.board === "string" ? snap.board : "";
  return { title: room, detail: board };
}

async function priceItem(
  deps: TravelDeps,
  item: CartItemInput,
): Promise<PricedItem> {
  const supplier = await pickSupplier(deps.db, item.kind);
  const adapter = adapterFor(supplier);
  const purchaseRef = purchaseRefFor(item);
  const validation = await adapter.refreshOffer(
    contextFor(supplier, deps.now),
    purchaseRef,
  );
  if (validation.soldOut) {
    throw new ContractError("conflict", "that offer is sold out", { purchaseRef });
  }
  const offer = validation.offer;
  const { title, detail } = titleFor(offer);
  const protectionRuleId =
    typeof offer.snapshot.protectionRuleId === "string"
      ? offer.snapshot.protectionRuleId
      : null;
  return {
    kind: item.kind,
    supplierId: supplier.id,
    purchaseRef,
    title,
    detail,
    priceMinor: offer.price.amountMinor,
    currency: offer.price.currency,
    previousPriceMinor: null,
    payAtPropertyMinor: offer.payAtProperty?.amountMinor ?? null,
    supplierPriceMinor: offer.supplierPrice?.amountMinor ?? null,
    supplierCurrency: offer.supplierPrice?.currency ?? null,
    fxRate: offer.fx?.rate ?? null,
    fxLockedUntil: offer.fx?.lockedUntil ?? null,
    capabilities: offer.capabilities as unknown as JsonRecord,
    policy: offer.policy,
    offerSnapshot: offer.snapshot,
    protectionRuleId,
    terms: termsFor(offer),
  };
}

export interface CartView {
  readonly id: string;
  readonly status: string;
  readonly items: readonly JsonRecord[];
  readonly fees: readonly JsonRecord[];
  readonly adjustments: readonly JsonRecord[];
  readonly total: Money;
  readonly previousTotal: Money | null;
}

interface CartRow {
  id: string;
  status: string;
  items: unknown;
  fees: unknown;
  adjustments: unknown;
  totalMinor: bigint | null;
  currency: string | null;
  previousTotalMinor: bigint | null;
}

export function cartView(row: CartRow): CartView {
  const items = Array.isArray(row.items) ? (row.items as PricedItem[]) : [];
  const currency = row.currency ?? (items[0]?.currency ?? "NGN");
  return {
    id: row.id,
    status: row.status,
    items: items.map((item) => ({
      kind: item.kind,
      title: item.title,
      detail: item.detail,
      price: { amountMinor: item.priceMinor, currency: item.currency },
      previousPrice:
        item.previousPriceMinor === null
          ? null
          : { amountMinor: item.previousPriceMinor, currency: item.currency },
      terms: [...item.terms],
    })),
    fees: Array.isArray(row.fees) ? (row.fees as JsonRecord[]) : [],
    adjustments: Array.isArray(row.adjustments)
      ? (row.adjustments as JsonRecord[])
      : [],
    total: money(Number(row.totalMinor ?? 0n), currency),
    previousTotal:
      row.previousTotalMinor === null
        ? null
        : money(Number(row.previousTotalMinor), currency),
  };
}

export async function createCart(
  deps: TravelDeps,
  input: {
    readonly actor: Actor;
    readonly cityId: string;
    readonly items: readonly CartItemInput[];
    readonly idempotencyKey: string;
    readonly correlationId: string | null;
  },
): Promise<CartView> {
  if (input.items.length === 0) {
    throw new ContractError("validation_failed", "a cart needs at least one item");
  }

  const scoped = scopedIdempotencyKey("travel.cart", input.actor.id, input.idempotencyKey);
  const cartId = deterministicId("cart", scoped);

  const replay = await deps.db.travelCart.findUnique({ where: { id: cartId } });
  if (replay !== null) {
    return cartView(replay);
  }

  const priced: PricedItem[] = [];
  for (const item of input.items) {
    priced.push(await priceItem(deps, item));
  }

  const currency = priced[0]?.currency ?? "NGN";
  for (const item of priced) {
    if (item.currency !== currency) {
      // Each item settles in its own currency; a single cart total needs one
      // charge currency. Mixed currencies are refused rather than summed wrongly.
      throw new ContractError(
        "validation_failed",
        "cart items must settle in the same currency",
        { expected: currency, got: item.currency },
      );
    }
  }
  const totalMinor = priced.reduce((sum, item) => sum + item.priceMinor, 0);

  try {
    const created = await deps.db.travelCart.create({
      data: {
        id: cartId,
        userId: input.actor.id,
        status: "priced",
        items: toJson(priced),
        fees: toJson([]),
        totalMinor: BigInt(totalMinor),
        currency,
        idempotencyKey: scoped,
      },
    });
    return cartView(created);
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await deps.db.travelCart.findUnique({ where: { id: cartId } });
      if (existing !== null) {
        return cartView(existing);
      }
    }
    throw error;
  }
}

export async function setPassengers(
  deps: TravelDeps,
  input: {
    readonly actor: Actor;
    readonly cartId: string;
    readonly passengers: readonly JsonRecord[];
  },
): Promise<CartView> {
  const cart = await deps.db.travelCart.findUnique({ where: { id: input.cartId } });
  if (cart === null || cart.userId !== input.actor.id) {
    throw new ContractError("not_found", "no such cart", { cartId: input.cartId });
  }
  if (cart.status === "checked_out" || cart.status === "expired") {
    throw new ContractError("conflict", "this cart can no longer be edited", {
      cartId: input.cartId,
      status: cart.status,
    });
  }
  const updated = await deps.db.travelCart.update({
    where: { id: input.cartId },
    data: { passengers: toJson(input.passengers) },
  });
  return cartView(updated);
}
