/**
 * Identifiers. Every id is text (db/migrations/001).
 *
 * `deterministicId` turns an idempotency key into the primary key of the row it
 * creates, so a replayed request collides with its own earlier write instead of
 * creating a second row: the database enforces idempotency, not a cache.
 */
import { createHash, randomUUID } from "node:crypto";

function digest(input: string): string {
  return createHash("sha256").update(input).digest("base64url").slice(0, 24);
}

export function newId(prefix: string): string {
  return `${prefix}_${digest(randomUUID())}`;
}

export function deterministicId(prefix: string, ...parts: readonly string[]): string {
  return `${prefix}_${digest(parts.join("|"))}`;
}
