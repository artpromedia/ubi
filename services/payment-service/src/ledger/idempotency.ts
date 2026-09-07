/**
 * Recognising the losing side of an idempotency race.
 *
 * Two requests carrying the same key can reach the ledger at once. Both are
 * refused by a unique index — one at the journal entry, one at the transfer,
 * top-up or bank instruction. CLAUDE.md #3 says the replay must return the
 * original result *including when the original attempt is still in flight*, so
 * the loser re-reads what the winner wrote instead of surfacing a raw
 * constraint violation.
 */
export function isIdempotencyRace(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") {
    return false;
  }
  const target = candidate.meta?.target;
  const fields = Array.isArray(target)
    ? target.map((field) => String(field))
    : typeof target === "string"
      ? [target]
      : [];
  return fields.some((field) => field.includes("idempotency_key"));
}
