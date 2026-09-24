/**
 * Display (and entry) of SERVER money: integer minor units + ISO currency.
 *
 * The portal never computes money. Amounts it shows — a proposal's weekly
 * remittance, the city cap, a week's gross / UBI commission / remittance —
 * are the server's integers, and this module only places the decimal point
 * by string manipulation using the currency's ISO 4217 exponent: no
 * division, no multiplication, no rounding, no float. A value that is not a
 * safe integer, or a currency that is not a real ISO code, renders "—"
 * (fail closed) instead of a guess.
 *
 * `parseMajorToMinor` is the inverse for the ONE amount a fleet types (an
 * owner's proposed weekly remittance): the typed digits are moved into minor
 * units by the same string rules, and fleet-service decides whether the
 * amount is allowed (the city cap is its check, never the portal's).
 * `money-guard.test.ts` fails the build if arithmetic on a money value
 * appears anywhere in the portal's source.
 */

import type { Money } from "./fleet-types";

const SYMBOLS: Readonly<Record<string, string>> = {
  NGN: "₦",
  GHS: "GH₵",
  KES: "KSh ",
  ZAR: "R ",
  RWF: "RF ",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

export const isMinorAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

const CURRENCY_RE = /^[A-Z]{3}$/;

const KNOWN_CURRENCIES: ReadonlySet<string> | null = (() => {
  try {
    return typeof Intl.supportedValuesOf === "function"
      ? new Set(Intl.supportedValuesOf("currency"))
      : null;
  } catch {
    return null;
  }
})();

/** ISO 4217 exponent (NGN 2, RWF 0, KWD 3), or null for an unknown code. */
export function currencyExponent(currency: string): number | null {
  if (
    !CURRENCY_RE.test(currency) ||
    (KNOWN_CURRENCIES !== null && !KNOWN_CURRENCIES.has(currency))
  ) {
    return null;
  }
  try {
    const digits = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits;
    return typeof digits === "number" ? digits : null;
  } catch {
    return null;
  }
}

const group = (digits: string): string =>
  digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** "₦12,345.67" for {1234567, NGN}; "−₦100.00" for a negative server delta. */
export function formatMinor(amountMinor: unknown, currency: unknown): string {
  if (!isMinorAmount(amountMinor) || typeof currency !== "string") {
    return "—";
  }
  const exponent = currencyExponent(currency);
  if (exponent === null) {
    return "—";
  }
  const raw = String(amountMinor);
  const negative = raw.startsWith("-");
  const digits = (negative ? raw.slice(1) : raw).padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction =
    exponent > 0 ? "." + digits.slice(digits.length - exponent) : "";
  const symbol = SYMBOLS[currency] ?? currency + " ";
  return (negative ? "−" : "") + symbol + group(whole) + fraction;
}

/** formatMinor for a `{amountMinor, currency}` object, or "—" when absent. */
export const formatMoney = (money: Money | null | undefined): string =>
  money ? formatMinor(money.amountMinor, money.currency) : "—";

const MAJOR_RE = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/;

/**
 * "40,000.50" NGN → 4000050. String rules only: the typed fraction may not
 * have more digits than the currency has (no rounding), and the result must
 * be a positive safe integer. Anything else is null — the form says so.
 */
export function parseMajorToMinor(
  typed: string,
  currency: string,
): number | null {
  const exponent = currencyExponent(currency);
  const match = MAJOR_RE.exec(typed.trim());
  if (exponent === null || match === null) {
    return null;
  }
  const whole = (match[1] ?? "").replace(/,/g, "");
  const fraction = match[2] ?? "";
  if (fraction.length > exponent) {
    return null;
  }
  const digits = (whole + fraction.padEnd(exponent, "0")).replace(/^0+/, "");
  if (digits.length === 0) {
    return null;
  }
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}
