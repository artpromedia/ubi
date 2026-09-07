/**
 * Cart and order pricing.
 *
 * CLAUDE.md #1 and #4: the client renders money, it never computes it. Every
 * price here is recomputed from the merchant's own `BitesMenuItem.priceMinor`
 * and the selected `MenuOption.priceDeltaMinor`; a price on the request body is
 * never read. The option rules — which groups are required, how few and how many
 * options each allows — are enforced here so an incomplete or over-filled
 * selection is refused before it reaches the cart.
 */
import { addMoney, money, sumMoney, type Money, ContractError } from "@ubi/contracts";
import { z } from "zod";

export interface OptionForPricing {
  readonly id: string;
  readonly name: string;
  readonly priceDeltaMinor: number;
}

export interface OptionGroupForPricing {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
  readonly minSelect: number;
  readonly maxSelect: number;
  readonly options: readonly OptionForPricing[];
}

export interface MenuItemForPricing {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly priceMinor: number;
  readonly active: boolean;
  readonly soldOutUntil: Date | null;
  readonly optionGroups: readonly OptionGroupForPricing[];
}

export interface SelectedOption {
  readonly optionId: string;
  readonly groupId: string;
  readonly name: string;
  readonly priceDeltaMinor: number;
}

export interface PricedLine {
  readonly lineId: string;
  readonly itemId: string;
  readonly name: string;
  readonly quantity: number;
  readonly currency: string;
  /** The menu base price at the time the line was priced, minor units. */
  readonly unitBaseMinor: number;
  readonly options: readonly SelectedOption[];
  /** base + selected option deltas, minor units. */
  readonly unitPriceMinor: number;
  /** unitPriceMinor * quantity, minor units. */
  readonly lineTotalMinor: number;
}

/** An item is not addable while it is inactive or sold out for a window not yet past. */
export function isSoldOut(item: MenuItemForPricing, now: Date): boolean {
  return item.soldOutUntil !== null && item.soldOutUntil.getTime() > now.getTime();
}

export function assertAddable(item: MenuItemForPricing, now: Date): void {
  if (!item.active) {
    throw new ContractError("conflict", "that item is not available", {
      itemId: item.id,
      reason: "inactive",
    });
  }
  if (isSoldOut(item, now)) {
    throw new ContractError("conflict", "that item is sold out", {
      itemId: item.id,
      reason: "sold_out",
      soldOutUntil: item.soldOutUntil?.toISOString() ?? null,
    });
  }
}

/**
 * Validates the selected options against the item's groups and returns them
 * priced from the merchant's own deltas. Throws `validation_failed` when a
 * required group is unmet, a group has too many selections, or an option does
 * not belong to the item.
 */
export function priceSelection(
  item: MenuItemForPricing,
  optionIds: readonly string[],
): { readonly unitPrice: Money; readonly options: readonly SelectedOption[] } {
  const optionToGroup = new Map<string, { group: OptionGroupForPricing; option: OptionForPricing }>();
  for (const group of item.optionGroups) {
    for (const option of group.options) {
      optionToGroup.set(option.id, { group, option });
    }
  }

  const selected: SelectedOption[] = [];
  const countByGroup = new Map<string, number>();
  for (const optionId of optionIds) {
    const found = optionToGroup.get(optionId);
    if (found === undefined) {
      throw new ContractError(
        "validation_failed",
        "an option does not belong to that item",
        { itemId: item.id, optionId },
      );
    }
    selected.push({
      optionId: found.option.id,
      groupId: found.group.id,
      name: found.option.name,
      priceDeltaMinor: found.option.priceDeltaMinor,
    });
    countByGroup.set(found.group.id, (countByGroup.get(found.group.id) ?? 0) + 1);
  }

  for (const group of item.optionGroups) {
    const count = countByGroup.get(group.id) ?? 0;
    const minRequired = group.required ? Math.max(group.minSelect, 1) : group.minSelect;
    if (count < minRequired) {
      throw new ContractError(
        "validation_failed",
        "a required option group is not satisfied",
        {
          itemId: item.id,
          groupId: group.id,
          group: group.name,
          minSelect: minRequired,
          selected: count,
        },
      );
    }
    if (count > group.maxSelect) {
      throw new ContractError(
        "validation_failed",
        "too many options selected for a group",
        {
          itemId: item.id,
          groupId: group.id,
          group: group.name,
          maxSelect: group.maxSelect,
          selected: count,
        },
      );
    }
  }

  const base = money(item.priceMinor, item.currency);
  const deltas = selected.map((option) => money(option.priceDeltaMinor, item.currency));
  const unitPrice = addMoney(base, sumMoney(deltas, item.currency));
  return { unitPrice, options: selected };
}

/**
 * Prices one cart line. `quantity` is validated by the caller's schema; the
 * money is recomputed here from the merchant's data, never from the request.
 */
export function priceLine(
  item: MenuItemForPricing,
  quantity: number,
  optionIds: readonly string[],
  lineId: string,
): PricedLine {
  const { unitPrice, options } = priceSelection(item, optionIds);
  return {
    lineId,
    itemId: item.id,
    name: item.name,
    quantity,
    currency: item.currency,
    unitBaseMinor: item.priceMinor,
    options,
    unitPriceMinor: unitPrice.amountMinor,
    lineTotalMinor: unitPrice.amountMinor * quantity,
  };
}

/** The subtotal of a set of lines, in the given currency. */
export function subtotalOf(lines: readonly PricedLine[], currency: string): Money {
  return sumMoney(
    lines.map((line) => money(line.lineTotalMinor, currency)),
    currency,
  );
}

const SelectedOptionSchema = z.object({
  optionId: z.string(),
  groupId: z.string(),
  name: z.string(),
  priceDeltaMinor: z.number().int(),
});

const PricedLineSchema = z.object({
  lineId: z.string(),
  itemId: z.string(),
  name: z.string(),
  quantity: z.number().int().positive(),
  currency: z.string(),
  unitBaseMinor: z.number().int(),
  options: z.array(SelectedOptionSchema),
  unitPriceMinor: z.number().int(),
  lineTotalMinor: z.number().int(),
});

/**
 * Parses the JSON `items` column back into typed lines. The rows were written
 * by this module, so a shape mismatch is a data-integrity fault, not a client
 * error — it surfaces as an internal error rather than being silently coerced.
 */
export function parseLines(value: unknown): PricedLine[] {
  const parsed = z.array(PricedLineSchema).safeParse(value);
  if (!parsed.success) {
    throw new ContractError("internal_error", "stored cart/order lines are malformed");
  }
  return parsed.data;
}

/** A stable signature for a line's item + options, so identical lines merge. */
export function lineSignature(itemId: string, optionIds: readonly string[]): string {
  return `${itemId}|${[...optionIds].sort().join(",")}`;
}

