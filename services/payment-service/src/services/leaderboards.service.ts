/**
 * UBI Rewards - Leaderboards Service
 *
 * Global and segmented leaderboards for competitive engagement
 *
 * Leaderboard Types:
 * - POINTS_EARNED: Total points earned
 * - RIDES_COMPLETED: Number of rides
 * - FOOD_ORDERS: Number of food orders
 * - REFERRALS: Successful referrals
 * - STREAK: Longest active streak
 * - ACHIEVEMENTS: Total achievements unlocked
 * - SAVINGS: Amount saved via UBI Savings
 *
 * Periods: DAILY, WEEKLY, MONTHLY, ALL_TIME
 */

import { prisma } from "@ubi/database";
import {
  Leaderboard,
  LeaderboardEntry,
  LeaderboardPeriod,
  LeaderboardType,
  LoyaltyTier,
} from "../types/loyalty.types";

// ============================================================================
// LEADERBOARD CONFIGURATION
// ============================================================================

interface LeaderboardConfig {
  type: LeaderboardType;
  name: string;
  description: string;
  icon: string;
  metricField: string;
  periods: LeaderboardPeriod[];
  rewards: {
    position: number;
    points: number;
    badge?: string;
  }[];
}

const LEADERBOARD_CONFIGS: LeaderboardConfig[] = [
  {
    type: "POINTS_EARNED",
    name: "Points Champions",
    description: "Top earners in the UBI Rewards program",
    icon: "🏆",
    metricField: "totalPointsEarned",
    periods: ["DAILY", "WEEKLY", "MONTHLY", "ALL_TIME"],
    rewards: [
      { position: 1, points: 5000, badge: "points_champion" },
      { position: 2, points: 3000 },
      { position: 3, points: 2000 },
      { position: 4, points: 1000 },
      { position: 5, points: 500 },
      { position: 10, points: 250 },
    ],
  },
  {
    type: "RIDES_COMPLETED",
    name: "Road Warriors",
    description: "Most active riders on UBI",
    icon: "🚗",
    metricField: "ridesCompleted",
    periods: ["WEEKLY", "MONTHLY", "ALL_TIME"],
    rewards: [
      { position: 1, points: 3000, badge: "road_warrior" },
      { position: 2, points: 2000 },
      { position: 3, points: 1500 },
      { position: 5, points: 750 },
      { position: 10, points: 300 },
    ],
  },
  {
    type: "FOOD_ORDERS",
    name: "Foodie Leaders",
    description: "Top food enthusiasts",
    icon: "🍕",
    metricField: "foodOrders",
    periods: ["WEEKLY", "MONTHLY", "ALL_TIME"],
    rewards: [
      { position: 1, points: 2500, badge: "foodie_leader" },
      { position: 2, points: 1500 },
      { position: 3, points: 1000 },
      { position: 5, points: 500 },
      { position: 10, points: 250 },
    ],
  },
  {
    type: "REFERRALS",
    name: "Community Builders",
    description: "Top referrers growing the UBI community",
    icon: "🤝",
    metricField: "successfulReferrals",
    periods: ["MONTHLY", "ALL_TIME"],
    rewards: [
      { position: 1, points: 10000, badge: "community_builder" },
      { position: 2, points: 6000 },
      { position: 3, points: 4000 },
      { position: 5, points: 2000 },
      { position: 10, points: 1000 },
    ],
  },
  {
    type: "STREAK",
    name: "Streak Masters",
    description: "Longest activity streaks",
    icon: "🔥",
    metricField: "currentStreak",
    periods: ["ALL_TIME"],
    rewards: [
      { position: 1, points: 5000, badge: "streak_master" },
      { position: 2, points: 3000 },
      { position: 3, points: 2000 },
      { position: 10, points: 500 },
    ],
  },
  {
    type: "ACHIEVEMENTS",
    name: "Achievement Hunters",
    description: "Most achievements unlocked",
    icon: "🎖️",
    metricField: "achievementsUnlocked",
    periods: ["ALL_TIME"],
    rewards: [
      { position: 1, points: 4000, badge: "achievement_hunter" },
      { position: 2, points: 2500 },
      { position: 3, points: 1500 },
      { position: 10, points: 400 },
    ],
  },
  {
    type: "SAVINGS",
    name: "Super Savers",
    description: "Top savers building wealth with UBI",
    icon: "💰",
    metricField: "totalSaved",
    periods: ["MONTHLY", "ALL_TIME"],
    rewards: [
      { position: 1, points: 3000, badge: "super_saver" },
      { position: 2, points: 2000 },
      { position: 3, points: 1000 },
      { position: 10, points: 300 },
    ],
  },
];

