/**
 * Tier Service
 * Loyalty tier management, benefits, and upgrades
 */

import { nanoid } from "nanoid";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import type {
  LoyaltyTier,
  TierBenefits,
  TierConfig,
} from "../types/loyalty.types";

// ===========================================
// TIER CONFIGURATION
// ===========================================

const TIERS: Record<LoyaltyTier, TierConfig> = {
  GREEN: {
    tier: "GREEN",
    name: "Green",
    displayName: "UBI Green",
    color: "#22C55E",
    icon: "leaf",
    minPoints: 0,
    qualificationPeriodMonths: 12,
    gracePeriodMonths: 3,
    benefits: {
      pointsMultiplier: 1.0,
      prioritySupport: false,
      priorityMatching: false,
      freeDeliveries: 0,
      freeCancellations: 0,
      exclusiveOffers: false,
      exclusiveDiscounts: 0,
      loungeAccess: false,
      dedicatedManager: false,
      surgeProtection: 0,
    },
  },
  SILVER: {
    tier: "SILVER",
    name: "Silver",
    displayName: "UBI Silver",
    color: "#94A3B8",
    icon: "star",
    minPoints: 5000,
    qualificationPeriodMonths: 12,
    gracePeriodMonths: 3,
    benefits: {
      pointsMultiplier: 1.25,
      prioritySupport: true,
      priorityMatching: false,
      freeDeliveries: 2,
      freeCancellations: 1,
      exclusiveOffers: true,
      exclusiveDiscounts: 0,
      loungeAccess: false,
      dedicatedManager: false,
      surgeProtection: 0.1,
    },
  },
  GOLD: {
    tier: "GOLD",
    name: "Gold",
    displayName: "UBI Gold",
    color: "#F59E0B",
    icon: "crown",
    minPoints: 15000,
    qualificationPeriodMonths: 12,
    gracePeriodMonths: 3,
    benefits: {
      pointsMultiplier: 1.5,
      prioritySupport: true,
      priorityMatching: true,
      freeDeliveries: 5,
      freeCancellations: 3,
      exclusiveOffers: true,
      exclusiveDiscounts: 0.05,
      loungeAccess: false,
      dedicatedManager: false,
      surgeProtection: 0.2,
    },
  },
  PLATINUM: {
    tier: "PLATINUM",
    name: "Platinum",
    displayName: "UBI Platinum",
    color: "#1E293B",
    icon: "gem",
    minPoints: 50000,
    qualificationPeriodMonths: 12,
    gracePeriodMonths: 3,
    benefits: {
      pointsMultiplier: 2.0,
      prioritySupport: true,
      priorityMatching: true,
      freeDeliveries: "unlimited",
      freeCancellations: 5,
      exclusiveOffers: true,
      exclusiveDiscounts: 0.1,
      loungeAccess: true,
      dedicatedManager: true,
      surgeProtection: 0.3,
    },
  },
};

// ===========================================
// TIER SERVICE
// ===========================================

export class TierService {
  /**
   * Get user's current tier info
   */
  async getUserTier(userId: string): Promise<{
    tier: LoyaltyTier;
    config: TierConfig;
    qualifiedAt?: Date;
    expiresAt?: Date;
    tierPoints: number;
    daysUntilExpiry?: number;
  }> {
    const account = await prisma.pointsAccount.findUnique({
      where: { userId },
    });

    if (!account) {
      return {
        tier: "GREEN",
        config: TIERS.GREEN,
        tierPoints: 0,
      };
    }

    const tier = account.tier as LoyaltyTier;
    const config = TIERS[tier];

    let daysUntilExpiry: number | undefined;
    if (account.tierExpiresAt) {
      const now = new Date();
      daysUntilExpiry = Math.ceil(
        (account.tierExpiresAt.getTime() - now.getTime()) /
          (1000 * 60 * 60 * 24)
      );
    }

    return {
      tier,
      config,
      qualifiedAt: account.tierQualifiedAt || undefined,
      expiresAt: account.tierExpiresAt || undefined,
      tierPoints: Number(account.tierPoints),
      daysUntilExpiry: daysUntilExpiry
        ? Math.max(0, daysUntilExpiry)
        : undefined,
    };
  }

  /**
   * Get all tier configurations
   */
  getAllTiers(): TierConfig[] {
    return Object.values(TIERS).sort((a, b) => a.minPoints - b.minPoints);
  }

  /**
   * Get tier benefits
   */
  getTierBenefits(tier: LoyaltyTier): TierBenefits {
    return TIERS[tier].benefits;
  }

