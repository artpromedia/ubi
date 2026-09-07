/**
 * Pure pricing rules: option validation and the server-side recompute. No
 * database — these lock the arithmetic and the guard logic in place.
 */
import { describe, expect, it } from "vitest";

import { ContractError } from "@ubi/contracts";

import {
  assertAddable,
  isSoldOut,
  priceLine,
  priceSelection,
  subtotalOf,
  type MenuItemForPricing,
} from "../../src/bites/pricing";

function item(overrides: Partial<MenuItemForPricing> = {}): MenuItemForPricing {
  return {
    id: "item_1",
    name: "Jollof Rice",
    currency: "NGN",
    priceMinor: 250_000,
    active: true,
    soldOutUntil: null,
    optionGroups: [],
    ...overrides,
  };
}

describe("option validation", () => {
  const withRequiredProtein: MenuItemForPricing = item({
    optionGroups: [
      {
        id: "g_protein",
        name: "Protein",
        required: true,
        minSelect: 1,
        maxSelect: 1,
        options: [
          { id: "o_chicken", name: "Chicken", priceDeltaMinor: 100_000 },
          { id: "o_beef", name: "Beef", priceDeltaMinor: 150_000 },
        ],
      },
      {
        id: "g_extras",
        name: "Extras",
        required: false,
        minSelect: 0,
        maxSelect: 2,
        options: [{ id: "o_plantain", name: "Plantain", priceDeltaMinor: 50_000 }],
      },
    ],
  });

  it("rejects an unmet required group", () => {
    expect(() => priceSelection(withRequiredProtein, [])).toThrowError(ContractError);
    try {
      priceSelection(withRequiredProtein, []);
    } catch (error) {
      expect((error as ContractError).code).toBe("validation_failed");
      expect((error as ContractError).details?.groupId).toBe("g_protein");
    }
  });

  it("rejects more selections than a group allows", () => {
    try {
      priceSelection(withRequiredProtein, ["o_chicken", "o_beef"]);
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ContractError);
      expect((error as ContractError).code).toBe("validation_failed");
      expect((error as ContractError).details?.maxSelect).toBe(1);
    }
  });

  it("rejects an option that does not belong to the item", () => {
    try {
      priceSelection(withRequiredProtein, ["o_not_here"]);
      throw new Error("expected a rejection");
    } catch (error) {
      expect((error as ContractError).code).toBe("validation_failed");
    }
  });

  it("prices base + selected option deltas", () => {
    const { unitPrice, options } = priceSelection(withRequiredProtein, [
      "o_beef",
      "o_plantain",
    ]);
    // 250,000 + 150,000 (beef) + 50,000 (plantain)
    expect(unitPrice.amountMinor).toBe(450_000);
    expect(unitPrice.currency).toBe("NGN");
    expect(options.map((o) => o.optionId).sort()).toEqual(["o_beef", "o_plantain"]);
  });

  it("accepts a required group met with exactly one selection", () => {
    const { unitPrice } = priceSelection(withRequiredProtein, ["o_chicken"]);
    expect(unitPrice.amountMinor).toBe(350_000);
  });
});

describe("sold-out and inactive items", () => {
  it("treats a future sold-out window as sold out", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const soldOut = item({ soldOutUntil: new Date("2026-01-01T13:00:00Z") });
    expect(isSoldOut(soldOut, now)).toBe(true);
    expect(() => assertAddable(soldOut, now)).toThrowError(ContractError);
  });

  it("treats a past sold-out window as available", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const backInStock = item({ soldOutUntil: new Date("2026-01-01T11:00:00Z") });
    expect(isSoldOut(backInStock, now)).toBe(false);
    expect(() => assertAddable(backInStock, now)).not.toThrow();
  });

  it("refuses an inactive item", () => {
    const now = new Date();
    try {
      assertAddable(item({ active: false }), now);
      throw new Error("expected a rejection");
    } catch (error) {
      expect((error as ContractError).code).toBe("conflict");
    }
  });
});

describe("line and subtotal arithmetic", () => {
  it("multiplies unit price by quantity and sums lines", () => {
    const plain = item();
    const line = priceLine(plain, 3, [], "line_1");
    expect(line.unitPriceMinor).toBe(250_000);
    expect(line.lineTotalMinor).toBe(750_000);
    const subtotal = subtotalOf([line], "NGN");
    expect(subtotal.amountMinor).toBe(750_000);
  });
});
