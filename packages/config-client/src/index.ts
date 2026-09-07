/**
 * @ubi/config-client — the shared, fail-closed reader for city config and
 * feature flags.
 *
 *   const config = createConfigClient({ baseUrl: process.env.CONFIG_SERVICE_URL, cache: redis });
 *   const city = await config.getCityConfig("LOS");   // rejects if unavailable
 *   const flags = await config.getFlags({ cityId: "LOS", userId });
 *   requireFlag(flags, "bites");                       // 404s when off
 *
 * Every number the apps show — currency, fares, wait and cancellation policy,
 * the emergency number — comes from `getCityConfig`. Nothing in this package
 * has a fallback value for any of them.
 */
export {
  ConfigClient,
  CONFIG_INVALIDATION_CHANNEL,
  createConfigClient,
} from "./client";
export { MemoryCache, type CacheEntry } from "./memory-cache";
export { flagEnabled, requireFlag } from "./flags";
export type {
  CacheStore,
  ConfigClientOptions,
  FetchLike,
  FlagQuery,
  InvalidationSubscriber,
} from "./types";
