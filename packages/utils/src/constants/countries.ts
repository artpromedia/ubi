/**
 * African Countries Configuration
 *
 * Countries where UBI operates with their codes, currencies,
 * and localization settings.
 */

export interface CountryConfig {
  code: string; // ISO 3166-1 alpha-2
  code3: string; // ISO 3166-1 alpha-3
  name: string;
  nativeName: string;
  currency: string;
  phoneCode: string;
  languages: string[];
  timezone: string;
  flag: string;
  active: boolean;
}

export const UBI_COUNTRIES: Record<string, CountryConfig> = {
  NG: {
    code: "NG",
    code3: "NGA",
    name: "Nigeria",
    nativeName: "Nigeria",
    currency: "NGN",
    phoneCode: "+234",
    languages: ["en", "ha", "yo", "ig"],
    timezone: "Africa/Lagos",
    flag: "🇳🇬",
    active: true,
  },
  KE: {
    code: "KE",
    code3: "KEN",
    name: "Kenya",
    nativeName: "Kenya",
    currency: "KES",
    phoneCode: "+254",
    languages: ["en", "sw"],
    timezone: "Africa/Nairobi",
    flag: "🇰🇪",
    active: true,
  },
  ZA: {
    code: "ZA",
    code3: "ZAF",
    name: "South Africa",
    nativeName: "South Africa",
    currency: "ZAR",
    phoneCode: "+27",
    languages: ["en", "zu", "af", "xh"],
    timezone: "Africa/Johannesburg",
    flag: "🇿🇦",
    active: true,
  },
  GH: {
    code: "GH",
    code3: "GHA",
    name: "Ghana",
    nativeName: "Ghana",
    currency: "GHS",
    phoneCode: "+233",
    languages: ["en", "tw", "ee"],
    timezone: "Africa/Accra",
    flag: "🇬🇭",
    active: true,
  },
  RW: {
    code: "RW",
    code3: "RWA",
    name: "Rwanda",
    nativeName: "Rwanda",
    currency: "RWF",
    phoneCode: "+250",
    languages: ["rw", "en", "fr"],
    timezone: "Africa/Kigali",
    flag: "🇷🇼",
    active: true,
  },
  ET: {
    code: "ET",
    code3: "ETH",
    name: "Ethiopia",
    nativeName: "ኢትዮጵያ",
    currency: "ETB",
    phoneCode: "+251",
    languages: ["am", "en", "om"],
    timezone: "Africa/Addis_Ababa",
    flag: "🇪🇹",
    active: true,
  },
};

/**
 * Get all active countries
 */
export function getActiveCountries(): CountryConfig[] {
  return Object.values(UBI_COUNTRIES).filter((c) => c.active);
}

/**
 * Get country by code
 */
export function getCountryByCode(code: string): CountryConfig | undefined {
  return UBI_COUNTRIES[code.toUpperCase()];
}

/**
 * Get country by phone code
 */
export function getCountryByPhoneCode(
  phoneCode: string,
): CountryConfig | undefined {
  const normalized = phoneCode.startsWith("+") ? phoneCode : `+${phoneCode}`;
  return Object.values(UBI_COUNTRIES).find((c) => c.phoneCode === normalized);
}

/**
 * Detect country from phone number
 */
export function detectCountryFromPhone(
  phone: string,
): CountryConfig | undefined {
  const cleaned = phone.replace(/\D/g, "");

  for (const country of Object.values(UBI_COUNTRIES)) {
    const code = country.phoneCode.replace("+", "");
    if (cleaned.startsWith(code)) {
      return country;
    }
  }

  return undefined;
}

/**
 * Get all supported languages across UBI countries
 */
export function getSupportedLanguages(): string[] {
  const languages = new Set<string>();
  for (const country of Object.values(UBI_COUNTRIES)) {
    country.languages.forEach((lang) => languages.add(lang));
  }
  return Array.from(languages);
}
