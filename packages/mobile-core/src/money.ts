// Formatting only. Money is never computed on the client (launch CLAUDE.md #1).
import type { CityConfig } from "@ubi/contracts";
import type { Money } from "./api";
export type MoneyFormat = {
  currencySymbol: string;
  minorDigitsShown: number;
  locale: string;
  currency?: string;
  currencyFractionDigits?: number;
};
const DEFAULT: MoneyFormat = {
  currencySymbol: "₦",
  minorDigitsShown: 0,
  locale: "en-NG",
  currency: "NGN",
  currencyFractionDigits: 2,
};

export function currencySymbolFor(currency: string, locale = "en-NG"): string {
  if (currency === "NGN") return "₦";
  try {
    const part = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value;
    if (part) return part;
  } catch {
    // Fallback below if Intl fails on an unfamiliar locale/currency tag.
  }
  return currency + " ";
}

export function moneyFormatFor(
  config?: Pick<
    CityConfig,
    "currency" | "currencyFractionDigits" | "locale"
  > | null,
): MoneyFormat {
  if (!config) return DEFAULT;
  return {
    currencySymbol: currencySymbolFor(config.currency, config.locale),
    minorDigitsShown: 0,
    locale: config.locale,
    currency: config.currency,
    currencyFractionDigits: config.currencyFractionDigits,
  };
}

export function formatMinor(
  m: Money | undefined | null,
  fmt: Partial<MoneyFormat> = {},
  opts: { signed?: boolean } = {},
): string {
  if (!m) return "—";
  const locale = fmt.locale ?? DEFAULT.locale;
  const currencySymbol =
    fmt.currencySymbol ??
    (fmt.currency
      ? currencySymbolFor(fmt.currency, locale)
      : DEFAULT.currencySymbol);
  const fractionDigits =
    fmt.currencyFractionDigits ?? DEFAULT.currencyFractionDigits ?? 2;
  const minorDigitsShown = fmt.minorDigitsShown ?? DEFAULT.minorDigitsShown;
  const divisor = 10 ** fractionDigits;
  const negative = m.amountMinor < 0;
  const abs = Math.abs(m.amountMinor);
  const major = Math.floor(abs / divisor);
  const minor = abs % divisor;
  const grouped = major.toLocaleString(locale);
  const digits =
    fractionDigits > 0 && (minorDigitsShown > 0 || minor !== 0)
      ? "." + String(minor).padStart(fractionDigits, "0")
      : "";
  const sign = negative ? "−" : opts.signed ? "+" : "";
  return sign + currencySymbol + grouped + digits;
}
export function bpsToPercent(bps: number): string {
  const v = bps / 100;
  return (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)) + "%";
}
export function accessibleMoney(
  m: Money | undefined,
  currencyName = "naira",
): string {
  if (!m) return "amount unavailable";
  const major = Math.floor(Math.abs(m.amountMinor) / 100);
  return (
    (m.amountMinor < 0 ? "minus " : "") +
    major.toLocaleString("en-NG") +
    " " +
    currencyName
  );
}