// ============================================================================
// LEADERBOARDS SERVICE
// ============================================================================

export class LeaderboardsService {
  // --------------------------------------------------------------------------
  // GET LEADERBOARDS
  // --------------------------------------------------------------------------

  /**
   * Get available leaderboards
   */
  async getLeaderboards(): Promise<
    {
      type: LeaderboardType;
      name: string;
      description: string;
      icon: string;
      periods: LeaderboardPeriod[];
    }[]
  > {
    return LEADERBOARD_CONFIGS.map((config) => ({
      type: config.type,
      name: config.name,
      description: config.description,
      icon: config.icon,
      periods: config.periods,
    }));
  }

  /**
   * Get a specific leaderboard
   */
  async getLeaderboard(
    type: LeaderboardType,
    period: LeaderboardPeriod,
    options?: {
      limit?: number;
      offset?: number;
      region?: string;
      tier?: LoyaltyTier;
    }
  ): Promise<Leaderboard> {
    const config = LEADERBOARD_CONFIGS.find((c) => c.type === type);
    if (!config) {
      throw new Error("Invalid leaderboard type");
    }

    if (!config.periods.includes(period)) {
      throw new Error(`Period ${period} not available for ${type} leaderboard`);
    }

    const limit = options?.limit || 100;
    const offset = options?.offset || 0;

    // Get period boundaries
    const { startDate, endDate } = this.getPeriodBoundaries(period);

    // Build query based on leaderboard type
    const entries = await this.getLeaderboardEntries(
      type,
      config.metricField,
      startDate,
      endDate,
      limit,
      offset,
      options?.region,
      options?.tier
    );

    // Get total participants
    const totalParticipants = await this.getTotalParticipants(
      type,
      startDate,
      endDate
    );

    return {
      id: `${type}_${period}`,
      type,
      name: config.name,
      description: config.description,
      period,
      startDate,
      endDate: period === "ALL_TIME" ? undefined : endDate,
      entries,
      totalParticipants,
      rewards: config.rewards,
    };
  }

  /**
   * Get user's rank on a leaderboard
   */
  async getUserRank(
    userId: string,
    type: LeaderboardType,
    period: LeaderboardPeriod
  ): Promise<{
    rank: number;
    score: number;
    percentile: number;
    topPercent: number;
    nextRankScore?: number;
    pointsToNextRank?: number;
  } | null> {
    const config = LEADERBOARD_CONFIGS.find((c) => c.type === type);
    if (!config) {
      throw new Error("Invalid leaderboard type");
    }

    const { startDate, endDate } = this.getPeriodBoundaries(period);

    // Get user's score
    const userScore = await this.getUserScore(
      userId,
      type,
      config.metricField,
      startDate,
      endDate
    );

    if (userScore === null || userScore === 0) {
      return null;
    }

    // Get total participants and users above this score
    const totalParticipants = await this.getTotalParticipants(
      type,
      startDate,
      endDate
    );
    const usersAbove = await this.getUsersAboveScore(
      type,
      config.metricField,
      userScore,
      startDate,
      endDate
    );

    const rank = usersAbove + 1;
    const percentile =
      totalParticipants > 0
        ? Math.round((1 - rank / totalParticipants) * 100)
        : 0;
    const topPercent =
      totalParticipants > 0
        ? Math.round((rank / totalParticipants) * 100)
        : 100;

    // Get next rank info
    let nextRankScore: number | undefined;
    let pointsToNextRank: number | undefined;

    if (rank > 1) {
      nextRankScore = await this.getScoreAtRank(
        type,
        config.metricField,
        rank - 1,
        startDate,
        endDate
      );
      if (nextRankScore !== null) {
        pointsToNextRank = nextRankScore - userScore;
      }
    }

    return {
      rank,
      score: userScore,
      percentile,
      topPercent,
      nextRankScore,
      pointsToNextRank,
    };
  }

