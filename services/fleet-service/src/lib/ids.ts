/**
 * Identifier generation.
 *
 *  - `generateId` for rows created once and never replayed.
 *  - `deterministicId` for rows a replayed request must land on again: the
 *    scoped idempotency key hashes to the same primary key every time, so a
 *    concurrent or retried duplicate collides on the database's unique key
 *    instead of racing a lookup-then-insert (CLAUDE.md #3).
 */
import { createHash } from "node:crypto";

import { customAlphabet } from "nanoid";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 16);

export function generateId(prefix: string): string {
  return `${prefix}_${nanoid()}`;
}

export function deterministicId(prefix: string, scopedKey: string): string {
  const digest = createHash("sha256").update(scopedKey).digest("hex");
  return `${prefix}_${digest.slice(0, 24)}`;
}

/** A stable digest of a JSON-able value with sorted keys. */
export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Vehicle and user ids are Postgres uuids; anything else matches nothing. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
