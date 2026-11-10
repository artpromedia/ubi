// Typed-amount packaging for the driver cash-out form (CC-B03 / P0-03).
// Pure input packaging, never pricing or fee/commission arithmetic: digits
// typed in whole major currency units are packaged into a Money object using
// the city's minor-unit scale, and the server validates all bounds and limits.
import type { Money } from "@ubi/mobile-core";

export const typedMajorToMoney = (
  raw: string,
  currency: string,
  fractionDigits = 2,
): Money | null => {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const parsed = parseInt(digits, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  const scale = Math.pow(10, fractionDigits);
  const amountMinor = Math.round(parsed * scale);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  return { amountMinor, currency };
};

export const typedDigits = (raw: string): string =>
  raw.replace(/\D/g, "").slice(0, 9);