  /**
   * Get user's positions across all leaderboards
   */
  async getUserLeaderboardSummary(userId: string): Promise<
    {
      type: LeaderboardType;
      period: LeaderboardPeriod;
      rank: number;
      score: number;
    }[]
  > {
    const summary: {
      type: LeaderboardType;
      period: LeaderboardPeriod;
      rank: number;
      score: number;
    }[] = [];

    for (const config of LEADERBOARD_CONFIGS) {
      // Get the most relevant period (prefer WEEKLY or MONTHLY over ALL_TIME)
      const period = config.periods.includes("WEEKLY")
        ? "WEEKLY"
        : config.periods.includes("MONTHLY")
          ? "MONTHLY"
          : "ALL_TIME";

      const rankInfo = await this.getUserRank(userId, config.type, period);
      if (rankInfo) {
        summary.push({
          type: config.type,
          period,
          rank: rankInfo.rank,
          score: rankInfo.score,
        });
      }
    }

    return summary.sort((a, b) => a.rank - b.rank);
  }

  // --------------------------------------------------------------------------
  // UPDATE LEADERBOARDS
  // --------------------------------------------------------------------------

  /**
   * Update user's leaderboard entry (called after relevant events)
   */
  async updateUserEntry(
    userId: string,
    type: LeaderboardType,
    incrementBy: number = 1
  ): Promise<void> {
    const config = LEADERBOARD_CONFIGS.find((c) => c.type === type);
    if (!config) return;

    for (const period of config.periods) {
      const { startDate, endDate } = this.getPeriodBoundaries(period);
      const leaderboardId = `${type}_${period}_${startDate.toISOString().slice(0, 10)}`;

      // Upsert entry
      await prisma.leaderboardEntry.upsert({
        where: {
          leaderboardId_userId: {
            leaderboardId,
            userId,
          },
        },
        create: {
          leaderboardId,
          userId,
          score: incrementBy,
          periodStart: startDate,
          periodEnd: endDate,
        },
        update: {
          score: { increment: incrementBy },
        },
      });
    }
  }

  /**
   * Set user's leaderboard score (for absolute values like streak)
   */
  async setUserScore(
    userId: string,
    type: LeaderboardType,
    score: number
  ): Promise<void> {
    const config = LEADERBOARD_CONFIGS.find((c) => c.type === type);
    if (!config) return;

    for (const period of config.periods) {
      const { startDate, endDate } = this.getPeriodBoundaries(period);
      const leaderboardId = `${type}_${period}_${startDate.toISOString().slice(0, 10)}`;

      await prisma.leaderboardEntry.upsert({
        where: {
          leaderboardId_userId: {
            leaderboardId,
            userId,
          },
        },
        create: {
          leaderboardId,
          userId,
          score,
          periodStart: startDate,
          periodEnd: endDate,
        },
        update: { score },
      });
    }
  }

