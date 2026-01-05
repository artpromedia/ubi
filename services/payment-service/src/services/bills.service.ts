/**
 * Bill Payment Service
 * Airtime, data, electricity, TV, internet, and more
 */

import { nanoid } from "nanoid";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import type {
  BillCategory,
  BillInputField,
  BillPaymentParams,
  BillPaymentResult,
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
    countryCode: string
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

    const formatted = providers.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      category: p.category as BillCategory,
      countryCode: p.countryCode,
      currency: p.currency,
      logo: p.logoUrl || undefined,
      inputFields: (p.inputFields as BillInputField[]) || [],
      minAmount: p.minAmount ? Number(p.minAmount) : undefined,
      maxAmount: p.maxAmount ? Number(p.maxAmount) : undefined,
      fixedAmounts: p.fixedAmounts as number[] | undefined,
      commissionRate: Number(p.commissionRate),
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
      name: provider.name,
      code: provider.code,
      category: provider.category as BillCategory,
      countryCode: provider.countryCode,
      currency: provider.currency,
      logo: provider.logoUrl || undefined,
      inputFields: (provider.inputFields as BillInputField[]) || [],
      minAmount: provider.minAmount ? Number(provider.minAmount) : undefined,
      maxAmount: provider.maxAmount ? Number(provider.maxAmount) : undefined,
      fixedAmounts: provider.fixedAmounts as number[] | undefined,
      commissionRate: Number(provider.commissionRate),
    };
  }

  /**
   * Validate bill account/meter number
   */
  async validateAccount(
    providerId: string,
    accountNumber: string,
    additionalFields?: Record<string, string>
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
          field.key === "accountNumber"
            ? accountNumber
            : additionalFields?.[field.key];

        if (!value) {
          return {
            valid: false,
            error: `${field.label} is required`,
          };
        }

        if (field.validation) {
          const regex = new RegExp(field.validation);
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
      additionalFields
    );

    return validation;
  }

  /**
   * Get bill amount (for bills with variable amounts like electricity)
   */
  async getBillAmount(
    providerId: string,
    accountNumber: string,
    additionalFields?: Record<string, string>
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
      accountNumber,
      amount,
      pin,
      additionalFields,
    } = params;

    // Validate wallet
    const wallet = await enhancedWalletService.getWalletById(walletId);
    if (!wallet) {
      throw new Error("Wallet not found");
    }

    // Verify PIN
    const pinValid = await enhancedWalletService.verifyPin(walletId, pin);
    if (!pinValid) {
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
    if (provider.fixedAmounts && !provider.fixedAmounts.includes(amount)) {
      throw new Error(
        `Amount must be one of: ${provider.fixedAmounts.join(", ")}`
      );
    }

    // Validate account
    const validation = await this.validateAccount(
      providerId,
      accountNumber,
      additionalFields
    );
    if (!validation.valid) {
      throw new Error(validation.error || "Account validation failed");
    }

    // Check limits
    const limitCheck = await enhancedWalletService.checkLimit(
      walletId,
      amount,
      "bills"
    );
    if (!limitCheck.allowed) {
      throw new Error(limitCheck.reason || "Bill payment limit exceeded");
    }

    // Calculate fee
    const fee = Math.round(amount * provider.commissionRate * 100) / 100;
    const totalAmount = amount + fee;

    // Check balance
    const balance = await enhancedWalletService.getBalance(
      walletId,
      provider.currency
    );
    if (balance.available < totalAmount) {
      throw new Error("Insufficient balance");
    }

    const paymentId = `bill_${nanoid(16)}`;

    // Create payment record
    await prisma.billPayment.create({
      data: {
        id: paymentId,
        walletId,
        providerId,
        providerCode: provider.code,
        category: provider.category,
        accountNumber,
        customerName: validation.customerName,
        amount,
        fee,
        currency: provider.currency,
        status: "PENDING",
        metadata: additionalFields,
      },
    });

    try {
      // Debit wallet
      await enhancedWalletService.debit({
        walletId,
        amount: totalAmount,
        currency: provider.currency,
        description: `${provider.name} - ${accountNumber}`,
        reference: paymentId,
      });

      // Process payment with provider
      const providerResult = await this.processWithProvider(provider, {
        paymentId,
        accountNumber,
        amount,
        additionalFields,
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
        amount,
        fee,
        totalAmount,
        currency: provider.currency,
        providerReference: providerResult.reference,
        receiptNumber: providerResult.receiptNumber,
        token: providerResult.token,
        completedAt: new Date(),
      };
    } catch (error) {
      // Refund on failure
      await enhancedWalletService.credit({
        walletId,
        amount: totalAmount,
        currency: provider.currency,
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
    } = {}
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
      payments: payments.map((p) => ({
        paymentId: p.id,
        status: p.status as "PENDING" | "COMPLETED" | "FAILED",
        providerName: p.provider.name,
        category: p.category as BillCategory,
        accountNumber: p.accountNumber,
        customerName: p.customerName || undefined,
        amount: Number(p.amount),
        fee: Number(p.fee),
        totalAmount: Number(p.amount) + Number(p.fee),
        currency: p.currency,
        providerReference: p.providerReference || undefined,
        receiptNumber: p.receiptNumber || undefined,
        token: p.token || undefined,
        createdAt: p.createdAt,
        completedAt: p.completedAt || undefined,
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
      frequency: "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";
      startDate: Date;
      endDate?: Date;
      additionalFields?: Record<string, string>;
    }
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
      accountNumber: scheduled.accountNumber,
      amount: Number(scheduled.amount),
      currency: scheduled.currency,
      frequency: scheduled.frequency as
        | "DAILY"
        | "WEEKLY"
        | "BIWEEKLY"
        | "MONTHLY",
      nextPaymentDate: scheduled.nextPaymentDate,
      isActive: scheduled.isActive,
    };
  }

  /**
   * Get scheduled payments
   */
  async getScheduledPayments(
    walletId: string
  ): Promise<ScheduledBillPayment[]> {
    const scheduled = await prisma.scheduledBillPayment.findMany({
      where: { walletId, isActive: true },
      include: { provider: true },
      orderBy: { nextPaymentDate: "asc" },
    });

    return scheduled.map((s) => ({
      id: s.id,
      providerId: s.providerId,
      providerName: s.provider.name,
      accountNumber: s.accountNumber,
      amount: Number(s.amount),
      currency: s.currency,
      frequency: s.frequency as "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY",
      nextPaymentDate: s.nextPaymentDate,
      isActive: s.isActive,
      lastPaymentDate: s.lastPaymentDate || undefined,
      totalPayments: s.totalPayments,
    }));
  }

  /**
   * Cancel scheduled payment
   */
  async cancelScheduledPayment(
    scheduleId: string,
    walletId: string
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
          scheduled.frequency as "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY"
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
        console.error(
          `Failed to process scheduled payment ${scheduled.id}:`,
          error
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
    provider: BillProvider,
    accountNumber: string,
    additionalFields?: Record<string, string>
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
      accountDetails: {
        accountNumber,
        accountType: "Prepaid",
        status: "Active",
      },
    };
  }

  private async processWithProvider(
    provider: BillProvider,
    params: {
      paymentId: string;
      accountNumber: string;
      amount: number;
      additionalFields?: Record<string, string>;
    }
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

    const fee = Math.round(amount * provider.commissionRate * 100) / 100;
    const totalAmount = amount + fee;

    const balance = await enhancedWalletService.getBalance(
      walletId,
      provider.currency
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
      currency: provider.currency,
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
      amount,
      fee,
      totalAmount,
      currency: provider.currency,
      providerReference: providerResult.reference,
      completedAt: new Date(),
    };
  }

  private calculateNextPaymentDate(
    currentDate: Date,
    frequency: "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY"
  ): Date {
    const next = new Date(currentDate);

    switch (frequency) {
      case "DAILY":
        next.setDate(next.getDate() + 1);
        break;
      case "WEEKLY":
        next.setDate(next.getDate() + 7);
        break;
      case "BIWEEKLY":
        next.setDate(next.getDate() + 14);
        break;
      case "MONTHLY":
        next.setMonth(next.getMonth() + 1);
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
