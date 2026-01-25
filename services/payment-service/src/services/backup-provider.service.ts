/**
 * Backup Provider Service
 *
 * Implements intelligent payment routing with Flutterwave as backup provider
 * Features:
 * - Provider health monitoring
 * - Circuit breaker pattern
 * - Automatic failover
 * - Success rate tracking
 * - Geographic routing optimization
 */

import { FlutterwaveClient } from "../providers/flutterwave";
import { Currency, PaymentProvider } from "../types";

import type { PrismaClient } from "@prisma/client";

// Provider health status
interface ProviderHealth {
  provider: PaymentProvider;
  isHealthy: boolean;
  successRate: number;
  averageLatency: number;
  failureCount: number;
  lastCheck: Date;
  lastSuccess: Date | null;
  lastFailure: Date | null;
  circuitState: "CLOSED" | "OPEN" | "HALF_OPEN";
  consecutiveFailures: number;
}

// Circuit breaker configuration
interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening circuit
  successThreshold: number; // Number of successes before closing circuit
  timeout: number; // Time in ms before trying half-open
  windowSize: number; // Time window for tracking failures (ms)
}

// Routing strategy
interface RoutingStrategy {
  primary: PaymentProvider;
  backup: PaymentProvider;
  preferenceScore: number; // Higher = prefer primary
  criteria: RoutingCriteria;
}

// Routing criteria
interface RoutingCriteria {
  minSuccessRate: number;
  maxLatency: number;
  maxConsecutiveFailures: number;
}

// Transaction attempt record
interface TransactionAttempt {
  provider: PaymentProvider;
  success: boolean;
  latency: number;
  error?: string;
  timestamp: Date;
}

// Logger
const backupProviderLogger = {
  info: (data: Record<string, unknown>, message: string) =>
    console.log(`[BackupProvider] ${message}`, JSON.stringify(data)),
  warn: (data: Record<string, unknown>, message: string) =>
    console.warn(`[BackupProvider] ${message}`, JSON.stringify(data)),
  error: (data: Record<string, unknown>, message: string) =>
    console.error(`[BackupProvider] ${message}`, JSON.stringify(data)),
};

export class BackupProviderService {
  private readonly flutterwaveClient: FlutterwaveClient;
  private readonly providerHealth: Map<PaymentProvider, ProviderHealth>;
  private readonly circuitConfig: CircuitBreakerConfig;
  private readonly routingStrategies: Map<Currency, RoutingStrategy>;
  private transactionAttempts: TransactionAttempt[];
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(_prisma: PrismaClient) {
    this.flutterwaveClient = new FlutterwaveClient();
    this.providerHealth = new Map();
    this.transactionAttempts = [];

    // Default circuit breaker configuration
    this.circuitConfig = {
      failureThreshold: 5,
      successThreshold: 3,
      timeout: 30000, // 30 seconds
      windowSize: 60000, // 1 minute
    };

    // Initialize routing strategies per currency
    this.routingStrategies = new Map([
      [
        Currency.NGN,
        {
          primary: PaymentProvider.PAYSTACK,
          backup: PaymentProvider.FLUTTERWAVE,
          preferenceScore: 0.8,
          criteria: {
            minSuccessRate: 0.95,
            maxLatency: 5000,
            maxConsecutiveFailures: 3,
          },
        },
      ],
      [
        Currency.KES,
        {
          primary: PaymentProvider.MPESA,
          backup: PaymentProvider.FLUTTERWAVE,
          preferenceScore: 0.9,
          criteria: {
            minSuccessRate: 0.95,
            maxLatency: 10000,
            maxConsecutiveFailures: 3,
          },
        },
      ],
      [
        Currency.GHS,
        {
          primary: PaymentProvider.MTN_MOMO_GH,
          backup: PaymentProvider.FLUTTERWAVE,
          preferenceScore: 0.85,
          criteria: {
            minSuccessRate: 0.93,
            maxLatency: 8000,
            maxConsecutiveFailures: 3,
          },
        },
      ],
      [
        Currency.UGX,
        {
          primary: PaymentProvider.MTN_MOMO_UG,
          backup: PaymentProvider.FLUTTERWAVE,
          preferenceScore: 0.85,
          criteria: {
            minSuccessRate: 0.93,
            maxLatency: 8000,
            maxConsecutiveFailures: 3,
          },
        },
      ],
      [
        Currency.TZS,
        {
          primary: PaymentProvider.AIRTEL_MONEY_TZ,
          backup: PaymentProvider.FLUTTERWAVE,
          preferenceScore: 0.8,
          criteria: {
            minSuccessRate: 0.9,
            maxLatency: 10000,
            maxConsecutiveFailures: 3,
          },
        },
      ],
      [
        Currency.ZAR,
        {
          primary: PaymentProvider.FLUTTERWAVE,
          backup: PaymentProvider.PAYSTACK,
          preferenceScore: 0.9,
          criteria: {
            minSuccessRate: 0.95,
            maxLatency: 5000,
            maxConsecutiveFailures: 3,
          },
        },
      ],
    ]);

    // Initialize provider health
    this.initializeProviderHealth();
  }

