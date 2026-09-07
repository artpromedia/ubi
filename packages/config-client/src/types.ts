/**
 * Structural types for the pieces of the outside world this client touches.
 * Nothing here imports ioredis or node:http, so a consumer can pass whatever it
 * already has (including a test double) without the package taking a hard
 * dependency on a particular client.
 */

/** The subset of a Redis client the shared cache needs. `ioredis` satisfies it. */
export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    mode: "EX",
    ttlSeconds: number,
  ): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
}

/** The subset of a Redis subscriber connection used for invalidation. */
export interface InvalidationSubscriber {
  subscribe(channel: string): Promise<unknown>;
  on(
    event: "message",
    listener: (channel: string, message: string) => void,
  ): unknown;
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface ConfigClientOptions {
  /** Base URL of the config service, e.g. http://config-service:3010 */
  readonly baseUrl: string;
  /** Shared cache across processes. Optional: without it the client caches in-process only. */
  readonly cache?: CacheStore | undefined;
  /** Cache lifetime in seconds. Matches the service's own 60s TTL by default. */
  readonly ttlSec?: number | undefined;
  /** Per-request timeout. A slow config service must not hold up a ride request. */
  readonly timeoutMs?: number | undefined;
  /** Shared internal key, sent as X-Service-Key when evaluating flags for a user. */
  readonly serviceKey?: string | undefined;
  readonly fetch?: FetchLike | undefined;
  /** Injectable clock for tests. */
  readonly now?: (() => number) | undefined;
}

export interface FlagQuery {
  readonly cityId?: string | undefined;
  readonly userId?: string | undefined;
}
