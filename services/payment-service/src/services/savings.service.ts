/**
 * Savings Pockets Service
 * Goal-based savings with interest, auto-save, and round-ups
 */

import type { Currency } from "@prisma/client";
import { nanoid } from "nanoid";
import { prisma } from "../lib/prisma";
import type {
  AutoSaveConfig,
  AutoSaveFrequency,
  CreatePocketParams,
  RoundUpConfig,
  SavingsPocket,
  SavingsPocketStatus,
  SavingsTransaction,
  WalletTier,
} from "../types/fintech.types";
import { enhancedWalletService } from "./enhanced-wallet.service";

// ===========================================
// CONSTANTS
// ===========================================

// Interest rates by wallet tier (annual percentage)
const TIER_INTEREST_RATES: Record<WalletTier, number> = {
  BASIC: 0.02, // 2%
  VERIFIED: 0.04, // 4%
  PREMIUM: 0.06, // 6%
  BUSINESS: 0.05, // 5%
};

// Max pockets by wallet tier
const MAX_POCKETS: Record<WalletTier, number> = {
  BASIC: 3,
  VERIFIED: 5,
  PREMIUM: 10,
  BUSINESS: 20,
};

const MIN_DEPOSIT = 100; // Minimum deposit amount
const MIN_AUTO_SAVE_AMOUNT = 50;

// ===========================================
// SAVINGS SERVICE
// ===========================================

export class SavingsService {
  /**
   * Create a new savings pocket
   */
  async createPocket(params: CreatePocketParams): Promise<SavingsPocket> {
    const {
      walletId,
      name,
      targetAmount,
      targetDate,
      currency,
      color,
      autoSave,
      roundUp,
    } = params;
    const emoji = (params as any).emoji;

    // Get wallet info for tier-based limits
    const wallet = await enhancedWalletService.getWalletById(walletId);
    if (!wallet) {
      throw new Error("Wallet not found");
    }

    // Check pocket limit
    const existingCount = await prisma.savingsPocket.count({
      where: { walletId, status: { not: "CLOSED" } },
    });

    const maxPockets = MAX_POCKETS[wallet.tier];
    if (existingCount >= maxPockets) {
      throw new Error(
        `Maximum ${maxPockets} savings pockets allowed for ${wallet.tier} tier`
      );
    }

    const pocketId = `pocket_${nanoid(12)}`;
    const interestRate = TIER_INTEREST_RATES[wallet.tier];

    // Create pocket
    const pocket = await prisma.savingsPocket.create({
      data: {
        id: pocketId,
        walletId,
        name,
        emoji: emoji || "🎯",
        color: color || "#4F46E5",
        targetAmount,
        targetDate,
        currency,
        currentBalance: 0,
        interestRate,
        interestEarned: 0,
        status: "ACTIVE",
        // Auto-save config
        autoSaveEnabled: autoSave?.enabled || false,
        autoSaveAmount: autoSave?.amount,
        autoSaveFrequency: autoSave?.frequency,
        autoSaveNextDate: autoSave?.enabled
          ? this.calculateNextAutoSaveDate(autoSave.frequency || "MONTHLY")
          : null,
        // Round-up config
        roundUpEnabled: roundUp?.enabled || false,
        roundUpMultiplier: roundUp?.multiplier || 1,
        roundUpSourceCategories: (roundUp as any)?.sourceCategories,
      },
    });

    return this.formatPocket(pocket);
  }

  /**
   * Get all pockets for a wallet
   */
  async getPockets(walletId: string): Promise<SavingsPocket[]> {
    const pockets = await prisma.savingsPocket.findMany({
      where: { walletId, status: { not: "CLOSED" } },
      orderBy: { createdAt: "desc" },
    });

    return pockets.map((p: any) => this.formatPocket(p));
  }

