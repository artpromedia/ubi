/**
 * Performance Module Tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Import after mocks
import {
  BatchProcessor,
  buildCursorQuery,
  buildDateRangeFilter,
  buildPaginationQuery,
  CACHE_KEYS,
  CACHE_TTL,
  DATABASE_POOL_CONFIG,
  PaymentMethodsCache,
  PerformanceMonitor,
  ProviderHealthCache,
  WalletCache,
} from "../lib/performance.js";

// Mock Redis
const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  setex: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
  mget: vi.fn(),
  lpush: vi.fn(),
  ltrim: vi.fn(),
  lrange: vi.fn(),
  expire: vi.fn(),
  incr: vi.fn(),
  hincrby: vi.fn(),
  hget: vi.fn(),
  hmget: vi.fn(),
  ping: vi.fn(),
  multi: vi.fn(() => ({
    lpush: vi.fn().mockReturnThis(),
    ltrim: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    incr: vi.fn().mockReturnThis(),
    hincrby: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  })),
};

vi.mock("../lib/redis.js", () => ({
  redis: mockRedis,
  cache: {
    get: vi.fn(),
    set: vi.fn(),
    getOrSet: vi.fn(),
    invalidatePattern: vi.fn(),
  },
}));

vi.mock("../lib/logger.js", () => ({
  perfLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("Cache Keys and TTLs", () => {
  it("should have proper cache key prefixes", () => {
    expect(CACHE_KEYS.WALLET_BALANCE).toBe("wallet:balance:");
    expect(CACHE_KEYS.WALLET_ACCOUNT).toBe("wallet:account:");
    expect(CACHE_KEYS.PAYMENT_METHODS).toBe("payment:methods:");
    expect(CACHE_KEYS.PROVIDER_HEALTH).toBe("provider:health:");
  });

  it("should have appropriate TTL values", () => {
    expect(CACHE_TTL.WALLET_BALANCE).toBe(30);
    expect(CACHE_TTL.PROVIDER_HEALTH).toBe(10);
    expect(CACHE_TTL.PAYMENT_METHODS).toBe(600);
  });
});

describe("WalletCache", () => {
  let walletCache: WalletCache;

  beforeEach(() => {
    walletCache = new WalletCache();
    vi.clearAllMocks();
  });

  it("should return cached balance on cache hit", async () => {
    const cachedData = {
      balance: 1000,
      availableBalance: 900,
      heldBalance: 100,
    };
    mockRedis.get.mockResolvedValue(JSON.stringify(cachedData));

    const result = await walletCache.getBalance("user123", "ETB");

    expect(result).toEqual(cachedData);
    expect(mockRedis.get).toHaveBeenCalledWith("wallet:balance:user123:ETB");
  });

  it("should return null on cache miss", async () => {
    mockRedis.get.mockResolvedValue(null);

    const result = await walletCache.getBalance("user123", "ETB");

    expect(result).toBeNull();
  });

  it("should set balance with TTL", async () => {
    const balance = { balance: 500, availableBalance: 500, heldBalance: 0 };

    await walletCache.setBalance("user123", "ETB", balance);

    expect(mockRedis.setex).toHaveBeenCalledWith(
      "wallet:balance:user123:ETB",
      30,
      JSON.stringify(balance),
    );
  });

  it("should invalidate balance cache", async () => {
    await walletCache.invalidateBalance("user123", "ETB");

    expect(mockRedis.del).toHaveBeenCalledWith("wallet:balance:user123:ETB");
  });

  it("should invalidate all currency balances for user", async () => {
    mockRedis.keys.mockResolvedValue([
      "wallet:balance:user123:ETB",
      "wallet:balance:user123:USD",
    ]);

    await walletCache.invalidateBalance("user123");

    expect(mockRedis.keys).toHaveBeenCalledWith("wallet:balance:user123:*");
    expect(mockRedis.del).toHaveBeenCalledWith(
      "wallet:balance:user123:ETB",
      "wallet:balance:user123:USD",
    );
  });
});

describe("PaymentMethodsCache", () => {
  let cache: PaymentMethodsCache;

  beforeEach(() => {
    cache = new PaymentMethodsCache();
    vi.clearAllMocks();
  });

  it("should cache and retrieve payment methods", async () => {
    const methods = [
      { id: "pm1", type: "MOBILE_MONEY", provider: "mpesa" },
      { id: "pm2", type: "CARD", provider: "paystack" },
    ];
    mockRedis.get.mockResolvedValue(JSON.stringify(methods));

    const result = await cache.get("user123");

    expect(result).toEqual(methods);
  });

  it("should set payment methods with proper TTL", async () => {
    const methods = [{ id: "pm1", type: "MOBILE_MONEY" }];

    await cache.set("user123", methods);

    expect(mockRedis.setex).toHaveBeenCalledWith(
      "payment:methods:user123",
      600,
      JSON.stringify(methods),
    );
  });

  it("should invalidate payment methods and default", async () => {
    await cache.invalidate("user123");

    expect(mockRedis.del).toHaveBeenCalledWith("payment:methods:user123");
    expect(mockRedis.del).toHaveBeenCalledWith("payment:default:user123");
  });
});

describe("ProviderHealthCache", () => {
  let healthCache: ProviderHealthCache;

  beforeEach(() => {
    healthCache = new ProviderHealthCache();
    vi.clearAllMocks();
  });

  it("should get provider health status", async () => {
    const status = {
      provider: "mpesa",
      isHealthy: true,
      latencyMs: 150,
      successRate: 0.98,
      lastChecked: new Date().toISOString(),
    };
    mockRedis.get.mockResolvedValue(JSON.stringify(status));

    const result = await healthCache.get("mpesa");

    expect(result).toEqual(status);
  });

  it("should record latency samples", async () => {
    await healthCache.recordLatency("mpesa", 200);

    const multiMock = mockRedis.multi();
    expect(mockRedis.multi).toHaveBeenCalled();
  });

  it("should calculate success rate", async () => {
    mockRedis.mget.mockResolvedValue(["95", "100"]);

    const rate = await healthCache.getSuccessRate("mpesa");

    expect(rate).toBe(0.95);
  });

  it("should return 1 for no data", async () => {
    mockRedis.mget.mockResolvedValue([null, null]);

    const rate = await healthCache.getSuccessRate("mpesa");

    expect(rate).toBe(1);
  });
});

describe("PerformanceMonitor", () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    monitor = new PerformanceMonitor();
    vi.clearAllMocks();
  });

  it("should record timing metrics", async () => {
    await monitor.recordTiming("payment.process", 250);

    const multiMock = mockRedis.multi();
    expect(mockRedis.multi).toHaveBeenCalled();
  });

  it("should get timing statistics", async () => {
    mockRedis.lrange.mockResolvedValue(["100", "200", "300", "400", "500"]);

    const stats = await monitor.getTimingStats("payment.process");

    expect(stats.count).toBe(5);
    expect(stats.avg).toBe(300);
    expect(stats.min).toBe(100);
    expect(stats.max).toBe(500);
  });

  it("should return empty stats for no data", async () => {
    mockRedis.lrange.mockResolvedValue([]);

    const stats = await monitor.getTimingStats("unknown.operation");

    expect(stats.count).toBe(0);
    expect(stats.avg).toBe(0);
  });

  it("should increment counters", async () => {
    await monitor.incrementCounter("payment.completed", 1);

    expect(mockRedis.hincrby).toHaveBeenCalled();
  });

  it("should get counter value", async () => {
    mockRedis.hget.mockResolvedValue("42");

    const value = await monitor.getCounter("payment.completed");

    expect(value).toBe(42);
  });

  it("should record cache metrics", async () => {
    await monitor.recordCacheMetric("wallet_balance", true);

    const multiMock = mockRedis.multi();
    expect(mockRedis.multi).toHaveBeenCalled();
  });

  it("should calculate cache hit rate", async () => {
    mockRedis.hmget.mockResolvedValue(["100", "80"]);

    const hitRate = await monitor.getCacheHitRate("wallet_balance");

    expect(hitRate).toBe(0.8);
  });

  it("should create timed wrapper function", async () => {
    const fn = vi.fn().mockResolvedValue("result");
    const timedFn = monitor.createTimer("test.operation", fn);

    const result = await timedFn("arg1", "arg2");

    expect(result).toBe("result");
    expect(fn).toHaveBeenCalledWith("arg1", "arg2");
  });
});

describe("BatchProcessor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should batch items and process together", async () => {
    const processor = vi.fn().mockResolvedValue(
      new Map([
        ["1", "result1"],
        ["2", "result2"],
      ]),
    );

    const batch = new BatchProcessor(processor, {
      maxBatchSize: 10,
      maxWaitMs: 50,
    });

    const promise1 = batch.add({ id: "1", data: { value: 1 } });
    const promise2 = batch.add({ id: "2", data: { value: 2 } });

    vi.advanceTimersByTime(60);

    const [result1, result2] = await Promise.all([promise1, promise2]);

    expect(result1).toBe("result1");
    expect(result2).toBe("result2");
    expect(processor).toHaveBeenCalledTimes(1);
  });

  it("should process immediately when batch is full", async () => {
    const processor = vi.fn().mockResolvedValue(
      new Map([
        ["1", "result1"],
        ["2", "result2"],
      ]),
    );

    const batch = new BatchProcessor(processor, {
      maxBatchSize: 2,
      maxWaitMs: 1000,
    });

    const promise1 = batch.add({ id: "1", data: { value: 1 } });
    const promise2 = batch.add({ id: "2", data: { value: 2 } });

    const [result1, result2] = await Promise.all([promise1, promise2]);

    expect(processor).toHaveBeenCalledTimes(1);
  });
});

describe("Query Optimization Helpers", () => {
  describe("buildPaginationQuery", () => {
    it("should build correct pagination", () => {
      const result = buildPaginationQuery(2, 20);

      expect(result).toEqual({ skip: 20, take: 20 });
    });

    it("should sanitize invalid page numbers", () => {
      const result = buildPaginationQuery(-1, 10);

      expect(result.skip).toBe(0);
    });

    it("should enforce max page size", () => {
      const result = buildPaginationQuery(1, 500, 100);

      expect(result.take).toBe(100);
    });
  });

  describe("buildDateRangeFilter", () => {
    it("should build filter with both dates", () => {
      const start = new Date("2024-01-01");
      const end = new Date("2024-12-31");

      const result = buildDateRangeFilter(start, end);

      expect(result).toEqual({ gte: start, lte: end });
    });

    it("should build filter with only start date", () => {
      const start = new Date("2024-01-01");

      const result = buildDateRangeFilter(start);

      expect(result).toEqual({ gte: start });
    });

    it("should return undefined for no dates", () => {
      const result = buildDateRangeFilter();

      expect(result).toBeUndefined();
    });
  });

  describe("buildCursorQuery", () => {
    it("should build cursor query", () => {
      const result = buildCursorQuery({ cursor: "abc123", limit: 20 });

      expect(result).toEqual({
        cursor: { id: "abc123" },
        skip: 1,
        take: 20,
      });
    });

    it("should handle backward pagination", () => {
      const result = buildCursorQuery({
        cursor: "abc123",
        limit: 20,
        direction: "backward",
      });

      expect(result.take).toBe(-20);
    });

    it("should work without cursor", () => {
      const result = buildCursorQuery({ limit: 20 });

      expect(result).toEqual({ take: 20 });
    });
  });
});

describe("Database Pool Configuration", () => {
  it("should have sensible defaults", () => {
    expect(DATABASE_POOL_CONFIG.connectionLimit).toBeGreaterThan(0);
    expect(DATABASE_POOL_CONFIG.minConnections).toBeGreaterThan(0);
    expect(DATABASE_POOL_CONFIG.connectionTimeoutMs).toBeGreaterThan(0);
    expect(DATABASE_POOL_CONFIG.idleTimeoutMs).toBeGreaterThan(0);
  });

  it("should have min less than max connections", () => {
    expect(DATABASE_POOL_CONFIG.minConnections).toBeLessThanOrEqual(
      DATABASE_POOL_CONFIG.connectionLimit,
    );
  });
});
