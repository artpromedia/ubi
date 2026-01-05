/**
 * International Remittance Service
 * Cross-border money transfers across Africa
 */

import type { Currency } from "@prisma/client";
import { nanoid } from "nanoid";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import type {
  Remittance,
  RemittanceCorridor,
  RemittanceParams,
  RemittanceProvider,
  RemittanceQuote,
  RemittanceStatus,
} from "../types/fintech.types";
import { enhancedWalletService } from "./enhanced-wallet.service";

// ===========================================
// CONSTANTS
// ===========================================

const QUOTE_VALIDITY_MINUTES = 15;
const MAX_REMITTANCE_AMOUNT_USD = 10000;

// Supported corridors with providers
const CORRIDORS: Record<string, RemittanceCorridor> = {
  NGN_KES: {
    id: "NGN_KES",
    sourceCurrency: "NGN",
    destinationCurrency: "KES",
    sourceCountry: "Nigeria",
    destinationCountry: "Kenya",
    minAmount: 5000,
    maxAmount: 5000000,
    providers: ["UBI_INTERNAL", "WORLD_REMIT", "WISE"],
    estimatedDelivery: "1-2 hours",
    isActive: true,
  },
  KES_NGN: {
    id: "KES_NGN",
    sourceCurrency: "KES",
    destinationCurrency: "NGN",
    sourceCountry: "Kenya",
    destinationCountry: "Nigeria",
    minAmount: 500,
    maxAmount: 500000,
    providers: ["UBI_INTERNAL", "WORLD_REMIT"],
    estimatedDelivery: "1-2 hours",
    isActive: true,
  },
  ZAR_NGN: {
    id: "ZAR_NGN",
    sourceCurrency: "ZAR",
    destinationCurrency: "NGN",
    sourceCountry: "South Africa",
    destinationCountry: "Nigeria",
    minAmount: 100,
    maxAmount: 100000,
    providers: ["WORLD_REMIT", "WISE"],
    estimatedDelivery: "2-4 hours",
    isActive: true,
  },
  GHS_NGN: {
    id: "GHS_NGN",
    sourceCurrency: "GHS",
    destinationCurrency: "NGN",
    sourceCountry: "Ghana",
    destinationCountry: "Nigeria",
    minAmount: 50,
    maxAmount: 50000,
    providers: ["UBI_INTERNAL", "WORLD_REMIT"],
    estimatedDelivery: "1-2 hours",
    isActive: true,
  },
  RWF_KES: {
    id: "RWF_KES",
    sourceCurrency: "RWF",
    destinationCurrency: "KES",
    sourceCountry: "Rwanda",
    destinationCountry: "Kenya",
    minAmount: 5000,
    maxAmount: 5000000,
    providers: ["UBI_INTERNAL"],
    estimatedDelivery: "1-2 hours",
    isActive: true,
  },
};

// Exchange rate cache TTL (in seconds)
const RATE_CACHE_TTL = 300; // 5 minutes

// ===========================================
// REMITTANCE SERVICE
// ===========================================

export class RemittanceService {
  /**
   * Get available corridors
   */
  async getCorridors(sourceCurrency?: Currency): Promise<RemittanceCorridor[]> {
    const corridors = Object.values(CORRIDORS).filter((c) => c.isActive);

    if (sourceCurrency) {
      return corridors.filter((c) => c.sourceCurrency === sourceCurrency);
    }

    return corridors;
  }

