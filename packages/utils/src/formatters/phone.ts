/**
 * Phone number formatting utilities for UBI
 */

/**
 * Format phone number for display
 */
export function formatPhoneNumber(phone: string, countryCode?: string): string {
  // Remove all non-digits
  const digits = phone.replaceAll(/\D/g, "");

  // Handle different formats based on length and country
  if (countryCode === "KE" || digits.startsWith("254")) {
    // Kenya: +254 XXX XXX XXX
    const cleaned = digits.startsWith("254") ? digits : `254${digits}`;
    return `+${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6, 9)} ${cleaned.slice(9)}`;
  }

  if (countryCode === "NG" || digits.startsWith("234")) {
    // Nigeria: +234 XXX XXX XXXX
    const cleaned = digits.startsWith("234") ? digits : `234${digits}`;
    return `+${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6, 9)} ${cleaned.slice(9)}`;
  }

  if (countryCode === "ZA" || digits.startsWith("27")) {
    // South Africa: +27 XX XXX XXXX
    const cleaned = digits.startsWith("27") ? digits : `27${digits}`;
    return `+${cleaned.slice(0, 2)} ${cleaned.slice(2, 4)} ${cleaned.slice(4, 7)} ${cleaned.slice(7)}`;
  }

  // Generic international format
  if (digits.length > 10) {
    return `+${digits.slice(0, digits.length - 10)} ${digits.slice(-10, -7)} ${digits.slice(-7, -4)} ${digits.slice(-4)}`;
  }

  return phone;
}

/**
 * Get country code from phone number
 */
export function getCountryCodeFromPhone(phone: string): string | undefined {
  const digits = phone.replaceAll(/\D/g, "");

  if (digits.startsWith("254")) {return "KE";}
  if (digits.startsWith("234")) {return "NG";}
  if (digits.startsWith("27")) {return "ZA";}
  if (digits.startsWith("255")) {return "TZ";}
  if (digits.startsWith("256")) {return "UG";}
  if (digits.startsWith("250")) {return "RW";}
  if (digits.startsWith("233")) {return "GH";}
  if (digits.startsWith("237")) {return "CM";}
  if (digits.startsWith("225")) {return "CI";}
  if (digits.startsWith("221")) {return "SN";}

  return undefined;
}

/**
 * Normalize phone number for storage (E.164 format)
 */
export function normalizePhoneNumber(
  phone: string,
  defaultCountryCode = "254"
): string {
  const digits = phone.replaceAll(/\D/g, "");

  // Already has country code
  if (digits.length > 10) {
    return `+${digits}`;
  }

  // Local number - add country code
  const normalized = digits.startsWith("0") ? digits.slice(1) : digits;
  return `+${defaultCountryCode}${normalized}`;
}

/**
 * Validate phone number format
 */
export function isValidPhoneNumber(phone: string): boolean {
  const digits = phone.replaceAll(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

/**
 * Mask phone number for privacy
 */
export function maskPhoneNumber(phone: string): string {
  const formatted = formatPhoneNumber(phone);
  const parts = formatted.split(" ");
  if (parts.length > 2) {
    return `${parts[0]} ${parts[1]} *** ${parts.at(-1)}`;
  }
  return phone.slice(0, 4) + "****" + phone.slice(-4);
}
