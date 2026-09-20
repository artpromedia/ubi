/**
 * String Utilities
 *
 * Common string manipulation helpers.
 */

/**
 * Generate a random alphanumeric string
 * @param length - Length of the string
 */
export function generateRandomString(length: number): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a random numeric string (for OTPs)
 * @param length - Length of the string
 */
export function generateOTP(length: number = 6): string {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += Math.floor(Math.random() * 10).toString();
  }
  return result;
}

/**
 * Generate a tracking number
 * Format: UBI-XXXXXXXX
 */
export function generateTrackingNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = generateRandomString(4).toUpperCase();
  return `UBI-${timestamp}${random}`;
}

/**
 * Generate a referral code
 * Format: UBI + 6 alphanumeric characters
 */
export function generateReferralCode(): string {
  return `UBI${generateRandomString(6).toUpperCase()}`;
}

/**
 * Generate a unique ID (not cryptographically secure, use UUID for that)
 */
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Truncate string with ellipsis
 * @param str - String to truncate
 * @param maxLength - Maximum length
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength - 3) + "...";
}

/**
 * Convert string to title case
 * @param str - String to convert
 */
export function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Convert string to snake_case
 * @param str - String to convert
 */
export function toSnakeCase(str: string): string {
  return str
    .replaceAll(/([a-z])([A-Z])/g, "$1_$2")
    .replaceAll(/[\s-]+/g, "_")
    .toLowerCase();
}

/**
 * Convert string to camelCase
 * @param str - String to convert
 */
export function toCamelCase(str: string): string {
  return str
    .toLowerCase()
    .replaceAll(/[_-](.)/g, (_, char) => char.toUpperCase())
    .replaceAll(/^(.)/g, (_, char) => char.toLowerCase());
}

/**
 * Convert string to kebab-case
 * @param str - String to convert
 */
export function toKebabCase(str: string): string {
  return str
    .replaceAll(/([a-z])([A-Z])/g, "$1-$2")
    .replaceAll(/[\s_]+/g, "-")
    .toLowerCase();
}

/**
 * Mask sensitive data (e.g., phone numbers, emails)
 * @param str - String to mask
 * @param visibleStart - Number of visible characters at start
 * @param visibleEnd - Number of visible characters at end
 */
export function maskString(
  str: string,
  visibleStart: number = 3,
  visibleEnd: number = 2,
): string {
  if (str.length <= visibleStart + visibleEnd) {
    return str;
  }

  const start = str.substring(0, visibleStart);
  const end = str.substring(str.length - visibleEnd);
  const masked = "*".repeat(str.length - visibleStart - visibleEnd);

  return `${start}${masked}${end}`;
}

/**
 * Mask email address
 * @param email - Email to mask
 */
export function maskEmail(email: string): string {
  const parts = email.split("@");
  const local = parts[0];
  const domain = parts[1];
  if (!domain || !local) {
    return maskString(email);
  }

  const maskedLocal =
    local.length > 2
      ? `${local[0]}${"*".repeat(local.length - 2)}${local.at(-1)}`
      : local;

  return `${maskedLocal}@${domain}`;
}

/**
 * Mask phone number (show last 4 digits)
 * @param phone - Phone number to mask
 */
export function maskPhone(phone: string): string {
  const digits = phone.replaceAll(/\D/g, "");
  if (digits.length <= 4) {
    return phone;
  }

  const masked = "*".repeat(digits.length - 4);
  const visible = digits.slice(-4);

  return `${masked}${visible}`;
}

/**
 * Mask credit card number
 * @param cardNumber - Card number to mask
 */
export function maskCardNumber(cardNumber: string): string {
  const digits = cardNumber.replaceAll(/\D/g, "");
  if (digits.length < 4) {
    return cardNumber;
  }

  return `****-****-****-${digits.slice(-4)}`;
}

/**
 * Slugify a string (URL-safe)
 * @param str - String to slugify
 */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replaceAll(/[^\w\s-]/g, "")
    .replaceAll(/[\s_-]+/g, "-")
    .replaceAll(/(?:^-+)|(?:-+$)/g, "");
}

/**
 * Check if string is a valid UUID
 * @param str - String to check
 */
export function isUUID(str: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Check if string is a valid email
 * @param str - String to check
 */
export function isEmail(str: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(str);
}

/**
 * Extract initials from a name
 * @param name - Full name
 * @param maxInitials - Maximum number of initials
 */
export function getInitials(name: string, maxInitials: number = 2): string {
  return name
    .split(" ")
    .filter((part) => part.length > 0)
    .map((part) => (part[0] ?? "").toUpperCase())
    .slice(0, maxInitials)
    .join("");
}

/**
 * Pluralize a word based on count
 * @param count - Number of items
 * @param singular - Singular form
 * @param plural - Plural form (optional, defaults to singular + 's')
 */
export function pluralize(
  count: number,
  singular: string,
  plural?: string,
): string {
  if (count === 1) {
    return singular;
  }
  return plural || `${singular}s`;
}

/**
 * Join array with proper grammar (Oxford comma)
 * @param items - Array of strings
 */
export function joinWithComma(items: string[]): string {
  if (items.length === 0) {
    return "";
  }
  if (items.length === 1) {
    return items[0] ?? "";
  }
  if (items.length === 2) {
    return items.join(" and ");
  }

  const last = items.at(-1) ?? "";
  const rest = items.slice(0, -1);
  return `${rest.join(", ")}, and ${last}`;
}

/**
 * Escape HTML entities
 * @param str - String to escape
 */
export function escapeHtml(str: string): string {
  const htmlEntities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  return str.replaceAll(/[&<>"']/g, (char) => htmlEntities[char] ?? char);
}

/**
 * Remove all HTML tags from string
 * @param str - String with HTML
 */
export function stripHtml(str: string): string {
  return str.replaceAll(/<[^>]*>/g, "");
}

/**
 * Normalize whitespace in string
 * @param str - String to normalize
 */
export function normalizeWhitespace(str: string): string {
  return str.replaceAll(/\s+/g, " ").trim();
}

/**
 * Check if string contains only alphanumeric characters
 * @param str - String to check
 */
export function isAlphanumeric(str: string): boolean {
  return /^[a-zA-Z0-9]+$/.test(str);
}

/**
 * Reverse a string
 * @param str - String to reverse
 */
export function reverse(str: string): string {
  return str.split("").reverse().join("");
}

/**
 * Count occurrences of a substring
 * @param str - String to search in
 * @param searchStr - String to search for
 */
export function countOccurrences(str: string, searchStr: string): number {
  if (searchStr.length === 0) {
    return 0;
  }

  let count = 0;
  let pos = 0;

  while ((pos = str.indexOf(searchStr, pos)) !== -1) {
    count++;
    pos += searchStr.length;
  }

  return count;
}