  /**
   * Get exchange rate for a corridor
   */
  async getExchangeRate(
    sourceCurrency: Currency,
    destinationCurrency: Currency
  ): Promise<{
    rate: number;
    inverseRate: number;
    timestamp: Date;
    validUntil: Date;
  }> {
    const cacheKey = `fx_rate:${sourceCurrency}_${destinationCurrency}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    // In production, fetch from FX rate provider
    const rate = await this.fetchExchangeRate(
      sourceCurrency,
      destinationCurrency
    );
    const now = new Date();
    const result = {
      rate,
      inverseRate: 1 / rate,
      timestamp: now,
      validUntil: new Date(now.getTime() + RATE_CACHE_TTL * 1000),
    };

    // Cache the rate
    await redis.setex(cacheKey, RATE_CACHE_TTL, JSON.stringify(result));

    return result;
  }

  /**
   * Get remittance quote
   */
  async getQuote(params: {
    sourceCurrency: Currency;
    destinationCurrency: Currency;
    sourceAmount?: number;
    destinationAmount?: number;
    userId: string;
  }): Promise<RemittanceQuote> {
    const {
      sourceCurrency,
      destinationCurrency,
      sourceAmount,
      destinationAmount,
      userId,
    } = params;

    // Get corridor
    const corridorId = `${sourceCurrency}_${destinationCurrency}`;
    const corridor = CORRIDORS[corridorId];

    if (!corridor || !corridor.isActive) {
      throw new Error(
        `Corridor ${sourceCurrency} to ${destinationCurrency} not available`
      );
    }

    // Check user eligibility (must have international feature)
    const wallet = await prisma.wallet.findUnique({
      where: { userId },
    });

    if (
      !wallet ||
      !wallet.features ||
      !(wallet.features as Record<string, boolean>).international
    ) {
      throw new Error(
        "International transfers not enabled. Upgrade your account to access this feature."
      );
    }

    // Get exchange rate
    const { rate: exchangeRate } = await this.getExchangeRate(
      sourceCurrency,
      destinationCurrency
    );

    // Calculate amounts
    let calculatedSourceAmount: number;
    let calculatedDestinationAmount: number;

    if (sourceAmount) {
      calculatedSourceAmount = sourceAmount;
      calculatedDestinationAmount = sourceAmount * exchangeRate;
    } else if (destinationAmount) {
      calculatedDestinationAmount = destinationAmount;
      calculatedSourceAmount = destinationAmount / exchangeRate;
    } else {
      throw new Error("Either sourceAmount or destinationAmount is required");
    }

    // Validate amount limits
    if (calculatedSourceAmount < corridor.minAmount) {
      throw new Error(
        `Minimum amount is ${corridor.minAmount} ${sourceCurrency}`
      );
    }
    if (calculatedSourceAmount > corridor.maxAmount) {
      throw new Error(
        `Maximum amount is ${corridor.maxAmount} ${sourceCurrency}`
      );
    }

    // Calculate fees from different providers
    const providerQuotes = await Promise.all(
      corridor.providers.map(async (provider) => {
        const { fee, deliveryTime } = await this.getProviderQuote(
          provider as RemittanceProvider,
          calculatedSourceAmount,
          sourceCurrency,
          destinationCurrency
        );
        return {
          provider: provider as RemittanceProvider,
          fee,
          total: calculatedSourceAmount + fee,
          deliveryTime,
        };
      })
    );

    // Sort by total cost
    providerQuotes.sort((a, b) => a.total - b.total);
    const bestQuote = providerQuotes[0];

    const quoteId = `quote_${nanoid(16)}`;
    const validUntil = new Date(
      Date.now() + QUOTE_VALIDITY_MINUTES * 60 * 1000
    );

    // Store quote for later use
    await redis.setex(
      `remit_quote:${quoteId}`,
      QUOTE_VALIDITY_MINUTES * 60,
      JSON.stringify({
        sourceCurrency,
        destinationCurrency,
        sourceAmount: calculatedSourceAmount,
        destinationAmount: calculatedDestinationAmount,
        exchangeRate,
        provider: bestQuote.provider,
        fee: bestQuote.fee,
        userId,
      })
    );

    return {
      quoteId,
      sourceCurrency,
      destinationCurrency,
      sourceAmount: Math.round(calculatedSourceAmount * 100) / 100,
      destinationAmount: Math.round(calculatedDestinationAmount * 100) / 100,
      exchangeRate,
      fee: bestQuote.fee,
      totalCost: bestQuote.total,
      provider: bestQuote.provider,
      estimatedDelivery: bestQuote.deliveryTime,
      validUntil,
      alternativeProviders: providerQuotes.slice(1).map((q) => ({
        provider: q.provider,
        fee: q.fee,
        total: q.total,
        deliveryTime: q.deliveryTime,
      })),
    };
  }

  /**
   * Send remittance
   */
  async sendRemittance(params: RemittanceParams): Promise<Remittance> {
    const {
      walletId,
      quoteId,
      recipientName,
      recipientPhone,
      recipientEmail,
      recipientBankCode,
      recipientBankAccount,
      recipientMobileWallet,
      deliveryMethod,
      purpose,
      pin,
    } = params;

    // Verify PIN
    const pinValid = await enhancedWalletService.verifyPin(walletId, pin);
    if (!pinValid) {
      throw new Error("Invalid PIN");
    }

    // Get quote
    const quoteCached = await redis.get(`remit_quote:${quoteId}`);
    if (!quoteCached) {
      throw new Error("Quote expired. Please get a new quote.");
    }

    const quote = JSON.parse(quoteCached);

    // Verify wallet ownership
    const wallet = await enhancedWalletService.getWalletById(walletId);
    if (!wallet || wallet.userId !== quote.userId) {
      throw new Error("Unauthorized");
    }

    // Check limits
    const limitCheck = await enhancedWalletService.checkLimit(
      walletId,
      quote.sourceAmount + quote.fee,
      "international"
    );
    if (!limitCheck.allowed) {
      throw new Error(
        limitCheck.reason || "International transfer limit exceeded"
      );
    }

    // Check balance
    const balance = await enhancedWalletService.getBalance(
      walletId,
      quote.sourceCurrency
    );
    const totalAmount = quote.sourceAmount + quote.fee;
    if (balance.available < totalAmount) {
      throw new Error("Insufficient balance");
    }

    const remittanceId = `remit_${nanoid(16)}`;

    // Debit wallet
    await enhancedWalletService.debit({
      walletId,
      amount: totalAmount,
      currency: quote.sourceCurrency,
      description: `Remittance to ${recipientName} - ${quote.destinationCurrency}`,
      reference: remittanceId,
    });

    // Create remittance record
    const remittance = await prisma.remittance.create({
      data: {
        id: remittanceId,
        walletId,
        userId: wallet.userId,
        sourceCurrency: quote.sourceCurrency,
        destinationCurrency: quote.destinationCurrency,
        sourceAmount: quote.sourceAmount,
        destinationAmount: quote.destinationAmount,
        exchangeRate: quote.exchangeRate,
        fee: quote.fee,
        totalCharged: totalAmount,
        provider: quote.provider,
        recipientName,
        recipientPhone,
        recipientEmail,
        recipientBankCode,
        recipientBankAccount,
        recipientMobileWallet,
        deliveryMethod,
        purpose,
        status: "PROCESSING",
      },
    });

    // Invalidate quote
    await redis.del(`remit_quote:${quoteId}`);

    // Process with provider (async)
    this.processWithProvider(remittanceId);

    return this.formatRemittance(remittance);
  }

  /**
   * Get remittance status
   */
  async getRemittance(remittanceId: string): Promise<Remittance | null> {
    const remittance = await prisma.remittance.findUnique({
      where: { id: remittanceId },
    });

    if (!remittance) return null;

    return this.formatRemittance(remittance);
  }

  /**
   * Get remittance history
   */
  async getRemittances(
    userId: string,
    options: { status?: RemittanceStatus; limit?: number; offset?: number } = {}
  ): Promise<{ remittances: Remittance[]; total: number }> {
    const { status, limit = 20, offset = 0 } = options;

    const where: Record<string, unknown> = { userId };
    if (status) where.status = status;

    const [remittances, total] = await Promise.all([
      prisma.remittance.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.remittance.count({ where }),
    ]);

    return {
      remittances: remittances.map((r) => this.formatRemittance(r)),
      total,
    };
  }

  /**
   * Cancel remittance (if still processing)
   */
  async cancelRemittance(
    remittanceId: string,
    walletId: string
  ): Promise<void> {
    const remittance = await prisma.remittance.findUnique({
      where: { id: remittanceId },
    });

    if (!remittance || remittance.walletId !== walletId) {
      throw new Error("Remittance not found");
    }

    if (remittance.status !== "PROCESSING" && remittance.status !== "PENDING") {
      throw new Error(
        `Cannot cancel ${remittance.status.toLowerCase()} remittance`
      );
    }

    // Attempt to cancel with provider
    const cancelled = await this.cancelWithProvider(
      remittanceId,
      remittance.provider
    );

    if (!cancelled) {
      throw new Error("Cannot cancel - transfer may already be in progress");
    }

    // Refund
    await enhancedWalletService.credit({
      walletId,
      amount: Number(remittance.totalCharged),
      currency: remittance.sourceCurrency,
      description: `Refund - Cancelled remittance ${remittanceId}`,
      reference: `refund_${remittanceId}`,
    });

    await prisma.remittance.update({
      where: { id: remittanceId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
      },
    });
  }

  // ===========================================
  // RECIPIENT MANAGEMENT
  // ===========================================

  /**
   * Save a remittance recipient
   */
  async saveRecipient(params: {
    userId: string;
    name: string;
    country: string;
    phone?: string;
    email?: string;
    bankCode?: string;
    bankAccount?: string;
    mobileWallet?: string;
  }): Promise<{ id: string }> {
    const recipientId = `rcpt_${nanoid(12)}`;

    await prisma.remittanceRecipient.create({
      data: {
        id: recipientId,
        userId: params.userId,
        name: params.name,
        country: params.country,
        phone: params.phone,
        email: params.email,
        bankCode: params.bankCode,
        bankAccount: params.bankAccount,
        mobileWallet: params.mobileWallet,
      },
    });

    return { id: recipientId };
  }

  /**
   * Get saved recipients
   */
  async getRecipients(userId: string): Promise<
    Array<{
      id: string;
      name: string;
      country: string;
      phone?: string;
      email?: string;
      lastUsedAt?: Date;
    }>
  > {
    const recipients = await prisma.remittanceRecipient.findMany({
      where: { userId },
      orderBy: [{ lastUsedAt: "desc" }, { name: "asc" }],
    });

    return recipients.map((r) => ({
      id: r.id,
      name: r.name,
      country: r.country,
      phone: r.phone || undefined,
      email: r.email || undefined,
      lastUsedAt: r.lastUsedAt || undefined,
    }));
  }

  // ===========================================
  // PRIVATE HELPERS
  // ===========================================

  private async fetchExchangeRate(
    source: Currency,
    destination: Currency
  ): Promise<number> {
    // In production, integrate with FX rate providers
    // For demo, return simulated rates
    const rates: Record<string, number> = {
      NGN_KES: 0.27, // 1 NGN = 0.27 KES
      KES_NGN: 3.7, // 1 KES = 3.7 NGN
      ZAR_NGN: 82.5, // 1 ZAR = 82.5 NGN
      GHS_NGN: 120, // 1 GHS = 120 NGN
      RWF_KES: 0.12, // 1 RWF = 0.12 KES
      NGN_USD: 0.00065, // 1 NGN = 0.00065 USD
      USD_NGN: 1540, // 1 USD = 1540 NGN
    };

    const key = `${source}_${destination}`;
    const rate = rates[key];

    if (!rate) {
      throw new Error(`Exchange rate not available for ${key}`);
    }

    // Add small random variance (±0.5%)
    const variance = 1 + (Math.random() - 0.5) * 0.01;
    return rate * variance;
  }

  private async getProviderQuote(
    provider: RemittanceProvider,
    amount: number,
    sourceCurrency: Currency,
    destinationCurrency: Currency
  ): Promise<{ fee: number; deliveryTime: string }> {
    // Provider-specific fee structures
    const fees: Record<
      RemittanceProvider,
      { percentage: number; flat: number; time: string }
    > = {
      UBI_INTERNAL: { percentage: 0.005, flat: 500, time: "1-2 hours" },
      WORLD_REMIT: { percentage: 0.01, flat: 1000, time: "2-4 hours" },
      WISE: { percentage: 0.007, flat: 800, time: "1-3 hours" },
      FLUTTERWAVE: { percentage: 0.015, flat: 0, time: "2-6 hours" },
    };

    const config = fees[provider];
    const fee = Math.round(amount * config.percentage + config.flat);

    return {
      fee,
      deliveryTime: config.time,
    };
  }

  private async processWithProvider(remittanceId: string): Promise<void> {
    // Simulate async processing
    setTimeout(async () => {
      try {
        const remittance = await prisma.remittance.findUnique({
          where: { id: remittanceId },
        });

        if (!remittance || remittance.status !== "PROCESSING") {
          return;
        }

        // In production, call actual provider API
        // For demo, simulate success after delay
        const success = Math.random() > 0.05; // 95% success rate

        if (success) {
          await prisma.remittance.update({
            where: { id: remittanceId },
            data: {
              status: "COMPLETED",
              completedAt: new Date(),
              providerReference: `PRV_${nanoid(12)}`,
            },
          });
        } else {
          // Handle failure
          await this.handleFailedRemittance(remittanceId);
        }
      } catch (error) {
        console.error(
          `Remittance processing error for ${remittanceId}:`,
          error
        );
        await this.handleFailedRemittance(remittanceId);
      }
    }, 5000); // Simulate 5 second processing
  }

  private async handleFailedRemittance(remittanceId: string): Promise<void> {
    const remittance = await prisma.remittance.findUnique({
      where: { id: remittanceId },
    });

    if (!remittance) return;

    // Refund
    await enhancedWalletService.credit({
      walletId: remittance.walletId,
      amount: Number(remittance.totalCharged),
      currency: remittance.sourceCurrency,
      description: `Refund - Failed remittance ${remittanceId}`,
      reference: `refund_${remittanceId}`,
    });

    await prisma.remittance.update({
      where: { id: remittanceId },
      data: {
        status: "FAILED",
        failureReason: "Provider processing failed",
      },
    });
  }

  private async cancelWithProvider(
    remittanceId: string,
    provider: string
  ): Promise<boolean> {
    // In production, call provider API to cancel
    // For demo, allow cancellation if processing
    return true;
  }

  private formatRemittance(remittance: {
    id: string;
    walletId: string;
    userId: string;
    sourceCurrency: string;
    destinationCurrency: string;
    sourceAmount: unknown;
    destinationAmount: unknown;
    exchangeRate: unknown;
    fee: unknown;
    totalCharged: unknown;
    provider: string;
    recipientName: string;
    recipientPhone: string | null;
    recipientEmail: string | null;
    deliveryMethod: string;
    purpose: string | null;
    status: string;
    providerReference: string | null;
    createdAt: Date;
    completedAt: Date | null;
    cancelledAt: Date | null;
    failureReason: string | null;
  }): Remittance {
    return {
      id: remittance.id,
      walletId: remittance.walletId,
      userId: remittance.userId,
      sourceCurrency: remittance.sourceCurrency as Currency,
      destinationCurrency: remittance.destinationCurrency as Currency,
      sourceAmount: Number(remittance.sourceAmount),
      destinationAmount: Number(remittance.destinationAmount),
      exchangeRate: Number(remittance.exchangeRate),
      fee: Number(remittance.fee),
      totalCharged: Number(remittance.totalCharged),
      provider: remittance.provider as RemittanceProvider,
      recipientName: remittance.recipientName,
      recipientPhone: remittance.recipientPhone || undefined,
      recipientEmail: remittance.recipientEmail || undefined,
      deliveryMethod: remittance.deliveryMethod as
        | "BANK"
        | "MOBILE_WALLET"
        | "CASH_PICKUP",
      purpose: remittance.purpose || undefined,
      status: remittance.status as RemittanceStatus,
      providerReference: remittance.providerReference || undefined,
      createdAt: remittance.createdAt,
      completedAt: remittance.completedAt || undefined,
      cancelledAt: remittance.cancelledAt || undefined,
      failureReason: remittance.failureReason || undefined,
    };
  }
}

// Export singleton instance
export const remittanceService = new RemittanceService();