  /**
   * Get pocket by ID
   */
  async getPocket(pocketId: string): Promise<SavingsPocket | null> {
    const pocket = await prisma.savingsPocket.findUnique({
      where: { id: pocketId },
    });

    if (!pocket) {
      return null;
    }

    return this.formatPocket(pocket);
  }

  /**
   * Deposit into savings pocket
   */
  async deposit(params: {
    pocketId: string;
    walletId: string;
    amount: number;
    pin: string;
    source?: string;
  }): Promise<{ newBalance: number; transactionId: string }> {
    const { pocketId, walletId, amount, pin, source = "MANUAL" } = params;

    if (amount < MIN_DEPOSIT) {
      throw new Error(`Minimum deposit is ${MIN_DEPOSIT}`);
    }

    // Verify PIN
    const pinValid = await enhancedWalletService.verifyPin(walletId, pin);
    if (!pinValid) {
      throw new Error("Invalid PIN");
    }

    const pocket = await prisma.savingsPocket.findUnique({
      where: { id: pocketId },
    });

    if (!pocket || pocket.walletId !== walletId) {
      throw new Error("Savings pocket not found");
    }

    if (pocket.status !== "ACTIVE") {
      throw new Error(
        `Cannot deposit to ${pocket.status.toLowerCase()} pocket`
      );
    }

    // Check wallet balance
    const balance = await enhancedWalletService.getBalance(
      walletId,
      pocket.currency
    );
    if (balance.available < amount) {
      throw new Error("Insufficient balance");
    }

    const transactionId = `sav_${nanoid(16)}`;

    // Execute deposit in transaction
    await prisma.$transaction(async (tx) => {
      // Debit wallet
      await enhancedWalletService.debit({
        walletId,
        amount,
        currency: pocket.currency,
        description: `Savings deposit - ${pocket.name}`,
        reference: transactionId,
      });

      // Credit pocket
      await tx.savingsPocket.update({
        where: { id: pocketId },
        data: {
          currentBalance: { increment: amount },
          totalDeposits: { increment: amount },
          lastActivityAt: new Date(),
        },
      });

      // Create transaction record
      await tx.savingsTransaction.create({
        data: {
          id: transactionId,
          pocketId,
          type: "DEPOSIT",
          amount,
          balanceAfter: Number(pocket.currentBalance) + amount,
          source,
        },
      });
    });

    const newBalance = Number(pocket.currentBalance) + amount;

    // Check if target reached
    if (pocket.targetAmount && newBalance >= Number(pocket.targetAmount)) {
      await this.notifyTargetReached(pocketId);
    }

    return {
      newBalance,
      transactionId,
    };
  }

  /**
   * Withdraw from savings pocket
   */
  async withdraw(params: {
    pocketId: string;
    walletId: string;
    amount: number;
    pin: string;
    withdrawAll?: boolean;
  }): Promise<{ newBalance: number; transactionId: string }> {
    const {
      pocketId,
      walletId,
      amount: requestedAmount,
      pin,
      withdrawAll = false,
    } = params;

    // Verify PIN
    const pinValid = await enhancedWalletService.verifyPin(walletId, pin);
    if (!pinValid) {
      throw new Error("Invalid PIN");
    }

    const pocket = await prisma.savingsPocket.findUnique({
      where: { id: pocketId },
    });

    if (!pocket || pocket.walletId !== walletId) {
      throw new Error("Savings pocket not found");
    }

    if (pocket.status === "LOCKED") {
      throw new Error("Pocket is locked and cannot be withdrawn from");
    }

    const currentBalance = Number(pocket.currentBalance);
    const amount = withdrawAll ? currentBalance : requestedAmount;

    if (amount > currentBalance) {
      throw new Error("Insufficient savings balance");
    }

    const transactionId = `sav_${nanoid(16)}`;

    await prisma.$transaction(async (tx) => {
      // Debit pocket
      await tx.savingsPocket.update({
        where: { id: pocketId },
        data: {
          currentBalance: { decrement: amount },
          totalWithdrawals: { increment: amount },
          lastActivityAt: new Date(),
        },
      });

      // Credit wallet
      await enhancedWalletService.credit({
        walletId,
        amount,
        currency: pocket.currency,
        description: `Savings withdrawal - ${pocket.name}`,
        reference: transactionId,
      });

      // Create transaction record
      await tx.savingsTransaction.create({
        data: {
          id: transactionId,
          pocketId,
          type: "WITHDRAWAL",
          amount,
          balanceAfter: currentBalance - amount,
          source: "MANUAL",
        },
      });
    });

    return {
      newBalance: currentBalance - amount,
      transactionId,
    };
  }

