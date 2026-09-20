/**
 * Unit tests for the shared utility surface — the CI unit-packages matrix
 * runs this package, so the deterministic helpers are pinned here.
 */
import { describe, expect, it } from "vitest";

import {
  formatCurrency,
  getCurrencySymbol,
  isValidCurrency,
  parseCurrency,
} from "../formatters/currency";
import { calculateSpeed, formatDistance } from "../formatters/distance";
import {
  generateOTP,
  generateReferralCode,
  generateTrackingNumber,
  toCamelCase,
  toKebabCase,
  toSnakeCase,
  toTitleCase,
  truncate,
} from "../helpers/string";

describe("string helpers", () => {
  it("truncates long strings to the maximum length with an ellipsis", () => {
    expect(truncate("short", 10)).toBe("short");
    const cut = truncate("a".repeat(20), 10);
    expect(cut).toHaveLength(10);
    expect(cut.endsWith("...")).toBe(true);
  });

  it("converts between casings", () => {
    expect(toTitleCase("hello wide world")).toBe("Hello Wide World");
    expect(toSnakeCase("rideRequestId")).toBe("ride_request_id");
    expect(toCamelCase("ride_request_id")).toBe("rideRequestId");
    expect(toKebabCase("rideRequestId")).toBe("ride-request-id");
  });

  it("generates OTPs of the requested length, digits only", () => {
    const otp = generateOTP(6);
    expect(otp).toMatch(/^\d{6}$/);
    expect(generateOTP(4)).toMatch(/^\d{4}$/);
  });

  it("generates tracking numbers and referral codes in their documented shapes", () => {
    expect(generateTrackingNumber()).toMatch(/^UBI-[A-Z0-9]+$/);
    expect(generateReferralCode()).toMatch(/^UBI[A-Z0-9]{6}$/);
  });
});

describe("currency formatting", () => {
  it("formats naira with the symbol and grouping", () => {
    const formatted = formatCurrency(5000, "NGN");
    expect(formatted).toContain("₦");
    expect(formatted).toContain("5,000");
  });

  it("round-trips through parseCurrency", () => {
    expect(parseCurrency(formatCurrency(5000, "NGN"))).toBe(5000);
  });

  it("knows its supported currency set", () => {
    expect(isValidCurrency("NGN")).toBe(true);
    expect(isValidCurrency("XXX")).toBe(false);
    expect(getCurrencySymbol("NGN")).toBe("₦");
  });
});

describe("distance formatting", () => {
  it("uses metres below a kilometre and kilometres above", () => {
    expect(formatDistance(500)).toBe("500 m");
    expect(formatDistance(1500)).toBe("1.5 km");
  });

  it("computes speed in km/h from metres and seconds", () => {
    expect(calculateSpeed(1000, 3600)).toBe(1);
    expect(calculateSpeed(12_000, 1800)).toBe(24);
  });
});
