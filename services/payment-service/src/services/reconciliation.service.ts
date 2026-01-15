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
  type PrismaClient,
} from "@prisma/client";

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
  private config: ReconciliationConfig = {
    amountTolerancePercent: 0.1, // 0.1% tolerance
    amountToleranceFixed: 10, // ₦10 fixed tolerance
    autoResolveLimit: 100, // Auto-resolve below ₦100
    reconciliationHour: 2, // 2 AM
    lookbackDays: 7, // Reconcile up to 7 days back
    criticalDiscrepancyThreshold: 10000, // Alert above ₦10,000
    missingTransactionAlertDelay: 4, // Alert after 4 hours
  };

  constructor(private prisma: PrismaClient) {}

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

    console.log(
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

      console.log(
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
        console.warn(
          `[Reconciliation] No provider implementation for ${provider}`,
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
        const providerResponse = tx.providerResponse as any;
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
        const providerResponse = tx.providerResponse as any;
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
      console.warn("[Reconciliation] Paystack secret key not configured");
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
      console.error(
        "[Reconciliation] Failed to fetch Paystack transactions:",
        error,
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

    // Get provider balance (implementation varies by provider)
    let providerBalance = 0;

    switch (provider) {
      case PaymentProvider.PAYSTACK:
        providerBalance = await this.getPaystackBalance(currency);
        break;
      // Add other providers as needed
      default:
        console.warn(
          `[Reconciliation] Balance check not implemented for ${provider}`,
        );
    }

    const ubiBalance = Number(ubiFloat.balance);
    const difference = Math.abs(ubiBalance - providerBalance);
    const status =
      difference <= this.config.amountToleranceFixed
        ? "MATCHED"
        : "DISCREPANCY";

    // Log balance reconciliation
    await this.prisma.balanceReconciliation.create({
      data: {
        provider,
        currency,
        ubiBalance,
        providerBalance,
        difference,
        status,
      },
    });

    return {
      ubiBalance,
      providerBalance,
      difference,
      status,
    };
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
      console.error("[Reconciliation] Failed to get Paystack balance:", error);
    }

    return 0;
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

    console.error(
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
    if (amount >= 50000) {
      return "CRITICAL";
    }
    if (amount >= 10000) {
      return "HIGH";
    }
    if (amount >= 1000) {
      return "MEDIUM";
    }
    return "LOW";
  }

  /**
   * Schedule daily reconciliation job
   * Should be called by a cron scheduler
   */
  async scheduleDailyReconciliation(): Promise<void> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const providers = [
      PaymentProvider.MPESA,
      PaymentProvider.PAYSTACK,
      PaymentProvider.MTN_MOMO_GH,
    ];

    const currencies = [Currency.NGN, Currency.KES, Currency.GHS];

    for (const provider of providers) {
      for (const currency of currencies) {
        try {
          await this.runDailyReconciliation(provider, yesterday, currency);
        } catch (error) {
          console.error(
            `[Reconciliation] Failed for ${provider}/${currency}:`,
            error,
          );
        }
      }
    }
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
  if (!reconciliationServiceInstance) {
    reconciliationServiceInstance = createReconciliationService(prisma);
  }
  return reconciliationServiceInstance;
}
