/**
 * Utility Functions
 */

import { customAlphabet } from "nanoid";

// ID generators with prefixes
const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const nanoid = customAlphabet(alphabet, 16);

/**
 * Generate prefixed ID
 */
export function generateId(prefix: string): string {
  return `${prefix}_${nanoid()}`;
}

/**
 * Generate order number (human-readable)
 */
export function generateOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = nanoid(4).toUpperCase();
  return `UB-${timestamp}-${random}`;
}

/**
 * Calculate order totals
 */
export function calculateOrderTotals(
  items: Array<{ totalPrice: number }>,
  options: {
    deliveryFee?: number;
    tip?: number;
    discount?: number;
    currency?: string;
  }
): {
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  tax: number;
  tip: number;
  discount: number;
  total: number;
} {
  const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
  const deliveryFee = options.deliveryFee || 0;
  const tip = options.tip || 0;
  const discount = options.discount || 0;

  // Service fee: 5% of subtotal
  const serviceFee = Math.round(subtotal * 0.05);

  // Tax: VAT varies by country (using Nigeria's 7.5% as default)
  const taxRate = getTaxRate(options.currency || "NGN");
  const tax = Math.round((subtotal + serviceFee) * taxRate);

  const total = subtotal + deliveryFee + serviceFee + tax + tip - discount;

  return {
    subtotal,
    deliveryFee,
    serviceFee,
    tax,
    tip,
    discount,
    total: Math.max(0, total),
  };
}

/**
 * Get tax rate by currency
 */
function getTaxRate(currency: string): number {
  const taxRates: Record<string, number> = {
    NGN: 0.075, // Nigeria VAT 7.5%
    KES: 0.16, // Kenya VAT 16%
    GHS: 0.125, // Ghana VAT 12.5%
    UGX: 0.18, // Uganda VAT 18%
    TZS: 0.18, // Tanzania VAT 18%
    ZAR: 0.15, // South Africa VAT 15%
    XOF: 0.18, // WAEMU average VAT 18%
  };
  return taxRates[currency] || 0.1;
}

/**
 * Format currency amount
 */
export function formatCurrency(amount: number, currency: string): string {
  const formatter = new Intl.NumberFormat(getLocale(currency), {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return formatter.format(amount);
}

/**
 * Get locale for currency
 */
function getLocale(currency: string): string {
  const locales: Record<string, string> = {
    NGN: "en-NG",
    KES: "en-KE",
    GHS: "en-GH",
    UGX: "en-UG",
    TZS: "sw-TZ",
    ZAR: "en-ZA",
    XOF: "fr-SN",
  };
  return locales[currency] || "en-US";
}

/**
 * Calculate distance between two points (Haversine formula)
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Estimate delivery time based on distance
 */
export function estimateDeliveryTime(distanceKm: number): number {
  // Base time: 10 minutes for prep notification + pickup
  const baseTime = 10;
  // Average speed: 25 km/h in urban areas (accounting for traffic)
  const travelTime = (distanceKm / 25) * 60;
  // Buffer: 5 minutes
  const buffer = 5;

  return Math.round(baseTime + travelTime + buffer);
}

/**
 * Check if restaurant is open
 */
export function isRestaurantOpen(
  openingHours: Array<{
    day: string;
    open: string;
    close: string;
    isClosed: boolean;
  }>
): boolean {
  const now = new Date();
  const days = [
    "SUNDAY",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
  ];
  const currentDay = days[now.getDay()];
  const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

  const todayHours = openingHours.find((h) => h.day === currentDay);
  if (!todayHours || todayHours.isClosed) {
    return false;
  }

  // Handle overnight hours (e.g., 22:00 - 02:00)
  if (todayHours.close < todayHours.open) {
    return currentTime >= todayHours.open || currentTime <= todayHours.close;
  }

  return currentTime >= todayHours.open && currentTime <= todayHours.close;
}

/**
 * Slugify text for URLs
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[^\w\s-]/g, "")
    .replaceAll(/[\s_-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

/**
 * Generate a slug from text (alias for slugify)
 */
export const generateSlug = slugify;

/**
 * Sanitize search query
 */
export function sanitizeSearchQuery(query: string): string {
  return query.trim().replaceAll(/[<>]/g, "").substring(0, 100);
}

/**
 * Parse preparation time from string
 */
export function parsePrepTime(prepTime: string): number {
  const match = /(\d+)/.exec(prepTime);
  return match?.[1] ? Number.parseInt(match[1]) : 15;
}

/**
 * Format prep time for display
 */
export function formatPrepTime(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Validate phone number format
 */
export function isValidPhone(phone: string, countryCode?: string): boolean {
  // Basic validation for African phone numbers
  const patterns: Record<string, RegExp> = {
    NG: /^(\+?234|0)[789]\d{9}$/, // Nigeria
    KE: /^(\+?254|0)[17]\d{8}$/, // Kenya
    GH: /^(\+?233|0)[235]\d{8}$/, // Ghana
    UG: /^(\+?256|0)[37]\d{8}$/, // Uganda
    TZ: /^(\+?255|0)[67]\d{8}$/, // Tanzania
    ZA: /^(\+?27|0)[678]\d{8}$/, // South Africa
  };

  if (countryCode && patterns[countryCode]) {
    return patterns[countryCode].test(phone.replaceAll(/\s/g, ""));
  }

  // Generic check
  return /^\+?\d{10,15}$/.test(phone.replaceAll(/\s/g, ""));
}

/**
 * Retry helper
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  delayMs = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, delayMs * attempt));
      }
    }
  }

  throw lastError;
}

/**
 * Chunk array into smaller arrays
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Deep merge objects
 */
export function deepMerge<T extends Record<string, any>>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target };

  for (const key in source) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === "object" &&
        source[key] !== null &&
        !Array.isArray(source[key]) &&
        typeof target[key] === "object" &&
        target[key] !== null
      ) {
        result[key] = deepMerge(target[key], source[key] as any);
      } else {
        result[key] = source[key] as any;
      }
    }
  }

  return result;
}
