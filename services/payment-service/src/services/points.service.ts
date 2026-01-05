/**
 * Points Service
 * Core points earning, redemption, and expiry management
 */

import { nanoid } from "nanoid";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import type {
  EarnPointsParams,
  LoyaltyTier,
  PointsAccount,
  PointsBalance,
  PointsSource,
  PointsTransaction,
  PointsTransactionType,
  RedeemPointsParams,
} from "../types/loyalty.types";

// ===========================================
// CONSTANTS
// ===========================================

const POINTS_CONFIG = {
  earning: {
    RIDE: 10,
    FOOD_ORDER: 15,
    DELIVERY: 10,
    WALLET_TOPUP: 2,
    BILL_PAYMENT: 5,
    REFERRAL: 0,
    ACHIEVEMENT: 0,
    STREAK: 0,
    CHALLENGE: 0,
    PROMOTION: 0,
    SIGNUP_BONUS: 0,
    TIER_BONUS: 0,
    SUBSCRIPTION: 0,
    MANUAL: 0,
  } as Record<PointsSource, number>,
  tierMultipliers: {
    GREEN: 1.0,
    SILVER: 1.25,
    GOLD: 1.5,
    PLATINUM: 2.0,
  } as Record<LoyaltyTier, number>,
  redemption: {
    rides: 100,
    food: 100,
    cash: 150,
    partner: 80,
    catalog: 100,
  },
  expiryMonths: 12,
};

// ===========================================
// POINTS SERVICE
// ===========================================

export class PointsService {
  /**
   * Get or create points account for user
   */
  async getOrCreateAccount(userId: string): Promise<PointsAccount> {
    let account = await prisma.pointsAccount.findUnique({
      where: { userId },
    });

    if (!account) {
      account = await prisma.pointsAccount.create({
        data: {
          id: `pts_${nanoid(16)}`,
          userId,
          availablePoints: BigInt(0),
          pendingPoints: BigInt(0),
          lifetimeEarned: BigInt(0),
          lifetimeRedeemed: BigInt(0),
          lifetimeExpired: BigInt(0),
          tier: "GREEN",
          tierPoints: BigInt(0),
        },
      });
    }

    return this.formatAccount(account);
  }

  /**
   * Get points balance summary
   */
  async getBalance(userId: string): Promise<PointsBalance> {
    const account = await this.getOrCreateAccount(userId);

    // Calculate expiring points in next 30 days
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const expiringBatches = await prisma.pointsBatch.findMany({
      where: {
        accountId: account.id,
        expiresAt: { lte: thirtyDaysFromNow },
        remainingPoints: { gt: 0 },
        expiredAt: null,
      },
    });

    const expiringNext30Days = expiringBatches.reduce(
      (sum: number, batch: any) => sum + Number(batch.remainingPoints),
      0
    );

    return {
      available: account.availablePoints,
      pending: account.pendingPoints,
      expiringNext30Days,
      lifetimeEarned: account.lifetimeEarned,
      lifetimeRedeemed: account.lifetimeRedeemed,
    };
  }

  /**
   * Earn points for an activity
   */
  async earnPoints(params: EarnPointsParams): Promise<{
    pointsEarned: number;
    basePoints: number;
    multiplier: number;
    newBalance: number;
    tierProgress: {
      current: LoyaltyTier;
      points: number;
      nextTier?: LoyaltyTier;
      pointsToNext?: number;
    };
  }> {
    const { userId, amount, source, sourceId, description, skipMultiplier } =
      params;

    // Get or create account
    const account = await this.getOrCreateAccount(userId);

    // Calculate base points
    const pointsPerUnit = POINTS_CONFIG.earning[source] || 0;
    const basePoints = Math.floor(amount * pointsPerUnit);

    if (basePoints <= 0) {
      return {
        pointsEarned: 0,
        basePoints: 0,
        multiplier: 1,
        newBalance: account.availablePoints,
        tierProgress: await this.getTierProgress(userId),
      };
    }

    // Apply tier multiplier
    const multiplier = skipMultiplier
      ? 1
      : POINTS_CONFIG.tierMultipliers[account.tier];
    const pointsEarned = Math.floor(basePoints * multiplier);

    // Calculate expiry date
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + POINTS_CONFIG.expiryMonths);

    // Create batch for FIFO tracking
    const batchId = `batch_${nanoid(16)}`;