  /**
   * Get user's tier benefits with usage tracking
   */
  async getUserBenefits(userId: string): Promise<{
    tier: LoyaltyTier;
    benefits: TierBenefits;
    usage: {
      freeDeliveriesUsed: number;
      freeDeliveriesRemaining: number | "unlimited";
      freeCancellationsUsed: number;
      freeCancellationsRemaining: number | "unlimited";
    };
  }> {
    const { tier, config } = await this.getUserTier(userId);
    const benefits = config.benefits;

    // Get usage from current month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const usage = await prisma.tierBenefitUsage.findFirst({
      where: {
        userId,
        periodStart: { gte: startOfMonth },
      },
    });

    const freeDeliveriesUsed = usage?.freeDeliveriesUsed || 0;
    const freeCancellationsUsed = usage?.freeCancellationsUsed || 0;

    return {
      tier,
      benefits,
      usage: {
        freeDeliveriesUsed,
        freeDeliveriesRemaining:
          benefits.freeDeliveries === "unlimited"
            ? "unlimited"
            : Math.max(
                0,
                (benefits.freeDeliveries as number) - freeDeliveriesUsed
              ),
        freeCancellationsUsed,
        freeCancellationsRemaining:
          benefits.freeCancellations - freeCancellationsUsed > 0
            ? benefits.freeCancellations - freeCancellationsUsed
            : 0,
      },
    };
  }

  /**
   * Use a tier benefit
   */
  async useBenefit(
    userId: string,
    benefit: "freeDelivery" | "freeCancellation"
  ): Promise<{ success: boolean; remaining: number | "unlimited" }> {
    const { tier, benefits, usage } = await this.getUserBenefits(userId);

    if (benefit === "freeDelivery") {
      if (benefits.freeDeliveries === 0) {
        return { success: false, remaining: 0 };
      }
      if (
        benefits.freeDeliveries !== "unlimited" &&
        usage.freeDeliveriesUsed >= (benefits.freeDeliveries as number)
      ) {
        return { success: false, remaining: 0 };
      }

      await this.incrementUsage(userId, "freeDeliveriesUsed");

      return {
        success: true,
        remaining:
          benefits.freeDeliveries === "unlimited"
            ? "unlimited"
            : (benefits.freeDeliveries as number) -
              usage.freeDeliveriesUsed -
              1,
      };
    }

    if (benefit === "freeCancellation") {
      if (benefits.freeCancellations === 0) {
        return { success: false, remaining: 0 };
      }
      if (usage.freeCancellationsUsed >= benefits.freeCancellations) {
        return { success: false, remaining: 0 };
      }

      await this.incrementUsage(userId, "freeCancellationsUsed");

      return {
        success: true,
        remaining: benefits.freeCancellations - usage.freeCancellationsUsed - 1,
      };
    }

    return { success: false, remaining: 0 };
  }

  /**
   * Calculate surge protection discount
   */
  async getSurgeDiscount(
    userId: string,
    surgeMultiplier: number
  ): Promise<number> {
    const { benefits } = await this.getUserBenefits(userId);

    if (benefits.surgeProtection <= 0) {
      return 0;
    }

    // Calculate the discount on the surge portion
    // If surge is 2.0x and protection is 30%, reduce surge to 1.7x
    const surgeAmount = surgeMultiplier - 1;
    const discount = surgeAmount * benefits.surgeProtection;

    return Math.round(discount * 100) / 100;
  }

  /**
   * Check if user has priority matching
   */
  async hasPriorityMatching(userId: string): Promise<boolean> {
    const { benefits } = await this.getUserBenefits(userId);
    return benefits.priorityMatching;
  }

  /**
   * Check if user has priority support
   */
  async hasPrioritySupport(userId: string): Promise<boolean> {
    const { benefits } = await this.getUserBenefits(userId);
    return benefits.prioritySupport;
  }

  /**
   * Get tier comparison
   */
  getTierComparison(): Array<{
    tier: LoyaltyTier;
    name: string;
    minPoints: number;
    benefits: TierBenefits;
  }> {
    return Object.values(TIERS).map((config) => ({
      tier: config.tier,
      name: config.displayName,
      minPoints: config.minPoints,
      benefits: config.benefits,
    }));
  }

  /**
   * Process tier expirations (run daily)
   */
  async processExpirations(): Promise<{
    processed: number;
    downgraded: number;
  }> {
    const now = new Date();

    // Find accounts with expired tier qualification
    const expiredAccounts = await prisma.pointsAccount.findMany({
      where: {
        tier: { not: "GREEN" },
        tierExpiresAt: { lt: now },
      },
    });

    let downgraded = 0;

    for (const account of expiredAccounts) {
      const currentTier = account.tier as LoyaltyTier;
      const tierPoints = Number(account.tierPoints);

      // Check if user re-qualified during grace period
      let newTier: LoyaltyTier = "GREEN";
      const tiers: Array<{ tier: LoyaltyTier; min: number }> = [
        { tier: "PLATINUM", min: 50000 },
        { tier: "GOLD", min: 15000 },
        { tier: "SILVER", min: 5000 },
      ];

      for (const { tier, min } of tiers) {
        if (tierPoints >= min) {
          newTier = tier;
          break;
        }
      }

      // Check if downgrade
      const tierOrder: LoyaltyTier[] = ["GREEN", "SILVER", "GOLD", "PLATINUM"];
      const currentIndex = tierOrder.indexOf(currentTier);
      const newIndex = tierOrder.indexOf(newTier);

      if (newIndex < currentIndex) {
        downgraded++;
      }

      // Update tier
      const newExpiresAt = new Date();
      newExpiresAt.setMonth(newExpiresAt.getMonth() + 12);

      await prisma.$transaction(async (tx) => {
        await tx.pointsAccount.update({
          where: { id: account.id },
          data: {
            tier: newTier,
            tierQualifiedAt: now,
            tierExpiresAt: newExpiresAt,
            tierPoints: BigInt(0), // Reset tier points for new period
          },
        });

        await tx.tierHistory.create({
          data: {
            id: `th_${nanoid(16)}`,
            userId: account.userId,
            previousTier: currentTier,
            newTier,
            reason: newIndex < currentIndex ? "downgrade" : "maintain",
            tierPoints: BigInt(tierPoints),
            metadata: { evaluationDate: now.toISOString() },
          },
        });
      });

      await redis.del(`tier:${account.userId}`);
    }

    return {
      processed: expiredAccounts.length,
      downgraded,
    };
  }

  /**
   * Get tier history
   */
  async getTierHistory(
    userId: string,
    limit: number = 10
  ): Promise<
    Array<{
      previousTier?: LoyaltyTier;
      newTier: LoyaltyTier;
      reason: string;
      tierPoints: number;
      createdAt: Date;
    }>
  > {
    const history = await prisma.tierHistory.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return history.map((h) => ({
      previousTier: h.previousTier as LoyaltyTier | undefined,
      newTier: h.newTier as LoyaltyTier,
      reason: h.reason,
      tierPoints: Number(h.tierPoints),
      createdAt: h.createdAt,
    }));
  }

  /**
   * Get tier analytics
   */
  async getTierAnalytics(): Promise<{
    distribution: Record<LoyaltyTier, number>;
    totalMembers: number;
    avgPointsByTier: Record<LoyaltyTier, number>;
    upgradesThisMonth: number;
    downgradesThisMonth: number;
  }> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Distribution
    const accounts = await prisma.pointsAccount.groupBy({
      by: ["tier"],
      _count: { id: true },
      _avg: { tierPoints: true },
    });

    const distribution: Record<LoyaltyTier, number> = {
      GREEN: 0,
      SILVER: 0,
      GOLD: 0,
      PLATINUM: 0,
    };

    const avgPointsByTier: Record<LoyaltyTier, number> = {
      GREEN: 0,
      SILVER: 0,
      GOLD: 0,
      PLATINUM: 0,
    };

    let totalMembers = 0;

    for (const account of accounts) {
      const tier = account.tier as LoyaltyTier;
      distribution[tier] = account._count.id;
      avgPointsByTier[tier] = Math.round(Number(account._avg.tierPoints || 0));
      totalMembers += account._count.id;
    }

    // Tier changes this month
    const tierChanges = await prisma.tierHistory.findMany({
      where: { createdAt: { gte: startOfMonth } },
    });

    const tierOrder: LoyaltyTier[] = ["GREEN", "SILVER", "GOLD", "PLATINUM"];
    let upgradesThisMonth = 0;
    let downgradesThisMonth = 0;

    for (const change of tierChanges) {
      if (!change.previousTier) continue;
      const prevIndex = tierOrder.indexOf(change.previousTier as LoyaltyTier);
      const newIndex = tierOrder.indexOf(change.newTier as LoyaltyTier);
      if (newIndex > prevIndex) upgradesThisMonth++;
      else if (newIndex < prevIndex) downgradesThisMonth++;
    }

    return {
      distribution,
      totalMembers,
      avgPointsByTier,
      upgradesThisMonth,
      downgradesThisMonth,
    };
  }

  // ===========================================
  // PRIVATE HELPERS
  // ===========================================

  private async incrementUsage(
    userId: string,
    field: "freeDeliveriesUsed" | "freeCancellationsUsed"
  ): Promise<void> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const endOfMonth = new Date(startOfMonth);
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);

    await prisma.tierBenefitUsage.upsert({
      where: {
        userId_periodStart: {
          userId,
          periodStart: startOfMonth,
        },
      },
      create: {
        id: `tbu_${nanoid(16)}`,
        userId,
        periodStart: startOfMonth,
        periodEnd: endOfMonth,
        freeDeliveriesUsed: field === "freeDeliveriesUsed" ? 1 : 0,
        freeCancellationsUsed: field === "freeCancellationsUsed" ? 1 : 0,
      },
      update: {
        [field]: { increment: 1 },
      },
    });
  }
}

// Export singleton
export const tierService = new TierService();
