/**
 * Utility Functions
 */

import { randomBytes } from "crypto";

// ============================================
// ID Generation
// ============================================

/**
 * Generate a prefixed unique ID
 */
export function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(8).toString("hex");
  return `${prefix}_${timestamp}${random}`;
}

/**
 * Generate short ID (for OTPs, verification codes, etc.)
 */
export function generateShortId(length: number = 8): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = randomBytes(length);
  let result = "";

  for (let i = 0; i < length; i++) {
    result += chars[(bytes[i] ?? 0) % chars.length];
  }

  return result;
}

// ============================================
// OTP Generation
// ============================================

/**
 * Generate numeric OTP
 */
export function generateOTP(length: number = 6): string {
  const max = Math.pow(10, length);
  const min = Math.pow(10, length - 1);
  const otp = Math.floor(Math.random() * (max - min) + min);
  return otp.toString();
}

/**
 * Generate alphanumeric OTP (for more secure cases)
 */
export function generateAlphanumericOTP(length: number = 6): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = randomBytes(length);
  let result = "";

  for (let i = 0; i < length; i++) {
    result += chars[(bytes[i] ?? 0) % chars.length];
  }

  return result;
}

// ============================================
// Phone Number Formatting
// ============================================

/**
 * Normalize phone number to E.164 format
 */
export function normalizePhone(
  phone: string,
  defaultCountryCode: string = "+234",
): string {
  // Remove all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, "");

  // Handle Nigerian numbers (most common use case)
  if (cleaned.startsWith("0") && cleaned.length === 11) {
    cleaned = defaultCountryCode + cleaned.slice(1);
  }

  // Add + if not present and starts with country code
  if (!cleaned.startsWith("+") && cleaned.length > 10) {
    cleaned = "+" + cleaned;
  }

  return cleaned;
}

/**
 * Validate phone number format
 */
export function isValidPhone(phone: string): boolean {
  const normalized = normalizePhone(phone);
  // E.164 format: +[country code][subscriber number]
  return /^\+[1-9]\d{6,14}$/.test(normalized);
}

/**
 * Get country from phone number
 */
export function getCountryFromPhone(phone: string): string | null {
  const countryPrefixes: Record<string, string> = {
    "+234": "NG", // Nigeria
    "+254": "KE", // Kenya
    "+233": "GH", // Ghana
    "+256": "UG", // Uganda
    "+255": "TZ", // Tanzania
    "+27": "ZA", // South Africa
    "+221": "SN", // Senegal
    "+225": "CI", // Ivory Coast
    "+237": "CM", // Cameroon
    "+250": "RW", // Rwanda
    "+260": "ZM", // Zambia
    "+263": "ZW", // Zimbabwe
    "+212": "MA", // Morocco
    "+20": "EG", // Egypt
  };

  for (const [prefix, country] of Object.entries(countryPrefixes)) {
    if (phone.startsWith(prefix)) {
      return country;
    }
  }

  return null;
}

// ============================================
// Template Interpolation
// ============================================

/**
 * Interpolate template variables
 */
export function interpolateTemplate(
  template: string,
  variables: Record<string, any>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = variables[key];
    return value !== undefined ? String(value) : match;
  });
}

/**
 * Extract variable names from template
 */
export function extractTemplateVariables(template: string): string[] {
  const matches = template.match(/\{\{(\w+)\}\}/g) || [];
  return [...new Set(matches.map((m) => m.slice(2, -2)))];
}

// ============================================
// Notification Message Formatting
// ============================================

/**
 * Truncate message for SMS (160 char limit for single SMS)
 */
export function truncateForSMS(
  message: string,
  maxLength: number = 160,
): string {
  if (message.length <= maxLength) return message;
  return message.slice(0, maxLength - 3) + "...";
}

/**
 * Format currency for notifications
 */
export function formatCurrency(amount: number, currency: string): string {
  const symbols: Record<string, string> = {
    NGN: "₦",
    KES: "KSh",
    GHS: "GH₵",
    UGX: "USh",
    TZS: "TSh",
    ZAR: "R",
    XOF: "CFA",
    USD: "$",
    EUR: "€",
    GBP: "£",
  };

  const symbol = symbols[currency] || currency;
  const formatted = amount.toLocaleString("en-US", {
    minimumFractionDigits: currency === "UGX" || currency === "TZS" ? 0 : 2,
    maximumFractionDigits: currency === "UGX" || currency === "TZS" ? 0 : 2,
  });

  return `${symbol}${formatted}`;
}

/**
 * Format distance for notifications
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}

/**
 * Format duration for notifications
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  }

  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);

  if (mins === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${mins}m`;
}

// ============================================
// Deep Link Generation
// ============================================

/**
 * Generate app deep link
 */
export function generateDeepLink(
  screen: string,
  params: Record<string, string> = {},
): string {
  const baseUrl = process.env.APP_DEEP_LINK_SCHEME || "ubi://";
  const queryString = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  return queryString
    ? `${baseUrl}${screen}?${queryString}`
    : `${baseUrl}${screen}`;
}

/**
 * Generate web link with fallback
 */
export function generateWebLink(path: string): string {
  const baseUrl = process.env.APP_URL || "https://ubi.africa";
  return `${baseUrl}${path.startsWith("/") ? path : "/" + path}`;
}

// ============================================
// Time Formatting
// ============================================

/**
 * Format relative time for notifications
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

/**
 * Format time for a specific timezone
 */
export function formatTimeInTimezone(
  date: Date,
  timezone: string,
  format: "time" | "date" | "datetime" = "time",
): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
  };

  if (format === "time" || format === "datetime") {
    options.hour = "2-digit";
    options.minute = "2-digit";
  }

  if (format === "date" || format === "datetime") {
    options.year = "numeric";
    options.month = "short";
    options.day = "numeric";
  }

  return new Intl.DateTimeFormat("en-US", options).format(date);
}

// ============================================
// Sanitization
// ============================================

/**
 * Sanitize user input for notifications
 */
export function sanitizeNotificationText(text: string): string {
  return text
    .replace(/[<>]/g, "") // Remove HTML-like tags
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim()
    .slice(0, 1000); // Limit length
}

/**
 * Mask sensitive data
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain || !local) return "***@***";

  const maskedLocal =
    local.length > 2
      ? local[0] + "*".repeat(local.length - 2) + local[local.length - 1]
      : local[0] + "*";

  return `${maskedLocal}@${domain}`;
}

export function maskPhone(phone: string): string {
  if (phone.length < 4) return "***";
  return phone.slice(0, -4).replace(/\d/g, "*") + phone.slice(-4);
}