    await prisma.$transaction(async (tx) => {
      // Create points batch
      await tx.pointsBatch.create({
        data: {
          id: batchId,
          accountId: account.id,
          originalPoints: BigInt(pointsEarned),
          remainingPoints: BigInt(pointsEarned),
          source,
          expiresAt,
        },
      });

      // Update account
      await tx.pointsAccount.update({
        where: { id: account.id },
        data: {
          availablePoints: { increment: BigInt(pointsEarned) },
          lifetimeEarned: { increment: BigInt(pointsEarned) },
          tierPoints: { increment: BigInt(pointsEarned) },
          lastActivityAt: new Date(),
          lastEarnAt: new Date(),
        },
      });

      // Create transaction record
      await tx.pointsTransaction.create({
        data: {
          id: `txn_${nanoid(16)}`,
          accountId: account.id,
          type: "EARN",
          points: BigInt(pointsEarned),
          balanceAfter: BigInt(account.availablePoints + pointsEarned),
          source,
          sourceId,
          description:
            description ||
            `Earned from ${source.toLowerCase().replace("_", " ")}`,
          basePoints: BigInt(basePoints),
          multiplier,
          qualifyingPoints: BigInt(pointsEarned),
          batchId,
          expiresAt,
        },
      });
    });

    // Check for tier upgrade
    await this.checkTierUpgrade(userId);

    // Invalidate cache
    await redis.del(`points:${userId}`);

