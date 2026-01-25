/**
 * Reconciliation Service
 *
 * Handles daily reconciliation of transactions between UBI and payment providers:
 * - Compare UBI transaction records with provider reports
 * - Detect discrepancies (missing, amount mismatch, status mismatch)
 * - Auto-resolve minor discrepancies
 * - Flag major discrepancies for manual review
 * - Generate reconciliation reports
 *
 * Reconciliation Types:
 * 1. Transaction Reconciliation - Match payment transactions
 * 2. Settlement Reconciliation - Match settlements with provider payouts
 * 3. Balance Reconciliation - Verify account balances
 *
 * Schedule:
 * - Daily reconciliation runs at 2:00 AM for previous day
 * - Real-time alerts for critical discrepancies
 * - Weekly summary reports
 */

import {
  Currency,
  PaymentProvider,
  PaymentStatus,
  PrismaClient,
} from "@prisma/client";
import { reconciliationLogger } from "../lib/logger";

/** Status of a balance reconciliation result */
type BalanceReconciliationStatus = "MATCHED" | "DISCREPANCY" | "ERROR";

export interface ReconciliationConfig {
  // Thresholds
  amountTolerancePercent: number; // 0.1% tolerance for amount matching
  amountToleranceFixed: number; // ₦10 fixed tolerance
  autoResolveLimit: number; // Auto-resolve discrepancies below this amount

  // Timing
  reconciliationHour: number; // Hour to run daily reconciliation (0-23)
  lookbackDays: number; // How many days back to reconcile

  // Alerts
  criticalDiscrepancyThreshold: number; // Alert if discrepancy exceeds this
  missingTransactionAlertDelay: number; // Hours before alerting on missing tx
}

export interface ProviderTransaction {
  reference: string;
  amount: number;
  currency: string;
  status: "success" | "failed" | "pending" | "reversed";
  timestamp: Date;
  fee?: number;
  metadata?: Record<string, any>;
}

export interface ReconciliationResult {
  id: string;
  date: Date;
  provider: PaymentProvider;
  currency: Currency;
  status: "COMPLETED" | "PENDING" | "FAILED";

  // Counts
  totalTransactions: number;
  matchedTransactions: number;
  discrepancies: number;

  // Amounts
  totalAmount: number;
  matchedAmount: number;
  discrepancyAmount: number;

  // Details
  missingInUbi: ProviderTransaction[];
  missingInProvider: string[]; // UBI transaction IDs
  amountMismatches: Array<{
    transactionId: string;
    ubiAmount: number;
    providerAmount: number;
    difference: number;
  }>;
  statusMismatches: Array<{
    transactionId: string;
    ubiStatus: string;
    providerStatus: string;
  }>;

  // Resolution
  autoResolved: number;
  manualReviewRequired: number;

  createdAt: Date;
  completedAt?: Date;
}

export interface ReconciliationDiscrepancy {
  id: string;
  reconciliationId: string;
  type:
    | "MISSING_IN_UBI"
    | "MISSING_IN_PROVIDER"
    | "AMOUNT_MISMATCH"
    | "STATUS_MISMATCH"
    | "FEE_MISMATCH";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  transactionId?: string;
  providerReference?: string;
  ubiAmount?: number;
  providerAmount?: number;
  difference?: number;
  ubiStatus?: string;
  providerStatus?: string;
  status: "PENDING" | "AUTO_RESOLVED" | "MANUALLY_RESOLVED" | "IGNORED";
  resolution?: string;
  resolvedBy?: string;
  resolvedAt?: Date;
  createdAt: Date;
}

export interface DiscrepancyDetails {
  // Identifiers
  transactionId?: string; // Internal UBI transaction ID
  providerReference?: string; // Provider's transaction reference

  // Discrepancy classification
  type:
    | "MISSING_IN_UBI"
    | "MISSING_IN_PROVIDER"
    | "AMOUNT_MISMATCH"
    | "STATUS_MISMATCH"
    | "FEE_MISMATCH";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

  // Amount details
  ubiAmount?: number; // Amount recorded in UBI system
  providerAmount?: number; // Amount reported by provider
  difference?: number; // Absolute difference between amounts

  // Status details
  ubiStatus?: string; // Transaction status in UBI system
  providerStatus?: string; // Transaction status from provider

  // Timestamps
  timestamp: Date; // When the discrepancy was detected
  transactionDate?: Date; // When the original transaction occurred

  // Resolution tracking
  status: "PENDING" | "AUTO_RESOLVED" | "MANUALLY_RESOLVED" | "IGNORED";
  resolution?: string; // Description of how it was resolved
  resolvedBy?: string; // User/system that resolved it
  resolvedAt?: Date; // When it was resolved

  // Additional context
  reconciliationId?: string; // Associated reconciliation run
  provider?: PaymentProvider; // Payment provider
  currency?: Currency; // Transaction currency
  metadata?: Record<string, any>; // Additional provider-specific data
}

export class ReconciliationService {
  private readonly config: ReconciliationConfig = {
    amountTolerancePercent: 0.1, // 0.1% tolerance
    amountToleranceFixed: 10, // ₦10 fixed tolerance
    autoResolveLimit: 100, // Auto-resolve below ₦100
    reconciliationHour: 2, // 2 AM
    lookbackDays: 7, // Reconcile up to 7 days back
    criticalDiscrepancyThreshold: 10000, // Alert above ₦10,000
    missingTransactionAlertDelay: 4, // Alert after 4 hours
  };

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Run daily reconciliation for a specific provider and date
   */
  async runDailyReconciliation(
    provider: PaymentProvider,
    date: Date,
    currency: Currency,
  ): Promise<ReconciliationResult> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    reconciliationLogger.info(
      `[Reconciliation] Starting daily reconciliation for ${provider} on ${date.toISOString().split("T")[0]}`,
    );

    // Create reconciliation record
    const reconciliation = await this.prisma.reconciliation.create({
      data: {
        provider,
        currency,
        date: startOfDay,
        status: "PENDING",
        totalTransactions: 0,
        matchedTransactions: 0,
        discrepancies: 0,
        totalAmount: 0,
        matchedAmount: 0,
        discrepancyAmount: 0,
      },
    });

