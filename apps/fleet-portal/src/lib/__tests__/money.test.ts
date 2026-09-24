import { describe, expect, it } from "vitest";

import {
  currencyExponent,
  formatMinor,
  formatMoney,
  parseMajorToMinor,
} from "../money";

describe("formatMinor — places the server's decimal point, never computes", () => {
  it("formats integer minor units with the ISO exponent", () => {
    expect(formatMinor(1_234_567, "NGN")).toBe("₦12,345.67");
    expect(formatMinor(4_500_000, "NGN")).toBe("₦45,000.00");
    expect(formatMinor(5, "NGN")).toBe("₦0.05");
    expect(formatMinor(0, "NGN")).toBe("₦0.00");
    expect(formatMinor(-12_345, "NGN")).toBe("−₦123.45");
    expect(formatMinor(1500, "RWF")).toBe("RF 1,500");
    expect(formatMinor(1234, "KWD")).toBe("KWD 1.234");
  });

  it("fails closed on anything the server could not have meant", () => {
    expect(formatMinor(12.5, "NGN")).toBe("—");
    expect(formatMinor(Number.MAX_SAFE_INTEGER + 2, "NGN")).toBe("—");
    expect(formatMinor("100", "NGN")).toBe("—");
    expect(formatMinor(100, "ngn")).toBe("—");
    expect(formatMinor(100, "ZZZ")).toBe("—");
    expect(formatMinor(100, undefined)).toBe("—");
    expect(formatMoney(null)).toBe("—");
    expect(currencyExponent("NGN")).toBe(2);
  });

  it("keeps every digit of the server's integer", () => {
    for (const value of [1, 99, 100, 101, 987_654_321, 15_000_000]) {
      const shown = formatMinor(value, "NGN").replace(/[^\d]/g, "");
      expect(shown.replace(/^0+/, "")).toBe(String(value));
    }
  });
});

describe("parseMajorToMinor — the one typed amount, by string rules only", () => {
  it("moves typed digits into minor units", () => {
    expect(parseMajorToMinor("40,000", "NGN")).toBe(4_000_000);
    expect(parseMajorToMinor("40000.5", "NGN")).toBe(4_000_050);
    expect(parseMajorToMinor(" 40,000.50 ", "NGN")).toBe(4_000_050);
    expect(parseMajorToMinor("0.07", "NGN")).toBe(7);
    expect(parseMajorToMinor("1500", "RWF")).toBe(1500);
  });

  it("refuses what it would have to round or guess", () => {
    expect(parseMajorToMinor("40,000.505", "NGN")).toBeNull();
    expect(parseMajorToMinor("1.5", "RWF")).toBeNull();
    expect(parseMajorToMinor("4,00", "NGN")).toBeNull();
    expect(parseMajorToMinor("-5", "NGN")).toBeNull();
    expect(parseMajorToMinor("1e5", "NGN")).toBeNull();
    expect(parseMajorToMinor("0", "NGN")).toBeNull();
    expect(parseMajorToMinor("", "NGN")).toBeNull();
    expect(parseMajorToMinor("100", "ZZZ")).toBeNull();
  });

  it("round-trips with formatMinor", () => {
    for (const typed of ["1", "12.34", "45,000", "150,000.00"]) {
      const minor = parseMajorToMinor(typed, "NGN");
      expect(minor).not.toBeNull();
      expect(formatMinor(minor, "NGN").replace(/[₦,]/g, "")).toBe(
        typed.replace(/,/g, "").includes(".")
          ? typed.replace(/,/g, "")
          : `${typed.replace(/,/g, "")}.00`,
      );
    }
  });
});
