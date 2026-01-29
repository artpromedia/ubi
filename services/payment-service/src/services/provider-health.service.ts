/**
 * Provider Health Monitoring Service
 *
 * Continuously monitors payment provider health and performance.
 * Used for intelligent routing and failover decisions.
 */

import { perfLogger } from "../lib/logger.js";
import {
  performanceMonitor,
  providerHealthCache,
  type ProviderHealthStatus,
} from "../lib/performance.js";

export type ProviderName =
  | "mpesa"
  | "mtn_momo"
  | "airtel_money"
  | "paystack"
  | "flutterwave"
  | "telebirr"
  | "orange_money";

interface ProviderEndpoint {
  name: ProviderName;
  healthUrl: string;
  timeout: number;
}

// Provider health check endpoints
const PROVIDER_ENDPOINTS: ProviderEndpoint[] = [
  {
    name: "mpesa",
    healthUrl: process.env.MPESA_API_URL
      ? `${process.env.MPESA_API_URL}/health`
      : "https://sandbox.safaricom.co.ke",
    timeout: 10000,
  },
  {
    name: "mtn_momo",
    healthUrl: process.env.MTN_MOMO_API_URL
      ? `${process.env.MTN_MOMO_API_URL}/health`
      : "https://sandbox.momodeveloper.mtn.com",
    timeout: 10000,
  },
  {
    name: "airtel_money",
    healthUrl: process.env.AIRTEL_MONEY_API_URL || "https://airtel.money/api",
    timeout: 10000,
  },
  {
    name: "paystack",
    healthUrl: "https://api.paystack.co",
    timeout: 5000,
  },
  {
    name: "flutterwave",
    healthUrl: "https://api.flutterwave.com/v3",
    timeout: 5000,
  },
  {
    name: "telebirr",
    healthUrl: process.env.TELEBIRR_API_URL || "https://api.telebirr.et",
    timeout: 15000, // Ethiopian infrastructure may be slower
  },
  {
    name: "orange_money",
    healthUrl:
      process.env.ORANGE_MONEY_API_URL ||
      "https://api.orange.com/orange-money-webpay",
    timeout: 10000,
  },
];

/**
 * Check individual provider health
 */
async function checkProviderHealth(
  endpoint: ProviderEndpoint,
): Promise<ProviderHealthStatus> {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), endpoint.timeout);

    const response = await fetch(endpoint.healthUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    }).finally(() => clearTimeout(timeoutId));

    const latencyMs = Date.now() - startTime;
    const isHealthy = response.ok || response.status < 500;

    // Record metrics
    await providerHealthCache.recordLatency(endpoint.name, latencyMs);
    await providerHealthCache.recordResult(endpoint.name, isHealthy);

    const status: ProviderHealthStatus = {
      provider: endpoint.name,
      isHealthy,
      latencyMs,
      successRate: await providerHealthCache.getSuccessRate(endpoint.name),
      lastChecked: new Date(),
      errorMessage: isHealthy ? undefined : `HTTP ${response.status}`,
    };

    await providerHealthCache.set(endpoint.name, status);

    return status;
  } catch (error) {
    const latencyMs = Date.now() - startTime;

    // Record failure
    await providerHealthCache.recordLatency(endpoint.name, latencyMs);
    await providerHealthCache.recordResult(endpoint.name, false);

    const errorMessage =
      error instanceof Error
        ? error.name === "AbortError"
          ? `Timeout after ${endpoint.timeout}ms`
          : error.message
        : "Unknown error";

    const status: ProviderHealthStatus = {
      provider: endpoint.name,
      isHealthy: false,
      latencyMs,
      successRate: await providerHealthCache.getSuccessRate(endpoint.name),
      lastChecked: new Date(),
      errorMessage,
    };

    await providerHealthCache.set(endpoint.name, status);

    perfLogger.warn(
      { provider: endpoint.name, error: errorMessage, latencyMs },
      `Provider health check failed: ${endpoint.name}`,
    );

    return status;
  }
}

/**
 * Check all providers health
 */
export async function checkAllProvidersHealth(): Promise<
  Map<ProviderName, ProviderHealthStatus>
> {
  const results = new Map<ProviderName, ProviderHealthStatus>();

  const checks = await Promise.allSettled(
    PROVIDER_ENDPOINTS.map(async (endpoint) => checkProviderHealth(endpoint)),
  );

  for (let i = 0; i < checks.length; i++) {
    const check = checks[i];
    const endpoint = PROVIDER_ENDPOINTS[i];

    if (check.status === "fulfilled") {
      results.set(endpoint.name, check.value);
    } else {
      // Create failed status
      results.set(endpoint.name, {
        provider: endpoint.name,
        isHealthy: false,
        latencyMs: 0,
        successRate: 0,
        lastChecked: new Date(),
        errorMessage: check.reason?.message || "Health check failed",
      });
    }
  }

  return results;
}

/**
 * Get best provider for a given criteria
 */
