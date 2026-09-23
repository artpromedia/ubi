// Typed-amount packaging for the Book for Later forms — the ONE place the A02/A03 rider
// screens turn digits a person typed into a Money value. It is input packaging, not
// pricing: nothing here adds, discounts or compares amounts, and the server validates
// every packaged amount against its own bounds (fare_out_of_bounds carries its own
// sentence, which the screen shows verbatim). Minor units follow the server's own
// (kobo: two minor digits), exactly like the fare editor's typed input.
import type { Money } from "@ubi/mobile-core";

/** "12,500" typed in whole naira → { amountMinor: 1250000, currency }; nothing typed → null. */
export const typedMajorToMoney = (
  raw: string,
  currency: string,
): Money | null => {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  return { amountMinor: parseInt(digits, 10) * 100, currency };
};

/** Keeps only the digits a whole-naira amount field accepts. */
export const typedDigits = (raw: string) => raw.replace(/\D/g, "").slice(0, 9);