    return {
      pointsEarned,
      basePoints,
      multiplier,
      newBalance: account.availablePoints + pointsEarned,
      tierProgress: await this.getTierProgress(userId),
    };
  }

  /**
   * Award bonus points (achievements, streaks, etc.)
   */
  async awardBonusPoints(params: {
    userId: string;
    points: number;
    source: PointsSource;
    sourceId?: string;
    description?: string;
  }): Promise<{ success: boolean; newBalance: number }> {
    const { userId, points, source, sourceId, description } = params;

    if (points <= 0) {
      return { success: false, newBalance: 0 };
    }

    const account = await this.getOrCreateAccount(userId);

    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + POINTS_CONFIG.expiryMonths);

    const batchId = `batch_${nanoid(16)}`;

    await prisma.$transaction(async (tx) => {
      // Create batch
      await tx.pointsBatch.create({
        data: {
          id: batchId,
          accountId: account.id,
          originalPoints: BigInt(points),
          remainingPoints: BigInt(points),
          source,
          expiresAt,
        },
      });

      // Update account
      await tx.pointsAccount.update({
        where: { id: account.id },
        data: {
          availablePoints: { increment: BigInt(points) },
          lifetimeEarned: { increment: BigInt(points) },
          tierPoints: { increment: BigInt(points) },
          lastActivityAt: new Date(),
          lastEarnAt: new Date(),
        },
      });

      // Create transaction
      await tx.pointsTransaction.create({
        data: {
          id: `txn_${nanoid(16)}`,
          accountId: account.id,
          type: "BONUS",
          points: BigInt(points),
          balanceAfter: BigInt(account.availablePoints + points),
          source,
          sourceId,
          description:
            description ||
            `Bonus points from ${source.toLowerCase().replace("_", " ")}`,
          batchId,
          expiresAt,
        },
      });
    });

    await redis.del(`points:${userId}`);

    return {
      success: true,
      newBalance: account.availablePoints + points,
    };
  }

  /**
   * Redeem points
   */
  async redeemPoints(params: RedeemPointsParams): Promise<{
    success: boolean;
    pointsRedeemed: number;
    value: number;
    newBalance: number;
    redemptionCode?: string;
  }> {
    const { userId, points, redemptionType, catalogItemId, description } =
      params;

    const account = await this.getOrCreateAccount(userId);

    if (account.availablePoints < points) {
      throw new Error(
        `Insufficient points. Available: ${account.availablePoints}, Required: ${points}`
      );
    }

    // Calculate redemption value
    const pointsPerDollar = POINTS_CONFIG.redemption[redemptionType] || 100;
    const value = points / pointsPerDollar;

    // Deduct from batches using FIFO
    let remainingToDeduct = points;
    const batches = await prisma.pointsBatch.findMany({
      where: {
        accountId: account.id,
        remainingPoints: { gt: 0 },
        expiredAt: null,
      },
      orderBy: { expiresAt: "asc" }, // FIFO - expire soonest first
    });

    const batchUpdates: Array<{ id: string; deduct: number }> = [];

    for (const batch of batches) {
      if (remainingToDeduct <= 0) break;

      const batchPoints = Number(batch.remainingPoints);
      const deductFromBatch = Math.min(batchPoints, remainingToDeduct);

      batchUpdates.push({ id: batch.id, deduct: deductFromBatch });
      remainingToDeduct -= deductFromBatch;
    }

    if (remainingToDeduct > 0) {
      throw new Error("Unable to deduct points from batches");
    }

    const redemptionCode = `RDM${nanoid(8).toUpperCase()}`;

    await prisma.$transaction(async (tx) => {
      // Update batches
      for (const update of batchUpdates) {
        await tx.pointsBatch.update({
          where: { id: update.id },
          data: {
            remainingPoints: { decrement: BigInt(update.deduct) },
          },
        });
      }

      // Update account
      await tx.pointsAccount.update({
        where: { id: account.id },
        data: {
          availablePoints: { decrement: BigInt(points) },
          lifetimeRedeemed: { increment: BigInt(points) },
          lastActivityAt: new Date(),
          lastRedeemAt: new Date(),
        },
      });

      // Create transaction
      await tx.pointsTransaction.create({
        data: {
          id: `txn_${nanoid(16)}`,
          accountId: account.id,
          type: "REDEEM",
          points: BigInt(-points),
          balanceAfter: BigInt(account.availablePoints - points),
          source: "MANUAL",
          sourceId: catalogItemId,
          description: description || `Redeemed for ${redemptionType}`,
          metadata: { redemptionCode, value, redemptionType },
        },
      });
    });

    await redis.del(`points:${userId}`);

    return {
      success: true,
      pointsRedeemed: points,
      value,
      newBalance: account.availablePoints - points,
      redemptionCode,
    };
  }

  /**
   * Process expired points
   */
  async processExpiredPoints(): Promise<{
    processed: number;
    pointsExpired: number;
  }> {
    const now = new Date();

    const expiredBatches = await prisma.pointsBatch.findMany({
      where: {
        expiresAt: { lte: now },
        remainingPoints: { gt: 0 },
        expiredAt: null,
      },
      include: { account: true },
    });

    let totalExpired = 0;

    for (const batch of expiredBatches) {
      const expiredPoints = Number(batch.remainingPoints);
      totalExpired += expiredPoints;

      await prisma.$transaction(async (tx) => {
        // Mark batch as expired
        await tx.pointsBatch.update({
          where: { id: batch.id },
          data: {
            remainingPoints: BigInt(0),
            expiredAt: now,
          },
        });

        // Update account
        await tx.pointsAccount.update({
          where: { id: batch.accountId },
          data: {
            availablePoints: { decrement: BigInt(expiredPoints) },
            lifetimeExpired: { increment: BigInt(expiredPoints) },
          },
        });

        // Create transaction
        await tx.pointsTransaction.create({
          data: {
            id: `txn_${nanoid(16)}`,
            accountId: batch.accountId,
            type: "EXPIRE",
            points: BigInt(-expiredPoints),
            balanceAfter: BigInt(
              Number(batch.account.availablePoints) - expiredPoints
            ),
            description: "Points expired",
            batchId: batch.id,
          },
        });
      });

      // Invalidate cache
      await redis.del(`points:${batch.account.userId}`);
    }

    return {
      processed: expiredBatches.length,
      pointsExpired: totalExpired,
    };
  }

  /**
   * Get transaction history
   */
  async getTransactions(
    userId: string,
    options: {
      limit?: number;
      offset?: number;
      type?: PointsTransactionType;
    } = {}
  ): Promise<{ transactions: PointsTransaction[]; total: number }> {
    const { limit = 20, offset = 0, type } = options;

    const account = await this.getOrCreateAccount(userId);

    const where: Record<string, unknown> = { accountId: account.id };
    if (type) where.type = type;

    const [transactions, total] = await Promise.all([
      prisma.pointsTransaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.pointsTransaction.count({ where }),
    ]);

    return {
      transactions: transactions.map((t: any) => this.formatTransaction(t)),
      total,
    };
  }

  /**
   * Get tier progress
   */
  async getTierProgress(userId: string): Promise<{
    current: LoyaltyTier;
    points: number;
    nextTier?: LoyaltyTier;
    pointsToNext?: number;
    percentToNext?: number;
  }> {
    const account = await this.getOrCreateAccount(userId);
    const tierPoints = account.tierPoints;

    const tiers: LoyaltyTier[] = ["GREEN", "SILVER", "GOLD", "PLATINUM"];
    const tierThresholds: Record<LoyaltyTier, number> = {
      GREEN: 0,
      SILVER: 5000,
      GOLD: 15000,
      PLATINUM: 50000,
    };

    const currentIndex = tiers.indexOf(account.tier);
    const nextTier =
      currentIndex < tiers.length - 1 ? tiers[currentIndex + 1] : undefined;

    if (!nextTier) {
      return {
        current: account.tier,
        points: tierPoints,
      };
    }

    const currentThreshold = tierThresholds[account.tier];
    const nextThreshold = tierThresholds[nextTier];
    const pointsToNext = nextThreshold - tierPoints;
    const percentToNext = Math.min(
      100,
      ((tierPoints - currentThreshold) / (nextThreshold - currentThreshold)) *
        100
    );

    return {
      current: account.tier,
      points: tierPoints,
      nextTier,
      pointsToNext: Math.max(0, pointsToNext),
      percentToNext: Math.round(percentToNext),
    };
  }

  /**
   * Check and process tier upgrade
   */
  private async checkTierUpgrade(userId: string): Promise<void> {
    const account = await this.getOrCreateAccount(userId);
    const tierPoints = account.tierPoints;

    const tierThresholds: Array<{ tier: LoyaltyTier; min: number }> = [
      { tier: "PLATINUM", min: 50000 },
      { tier: "GOLD", min: 15000 },
      { tier: "SILVER", min: 5000 },
      { tier: "GREEN", min: 0 },
    ];

    let newTier: LoyaltyTier = "GREEN";
    for (const { tier, min } of tierThresholds) {
      if (tierPoints >= min) {
        newTier = tier;
        break;
      }
    }

    if (newTier !== account.tier) {
      const now = new Date();
      const tierExpiresAt = new Date(now);
      tierExpiresAt.setMonth(tierExpiresAt.getMonth() + 12);

      await prisma.$transaction(async (tx) => {
        await tx.pointsAccount.update({
          where: { id: account.id },
          data: {
            tier: newTier,
            tierQualifiedAt: now,
            tierExpiresAt,
          },
        });

        await tx.tierHistory.create({
          data: {
            id: `th_${nanoid(16)}`,
            userId,
            previousTier: account.tier,
            newTier,
            reason: newTier > account.tier ? "upgrade" : "downgrade",
            tierPoints: BigInt(tierPoints),
          },
        });
      });

      // Clear cache
      await redis.del(`points:${userId}`);
    }
  }

  // ===========================================
  // PRIVATE HELPERS
  // ===========================================

  private formatAccount(account: {
    id: string;
    userId: string;
    availablePoints: bigint;
    pendingPoints: bigint;
    lifetimeEarned: bigint;
    lifetimeRedeemed: bigint;
    lifetimeExpired: bigint;
    tier: string;
    tierPoints: bigint;
    tierQualifiedAt: Date | null;
    tierExpiresAt: Date | null;
    lastActivityAt: Date | null;
    createdAt: Date;
  }): PointsAccount {
    return {
      id: account.id,
      userId: account.userId,
      availablePoints: Number(account.availablePoints),
      pendingPoints: Number(account.pendingPoints),
      lifetimeEarned: Number(account.lifetimeEarned),
      lifetimeRedeemed: Number(account.lifetimeRedeemed),
      lifetimeExpired: Number(account.lifetimeExpired),
      tier: account.tier as LoyaltyTier,
      tierPoints: Number(account.tierPoints),
      tierQualifiedAt: account.tierQualifiedAt || undefined,
      tierExpiresAt: account.tierExpiresAt || undefined,
      lastActivityAt: account.lastActivityAt || undefined,
      createdAt: account.createdAt,
    };
  }

  private formatTransaction(txn: {
    id: string;
    accountId: string;
    type: string;
    points: bigint;
    balanceAfter: bigint;
    source: string | null;
    sourceId: string | null;
    description: string | null;
    basePoints: bigint | null;
    multiplier: unknown;
    expiresAt: Date | null;
    createdAt: Date;
  }): PointsTransaction {
    return {
      id: txn.id,
      accountId: txn.accountId,
      type: txn.type as PointsTransactionType,
      points: Number(txn.points),
      balanceAfter: Number(txn.balanceAfter),
      source: txn.source as PointsSource | undefined,
      sourceId: txn.sourceId || undefined,
      description: txn.description || undefined,
      basePoints: txn.basePoints ? Number(txn.basePoints) : undefined,
      multiplier: txn.multiplier ? Number(txn.multiplier) : undefined,
      expiresAt: txn.expiresAt || undefined,
      createdAt: txn.createdAt,
    };
  }
}

// Export singleton
export const pointsService = new PointsService();
