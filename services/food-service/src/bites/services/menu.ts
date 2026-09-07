/**
 * Menu reads.
 *
 * The public menu shows only what an approved merchant has published: an item
 * that is inactive or belongs to a merchant still in KYB review is invisible
 * here (CLAUDE.md #8 — closed/undecided merchants are not silently shown). The
 * merchant console view shows a merchant their own full menu, including the
 * items they have built but not yet published.
 */
import { ContractError } from "@ubi/contracts";

import { assertFlagEnabled } from "../city-config.js";
import { assertPermission } from "../roles.js";
import type { BitesDeps } from "../context.js";
import type { Actor, BitesTx } from "../lib/types.js";
import type { MenuItemForPricing } from "../pricing.js";

export const MERCHANT_APPROVED = "approved";

export interface OptionView {
  readonly id: string;
  readonly name: string;
  readonly priceDeltaMinor: number;
}

export interface OptionGroupView {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
  readonly minSelect: number;
  readonly maxSelect: number;
  readonly options: readonly OptionView[];
}

export interface MenuItemView {
  readonly id: string;
  readonly category: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly priceMinor: number;
  readonly currency: string;
  readonly allergens: readonly string[];
  readonly active: boolean;
  readonly soldOut: boolean;
  readonly optionGroups: readonly OptionGroupView[];
}

export interface OutletMenuView {
  readonly outletId: string;
  readonly open: boolean;
  readonly items: readonly MenuItemView[];
}

export interface MerchantMenuView {
  readonly merchantId: string;
  readonly tradeName: string | null;
  readonly status: string;
  readonly outlets: readonly OutletMenuView[];
}

type ItemWithGroups = {
  id: string;
  category: string | null;
  name: string;
  description: string | null;
  priceMinor: bigint;
  currency: string;
  allergens: string[];
  active: boolean;
  soldOutUntil: Date | null;
  optionGroups: {
    id: string;
    name: string;
    required: boolean;
    minSelect: number;
    maxSelect: number;
    options: { id: string; name: string; priceDeltaMinor: bigint }[];
  }[];
};

function toItemView(item: ItemWithGroups, now: Date): MenuItemView {
  return {
    id: item.id,
    category: item.category,
    name: item.name,
    description: item.description,
    priceMinor: Number(item.priceMinor),
    currency: item.currency,
    allergens: item.allergens,
    active: item.active,
    soldOut: item.soldOutUntil !== null && item.soldOutUntil.getTime() > now.getTime(),
    optionGroups: item.optionGroups.map((group) => ({
      id: group.id,
      name: group.name,
      required: group.required,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      options: group.options.map((option) => ({
        id: option.id,
        name: option.name,
        priceDeltaMinor: Number(option.priceDeltaMinor),
      })),
    })),
  };
}

/** Loads a single item priced for the cart. Returns null when it does not exist. */
export async function loadItemForPricing(
  tx: BitesTx,
  itemId: string,
): Promise<(MenuItemForPricing & { readonly outletId: string }) | null> {
  const item = await tx.bitesMenuItem.findUnique({
    where: { id: itemId },
    include: { optionGroups: { include: { options: true } } },
  });
  if (item === null) {
    return null;
  }
  return {
    id: item.id,
    name: item.name,
    currency: item.currency,
    priceMinor: Number(item.priceMinor),
    active: item.active,
    soldOutUntil: item.soldOutUntil,
    outletId: item.outletId,
    optionGroups: item.optionGroups.map((group) => ({
      id: group.id,
      name: group.name,
      required: group.required,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      options: group.options.map((option) => ({
        id: option.id,
        name: option.name,
        priceDeltaMinor: Number(option.priceDeltaMinor),
      })),
    })),
  };
}

/** The public menu for a merchant: approved merchant, active items only. */
export async function getPublicMenu(
  deps: BitesDeps,
  cityId: string,
  merchantId: string,
): Promise<MerchantMenuView> {
  const { flags } = await deps.config.load(cityId);
  assertFlagEnabled(flags, "bites");

  const merchant = await deps.db.bitesMerchant.findUnique({
    where: { id: merchantId },
  });
  if (merchant === null || merchant.status !== MERCHANT_APPROVED) {
    // An unapproved merchant is invisible rather than forbidden (CLAUDE.md #8).
    throw new ContractError("not_found", "that merchant is not available");
  }

  const outlets = await deps.db.outlet.findMany({
    where: { merchantId },
    include: {
      menuItems: {
        where: { active: true },
        include: { optionGroups: { include: { options: true } } },
      },
    },
  });

  const now = deps.now();
  return {
    merchantId,
    tradeName: merchant.tradeName,
    status: merchant.status,
    outlets: outlets.map((outlet) => ({
      outletId: outlet.id,
      open: outlet.open,
      items: outlet.menuItems.map((item) => toItemView(item, now)),
    })),
  };
}

/** The merchant console view of their own menu, including unpublished items. */
export async function getConsoleMenu(
  deps: BitesDeps,
  actor: Actor,
  merchantId: string,
): Promise<MerchantMenuView> {
  assertPermission(actor.role, "merchant.manage");
  if (actor.id !== merchantId && actor.role !== "ops_admin") {
    throw new ContractError("forbidden", "you may only read your own menu");
  }
  const merchant = await deps.db.bitesMerchant.findUnique({
    where: { id: merchantId },
  });
  if (merchant === null) {
    throw new ContractError("not_found", "no such merchant");
  }
  const outlets = await deps.db.outlet.findMany({
    where: { merchantId },
    include: {
      menuItems: { include: { optionGroups: { include: { options: true } } } },
    },
  });
  const now = deps.now();
  return {
    merchantId,
    tradeName: merchant.tradeName,
    status: merchant.status,
    outlets: outlets.map((outlet) => ({
      outletId: outlet.id,
      open: outlet.open,
      items: outlet.menuItems.map((item) => toItemView(item, now)),
    })),
  };
}