  /**
   * Recalculate all leaderboard entries (admin job)
   */
  async recalculateLeaderboard(
    type: LeaderboardType,
    period: LeaderboardPeriod
  ): Promise<number> {
    const config = LEADERBOARD_CONFIGS.find((c) => c.type === type);
    if (!config) {
      throw new Error("Invalid leaderboard type");
    }

    const { startDate, endDate } = this.getPeriodBoundaries(period);
    const leaderboardId = `${type}_${period}_${startDate.toISOString().slice(0, 10)}`;

    // Delete existing entries for this period
    await prisma.leaderboardEntry.deleteMany({
      where: { leaderboardId },
    });

    // Recalculate based on type
    let count = 0;

    switch (type) {
      case "POINTS_EARNED":
        count = await this.recalculatePointsLeaderboard(
          leaderboardId,
          startDate,
          endDate
        );
        break;
      case "RIDES_COMPLETED":
        count = await this.recalculateRidesLeaderboard(
          leaderboardId,
          startDate,
          endDate
        );
        break;
      case "FOOD_ORDERS":
        count = await this.recalculateFoodOrdersLeaderboard(
          leaderboardId,
          startDate,
          endDate
        );
        break;
      case "REFERRALS":
        count = await this.recalculateReferralsLeaderboard(
          leaderboardId,
          startDate,
          endDate
        );
        break;
      case "STREAK":
        count = await this.recalculateStreakLeaderboard(leaderboardId);
        break;
      case "ACHIEVEMENTS":
        count = await this.recalculateAchievementsLeaderboard(leaderboardId);
        break;
    }

    return count;
  }

  // --------------------------------------------------------------------------
  // REWARDS PROCESSING
  // --------------------------------------------------------------------------

  /**
   * Process period-end rewards
   */
  async processRewards(
    type: LeaderboardType,
    period: LeaderboardPeriod
  ): Promise<{
    processedCount: number;
    totalPointsAwarded: number;
    topWinners: {
      userId: string;
      rank: number;
      points: number;
      badge?: string;
    }[];
  }> {
    const config = LEADERBOARD_CONFIGS.find((c) => c.type === type);
    if (!config) {
      throw new Error("Invalid leaderboard type");
    }

    const { startDate, endDate } = this.getPeriodBoundaries(period);
    const leaderboardId = `${type}_${period}_${startDate.toISOString().slice(0, 10)}`;

    // Check if rewards already processed
    const existingReward = await prisma.leaderboardReward.findFirst({
      where: { leaderboardId },
    });

    if (existingReward) {
      throw new Error("Rewards already processed for this period");
    }

    // Get top entries
    const entries = await prisma.leaderboardEntry.findMany({
      where: { leaderboardId },
      orderBy: { score: "desc" },
      take: Math.max(...config.rewards.map((r) => r.position)),
    });

    const topWinners: {
      userId: string;
      rank: number;
      points: number;
      badge?: string;
    }[] = [];
    let totalPointsAwarded = 0;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const rank = i + 1;

      // Find applicable reward
      const reward = config.rewards.find((r) => r.position >= rank);
      if (!reward) continue;

      // Award points
      const pointsAccount = await prisma.pointsAccount.findUnique({
        where: { userId: entry.userId },
      });

      if (pointsAccount) {
        await prisma.$transaction([
          prisma.pointsAccount.update({
            where: { userId: entry.userId },
            data: {
              totalEarned: { increment: reward.points },
              currentBalance: { increment: reward.points },
            },
          }),
          prisma.pointsTransaction.create({
            data: {
              accountId: pointsAccount.id,
              type: "EARNED",
              amount: reward.points,
              source: "LEADERBOARD_REWARD",
              description: `${config.name} - Rank #${rank}`,
              referenceId: leaderboardId,
              referenceType: "LEADERBOARD",
            },
          }),
          prisma.pointsBatch.create({
            data: {
              accountId: pointsAccount.id,
              originalAmount: reward.points,
              remainingAmount: reward.points,
              earnedAt: new Date(),
              expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            },
          }),
          prisma.leaderboardReward.create({
            data: {
              leaderboardId,
              userId: entry.userId,
              rank,
              pointsAwarded: reward.points,
              badgeAwarded: reward.badge,
              awardedAt: new Date(),
            },
          }),
        ]);

        totalPointsAwarded += reward.points;
        topWinners.push({
          userId: entry.userId,
          rank,
          points: reward.points,
          badge: reward.badge,
        });
      }
    }