  /**
   * Update pocket settings
   */
  async updatePocket(
    pocketId: string,
    walletId: string,
    updates: {
      name?: string;
      targetAmount?: number;
      targetDate?: Date;
      emoji?: string;
      color?: string;
    }
  ): Promise<SavingsPocket> {
    const pocket = await prisma.savingsPocket.findUnique({
      where: { id: pocketId },
    });

    if (!pocket || pocket.walletId !== walletId) {
      throw new Error("Savings pocket not found");
    }

    const updated = await prisma.savingsPocket.update({
      where: { id: pocketId },
      data: updates,
    });

    return this.formatPocket(updated);
  }

  /**
   * Configure auto-save
   */
  async configureAutoSave(
    pocketId: string,
    walletId: string,
    config: AutoSaveConfig
  ): Promise<SavingsPocket> {
    const pocket = await prisma.savingsPocket.findUnique({
      where: { id: pocketId },
    });

    if (!pocket || pocket.walletId !== walletId) {
      throw new Error("Savings pocket not found");
    }

    if (
      config.enabled &&
      config.amount &&
      config.amount < MIN_AUTO_SAVE_AMOUNT
    ) {
      throw new Error(`Minimum auto-save amount is ${MIN_AUTO_SAVE_AMOUNT}`);
    }

    const nextDate =
      config.enabled && config.frequency
        ? this.calculateNextAutoSaveDate(config.frequency)
        : null;

    const updated = await prisma.savingsPocket.update({
      where: { id: pocketId },
      data: {
        autoSaveEnabled: config.enabled,
        autoSaveAmount: config.amount,
        autoSaveFrequency: config.frequency,
        autoSaveNextDate: nextDate,
      },
    });

    return this.formatPocket(updated);
  }

  /**
   * Configure round-up savings
   */
  async configureRoundUp(
    pocketId: string,
    walletId: string,
    config: RoundUpConfig
  ): Promise<SavingsPocket> {
    const pocket = await prisma.savingsPocket.findUnique({
      where: { id: pocketId },
    });

    if (!pocket || pocket.walletId !== walletId) {
      throw new Error("Savings pocket not found");
    }

    const updated = await prisma.savingsPocket.update({
      where: { id: pocketId },
      data: {
        roundUpEnabled: config.enabled,
        roundUpMultiplier: config.multiplier || 1,
        roundUpSourceCategories: (config as any).sourceCategories,
      },
    });

    return this.formatPocket(updated);
  }

  /**
   * Lock pocket (prevent withdrawals)
   */
  async lockPocket(
    pocketId: string,
    walletId: string,
    unlockDate?: Date
  ): Promise<void> {
    const pocket = await prisma.savingsPocket.findUnique({
      where: { id: pocketId },
    });

    if (!pocket || pocket.walletId !== walletId) {
      throw new Error("Savings pocket not found");
    }

    await prisma.savingsPocket.update({
      where: { id: pocketId },
      data: {
        status: "LOCKED",
        lockedUntil: unlockDate,
      },
    });
  }

