/**
 * Utils Unit Tests
 */

import { describe, expect, it } from "vitest";
import {
  calculateOrderTotals,
  formatCurrency,
  generateId,
  generateOrderNumber,
} from "./utils";

describe("generateId", () => {
  it("should generate ID with correct prefix", () => {
    const id = generateId("ord");
    expect(id).toMatch(/^ord_[a-z0-9]{16}$/);
  });

  it("should generate unique IDs", () => {
    const id1 = generateId("test");
    const id2 = generateId("test");
    expect(id1).not.toBe(id2);
  });

  it("should work with different prefixes", () => {
    expect(generateId("menu")).toMatch(/^menu_/);
    expect(generateId("res")).toMatch(/^res_/);
    expect(generateId("item")).toMatch(/^item_/);
  });
});

describe("generateOrderNumber", () => {
  it("should generate order number in correct format", () => {
    const orderNumber = generateOrderNumber();
    expect(orderNumber).toMatch(/^UB-[A-Z0-9]+-[A-Z0-9]{4}$/);
  });

  it("should generate unique order numbers", () => {
    const num1 = generateOrderNumber();
    const num2 = generateOrderNumber();
    expect(num1).not.toBe(num2);
  });
});

describe("calculateOrderTotals", () => {
  it("should calculate correct totals for simple order", () => {
    const items = [{ totalPrice: 1000 }, { totalPrice: 500 }];

    const totals = calculateOrderTotals(items, { currency: "NGN" });

    expect(totals.subtotal).toBe(1500);
    expect(totals.serviceFee).toBe(75); // 5% of 1500
    expect(totals.tax).toBe(118); // 7.5% of (1500 + 75) = 118.125 rounded
    expect(totals.deliveryFee).toBe(0);
    expect(totals.tip).toBe(0);
    expect(totals.discount).toBe(0);
    expect(totals.total).toBe(1500 + 75 + 118);
  });

  it("should apply delivery fee", () => {
    const items = [{ totalPrice: 1000 }];
    const totals = calculateOrderTotals(items, {
      currency: "NGN",
      deliveryFee: 200,
    });

    expect(totals.deliveryFee).toBe(200);
    expect(totals.total).toBeGreaterThan(1000 + 200);
  });

  it("should apply tip", () => {
    const items = [{ totalPrice: 1000 }];
    const totals = calculateOrderTotals(items, {
      currency: "NGN",
      tip: 100,
    });

    expect(totals.tip).toBe(100);
  });

  it("should apply discount", () => {
    const items = [{ totalPrice: 1000 }];
    const totalsWithoutDiscount = calculateOrderTotals(items, {
      currency: "NGN",
    });
    const totalsWithDiscount = calculateOrderTotals(items, {
      currency: "NGN",
      discount: 200,
    });

    expect(totalsWithDiscount.discount).toBe(200);
    expect(totalsWithDiscount.total).toBe(totalsWithoutDiscount.total - 200);
  });

  it("should not return negative total", () => {
    const items = [{ totalPrice: 100 }];
    const totals = calculateOrderTotals(items, {
      currency: "NGN",
      discount: 10000,
    });

    expect(totals.total).toBe(0);
  });

  it("should use different tax rates for different currencies", () => {
    const items = [{ totalPrice: 1000 }];

    const ngnTotals = calculateOrderTotals(items, { currency: "NGN" });
    const kesTotals = calculateOrderTotals(items, { currency: "KES" });

    // Kenya has higher VAT (16%) than Nigeria (7.5%)
    expect(kesTotals.tax).toBeGreaterThan(ngnTotals.tax);
  });

  it("should handle empty items array", () => {
    const totals = calculateOrderTotals([], { currency: "NGN" });

    expect(totals.subtotal).toBe(0);
    expect(totals.serviceFee).toBe(0);
    expect(totals.tax).toBe(0);
    expect(totals.total).toBe(0);
  });
});

describe("formatCurrency", () => {
  it("should format NGN currency", () => {
    const formatted = formatCurrency(1500, "NGN");
    expect(formatted).toContain("1,500");
    // May contain ₦ symbol depending on locale support
  });

  it("should format KES currency", () => {
    const formatted = formatCurrency(1500, "KES");
    expect(formatted).toContain("1,500");
  });

  it("should handle large amounts", () => {
    const formatted = formatCurrency(1000000, "NGN");
    expect(formatted).toContain("1,000,000");
  });

  it("should handle zero", () => {
    const formatted = formatCurrency(0, "NGN");
    expect(formatted).toContain("0");
  });

  it("should handle decimal amounts", () => {
    const formatted = formatCurrency(1500.75, "NGN");
    expect(formatted).toMatch(/1,500/);
  });
});
