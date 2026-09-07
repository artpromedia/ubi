/**
 * Environment access for the config service.
 *
 * Nothing here carries a business default: currencies, fares, fees and
 * emergency numbers live in city config (CLAUDE.md #1, #6), never in env.
 */

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, received "${raw}"`);
  }
  return parsed;
}

/** Cache lifetime for an activated config or flag snapshot. Slice 01: 60s. */
export const CONFIG_CACHE_TTL_SEC = readInt("CONFIG_CACHE_TTL_SEC", 60);

export const PORT = readInt("PORT", 3010);

export const NODE_ENV = process.env.NODE_ENV ?? "development";

export const IS_PRODUCTION = NODE_ENV === "production";

/**
 * Shared secret for service-to-service calls. Only a caller that presents it may
 * evaluate flags on behalf of a user id it supplies itself; everyone else is
 * bound to the authenticated identity forwarded by the gateway.
 */
export function internalServiceKey(): string | undefined {
  const key = process.env.INTERNAL_SERVICE_KEY;
  return key === undefined || key === "" ? undefined : key;
}
