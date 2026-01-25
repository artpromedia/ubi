/**
 * Currency Formatting Utilities
 *
 * Optimized for African currencies with proper formatting
 * for Nigerian Naira, Kenyan Shilling, South African Rand, etc.
 */

export type SupportedCurrency = "NGN" | "KES" | "ZAR" | "GHS" | "RWF" | "ETB" | "USD";

interface CurrencyConfig {
  code: SupportedCurrency;
  symbol: string;
  name: string;
  locale: string;
  decimals: number;
}

export const CURRENCY_CONFIG: Record<SupportedCurrency, CurrencyConfig> = {
  NGN: {
    code: "NGN",
    symbol: "₦",
    name: "Nigerian Naira",
    locale: "en-NG",
    decimals: 0, // Naira typically shown without decimals
  },
  KES: {
    code: "KES",
    symbol: "KSh",
    name: "Kenyan Shilling",
    locale: "en-KE",
    decimals: 0,
  },
  ZAR: {
    code: "ZAR",
    symbol: "R",
    name: "South African Rand",
    locale: "en-ZA",
    decimals: 2,
  },
  GHS: {
    code: "GHS",
    symbol: "GH₵",
    name: "Ghanaian Cedi",
    locale: "en-GH",
    decimals: 2,
  },
  RWF: {
    code: "RWF",
    symbol: "FRw",
    name: "Rwandan Franc",
    locale: "rw-RW",
    decimals: 0,
  },
  ETB: {
    code: "ETB",
    symbol: "Br",
    name: "Ethiopian Birr",
    locale: "am-ET",
    decimals: 2,
  },
  USD: {
    code: "USD",
    symbol: "$",
    name: "US Dollar",
    locale: "en-US",
    decimals: 2,
  },
};

/**
 * Format a monetary amount with the appropriate currency symbol and locale
 *
 * @example
 * formatCurrency(5000, "NGN") // "₦5,000"
 * formatCurrency(150.50, "ZAR") // "R150.50"
 */
export function formatCurrency(
  amount: number,
  currency: SupportedCurrency = "NGN",
  options: {
    showSymbol?: boolean;
    compact?: boolean;
  } = {}
): string {
  const { showSymbol = true, compact = false } = options;
  const config = CURRENCY_CONFIG[currency];

  if (compact && amount >= 1000) {
    return formatCompactCurrency(amount, currency, showSymbol);
  }

  const formatted = new Intl.NumberFormat(config.locale, {
    style: showSymbol ? "currency" : "decimal",
    currency: config.code,
    minimumFractionDigits: config.decimals,
    maximumFractionDigits: config.decimals,
  }).format(amount);

  return formatted;
}

/**
 * Format large currency amounts in compact form
 *
 * @example
 * formatCompactCurrency(1500000, "NGN") // "₦1.5M"
 */
export function formatCompactCurrency(
  amount: number,
  currency: SupportedCurrency = "NGN",
  showSymbol: boolean = true
): string {
  const config = CURRENCY_CONFIG[currency];

  const tiers = [
    { threshold: 1_000_000_000, suffix: "B" },
    { threshold: 1_000_000, suffix: "M" },
    { threshold: 1_000, suffix: "K" },
  ];

  for (const tier of tiers) {
    if (amount >= tier.threshold) {
      const value = amount / tier.threshold;
      const formatted = value % 1 === 0 ? value.toString() : value.toFixed(1);
      return showSymbol
        ? `${config.symbol}${formatted}${tier.suffix}`
        : `${formatted}${tier.suffix}`;
    }
  }

  return formatCurrency(amount, currency, { showSymbol });
}

/**
 * Parse a currency string back to a number
 *
 * @example
 * parseCurrency("₦5,000") // 5000
 * parseCurrency("R150.50") // 150.50
 */
export function parseCurrency(value: string): number {
  // Remove all non-numeric characters except decimal point
  const cleaned = value.replace(/[^0-9.]/g, "");
  return Number.parseFloat(cleaned) || 0;
}

/**
 * Convert between currencies using exchange rates
 * Note: In production, use real-time exchange rates from an API
 */
export function convertCurrency(
  amount: number,
  fromCurrency: SupportedCurrency,
  toCurrency: SupportedCurrency,
  exchangeRates: Record<string, number>
): number {
  if (fromCurrency === toCurrency) {
    return amount;
  }

  const fromRate = exchangeRates[fromCurrency] || 1;
  const toRate = exchangeRates[toCurrency] || 1;

  // Convert to USD first, then to target currency
  const inUSD = amount / fromRate;
  return inUSD * toRate;
}

/**
 * Get the currency symbol for a currency code
 */
export function getCurrencySymbol(currency: SupportedCurrency): string {
  return CURRENCY_CONFIG[currency]?.symbol || currency;
}

/**
 * Validate if a string is a valid currency code
 */
export function isValidCurrency(code: string): code is SupportedCurrency {
  return code in CURRENCY_CONFIG;
}
