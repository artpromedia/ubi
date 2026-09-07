/**
 * The cart.
 *
 * CLAUDE.md #1: the price is recomputed on the server from the merchant's menu
 * and the selected options. A `priceMinor` on the request body is not read at
 * all — the field does not exist on the input schema — so a client that lies
 * about the price simply has its lie ignored.
 *
 * A cart holds one merchant's items only (slice 05 guard: "single-merchant
 * cart"): an item from a different outlet is refused with `conflict`. A sold-out
 * or inactive item is not addable.
 */
import { ContractError } from "@ubi/contracts";

import { assertFlagEnabled } from "../city-config.js";
import { generateId } from "../lib/ids.js";
import {
  assertAddable,
  lineSignature,
  parseLines,
  priceLine,
  subtotalOf,
  type PricedLine,
} from "../pricing.js";
import { assertPermission } from "../roles.js";
import { loadItemForPricing } from "./menu.js";

import type { BitesDeps } from "../context.js";
import type { Actor } from "../lib/types.js";

export interface AddItemParams {
  readonly actor: Actor;
  readonly cityId: string;
  readonly cartId: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly optionIds: readonly string[];
  readonly correlationId: string | null;
}

export interface CartView {
  readonly cartId: string;
  readonly outletId: string;
  readonly currency: string;
  readonly subtotalMinor: number;
  readonly lines: readonly PricedLine[];
}

function linesToJson(lines: readonly PricedLine[]): unknown {
  return lines.map((line) => ({
    lineId: line.lineId,
    itemId: line.itemId,
    name: line.name,
    quantity: line.quantity,
    currency: line.currency,
    unitBaseMinor: line.unitBaseMinor,
    options: line.options.map((option) => ({
      optionId: option.optionId,
      groupId: option.groupId,
      name: option.name,
      priceDeltaMinor: option.priceDeltaMinor,
    })),
    unitPriceMinor: line.unitPriceMinor,
    lineTotalMinor: line.lineTotalMinor,
  }));
}

export async function addItem(
  deps: BitesDeps,
  params: AddItemParams,
): Promise<CartView> {
  assertPermission(params.actor.role, "cart.write");
  const { flags } = await deps.config.load(params.cityId);
  assertFlagEnabled(flags, "bites");

  const now = deps.now();

  return deps.db.$transaction(async (tx) => {
    const item = await loadItemForPricing(tx, params.itemId);
    if (item === null) {
      throw new ContractError("not_found", "no such menu item");
    }
    // Sold-out / inactive items are not addable (slice 05 guard).
    assertAddable(item, now);

    const existingCart = await tx.cart.findUnique({
      where: { id: params.cartId },
    });

    if (existingCart !== null && existingCart.userId !== params.actor.id) {
      throw new ContractError("forbidden", "that cart belongs to someone else");
    }
    if (existingCart !== null && existingCart.outletId !== item.outletId) {
      // Single-merchant cart: an item from another outlet cannot join this cart.
      throw new ContractError(
        "conflict",
        "a cart can hold one merchant's items only",
        {
          cartOutletId: existingCart.outletId,
          itemOutletId: item.outletId,
        },
      );
    }

    const priced = priceLine(
      item,
      params.quantity,
      params.optionIds,
      generateId("line"),
    );
    const currentLines =
      existingCart === null ? [] : parseLines(existingCart.items);

    // Merge an identical item+option selection instead of duplicating the line.
    const signature = lineSignature(params.itemId, params.optionIds);
    const merged: PricedLine[] = [];
    let mergedInto = false;
    for (const line of currentLines) {
      const lineSig = lineSignature(
        line.itemId,
        line.options.map((option) => option.optionId),
      );
      if (lineSig === signature && !mergedInto) {
        const quantity = line.quantity + priced.quantity;
        merged.push({
          ...line,
          quantity,
          unitPriceMinor: priced.unitPriceMinor,
          unitBaseMinor: priced.unitBaseMinor,
          lineTotalMinor: priced.unitPriceMinor * quantity,
        });
        mergedInto = true;
      } else {
        merged.push(line);
      }
    }
    if (!mergedInto) {
      merged.push(priced);
    }

    const subtotal = subtotalOf(merged, item.currency);
    const itemsJson = linesToJson(merged);

    if (existingCart === null) {
      await tx.cart.create({
        data: {
          id: params.cartId,
          userId: params.actor.id,
          outletId: item.outletId,
          items: itemsJson as never,
          subtotalMinor: BigInt(subtotal.amountMinor),
          currency: item.currency,
        },
      });
    } else {
      await tx.cart.update({
        where: { id: params.cartId },
        data: {
          items: itemsJson as never,
          subtotalMinor: BigInt(subtotal.amountMinor),
        },
      });
    }

    return {
      cartId: params.cartId,
      outletId: item.outletId,
      currency: item.currency,
      subtotalMinor: subtotal.amountMinor,
      lines: merged,
    };
  });
}

export async function getCart(
  deps: BitesDeps,
  actor: Actor,
  cartId: string,
): Promise<CartView> {
  const cart = await deps.db.cart.findUnique({ where: { id: cartId } });
  if (cart === null) {
    throw new ContractError("not_found", "no such cart");
  }
  if (cart.userId !== actor.id) {
    throw new ContractError("forbidden", "that cart belongs to someone else");
  }
  return {
    cartId: cart.id,
    outletId: cart.outletId,
    currency: cart.currency,
    subtotalMinor: Number(cart.subtotalMinor),
    lines: parseLines(cart.items),
  };
}
