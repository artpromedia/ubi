/**
 * Performance Optimization Module
 *
 * Comprehensive caching and performance utilities for the payment service:
 * - Wallet balance caching with intelligent invalidation
 * - Payment method caching
 * - Provider health caching
 * - Query result caching
 * - Batch processing utilities
 * - Performance metrics collection
 */

import { perfLogger } from "./logger.js";
import { redis } from "./redis.js";

// =============================================================================
// CACHE KEY PREFIXES AND TTLs
// =============================================================================

export const CACHE_KEYS = {
  // Wallet caching
  WALLET_BALANCE: "wallet:balance:", // wallet:balance:{userId}:{currency}
  WALLET_ACCOUNT: "wallet:account:", // wallet:account:{accountId}
  WALLET_HOLDS: "wallet:holds:", // wallet:holds:{accountId}

  // Payment methods
  PAYMENT_METHODS: "payment:methods:", // payment:methods:{userId}
  DEFAULT_PAYMENT: "payment:default:", // payment:default:{userId}

  // Provider health
  PROVIDER_HEALTH: "provider:health:", // provider:health:{provider}
  PROVIDER_RATE: "provider:rate:", // provider:rate:{provider}

  // User data
  USER_PROFILE: "user:profile:", // user:profile:{userId}
  USER_LIMITS: "user:limits:", // user:limits:{userId}

  // Fraud velocity
  FRAUD_VELOCITY: "fraud:velocity:", // fraud:velocity:{userId}

  // Transaction status
  TXN_STATUS: "txn:status:", // txn:status:{transactionId}
} as const;

export const CACHE_TTL = {
  // Short-lived (for frequently changing data)
  WALLET_BALANCE: 30, // 30 seconds
  PROVIDER_HEALTH: 10, // 10 seconds
  TXN_STATUS: 60, // 1 minute

  // Medium-lived
  WALLET_ACCOUNT: 300, // 5 minutes
  WALLET_HOLDS: 60, // 1 minute
  PROVIDER_RATE: 300, // 5 minutes
  USER_LIMITS: 300, // 5 minutes
  FRAUD_VELOCITY: 300, // 5 minutes

  // Long-lived (for stable data)
  PAYMENT_METHODS: 600, // 10 minutes
  DEFAULT_PAYMENT: 600, // 10 minutes
  USER_PROFILE: 900, // 15 minutes
} as const;

// =============================================================================
// WALLET CACHE
// =============================================================================

export class WalletCache {
  private readonly prefix = CACHE_KEYS.WALLET_BALANCE;

  /**
   * Get cached wallet balance
   */
  async getBalance(
    userId: string,
    currency: string,
  ): Promise<{
    balance: number;
    availableBalance: number;
    heldBalance: number;
  } | null> {
    const key = `${this.prefix}${userId}:${currency}`;
    const cached = await redis.get(key);

    if (cached) {
      perfLogger.debug({ userId, currency }, "Wallet balance cache HIT");
      return JSON.parse(cached);
    }

    perfLogger.debug({ userId, currency }, "Wallet balance cache MISS");
    return null;
  }

  /**
   * Set cached wallet balance
   */
  async setBalance(
    userId: string,
    currency: string,
    balance: { balance: number; availableBalance: number; heldBalance: number },
  ): Promise<void> {
    const key = `${this.prefix}${userId}:${currency}`;
    await redis.setex(key, CACHE_TTL.WALLET_BALANCE, JSON.stringify(balance));
  }

