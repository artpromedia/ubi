/**
 * Enhanced Wallet Service
 * Multi-currency wallet with tiered limits, P2P transfers, and compliance
 */

import type { Currency } from "@prisma/client";
import { nanoid } from "nanoid";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import type {
  KYCLevel,
  LimitCheckResult,
  WalletBalance,
  WalletFeatures,
  WalletInfo,
  WalletStatus,
  WalletTier,
  WalletTierLimits,
} from "../types/fintech.types";

// ===========================================
// CONSTANTS
// ===========================================

const TIER_LIMITS: Record<WalletTier, WalletTierLimits> = {
  BASIC: {
    tier: "BASIC",
    dailyTransactionLimit: 50000, // ~$100 USD equivalent
    monthlyTransactionLimit: 200000,
    singleTransactionLimit: 20000,
    maxBalance: 100000,
    p2pEnabled: true,
    billsEnabled: true,
    cardsEnabled: false,
    loansEnabled: false,
    internationalEnabled: false,
    savingsInterestRate: 0.02, // 2%
    maxSavingsPockets: 3,
    requiredKycLevel: "BASIC",
  },
  VERIFIED: {
    tier: "VERIFIED",
    dailyTransactionLimit: 500000, // ~$1000 USD
    monthlyTransactionLimit: 2000000,
    singleTransactionLimit: 200000,
    maxBalance: 1000000,
    p2pEnabled: true,
    billsEnabled: true,
    cardsEnabled: true,
    loansEnabled: true,
    internationalEnabled: false,
    savingsInterestRate: 0.04, // 4%
    maxSavingsPockets: 5,
    requiredKycLevel: "STANDARD",
  },
  PREMIUM: {
    tier: "PREMIUM",
    dailyTransactionLimit: 5000000, // ~$10000 USD
    monthlyTransactionLimit: 20000000,
    singleTransactionLimit: 2000000,
    maxBalance: 10000000,
    p2pEnabled: true,
    billsEnabled: true,
    cardsEnabled: true,
    loansEnabled: true,
    internationalEnabled: true,
    savingsInterestRate: 0.06, // 6%
    maxSavingsPockets: 10,
    requiredKycLevel: "ENHANCED",
  },
  BUSINESS: {
    tier: "BUSINESS",
    dailyTransactionLimit: 50000000,
    monthlyTransactionLimit: 200000000,
    singleTransactionLimit: 20000000,
    maxBalance: 100000000,
    p2pEnabled: true,
    billsEnabled: true,
    cardsEnabled: true,
    loansEnabled: true,
    internationalEnabled: true,
    savingsInterestRate: 0.05, // 5%
    maxSavingsPockets: 20,
    requiredKycLevel: "FULL",
  },
};

const CACHE_TTL = 300; // 5 minutes

// ===========================================
// WALLET SERVICE
// ===========================================

export class EnhancedWalletService {
  /**
   * Create a new wallet for a user
   */
  async createWallet(userId: string, currency: Currency): Promise<WalletInfo> {
    // Check if wallet already exists
    const existing = await prisma.wallet.findUnique({
      where: { userId },
    });

    if (existing) {
      throw new Error("Wallet already exists for this user");
    }

    // Create wallet with default balance
    const wallet = await prisma.wallet.create({
      data: {
        userId,
        status: "ACTIVE",
        tier: "BASIC",
        kycLevel: "NONE",
        balances: {
          create: {
            currency,
            availableBalance: 0,
            pendingBalance: 0,
            heldBalance: 0,
          },
        },
      },
      include: {
        balances: true,
      },
    });

    return this.formatWalletInfo(wallet);
  }

