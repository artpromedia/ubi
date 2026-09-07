/**
 * Identifier generation for the Bites module.
 *
 *  - `generateId` for rows created once and never replayed.
 *  - `deterministicId` for rows a replayed request must land on again: the
 *    scoped idempotency key hashes to the same primary key every time, so a
 *    replayed order-create collides on the unique key of the row the first
 *    attempt wrote and the handler returns the original order instead of
 *    creating a second one (CLAUDE.md #3). The guarantee is the database's
 *    unique key, not a lookup-then-insert race.
 *  - `numericCode` for the handover and delivery codes a human reads aloud.
 */
import { createHash, randomInt } from "node:crypto";

import { customAlphabet } from "nanoid";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 16);

export function generateId(prefix: string): string {
  return `${prefix}_${nanoid()}`;
}

export function deterministicId(prefix: string, scopedKey: string): string {
  const digest = createHash("sha256").update(scopedKey).digest("hex");
  return `${prefix}_${digest.slice(0, 24)}`;
}

/**
 * A short numeric code for the courier handover at the counter and the customer
 * delivery hand-off at the door. It authorises the physical transfer, so it is
 * generated server-side and compared server-side; the client never asserts it.
 */
export function numericCode(digits = 6): string {
  const max = 10 ** digits;
  return String(randomInt(0, max)).padStart(digits, "0");
}
