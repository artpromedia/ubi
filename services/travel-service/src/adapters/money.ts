/**
 * Supplier amounts → integer minor units, exactly (CLAUDE.md #1).
 *
 * Suppliers quote money as decimals: Duffel as strings (`"45.00"`), LiteAPI as
 * JSON numbers (`163.66`). Neither is ever multiplied as a float here. A string
 * is parsed digit by digit; a JSON number is first turned back into the
 * shortest decimal that round-trips it (`String(163.66) === "163.66"`), which
 * is exactly the literal the supplier wrote for any amount a currency can
 * express. The currency's ISO 4217 exponent decides how many fraction digits
 * are allowed:
 *
 *  - fewer digits are padded (`"45.5"` GBP → 4550);
 *  - MORE digits than the currency has are refused, never rounded — an amount
 *    UBI cannot charge exactly is an amount UBI does not sell;
 *  - exponent notation, NaN, Infinity and anything past
 *    `Number.MAX_SAFE_INTEGER` minor units are refused.
 *
 * `minorToDecimal` is the inverse, for sending an amount back to a supplier
 * that expects a decimal string (Duffel `payments[].amount`).
 */

/**
 * ISO 4217 minor-unit exponents that are not 2. Every other well-formed code
 * uses 2. (Source: ISO 4217 table A.1; CLF and UYW carry 4.)
 */
const EXPONENT_OVERRIDES: Readonly<Record<string, number>> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
  CLF: 4,
  UYW: 4,
};

export class SupplierAmountError extends Error {
  constructor(
    message: string,
    readonly raw: unknown,
    readonly currency: string,
  ) {
    super(message);
    this.name = "SupplierAmountError";
  }
}

export function currencyExponent(currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new SupplierAmountError(
      `not an ISO 4217 currency code: ${currency}`,
      currency,
      currency,
    );
  }
  return EXPONENT_OVERRIDES[currency] ?? 2;
}

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

/** The supplier's amount as an exact decimal string, or a refusal. */
function decimalText(raw: unknown, currency: string): string {
  if (typeof raw === "string") {
    return raw.trim();
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      throw new SupplierAmountError(
        "supplier amount is not a finite number",
        raw,
        currency,
      );
    }
    // Shortest round-trip form: the literal the supplier sent for any
    // amount a currency can express. Exponent forms are refused below.
    return String(raw);
  }
  throw new SupplierAmountError(
    "supplier amount is neither a decimal string nor a number",
    raw,
    currency,
  );
}

/**
 * Converts a supplier decimal to integer minor units in `currency`, exactly.
 * Throws `SupplierAmountError` rather than round.
 */
export function decimalToMinor(raw: unknown, currency: string): number {
  const exponent = currencyExponent(currency);
  const text = decimalText(raw, currency);
  const match = DECIMAL.exec(text);
  if (match === null) {
    throw new SupplierAmountError(
      `supplier amount "${text}" is not a plain decimal`,
      raw,
      currency,
    );
  }
  const negative = match[1] === "-";
  const whole = match[2] ?? "0";
  const fraction = match[3] ?? "";
  if (fraction.length > exponent) {
    // A non-zero digit beyond the currency's exponent cannot be charged
    // exactly. Trailing zeros ("45.000" GBP) are harmless and accepted.
    const extra = fraction.slice(exponent);
    if (/[^0]/.test(extra)) {
      throw new SupplierAmountError(
        `supplier amount "${text}" has more precision than ${currency} allows (${exponent} decimals)`,
        raw,
        currency,
      );
    }
  }
  const padded = (fraction + "0".repeat(exponent)).slice(0, exponent);
  const digits = `${whole}${padded}`.replace(/^0+(?=\d)/, "");
  const value = Number(digits);
  if (!Number.isSafeInteger(value)) {
    throw new SupplierAmountError(
      `supplier amount "${text}" exceeds the safe integer range in minor units`,
      raw,
      currency,
    );
  }
  return negative && value !== 0 ? -value : value;
}

/** Integer minor units → the decimal string a supplier expects (`4550` GBP → "45.50"). */
export function minorToDecimal(amountMinor: number, currency: string): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new SupplierAmountError(
      "amount must be a safe integer of minor units",
      amountMinor,
      currency,
    );
  }
  const exponent = currencyExponent(currency);
  const negative = amountMinor < 0;
  const digits = String(Math.abs(amountMinor)).padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent === 0 ? "" : `.${digits.slice(-exponent)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}
