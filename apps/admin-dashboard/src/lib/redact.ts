/**
 * PII minimisation for everything the admin consoles render or export.
 *
 * The marketplace outbox is append-only history written for machines: a
 * trip-link event carries a sealed envelope, a stop event can carry
 * distances, a published request carries coordinates on other surfaces. The
 * operator needs WHAT happened, not the passenger's phone, the one-time
 * link token or where someone lives. Two seams enforce that:
 *
 *   - `isBlockedKey` — payload keys whose value is never shown or exported
 *     (secrets, tokens, sealed envelopes, contact details, coordinates);
 *   - `scrubText` — a last line of defence on every string we render: a
 *     phone number is masked to its country code and last two digits, and a
 *     raw trip-link token (or any long token-shaped secret) is replaced.
 *
 * Opaque ids (UUIDs, award/request/driver ids) are NOT PII here: operators
 * need them to cross-reference, and every existing board already shows them.
 */

const BLOCKED_KEY =
  /pin|token|secret|password|ciphertext|nonce|sealed|phone|msisdn|e?mail|first_?name|last_?name|full_?name|sms_?copy|^(lat|lng|latitude|longitude|pickup|dropoff|location|address|coordinates|evidence)$/i;

/** True for a payload key whose value must never be rendered or exported. */
export const isBlockedKey = (key: string): boolean => BLOCKED_KEY.test(key);

const E164 = /\+[1-9]\d{7,14}\b/g;
const LOCAL_NG = /\b0[789][01]\d{8}\b/g;
const TRIP_LINK_TOKEN = /\buta_[A-Za-z0-9_-]{8,}/g;
// A long base64url run with BOTH cases is token-shaped (UUIDs and our
// snake_case codes are single-case, so they are left alone).
const TOKEN_SHAPED =
  /\b(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]{32,}\b/g;

/** "+234•••••78" — country code and last two digits only. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) {
    return "•••";
  }
  const head = phone.trim().startsWith("+")
    ? "+" + digits.slice(0, 3)
    : digits.slice(0, 1);
  return head + "•••••" + digits.slice(-2);
}

/** Masks phone numbers and removes token-shaped secrets from free text. */
export function scrubText(text: string): string {
  return text
    .replace(TRIP_LINK_TOKEN, "[link token redacted]")
    .replace(TOKEN_SHAPED, "[redacted]")
    .replace(E164, (m) => maskPhone(m))
    .replace(LOCAL_NG, (m) => maskPhone(m));
}

/**
 * Deep copy of a value with every blocked key replaced by "[redacted]" and
 * every string scrubbed. A string that is itself a JSON object (the outbox
 * `detail` column is the raw payload) is parsed and redacted too, so an
 * export can never carry a sealed envelope or a phone inside a string.
 */
export function redactDeep(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return redactDeep(JSON.parse(trimmed) as unknown);
      } catch {
        /* not JSON — scrub as text */
      }
    }
    return scrubText(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactDeep);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = isBlockedKey(key) ? "[redacted]" : redactDeep(inner);
    }
    return out;
  }
  return value;
}
