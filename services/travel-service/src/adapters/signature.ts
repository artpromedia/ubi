/**
 * Webhook signature verification.
 *
 * Every supplier callback is verified before it is trusted (CLAUDE.md #2, slice
 * NEW-02 — "Webhooks verified + deduped"). The shared secret lives in the
 * supplier's config row, never in code; a callback whose HMAC does not match is
 * recorded with `signature_ok = false` and never advances an order.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function computeSignature(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifySignature(
  secret: string,
  rawBody: string,
  provided: string | null | undefined,
): boolean {
  if (provided === null || provided === undefined || provided.length === 0) {
    return false;
  }
  const expected = computeSignature(secret, rawBody);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