  /**
   * Initialize health status for all providers
   */
  private initializeProviderHealth(): void {
    const providers = [
      PaymentProvider.PAYSTACK,
      PaymentProvider.FLUTTERWAVE,
      PaymentProvider.MPESA,
      PaymentProvider.MTN_MOMO_GH,
      PaymentProvider.MTN_MOMO_UG,
      PaymentProvider.MTN_MOMO_RW,
      PaymentProvider.AIRTEL_MONEY_KE,
      PaymentProvider.AIRTEL_MONEY_UG,
      PaymentProvider.AIRTEL_MONEY_TZ,
    ];

    for (const provider of providers) {
      this.providerHealth.set(provider, {
        provider,
        isHealthy: true,
        successRate: 1,
        averageLatency: 0,
        failureCount: 0,
        lastCheck: new Date(),
        lastSuccess: null,
        lastFailure: null,
        circuitState: "CLOSED",
        consecutiveFailures: 0,
      });
    }
  }

  /**
   * Start periodic health checks
   */
  startHealthMonitoring(intervalMs: number = 60000): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      await this.runHealthChecks();
    }, intervalMs);

    backupProviderLogger.info({ intervalMs }, "Health monitoring started");
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Run health checks for all providers
   */
  async runHealthChecks(): Promise<Map<PaymentProvider, ProviderHealth>> {
    const checks: Promise<void>[] = [];

    for (const [provider] of this.providerHealth) {
      checks.push(this.checkProviderHealth(provider));
    }

    await Promise.allSettled(checks);

    // Update circuit breaker states
    this.updateCircuitBreakers();

    return this.providerHealth;
  }

  /**
   * Check health of a specific provider
   */
  async checkProviderHealth(provider: PaymentProvider): Promise<void> {
    const health = this.providerHealth.get(provider);
    if (!health) {
      return;
    }

    const startTime = Date.now();
    let isHealthy = false;

    try {
      switch (provider) {
        case PaymentProvider.FLUTTERWAVE:
          isHealthy = await this.checkFlutterwaveHealth();
          break;
        case PaymentProvider.PAYSTACK:
          isHealthy = await this.checkPaystackHealth();
          break;
        case PaymentProvider.MPESA:
          isHealthy = await this.checkMpesaHealth();
          break;
        case PaymentProvider.MTN_MOMO_GH:
        case PaymentProvider.MTN_MOMO_UG:
        case PaymentProvider.MTN_MOMO_RW:
          isHealthy = await this.checkMoMoHealth(provider);
          break;
        case PaymentProvider.AIRTEL_MONEY_KE:
        case PaymentProvider.AIRTEL_MONEY_UG:
        case PaymentProvider.AIRTEL_MONEY_TZ:
          isHealthy = await this.checkAirtelHealth(provider);
          break;
        default:
          isHealthy = true;
      }
    } catch (error) {
      isHealthy = false;
      backupProviderLogger.error({ provider, error }, "Health check failed");
    }

    const latency = Date.now() - startTime;

    // Update health status
    health.isHealthy = isHealthy;
    health.lastCheck = new Date();

    if (isHealthy) {
      health.lastSuccess = new Date();
      health.consecutiveFailures = 0;
    } else {
      health.lastFailure = new Date();
      health.consecutiveFailures++;
      health.failureCount++;
    }

    // Update average latency (exponential moving average)
    health.averageLatency = health.averageLatency * 0.7 + latency * 0.3;

    // Calculate success rate from recent attempts
    health.successRate = this.calculateSuccessRate(provider);

    this.providerHealth.set(provider, health);
  }

  /**
   * Check Flutterwave API health
   */
  private async checkFlutterwaveHealth(): Promise<boolean> {
    try {
      const response = await fetch("https://api.flutterwave.com/v3/banks/NG", {
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
        },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check Paystack API health
   */
  private async checkPaystackHealth(): Promise<boolean> {
    try {
      const response = await fetch("https://api.paystack.co/bank", {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check M-Pesa API health
   */
  private async checkMpesaHealth(): Promise<boolean> {
    try {
      const consumerKey = process.env.MPESA_CONSUMER_KEY;
      const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
      if (!consumerKey || !consumerSecret) {
        return false;
      }

      const isSandbox = process.env.MPESA_ENVIRONMENT !== "production";
      const baseUrl = isSandbox
        ? "https://sandbox.safaricom.co.ke"
        : "https://api.safaricom.co.ke";

      const authString = Buffer.from(
        `${consumerKey}:${consumerSecret}`,
      ).toString("base64");

      const response = await fetch(
        `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
        {
          headers: { Authorization: `Basic ${authString}` },
          signal: AbortSignal.timeout(5000),
        },
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check MTN MoMo API health
   */
  private async checkMoMoHealth(provider: PaymentProvider): Promise<boolean> {
    try {
      const country = this.getMoMoCountry(provider);
      const subscriptionKey =
        process.env[`MTN_MOMO_${country}_SUBSCRIPTION_KEY`];
      if (!subscriptionKey) {
        return false;
      }

      const targetEnvironment = process.env.MTN_MOMO_ENVIRONMENT || "sandbox";
      const baseUrl =
        targetEnvironment === "sandbox"
          ? "https://sandbox.momodeveloper.mtn.com"
          : `https://proxy.momoapi.mtn.com/${country.toLowerCase()}`;

      // Check API availability via heartbeat
      const response = await fetch(`${baseUrl}/collection/v1_0/`, {
        headers: {
          "Ocp-Apim-Subscription-Key": subscriptionKey,
          "X-Target-Environment": targetEnvironment,
        },
        signal: AbortSignal.timeout(5000),
      });
      return response.status !== 500 && response.status !== 503;
    } catch {
      return false;
    }
  }

  /**
   * Check Airtel Money API health
   */
  private async checkAirtelHealth(provider: PaymentProvider): Promise<boolean> {
    try {
      const countryCode = this.getAirtelCountry(provider);
      const clientId = process.env[`AIRTEL_MONEY_${countryCode}_CLIENT_ID`];
      if (!clientId) {
        return false;
      }

      const baseUrl =
        process.env.AIRTEL_MONEY_ENVIRONMENT === "production"
          ? "https://openapi.airtel.africa"
          : "https://openapiuat.airtel.africa";

      // Check if auth endpoint is responsive
      const response = await fetch(`${baseUrl}/auth/oauth2/token`, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      return response.status !== 500 && response.status !== 503;
    } catch {
      return false;
    }
  }

  /**
   * Get MoMo country code from provider
   */
  private getMoMoCountry(provider: PaymentProvider): string {
    const countryMap: Record<string, string> = {
      [PaymentProvider.MTN_MOMO_GH]: "GH",
      [PaymentProvider.MTN_MOMO_UG]: "UG",
      [PaymentProvider.MTN_MOMO_RW]: "RW",
    };
    return countryMap[provider] || "GH";
  }

  /**
   * Get Airtel country code from provider
   */
  private getAirtelCountry(provider: PaymentProvider): string {
    const countryMap: Record<string, string> = {
      [PaymentProvider.AIRTEL_MONEY_KE]: "KE",
      [PaymentProvider.AIRTEL_MONEY_UG]: "UG",
      [PaymentProvider.AIRTEL_MONEY_TZ]: "TZ",
    };
    return countryMap[provider] || "KE";
  }

  /**
   * Handle state transition for CLOSED circuit
   */
  private handleClosedCircuit(
    provider: PaymentProvider,
    health: ProviderHealth,
  ): void {
    if (health.consecutiveFailures >= this.circuitConfig.failureThreshold) {
      health.circuitState = "OPEN";
      backupProviderLogger.warn(
        { provider, consecutiveFailures: health.consecutiveFailures },
        "Circuit breaker OPENED",
      );
    }
  }

  /**
   * Handle state transition for OPEN circuit
   */
  private handleOpenCircuit(
    provider: PaymentProvider,
    health: ProviderHealth,
  ): void {
    if (
      health.lastFailure &&
      Date.now() - health.lastFailure.getTime() > this.circuitConfig.timeout
    ) {
      health.circuitState = "HALF_OPEN";
      backupProviderLogger.info({ provider }, "Circuit breaker HALF-OPEN");
    }
  }

  /**
   * Handle state transition for HALF_OPEN circuit
   */
  private handleHalfOpenCircuit(
    provider: PaymentProvider,
    health: ProviderHealth,
  ): void {
    if (health.isHealthy) {
      health.circuitState = "CLOSED";
      health.consecutiveFailures = 0;
      backupProviderLogger.info({ provider }, "Circuit breaker CLOSED");
    } else {
      health.circuitState = "OPEN";
      backupProviderLogger.warn({ provider }, "Circuit breaker back to OPEN");
    }
  }

  /**
   * Update circuit breaker states based on health data
   */
  private updateCircuitBreakers(): void {
    for (const [provider, health] of this.providerHealth) {
      const oldState = health.circuitState;

      switch (health.circuitState) {
        case "CLOSED":
          this.handleClosedCircuit(provider, health);
          break;
        case "OPEN":
          this.handleOpenCircuit(provider, health);
          break;
        case "HALF_OPEN":
          this.handleHalfOpenCircuit(provider, health);
          break;
      }

      if (oldState !== health.circuitState) {
        this.providerHealth.set(provider, health);
      }
    }
  }

  /**
   * Calculate success rate for a provider from recent attempts
   */
  private calculateSuccessRate(provider: PaymentProvider): number {
    const windowMs = this.circuitConfig.windowSize;
    const cutoff = Date.now() - windowMs;

    const recentAttempts = this.transactionAttempts.filter(
      (a) => a.provider === provider && a.timestamp.getTime() > cutoff,
    );

    if (recentAttempts.length === 0) {
      return 1; // No recent data, assume healthy
    }

    const successes = recentAttempts.filter((a) => a.success).length;
    return successes / recentAttempts.length;
  }

  /**
   * Record a transaction attempt
   */
  recordAttempt(
    provider: PaymentProvider,
    success: boolean,
    latency: number,
    error?: string,
  ): void {
    this.transactionAttempts.push({
      provider,
      success,
      latency,
      error,
      timestamp: new Date(),
    });

    // Clean up old attempts
    const windowMs = this.circuitConfig.windowSize * 10; // Keep 10x window
    const cutoff = Date.now() - windowMs;
    this.transactionAttempts = this.transactionAttempts.filter(
      (a) => a.timestamp.getTime() > cutoff,
    );

    // Update provider health
    const health = this.providerHealth.get(provider);
    if (health) {
      if (success) {
        health.lastSuccess = new Date();
        health.consecutiveFailures = 0;
      } else {
        health.lastFailure = new Date();
        health.consecutiveFailures++;
        health.failureCount++;
      }
      health.successRate = this.calculateSuccessRate(provider);
      this.providerHealth.set(provider, health);

      // Update circuit breaker
      this.updateCircuitBreakers();
    }
  }

  /**
   * Select the best provider for a transaction
   */
  selectProvider(
    currency: Currency,
    _amount: number,
    _transactionType: "COLLECTION" | "DISBURSEMENT" = "COLLECTION",
  ): {
    provider: PaymentProvider;
    isBackup: boolean;
    reason: string;
  } {
    const strategy = this.routingStrategies.get(currency);

    if (!strategy) {
      // Default to Flutterwave for unsupported currencies
      return {
        provider: PaymentProvider.FLUTTERWAVE,
        isBackup: false,
        reason: "Default provider for currency",
      };
    }

    const primaryHealth = this.providerHealth.get(strategy.primary);
    const backupHealth = this.providerHealth.get(strategy.backup);

    // Check if primary is available
    const primaryAvailable = this.isProviderAvailable(
      strategy.primary,
      strategy.criteria,
    );

    // Check if backup is available
    const backupAvailable = this.isProviderAvailable(
      strategy.backup,
      strategy.criteria,
    );

    // Decision logic
    if (primaryAvailable) {
      // Check if we should still prefer primary based on preference score
      // and comparative success rates
      const shouldUseBackup =
        backupAvailable &&
        primaryHealth &&
        backupHealth &&
        backupHealth.successRate - primaryHealth.successRate > 0.1 &&
        Math.random() > strategy.preferenceScore;

      if (shouldUseBackup) {
        return {
          provider: strategy.backup,
          isBackup: true,
          reason: `Backup has higher success rate (${(backupHealth.successRate * 100).toFixed(1)}% vs ${(primaryHealth.successRate * 100).toFixed(1)}%)`,
        };
      }

      return {
        provider: strategy.primary,
        isBackup: false,
        reason: "Primary provider healthy",
      };
    }

    // Primary not available, check backup
    if (backupAvailable) {
      backupProviderLogger.warn(
        {
          currency,
          primary: strategy.primary,
          backup: strategy.backup,
          primaryHealth: primaryHealth?.circuitState,
        },
        "Routing to backup provider",
      );

      return {
        provider: strategy.backup,
        isBackup: true,
        reason: `Primary (${strategy.primary}) unavailable - ${primaryHealth?.circuitState}`,
      };
    }

    // Neither available - attempt primary anyway with warning
    backupProviderLogger.error(
      { currency, primary: strategy.primary, backup: strategy.backup },
      "Both providers unavailable, attempting primary",
    );

    return {
      provider: strategy.primary,
      isBackup: false,
      reason: "All providers degraded, attempting primary",
    };
  }

  /**
   * Check if a provider meets availability criteria
   */
  private isProviderAvailable(
    provider: PaymentProvider,
    criteria: RoutingCriteria,
  ): boolean {
    const health = this.providerHealth.get(provider);

    if (!health) {
      return false;
    }

    // Circuit breaker is open
    if (health.circuitState === "OPEN") {
      return false;
    }

    // Below minimum success rate
    if (health.successRate < criteria.minSuccessRate) {
      return false;
    }

    // Too many consecutive failures
    if (health.consecutiveFailures >= criteria.maxConsecutiveFailures) {
      return false;
    }

    // Too high latency
    if (health.averageLatency > criteria.maxLatency) {
      return false;
    }

    return true;
  }

  /**
   * Execute payment with automatic failover
   */
  async executeWithFailover<T>(
    currency: Currency,
    amount: number,
    primaryExecution: () => Promise<T>,
    backupExecution: () => Promise<T>,
  ): Promise<{
    result: T;
    provider: PaymentProvider;
    isBackup: boolean;
    attempts: number;
  }> {
    const selection = this.selectProvider(currency, amount);
    let attempts = 0;
    let lastError: Error | null = null;

    // Try primary first (if selected)
    if (!selection.isBackup) {
      attempts++;
      const startTime = Date.now();
      try {
        const result = await primaryExecution();
        this.recordAttempt(selection.provider, true, Date.now() - startTime);
        return {
          result,
          provider: selection.provider,
          isBackup: false,
          attempts,
        };
      } catch (error) {
        lastError = error as Error;
        this.recordAttempt(
          selection.provider,
          false,
          Date.now() - startTime,
          lastError.message,
        );
        backupProviderLogger.warn(
          { provider: selection.provider, error: lastError.message },
          "Primary execution failed, trying backup",
        );
      }
    }

    // Try backup
    attempts++;
    const strategy = this.routingStrategies.get(currency);
    const backupProvider = strategy?.backup || PaymentProvider.FLUTTERWAVE;

    const startTime = Date.now();
    try {
      const result = await backupExecution();
      this.recordAttempt(backupProvider, true, Date.now() - startTime);
      return {
        result,
        provider: backupProvider,
        isBackup: true,
        attempts,
      };
    } catch (error) {
      this.recordAttempt(
        backupProvider,
        false,
        Date.now() - startTime,
        (error as Error).message,
      );
      throw new Error(
        `Payment failed on both providers. Primary: ${lastError?.message || "skipped"}, Backup: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Get current health status of all providers
   */
  getHealthStatus(): Map<PaymentProvider, ProviderHealth> {
    return new Map(this.providerHealth);
  }

  /**
   * Get health status summary
   */
  getHealthSummary(): {
    healthy: PaymentProvider[];
    degraded: PaymentProvider[];
    unhealthy: PaymentProvider[];
  } {
    const healthy: PaymentProvider[] = [];
    const degraded: PaymentProvider[] = [];
    const unhealthy: PaymentProvider[] = [];

    for (const [provider, health] of this.providerHealth) {
      if (health.circuitState === "OPEN") {
        unhealthy.push(provider);
      } else if (
        health.circuitState === "HALF_OPEN" ||
        health.successRate < 0.95
      ) {
        degraded.push(provider);
      } else {
        healthy.push(provider);
      }
    }

    return { healthy, degraded, unhealthy };
  }

  /**
   * Force a provider health check
   */
  async forceHealthCheck(
    provider: PaymentProvider,
  ): Promise<ProviderHealth | undefined> {
    await this.checkProviderHealth(provider);
    return this.providerHealth.get(provider);
  }

  /**
   * Reset circuit breaker for a provider
   */
  resetCircuitBreaker(provider: PaymentProvider): void {
    const health = this.providerHealth.get(provider);
    if (health) {
      health.circuitState = "CLOSED";
      health.consecutiveFailures = 0;
      this.providerHealth.set(provider, health);
      backupProviderLogger.info({ provider }, "Circuit breaker manually reset");
    }
  }

  /**
   * Update routing strategy for a currency
   */
  updateRoutingStrategy(currency: Currency, strategy: RoutingStrategy): void {
    this.routingStrategies.set(currency, strategy);
    backupProviderLogger.info(
      { currency, primary: strategy.primary, backup: strategy.backup },
      "Routing strategy updated",
    );
  }

  /**
   * Get Flutterwave client for direct operations
   */
  getFlutterwaveClient(): FlutterwaveClient {
    return this.flutterwaveClient;
  }
}

// Singleton instance
let backupProviderServiceInstance: BackupProviderService | null = null;

// Create new instance
export function createBackupProviderService(
  prisma: PrismaClient,
): BackupProviderService {
  return new BackupProviderService(prisma);
}

// Get singleton instance
export function getBackupProviderService(
  prisma: PrismaClient,
): BackupProviderService {
  backupProviderServiceInstance ??= createBackupProviderService(prisma);
  return backupProviderServiceInstance;
}
