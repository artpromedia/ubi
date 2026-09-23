/**
 * Display formatting for SERVER money: integer minor units + ISO currency, as
 * every ride-service / payment-service / travel-service read returns them.
 *
 * This module never does money arithmetic. It places the decimal point by
 * string manipulation on the server's integer (no division, no rounding, no
 * float) using the currency's ISO 4217 exponent, so what an operator reads is
 * exactly what the ledger holds. A value that is not a safe integer, or a
 * currency that is not a real ISO code, renders "—" (fail closed) instead of
 * a guess. Amounts the server sent WITHOUT a currency are shown as "minor
 * units" — this module never assumes one.
 */

const SYMBOLS: Readonly<Record<string, string>> = {
  NGN: "₦",
  GHS: "GH₵",
  KES: "KSh ",
  ZAR: "R ",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

/** A server amount: an integer count of the currency's minor unit. */
export type ServerMoney = { amountMinor: number; currency: string };

/** True for a value the server could have sent as integer minor units. */
export const isMinorAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

const CURRENCY_RE = /^[A-Z]{3}$/;

// Intl formats ANY well-formed three-letter code; the runtime's ISO 4217
// list (where available) is what makes "ZZZ" fail closed instead.
const KNOWN_CURRENCIES: ReadonlySet<string> | null = (() => {
  try {
    return typeof Intl.supportedValuesOf === "function"
      ? new Set(Intl.supportedValuesOf("currency"))
      : null;
  } catch {
    return null;
  }
})();

/** ISO 4217 exponent (NGN 2, JPY 0, KWD 3), or null for an unknown code. */
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

/**
 * "₦12,345.67" for {1234567, NGN}; "−₦100.00" for a negative delta; "—" for
 * anything the server could not have meant.
 */
export function formatMinor(amountMinor: unknown, currency: unknown): string {
  if (!isMinorAmount(amountMinor) || typeof currency !== "string") {
    return "—";
  }
  const exponent = currencyExponent(currency);
  if (exponent === null) {
    return "—";
  }
  const negative = amountMinor < 0;
  const digits = String(negative ? -amountMinor : amountMinor).padStart(
    exponent + 1,
    "0",
  );
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent > 0 ? "." + digits.slice(-exponent) : "";
  const symbol = SYMBOLS[currency] ?? currency + " ";
  return (negative ? "−" : "") + symbol + group(whole) + fraction;
}

/** formatMinor for a {amountMinor, currency} object (or "—" when absent). */
export const formatServerMoney = (money?: ServerMoney | null): string =>
  money ? formatMinor(money.amountMinor, money.currency) : "—";

/** An amount the server sent without its currency: shown, never converted. */
export function formatMinorUnits(amountMinor: unknown): string {
  if (!isMinorAmount(amountMinor)) {
    return "—";
  }
  const negative = amountMinor < 0;
  return (
    (negative ? "−" : "") +
    group(String(negative ? -amountMinor : amountMinor)) +
    " minor units"
  );
}