    return {
      processedCount: topWinners.length,
      totalPointsAwarded,
      topWinners,
    };
  }

  /**
   * Get user's leaderboard rewards history
   */
  async getUserRewards(userId: string): Promise<
    {
      leaderboardType: string;
      period: string;
      rank: number;
      pointsAwarded: number;
      badgeAwarded?: string;
      awardedAt: Date;
    }[]
  > {
    const rewards = await prisma.leaderboardReward.findMany({
      where: { userId },
      orderBy: { awardedAt: "desc" },
    });

    return rewards.map((r) => {
      const [type, period] = r.leaderboardId.split("_");
      return {
        leaderboardType: type,
        period,
        rank: r.rank,
        pointsAwarded: r.pointsAwarded,
        badgeAwarded: r.badgeAwarded || undefined,
        awardedAt: r.awardedAt,
      };
    });
  }

  // --------------------------------------------------------------------------
  // FRIENDS LEADERBOARD
  // --------------------------------------------------------------------------

  /**
   * Get leaderboard among friends
   */
  async getFriendsLeaderboard(
    userId: string,
    type: LeaderboardType,
    period: LeaderboardPeriod
  ): Promise<LeaderboardEntry[]> {
    // Get user's friends (assuming a friends/contacts relationship exists)
    const friends = await prisma.referral.findMany({
      where: {
        OR: [{ referrerId: userId }, { refereeId: userId }],
        status: "COMPLETED",
      },
      select: {
        referrerId: true,
        refereeId: true,
      },
    });

    const friendIds = new Set<string>();
    friendIds.add(userId); // Include self

    friends.forEach((f) => {
      friendIds.add(f.referrerId);
      friendIds.add(f.refereeId);
    });

    const config = LEADERBOARD_CONFIGS.find((c) => c.type === type);
    if (!config) {
      throw new Error("Invalid leaderboard type");
    }

    const { startDate, endDate } = this.getPeriodBoundaries(period);
    const leaderboardId = `${type}_${period}_${startDate.toISOString().slice(0, 10)}`;

    const entries = await prisma.leaderboardEntry.findMany({
      where: {
        leaderboardId,
        userId: { in: Array.from(friendIds) },
      },
      orderBy: { score: "desc" },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    return entries.map((entry, index) => ({
      userId: entry.userId,
      rank: index + 1,
      score: entry.score,
      displayName: entry.user?.name || "UBI User",
      avatarUrl: entry.user?.avatar || undefined,
      isCurrentUser: entry.userId === userId,
    }));
  }

  // --------------------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------------------

  private getPeriodBoundaries(period: LeaderboardPeriod): {
    startDate: Date;
    endDate: Date;
  } {
    const now = new Date();
    let startDate: Date;
    let endDate: Date;

    switch (period) {
      case "DAILY":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 1);
        break;

      case "WEEKLY":
        const dayOfWeek = now.getDay();
        startDate = new Date(now);
        startDate.setDate(
          now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1)
        );
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 7);
        break;

      case "MONTHLY":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        break;

      case "ALL_TIME":
      default:
        startDate = new Date("2020-01-01");
        endDate = new Date("2100-01-01");
        break;
    }

    return { startDate, endDate };
  }

  private async getLeaderboardEntries(
    type: LeaderboardType,
    metricField: string,
    startDate: Date,
    endDate: Date,
    limit: number,
    offset: number,
    region?: string,
    tier?: LoyaltyTier
  ): Promise<LeaderboardEntry[]> {
    const leaderboardId = `${type}_${this.getPeriodKey(startDate)}_${startDate.toISOString().slice(0, 10)}`;

    const whereClause: any = { leaderboardId };

    // Add region/tier filters if needed (would need user profile join)

    const entries = await prisma.leaderboardEntry.findMany({
      where: whereClause,
      orderBy: { score: "desc" },
      skip: offset,
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    return entries.map((entry, index) => ({
      userId: entry.userId,
      rank: offset + index + 1,
      score: entry.score,
      displayName: entry.user?.name || "UBI User",
      avatarUrl: entry.user?.avatar || undefined,
      change: 0, // Would need historical data for this
    }));
  }

  private getPeriodKey(startDate: Date): string {
    // Determine period from start date pattern
    const now = new Date();
    if (startDate.getFullYear() === 2020) return "ALL_TIME";
    if (startDate.getDate() === 1) return "MONTHLY";
    if (startDate.getDay() === 1) return "WEEKLY";
    return "DAILY";
  }

  private async getTotalParticipants(
    type: LeaderboardType,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    // For simplicity, count users with activity in the period
    // This would be more sophisticated in production
    const result = await prisma.pointsAccount.count({
      where: {
        totalEarned: { gt: 0 },
      },
    });
    return result;
  }

  private async getUserScore(
    userId: string,
    type: LeaderboardType,
    metricField: string,
    startDate: Date,
    endDate: Date
  ): Promise<number | null> {
    switch (type) {
      case "POINTS_EARNED":
        const pointsResult = await prisma.pointsTransaction.aggregate({
          where: {
            account: { userId },
            type: "EARNED",
            createdAt: { gte: startDate, lt: endDate },
          },
          _sum: { amount: true },
        });
        return pointsResult._sum.amount || 0;

      case "STREAK":
        const streak = await prisma.userStreak.findUnique({
          where: { userId },
        });
        return streak?.currentStreak || 0;

      case "ACHIEVEMENTS":
        const achievements = await prisma.userAchievement.count({
          where: { userId, unlockedAt: { not: null } },
        });
        return achievements;

      default:
        // Check leaderboard entry directly
        const { startDate: periodStart } = this.getPeriodBoundaries(
          this.detectPeriodFromDates(startDate, endDate)
        );
        const leaderboardId = `${type}_${this.detectPeriodFromDates(startDate, endDate)}_${periodStart.toISOString().slice(0, 10)}`;

        const entry = await prisma.leaderboardEntry.findUnique({
          where: {
            leaderboardId_userId: { leaderboardId, userId },
          },
        });
        return entry?.score || 0;
    }
  }

  private detectPeriodFromDates(
    startDate: Date,
    endDate: Date
  ): LeaderboardPeriod {
    const daysDiff =
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff <= 1) return "DAILY";
    if (daysDiff <= 7) return "WEEKLY";
    if (daysDiff <= 31) return "MONTHLY";
    return "ALL_TIME";
  }

  private async getUsersAboveScore(
    type: LeaderboardType,
    metricField: string,
    score: number,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    const period = this.detectPeriodFromDates(startDate, endDate);
    const { startDate: periodStart } = this.getPeriodBoundaries(period);
    const leaderboardId = `${type}_${period}_${periodStart.toISOString().slice(0, 10)}`;

    return prisma.leaderboardEntry.count({
      where: {
        leaderboardId,
        score: { gt: score },
      },
    });
  }

  private async getScoreAtRank(
    type: LeaderboardType,
    metricField: string,
    rank: number,
    startDate: Date,
    endDate: Date
  ): Promise<number | null> {
    const period = this.detectPeriodFromDates(startDate, endDate);
    const { startDate: periodStart } = this.getPeriodBoundaries(period);
    const leaderboardId = `${type}_${period}_${periodStart.toISOString().slice(0, 10)}`;

    const entry = await prisma.leaderboardEntry.findFirst({
      where: { leaderboardId },
      orderBy: { score: "desc" },
      skip: rank - 1,
      take: 1,
    });

    return entry?.score || null;
  }

  // Recalculation helpers
  private async recalculatePointsLeaderboard(
    leaderboardId: string,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    const pointsByUser = await prisma.pointsTransaction.groupBy({
      by: ["accountId"],
      where: {
        type: "EARNED",
        createdAt: { gte: startDate, lt: endDate },
      },
      _sum: { amount: true },
    });

    let count = 0;
    for (const entry of pointsByUser) {
      const account = await prisma.pointsAccount.findUnique({
        where: { id: entry.accountId },
      });

      if (account && entry._sum.amount) {
        await prisma.leaderboardEntry.create({
          data: {
            leaderboardId,
            userId: account.userId,
            score: entry._sum.amount,
            periodStart: startDate,
            periodEnd: endDate,
          },
        });
        count++;
      }
    }
    return count;
  }

  private async recalculateRidesLeaderboard(
    leaderboardId: string,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    // Would query ride-service data
    // For now, count RIDE source points transactions as proxy
    const ridesByUser = await prisma.pointsTransaction.groupBy({
      by: ["accountId"],
      where: {
        source: "RIDE",
        type: "EARNED",
        createdAt: { gte: startDate, lt: endDate },
      },
      _count: true,
    });

    let count = 0;
    for (const entry of ridesByUser) {
      const account = await prisma.pointsAccount.findUnique({
        where: { id: entry.accountId },
      });

      if (account) {
        await prisma.leaderboardEntry.create({
          data: {
            leaderboardId,
            userId: account.userId,
            score: entry._count,
            periodStart: startDate,
            periodEnd: endDate,
          },
        });
        count++;
      }
    }
    return count;
  }

  private async recalculateFoodOrdersLeaderboard(
    leaderboardId: string,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    const foodByUser = await prisma.pointsTransaction.groupBy({
      by: ["accountId"],
      where: {
        source: "FOOD_ORDER",
        type: "EARNED",
        createdAt: { gte: startDate, lt: endDate },
      },
      _count: true,
    });

    let count = 0;
    for (const entry of foodByUser) {
      const account = await prisma.pointsAccount.findUnique({
        where: { id: entry.accountId },
      });

      if (account) {
        await prisma.leaderboardEntry.create({
          data: {
            leaderboardId,
            userId: account.userId,
            score: entry._count,
            periodStart: startDate,
            periodEnd: endDate,
          },
        });
        count++;
      }
    }
    return count;
  }

  private async recalculateReferralsLeaderboard(
    leaderboardId: string,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    const referralsByUser = await prisma.referral.groupBy({
      by: ["referrerId"],
      where: {
        status: "COMPLETED",
        completedAt: { gte: startDate, lt: endDate },
      },
      _count: true,
    });

    let count = 0;
    for (const entry of referralsByUser) {
      await prisma.leaderboardEntry.create({
        data: {
          leaderboardId,
          userId: entry.referrerId,
          score: entry._count,
          periodStart: startDate,
          periodEnd: endDate,
        },
      });
      count++;
    }
    return count;
  }

  private async recalculateStreakLeaderboard(
    leaderboardId: string
  ): Promise<number> {
    const streaks = await prisma.userStreak.findMany({
      where: { currentStreak: { gt: 0 } },
      orderBy: { currentStreak: "desc" },
    });

    let count = 0;
    for (const streak of streaks) {
      await prisma.leaderboardEntry.create({
        data: {
          leaderboardId,
          userId: streak.userId,
          score: streak.currentStreak,
          periodStart: new Date("2020-01-01"),
          periodEnd: new Date("2100-01-01"),
        },
      });
      count++;
    }
    return count;
  }

  private async recalculateAchievementsLeaderboard(
    leaderboardId: string
  ): Promise<number> {
    const achievementsByUser = await prisma.userAchievement.groupBy({
      by: ["userId"],
      where: { unlockedAt: { not: null } },
      _count: true,
    });

    let count = 0;
    for (const entry of achievementsByUser) {
      await prisma.leaderboardEntry.create({
        data: {
          leaderboardId,
          userId: entry.userId,
          score: entry._count,
          periodStart: new Date("2020-01-01"),
          periodEnd: new Date("2100-01-01"),
        },
      });
      count++;
    }
    return count;
  }
}

export const leaderboardsService = new LeaderboardsService();
