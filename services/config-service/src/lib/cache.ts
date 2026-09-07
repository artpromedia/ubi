/**
 * Redis cache for activated configs and flag snapshots.
 *
 * Two rules the slice depends on:
 *
 *  1. A cache miss must never serve a stale version after an activation. The
 *     naive read-through has a race — a reader can load the old row from
 *     Postgres, an activation can commit and invalidate, and only then does the
 *     reader write its stale value back with a fresh 60s TTL. Every scope
 *     therefore carries a generation counter that the invalidation bumps, and
 *     the fill is a compare-and-set against the generation observed *before*
 *     the database read. A fill that lost the race is dropped.
 *  2. Redis is never authoritative. Any Redis failure degrades to a direct
 *     Postgres read; it never fails the request and never invents a value.
 */
import type { Redis } from "ioredis";

import { CONFIG_CACHE_TTL_SEC } from "./env";
import { cacheLogger } from "./logger";
import { CONFIG_INVALIDATION_CHANNEL, redis as defaultRedis } from "./redis";

export type CacheKind = "config" | "flags";

export interface CacheScope {
  readonly kind: CacheKind;
  /** City the entry belongs to; global flag state uses GLOBAL_SCOPE. */
  readonly scopeId: string;
}

/** Flag rules with no city attached are cached under this scope id. */
export const GLOBAL_SCOPE = "__global__";

export interface InvalidationMessage {
  readonly kind: CacheKind;
  readonly scopeId: string;
  readonly version?: number;
  readonly at: string;
}

const entryKey = (scope: CacheScope): string =>
  `ubi:${scope.kind}:${scope.scopeId}:entry`;
const generationKey = (scope: CacheScope): string =>
  `ubi:${scope.kind}:${scope.scopeId}:gen`;

/**
 * SET the entry only if the generation is still the one the caller observed
 * before reading Postgres. KEYS[1] entry, KEYS[2] generation,
 * ARGV[1] payload, ARGV[2] observed generation, ARGV[3] ttl seconds.
 */
const FILL_IF_GENERATION_UNCHANGED = `
local current = redis.call('GET', KEYS[2])
if current == false then current = '0' end
if current ~= ARGV[2] then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
return 1
`;

export class ConfigCache {
  constructor(
    private readonly client: Redis = defaultRedis,
    private readonly ttlSec: number = CONFIG_CACHE_TTL_SEC,
  ) {}

  /**
   * Read through to `load`, caching the result for the configured TTL. `revive`
   * turns the cached JSON back into the domain value and rejects anything that
   * does not round-trip, so a poisoned or outdated cache entry degrades to a
   * database read rather than to a wrong answer.
   */
  async read<T>(
    scope: CacheScope,
    load: () => Promise<T>,
    revive: (raw: unknown) => T | undefined,
  ): Promise<T> {
    let observedGeneration: string | undefined;
    try {
      const [cached, generation] = await this.client.mget(
        entryKey(scope),
        generationKey(scope),
      );
      observedGeneration = generation ?? "0";
      if (cached !== null && cached !== undefined) {
        const revived = revive(JSON.parse(cached) as unknown);
        if (revived !== undefined) return revived;
        cacheLogger.warn({ scope }, "discarding unreadable cache entry");
      }
    } catch (err) {
      cacheLogger.error(
        { err, scope },
        "cache read failed; falling back to postgres",
      );
      observedGeneration = undefined;
    }

    const value = await load();

    if (observedGeneration !== undefined) {
      try {
        const filled = await this.client.eval(
          FILL_IF_GENERATION_UNCHANGED,
          2,
          entryKey(scope),
          generationKey(scope),
          JSON.stringify(value),
          observedGeneration,
          String(this.ttlSec),
        );
        if (filled === 0) {
          cacheLogger.info(
            { scope },
            "cache fill dropped: invalidated while loading",
          );
        }
      } catch (err) {
        cacheLogger.error({ err, scope }, "cache fill failed");
      }
    }

    return value;
  }

  /**
   * Bump the generation, drop the entry and tell every other reader. Called
   * after the activating transaction commits — one retry, because a lost
   * invalidation would leave stale config visible for the whole TTL.
   */
  async invalidate(
    scope: CacheScope,
    message: Omit<InvalidationMessage, "at">,
  ): Promise<void> {
    const payload: InvalidationMessage = {
      ...message,
      at: new Date().toISOString(),
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.client
          .multi()
          .incr(generationKey(scope))
          .del(entryKey(scope))
          .publish(CONFIG_INVALIDATION_CHANNEL, JSON.stringify(payload))
          .exec();
        return;
      } catch (err) {
        cacheLogger.error({ err, scope, attempt }, "cache invalidation failed");
      }
    }
    cacheLogger.fatal(
      { scope },
      "cache invalidation gave up; readers may serve stale config",
    );
  }
}

export const configCache = new ConfigCache();
