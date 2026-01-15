/**
 * Utility Functions
 */

import { customAlphabet } from "nanoid";

/**
 * Generate unique IDs with prefix
 */
const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 16);

export function generateId(prefix: string): string {
  return `${prefix}_${nanoid()}`;
}

/**
 * Format currency amount
 */
export function formatCurrency(amount: number, currency: string): string {
  const formatters: Record<string, Intl.NumberFormat> = {
    NGN: new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }),
    KES: new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" }),
    GHS: new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS" }),
    UGX: new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX" }),
    TZS: new Intl.NumberFormat("en-TZ", { style: "currency", currency: "TZS" }),
    ZAR: new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }),
    XOF: new Intl.NumberFormat("fr-CI", { style: "currency", currency: "XOF" }),
    USD: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }),
  };

  const formatter = formatters[currency] ?? formatters.USD;
  return formatter!.format(amount);
}

/**
 * Format phone number for mobile money
 */
export function formatPhoneNumber(phone: string, countryCode: string): string {
  // Remove all non-numeric characters
  let cleaned = phone.replace(/\D/g, "");

  // Remove leading zeros
  cleaned = cleaned.replace(/^0+/, "");

  // Add country code if not present
  const countryCodes: Record<string, string> = {
    NG: "234",
    KE: "254",
    GH: "233",
    UG: "256",
    TZ: "255",
    ZA: "27",
    CI: "225",
    SN: "221",
    CM: "237",
    RW: "250",
  };

  const code = countryCodes[countryCode] || "";
  if (code && !cleaned.startsWith(code)) {
    cleaned = code + cleaned;
  }

  return cleaned;
}

/**
 * Validate phone number format
 */
export function isValidPhoneNumber(
  phone: string,
  countryCode: string,
): boolean {
  const patterns: Record<string, RegExp> = {
    NG: /^234[0-9]{10}$/,
    KE: /^254[0-9]{9}$/,
    GH: /^233[0-9]{9}$/,
    UG: /^256[0-9]{9}$/,
    TZ: /^255[0-9]{9}$/,
    ZA: /^27[0-9]{9}$/,
  };

  const pattern = patterns[countryCode];
  if (!pattern) {
    return true;
  } // Allow if no pattern defined

  const cleaned = phone.replace(/\D/g, "");
  return pattern.test(cleaned);
}

/**
 * Get currency for country
 */
export function getCurrencyForCountry(countryCode: string): string {
  const currencies: Record<string, string> = {
    NG: "NGN",
    KE: "KES",
    GH: "GHS",
    UG: "UGX",
    TZ: "TZS",
    ZA: "ZAR",
    CI: "XOF",
    SN: "XOF",
    CM: "XOF",
    BJ: "XOF",
    ML: "XOF",
    RW: "RWF",
    ET: "ETB",
  };

  return currencies[countryCode] || "USD";
}

/**
 * Calculate percentage
 */
export function calculatePercentage(
  amount: number,
  percentage: number,
): number {
  return Math.round(amount * percentage) / 100;
}

/**
 * Round to currency precision
 */
export function roundToCurrency(amount: number, currency: string): number {
  // Most African currencies don't use decimals
  const noDecimalCurrencies = ["NGN", "KES", "UGX", "TZS", "XOF", "RWF"];

  if (noDecimalCurrencies.includes(currency)) {
    return Math.round(amount);
  }

  return Math.round(amount * 100) / 100;
}

/**
 * Sleep utility
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    factor?: number;
  } = {},
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 100,
    maxDelay = 5000,
    factor = 2,
  } = options;

  let lastError: Error | undefined;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        await sleep(delay);
        delay = Math.min(delay * factor, maxDelay);
      }
    }
  }

  throw lastError;
}

/**
 * Mask sensitive data
 */
export function maskCardNumber(cardNumber: string): string {
  const cleaned = cardNumber.replace(/\D/g, "");
  if (cleaned.length < 8) {
    return "****";
  }

  const first4 = cleaned.slice(0, 4);
  const last4 = cleaned.slice(-4);
  const masked = "*".repeat(cleaned.length - 8);

  return `${first4}${masked}${last4}`;
}

export function maskPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length < 6) {
    return "***";
  }

  const first3 = cleaned.slice(0, 3);
  const last3 = cleaned.slice(-3);
  const masked = "*".repeat(cleaned.length - 6);

  return `${first3}${masked}${last3}`;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) {
    return "***@***";
  }

  const maskedLocal =
    local.length <= 2
      ? local[0] + "*"
      : local[0] + "*".repeat(local.length - 2) + local[local.length - 1];

  return `${maskedLocal}@${domain}`;
}

/**
 * Parse amount string to number
 */
export function parseAmount(amount: string | number): number {
  if (typeof amount === "number") {
    return amount;
  }

  // Remove currency symbols and commas
  const cleaned = amount.replace(/[^0-9.-]/g, "");
  const parsed = parseFloat(cleaned);

  if (isNaN(parsed)) {
    throw new Error(`Invalid amount: ${amount}`);
  }

  return parsed;
}

/**
 * Generate reference number
 */
export function generateReference(prefix: string = "UBI"): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}
