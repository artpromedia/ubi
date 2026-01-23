/**
 * Scheduled Jobs Service
 * UBI Payment System
 *
 * Manages cron jobs for automated tasks:
 * - Daily reconciliation
 * - Daily settlements
 * - Weekly payouts
 * - Health checks
 */

import { Currency, PaymentProvider, PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { jobsLogger } from "../lib/logger";
import { PayoutService } from "./payout.service";
import { ReconciliationService } from "./reconciliation.service";
import { SettlementService } from "./settlement.service";

// ===========================================
// TYPES
// ===========================================

interface JobConfig {
  name: string;
  schedule: string; // Cron expression
  enabled: boolean;
  lastRun?: Date;
  lastStatus?: "success" | "failure";
  lastError?: string;
}

interface ScheduledJob {
  config: JobConfig;
  handler: () => Promise<void>;
  timer?: NodeJS.Timeout;
}

interface JobResult {
  jobName: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  status: "success" | "failure";
  result?: unknown;
  error?: string;
}

// ===========================================
// SCHEDULED JOBS SERVICE
// ===========================================

export class ScheduledJobsService {
  private prisma: PrismaClient;
  private redis: Redis;
  private reconciliationService: ReconciliationService;
  private settlementService: SettlementService;

  private jobs: Map<string, ScheduledJob> = new Map();
  private isRunning: boolean = false;

  // Provider-currency mappings
  private readonly providerCurrencies: Partial<
    Record<PaymentProvider, Currency[]>
  > = {
    [PaymentProvider.PAYSTACK]: [
      Currency.NGN,
      Currency.GHS,
      Currency.ZAR,
      Currency.KES,
    ],
    [PaymentProvider.MPESA]: [Currency.KES],
    [PaymentProvider.MTN_MOMO_GH]: [Currency.GHS],
    [PaymentProvider.MTN_MOMO_RW]: [Currency.RWF],
    [PaymentProvider.AIRTEL_MONEY]: [],
  };

  constructor(
    prisma: PrismaClient,
    redis: Redis,
    reconciliationService: ReconciliationService,
    settlementService: SettlementService,
    _payoutService: PayoutService,
  ) {
    this.prisma = prisma;
    this.redis = redis;
    this.reconciliationService = reconciliationService;
    this.settlementService = settlementService;

    this.initializeJobs();
  }

  // ===========================================
  // JOB INITIALIZATION
  // ===========================================

  private initializeJobs(): void {
    // Daily Reconciliation - 2:00 AM
    this.registerJob({
      config: {
        name: "daily-reconciliation",
        schedule: "0 2 * * *",
        enabled: true,
      },
      handler: this.runDailyReconciliation.bind(this),
    });

    // Daily Balance Reconciliation - 2:30 AM
    this.registerJob({
      config: {
        name: "daily-balance-reconciliation",
        schedule: "30 2 * * *",
        enabled: true,
      },
      handler: this.runDailyBalanceReconciliation.bind(this),
    });

    // Daily Restaurant Settlements - 3:00 AM
    this.registerJob({
      config: {
        name: "daily-restaurant-settlements",
        schedule: "0 3 * * *",
        enabled: true,
      },
      handler: this.runDailyRestaurantSettlements.bind(this),
    });

    // Daily Merchant Settlements - 3:30 AM
    this.registerJob({
      config: {
        name: "daily-merchant-settlements",
        schedule: "30 3 * * *",
        enabled: true,
      },
      handler: this.runDailyMerchantSettlements.bind(this),
    });

    // Weekly Driver Payouts - Monday 3:00 AM
    this.registerJob({
      config: {
        name: "weekly-driver-payouts",
        schedule: "0 3 * * 1",
        enabled: true,
      },
      handler: this.runWeeklyDriverPayouts.bind(this),
    });

    // Hourly Health Check
    this.registerJob({
      config: {
        name: "provider-health-check",
        schedule: "0 * * * *",
        enabled: true,
      },
      handler: this.runProviderHealthCheck.bind(this),
    });

    // Expired Hold Cleanup - Every 15 minutes
    this.registerJob({
      config: {
        name: "expired-hold-cleanup",
        schedule: "*/15 * * * *",
        enabled: true,
      },
      handler: this.cleanupExpiredHolds.bind(this),
    });

    // Failed Payout Retry - Every 30 minutes
    this.registerJob({
      config: {
        name: "failed-payout-retry",
        schedule: "*/30 * * * *",
        enabled: true,
      },
      handler: this.retryFailedPayouts.bind(this),
    });

    // Daily Report Generation - 6:00 AM
    this.registerJob({
      config: {
        name: "daily-report-generation",
        schedule: "0 6 * * *",
        enabled: true,
      },
      handler: this.generateDailyReport.bind(this),
    });
  }

  private registerJob(job: ScheduledJob): void {
    this.jobs.set(job.config.name, job);
  }

  // ===========================================
  // JOB LIFECYCLE
  // ===========================================

  async start(): Promise<void> {
    if (this.isRunning) {
      jobsLogger.info("Scheduled jobs already running");
      return;
    }

    jobsLogger.info("Starting scheduled jobs service...");
    this.isRunning = true;

    for (const [name, job] of this.jobs) {
      if (job.config.enabled) {
        this.scheduleJob(name);
      }
    }

    jobsLogger.info(`Started ${this.jobs.size} scheduled jobs`);
  }

  async stop(): Promise<void> {
    jobsLogger.info("Stopping scheduled jobs service...");
    this.isRunning = false;

    for (const [_, job] of this.jobs) {
      if (job.timer) {
        clearTimeout(job.timer);
      }
    }

    jobsLogger.info("Scheduled jobs stopped");
  }

  private scheduleJob(jobName: string): void {
    const job = this.jobs.get(jobName);
    if (!job) return;

    const nextRun = this.getNextRunTime(job.config.schedule);
    const delay = nextRun.getTime() - Date.now();

    jobsLogger.info(
      `Scheduling ${jobName} to run at ${nextRun.toISOString()} (in ${Math.round(delay / 1000 / 60)} minutes)`,
    );

    job.timer = setTimeout(async () => {
      await this.executeJob(jobName);

      // Reschedule for next run
      if (this.isRunning && job.config.enabled) {
        this.scheduleJob(jobName);
      }
    }, delay);
  }

  private async executeJob(jobName: string): Promise<JobResult> {
    const job = this.jobs.get(jobName);
    if (!job) {
      throw new Error(`Job not found: ${jobName}`);
    }

    const startTime = new Date();
    jobsLogger.info(
      `[${jobName}] Starting execution at ${startTime.toISOString()}`,
    );

    // Acquire distributed lock to prevent duplicate execution
    const lockKey = `job:lock:${jobName}`;
    const lockAcquired = await this.acquireLock(lockKey, 3600); // 1 hour TTL

    if (!lockAcquired) {
      jobsLogger.info(`[${jobName}] Skipping - another instance is running`);
      return {
        jobName,
        startTime,
        endTime: new Date(),
        duration: 0,
        status: "failure",
        error: "Could not acquire lock",
      };
    }

    try {
      await job.handler();

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      job.config.lastRun = endTime;
      job.config.lastStatus = "success";
      job.config.lastError = undefined;

      jobsLogger.info(`[${jobName}] Completed successfully in ${duration}ms`);

      // Record job execution
      await this.recordJobExecution(jobName, "success", duration);

      return {
        jobName,
        startTime,
        endTime,
        duration,
        status: "success",
      };
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      job.config.lastRun = endTime;
      job.config.lastStatus = "failure";
      job.config.lastError = errorMessage;

      jobsLogger.error({ err: error }, `[${jobName}] Failed: ${errorMessage}`);

      // Record job execution
      await this.recordJobExecution(jobName, "failure", duration, errorMessage);

      // Send alert for failed job
      await this.sendJobFailureAlert(jobName, errorMessage);

      return {
        jobName,
        startTime,
        endTime,
        duration,
        status: "failure",
        error: errorMessage,
      };
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  // ===========================================
  // JOB HANDLERS
  // ===========================================

  private async runDailyReconciliation(): Promise<void> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const providers = [
      PaymentProvider.PAYSTACK,
      PaymentProvider.MPESA,
      PaymentProvider.MTN_MOMO_GH,
      PaymentProvider.MTN_MOMO_RW,
    ];

    for (const provider of providers) {
      const currencies = this.providerCurrencies[provider] || [];

      for (const currency of currencies) {
        try {
          jobsLogger.info(
            `Running reconciliation for ${provider} / ${currency}`,
          );
          await this.reconciliationService.runDailyReconciliation(
            provider,
            yesterday,
            currency,
          );
        } catch (error) {
          jobsLogger.error(
            { err: error },
            `Reconciliation failed for ${provider}/${currency}:`,
            error,
          );
          // Continue with other providers
        }
      }
    }
  }

  private async runDailyBalanceReconciliation(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const providers = [
      PaymentProvider.PAYSTACK,
      PaymentProvider.MPESA,
      PaymentProvider.MTN_MOMO_GH,
      PaymentProvider.MTN_MOMO_RW,
    ];

    for (const provider of providers) {
      const currencies = this.providerCurrencies[provider] || [];

      for (const currency of currencies) {
        try {
          jobsLogger.info(
            `Running balance reconciliation for ${provider} / ${currency}`,
          );
          await this.reconciliationService.runBalanceReconciliation(
            provider,
            currency,
          );
        } catch (error) {
          jobsLogger.error(
            { err: error },
            `Balance reconciliation failed for ${provider}/${currency}:`,
            error,
          );
        }
      }
    }
  }

  private async runDailyRestaurantSettlements(): Promise<void> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const currencies = [Currency.NGN, Currency.KES, Currency.GHS, Currency.ZAR];

    for (const currency of currencies) {
      try {
        jobsLogger.info(`Running restaurant settlements for ${currency}`);
        await this.settlementService.runDailyRestaurantSettlements(
          yesterday,
          currency,
        );
      } catch (error) {
        jobsLogger.error(
          { err: error },
          `Restaurant settlements failed for ${currency}:`,
          error,
        );
      }
    }
  }

  private async runDailyMerchantSettlements(): Promise<void> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    // Similar to restaurant settlements but for merchants
    const merchants = await this.prisma.merchant.findMany({
      where: { verifiedAt: { not: null } },
      select: { id: true, userId: true },
    });

    for (const merchant of merchants) {
      try {
        // Get merchant's pending earnings
        const earnings = await this.prisma.transaction.aggregate({
          where: {
            userId: merchant.userId,
            type: "DELIVERY_PAYMENT",
            status: "COMPLETED",
            createdAt: {
              gte: yesterday,
              lt: new Date(yesterday.getTime() + 24 * 60 * 60 * 1000),
            },
          },
          _sum: { amount: true },
        });

        const totalEarnings = earnings._sum.amount?.toNumber() || 0;
        if (totalEarnings > 0) {
          // Create settlement (simplified)
          jobsLogger.info(
            `Creating settlement for merchant ${merchant.id}: ${totalEarnings}`,
          );
        }
      } catch (error) {
        jobsLogger.error(
          { err: error },
          `Merchant settlement failed for ${merchant.id}:`,
          error,
        );
      }
    }
  }

  private async runWeeklyDriverPayouts(): Promise<void> {
    jobsLogger.info("Starting weekly driver payouts...");

    // Get all drivers with pending balances
    const driversWithBalances = await this.prisma.walletAccount.findMany({
      where: {
        type: "DRIVER_WALLET",
        balance: { gt: 0 },
      },
      include: {
        wallet: {
          include: {
            user: true,
          },
        },
      },
    });

    jobsLogger.info(
      `Found ${driversWithBalances.length} drivers with pending balances`,
    );

    for (const account of driversWithBalances) {
      try {
        // Use payout service to process
        jobsLogger.info(
          `Processing payout for driver ${account.wallet.userId}: ${account.balance}`,
        );
        // await this.payoutService.requestInstantCashout(account.wallet.userId, ...);
      } catch (error) {
        jobsLogger.error(
          { err: error },
          `Weekly payout failed for driver ${account.wallet.userId}:`,
          error,
        );
      }
    }
  }

  private async runProviderHealthCheck(): Promise<void> {
    const providers = [
      PaymentProvider.PAYSTACK,
      PaymentProvider.MPESA,
      PaymentProvider.MTN_MOMO_GH,
      PaymentProvider.MTN_MOMO_RW,
    ];

    for (const provider of providers) {
      try {
        // Check provider health (simplified)
        const health = await this.checkProviderHealth(provider);

        await this.prisma.providerHealth.upsert({
          where: { provider },
          create: {
            provider,
            isHealthy: health.isHealthy,
            avgResponseTime: health.responseTime,
            successRate: health.successRate,
            lastCheckAt: new Date(),
          },
          update: {
            isHealthy: health.isHealthy,
            avgResponseTime: health.responseTime,
            successRate: health.successRate,
            lastCheckAt: new Date(),
            consecutiveFailures: health.isHealthy ? 0 : { increment: 1 },
          },
        });
      } catch (error) {
        jobsLogger.error(
          { err: error },
          `Health check failed for ${provider}:`,
          error,
        );
      }
    }
  }

  private async cleanupExpiredHolds(): Promise<void> {
    const now = new Date();

    // Release expired holds
    const expiredHolds = await this.prisma.balanceHold.findMany({
      where: {
        isReleased: false,
        expiresAt: { lt: now },
      },
    });

    jobsLogger.info(`Found ${expiredHolds.length} expired holds to release`);

    for (const hold of expiredHolds) {
      try {
        await this.prisma.balanceHold.update({
          where: { id: hold.id },
          data: {
            isReleased: true,
            releasedAt: now,
          },
        });
      } catch (error) {
        jobsLogger.error(
          { err: error },
          `Failed to release hold ${hold.id}:`,
          error,
        );
      }
    }
  }

  private async retryFailedPayouts(): Promise<void> {
    // Find failed payouts that should be retried
    const failedPayouts = await this.prisma.payout.findMany({
      where: {
        status: "FAILED",
        retryCount: { lt: 3 },
        updatedAt: {
          lt: new Date(Date.now() - 30 * 60 * 1000), // At least 30 min old
        },
      },
      take: 50,
    });

    jobsLogger.info(`Found ${failedPayouts.length} failed payouts to retry`);

    for (const payout of failedPayouts) {
      try {
        jobsLogger.info(`Retrying payout ${payout.id}`);
        // await this.payoutService.retryPayout(payout.id);
      } catch (error) {
        jobsLogger.error(
          { err: error },
          `Retry failed for payout ${payout.id}:`,
          error,
        );
      }
    }
  }

  private async generateDailyReport(): Promise<void> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const endOfYesterday = new Date(yesterday);
    endOfYesterday.setHours(23, 59, 59, 999);

    // Generate daily report
    const report = {
      date: yesterday.toISOString().split("T")[0],
      transactions: await this.prisma.paymentTransaction.count({
        where: {
          createdAt: { gte: yesterday, lte: endOfYesterday },
        },
      }),
      completedTransactions: await this.prisma.paymentTransaction.count({
        where: {
          createdAt: { gte: yesterday, lte: endOfYesterday },
          status: "COMPLETED",
        },
      }),
      totalVolume: await this.prisma.paymentTransaction.aggregate({
        where: {
          createdAt: { gte: yesterday, lte: endOfYesterday },
          status: "COMPLETED",
        },
        _sum: { amount: true },
      }),
      payouts: await this.prisma.payout.count({
        where: {
          createdAt: { gte: yesterday, lte: endOfYesterday },
        },
      }),
      fraudAlerts: await this.prisma.riskAssessment.count({
        where: {
          createdAt: { gte: yesterday, lte: endOfYesterday },
          action: "BLOCK",
        },
      }),
    };

    jobsLogger.info({ report }, "Daily report generated");

    // Store report
    await this.redis.set(
      `report:daily:${report.date}`,
      JSON.stringify(report),
      "EX",
      30 * 24 * 60 * 60, // 30 days
    );
  }

  // ===========================================
  // HELPER METHODS
  // ===========================================

  private getNextRunTime(cronExpression: string): Date {
    // Simplified cron parser - in production use a library like 'cron-parser'
    const [minute, hour, _dayOfMonth, _month, dayOfWeek] =
      cronExpression.split(" ");

    const now = new Date();
    const next = new Date(now);

    // Handle hour and minute
    if (minute !== "*" && minute !== undefined) {
      next.setMinutes(parseInt(minute, 10));
    }
    if (hour !== "*" && hour !== undefined) {
      next.setHours(parseInt(hour, 10));
    }

    // If the calculated time is in the past, move to next occurrence
    if (next <= now) {
      if (dayOfWeek !== "*") {
        // Weekly job - move to next week
        next.setDate(next.getDate() + 7);
      } else if (hour !== "*") {
        // Daily job - move to tomorrow
        next.setDate(next.getDate() + 1);
      } else if (minute && minute !== "*" && minute.startsWith("*/")) {
        // Interval job - move to next interval
        const interval = parseInt(minute.substring(2), 10);
        next.setMinutes(
          Math.ceil((now.getMinutes() + 1) / interval) * interval,
        );
        if (next <= now) {
          next.setHours(next.getHours() + 1);
          next.setMinutes(0);
        }
      } else {
        next.setHours(next.getHours() + 1);
      }
    }

    next.setSeconds(0);
    next.setMilliseconds(0);

    return next;
  }

  private async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(key, "1", "EX", ttlSeconds, "NX");
    return result === "OK";
  }

  private async releaseLock(key: string): Promise<void> {
    await this.redis.del(key);
  }

  private async recordJobExecution(
    jobName: string,
    status: "success" | "failure",
    duration: number,
    error?: string,
  ): Promise<void> {
    const record = {
      jobName,
      status,
      duration,
      error,
      executedAt: new Date().toISOString(),
    };

    // Store in Redis list (keep last 100 executions)
    await this.redis.lpush(`job:history:${jobName}`, JSON.stringify(record));
    await this.redis.ltrim(`job:history:${jobName}`, 0, 99);
  }

  private async sendJobFailureAlert(
    jobName: string,
    error: string,
  ): Promise<void> {
    await this.prisma.alert.create({
      data: {
        type: "JOB_FAILURE",
        severity: "HIGH",
        title: `Scheduled Job Failed: ${jobName}`,
        message: `The scheduled job "${jobName}" failed with error: ${error}`,
        data: { jobName, error, timestamp: new Date().toISOString() },
      },
    });
  }

  private async checkProviderHealth(provider: PaymentProvider): Promise<{
    isHealthy: boolean;
    responseTime: number;
    successRate: number;
  }> {
    // Simplified health check - in production would call provider APIs
    const recentTransactions = await this.prisma.paymentTransaction.findMany({
      where: {
        provider,
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }, // Last hour
      },
      select: {
        status: true,
        confirmedAt: true,
        initiatedAt: true,
      },
      take: 100,
    });

    if (recentTransactions.length === 0) {
      return { isHealthy: true, responseTime: 0, successRate: 100 };
    }

    const successful = recentTransactions.filter(
      (t) => t.status === "COMPLETED",
    ).length;
    const successRate = (successful / recentTransactions.length) * 100;

    // Calculate average response time
    const responseTimes = recentTransactions
      .filter((t) => t.confirmedAt && t.initiatedAt)
      .map(
        (t) =>
          new Date(t.confirmedAt!).getTime() -
          new Date(t.initiatedAt).getTime(),
      );

    const avgResponseTime =
      responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0;

    return {
      isHealthy: successRate >= 95,
      responseTime: Math.round(avgResponseTime),
      successRate: Math.round(successRate * 100) / 100,
    };
  }

  // ===========================================
  // PUBLIC API
  // ===========================================

  getJobStatus(jobName: string): JobConfig | null {
    const job = this.jobs.get(jobName);
    return job?.config || null;
  }

  getAllJobStatuses(): JobConfig[] {
    return Array.from(this.jobs.values()).map((j) => j.config);
  }

  async triggerJob(jobName: string): Promise<JobResult> {
    const job = this.jobs.get(jobName);
    if (!job) {
      throw new Error(`Job not found: ${jobName}`);
    }

    return this.executeJob(jobName);
  }

  enableJob(jobName: string): void {
    const job = this.jobs.get(jobName);
    if (job) {
      job.config.enabled = true;
      if (this.isRunning) {
        this.scheduleJob(jobName);
      }
    }
  }

  disableJob(jobName: string): void {
    const job = this.jobs.get(jobName);
    if (job) {
      job.config.enabled = false;
      if (job.timer) {
        clearTimeout(job.timer);
      }
    }
  }

  async getJobHistory(
    jobName: string,
    limit: number = 10,
  ): Promise<JobResult[]> {
    const records = await this.redis.lrange(
      `job:history:${jobName}`,
      0,
      limit - 1,
    );
    return records.map((r) => JSON.parse(r));
  }
}

// ===========================================
// SINGLETON FACTORY
// ===========================================

let instance: ScheduledJobsService | null = null;

export function createScheduledJobsService(
  prisma: PrismaClient,
  redis: Redis,
  reconciliationService: ReconciliationService,
  settlementService: SettlementService,
  _payoutService: PayoutService,
): ScheduledJobsService {
  if (!instance) {
    instance = new ScheduledJobsService(
      prisma,
      redis,
      reconciliationService,
      settlementService,
      _payoutService,
    );
  }
  return instance;
}

export function getScheduledJobsService(): ScheduledJobsService {
  if (!instance) {
    throw new Error("ScheduledJobsService not initialized");
  }
  return instance;
}
