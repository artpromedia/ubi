/**
 * Supplier decimals → integer minor units (CLAUDE.md #1): exact, by the
 * currency's ISO 4217 exponent, never through float arithmetic, and refused
 * rather than rounded when a currency cannot hold the amount.
 */
import { describe, expect, it } from "vitest";

import {
  currencyExponent,
  decimalToMinor,
  minorToDecimal,
  SupplierAmountError,
} from "../src/adapters/money";

describe("decimalToMinor", () => {
  it.each([
    ["45.00", "GBP", 4_500],
    ["45.5", "GBP", 4_550],
    ["0.01", "USD", 1],
    ["90.80", "GBP", 9_080],
    ["1234567.89", "NGN", 123_456_789],
    ["45.000", "GBP", 4_500], // trailing zeros beyond the exponent are harmless
    ["1500", "JPY", 1_500], // exponent 0
    ["12.345", "KWD", 12_345], // exponent 3
    ["-15.50", "GBP", -1_550], // a refund / negative change total
    ["0.00", "EUR", 0],
  ] as const)("%s %s → %i", (raw, currency, expected) => {
    expect(decimalToMinor(raw, currency)).toBe(expected);
  });

  it.each([
    [163.66, "USD", 16_366],
    [43.61, "USD", 4_361],
    [0.1, "USD", 10],
    [115, "USD", 11_500],
    [1.1, "EUR", 110], // 1.1 * 100 is 110.00000000000001 in float; never computed that way
    [4.35, "USD", 435], // 4.35 * 100 is 434.99999999999994 in float
  ] as const)(
    "JSON number %d %s → %i without float multiplication",
    (raw, currency, expected) => {
      expect(decimalToMinor(raw, currency)).toBe(expected);
    },
  );

  it.each([
    ["45.001", "GBP"], // more precision than GBP holds
    ["1500.5", "JPY"],
    ["12.3456", "KWD"],
    ["1e3", "USD"],
    ["abc", "USD"],
    ["", "USD"],
    ["12,50", "EUR"],
  ] as const)("refuses %s %s rather than round", (raw, currency) => {
    expect(() => decimalToMinor(raw, currency)).toThrow(SupplierAmountError);
  });

  it("refuses non-finite and exponent-form numbers, and amounts beyond safe integers", () => {
    expect(() => decimalToMinor(Number.NaN, "USD")).toThrow(
      SupplierAmountError,
    );
    expect(() => decimalToMinor(Number.POSITIVE_INFINITY, "USD")).toThrow(
      SupplierAmountError,
    );
    expect(() => decimalToMinor(1e21, "USD")).toThrow(SupplierAmountError);
    expect(() => decimalToMinor(0.0000001, "USD")).toThrow(SupplierAmountError);
    expect(() => decimalToMinor("90071992547409.93", "USD")).toThrow(
      SupplierAmountError,
    );
    expect(() => decimalToMinor("1.00", "usd")).toThrow(SupplierAmountError);
  });
});

describe("minorToDecimal and exponents", () => {
  it("round-trips the exact decimal a supplier expects", () => {
    expect(minorToDecimal(4_500, "GBP")).toBe("45.00");
    expect(minorToDecimal(3_050, "GBP")).toBe("30.50");
    expect(minorToDecimal(5, "USD")).toBe("0.05");
    expect(minorToDecimal(-1_550, "GBP")).toBe("-15.50");
    expect(minorToDecimal(1_500, "JPY")).toBe("1500");
    expect(minorToDecimal(12_345, "KWD")).toBe("12.345");
    for (const [raw, currency] of [
      ["45.00", "GBP"],
      ["0.05", "USD"],
      ["12.345", "KWD"],
    ] as const) {
      expect(minorToDecimal(decimalToMinor(raw, currency), currency)).toBe(raw);
    }
  });

  it("uses ISO 4217 exponents, not a blanket two decimals", () => {
    expect(currencyExponent("NGN")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("XOF")).toBe(0);
    expect(currencyExponent("BHD")).toBe(3);
    expect(currencyExponent("CLF")).toBe(4);
  });
});