  /**
   * Close pocket and withdraw all funds
   */
  async closePocket(
    pocketId: string,
    walletId: string,
    pin: string
  ): Promise<{ withdrawnAmount: number }> {
    const pocket = await prisma.savingsPocket.findUnique({
      where: { id: pocketId },
    });

    if (!pocket || pocket.walletId !== walletId) {
      throw new Error("Savings pocket not found");
    }

    if (
      pocket.status === "LOCKED" &&
      pocket.lockedUntil &&
      pocket.lockedUntil > new Date()
    ) {
      throw new Error(
        `Pocket is locked until ${pocket.lockedUntil.toLocaleDateString()}`
      );
    }

    const currentBalance = Number(pocket.currentBalance);
    const interestEarned = Number(pocket.interestEarned);
    const totalAmount = currentBalance + interestEarned;

    if (totalAmount > 0) {
      // Withdraw everything
      await this.withdraw({
        pocketId,
        walletId,
        amount: totalAmount,
        pin,
        withdrawAll: true,
      });
    }

    // Mark pocket as closed
    await prisma.savingsPocket.update({
      where: { id: pocketId },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
      },
    });

    return { withdrawnAmount: totalAmount };
  }

  /**
   * Get savings transaction history
   */
  async getTransactionHistory(
    pocketId: string,
    options: {
      type?: "DEPOSIT" | "WITHDRAWAL" | "INTEREST";
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ transactions: SavingsTransaction[]; total: number }> {
    const { type, limit = 20, offset = 0 } = options;

    const where: Record<string, unknown> = { pocketId };
    if (type) where.type = type;

    const [transactions, total] = await Promise.all([
      prisma.savingsTransaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.savingsTransaction.count({ where }),
    ]);

    return {
      transactions: transactions.map((t: any) => ({
        id: t.id,
        pocketId: t.pocketId,
        type: t.type as "DEPOSIT" | "WITHDRAWAL" | "INTEREST",
        amount: Number(t.amount),
        balanceAfter: Number(t.balanceAfter),
        source: t.source || undefined,
        createdAt: t.createdAt,
      })),
      total,
    };
  }

  /**
   * Get interest summary
   */
  async getInterestSummary(walletId: string): Promise<any> {
    const pockets = await prisma.savingsPocket.findMany({
      where: { walletId, status: { not: "CLOSED" } },
    });

    let totalEarned = 0;
    let pendingInterest = 0;
    const byPocket: Array<{
      pocketId: string;
      pocketName: string;
      rate: number;
      earned: number;
      pending: number;
    }> = [];

    for (const pocket of pockets) {
      const earned = Number(pocket.interestEarned);
      const pending = this.calculatePendingInterest(pocket);

      totalEarned += earned;
      pendingInterest += pending;

      byPocket.push({
        pocketId: pocket.id,
        pocketName: pocket.name,
        rate: Number(pocket.interestRate),
        earned,
        pending,
      });
    }

    return {
      totalEarned,
      pendingInterest,
      byPocket,
    };
  }

  // ===========================================
  // SCHEDULED JOBS
  // ===========================================

  /**
   * Process auto-save for all eligible pockets
   */
  async processAutoSaves(): Promise<{ processed: number; failed: number }> {
    const now = new Date();

    const duePockets = await prisma.savingsPocket.findMany({
      where: {
        status: "ACTIVE",
        autoSaveEnabled: true,
        autoSaveNextDate: { lte: now },
        autoSaveAmount: { gt: 0 },
      },
      include: { wallet: true },
    });

    let processed = 0;
    let failed = 0;

    for (const pocket of duePockets) {
      try {
        // Check wallet balance
        const balance = await enhancedWalletService.getBalance(
          pocket.walletId,
          pocket.currency
        );

        const amount = Number(pocket.autoSaveAmount);

        if (balance.available >= amount) {
          // Execute auto-save deposit (bypass PIN for automated savings)
          await this.executeAutoSaveDeposit(
            pocket.id,
            pocket.walletId,
            amount,
            pocket.currency
          );

          // Calculate next auto-save date
          const nextDate = this.calculateNextAutoSaveDate(
            pocket.autoSaveFrequency as AutoSaveFrequency
          );

          await prisma.savingsPocket.update({
            where: { id: pocket.id },
            data: {
              autoSaveNextDate: nextDate,
              autoSaveFailedAttempts: 0,
            },
          });

          processed++;
        } else {
          // Insufficient balance
          await prisma.savingsPocket.update({
            where: { id: pocket.id },
            data: {
              autoSaveFailedAttempts: { increment: 1 },
            },
          });
          failed++;
        }
      } catch (error) {
        console.error(`Auto-save failed for pocket ${pocket.id}:`, error);
        failed++;
      }
    }

    return { processed, failed };
  }

  /**
   * Process round-up for a transaction
   */
  async processRoundUp(
    walletId: string,
    transactionAmount: number,
    category: string
  ): Promise<void> {
    // Find pockets with round-up enabled
    const pockets = await prisma.savingsPocket.findMany({
      where: {
        walletId,
        status: "ACTIVE",
        roundUpEnabled: true,
      },
    });

    for (const pocket of pockets) {
      // Check if category matches
      const categories = pocket.roundUpSourceCategories as string[] | null;
      if (
        categories &&
        categories.length > 0 &&
        !categories.includes(category)
      ) {
        continue;
      }

      // Calculate round-up amount
      const roundUpBase =
        Math.ceil(transactionAmount / 100) * 100 - transactionAmount;
      const multiplier = pocket.roundUpMultiplier || 1;
      const roundUpAmount = roundUpBase * multiplier;

      if (roundUpAmount > 0) {
        try {
          await this.executeAutoSaveDeposit(
            pocket.id,
            walletId,
            roundUpAmount,
            pocket.currency,
            "ROUND_UP"
          );
        } catch (error) {
          console.error(`Round-up failed for pocket ${pocket.id}:`, error);
        }
      }
    }
  }

  /**
   * Calculate and credit daily interest
   */
  async processInterestAccrual(): Promise<{
    processed: number;
    totalInterest: number;
  }> {
    const pockets = await prisma.savingsPocket.findMany({
      where: {
        status: { in: ["ACTIVE", "LOCKED"] },
        currentBalance: { gt: 0 },
      },
    });

    let processed = 0;
    let totalInterest = 0;

    for (const pocket of pockets) {
      const dailyRate = Number(pocket.interestRate) / 365;
      const interest = Number(pocket.currentBalance) * dailyRate;

      if (interest > 0.01) {
        // Only process if interest > 0.01
        await prisma.$transaction(async (tx) => {
          // Credit interest
          await tx.savingsPocket.update({
            where: { id: pocket.id },
            data: {
              interestEarned: { increment: interest },
              currentBalance: { increment: interest },
            },
          });

          // Record interest accrual
          await tx.interestAccrual.create({
            data: {
              pocketId: pocket.id,
              principalAmount: Number(pocket.currentBalance),
              rate: Number(pocket.interestRate),
              interestAmount: interest,
              accrualDate: new Date(),
            },
          });

          // Create transaction record
          await tx.savingsTransaction.create({
            data: {
              id: `int_${nanoid(16)}`,
              pocketId: pocket.id,
              type: "INTEREST",
              amount: interest,
              balanceAfter: Number(pocket.currentBalance) + interest,
              source: "ACCRUAL",
            },
          });
        });

        processed++;
        totalInterest += interest;
      }
    }

    return { processed, totalInterest };
  }

  // ===========================================
  // PRIVATE HELPERS
  // ===========================================

  private formatPocket(pocket: {
    id: string;
    walletId: string;
    name: string;
    emoji: string | null;
    color: string | null;
    targetAmount: unknown;
    targetDate: Date | null;
    currency: string;
    currentBalance: unknown;
    interestRate: unknown;
    interestEarned: unknown;
    status: string;
    autoSaveEnabled: boolean;
    autoSaveAmount: unknown;
    autoSaveFrequency: string | null;
    autoSaveNextDate: Date | null;
    roundUpEnabled: boolean;
    roundUpMultiplier: number | null;
    createdAt: Date;
  }): any {
    const progress = pocket.targetAmount
      ? (Number(pocket.currentBalance) / Number(pocket.targetAmount)) * 100
      : undefined;

    return {
      id: pocket.id,
      walletId: pocket.walletId,
      name: pocket.name,
      emoji: pocket.emoji || "🎯",
      color: pocket.color || "#4F46E5",
      targetAmount: pocket.targetAmount
        ? Number(pocket.targetAmount)
        : undefined,
      targetDate: pocket.targetDate || undefined,
      currency: pocket.currency as Currency,
      currentBalance: Number(pocket.currentBalance),
      interestRate: Number(pocket.interestRate),
      interestEarned: Number(pocket.interestEarned),
      status: pocket.status as SavingsPocketStatus,
      progress: progress !== undefined ? Math.min(progress, 100) : 0,
      autoSave: pocket.autoSaveEnabled && pocket.autoSaveAmount && pocket.autoSaveFrequency
        ? ({
            enabled: true as const,
            amount: Number(pocket.autoSaveAmount),
            frequency: pocket.autoSaveFrequency as AutoSaveFrequency,
            nextDate: pocket.autoSaveNextDate || undefined,
          } as AutoSaveConfig)
        : ({ enabled: false as const } as AutoSaveConfig),
      roundUp: {
        enabled: pocket.roundUpEnabled,
        multiplier: pocket.roundUpMultiplier || 1,
      },
      createdAt: pocket.createdAt,
    };
  }

  private calculateNextAutoSaveDate(frequency: AutoSaveFrequency): Date {
    const now = new Date();

    switch (frequency) {
      case "DAILY":
        now.setDate(now.getDate() + 1);
        break;
      case "WEEKLY":
        now.setDate(now.getDate() + 7);
        break;
      case "BIWEEKLY":
        now.setDate(now.getDate() + 14);
        break;
      case "MONTHLY":
        now.setMonth(now.getMonth() + 1);
        break;
    }

    return now;
  }

  private calculatePendingInterest(pocket: {
    currentBalance: unknown;
    interestRate: unknown;
    lastActivityAt: Date | null;
  }): number {
    if (!pocket.lastActivityAt) return 0;

    const daysSinceActivity = Math.floor(
      (Date.now() - pocket.lastActivityAt.getTime()) / (24 * 60 * 60 * 1000)
    );

    const dailyRate = Number(pocket.interestRate) / 365;
    return Number(pocket.currentBalance) * dailyRate * daysSinceActivity;
  }

  private async executeAutoSaveDeposit(
    pocketId: string,
    walletId: string,
    amount: number,
    currency: Currency,
    source: string = "AUTO_SAVE"
  ): Promise<void> {
    const transactionId = `sav_${nanoid(16)}`;

    await prisma.$transaction(async (tx) => {
      // Debit wallet (no PIN for automated)
      await enhancedWalletService.debit({
        walletId,
        amount,
        currency,
        description: `Auto-save deposit`,
        reference: transactionId,
      });

      // Credit pocket
      const pocket = await tx.savingsPocket.update({
        where: { id: pocketId },
        data: {
          currentBalance: { increment: amount },
          totalDeposits: { increment: amount },
          lastActivityAt: new Date(),
        },
      });

      // Create transaction record
      await tx.savingsTransaction.create({
        data: {
          id: transactionId,
          pocketId,
          type: "DEPOSIT",
          amount,
          balanceAfter: Number(pocket.currentBalance),
          source,
        },
      });
    });
  }

  private async notifyTargetReached(pocketId: string): Promise<void> {
    // TODO: Integrate with notification service
    console.log(`[Savings] Target reached for pocket ${pocketId}`);
  }
}

// Export singleton instance
export const savingsService = new SavingsService();
