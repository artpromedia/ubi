/**
 * Referrals Service
 * Viral referral program with rewards
 */

import { nanoid } from "nanoid";

import { achievementsService } from "./achievements.service";
import { pointsService } from "./points.service";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

import type {
  Referral,
  ReferralCode,
  ReferralProgram,
  ReferralReward,
  ReferralStats,
  ReferralStatus,
} from "../types/loyalty.types";

// ===========================================
// DEFAULT REFERRAL PROGRAM
// ===========================================

/* const _DEFAULT_PROGRAM: Omit<ReferralProgram, "id"> = {
  name: "UBI Referral Program",
  description: "Invite friends and earn rewards when they ride!",
  referrerReward: {
    points: 5000,
    freeRides: 1,
  },
  refereeReward: {
    points: 2000,
    discount: 0.5, // 50% off first ride
  },
  qualificationCriteria: {
    minTransactions: 1, // Referee must complete 1 transaction
    withinDays: 30, // Within 30 days of signup
  },
  maxUsesPerReferrer: 50,
  isActive: true,
}; */

// ===========================================
// REFERRALS SERVICE
// ===========================================

export class ReferralsService {
  /**
   * Get active referral program
   */
  async getActiveProgram(): Promise<ReferralProgram | null> {
    const program = await prisma.referralProgram.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
    });

    return program ? this.formatProgram(program) : null;
  }

  /**
   * Get or generate user's referral code
   */
  async getOrCreateCode(userId: string): Promise<ReferralCode> {
    let code = await prisma.referralCode.findUnique({
      where: { userId },
    });

    if (!code) {
      const program = await this.getActiveProgram();
      const generatedCode = await this.generateUniqueCode(userId);

      code = await prisma.referralCode.create({
        data: {
          id: `rc_${nanoid(16)}`,
          userId,
          programId: program?.id || null,
          code: generatedCode,
          uses: 0,
          maxUses: program?.maxUsesPerReferrer || null,
          isActive: true,
        },
      });
    }

    return this.formatCode(code);
  }

  /**
   * Apply referral code for new user
   */
  async applyCode(
    newUserId: string,
    code: string,
  ): Promise<{
    success: boolean;
    referral: Referral;
    refereeReward?: ReferralReward;
  }> {
    // Validate code
    const referralCode = await prisma.referralCode.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (!referralCode) {
      throw new Error("Invalid referral code");
    }

    if (!referralCode.isActive) {
      throw new Error("Referral code is no longer active");
    }

    if (referralCode.maxUses && referralCode.uses >= referralCode.maxUses) {
      throw new Error("Referral code has reached maximum uses");
    }

    // Check if user already has a referral
    const existingReferral = await prisma.referral.findUnique({
      where: { refereeId: newUserId },
    });

    if (existingReferral) {
      throw new Error("You have already used a referral code");
    }

    // Cannot refer yourself
    if (referralCode.userId === newUserId) {
      throw new Error("You cannot use your own referral code");
    }

    // Get program
    const program = await this.getActiveProgram();
    if (!program) {
      throw new Error("No active referral program");
    }

    // Calculate expiry
    const expiresAt = new Date();
    expiresAt.setDate(
      expiresAt.getDate() + (program.qualificationCriteria.withinDays || 30),
    );

    // Create referral
    const referral = await prisma.$transaction(async (tx) => {
      // Update code usage
      await tx.referralCode.update({
        where: { id: referralCode.id },
        data: { uses: { increment: 1 } },
      });

      // Create referral record
      const ref = await tx.referral.create({
        data: {
          id: `ref_${nanoid(16)}`,
          referrerId: referralCode.userId,
          refereeId: newUserId,
          codeId: referralCode.id,
          status: "PENDING",
          expiresAt,
          refereeReward: program.refereeReward,
        },
      });

      return ref;
    });

    // Apply referee reward immediately (discount, bonus points)
    const refereeReward = program.refereeReward;
    if (refereeReward.points) {
      await pointsService.awardBonusPoints({
        userId: newUserId,
        points: refereeReward.points,
        source: "REFERRAL",
        description: "Welcome bonus from referral!",
      });
    }

    await redis.del(`referral:${newUserId}`);
    await redis.del(`referral_stats:${referralCode.userId}`);

    return {
      success: true,
      referral: this.formatReferral(referral),
      refereeReward,
    };
  }

  /**
   * Complete referral when referee qualifies
   */
  async completeReferral(refereeId: string): Promise<{
    success: boolean;
    referrerRewarded: boolean;
    referral: Referral;
  }> {
    const referral = await prisma.referral.findUnique({
      where: { refereeId },
    });

    if (!referral) {
      return {
        success: false,
        referrerRewarded: false,
        referral: null as unknown as Referral,
      };
    }

    if (referral.status !== "PENDING") {
      return {
        success: false,
        referrerRewarded: false,
        referral: this.formatReferral(referral),
      };
    }

    // Check if expired
    if (referral.expiresAt && new Date() > referral.expiresAt) {
      await prisma.referral.update({
        where: { id: referral.id },
        data: { status: "EXPIRED" },
      });
      return {
        success: false,
        referrerRewarded: false,
        referral: this.formatReferral(referral),
      };
    }

    // Get program rewards
    const program = await this.getActiveProgram();
    if (!program) {
      return {
        success: false,
        referrerRewarded: false,
        referral: this.formatReferral(referral),
      };
    }

    const now = new Date();

    // Update referral status
    await prisma.referral.update({
      where: { id: referral.id },
      data: {
        status: "QUALIFIED",
        qualifiedAt: now,
        qualificationDetails: { completedAt: now.toISOString() },
      },
    });

    // Award referrer
    const referrerReward = program.referrerReward;
    if (referrerReward.points) {
      await pointsService.awardBonusPoints({
        userId: referral.referrerId,
        points: referrerReward.points,
        source: "REFERRAL",
        sourceId: referral.id,
        description:
          "Referral reward - your friend completed their first transaction!",
      });
    }

    // Mark as rewarded
    await prisma.referral.update({
      where: { id: referral.id },
      data: {
        status: "REWARDED",
        referrerRewardedAt: now,
        referrerReward: referrerReward,
      },
    });

    // Trigger achievement
    await achievementsService.processEvent({
      type: "referral_converted",
      userId: referral.referrerId,
      timestamp: now,
      data: { referralId: referral.id, refereeId },
    });

    await redis.del(`referral_stats:${referral.referrerId}`);

    const updatedReferral = await prisma.referral.findUnique({
      where: { id: referral.id },
    });

    return {
      success: true,
      referrerRewarded: true,
      referral: this.formatReferral(updatedReferral!),
    };
  }

  /**
   * Get user's referral stats
   */
  async getStats(userId: string): Promise<ReferralStats> {
    const cacheKey = `referral_stats:${userId}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    await this.getOrCreateCode(userId);

    const referrals = await prisma.referral.findMany({
      where: { referrerId: userId },
    });

    const stats: ReferralStats = {
      totalReferrals: referrals.length,
      pendingReferrals: referrals.filter((r: any) => r.status === "PENDING")
        .length,
      qualifiedReferrals: referrals.filter((r: any) => r.status === "QUALIFIED")
        .length,
      rewardedReferrals: referrals.filter((r: any) => r.status === "REWARDED")
        .length,
      totalPointsEarned: referrals
        .filter((r: any) => r.status === "REWARDED")
        .reduce((sum: any, r: any) => {
          const reward = r.referrerReward as ReferralReward | null;
          return sum + (reward?.points || 0);
        }, 0),
      totalCashEarned: referrals
        .filter((r: any) => r.status === "REWARDED")
        .reduce((sum: any, r: any) => {
          const reward = r.referrerReward as ReferralReward | null;
          return sum + (reward?.cash || 0);
        }, 0),
    };

    await redis.setex(cacheKey, 300, JSON.stringify(stats)); // Cache 5 minutes

    return stats;
  }

  /**
   * Get user's referral history
   */
  async getReferrals(
    userId: string,
    options: { status?: ReferralStatus; limit?: number; offset?: number } = {},
  ): Promise<{ referrals: Referral[]; total: number }> {
    const { status, limit = 20, offset = 0 } = options;

    const where: Record<string, unknown> = { referrerId: userId };
    if (status) {
      where.status = status;
    }

    const [referrals, total] = await Promise.all([
      prisma.referral.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.referral.count({ where }),
    ]);

    return {
      referrals: referrals.map((r: any) => this.formatReferral(r)),
      total,
    };
  }

  /**
   * Check if user was referred
   */
  async getReferrer(userId: string): Promise<{
    wasReferred: boolean;
    referrerId?: string;
    status?: ReferralStatus;
  }> {
    const referral = await prisma.referral.findUnique({
      where: { refereeId: userId },
    });

    if (!referral) {
      return { wasReferred: false };
    }

    return {
      wasReferred: true,
      referrerId: referral.referrerId,
      status: referral.status as ReferralStatus,
    };
  }

  /**
   * Get referral leaderboard
   */
  async getLeaderboard(
    period: "week" | "month" | "all" = "month",
    limit: number = 10,
  ): Promise<
    Array<{
      userId: string;
      referralCount: number;
      rank: number;
    }>
  > {
    let startDate: Date | undefined;

    if (period === "week") {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === "month") {
      startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 1);
    }

    const where: Record<string, unknown> = { status: "REWARDED" };
    if (startDate) {
      where.qualifiedAt = { gte: startDate };
    }

    const leaderboard = await prisma.referral.groupBy({
      by: ["referrerId"],
      where,
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: limit,
    });

    return leaderboard.map((entry: any, index: any) => ({
      userId: entry.referrerId,
      referralCount: entry._count.id,
      rank: index + 1,
    }));
  }

  /**
   * Generate shareable referral link
   */
  async getShareableLink(userId: string): Promise<{
    code: string;
    link: string;
    qrCodeUrl: string;
  }> {
    const code = await this.getOrCreateCode(userId);
    const baseUrl = process.env.APP_URL || "https://ubi.africa";

    return {
      code: code.code,
      link: `${baseUrl}/invite/${code.code}`,
      qrCodeUrl: `${baseUrl}/api/qr/referral/${code.code}`,
    };
  }

  /**
   * Deactivate referral code
   */
  async deactivateCode(userId: string): Promise<void> {
    await prisma.referralCode.updateMany({
      where: { userId },
      data: { isActive: false },
    });

    await redis.del(`referral:${userId}`);
  }

  /**
   * Process expired referrals (run daily)
   */
  async processExpiredReferrals(): Promise<{ processed: number }> {
    const now = new Date();

    const result = await prisma.referral.updateMany({
      where: {
        status: "PENDING",
        expiresAt: { lt: now },
      },
      data: { status: "EXPIRED" },
    });

    return { processed: result.count };
  }

  // ===========================================
  // PRIVATE HELPERS
  // ===========================================

  private async generateUniqueCode(_userId: string): Promise<string> {
    // Try to create a memorable code from user info
    // Format: ABC1234
    const randomPart = nanoid(4)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "X");
    let code = `UBI${randomPart}`;

    // Ensure uniqueness
    let attempts = 0;
    while (attempts < 10) {
      const existing = await prisma.referralCode.findUnique({
        where: { code },
      });

      if (!existing) {
        return code;
      }

      code = `UBI${nanoid(5)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "X")}`;
      attempts++;
    }

    // Fallback to full random
    return `REF${nanoid(8).toUpperCase()}`;
  }

  private formatProgram(program: {
    id: string;
    name: string;
    description: string | null;
    referrerReward: unknown;
    refereeReward: unknown;
    qualificationCriteria: unknown;
    maxUsesPerReferrer: number | null;
    isActive: boolean;
  }): ReferralProgram {
    return {
      id: program.id,
      name: program.name,
      description: program.description || undefined,
      referrerReward: program.referrerReward as ReferralReward,
      refereeReward: program.refereeReward as ReferralReward,
      qualificationCriteria:
        program.qualificationCriteria as ReferralProgram["qualificationCriteria"],
      maxUsesPerReferrer: program.maxUsesPerReferrer || undefined,
      isActive: program.isActive,
    };
  }

  private formatCode(code: {
    id: string;
    userId: string;
    code: string;
    uses: number;
    maxUses: number | null;
    isActive: boolean;
  }): ReferralCode {
    return {
      id: code.id,
      userId: code.userId,
      code: code.code,
      uses: code.uses,
      maxUses: code.maxUses || undefined,
      isActive: code.isActive,
    };
  }

  private formatReferral(referral: {
    id: string;
    referrerId: string;
    refereeId: string;
    codeId: string;
    status: string;
    qualifiedAt: Date | null;
    referrerRewardedAt: Date | null;
    refereeRewardedAt: Date | null;
    referrerReward: unknown;
    refereeReward: unknown;
    createdAt: Date;
  }): Referral {
    return {
      id: referral.id,
      referrerId: referral.referrerId,
      refereeId: referral.refereeId,
      codeId: referral.codeId,
      status: referral.status as ReferralStatus,
      qualifiedAt: referral.qualifiedAt || undefined,
      referrerRewardedAt: referral.referrerRewardedAt || undefined,
      refereeRewardedAt: referral.refereeRewardedAt || undefined,
      referrerReward: referral.referrerReward as ReferralReward | undefined,
      refereeReward: referral.refereeReward as ReferralReward | undefined,
      createdAt: referral.createdAt,
    };
  }
}

// Export singleton
export const referralsService = new ReferralsService();