  /**
   * Invalidate wallet balance cache
   */
  async invalidateBalance(userId: string, currency?: string): Promise<void> {
    if (currency) {
      await redis.del(`${this.prefix}${userId}:${currency}`);
    } else {
      // Invalidate all currencies for user
      const keys = await redis.keys(`${this.prefix}${userId}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
    perfLogger.debug({ userId, currency }, "Wallet balance cache invalidated");
  }

  /**
   * Get or fetch balance with caching
   */
  async getOrFetch(
    userId: string,
    currency: string,
    fetcher: () => Promise<{
      balance: number;
      availableBalance: number;
      heldBalance: number;
    }>,
  ): Promise<{
    balance: number;
    availableBalance: number;
    heldBalance: number;
  }> {
    const cached = await this.getBalance(userId, currency);
    if (cached) {
      return cached;
    }

    const data = await fetcher();
    await this.setBalance(userId, currency, data);
    return data;
  }
}

export const walletCache = new WalletCache();

// =============================================================================
// PAYMENT METHODS CACHE
// =============================================================================

export interface CachedPaymentMethod {
  id: string;
  type: string;
  provider: string;
  lastFour?: string;
  isDefault: boolean;
  [key: string]: unknown;
}

export class PaymentMethodsCache {
  private readonly prefix = CACHE_KEYS.PAYMENT_METHODS;

  /**
   * Get cached payment methods
   */
  async get(userId: string): Promise<CachedPaymentMethod[] | null> {
    const key = `${this.prefix}${userId}`;
    const cached = await redis.get(key);

    if (cached) {
      perfLogger.debug({ userId }, "Payment methods cache HIT");
      return JSON.parse(cached);
    }

    return null;
  }

  /**
   * Set cached payment methods
   */
  async set(userId: string, methods: CachedPaymentMethod[]): Promise<void> {
    const key = `${this.prefix}${userId}`;
    await redis.setex(key, CACHE_TTL.PAYMENT_METHODS, JSON.stringify(methods));
  }

  /**
   * Invalidate payment methods cache
   */
  async invalidate(userId: string): Promise<void> {
    await redis.del(`${this.prefix}${userId}`);
    await redis.del(`${CACHE_KEYS.DEFAULT_PAYMENT}${userId}`);
    perfLogger.debug({ userId }, "Payment methods cache invalidated");
  }

  /**
   * Get or fetch payment methods with caching
   */
  async getOrFetch(
    userId: string,
    fetcher: () => Promise<CachedPaymentMethod[]>,
  ): Promise<CachedPaymentMethod[]> {
    const cached = await this.get(userId);
    if (cached) {
      return cached;
    }

    const data = await fetcher();
    await this.set(userId, data);
    return data;
  }
}

export const paymentMethodsCache = new PaymentMethodsCache();

// =============================================================================
// PROVIDER HEALTH CACHE
// =============================================================================

export interface ProviderHealthStatus {
  provider: string;
  isHealthy: boolean;
  latencyMs: number;
  successRate: number;
  lastChecked: Date;
  errorMessage?: string;
}

export class ProviderHealthCache {
  private readonly prefix = CACHE_KEYS.PROVIDER_HEALTH;

  /**
   * Get cached provider health
   */
  async get(provider: string): Promise<ProviderHealthStatus | null> {
    const key = `${this.prefix}${provider}`;
    const cached = await redis.get(key);

    if (cached) {
      return JSON.parse(cached);
    }

    return null;
  }

  /**
   * Set provider health status
   */
  async set(provider: string, status: ProviderHealthStatus): Promise<void> {
    const key = `${this.prefix}${provider}`;
    await redis.setex(key, CACHE_TTL.PROVIDER_HEALTH, JSON.stringify(status));
  }

  /**
   * Get all provider health statuses
   */
  async getAll(): Promise<ProviderHealthStatus[]> {
    const keys = await redis.keys(`${this.prefix}*`);
    if (keys.length === 0) {
      return [];
    }

    const values = await redis.mget(...keys);
    return values
      .filter((v): v is string => v !== null)
      .map((v) => JSON.parse(v));
  }

  /**
   * Record provider latency
   */
  async recordLatency(provider: string, latencyMs: number): Promise<void> {
    const key = `${CACHE_KEYS.PROVIDER_RATE}${provider}:latency`;
    const multi = redis.multi();
    multi.lpush(key, latencyMs.toString());
    multi.ltrim(key, 0, 99); // Keep last 100 samples
    multi.expire(key, 3600); // 1 hour
    await multi.exec();
  }

  /**
   * Get average provider latency
   */
  async getAverageLatency(provider: string): Promise<number> {
    const key = `${CACHE_KEYS.PROVIDER_RATE}${provider}:latency`;
    const values = await redis.lrange(key, 0, -1);

    if (values.length === 0) {
      return 0;
    }

    const sum = values.reduce((acc, v) => acc + Number.parseInt(v, 10), 0);
    return Math.round(sum / values.length);
  }

  /**
   * Record provider success/failure
   */
  async recordResult(provider: string, success: boolean): Promise<void> {
    const hourKey = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
    const successKey = `${CACHE_KEYS.PROVIDER_RATE}${provider}:success:${hourKey}`;
    const totalKey = `${CACHE_KEYS.PROVIDER_RATE}${provider}:total:${hourKey}`;

    const multi = redis.multi();
    multi.incr(totalKey);
    if (success) {
      multi.incr(successKey);
    }
    multi.expire(successKey, 86400); // 24 hours
    multi.expire(totalKey, 86400);
    await multi.exec();
  }

  /**
   * Get provider success rate for current hour
   */
  async getSuccessRate(provider: string): Promise<number> {
    const hourKey = new Date().toISOString().slice(0, 13);
    const successKey = `${CACHE_KEYS.PROVIDER_RATE}${provider}:success:${hourKey}`;
    const totalKey = `${CACHE_KEYS.PROVIDER_RATE}${provider}:total:${hourKey}`;

    const [successCount, totalCount] = await redis.mget(successKey, totalKey);

    if (!totalCount || Number.parseInt(totalCount, 10) === 0) {
      return 1;
    }

    const success = Number.parseInt(successCount || "0", 10);
    const total = Number.parseInt(totalCount, 10);

    return success / total;
  }
}

export const providerHealthCache = new ProviderHealthCache();

// =============================================================================
// BATCH PROCESSOR
// =============================================================================

export interface BatchItem<T> {
  id: string;
  data: T;
}

export interface BatchResult<T, R> {
  id: string;
  data: T;
  result?: R;
  error?: Error;
}

export class BatchProcessor<T, R> {
  private readonly queue: Array<
    BatchItem<T> & {
      resolve: (value: R) => void;
      reject: (error: unknown) => void;
    }
  > = [];
  private processing = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly processor: (
      items: BatchItem<T>[],
    ) => Promise<Map<string, R>>,
    private readonly options: {
      maxBatchSize: number;
      maxWaitMs: number;
      onError?: (error: Error, items: BatchItem<T>[]) => void;
    },
  ) {}

  /**
   * Add item to batch and return result when processed
   */
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  add(item: BatchItem<T>): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const wrappedItem = {
        ...item,
        resolve,
        reject,
      };

      this.queue.push(wrappedItem);

      // Process immediately if batch is full
      if (this.queue.length >= this.options.maxBatchSize) {
        void this.flush();
      } else {
        // Start timer for partial batch
        this.timer ??= setTimeout(
          () => void this.flush(),
          this.options.maxWaitMs,
        );
      }
    });
  }

  /**
   * Flush and process current batch
   */
  private async flush(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const batch = this.queue.splice(0, this.options.maxBatchSize);

    try {
      const results = await this.processor(batch);

      for (const item of batch) {
        const result = results.get(item.id);
        if (result === undefined) {
          item.reject(new Error(`No result for item ${item.id}`));
        } else {
          item.resolve(result);
        }
      }
    } catch (error) {
      for (const item of batch) {
        item.reject(error);
      }
      this.options.onError?.(error as Error, batch);
    } finally {
      this.processing = false;

      // Process remaining items
      if (this.queue.length > 0) {
        void this.flush();
      }
    }
  }
}

// =============================================================================
// PERFORMANCE METRICS
// =============================================================================

export interface PerformanceMetric {
  name: string;
  value: number;
  timestamp: Date;
  tags?: Record<string, string>;
}

export class PerformanceMonitor {
  private readonly prefix = "perf:";

  /**
   * Record a timing metric
   */
  async recordTiming(
    operation: string,
    durationMs: number,
    tags?: Record<string, string>,
  ): Promise<void> {
    const key = `${this.prefix}timing:${operation}`;
    const hourKey = new Date().toISOString().slice(0, 13);

    const multi = redis.multi();

    // Store individual timing
    multi.lpush(`${key}:${hourKey}`, durationMs.toString());
    multi.ltrim(`${key}:${hourKey}`, 0, 999); // Keep last 1000 samples
    multi.expire(`${key}:${hourKey}`, 86400); // 24 hours

    // Update histogram buckets
    const bucket = this.getBucket(durationMs);
    multi.hincrby(`${key}:histogram:${hourKey}`, bucket, 1);
    multi.expire(`${key}:histogram:${hourKey}`, 86400);

    await multi.exec();

    // Log slow operations
    if (durationMs > 1000) {
      perfLogger.warn(
        { operation, durationMs, tags },
        "Slow operation detected",
      );
    }
  }

  /**
   * Get timing statistics for an operation
   */
  async getTimingStats(operation: string): Promise<{
    count: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
    min: number;
    max: number;
  }> {
    const key = `${this.prefix}timing:${operation}`;
    const hourKey = new Date().toISOString().slice(0, 13);

    const values = await redis.lrange(`${key}:${hourKey}`, 0, -1);

    if (values.length === 0) {
      return { count: 0, avg: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0 };
    }

    const numbers = values
      .map((v) => Number.parseInt(v, 10))
      .sort((a, b) => a - b);
    const count = numbers.length;

    return {
      count,
      avg: Math.round(numbers.reduce((a, b) => a + b, 0) / count),
      p50: numbers[Math.floor(count * 0.5)] ?? 0,
      p95: numbers[Math.floor(count * 0.95)] ?? 0,
      p99: numbers[Math.floor(count * 0.99)] ?? 0,
      min: numbers[0] ?? 0,
      max: numbers[count - 1] ?? 0,
    };
  }

  /**
   * Record a counter metric
   */
  async incrementCounter(
    name: string,
    value: number = 1,
    tags?: Record<string, string>,
  ): Promise<void> {
    const key = `${this.prefix}counter:${name}`;
    const dayKey = new Date().toISOString().slice(0, 10);

    await redis.hincrby(`${key}:${dayKey}`, "total", value);
    await redis.expire(`${key}:${dayKey}`, 604800); // 7 days

    if (tags) {
      for (const [tagKey, tagValue] of Object.entries(tags)) {
        await redis.hincrby(`${key}:${dayKey}`, `${tagKey}:${tagValue}`, value);
      }
    }
  }

  /**
   * Get counter value
   */
  async getCounter(name: string, date?: Date): Promise<number> {
    const key = `${this.prefix}counter:${name}`;
    const dayKey = (date || new Date()).toISOString().slice(0, 10);

    const value = await redis.hget(`${key}:${dayKey}`, "total");
    return Number.parseInt(value || "0", 10);
  }

  /**
   * Record cache hit/miss
   */
  async recordCacheMetric(cacheName: string, hit: boolean): Promise<void> {
    const key = `${this.prefix}cache:${cacheName}`;
    const hourKey = new Date().toISOString().slice(0, 13);

    const multi = redis.multi();
    multi.hincrby(`${key}:${hourKey}`, "total", 1);
    if (hit) {
      multi.hincrby(`${key}:${hourKey}`, "hits", 1);
    }
    multi.expire(`${key}:${hourKey}`, 86400);
    await multi.exec();
  }

  /**
   * Get cache hit rate
   */
  async getCacheHitRate(cacheName: string): Promise<number> {
    const key = `${this.prefix}cache:${cacheName}`;
    const hourKey = new Date().toISOString().slice(0, 13);

    const [total, hits] = await redis.hmget(
      `${key}:${hourKey}`,
      "total",
      "hits",
    );

    if (!total || Number.parseInt(total, 10) === 0) {
      return 0;
    }

    return Number.parseInt(hits || "0", 10) / Number.parseInt(total, 10);
  }

  private getBucket(value: number): string {
    const buckets = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
    for (const bucket of buckets) {
      if (value <= bucket) {
        return `le_${bucket}`;
      }
    }
    return "gt_10000";
  }

  /**
   * Create a timing wrapper for async functions
   */
  createTimer<TArgs extends unknown[], TResult>(
    operation: string,
    fn: (...args: TArgs) => Promise<TResult>,
    tags?: Record<string, string>,
  ): (...args: TArgs) => Promise<TResult> {
    return async (...args: TArgs): Promise<TResult> => {
      const start = Date.now();
      try {
        return await fn(...args);
      } finally {
        const duration = Date.now() - start;
        await this.recordTiming(operation, duration, tags);
      }
    };
  }
}

export const performanceMonitor = new PerformanceMonitor();

// =============================================================================
// QUERY OPTIMIZER HELPERS
// =============================================================================

/**
 * Optimized pagination helper
 */
export function buildPaginationQuery(
  page: number,
  pageSize: number,
  maxPageSize: number = 100,
): { skip: number; take: number } {
  const sanitizedPage = Math.max(1, page);
  const sanitizedPageSize = Math.min(Math.max(1, pageSize), maxPageSize);

  return {
    skip: (sanitizedPage - 1) * sanitizedPageSize,
    take: sanitizedPageSize,
  };
}

/**
 * Build efficient date range filter
 */
export function buildDateRangeFilter(
  startDate?: Date,
  endDate?: Date,
): { gte?: Date; lte?: Date } | undefined {
  if (!startDate && !endDate) {
    return undefined;
  }

  return {
    ...(startDate && { gte: startDate }),
    ...(endDate && { lte: endDate }),
  };
}

/**
 * Cursor-based pagination for large datasets
 */
export interface CursorPagination {
  cursor?: string;
  limit: number;
  direction?: "forward" | "backward";
}

export function buildCursorQuery(params: CursorPagination): {
  cursor?: { id: string };
  skip?: number;
  take: number;
} {
  const { cursor, limit, direction = "forward" } = params;

  return {
    ...(cursor && {
      cursor: { id: cursor },
      skip: 1, // Skip the cursor itself
    }),
    take: direction === "backward" ? -limit : limit,
  };
}

// =============================================================================
// CONNECTION POOL CONFIGURATION
// =============================================================================

export const DATABASE_POOL_CONFIG = {
  // Connection limits (configurable via DATABASE_URL params)
  connectionLimit: 25,
  minConnections: 5,

  // Timeouts
  connectionTimeoutMs: 10_000,
  idleTimeoutMs: 300_000,

  // Query settings
  statementCacheSize: 100,
  prepareThreshold: 5,
};

export const REDIS_POOL_CONFIG = {
  // Connection settings
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  enableOfflineQueue: true,

  // Timeouts
  connectTimeout: 10000,
  commandTimeout: 5000,

  // Connection pool (for cluster mode)
  maxRedirections: 16,
  retryDelayOnFailover: 100,
  retryDelayOnClusterDown: 100,
};

// =============================================================================
// EXPORTS
// =============================================================================

export { cache } from "./redis.js";
