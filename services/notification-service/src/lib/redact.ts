/**
 * PII masking for logs, dead-letter records and error text (CLAUDE.md #12:
 * no PII in logs).
 *
 * The notification service handles phone numbers and, for the passenger trip
 * link, a one-time access token. Neither may ever reach a log line or a
 * dead-letter entry in clear: a phone is shown masked (country prefix and the
 * last two digits, enough for support to correlate a complaint) and a token is
 * never shown at all.
 */

/**
 * Mask a phone number: keep the leading "+" and up to three country-code
 * digits plus the last two digits, star the rest. Anything too short to mask
 * meaningfully is fully starred.
 *
 *   "+2348000000000" → "+234********00"
 */
export function maskPhone(phone: string): string {
  const value = phone.trim();
  if (value.length < 8) {
    return "*".repeat(Math.max(3, value.length));
  }
  const head = value.startsWith("+") ? value.slice(0, 4) : value.slice(0, 3);
  const tail = value.slice(-2);
  return `${head}${"*".repeat(value.length - head.length - tail.length)}${tail}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove every occurrence of the given secrets from free text (a provider's
 * error message can echo the destination number back). Phone numbers are
 * also removed without their leading "+", which is how some providers print
 * them. Empty secrets are ignored.
 */
export function redactSecrets(
  text: string,
  secrets: ReadonlyArray<string | null | undefined>,
): string {
  let out = text;
  const needles = new Set<string>();
  for (const secret of secrets) {
    if (typeof secret !== "string" || secret.length < 4) {
      continue;
    }
    needles.add(secret);
    if (secret.startsWith("+") && secret.length > 5) {
      needles.add(secret.slice(1));
    }
  }
  // Longest first, so a secret containing another is removed whole.
  for (const needle of [...needles].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(escapeRegExp(needle), "g"), "[redacted]");
  }
  return out;
}

/** A safe, bounded error description: message only, secrets removed. */
export function safeErrorText(
  err: unknown,
  secrets: ReadonlyArray<string | null | undefined> = [],
): string {
  let raw = "unknown error";
  if (err instanceof Error) {
    raw = err.message;
  } else if (typeof err === "string") {
    raw = err;
  }
  return redactSecrets(raw, secrets).slice(0, 300);
}
