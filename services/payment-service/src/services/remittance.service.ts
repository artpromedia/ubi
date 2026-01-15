/**
 * International Remittance Service
 * Cross-border money transfers across Africa
 */

import { nanoid } from "nanoid";

import { enhancedWalletService } from "./enhanced-wallet.service";
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
import type { Currency } from "@prisma/client";

// ===========================================
// CONSTANTS
// ===========================================

const QUOTE_VALIDITY_MINUTES = 15;

// Supported corridors with providers (extended with isActive tracking)
const CORRIDORS: Record<string, RemittanceCorridor & { isActive: boolean }> = {
  NGN_KES: {
    sourceCountry: "Nigeria",
    sourceCurrency: "NGN",
    destinationCountry: "Kenya",
    destinationCurrency: "KES",
    minAmount: 5000,
    maxAmount: 5000000,
    providers: ["INTERNAL", "WORLDREMIT", "WISE"],
    isActive: true,
  },
  KES_NGN: {
    sourceCountry: "Kenya",
    sourceCurrency: "KES",
    destinationCountry: "Nigeria",
    destinationCurrency: "NGN",
    minAmount: 500,
    maxAmount: 500000,
    providers: ["INTERNAL", "WORLDREMIT"],
    isActive: true,
  },
  ZAR_NGN: {
    sourceCountry: "South Africa",
    sourceCurrency: "ZAR",
    destinationCountry: "Nigeria",
    destinationCurrency: "NGN",
    minAmount: 100,
    maxAmount: 100000,
    providers: ["WORLDREMIT", "WISE"],
    isActive: true,
  },
  GHS_NGN: {
    sourceCountry: "Ghana",
    sourceCurrency: "GHS",
    destinationCountry: "Nigeria",
    destinationCurrency: "NGN",
    minAmount: 50,
    maxAmount: 50000,
    providers: ["INTERNAL", "WORLDREMIT"],
    isActive: true,
  },
  RWF_KES: {
    sourceCountry: "Rwanda",
    sourceCurrency: "RWF",
    destinationCountry: "Kenya",
    destinationCurrency: "KES",
    minAmount: 5000,
    maxAmount: 5000000,
    providers: ["INTERNAL"],
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
    destinationCurrency: Currency,
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
      destinationCurrency,
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
        `Corridor ${sourceCurrency} to ${destinationCurrency} not available`,
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
        "International transfers not enabled. Upgrade your account to access this feature.",
      );
    }

    // Get exchange rate
    const { rate: exchangeRate } = await this.getExchangeRate(
      sourceCurrency,
      destinationCurrency,
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
        `Minimum amount is ${corridor.minAmount} ${sourceCurrency}`,
      );
    }
    if (calculatedSourceAmount > corridor.maxAmount) {
      throw new Error(
        `Maximum amount is ${corridor.maxAmount} ${sourceCurrency}`,
      );
    }

    // Calculate fees from different providers
    const providerQuotes = await Promise.all(
      corridor.providers.map(async (provider) => {
        const { fee, deliveryTime } = await this.getProviderQuote(
          provider as RemittanceProvider,
          calculatedSourceAmount,
          sourceCurrency,
          destinationCurrency,
        );
        return {
          provider: provider as RemittanceProvider,
          fee,
          total: calculatedSourceAmount + fee,
          deliveryTime,
        };
      }),
    );

    // Sort by total cost
    providerQuotes.sort((a, b) => a.total - b.total);
    const bestQuote = providerQuotes[0];

    if (!bestQuote) {
      throw new Error("No providers available for this corridor");
    }

    const quoteId = `quote_${nanoid(16)}`;
    const validUntil = new Date(
      Date.now() + QUOTE_VALIDITY_MINUTES * 60 * 1000,
    );

    // Store quote for later use
    await redis.setex(
      `remit_quote:${quoteId}`,
      QUOTE_VALIDITY_MINUTES * 60,
      JSON.stringify({
        quoteId,
        sourceCurrency,
        destinationCurrency,
        sourceAmount: calculatedSourceAmount,
        destinationAmount: calculatedDestinationAmount,
        exchangeRate,
        provider: bestQuote.provider,
        fee: bestQuote.fee,
        userId,
      }),
    );

    return {
      provider: bestQuote.provider,
      sendAmount: Math.round(calculatedSourceAmount * 100) / 100,
      sendCurrency: sourceCurrency,
      receiveAmount: Math.round(calculatedDestinationAmount * 100) / 100,
      receiveCurrency: destinationCurrency,
      exchangeRate,
      fee: bestQuote.fee,
      totalAmount: bestQuote.total,
      deliveryTime: bestQuote.deliveryTime,
      deliveryMethod:
        corridor.providers.length > 0 ? "bank_transfer" : "bank_transfer",
      expiresAt: validUntil,
    };
  }

  /**
   * Send remittance
   */
  async sendRemittance(params: RemittanceParams): Promise<Remittance> {
    const {
      walletId,
      provider: _provider,
      sendAmount: _sendAmount,
      sendCurrency: _sendCurrency,
      receiveCurrency: _receiveCurrency,
      recipientName,
      recipientCountry,
      recipientPhone,
      recipientEmail,
      recipientBank,
      recipientAccount,
      deliveryMethod,
      purposeOfTransfer,
      pin,
      idempotencyKey,
    } = params;

    // Verify PIN if provided
    if (pin) {
      const pinValid = await enhancedWalletService.verifyPin(walletId, pin);
      if (!pinValid) {
        throw new Error("Invalid PIN");
      }
    }

    // Get quote from cache using idempotency key as quote reference
    const quoteCached = await redis.get(`remit_quote:${idempotencyKey}`);
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
      "international",
    );
    if (!limitCheck.allowed) {
      throw new Error(
        limitCheck.reason || "International transfer limit exceeded",
      );
    }

    // Check balance
    const balance = await enhancedWalletService.getBalance(
      walletId,
      quote.sourceCurrency,
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
        recipientCountry,
        recipientPhone,
        recipientEmail,
        recipientBankCode: recipientBank,
        recipientBankAccount: recipientAccount,
        deliveryMethod,
        purpose: purposeOfTransfer,
        status: "PROCESSING",
      },
    });

    // Invalidate quote
    await redis.del(`remit_quote:${idempotencyKey}`);

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

    if (!remittance) {
      return null;
    }

    return this.formatRemittance(remittance);
  }

  /**
   * Get remittance history
   */
  async getRemittances(
    userId: string,
    options: {
      status?: RemittanceStatus;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{ remittances: Remittance[]; total: number }> {
    const { status, limit = 20, offset = 0 } = options;

    const where: Record<string, unknown> = { userId };
    if (status) {
      where.status = status;
    }

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
      remittances: remittances.map(
        (r: {
          id: string;
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
          recipientCountry: string;
          recipientPhone: string | null;
          recipientEmail: string | null;
          deliveryMethod: string;
          purpose: string | null;
          status: string;
          providerReference: string | null;
          createdAt: Date;
          completedAt: Date | null;
          failureReason: string | null;
        }) => this.formatRemittance(r),
      ),
      total,
    };
  }

  /**
   * Cancel remittance (if still processing)
   */
  async cancelRemittance(
    remittanceId: string,
    walletId: string,
  ): Promise<void> {
    const remittance = await prisma.remittance.findUnique({
      where: { id: remittanceId },
    });

    if (!remittance || remittance.walletId !== walletId) {
      throw new Error("Remittance not found");
    }

    if (remittance.status !== "PROCESSING" && remittance.status !== "PENDING") {
      throw new Error(
        `Cannot cancel ${remittance.status.toLowerCase()} remittance`,
      );
    }

    // Attempt to cancel with provider
    const cancelled = await this.cancelWithProvider(
      remittanceId,
      remittance.provider,
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

    return recipients.map(
      (r: {
        id: string;
        name: string;
        country: string;
        phone: string | null;
        email: string | null;
        lastUsedAt: Date | null;
      }) => ({
        id: r.id,
        name: r.name,
        country: r.country,
        phone: r.phone || undefined,
        email: r.email || undefined,
        lastUsedAt: r.lastUsedAt || undefined,
      }),
    );
  }

  // ===========================================
  // PRIVATE HELPERS
  // ===========================================

  private async fetchExchangeRate(
    source: Currency,
    destination: Currency,
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
    _sourceCurrency: Currency,
    _destinationCurrency: Currency,
  ): Promise<{ fee: number; deliveryTime: string }> {
    // Provider-specific fee structures
    const fees: Record<
      RemittanceProvider,
      { percentage: number; flat: number; time: string }
    > = {
      INTERNAL: { percentage: 0.005, flat: 500, time: "1-2 hours" },
      WORLDREMIT: { percentage: 0.01, flat: 1000, time: "2-4 hours" },
      WISE: { percentage: 0.007, flat: 800, time: "1-3 hours" },
      FLUTTERWAVE: { percentage: 0.015, flat: 0, time: "2-6 hours" },
      CHIPPER: { percentage: 0.01, flat: 750, time: "2-4 hours" },
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
          error,
        );
        await this.handleFailedRemittance(remittanceId);
      }
    }, 5000); // Simulate 5 second processing
  }

  private async handleFailedRemittance(remittanceId: string): Promise<void> {
    const remittance = await prisma.remittance.findUnique({
      where: { id: remittanceId },
    });

    if (!remittance) {
      return;
    }

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
    _remittanceId: string,
    _provider: string,
  ): Promise<boolean> {
    // In production, call provider API to cancel
    // For demo, allow cancellation if processing
    return true;
  }

  private formatRemittance(remittance: {
    id: string;
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
    recipientCountry: string;
    recipientPhone: string | null;
    recipientEmail: string | null;
    deliveryMethod: string;
    purpose: string | null;
    status: string;
    providerReference: string | null;
    createdAt: Date;
    completedAt: Date | null;
    failureReason: string | null;
  }): Remittance {
    return {
      id: remittance.id,
      provider: remittance.provider as RemittanceProvider,
      sendAmount: Number(remittance.sourceAmount),
      sendCurrency: remittance.sourceCurrency,
      receiveAmount: Number(remittance.destinationAmount),
      receiveCurrency: remittance.destinationCurrency,
      exchangeRate: Number(remittance.exchangeRate),
      fee: Number(remittance.fee),
      totalAmount: Number(remittance.totalCharged),
      status: remittance.status as RemittanceStatus,
      recipientName: remittance.recipientName,
      recipientCountry: remittance.recipientCountry,
      deliveryMethod: remittance.deliveryMethod,
      trackingNumber: remittance.providerReference || undefined,
      completedAt: remittance.completedAt || undefined,
      createdAt: remittance.createdAt,
    };
  }
}

// Export singleton instance
export const remittanceService = new RemittanceService();
