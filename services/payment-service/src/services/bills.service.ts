/**
 * Bill Payment Service
 * Airtime, data, electricity, TV, internet, and more
 */

import { nanoid } from "nanoid";
import { billsLogger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import type {
  BillCategory,
  BillInputField,
  BillPaymentParams,
  BillPaymentResult,
  BillPaymentStatus,
  BillProvider,
  BillValidationResult,
  ScheduledBillPayment,
} from "../types/fintech.types";
import { enhancedWalletService } from "./enhanced-wallet.service";

// ===========================================
// BILL PROVIDER CONFIGURATIONS
// ===========================================

const BILL_CATEGORIES: Record<BillCategory, { name: string; icon: string }> = {
  AIRTIME: { name: "Airtime", icon: "📱" },
  DATA: { name: "Data", icon: "📶" },
  ELECTRICITY: { name: "Electricity", icon: "⚡" },
  WATER: { name: "Water", icon: "💧" },
  TV: { name: "TV Subscription", icon: "📺" },
  INTERNET: { name: "Internet", icon: "🌐" },
  EDUCATION: { name: "School Fees", icon: "🎓" },
  INSURANCE: { name: "Insurance", icon: "🛡️" },
  GOVERNMENT: { name: "Government", icon: "🏛️" },
  OTHER: { name: "Other", icon: "📋" },
};

// ===========================================
// BILL PAYMENT SERVICE
// ===========================================

export class BillPaymentService {
  /**
   * Get all bill categories
   */
  async getCategories(): Promise<
    Array<{ category: BillCategory; name: string; icon: string }>
  > {
    return Object.entries(BILL_CATEGORIES).map(([category, info]) => ({
      category: category as BillCategory,
      ...info,
    }));
  }

  /**
   * Get bill providers by category and country
   */
  async getProviders(
    category: BillCategory,
    countryCode: string,
  ): Promise<BillProvider[]> {
    const cacheKey = `bill_providers:${category}:${countryCode}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const providers = await prisma.billProvider.findMany({
      where: {
        category,
        countryCode,
        isActive: true,
      },
      orderBy: { name: "asc" },
    });

    const formatted = providers.map((p: any) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      shortName: p.shortName || p.name,
      logo: p.logoUrl || undefined,
      category: p.category as BillCategory,
      country: p.countryCode,
      currency: p.currency,
      inputFields: (p.inputFields as BillInputField[]) || [],
      processingTime: p.processingTime || "instant",
      minAmount: p.minAmount ? Number(p.minAmount) : undefined,
      maxAmount: p.maxAmount ? Number(p.maxAmount) : undefined,
      fee: {
        fixed: Number(p.fixedFee || 0),
        percentage: Number(p.percentageFee || 0),
      },
    }));

    // Cache for 1 hour
    await redis.setex(cacheKey, 3600, JSON.stringify(formatted));

    return formatted;
  }

  /**
   * Get provider by ID
   */
  async getProvider(providerId: string): Promise<BillProvider | null> {
    const provider = await prisma.billProvider.findUnique({
      where: { id: providerId },
    });

    if (!provider || !provider.isActive) {
      return null;
    }

    return {
      id: provider.id,
      code: provider.code,
      name: provider.name,
      shortName: (provider as any).shortName || provider.name,
      logo: provider.logoUrl || undefined,
      category: provider.category as BillCategory,
      country: provider.countryCode,
      currency: provider.currency,
      inputFields: (provider.inputFields as BillInputField[]) || [],
      processingTime: (provider as any).processingTime || "instant",
      minAmount: provider.minAmount ? Number(provider.minAmount) : undefined,
      maxAmount: provider.maxAmount ? Number(provider.maxAmount) : undefined,
      fee: {
        fixed: Number((provider as any).fixedFee || 0),
        percentage: Number((provider as any).percentageFee || 0),
      },
    };
  }

  /**
   * Validate bill account/meter number
   */
  async validateAccount(
    providerId: string,
    accountNumber: string,
    additionalFields?: Record<string, string>,
  ): Promise<BillValidationResult> {
    const provider = await this.getProvider(providerId);

    if (!provider) {
      return {
        valid: false,
        error: "Provider not found",
      };
    }

    // Validate required fields
    for (const field of provider.inputFields) {
      if (field.required) {
        const value =
          field.name === "accountNumber"
            ? accountNumber
            : additionalFields?.[field.name];

        if (!value) {
          return {
            valid: false,
            error: `${field.label} is required`,
          };
        }

        if (field.pattern) {
          const regex = new RegExp(field.pattern);
          if (!regex.test(value)) {
            return {
              valid: false,
              error: `Invalid ${field.label} format`,
            };
          }
        }
      }
    }

    // In production, call the provider's API to validate
    // For now, simulate validation
    const validation = await this.callProviderValidation(
      provider,
      accountNumber,
      additionalFields,
    );

    return validation;
  }

  /**
   * Get bill amount (for bills with variable amounts like electricity)
   */
  async getBillAmount(
    providerId: string,
    _accountNumber: string,
    _additionalFields?: Record<string, string>,
  ): Promise<{ amount: number; dueDate?: Date; customerName?: string } | null> {
    const provider = await this.getProvider(providerId);

    if (!provider) {
      return null;
    }

    // Categories that typically have outstanding amounts
    const variableCategories: BillCategory[] = [
      "ELECTRICITY",
      "WATER",
      "TV",
      "INTERNET",
      "INSURANCE",
    ];

    if (!variableCategories.includes(provider.category)) {
      return null;
    }

    // In production, call provider API to get outstanding balance
    // For demo, return simulated data
    return {
      amount: Math.round(Math.random() * 50000) + 1000,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      customerName: "John Doe",
    };
  }

  /**
   * Pay a bill
   */
  async payBill(params: BillPaymentParams): Promise<BillPaymentResult> {
    const {
      walletId,
      providerId,
      customerParams,
      amount,
      pin,
      idempotencyKey,
    } = params;

    // Validate wallet
    const wallet = await enhancedWalletService.getWalletById(walletId);
    if (!wallet) {
      throw new Error("Wallet not found");
    }

    // Verify PIN
    const pinValid = pin
      ? await enhancedWalletService.verifyPin(walletId, pin)
      : false;
    if (pin && !pinValid) {
      throw new Error("Invalid PIN");
    }

    // Get provider
    const provider = await this.getProvider(providerId);
    if (!provider) {
      throw new Error("Provider not found");
    }

    // Validate amount
    if (provider.minAmount && amount < provider.minAmount) {
      throw new Error(`Minimum amount is ${provider.minAmount}`);
    }
    if (provider.maxAmount && amount > provider.maxAmount) {
      throw new Error(`Maximum amount is ${provider.maxAmount}`);
    }

    // Extract accountNumber from customerParams
    const accountNumber =
      customerParams.accountNumber || customerParams.phoneNumber || "";

    // Check limits
    const limitCheck = await enhancedWalletService.checkLimit(
      walletId,
      amount,
      "bills",
    );
    if (!limitCheck.allowed) {
      throw new Error(limitCheck.reason || "Bill payment limit exceeded");
    }

    // Calculate fee
    const fee = provider.fee.fixed + (amount * provider.fee.percentage) / 100;
    const totalAmount = amount + fee;

    // Check balance
    const balance = await enhancedWalletService.getBalance(
      walletId,
      provider.currency as any,
    );
    if (balance.available < totalAmount) {
      throw new Error("Insufficient balance");
    }

    const paymentId = idempotencyKey || `bill_${nanoid(16)}`;

    // Create payment record
    await prisma.billPayment.create({
      data: {
        id: paymentId,
        walletId,
        providerId,
        providerCode: provider.code,
        category: provider.category,
        accountNumber,
        customerName: undefined,
        amount,
        fee,
        currency: provider.currency,
        status: "PENDING",
        metadata: customerParams,
      },
    });

    try {
      // Debit wallet
      await enhancedWalletService.debit({
        walletId,
        amount: totalAmount,
        currency: provider.currency as any,
        description: `${provider.name} - ${accountNumber}`,
        reference: paymentId,
      });

      // Process payment with provider
      const providerResult = await this.processWithProvider(provider, {
        paymentId,
        accountNumber,
        amount,
        additionalFields: customerParams,
      });

      // Update payment record
      await prisma.billPayment.update({
        where: { id: paymentId },
        data: {
          status: "COMPLETED",
          providerReference: providerResult.reference,
          providerResponse: providerResult.response,
          completedAt: new Date(),
          receiptNumber: providerResult.receiptNumber,
          token: providerResult.token, // For prepaid electricity
        },
      });

      return {
        paymentId,
        status: "COMPLETED",
        providerName: provider.name,
        amount,
        fee,
        totalAmount,
        currency: provider.currency,
        reference: providerResult.reference,
        token: providerResult.token,
        createdAt: new Date(),
      };
    } catch (error) {
      // Refund on failure
      await enhancedWalletService.credit({
        walletId,
        amount: totalAmount,
        currency: provider.currency as any,
        description: `Refund - ${provider.name} payment failed`,
        reference: `refund_${paymentId}`,
      });

      await prisma.billPayment.update({
        where: { id: paymentId },
        data: {
          status: "FAILED",
          failureReason:
            error instanceof Error ? error.message : "Unknown error",
        },
      });

      throw error;
    }
  }

  /**
   * Get bill payment history
   */
  async getPaymentHistory(
    walletId: string,
    options: {
      category?: BillCategory;
      providerId?: string;
      status?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{ payments: BillPaymentResult[]; total: number }> {
    const { category, providerId, status, limit = 20, offset = 0 } = options;

    const where: Record<string, unknown> = { walletId };
    if (category) where.category = category;
    if (providerId) where.providerId = providerId;
    if (status) where.status = status;

    const [payments, total] = await Promise.all([
      prisma.billPayment.findMany({
        where,
        include: {
          provider: true,
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.billPayment.count({ where }),
    ]);

    return {
      payments: payments.map((p: any) => ({
        paymentId: p.id,
        status: p.status as BillPaymentStatus,
        providerName: p.provider.name,
        customerName: p.customerName || undefined,
        amount: Number(p.amount),
        fee: Number(p.fee),
        totalAmount: Number(p.amount) + Number(p.fee),
        currency: p.currency,
        reference: p.providerReference || p.id,
        token: p.token || undefined,
        createdAt: p.createdAt,
      })),
      total,
    };
  }

  // ===========================================
  // SCHEDULED PAYMENTS
  // ===========================================

  /**
   * Schedule a recurring bill payment
   */
  async schedulePayment(
    walletId: string,
    params: {
      providerId: string;
      accountNumber: string;
      amount: number;
      frequency: "weekly" | "monthly" | "custom";
      startDate: Date;
      endDate?: Date;
      additionalFields?: Record<string, string>;
    },
  ): Promise<ScheduledBillPayment> {
    const {
      providerId,
      accountNumber,
      amount,
      frequency,
      startDate,
      endDate,
      additionalFields,
    } = params;

    const provider = await this.getProvider(providerId);
    if (!provider) {
      throw new Error("Provider not found");
    }

    const scheduleId = `sched_${nanoid(16)}`;
    const nextPaymentDate = this.calculateNextPaymentDate(startDate, frequency);

    const scheduled = await prisma.scheduledBillPayment.create({
      data: {
        id: scheduleId,
        walletId,
        providerId,
        accountNumber,
        amount,
        currency: provider.currency,
        frequency,
        startDate,
        endDate,
        nextPaymentDate,
        metadata: additionalFields,
        isActive: true,
      },
    });

    return {
      id: scheduled.id,
      providerId: scheduled.providerId,
      providerName: provider.name,
      customerParams: { accountNumber: scheduled.accountNumber },
      amount: Number(scheduled.amount),
      frequency: scheduled.frequency as "weekly" | "monthly" | "custom",
      nextRunDate: scheduled.nextPaymentDate,
      isActive: scheduled.isActive,
    };
  }

  /**
   * Get scheduled payments
   */
  async getScheduledPayments(
    walletId: string,
  ): Promise<ScheduledBillPayment[]> {
    const scheduled = await prisma.scheduledBillPayment.findMany({
      where: { walletId, isActive: true },
      include: { provider: true },
      orderBy: { nextPaymentDate: "asc" },
    });

    return scheduled.map((s: any) => ({
      id: s.id,
      providerId: s.providerId,
      providerName: s.provider.name,
      customerParams: { accountNumber: s.accountNumber },
      amount: Number(s.amount),
      frequency: s.frequency as "weekly" | "monthly" | "custom",
      nextRunDate: s.nextPaymentDate,
      lastRunDate: s.lastPaymentDate || undefined,
      lastRunStatus: s.lastPaymentStatus || undefined,
      isActive: s.isActive,
    }));
  }

  /**
   * Cancel scheduled payment
   */
  async cancelScheduledPayment(
    scheduleId: string,
    walletId: string,
  ): Promise<void> {
    const scheduled = await prisma.scheduledBillPayment.findUnique({
      where: { id: scheduleId },
    });

    if (!scheduled || scheduled.walletId !== walletId) {
      throw new Error("Scheduled payment not found");
    }

    await prisma.scheduledBillPayment.update({
      where: { id: scheduleId },
      data: { isActive: false },
    });
  }

  /**
   * Process due scheduled payments (called by cron job)
   */
  async processDuePayments(): Promise<{ processed: number; failed: number }> {
    const now = new Date();

    const duePayments = await prisma.scheduledBillPayment.findMany({
      where: {
        isActive: true,
        nextPaymentDate: { lte: now },
        OR: [{ endDate: null }, { endDate: { gte: now } }],
      },
      include: { wallet: true },
    });

    let processed = 0;
    let failed = 0;

    for (const scheduled of duePayments) {
      try {
        // Attempt payment (PIN is bypassed for scheduled payments)
        await this.payBillInternal({
          walletId: scheduled.walletId,
          providerId: scheduled.providerId,
          accountNumber: scheduled.accountNumber,
          amount: Number(scheduled.amount),
          additionalFields: scheduled.metadata as Record<string, string>,
          isScheduled: true,
          scheduleId: scheduled.id,
        });

        // Update next payment date
        const nextDate = this.calculateNextPaymentDate(
          scheduled.nextPaymentDate,
          scheduled.frequency as "weekly" | "monthly" | "custom",
        );

        await prisma.scheduledBillPayment.update({
          where: { id: scheduled.id },
          data: {
            lastPaymentDate: now,
            nextPaymentDate: nextDate,
            totalPayments: { increment: 1 },
            failedAttempts: 0,
          },
        });

        processed++;
      } catch (error) {
        billsLogger.error(
          { err: error, scheduledId: scheduled.id },
          "Failed to process scheduled payment",
        );

        // Increment failed attempts
        const updated = await prisma.scheduledBillPayment.update({
          where: { id: scheduled.id },
          data: {
            failedAttempts: { increment: 1 },
          },
        });

        // Deactivate after 3 failed attempts
        if (updated.failedAttempts >= 3) {
          await prisma.scheduledBillPayment.update({
            where: { id: scheduled.id },
            data: { isActive: false },
          });
        }

        failed++;
      }
    }

    return { processed, failed };
  }

  // ===========================================
  // PRIVATE HELPERS
  // ===========================================

  private async callProviderValidation(
    _provider: BillProvider,
    accountNumber: string,
    _additionalFields?: Record<string, string>,
  ): Promise<BillValidationResult> {
    // In production, integrate with actual provider APIs
    // Simulate validation based on provider type

    // Basic format validation
    if (accountNumber.length < 5) {
      return { valid: false, error: "Account number too short" };
    }

    // Simulate API call delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Simulate successful validation
    return {
      valid: true,
      customerName: "John Doe",
      amount: 5000,
      metadata: {
        accountNumber,
        accountType: "Prepaid",
        status: "Active",
      },
    };
  }

  private async processWithProvider(
    provider: BillProvider,
    _params: {
      paymentId: string;
      accountNumber: string;
      amount: number;
      additionalFields?: Record<string, string>;
    },
  ): Promise<{
    reference: string;
    response: unknown;
    receiptNumber?: string;
    token?: string;
  }> {
    // In production, route to appropriate provider integration
    // For demo, simulate provider response

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const reference = `${provider.code}_${Date.now()}`;

    // Generate token for prepaid electricity
    const token =
      provider.category === "ELECTRICITY"
        ? this.generateElectricityToken()
        : undefined;

    return {
      reference,
      response: { success: true, timestamp: new Date().toISOString() },
      receiptNumber: `RCP${Date.now()}`,
      token,
    };
  }

  private async payBillInternal(params: {
    walletId: string;
    providerId: string;
    accountNumber: string;
    amount: number;
    additionalFields?: Record<string, string>;
    isScheduled: boolean;
    scheduleId?: string;
  }): Promise<BillPaymentResult> {
    // Similar to payBill but without PIN verification for scheduled payments
    const {
      walletId,
      providerId,
      accountNumber,
      amount,
      additionalFields,
      isScheduled,
      scheduleId,
    } = params;

    const provider = await this.getProvider(providerId);
    if (!provider) {
      throw new Error("Provider not found");
    }

    const fee = provider.fee.fixed + (amount * provider.fee.percentage) / 100;
    const totalAmount = amount + fee;

    const balance = await enhancedWalletService.getBalance(
      walletId,
      provider.currency as any,
    );
    if (balance.available < totalAmount) {
      throw new Error("Insufficient balance");
    }

    const paymentId = `bill_${nanoid(16)}`;

    await prisma.billPayment.create({
      data: {
        id: paymentId,
        walletId,
        providerId,
        providerCode: provider.code,
        category: provider.category,
        accountNumber,
        amount,
        fee,
        currency: provider.currency,
        status: "PENDING",
        isScheduled,
        scheduledPaymentId: scheduleId,
        metadata: additionalFields,
      },
    });

    // Debit and process
    await enhancedWalletService.debit({
      walletId,
      amount: totalAmount,
      currency: provider.currency as any,
      description: `${provider.name} - ${accountNumber} (Scheduled)`,
      reference: paymentId,
    });

    const providerResult = await this.processWithProvider(provider, {
      paymentId,
      accountNumber,
      amount,
      additionalFields,
    });

    await prisma.billPayment.update({
      where: { id: paymentId },
      data: {
        status: "COMPLETED",
        providerReference: providerResult.reference,
        completedAt: new Date(),
      },
    });

    return {
      paymentId,
      status: "COMPLETED",
      providerName: provider.name,
      amount,
      fee,
      totalAmount,
      currency: provider.currency,
      reference: providerResult.reference,
      createdAt: new Date(),
    };
  }

  private calculateNextPaymentDate(
    currentDate: Date,
    frequency: "weekly" | "monthly" | "custom",
  ): Date {
    const next = new Date(currentDate);

    switch (frequency) {
      case "weekly":
        next.setDate(next.getDate() + 7);
        break;
      case "monthly":
        next.setMonth(next.getMonth() + 1);
        break;
      case "custom":
        next.setDate(next.getDate() + 30);
        break;
    }

    return next;
  }

  private generateElectricityToken(): string {
    // Generate a 20-digit prepaid electricity token
    const groups = [];
    for (let i = 0; i < 4; i++) {
      groups.push(String(Math.floor(Math.random() * 100000)).padStart(5, "0"));
    }
    return groups.join("-");
  }
}

// Export singleton instance
export const billPaymentService = new BillPaymentService();

// Export with expected names for index.ts
export { BillPaymentService as BillsService };
export const billsService = billPaymentService;
