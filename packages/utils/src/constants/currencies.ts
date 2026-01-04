/**
 * Currency constants for UBI
 */

export const CURRENCIES = {
  KES: { code: "KES", symbol: "KSh", name: "Kenyan Shilling", decimals: 2 },
  NGN: { code: "NGN", symbol: "₦", name: "Nigerian Naira", decimals: 2 },
  ZAR: { code: "ZAR", symbol: "R", name: "South African Rand", decimals: 2 },
  TZS: { code: "TZS", symbol: "TSh", name: "Tanzanian Shilling", decimals: 0 },
  UGX: { code: "UGX", symbol: "USh", name: "Ugandan Shilling", decimals: 0 },
  RWF: { code: "RWF", symbol: "FRw", name: "Rwandan Franc", decimals: 0 },
  GHS: { code: "GHS", symbol: "GH₵", name: "Ghanaian Cedi", decimals: 2 },
  XOF: {
    code: "XOF",
    symbol: "CFA",
    name: "West African CFA Franc",
    decimals: 0,
  },
  XAF: {
    code: "XAF",
    symbol: "FCFA",
    name: "Central African CFA Franc",
    decimals: 0,
  },
  USD: { code: "USD", symbol: "$", name: "US Dollar", decimals: 2 },
  EUR: { code: "EUR", symbol: "€", name: "Euro", decimals: 2 },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export interface CurrencyInfo {
  code: CurrencyCode;
  symbol: string;
  name: string;
  decimals: number;
}

/**
 * Get currency by country code
 */
export function getCurrencyByCountry(countryCode: string): CurrencyInfo {
  const currencyMap: Record<string, CurrencyCode> = {
    KE: "KES",
    NG: "NGN",
    ZA: "ZAR",
    TZ: "TZS",
    UG: "UGX",
    RW: "RWF",
    GH: "GHS",
    SN: "XOF",
    CI: "XOF",
    CM: "XAF",
    US: "USD",
    EU: "EUR",
  };

  const code = currencyMap[countryCode] ?? "USD";
  return CURRENCIES[code];
}

/**
 * Get all supported currencies
 */
export function getSupportedCurrencies(): CurrencyInfo[] {
  return Object.values(CURRENCIES);
}
