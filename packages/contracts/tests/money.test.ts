import { describe, expect, it } from "vitest";

import {
  CurrencyMismatchError,
  addMoney,
  compareMoney,
  formatMoney,
  money,
  moneyAccessibilityLabel,
  splitPercent,
  subtractMoney,
  sumMoney,
  zero,
} from "../src/money";

const NGN = { locale: "en-NG", fractionDigits: 2 };

describe("money", () => {
  it("only accepts integer minor units", () => {
    expect(() => money(3100.5, "NGN")).toThrow(TypeError);
    expect(money(310_000, "NGN")).toEqual({
      amountMinor: 310_000,
      currency: "NGN",
    });
  });

  it("refuses to mix currencies", () => {
    expect(() => addMoney(money(100, "NGN"), money(100, "KES"))).toThrow(
      CurrencyMismatchError,
    );
    expect(() => subtractMoney(money(100, "NGN"), money(100, "USD"))).toThrow(
      CurrencyMismatchError,
    );
    expect(() => compareMoney(money(100, "NGN"), money(100, "GHS"))).toThrow(
      CurrencyMismatchError,
    );
  });

  it("sums an empty list to zero of the given currency", () => {
    expect(sumMoney([], "NGN")).toEqual(zero("NGN"));
  });

  it("splits a percentage without losing minor units", () => {
    const fare = money(310_000, "NGN");
    const { part, remainder } = splitPercent(fare, 20);
    expect(part.amountMinor).toBe(62_000);
    expect(remainder.amountMinor).toBe(248_000);
    expect(addMoney(part, remainder)).toEqual(fare);
  });

  it("keeps the rounding remainder explicit so a journal still balances", () => {
    const fare = money(333, "NGN");
    const { part, remainder } = splitPercent(fare, 20);
    expect(part.amountMinor).toBe(67);
    expect(remainder.amountMinor).toBe(266);
    expect(part.amountMinor + remainder.amountMinor).toBe(fare.amountMinor);
  });

  it("rounds half away from zero for negative amounts too", () => {
    const reversal = money(-333, "NGN");
    const { part, remainder } = splitPercent(reversal, 20);
    expect(part.amountMinor).toBe(-67);
    expect(remainder.amountMinor).toBe(-266);
  });

  it("rejects out-of-range percentages", () => {
    expect(() => splitPercent(money(100, "NGN"), -1)).toThrow(RangeError);
    expect(() => splitPercent(money(100, "NGN"), 101)).toThrow(RangeError);
    expect(() => splitPercent(money(100, "NGN"), Number.NaN)).toThrow(
      RangeError,
    );
  });

  it("formats from the currency it is given, never a hard-coded market", () => {
    expect(formatMoney(money(310_000, "NGN"), NGN)).toContain("3,100.00");
    const kes = formatMoney(money(310_000, "KES"), {
      locale: "en-KE",
      fractionDigits: 2,
    });
    expect(kes).toContain("3,100.00");
    expect(kes).not.toEqual(formatMoney(money(310_000, "NGN"), NGN));
  });

  it("respects a market with no minor unit", () => {
    expect(
      formatMoney(money(3100, "JPY"), { locale: "ja-JP", fractionDigits: 0 }),
    ).toContain("3,100");
  });

  it("announces money with its currency for screen readers", () => {
    expect(moneyAccessibilityLabel(money(310_000, "NGN"), NGN)).toBe(
      "3,100.00 NGN",
    );
  });
});