export async function getBestProvider(
  preferredProviders: ProviderName[],
  options?: {
    maxLatencyMs?: number;
    minSuccessRate?: number;
  },
): Promise<ProviderName | null> {
  const maxLatencyMs = options?.maxLatencyMs ?? 5000;
  const minSuccessRate = options?.minSuccessRate ?? 0.8;

  for (const provider of preferredProviders) {
    const health = await providerHealthCache.get(provider);

    if (!health) {
      // No health data, try to check now
      const endpoint = PROVIDER_ENDPOINTS.find((e) => e.name === provider);
      if (endpoint) {
        const freshHealth = await checkProviderHealth(endpoint);
        if (
          freshHealth.isHealthy &&
          freshHealth.latencyMs < maxLatencyMs &&
          freshHealth.successRate >= minSuccessRate
        ) {
          return provider;
        }
      }
      continue;
    }

    if (
      health.isHealthy &&
      health.latencyMs < maxLatencyMs &&
      health.successRate >= minSuccessRate
    ) {
      return provider;
    }
  }

  // No healthy provider found, return first available
  perfLogger.warn(
    { preferredProviders },
    "No healthy provider found, falling back to first available",
  );
  return preferredProviders[0] || null;
}

/**
 * Provider health monitoring interval
 */
let healthCheckInterval: NodeJS.Timeout | null = null;

/**
 * Start provider health monitoring
 */
export function startProviderHealthMonitoring(
  intervalMs: number = 30000,
): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }

  perfLogger.info({ intervalMs }, "Starting provider health monitoring");

  // Initial check
  checkAllProvidersHealth().catch((error) => {
    perfLogger.error({ err: error }, "Initial provider health check failed");
  });

  // Schedule periodic checks
  healthCheckInterval = setInterval(async () => {
    try {
      await checkAllProvidersHealth();
    } catch (error) {
      perfLogger.error({ err: error }, "Provider health check failed");
    }
  }, intervalMs);
}

/**
 * Stop provider health monitoring
 */
export function stopProviderHealthMonitoring(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
    perfLogger.info("Stopped provider health monitoring");
  }
}

/**
 * Wrap provider operation with metrics
 */
export async function withProviderMetrics<T>(
  provider: ProviderName,
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const startTime = Date.now();
  let success = true;

  try {
    const result = await fn();
    return result;
  } catch (error) {
    success = false;
    throw error;
  } finally {
    const duration = Date.now() - startTime;

    // Record timing
    await performanceMonitor.recordTiming(
      `provider.${provider}.${operation}`,
      duration,
    );

    // Record success/failure
    await providerHealthCache.recordResult(provider, success);
    await providerHealthCache.recordLatency(provider, duration);

    // Increment counters
    await performanceMonitor.incrementCounter(
      `provider.${provider}.${operation}`,
      1,
      { success: success.toString() },
    );
  }
}

/**
 * Circuit breaker for provider calls
 */
export class ProviderCircuitBreaker {
  private failures = 0;
  private lastFailure: Date | null = null;
  private state: "closed" | "open" | "half-open" = "closed";

  constructor(
    private readonly provider: ProviderName,
    private readonly options: {
      failureThreshold: number;
      resetTimeoutMs: number;
      halfOpenRequests: number;
    } = {
      failureThreshold: 5,
      resetTimeoutMs: 30000,
      halfOpenRequests: 3,
    },
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should be reset
    if (
      this.state === "open" &&
      this.lastFailure &&
      Date.now() - this.lastFailure.getTime() > this.options.resetTimeoutMs
    ) {
      this.state = "half-open";
      this.failures = 0;
      perfLogger.info({ provider: this.provider }, "Circuit breaker half-open");
    }

    // If open, throw immediately
    if (this.state === "open") {
      throw new Error(`Circuit breaker open for provider ${this.provider}`);
    }

    try {
      const result = await fn();

      // Success - reset or close circuit
      if (this.state === "half-open") {
        this.state = "closed";
        perfLogger.info({ provider: this.provider }, "Circuit breaker closed");
      }
      this.failures = 0;

      return result;
    } catch (error) {
      this.failures++;
      this.lastFailure = new Date();

      if (this.failures >= this.options.failureThreshold) {
        this.state = "open";
        perfLogger.warn(
          { provider: this.provider, failures: this.failures },
          "Circuit breaker opened",
        );
      }

      throw error;
    }
  }

  getState(): "closed" | "open" | "half-open" {
    return this.state;
  }

  reset(): void {
    this.failures = 0;
    this.lastFailure = null;
    this.state = "closed";
  }
}

// Circuit breakers for each provider
export const circuitBreakers = new Map<ProviderName, ProviderCircuitBreaker>();

// Initialize circuit breakers
for (const endpoint of PROVIDER_ENDPOINTS) {
  circuitBreakers.set(endpoint.name, new ProviderCircuitBreaker(endpoint.name));
}

/**
 * Execute provider call with circuit breaker and metrics
 */
export async function executeProviderCall<T>(
  provider: ProviderName,
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const circuitBreaker = circuitBreakers.get(provider);

  if (!circuitBreaker) {
    return withProviderMetrics(provider, operation, fn);
  }

  return withProviderMetrics(provider, operation, async () =>
    circuitBreaker.execute(fn),
  );
}