    try {
      // Get UBI transactions for the day
      const ubiTransactions = await this.getUbiTransactions(
        provider,
        startOfDay,
        endOfDay,
        currency,
      );

      // Get provider transactions (from provider report or API)
      const providerTransactions = await this.getProviderTransactions(
        provider,
        startOfDay,
        endOfDay,
        currency,
      );

      // Reconcile transactions
      const result = await this.reconcileTransactions(
        reconciliation.id,
        ubiTransactions,
        providerTransactions,
        provider,
        currency,
      );

      // Update reconciliation record
      await this.prisma.reconciliation.update({
        where: { id: reconciliation.id },
        data: {
          status: result.discrepancies > 0 ? "PENDING" : "COMPLETED",
          totalTransactions: result.totalTransactions,
          matchedTransactions: result.matchedTransactions,
          discrepancies: result.discrepancies,
          totalAmount: result.totalAmount,
          matchedAmount: result.matchedAmount,
          discrepancyAmount: result.discrepancyAmount,
          completedAt: new Date(),
        },
      });

      // Alert on critical discrepancies
      if (result.discrepancyAmount > this.config.criticalDiscrepancyThreshold) {
        await this.sendCriticalAlert(reconciliation.id, {
          ...result,
          id: reconciliation.id,
          date: startOfDay,
          provider,
          currency,
          status: result.discrepancies > 0 ? "PENDING" : "COMPLETED",
          createdAt: reconciliation.createdAt,
          completedAt: new Date(),
        });
      }

      reconciliationLogger.info(
        `[Reconciliation] Completed for ${provider}: ${result.matchedTransactions}/${result.totalTransactions} matched, ${result.discrepancies} discrepancies`,
      );

      return {
        ...result,
        id: reconciliation.id,
        date: startOfDay,
        provider,
        currency,
        status: result.discrepancies > 0 ? "PENDING" : "COMPLETED",
        createdAt: reconciliation.createdAt,
        completedAt: new Date(),
      };
    } catch (error) {
      // Mark reconciliation as failed
      await this.prisma.reconciliation.update({
        where: { id: reconciliation.id },
        data: {
          status: "FAILED",
          metadata: {
            error: error instanceof Error ? error.message : "Unknown error",
          },
        },
      });

      throw error;
    }
  }

  /**
   * Get UBI transactions for reconciliation
   */
  private async getUbiTransactions(
    provider: PaymentProvider,
    startDate: Date,
    endDate: Date,
    currency: Currency,
  ): Promise<Map<string, any>> {
    const transactions = await this.prisma.paymentTransaction.findMany({
      where: {
        provider,
        currency,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        // Only reconcile completed or failed transactions
        status: {
          in: [
            PaymentStatus.COMPLETED,
            PaymentStatus.FAILED,
            PaymentStatus.REFUNDED,
          ],
        },
      },
      include: {
        payment: true,
      },
    });

    // Create map by provider reference for easy lookup
    const transactionMap = new Map<string, any>();
    for (const tx of transactions) {
      if (tx.providerReference) {
        transactionMap.set(tx.providerReference, tx);
      }
    }

    return transactionMap;
  }

  /**
   * Get provider transactions from provider report/API
   * This should be implemented for each provider
   */
  private async getProviderTransactions(
    provider: PaymentProvider,
    startDate: Date,
    endDate: Date,
    currency: Currency,
  ): Promise<Map<string, ProviderTransaction>> {
    // In production, this would:
    // 1. Download settlement report from provider (CSV/API)
    // 2. Parse and normalize the data
    // 3. Return as a Map for easy lookup

    const transactions = new Map<string, ProviderTransaction>();

    switch (provider) {
      case PaymentProvider.MPESA:
        return await this.getMpesaTransactions(startDate, endDate);

      case PaymentProvider.MTN_MOMO_GH:
      case PaymentProvider.MTN_MOMO_RW:
      case PaymentProvider.MTN_MOMO_UG:
        return await this.getMomoTransactions(provider, startDate, endDate);

      case PaymentProvider.PAYSTACK:
        return await this.getPaystackTransactions(startDate, endDate, currency);

      default:
        reconciliationLogger.warn(
          { provider },
          "No provider implementation for reconciliation",
        );
        return transactions;
    }
  }

  /**
   * Get M-Pesa transactions from Safaricom portal/API
   */
  private async getMpesaTransactions(
    startDate: Date,
    endDate: Date,
  ): Promise<Map<string, ProviderTransaction>> {
    const transactions = new Map<string, ProviderTransaction>();

    // In production, you would:
    // 1. Call M-Pesa Transaction Status API for each pending transaction
    // 2. Or download the M-Pesa statement from Safaricom portal
    // 3. Parse the CSV/PDF report

    // For now, we'll query our stored provider responses
    const paymentTxs = await this.prisma.paymentTransaction.findMany({
      where: {
        provider: PaymentProvider.MPESA,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        providerResponse: {
          not: null,
        },
      },
    });

    for (const tx of paymentTxs) {
      if (tx.providerReference) {
        const providerResponse = tx.providerResponse;
        transactions.set(tx.providerReference, {
          reference: tx.providerReference,
          amount: Number(tx.amount),
          currency: tx.currency,
          status: this.mapMpesaStatus(providerResponse?.ResultCode),
          timestamp: tx.confirmedAt || tx.createdAt,
          metadata: providerResponse,
        });
      }
    }

    return transactions;
  }

  /**
   * Get MTN MoMo transactions
   */
  private async getMomoTransactions(
    provider: PaymentProvider,
    startDate: Date,
    endDate: Date,
  ): Promise<Map<string, ProviderTransaction>> {
    const transactions = new Map<string, ProviderTransaction>();

    // Query stored transactions and their provider responses
    const paymentTxs = await this.prisma.paymentTransaction.findMany({
      where: {
        provider,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        providerResponse: {
          not: null,
        },
      },
    });

    for (const tx of paymentTxs) {
      if (tx.providerReference) {
        const providerResponse = tx.providerResponse;
        transactions.set(tx.providerReference, {
          reference: tx.providerReference,
          amount: Number(tx.amount),
          currency: tx.currency,
          status: this.mapMomoStatus(providerResponse?.status),
          timestamp: tx.confirmedAt || tx.createdAt,
          metadata: providerResponse,
        });
      }
    }

    return transactions;
  }

  /**
   * Get Paystack transactions from Paystack API
   */
  private async getPaystackTransactions(
    startDate: Date,
    endDate: Date,
    currency: Currency,
  ): Promise<Map<string, ProviderTransaction>> {
    const transactions = new Map<string, ProviderTransaction>();

    // In production, call Paystack API to list transactions
    // GET /transaction?from={startDate}&to={endDate}&currency={currency}

    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      reconciliationLogger.warn("Paystack secret key not configured");
      return transactions;
    }

    try {
      const response = await fetch(
        `https://api.paystack.co/transaction?from=${startDate.toISOString()}&to=${endDate.toISOString()}&currency=${currency}&perPage=500`,
        {
          headers: {
            Authorization: `Bearer ${secretKey}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Paystack API error: ${response.status}`);
      }

      const data = (await response.json()) as any;

      if (data.status && data.data) {
        for (const tx of data.data) {
          transactions.set(tx.reference, {
            reference: tx.reference,
            amount: tx.amount / 100, // Paystack uses kobo
            currency: tx.currency,
            status: tx.status === "success" ? "success" : "failed",
            timestamp: new Date(tx.paid_at || tx.created_at),
            fee: tx.fees / 100,
            metadata: tx,
          });
        }
      }
    } catch (error) {
      reconciliationLogger.error(
        { err: error },
        "[Reconciliation] Failed to fetch Paystack transactions",
      );
    }

    return transactions;
  }

  /**
   * Reconcile UBI transactions with provider transactions
   */
  private async reconcileTransactions(
    reconciliationId: string,
    ubiTransactions: Map<string, any>,
    providerTransactions: Map<string, ProviderTransaction>,
    _provider: PaymentProvider,
    _currency: Currency,
  ): Promise<{
    totalTransactions: number;
    matchedTransactions: number;
    discrepancies: number;
    totalAmount: number;
    matchedAmount: number;
    discrepancyAmount: number;
    missingInUbi: ProviderTransaction[];
    missingInProvider: string[];
    amountMismatches: Array<{
      transactionId: string;
      ubiAmount: number;
      providerAmount: number;
      difference: number;
    }>;
    statusMismatches: Array<{
      transactionId: string;
      ubiStatus: string;
      providerStatus: string;
    }>;
    autoResolved: number;
    manualReviewRequired: number;
  }> {
    const result = {
      totalTransactions: 0,
      matchedTransactions: 0,
      discrepancies: 0,
      totalAmount: 0,
      matchedAmount: 0,
      discrepancyAmount: 0,
      missingInUbi: [] as ProviderTransaction[],
      missingInProvider: [] as string[],
      amountMismatches: [] as Array<{
        transactionId: string;
        ubiAmount: number;
        providerAmount: number;
        difference: number;
      }>,
      statusMismatches: [] as Array<{
        transactionId: string;
        ubiStatus: string;
        providerStatus: string;
      }>,
      autoResolved: 0,
      manualReviewRequired: 0,
    };

    // Track which provider transactions we've seen
    const seenProviderRefs = new Set<string>();

    // Check each UBI transaction against provider
    for (const [reference, ubiTx] of ubiTransactions) {
      result.totalTransactions++;
      result.totalAmount += Number(ubiTx.amount);

      const providerTx = providerTransactions.get(reference);

      if (!providerTx) {
        // Missing in provider
        result.missingInProvider.push(ubiTx.id);
        result.discrepancies++;
        result.discrepancyAmount += Number(ubiTx.amount);

        await this.createDiscrepancy(reconciliationId, {
          type: "MISSING_IN_PROVIDER",
          severity: this.calculateSeverity(Number(ubiTx.amount)),
          transactionId: ubiTx.id,
          providerReference: reference,
          ubiAmount: Number(ubiTx.amount),
        });

        continue;
      }

      seenProviderRefs.add(reference);

      // Check amount match
      const amountDiff = Math.abs(Number(ubiTx.amount) - providerTx.amount);
      const amountTolerance = Math.max(
        Number(ubiTx.amount) * (this.config.amountTolerancePercent / 100),
        this.config.amountToleranceFixed,
      );

      if (amountDiff > amountTolerance) {
        result.amountMismatches.push({
          transactionId: ubiTx.id,
          ubiAmount: Number(ubiTx.amount),
          providerAmount: providerTx.amount,
          difference: amountDiff,
        });
        result.discrepancies++;
        result.discrepancyAmount += amountDiff;

        const discrepancy = await this.createDiscrepancy(reconciliationId, {
          type: "AMOUNT_MISMATCH",
          severity: this.calculateSeverity(amountDiff),
          transactionId: ubiTx.id,
          providerReference: reference,
          ubiAmount: Number(ubiTx.amount),
          providerAmount: providerTx.amount,
          difference: amountDiff,
        });

        // Auto-resolve small discrepancies
        if (amountDiff <= this.config.autoResolveLimit) {
          await this.autoResolveDiscrepancy(
            discrepancy.id,
            "Amount within tolerance",
          );
          result.autoResolved++;
        } else {
          result.manualReviewRequired++;
        }

        continue;
      }

      // Check status match
      const ubiStatus = this.mapUbiStatus(ubiTx.status);
      if (ubiStatus !== providerTx.status) {
        result.statusMismatches.push({
          transactionId: ubiTx.id,
          ubiStatus,
          providerStatus: providerTx.status,
        });
        result.discrepancies++;

        await this.createDiscrepancy(reconciliationId, {
          type: "STATUS_MISMATCH",
          severity: "HIGH",
          transactionId: ubiTx.id,
          providerReference: reference,
          ubiStatus,
          providerStatus: providerTx.status,
        });

        result.manualReviewRequired++;
        continue;
      }

      // Transaction matched
      result.matchedTransactions++;
      result.matchedAmount += Number(ubiTx.amount);
    }

    // Check for transactions in provider but not in UBI
    for (const [reference, providerTx] of providerTransactions) {
      if (!seenProviderRefs.has(reference) && providerTx.status === "success") {
        result.missingInUbi.push(providerTx);
        result.discrepancies++;
        result.discrepancyAmount += providerTx.amount;

        await this.createDiscrepancy(reconciliationId, {
          type: "MISSING_IN_UBI",
          severity: this.calculateSeverity(providerTx.amount),
          providerReference: reference,
          providerAmount: providerTx.amount,
        });

        result.manualReviewRequired++;
      }
    }

    return result;
  }

  /**
   * Create a discrepancy record
   */
  private async createDiscrepancy(
    reconciliationId: string,
    data: {
      type: ReconciliationDiscrepancy["type"];
      severity: ReconciliationDiscrepancy["severity"];
      transactionId?: string;
      providerReference?: string;
      ubiAmount?: number;
      providerAmount?: number;
      difference?: number;
      ubiStatus?: string;
      providerStatus?: string;
    },
  ): Promise<{ id: string }> {
    return await this.prisma.reconciliationDiscrepancy.create({
      data: {
        reconciliationId,
        type: data.type,
        severity: data.severity,
        transactionId: data.transactionId,
        providerReference: data.providerReference,
        ubiAmount: data.ubiAmount,
        providerAmount: data.providerAmount,
        difference: data.difference,
        ubiStatus: data.ubiStatus,
        providerStatus: data.providerStatus,
        status: "PENDING",
      },
    });
  }

  /**
   * Auto-resolve a discrepancy
   */
  private async autoResolveDiscrepancy(
    discrepancyId: string,
    resolution: string,
  ): Promise<void> {
    await this.prisma.reconciliationDiscrepancy.update({
      where: { id: discrepancyId },
      data: {
        status: "AUTO_RESOLVED",
        resolution,
        resolvedAt: new Date(),
        resolvedBy: "SYSTEM",
      },
    });
  }

  /**
   * Manually resolve a discrepancy
   */
  async resolveDiscrepancy(
    discrepancyId: string,
    resolution: string,
    resolvedBy: string,
  ): Promise<void> {
    await this.prisma.reconciliationDiscrepancy.update({
      where: { id: discrepancyId },
      data: {
        status: "MANUALLY_RESOLVED",
        resolution,
        resolvedAt: new Date(),
        resolvedBy,
      },
    });

    // Check if all discrepancies for the reconciliation are resolved
    const discrepancy = await this.prisma.reconciliationDiscrepancy.findUnique({
      where: { id: discrepancyId },
    });

    if (discrepancy) {
      const pendingCount = await this.prisma.reconciliationDiscrepancy.count({
        where: {
          reconciliationId: discrepancy.reconciliationId,
          status: "PENDING",
        },
      });

      if (pendingCount === 0) {
        await this.prisma.reconciliation.update({
          where: { id: discrepancy.reconciliationId },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
          },
        });
      }
    }
  }

  /**
   * Ignore a discrepancy (with reason)
   */
  async ignoreDiscrepancy(
    discrepancyId: string,
    reason: string,
    ignoredBy: string,
  ): Promise<void> {
    await this.prisma.reconciliationDiscrepancy.update({
      where: { id: discrepancyId },
      data: {
        status: "IGNORED",
        resolution: `Ignored: ${reason}`,
        resolvedAt: new Date(),
        resolvedBy: ignoredBy,
      },
    });
  }

  /**
   * Get pending discrepancies for manual review
   */
  async getPendingDiscrepancies(options?: {
    provider?: PaymentProvider;
    severity?: ReconciliationDiscrepancy["severity"];
    limit?: number;
    offset?: number;
  }): Promise<ReconciliationDiscrepancy[]> {
    const where: any = {
      status: "PENDING",
    };

    if (options?.severity) {
      where.severity = options.severity;
    }

    if (options?.provider) {
      where.reconciliation = {
        provider: options.provider,
      };
    }

    return await this.prisma.reconciliationDiscrepancy.findMany({
      where,
      include: {
        reconciliation: true,
      },
      orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
      take: options?.limit || 50,
      skip: options?.offset || 0,
    });
  }

  /**
   * Get reconciliation summary for a date range
   */
  async getReconciliationSummary(
    startDate: Date,
    endDate: Date,
    provider?: PaymentProvider,
  ): Promise<{
    totalReconciliations: number;
    completedReconciliations: number;
    pendingReconciliations: number;
    failedReconciliations: number;
    totalTransactions: number;
    matchedTransactions: number;
    matchRate: number;
    totalDiscrepancies: number;
    resolvedDiscrepancies: number;
    pendingDiscrepancies: number;
    totalDiscrepancyAmount: number;
  }> {
    const where: any = {
      date: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (provider) {
      where.provider = provider;
    }

    const reconciliations = await this.prisma.reconciliation.findMany({
      where,
      include: {
        discrepancies: true,
      },
    });

    const summary = {
      totalReconciliations: reconciliations.length,
      completedReconciliations: 0,
      pendingReconciliations: 0,
      failedReconciliations: 0,
      totalTransactions: 0,
      matchedTransactions: 0,
      matchRate: 0,
      totalDiscrepancies: 0,
      resolvedDiscrepancies: 0,
      pendingDiscrepancies: 0,
      totalDiscrepancyAmount: 0,
    };

    for (const rec of reconciliations) {
      if (rec.status === "COMPLETED") {
        summary.completedReconciliations++;
      } else if (rec.status === "PENDING") {
        summary.pendingReconciliations++;
      } else {
        summary.failedReconciliations++;
      }

      summary.totalTransactions += rec.totalTransactions;
      summary.matchedTransactions += rec.matchedTransactions;
      summary.totalDiscrepancies += rec.discrepancies;
      summary.totalDiscrepancyAmount += Number(rec.discrepancyAmount);

      for (const disc of rec.discrepancies) {
        if (disc.status === "PENDING") {
          summary.pendingDiscrepancies++;
        } else {
          summary.resolvedDiscrepancies++;
        }
      }
    }

    summary.matchRate =
      summary.totalTransactions > 0
        ? (summary.matchedTransactions / summary.totalTransactions) * 100
        : 0;

    return summary;
  }

  /**
   * Run balance reconciliation
   * Compare UBI wallet balances with provider account balances
   */
  async runBalanceReconciliation(
    provider: PaymentProvider,
    currency: Currency,
  ): Promise<{
    ubiBalance: number;
    providerBalance: number;
    difference: number;
    status: "MATCHED" | "DISCREPANCY";
    lastReconciled: Date;
    retryCount: number;
  }> {
    // Get UBI float balance
    const ubiFloat = await this.prisma.walletAccount.findFirst({
      where: {
        accountType: "UBI_FLOAT",
        currency,
      },
    });

    if (!ubiFloat) {
      throw new Error(`UBI_FLOAT account not found for ${currency}`);
    }

    // Get provider balance with retry logic
    let providerBalance = 0;
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount < maxRetries) {
      try {
        providerBalance = await this.getProviderBalance(provider, currency);
        break;
      } catch (error) {
        retryCount++;
        reconciliationLogger.warn(
          { provider, currency, retryCount, error },
          `[Reconciliation] Retry ${retryCount}/${maxRetries} for balance fetch`,
        );
        if (retryCount >= maxRetries) {
          throw new Error(
            `Failed to fetch ${provider} balance after ${maxRetries} retries`,
          );
        }
        // Exponential backoff
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, retryCount) * 1000),
        );
      }
    }

    const ubiBalance = Number(ubiFloat.balance);
    const difference = Math.abs(ubiBalance - providerBalance);
    const status =
      difference <= this.config.amountToleranceFixed
        ? "MATCHED"
        : "DISCREPANCY";

    const lastReconciled = new Date();

    // Log balance reconciliation
    await this.prisma.balanceReconciliation.create({
      data: {
        provider,
        currency,
        ubiBalance,
        providerBalance,
        difference,
        status,
        metadata: {
          retryCount,
          lastReconciled: lastReconciled.toISOString(),
        },
      },
    });

    // Create alert for discrepancies
    if (status === "DISCREPANCY") {
      await this.createBalanceDiscrepancyAlert(
        provider,
        currency,
        ubiBalance,
        providerBalance,
        difference,
      );
    }

    return {
      ubiBalance,
      providerBalance,
      difference,
      status,
      lastReconciled,
      retryCount,
    };
  }

  /**
   * Get provider balance - routes to appropriate provider implementation
   */
  private async getProviderBalance(
    provider: PaymentProvider,
    currency: Currency,
  ): Promise<number> {
    switch (provider) {
      case PaymentProvider.PAYSTACK:
        return await this.getPaystackBalance(currency);
      case PaymentProvider.MPESA:
        return await this.getMpesaBalance();
      case PaymentProvider.MTN_MOMO_GH:
        return await this.getMoMoBalance("GH", currency);
      case PaymentProvider.MTN_MOMO_RW:
        return await this.getMoMoBalance("RW", currency);
      case PaymentProvider.MTN_MOMO_UG:
        return await this.getMoMoBalance("UG", currency);
      case PaymentProvider.AIRTEL_MONEY_KE:
      case PaymentProvider.AIRTEL_MONEY_UG:
      case PaymentProvider.AIRTEL_MONEY_TZ:
        return await this.getAirtelMoneyBalance(provider, currency);
      case PaymentProvider.FLUTTERWAVE:
        return await this.getFlutterwaveBalance(currency);
      default:
        reconciliationLogger.warn(
          { provider },
          "Balance check not implemented for provider",
        );
        return 0;
    }
  }

  /**
   * Create balance discrepancy alert
   */
  private async createBalanceDiscrepancyAlert(
    provider: PaymentProvider,
    currency: Currency,
    ubiBalance: number,
    providerBalance: number,
    difference: number,
  ): Promise<void> {
    const severity = this.calculateSeverity(difference);

    await this.prisma.alert.create({
      data: {
        type: "BALANCE_DISCREPANCY",
        severity,
        title: `Balance Discrepancy Detected for ${provider}`,
        message: `UBI balance (${currency} ${ubiBalance.toFixed(2)}) differs from provider balance (${currency} ${providerBalance.toFixed(2)}) by ${currency} ${difference.toFixed(2)}`,
        metadata: {
          provider,
          currency,
          ubiBalance,
          providerBalance,
          difference,
          timestamp: new Date().toISOString(),
        },
        status: "PENDING",
      },
    });

    reconciliationLogger.error(
      { provider, currency, ubiBalance, providerBalance, difference },
      `[ALERT] Balance discrepancy detected`,
    );
  }

  /**
   * Get Paystack account balance
   */
  private async getPaystackBalance(currency: Currency): Promise<number> {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      return 0;
    }

    try {
      const response = await fetch("https://api.paystack.co/balance", {
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Paystack API error: ${response.status}`);
      }

      const data = (await response.json()) as any;

      if (data.status && data.data) {
        const balance = data.data.find((b: any) => b.currency === currency);
        return balance ? balance.balance / 100 : 0; // Convert from kobo
      }
    } catch (error) {
      reconciliationLogger.error(
        { err: error },
        "[Reconciliation] Failed to get Paystack balance",
      );
    }

    return 0;
  }

  /**
   * Get M-Pesa account balance via Safaricom B2C API
   * Uses the Account Balance API endpoint
   */
  private async getMpesaBalance(): Promise<number> {
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const shortcode = process.env.MPESA_SHORTCODE;
    const initiatorName = process.env.MPESA_INITIATOR_NAME;
    const initiatorPassword = process.env.MPESA_INITIATOR_PASSWORD;
    const securityCredential = process.env.MPESA_SECURITY_CREDENTIAL;

    if (!consumerKey || !consumerSecret || !shortcode) {
      reconciliationLogger.warn("M-Pesa credentials not configured");
      return 0;
    }

    const isSandbox = process.env.MPESA_ENVIRONMENT !== "production";
    const baseUrl = isSandbox
      ? "https://sandbox.safaricom.co.ke"
      : "https://api.safaricom.co.ke";

    try {
      // Get OAuth token
      const authString = Buffer.from(
        `${consumerKey}:${consumerSecret}`,
      ).toString("base64");

      const tokenResponse = await fetch(
        `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
        {
          headers: {
            Authorization: `Basic ${authString}`,
          },
        },
      );

      if (!tokenResponse.ok) {
        throw new Error(`M-Pesa OAuth error: ${tokenResponse.status}`);
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token: string;
      };
      const accessToken = tokenData.access_token;

      // Call Account Balance API
      const balanceResponse = await fetch(
        `${baseUrl}/mpesa/accountbalance/v1/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            Initiator: initiatorName,
            SecurityCredential: securityCredential || initiatorPassword,
            CommandID: "AccountBalance",
            PartyA: shortcode,
            IdentifierType: "4", // Shortcode
            Remarks: "Balance reconciliation query",
            QueueTimeOutURL: `${process.env.API_BASE_URL}/webhooks/mpesa/timeout`,
            ResultURL: `${process.env.API_BASE_URL}/webhooks/mpesa/balance-result`,
          }),
        },
      );

      if (!balanceResponse.ok) {
        throw new Error(`M-Pesa Balance API error: ${balanceResponse.status}`);
      }

      const balanceData = (await balanceResponse.json()) as any;

      // Note: M-Pesa Account Balance is asynchronous
      // The actual balance comes via callback to ResultURL
      // For now, we query our stored balance from the last callback
      const storedBalance = await this.prisma.providerBalance.findFirst({
        where: {
          provider: PaymentProvider.MPESA,
          currency: Currency.KES,
        },
        orderBy: { updatedAt: "desc" },
      });

      if (storedBalance) {
        return Number(storedBalance.balance);
      }

      reconciliationLogger.info(
        { conversationId: balanceData.ConversationID },
        "[M-Pesa] Balance query initiated, awaiting callback",
      );

      return 0;
    } catch (error) {
      reconciliationLogger.error(
        { err: error },
        "[Reconciliation] Failed to get M-Pesa balance",
      );
      throw error;
    }
  }

  /**
   * Get MTN MoMo account balance
   * Uses the Collection Account Balance API
   */
  private async getMoMoBalance(
    country: "GH" | "RW" | "UG" | "ZM" | "CI",
    currency: Currency,
  ): Promise<number> {
    const subscriptionKey = process.env[`MTN_MOMO_${country}_SUBSCRIPTION_KEY`];
    const apiUserId = process.env[`MTN_MOMO_${country}_API_USER`];
    const apiKey = process.env[`MTN_MOMO_${country}_API_KEY`];
    const targetEnvironment = process.env.MTN_MOMO_ENVIRONMENT || "sandbox";

    if (!subscriptionKey || !apiUserId || !apiKey) {
      reconciliationLogger.warn(
        { country },
        `MTN MoMo ${country} credentials not configured`,
      );
      return 0;
    }

    const baseUrl =
      targetEnvironment === "sandbox"
        ? "https://sandbox.momodeveloper.mtn.com"
        : `https://proxy.momoapi.mtn.com/${country.toLowerCase()}`;

    try {
      // Generate access token
      const authString = Buffer.from(`${apiUserId}:${apiKey}`).toString(
        "base64",
      );

      const tokenResponse = await fetch(`${baseUrl}/collection/token/`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${authString}`,
          "Ocp-Apim-Subscription-Key": subscriptionKey,
        },
      });

      if (!tokenResponse.ok) {
        throw new Error(`MoMo OAuth error: ${tokenResponse.status}`);
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token: string;
      };
      const accessToken = tokenData.access_token;

      // Get account balance
      const balanceResponse = await fetch(
        `${baseUrl}/collection/v1_0/account/balance`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-Target-Environment": targetEnvironment,
            "Ocp-Apim-Subscription-Key": subscriptionKey,
          },
        },
      );

      if (!balanceResponse.ok) {
        throw new Error(`MoMo Balance API error: ${balanceResponse.status}`);
      }

      const balanceData = (await balanceResponse.json()) as {
        availableBalance: string;
        currency: string;
      };

      // Store balance for historical tracking
      await this.prisma.providerBalance.upsert({
        where: {
          provider_currency: {
            provider: this.getMoMoProvider(country),
            currency,
          },
        },
        update: {
          balance: Number.parseFloat(balanceData.availableBalance),
          updatedAt: new Date(),
        },
        create: {
          provider: this.getMoMoProvider(country),
          currency,
          balance: Number.parseFloat(balanceData.availableBalance),
        },
      });

      return Number.parseFloat(balanceData.availableBalance);
    } catch (error) {
      reconciliationLogger.error(
        { err: error, country },
        "[Reconciliation] Failed to get MoMo balance",
      );
      throw error;
    }
  }

  /**
   * Helper to get MoMo provider enum from country code
   */
  private getMoMoProvider(
    country: "GH" | "RW" | "UG" | "ZM" | "CI",
  ): PaymentProvider {
    const providerMap: Record<string, PaymentProvider> = {
      GH: PaymentProvider.MTN_MOMO_GH,
      RW: PaymentProvider.MTN_MOMO_RW,
      UG: PaymentProvider.MTN_MOMO_UG,
      ZM: PaymentProvider.MTN_MOMO_ZM,
      CI: PaymentProvider.MTN_MOMO_CI,
    };
    return providerMap[country] || PaymentProvider.MTN_MOMO_GH;
  }

  /**
   * Get Airtel Money account balance
   * Uses the Airtel Money Africa API
   */
  private async getAirtelMoneyBalance(
    provider: PaymentProvider,
    currency: Currency,
  ): Promise<number> {
    const countryCode = this.getAirtelCountryCode(provider);
    const clientId = process.env[`AIRTEL_MONEY_${countryCode}_CLIENT_ID`];
    const clientSecret =
      process.env[`AIRTEL_MONEY_${countryCode}_CLIENT_SECRET`];

    if (!clientId || !clientSecret) {
      reconciliationLogger.warn(
        { provider },
        "Airtel Money credentials not configured",
      );
      return 0;
    }

    const baseUrl =
      process.env.AIRTEL_MONEY_ENVIRONMENT === "production"
        ? "https://openapi.airtel.africa"
        : "https://openapiuat.airtel.africa";

    try {
      // Get OAuth token
      const tokenResponse = await fetch(`${baseUrl}/auth/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "client_credentials",
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error(`Airtel OAuth error: ${tokenResponse.status}`);
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token: string;
      };
      const accessToken = tokenData.access_token;

      // Get account balance
      const balanceResponse = await fetch(
        `${baseUrl}/standard/v1/users/balance`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-Country": countryCode,
            "X-Currency": currency,
          },
        },
      );

      if (!balanceResponse.ok) {
        throw new Error(`Airtel Balance API error: ${balanceResponse.status}`);
      }

      const balanceData = (await balanceResponse.json()) as {
        data: {
          balance: string;
          currency: string;
        };
        status: {
          success: boolean;
        };
      };

      if (balanceData.status.success) {
        const balance = Number.parseFloat(balanceData.data.balance);

        // Store balance for historical tracking
        await this.prisma.providerBalance.upsert({
          where: {
            provider_currency: {
              provider,
              currency,
            },
          },
          update: {
            balance,
            updatedAt: new Date(),
          },
          create: {
            provider,
            currency,
            balance,
          },
        });

        return balance;
      }

      return 0;
    } catch (error) {
      reconciliationLogger.error(
        { err: error, provider },
        "[Reconciliation] Failed to get Airtel Money balance",
      );
      throw error;
    }
  }

  /**
   * Helper to get Airtel country code from provider
   */
  private getAirtelCountryCode(provider: PaymentProvider): string {
    const countryMap: Record<string, string> = {
      [PaymentProvider.AIRTEL_MONEY_KE]: "KE",
      [PaymentProvider.AIRTEL_MONEY_UG]: "UG",
      [PaymentProvider.AIRTEL_MONEY_TZ]: "TZ",
    };
    return countryMap[provider] || "KE";
  }

  /**
   * Get Flutterwave account balance
   * Uses the Flutterwave Balance API
   */
  private async getFlutterwaveBalance(currency: Currency): Promise<number> {
    const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;

    if (!secretKey) {
      reconciliationLogger.warn("Flutterwave secret key not configured");
      return 0;
    }

    const baseUrl = "https://api.flutterwave.com/v3";

    try {
      const response = await fetch(`${baseUrl}/balances/${currency}`, {
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        // Try alternative endpoint for all balances
        const allBalancesResponse = await fetch(`${baseUrl}/balances`, {
          headers: {
            Authorization: `Bearer ${secretKey}`,
            "Content-Type": "application/json",
          },
        });

        if (!allBalancesResponse.ok) {
          throw new Error(`Flutterwave Balance API error: ${response.status}`);
        }

        const allData = (await allBalancesResponse.json()) as {
          status: string;
          data: Array<{
            currency: string;
            available_balance: number;
            ledger_balance: number;
          }>;
        };

        if (allData.status === "success" && allData.data) {
          const currencyBalance = allData.data.find(
            (b) => b.currency === currency,
          );
          if (currencyBalance) {
            const balance = currencyBalance.available_balance;

            // Store balance for historical tracking
            await this.prisma.providerBalance.upsert({
              where: {
                provider_currency: {
                  provider: PaymentProvider.FLUTTERWAVE,
                  currency,
                },
              },
              update: {
                balance,
                updatedAt: new Date(),
              },
              create: {
                provider: PaymentProvider.FLUTTERWAVE,
                currency,
                balance,
              },
            });

            return balance;
          }
        }

        return 0;
      }

      const data = (await response.json()) as {
        status: string;
        data: {
          currency: string;
          available_balance: number;
          ledger_balance: number;
        };
      };

      if (data.status === "success" && data.data) {
        const balance = data.data.available_balance;

        // Store balance for historical tracking
        await this.prisma.providerBalance.upsert({
          where: {
            provider_currency: {
              provider: PaymentProvider.FLUTTERWAVE,
              currency,
            },
          },
          update: {
            balance,
            updatedAt: new Date(),
          },
          create: {
            provider: PaymentProvider.FLUTTERWAVE,
            currency,
            balance,
          },
        });

        return balance;
      }

      return 0;
    } catch (error) {
      reconciliationLogger.error(
        { err: error },
        "[Reconciliation] Failed to get Flutterwave balance",
      );
      throw error;
    }
  }

  /**
   * Run comprehensive balance reconciliation for all providers
   */
  async runAllProvidersBalanceReconciliation(): Promise<{
    results: Array<{
      provider: PaymentProvider;
      currency: Currency;
      ubiBalance: number;
      providerBalance: number;
      difference: number;
      status: BalanceReconciliationStatus;
      error?: string;
    }>;
    summary: {
      totalProviders: number;
      matched: number;
      discrepancies: number;
      errors: number;
      totalDifference: number;
    };
  }> {
    const providerCurrencyPairs: Array<{
      provider: PaymentProvider;
      currency: Currency;
    }> = [
      { provider: PaymentProvider.MPESA, currency: Currency.KES },
      { provider: PaymentProvider.PAYSTACK, currency: Currency.NGN },
      { provider: PaymentProvider.MTN_MOMO_GH, currency: Currency.GHS },
      { provider: PaymentProvider.MTN_MOMO_RW, currency: Currency.RWF },
      { provider: PaymentProvider.MTN_MOMO_UG, currency: Currency.UGX },
      { provider: PaymentProvider.AIRTEL_MONEY_KE, currency: Currency.KES },
      { provider: PaymentProvider.AIRTEL_MONEY_UG, currency: Currency.UGX },
      { provider: PaymentProvider.AIRTEL_MONEY_TZ, currency: Currency.TZS },
      { provider: PaymentProvider.FLUTTERWAVE, currency: Currency.NGN },
      { provider: PaymentProvider.FLUTTERWAVE, currency: Currency.KES },
      { provider: PaymentProvider.FLUTTERWAVE, currency: Currency.GHS },
      { provider: PaymentProvider.FLUTTERWAVE, currency: Currency.ZAR },
      { provider: PaymentProvider.FLUTTERWAVE, currency: Currency.USD },
    ];

    const results: Array<{
      provider: PaymentProvider;
      currency: Currency;
      ubiBalance: number;
      providerBalance: number;
      difference: number;
      status: BalanceReconciliationStatus;
      error?: string;
    }> = [];

    for (const { provider, currency } of providerCurrencyPairs) {
      try {
        const result = await this.runBalanceReconciliation(provider, currency);
        results.push({
          provider,
          currency,
          ubiBalance: result.ubiBalance,
          providerBalance: result.providerBalance,
          difference: result.difference,
          status: result.status,
        });
      } catch (error) {
        reconciliationLogger.error(
          { err: error, provider, currency },
          "[Reconciliation] Balance check failed",
        );
        results.push({
          provider,
          currency,
          ubiBalance: 0,
          providerBalance: 0,
          difference: 0,
          status: "ERROR",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const summary = {
      totalProviders: results.length,
      matched: results.filter((r) => r.status === "MATCHED").length,
      discrepancies: results.filter((r) => r.status === "DISCREPANCY").length,
      errors: results.filter((r) => r.status === "ERROR").length,
      totalDifference: results.reduce((sum, r) => sum + r.difference, 0),
    };

    // Generate reconciliation report
    await this.generateBalanceReconciliationReport(results, summary);

    return { results, summary };
  }

  /**
   * Generate balance reconciliation report
   */
  private async generateBalanceReconciliationReport(
    results: Array<{
      provider: PaymentProvider;
      currency: Currency;
      ubiBalance: number;
      providerBalance: number;
      difference: number;
      status: BalanceReconciliationStatus;
      error?: string;
    }>,
    summary: {
      totalProviders: number;
      matched: number;
      discrepancies: number;
      errors: number;
      totalDifference: number;
    },
  ): Promise<void> {
    await this.prisma.reconciliationReport.create({
      data: {
        type: "BALANCE",
        date: new Date(),
        status:
          summary.discrepancies > 0 || summary.errors > 0
            ? "ISSUES_FOUND"
            : "CLEAN",
        summary: {
          ...summary,
          generatedAt: new Date().toISOString(),
        },
        details: results,
      },
    });

    reconciliationLogger.info(
      {
        matched: summary.matched,
        discrepancies: summary.discrepancies,
        errors: summary.errors,
        totalDifference: summary.totalDifference,
      },
      "[Reconciliation] Balance reconciliation completed",
    );
  }

  /**
   * Send critical alert for large discrepancies
   */
  private async sendCriticalAlert(
    reconciliationId: string,
    result: ReconciliationResult,
  ): Promise<void> {
    // In production, this would send alerts via:
    // - Slack webhook
    // - Email to finance team
    // - PagerDuty for critical issues

    reconciliationLogger.error(
      `[CRITICAL ALERT] Reconciliation ${reconciliationId} has discrepancy amount: ${result.discrepancyAmount}`,
    );

    // Store alert in database
    await this.prisma.alert.create({
      data: {
        type: "RECONCILIATION_DISCREPANCY",
        severity: "CRITICAL",
        title: `Critical Reconciliation Discrepancy Detected`,
        message: `Reconciliation ${reconciliationId} found ${result.discrepancies} discrepancies totaling ${result.currency} ${result.discrepancyAmount}`,
        metadata: {
          reconciliationId,
          provider: result.provider,
          date: result.date,
          discrepancyAmount: result.discrepancyAmount,
          discrepancyCount: result.discrepancies,
        },
        status: "PENDING",
      },
    });
  }

  /**
   * Map UBI status to provider status
   */
  private mapUbiStatus(
    status: PaymentStatus,
  ): "success" | "failed" | "pending" | "reversed" {
    switch (status) {
      case PaymentStatus.COMPLETED:
        return "success";
      case PaymentStatus.FAILED:
        return "failed";
      case PaymentStatus.REFUNDED:
        return "reversed";
      default:
        return "pending";
    }
  }

  /**
   * Map M-Pesa result code to status
   */
  private mapMpesaStatus(
    resultCode: number | string,
  ): "success" | "failed" | "pending" {
    if (resultCode === 0 || resultCode === "0") {
      return "success";
    }
    return "failed";
  }

  /**
   * Map MoMo status to common status
   */
  private mapMomoStatus(status: string): "success" | "failed" | "pending" {
    switch (status?.toUpperCase()) {
      case "SUCCESSFUL":
        return "success";
      case "FAILED":
        return "failed";
      default:
        return "pending";
    }
  }

  /**
   * Calculate severity based on amount
   */
  private calculateSeverity(
    amount: number,
  ): ReconciliationDiscrepancy["severity"] {
    if (amount >= 50000) return "CRITICAL";
    if (amount >= 10000) return "HIGH";
    if (amount >= 1000) return "MEDIUM";
    return "LOW";
  }

  /**
   * Schedule daily reconciliation job
   * Should be called by a cron scheduler
   */
  async scheduleDailyReconciliation(): Promise<void> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    // Transaction reconciliation for all providers
    const providerCurrencyPairs: Array<{
      provider: PaymentProvider;
      currency: Currency;
    }> = [
      { provider: PaymentProvider.MPESA, currency: Currency.KES },
      { provider: PaymentProvider.PAYSTACK, currency: Currency.NGN },
      { provider: PaymentProvider.PAYSTACK, currency: Currency.GHS },
      { provider: PaymentProvider.MTN_MOMO_GH, currency: Currency.GHS },
      { provider: PaymentProvider.MTN_MOMO_RW, currency: Currency.RWF },
      { provider: PaymentProvider.MTN_MOMO_UG, currency: Currency.UGX },
      { provider: PaymentProvider.AIRTEL_MONEY_KE, currency: Currency.KES },
      { provider: PaymentProvider.AIRTEL_MONEY_UG, currency: Currency.UGX },
      { provider: PaymentProvider.AIRTEL_MONEY_TZ, currency: Currency.TZS },
      { provider: PaymentProvider.FLUTTERWAVE, currency: Currency.NGN },
      { provider: PaymentProvider.FLUTTERWAVE, currency: Currency.KES },
      { provider: PaymentProvider.FLUTTERWAVE, currency: Currency.GHS },
      { provider: PaymentProvider.FLUTTERWAVE, currency: Currency.ZAR },
    ];

    reconciliationLogger.info(
      { date: yesterday.toISOString() },
      "[Reconciliation] Starting daily reconciliation",
    );

    // Run transaction reconciliation
    for (const { provider, currency } of providerCurrencyPairs) {
      try {
        await this.runDailyReconciliation(provider, yesterday, currency);
      } catch (error) {
        reconciliationLogger.error(
          { err: error, provider, currency },
          "[Reconciliation] Transaction reconciliation failed",
        );
      }
    }

    // Run balance reconciliation
    try {
      const balanceResults = await this.runAllProvidersBalanceReconciliation();
      reconciliationLogger.info(
        {
          matched: balanceResults.summary.matched,
          discrepancies: balanceResults.summary.discrepancies,
          errors: balanceResults.summary.errors,
        },
        "[Reconciliation] Balance reconciliation completed",
      );
    } catch (error) {
      reconciliationLogger.error(
        { err: error },
        "[Reconciliation] Balance reconciliation failed",
      );
    }

    reconciliationLogger.info(
      "[Reconciliation] Daily reconciliation completed",
    );
  }
}

// Singleton instance
let reconciliationServiceInstance: ReconciliationService | null = null;

// Create new instance
export function createReconciliationService(
  prisma: PrismaClient,
): ReconciliationService {
  return new ReconciliationService(prisma);
}

// Get singleton instance
export function getReconciliationService(
  prisma: PrismaClient,
): ReconciliationService {
  reconciliationServiceInstance ??= createReconciliationService(prisma);
  return reconciliationServiceInstance;
}