  /**
   * Get wallet information
   */
  async getWallet(userId: string): Promise<WalletInfo | null> {
    // Try cache first
    const cacheKey = `wallet:${userId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const wallet = await prisma.wallet.findUnique({
      where: { userId },
      include: {
        balances: true,
      },
    });

    if (!wallet) {
      return null;
    }

    const walletInfo = this.formatWalletInfo(wallet);

    // Cache the result
    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(walletInfo));

    return walletInfo;
  }

  /**
   * Get wallet by ID
   */
  async getWalletById(walletId: string): Promise<WalletInfo | null> {
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      include: {
        balances: true,
      },
    });

    if (!wallet) {
      return null;
    }

    return this.formatWalletInfo(wallet);
  }

  /**
   * Get balance for a specific currency
   */
  async getBalance(
    walletId: string,
    currency: Currency
  ): Promise<WalletBalance> {
    const balance = await prisma.walletBalance.findUnique({
      where: {
        walletId_currency: { walletId, currency },
      },
    });

    if (!balance) {
      // Return zero balance if currency not set up
      return {
        currency,
        available: 0,
        pending: 0,
        held: 0,
        total: 0,
      };
    }

    return {
      currency: balance.currency,
      available: Number(balance.availableBalance),
      pending: Number(balance.pendingBalance),
      held: Number(balance.heldBalance),
      total:
        Number(balance.availableBalance) +
        Number(balance.pendingBalance) +
        Number(balance.heldBalance),
    };
  }

  /**
   * Get all balances for a wallet
   */
  async getAllBalances(walletId: string): Promise<WalletBalance[]> {
    const balances = await prisma.walletBalance.findMany({
      where: { walletId },
    });

    return balances.map((b) => ({
      currency: b.currency,
      available: Number(b.availableBalance),
      pending: Number(b.pendingBalance),
      held: Number(b.heldBalance),
      total:
        Number(b.availableBalance) +
        Number(b.pendingBalance) +
        Number(b.heldBalance),
    }));
  }

  /**
   * Credit wallet (add funds)
   */
  async credit(params: {
    walletId: string;
    amount: number;
    currency: Currency;
    description: string;
    reference?: string;
    transactionId?: string;
  }): Promise<{ newBalance: number; transactionId: string }> {
    const {
      walletId,
      amount,
      currency,
      description,
      reference,
      transactionId,
    } = params;

    if (amount <= 0) {
      throw new Error("Amount must be positive");
    }

    // Check wallet status
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet || wallet.status !== "ACTIVE") {
      throw new Error("Wallet is not active");
    }

    // Check max balance limit
    const tierLimits = TIER_LIMITS[wallet.tier as WalletTier];
    const currentBalance = await this.getBalance(walletId, currency);

    if (currentBalance.total + amount > tierLimits.maxBalance) {
      throw new Error(
        `Credit would exceed maximum balance of ${tierLimits.maxBalance}`
      );
    }

    const txnId = transactionId || `txn_${nanoid(16)}`;

    // Update balance atomically
    const updatedBalance = await prisma.walletBalance.upsert({
      where: {
        walletId_currency: { walletId, currency },
      },
      update: {
        availableBalance: { increment: amount },
        lastActivityAt: new Date(),
      },
      create: {
        walletId,
        currency,
        availableBalance: amount,
        pendingBalance: 0,
        heldBalance: 0,
      },
    });

    // Create wallet transaction record
    await prisma.walletTransaction.create({
      data: {
        id: txnId,
        walletId,
        type: "CREDIT",
        amount,
        currency,
        balanceAfter: Number(updatedBalance.availableBalance),
        description,
        reference,
        status: "COMPLETED",
      },
    });

    // Invalidate cache
    await this.invalidateCache(walletId);

    return {
      newBalance: Number(updatedBalance.availableBalance),
      transactionId: txnId,
    };
  }

  /**
   * Debit wallet (remove funds)
   */
  async debit(params: {
    walletId: string;
    amount: number;
    currency: Currency;
    description: string;
    reference?: string;
    transactionId?: string;
  }): Promise<{ newBalance: number; transactionId: string }> {
    const {
      walletId,
      amount,
      currency,
      description,
      reference,
      transactionId,
    } = params;

    if (amount <= 0) {
      throw new Error("Amount must be positive");
    }

    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      include: {
        balances: {
          where: { currency },
        },
      },
    });

    if (!wallet || wallet.status !== "ACTIVE") {
      throw new Error("Wallet is not active");
    }

    const balance = wallet.balances[0];
    if (!balance || Number(balance.availableBalance) < amount) {
      throw new Error("Insufficient balance");
    }

    const txnId = transactionId || `txn_${nanoid(16)}`;

    // Update balance atomically
    const updatedBalance = await prisma.walletBalance.update({
      where: {
        walletId_currency: { walletId, currency },
      },
      data: {
        availableBalance: { decrement: amount },
        lastActivityAt: new Date(),
      },
    });

    // Create wallet transaction record
    await prisma.walletTransaction.create({
      data: {
        id: txnId,
        walletId,
        type: "DEBIT",
        amount,
        currency,
        balanceAfter: Number(updatedBalance.availableBalance),
        description,
        reference,
        status: "COMPLETED",
      },
    });

    // Update daily/monthly limits
    await this.updateLimitUsage(walletId, amount);

    // Invalidate cache
    await this.invalidateCache(walletId);

    return {
      newBalance: Number(updatedBalance.availableBalance),
      transactionId: txnId,
    };
  }

  /**
   * Hold funds (pre-authorization)
   */
  async hold(params: {
    walletId: string;
    amount: number;
    currency: Currency;
    reason: string;
    reference?: string;
    expiresInMinutes?: number;
  }): Promise<{ holdId: string; expiresAt: Date }> {
    const {
      walletId,
      amount,
      currency,
      reason,
      reference,
      expiresInMinutes = 60,
    } = params;

    if (amount <= 0) {
      throw new Error("Amount must be positive");
    }

    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      include: {
        balances: {
          where: { currency },
        },
      },
    });

    if (!wallet || wallet.status !== "ACTIVE") {
      throw new Error("Wallet is not active");
    }

    const balance = wallet.balances[0];
    if (!balance || Number(balance.availableBalance) < amount) {
      throw new Error("Insufficient balance for hold");
    }

    const holdId = `hold_${nanoid(16)}`;
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    // Move from available to held atomically
    await prisma.$transaction([
      prisma.walletBalance.update({
        where: {
          walletId_currency: { walletId, currency },
        },
        data: {
          availableBalance: { decrement: amount },
          heldBalance: { increment: amount },
        },
      }),
      prisma.balanceHold.create({
        data: {
          id: holdId,
          accountId: balance.id,
          amount,
          currency,
          reason,
          reference,
          expiresAt,
        },
      }),
    ]);

    // Invalidate cache
    await this.invalidateCache(walletId);

    return { holdId, expiresAt };
  }

  /**
   * Release held funds
   */
  async releaseHold(holdId: string): Promise<void> {
    const hold = await prisma.balanceHold.findUnique({
      where: { id: holdId },
      include: {
        account: true,
      },
    });

    if (!hold || hold.isReleased) {
      throw new Error("Hold not found or already released");
    }

    await prisma.$transaction([
      prisma.walletBalance.update({
        where: { id: hold.accountId },
        data: {
          availableBalance: { increment: Number(hold.amount) },
          heldBalance: { decrement: Number(hold.amount) },
        },
      }),
      prisma.balanceHold.update({
        where: { id: holdId },
        data: {
          isReleased: true,
          releasedAt: new Date(),
        },
      }),
    ]);

    // Invalidate cache
    const balance = await prisma.walletBalance.findUnique({
      where: { id: hold.accountId },
    });
    if (balance) {
      await this.invalidateCache(balance.walletId);
    }
  }

  /**
   * Capture held funds (convert hold to actual debit)
   */
  async captureHold(
    holdId: string,
    amount?: number
  ): Promise<{ captured: number }> {
    const hold = await prisma.balanceHold.findUnique({
      where: { id: holdId },
      include: {
        account: true,
      },
    });

    if (!hold || hold.isReleased) {
      throw new Error("Hold not found or already released");
    }

    const captureAmount = amount ?? Number(hold.amount);
    if (captureAmount > Number(hold.amount)) {
      throw new Error("Capture amount exceeds hold amount");
    }

    const releaseAmount = Number(hold.amount) - captureAmount;

    await prisma.$transaction([
      // Reduce held balance by full hold amount
      prisma.walletBalance.update({
        where: { id: hold.accountId },
        data: {
          heldBalance: { decrement: Number(hold.amount) },
          // Release any excess back to available
          availableBalance: { increment: releaseAmount },
        },
      }),
      // Mark hold as released
      prisma.balanceHold.update({
        where: { id: holdId },
        data: {
          isReleased: true,
          releasedAt: new Date(),
        },
      }),
    ]);

    // Invalidate cache
    const balance = await prisma.walletBalance.findUnique({
      where: { id: hold.accountId },
    });
    if (balance) {
      await this.invalidateCache(balance.walletId);
    }

    return { captured: captureAmount };
  }

  /**
   * Check transaction limits
   */
  async checkLimit(
    walletId: string,
    amount: number,
    type: "p2p" | "bills" | "cards" | "international"
  ): Promise<LimitCheckResult> {
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet) {
      return { allowed: false, reason: "Wallet not found" };
    }

    if (wallet.status !== "ACTIVE") {
      return {
        allowed: false,
        reason: `Wallet is ${wallet.status.toLowerCase()}`,
      };
    }

    const tier = wallet.tier as WalletTier;
    const limits = TIER_LIMITS[tier];

    // Check feature availability
    const featureKey = `${type}Enabled` as keyof WalletTierLimits;
    if (!limits[featureKey]) {
      return {
        allowed: false,
        reason: `${type} not available for ${tier} tier`,
        requiredTier: this.getRequiredTierForFeature(type),
      };
    }

    // Check single transaction limit
    if (amount > limits.singleTransactionLimit) {
      return {
        allowed: false,
        reason: "Amount exceeds single transaction limit",
        limit: limits.singleTransactionLimit,
      };
    }

    // Check daily limit
    const dailyRemaining =
      limits.dailyTransactionLimit - Number(wallet.dailyLimitUsed);
    if (amount > dailyRemaining) {
      return {
        allowed: false,
        reason: "Daily transaction limit exceeded",
        limit: limits.dailyTransactionLimit,
        used: Number(wallet.dailyLimitUsed),
        remaining: dailyRemaining,
      };
    }

    // Check monthly limit
    const monthlyRemaining =
      limits.monthlyTransactionLimit - Number(wallet.monthlyLimitUsed);
    if (amount > monthlyRemaining) {
      return {
        allowed: false,
        reason: "Monthly transaction limit exceeded",
        limit: limits.monthlyTransactionLimit,
        used: Number(wallet.monthlyLimitUsed),
        remaining: monthlyRemaining,
      };
    }

    return { allowed: true };
  }

  /**
   * Upgrade wallet tier
   */
  async upgradeTier(walletId: string, newTier: WalletTier): Promise<void> {
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet) {
      throw new Error("Wallet not found");
    }

    const requiredKyc = TIER_LIMITS[newTier].requiredKycLevel;
    const currentKyc = wallet.kycLevel as KYCLevel;

    // Check KYC requirement
    const kycOrder: KYCLevel[] = [
      "NONE",
      "BASIC",
      "STANDARD",
      "ENHANCED",
      "FULL",
    ];
    if (kycOrder.indexOf(currentKyc) < kycOrder.indexOf(requiredKyc)) {
      throw new Error(`KYC level ${requiredKyc} required for ${newTier} tier`);
    }

    await prisma.wallet.update({
      where: { id: walletId },
      data: { tier: newTier },
    });

    await this.invalidateCache(walletId);
  }

  /**
   * Freeze wallet
   */
  async freezeWallet(walletId: string, reason: string): Promise<void> {
    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        status: "FROZEN",
        metadata: {
          frozenAt: new Date().toISOString(),
          frozenReason: reason,
        },
      },
    });

    await this.invalidateCache(walletId);
  }

  /**
   * Unfreeze wallet
   */
  async unfreezeWallet(walletId: string): Promise<void> {
    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        status: "ACTIVE",
        metadata: {
          unfrozenAt: new Date().toISOString(),
        },
      },
    });

    await this.invalidateCache(walletId);
  }

  /**
   * Set transaction PIN
   */
  async setPin(walletId: string, pin: string): Promise<void> {
    // In production, hash the PIN with bcrypt
    const hashedPin = await this.hashPin(pin);

    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        pin: hashedPin,
        pinAttempts: 0,
        pinLockedUntil: null,
      },
    });
  }

  /**
   * Verify transaction PIN
   */
  async verifyPin(walletId: string, pin: string): Promise<boolean> {
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet || !wallet.pin) {
      throw new Error("PIN not set");
    }

    // Check if PIN is locked
    if (wallet.pinLockedUntil && wallet.pinLockedUntil > new Date()) {
      throw new Error("PIN is temporarily locked. Try again later.");
    }

    const isValid = await this.comparePin(pin, wallet.pin);

    if (!isValid) {
      // Increment failed attempts
      const newAttempts = wallet.pinAttempts + 1;
      const lockUntil =
        newAttempts >= 5
          ? new Date(Date.now() + 30 * 60 * 1000) // Lock for 30 minutes after 5 attempts
          : null;

      await prisma.wallet.update({
        where: { id: walletId },
        data: {
          pinAttempts: newAttempts,
          pinLockedUntil: lockUntil,
        },
      });

      if (lockUntil) {
        throw new Error("Too many failed attempts. PIN locked for 30 minutes.");
      }

      return false;
    }

    // Reset attempts on success
    if (wallet.pinAttempts > 0) {
      await prisma.wallet.update({
        where: { id: walletId },
        data: { pinAttempts: 0 },
      });
    }

    return true;
  }

  /**
   * Get transaction history
   */
  async getTransactionHistory(
    walletId: string,
    options: {
      currency?: Currency;
      type?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ transactions: WalletTransaction[]; total: number }> {
    const {
      currency,
      type,
      startDate,
      endDate,
      limit = 20,
      offset = 0,
    } = options;

    const where: Record<string, unknown> = { walletId };

    if (currency) where.currency = currency;
    if (type) where.type = type;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) (where.createdAt as Record<string, Date>).gte = startDate;
      if (endDate) (where.createdAt as Record<string, Date>).lte = endDate;
    }

    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.walletTransaction.count({ where }),
    ]);

    return {
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        currency: t.currency,
        balanceAfter: Number(t.balanceAfter),
        description: t.description,
        reference: t.reference,
        status: t.status,
        createdAt: t.createdAt,
      })),
      total,
    };
  }

  // ===========================================
  // PRIVATE HELPERS
  // ===========================================

  private formatWalletInfo(wallet: {
    id: string;
    userId: string;
    status: string;
    tier: string;
    kycLevel: string;
    dailyLimitUsed: unknown;
    monthlyLimitUsed: unknown;
    balances: Array<{
      currency: Currency;
      availableBalance: unknown;
      pendingBalance: unknown;
      heldBalance: unknown;
    }>;
  }): WalletInfo {
    const tier = wallet.tier as WalletTier;
    const limits = TIER_LIMITS[tier];

    const balances: WalletBalance[] = wallet.balances.map((b) => ({
      currency: b.currency,
      available: Number(b.availableBalance),
      pending: Number(b.pendingBalance),
      held: Number(b.heldBalance),
      total:
        Number(b.availableBalance) +
        Number(b.pendingBalance) +
        Number(b.heldBalance),
    }));

    const features: WalletFeatures = {
      p2p: limits.p2pEnabled,
      bills: limits.billsEnabled,
      cards: limits.cardsEnabled,
      loans: limits.loansEnabled,
      international: limits.internationalEnabled,
      savings: true,
    };

    return {
      id: wallet.id,
      userId: wallet.userId,
      status: wallet.status as WalletStatus,
      tier,
      kycLevel: wallet.kycLevel as KYCLevel,
      balances,
      dailyLimitUsed: Number(wallet.dailyLimitUsed),
      dailyLimitRemaining:
        limits.dailyTransactionLimit - Number(wallet.dailyLimitUsed),
      monthlyLimitUsed: Number(wallet.monthlyLimitUsed),
      monthlyLimitRemaining:
        limits.monthlyTransactionLimit - Number(wallet.monthlyLimitUsed),
      features,
    };
  }

  private async updateLimitUsage(
    walletId: string,
    amount: number
  ): Promise<void> {
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet) return;

    const now = new Date();
    const updates: Record<string, unknown> = {};

    // Check if daily limit needs reset
    if (wallet.dailyLimitResetAt < now) {
      updates.dailyLimitUsed = amount;
      updates.dailyLimitResetAt = new Date(now.setHours(24, 0, 0, 0));
    } else {
      updates.dailyLimitUsed = { increment: amount };
    }

    // Check if monthly limit needs reset
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    if (wallet.monthlyLimitResetAt < monthStart) {
      updates.monthlyLimitUsed = amount;
      updates.monthlyLimitResetAt = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        1
      );
    } else {
      updates.monthlyLimitUsed = { increment: amount };
    }

    await prisma.wallet.update({
      where: { id: walletId },
      data: updates,
    });
  }

  private getRequiredTierForFeature(feature: string): WalletTier {
    const featureKey = `${feature}Enabled` as keyof WalletTierLimits;

    for (const tier of [
      "BASIC",
      "VERIFIED",
      "PREMIUM",
      "BUSINESS",
    ] as WalletTier[]) {
      if (TIER_LIMITS[tier][featureKey]) {
        return tier;
      }
    }

    return "BUSINESS";
  }

  private async invalidateCache(walletId: string): Promise<void> {
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: { userId: true },
    });

    if (wallet) {
      await redis.del(`wallet:${wallet.userId}`);
    }
  }

  private async hashPin(pin: string): Promise<string> {
    // In production, use bcrypt
    const crypto = await import("crypto");
    return crypto.createHash("sha256").update(pin).digest("hex");
  }

  private async comparePin(pin: string, hash: string): Promise<boolean> {
    const crypto = await import("crypto");
    const inputHash = crypto.createHash("sha256").update(pin).digest("hex");
    return inputHash === hash;
  }
}

// ===========================================
// TYPES
// ===========================================

interface WalletTransaction {
  id: string;
  type: string;
  amount: number;
  currency: string;
  balanceAfter: number;
  description: string | null;
  reference: string | null;
  status: string;
  createdAt: Date;
}

// Export singleton instance
export const enhancedWalletService = new EnhancedWalletService();
