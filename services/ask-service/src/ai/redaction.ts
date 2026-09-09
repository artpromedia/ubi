/**
 * Redaction (CLAUDE.md rule #20).
 *
 * Card numbers, PINs, identity-document numbers and precise private addresses
 * must NEVER reach the model provider — in a prompt, in a tool result or in a
 * log. This module does two things:
 *
 *  1. `redact(text)` rewrites the sensitive spans it can recognise in free text
 *     into opaque placeholders before the text is shown to the model.
 *  2. `assertNoSensitive(payload)` is the belt-and-suspenders guard: it walks the
 *     *entire* request that is about to be sent to the provider and throws if any
 *     recognisable card / PIN / document / address pattern survived. A leak is a
 *     defect, not a soft warning, so it fails the call loudly.
 *
 * The recognisers are deliberately conservative on the redaction side (better to
 * over-redact a person's free text) and deliberately strict on the assertion
 * side (any residue is refused). Opaque references — payment-method ids, place
 * ids, order ids — are what the model is allowed to see; the authorised tools
 * resolve them to real values on the server, never the model.
 */
import { ContractError } from "@ubi/contracts";

/** A 13–19 digit run, optionally grouped by spaces or dashes, that passes Luhn. */
const CARD_LIKE = /\b(?:\d[ -]?){13,19}\b/g;
/** "PIN 1234", "pin: 4821", "my pin is 0007". */
const PIN_LABELLED = /\b(?:pin|passcode)\b\s*(?:is|=|:)?\s*\d{3,8}\b/gi;
/** Nigerian NIN (11 digits) / BVN (11 digits) / passport (1 letter + 8 digits). */
const NIN_BVN = /\b(?:nin|bvn)\b\s*(?:is|=|:)?\s*\d{9,11}\b/gi;
const PASSPORT = /\b[A-Z]\d{8}\b/g;
/** A street address: a house number followed by a street-type word. */
const STREET_ADDRESS =
  /\b\d{1,4}[a-z]?\s+[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,4}\s+(?:street|st|road|rd|avenue|ave|close|crescent|cres|drive|dr|lane|ln|way|boulevard|blvd|estate)\b/gi;

const PLACEHOLDER = {
  card: "[card omitted — resolved inside payment tools]",
  pin: "[pin omitted]",
  document: "[id document omitted]",
  address: "[address omitted — resolved inside a location tool]",
} as const;

function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    const ch = digits[i];
    if (ch === undefined) {
      return false;
    }
    let d = ch.charCodeAt(0) - 48;
    if (d < 0 || d > 9) {
      return false;
    }
    if (alt) {
      d *= 2;
      if (d > 9) {
        d -= 9;
      }
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** Rewrites recognisable sensitive spans in free text into opaque placeholders. */
export function redact(text: string): string {
  let out = text;
  out = out.replace(CARD_LIKE, (match) => {
    const digits = match.replace(/[^\d]/g, "");
    return digits.length >= 13 && luhnValid(digits) ? PLACEHOLDER.card : match;
  });
  out = out.replace(PIN_LABELLED, PLACEHOLDER.pin);
  out = out.replace(NIN_BVN, PLACEHOLDER.document);
  out = out.replace(PASSPORT, PLACEHOLDER.document);
  out = out.replace(STREET_ADDRESS, PLACEHOLDER.address);
  return out;
}

export interface SensitiveHit {
  readonly kind: "card" | "pin" | "document" | "address";
  readonly path: string;
}

function scanString(value: string, path: string, hits: SensitiveHit[]): void {
  for (const match of value.matchAll(CARD_LIKE)) {
    const digits = match[0].replace(/[^\d]/g, "");
    if (digits.length >= 13 && luhnValid(digits)) {
      hits.push({ kind: "card", path });
    }
  }
  if (PIN_LABELLED.test(value)) {
    hits.push({ kind: "pin", path });
  }
  if (NIN_BVN.test(value) || PASSPORT.test(value)) {
    hits.push({ kind: "document", path });
  }
  if (STREET_ADDRESS.test(value)) {
    hits.push({ kind: "address", path });
  }
  // Regexes with the global flag are stateful; reset lastIndex between scans.
  PIN_LABELLED.lastIndex = 0;
  NIN_BVN.lastIndex = 0;
  PASSPORT.lastIndex = 0;
  STREET_ADDRESS.lastIndex = 0;
}

function walk(value: unknown, path: string, hits: SensitiveHit[]): void {
  if (typeof value === "string") {
    scanString(value, path, hits);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walk(item, `${path}[${index}]`, hits);
    });
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      walk(child, path === "" ? key : `${path}.${key}`, hits);
    }
  }
}

/** Every sensitive span reachable in the payload; empty means clean. */
export function findSensitive(payload: unknown): readonly SensitiveHit[] {
  const hits: SensitiveHit[] = [];
  walk(payload, "", hits);
  return hits;
}

/**
 * Throws if any recognisable card / PIN / document / address pattern is present.
 * Called on the exact object about to be handed to the model provider, so a leak
 * cannot reach the model even if a tool or a redaction step missed it.
 */
export function assertNoSensitive(payload: unknown): void {
  const hits = findSensitive(payload);
  if (hits.length > 0) {
    throw new ContractError(
      "validation_failed",
      "sensitive data cannot be routed to the model provider",
      { kinds: [...new Set(hits.map((hit) => hit.kind))] },
    );
  }
}
