/**
 * Identifier generation.
 *
 * Two kinds of id are used here:
 *
 *  - `generateId` for rows created once and never replayed.
 *  - `deterministicId` for rows a replayed request must land on again. The
 *    scoped idempotency key hashes to the same primary key every time, so a
 *    replayed checkout collides with the trip and the per-item orders the first
 *    attempt wrote and the handler returns the original result instead of
 *    creating a second booking (CLAUDE.md #3). The idempotency guarantee is the
 *    database's unique primary key, never a lookup-then-insert race.
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
