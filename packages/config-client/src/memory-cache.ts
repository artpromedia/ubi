/**
 * Bounded in-process cache. Bounded because flag entries are keyed per user and
 * an unbounded map in a long-lived service is a leak, not a cache.
 */

export interface CacheEntry<T> {
  readonly value: T;
  readonly etag: string | undefined;
  /** Epoch millis after which the entry must be revalidated before use. */
  readonly expiresAt: number;
}

export class MemoryCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(private readonly maxEntries = 512) {}

  /** The entry whether or not it is fresh; callers decide what to do with a stale one. */
  peek(key: string): CacheEntry<T> | undefined {
    return this.entries.get(key);
  }

  fresh(key: string, now: number): CacheEntry<T> | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    return entry.expiresAt > now ? entry : undefined;
  }

  set(key: string, entry: CacheEntry<T>): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Drops every entry whose key starts with the prefix. Used on invalidation. */
  deleteByPrefix(prefix: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
