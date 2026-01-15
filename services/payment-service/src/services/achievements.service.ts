/**
 * Achievements Service
 * Gamification achievements, badges, and rewards
 */

import { nanoid } from "nanoid";

import { pointsService } from "./points.service";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

import type {
  Achievement,
  AchievementCategory,
  AchievementCriteria,
  AchievementReward,
  GameEvent,
  UserAchievement,
} from "../types/loyalty.types";

// ===========================================
// ACHIEVEMENT DEFINITIONS
// ===========================================

const ACHIEVEMENTS: Achievement[] = [
  // RIDES
  {
    id: "ach_first_ride",
    slug: "first_ride",
    name: "First Journey",
    description: "Complete your first ride",
    icon: "car",
    category: "RIDES",
    type: "ONE_TIME",
    criteria: { event: "ride_completed", count: 1 },
    reward: { points: 500, badge: "first_journey" },
    isHidden: false,
    rarity: "common",
    displayOrder: 1,
  },
  {
    id: "ach_10_rides",
    slug: "frequent_rider",
    name: "Frequent Rider",
    description: "Complete 10 rides",
    icon: "car",
    category: "RIDES",
    type: "PROGRESSIVE",
    criteria: { event: "ride_completed", count: 10 },
    targetValue: 10,
    reward: { points: 1000 },
    isHidden: false,
    rarity: "common",
    displayOrder: 2,
  },
  {
    id: "ach_50_rides",
    slug: "road_warrior",
    name: "Road Warrior",
    description: "Complete 50 rides",
    icon: "shield",
    category: "RIDES",
    type: "PROGRESSIVE",
    criteria: { event: "ride_completed", count: 50 },
    targetValue: 50,
    reward: { points: 5000, badge: "road_warrior" },
    isHidden: false,
    rarity: "uncommon",
    displayOrder: 3,
  },
  {
    id: "ach_100_rides",
    slug: "century_rider",
    name: "Century Rider",
    description: "Complete 100 rides",
    icon: "medal",
    category: "RIDES",
    type: "PROGRESSIVE",
    criteria: { event: "ride_completed", count: 100 },
    targetValue: 100,
    reward: { points: 10000, badge: "century" },
    isHidden: false,
    rarity: "rare",
    displayOrder: 4,
  },
  {
    id: "ach_early_bird",
    slug: "early_bird",
    name: "Early Bird",
    description: "Take a ride before 7 AM",
    icon: "sunrise",
    category: "RIDES",
    type: "ONE_TIME",
    criteria: { event: "ride_completed", timeBefore: "07:00" },
    reward: { points: 300, badge: "early_bird" },
    isHidden: false,
    rarity: "uncommon",
    displayOrder: 5,
  },
  {
    id: "ach_night_owl",
    slug: "night_owl",
    name: "Night Owl",
    description: "Take a ride after 11 PM",
    icon: "moon",
    category: "RIDES",
    type: "ONE_TIME",
    criteria: { event: "ride_completed", condition: { afterHour: 23 } },
    reward: { points: 300, badge: "night_owl" },
    isHidden: false,
    rarity: "uncommon",
    displayOrder: 6,
  },

  // FOOD
  {
    id: "ach_first_order",
    slug: "first_bite",
    name: "First Bite",
    description: "Place your first food order",
    icon: "utensils",
    category: "FOOD",
    type: "ONE_TIME",
    criteria: { event: "food_order", count: 1 },
    reward: { points: 500, badge: "foodie_starter" },
    isHidden: false,
    rarity: "common",
    displayOrder: 10,
  },
  {
    id: "ach_foodie_explorer",
    slug: "foodie_explorer",
    name: "Foodie Explorer",
    description: "Order from 10 different restaurants",
    icon: "compass",
    category: "FOOD",
    type: "PROGRESSIVE",
    criteria: { event: "food_order", unique: "restaurantId", count: 10 },
    targetValue: 10,
    reward: { points: 2000, badge: "foodie_explorer" },
    isHidden: false,
    rarity: "uncommon",
    displayOrder: 11,
  },
  {
    id: "ach_gourmet",
    slug: "gourmet",
    name: "Gourmet",
    description: "Complete 50 food orders",
    icon: "chef-hat",
    category: "FOOD",
    type: "PROGRESSIVE",
    criteria: { event: "food_order", count: 50 },
    targetValue: 50,
    reward: { points: 5000, badge: "gourmet" },
    isHidden: false,
    rarity: "rare",
    displayOrder: 12,
  },

  // ENGAGEMENT
  {
    id: "ach_streak_7",
    slug: "weekly_warrior",
    name: "Weekly Warrior",
    description: "Use UBI 7 days in a row",
    icon: "fire",
    category: "ENGAGEMENT",
    type: "REPEATABLE",
    criteria: { event: "streak_milestone", streak: 7 },
    reward: { points: 1000 },
    isHidden: false,
    rarity: "common",
    displayOrder: 20,
  },
  {
    id: "ach_streak_30",
    slug: "monthly_master",
    name: "Monthly Master",
    description: "30-day activity streak",
    icon: "crown",
    category: "ENGAGEMENT",
    type: "REPEATABLE",
    criteria: { event: "streak_milestone", streak: 30 },
    reward: { points: 5000, badge: "dedicated" },
    isHidden: false,
    rarity: "rare",
    displayOrder: 21,
  },
  {
    id: "ach_streak_100",
    slug: "centurion",
    name: "Centurion",
    description: "100-day activity streak",
    icon: "trophy",
    category: "ENGAGEMENT",
    type: "ONE_TIME",
    criteria: { event: "streak_milestone", streak: 100 },
    reward: { points: 20000, badge: "centurion", title: "Centurion" },
    isHidden: true,
    rarity: "legendary",
    displayOrder: 22,
  },

  // SOCIAL
  {
    id: "ach_first_referral",
    slug: "connector",
    name: "Connector",
    description: "Refer your first friend",
    icon: "user-plus",
    category: "SOCIAL",
    type: "ONE_TIME",
    criteria: { event: "referral_converted", count: 1 },
    reward: { points: 2000 },
    isHidden: false,
    rarity: "common",
    displayOrder: 30,
  },
  {
    id: "ach_5_referrals",
    slug: "social_butterfly",
    name: "Social Butterfly",
    description: "Refer 5 friends who complete their first ride",
    icon: "users",
    category: "SOCIAL",
    type: "PROGRESSIVE",
    criteria: { event: "referral_converted", count: 5 },
    targetValue: 5,
    reward: { points: 10000, badge: "social_butterfly" },
    isHidden: false,
    rarity: "uncommon",
    displayOrder: 31,
  },
  {
    id: "ach_influencer",
    slug: "influencer",
    name: "Influencer",
    description: "Refer 20 friends",
    icon: "star",
    category: "SOCIAL",
    type: "PROGRESSIVE",
    criteria: { event: "referral_converted", count: 20 },
    targetValue: 20,
    reward: { points: 50000, badge: "influencer", title: "UBI Influencer" },
    isHidden: false,
    rarity: "epic",
    displayOrder: 32,
  },

  // EXPLORER
  {
    id: "ach_all_services",
    slug: "all_rounder",
    name: "All-Rounder",
    description: "Use all UBI services (Rides, Food, Delivery)",
    icon: "layers",
    category: "EXPLORER",
    type: "ONE_TIME",
    criteria: { event: "service_used", services: ["RIDE", "FOOD", "DELIVERY"] },
    reward: { points: 3000, badge: "all_rounder" },
    isHidden: false,
    rarity: "uncommon",
    displayOrder: 40,
  },

  // WALLET
  {
    id: "ach_first_topup",
    slug: "wallet_starter",
    name: "Wallet Starter",
    description: "Top up your wallet for the first time",
    icon: "wallet",
    category: "WALLET",
    type: "ONE_TIME",
    criteria: { event: "wallet_topup", count: 1 },
    reward: { points: 200 },
    isHidden: false,
    rarity: "common",
    displayOrder: 50,
  },
  {
    id: "ach_cashless",
    slug: "cashless_champion",
    name: "Cashless Champion",
    description: "Complete 20 transactions using wallet",
    icon: "credit-card",
    category: "WALLET",
    type: "PROGRESSIVE",
    criteria: { event: "wallet_payment", count: 20 },
    targetValue: 20,
    reward: { points: 2000, badge: "cashless" },
    isHidden: false,
    rarity: "uncommon",
    displayOrder: 51,
  },

  // PREMIUM
  {
    id: "ach_subscriber",
    slug: "ubi_plus_member",
    name: "UBI+ Member",
    description: "Subscribe to UBI+",
    icon: "crown",
    category: "PREMIUM",
    type: "ONE_TIME",
    criteria: { event: "subscription_created", count: 1 },
    reward: { points: 5000, badge: "ubi_plus" },
    isHidden: false,
    rarity: "rare",
    displayOrder: 60,
  },
];

// ===========================================
// ACHIEVEMENTS SERVICE
// ===========================================

export class AchievementsService {
  /**
   * Get all achievements (visible to user)
   */
  async getAchievements(userId: string): Promise<{
    achievements: Array<Achievement & { userProgress?: UserAchievement }>;
    stats: { total: number; unlocked: number; percentage: number };
  }> {
    // Get user's achievement progress
    const userAchievements = await prisma.userAchievement.findMany({
      where: { userId },
    });

    const progressMap = new Map(
      userAchievements.map(
        (ua: {
          achievementId: string;
          progress: number;
          unlockedAt: Date | null;
        }) => [ua.achievementId, ua],
      ),
    );

    // Filter and enrich achievements
    const visibleAchievements = ACHIEVEMENTS.filter((a) => {
      if (a.isHidden) {
        // Show hidden achievements only if user has made progress
        const progress = progressMap.get(a.id);
        return progress && (progress as { progress: number }).progress > 0;
      }
      return true;
    }).map((a) => ({
      ...a,
      userProgress: progressMap.get(a.id)
        ? this.formatUserAchievement(
            progressMap.get(a.id) as {
              id: string;
              achievementId: string;
              progress: number;
              unlockedAt: Date | null;
              rewardClaimed: boolean;
              claimedAt: Date | null;
              timesUnlocked: number;
              achievement?: unknown;
            },
          )
        : undefined,
    }));

    const unlocked = userAchievements.filter(
      (ua: { unlockedAt: Date | null }) => ua.unlockedAt,
    ).length;
    const total = ACHIEVEMENTS.filter((a) => !a.isHidden).length;

    return {
      achievements: visibleAchievements,
      stats: {
        total,
        unlocked,
        percentage: total > 0 ? Math.round((unlocked / total) * 100) : 0,
      },
    };
  }

  /**
   * Get achievements by category
   */
  async getAchievementsByCategory(
    userId: string,
    category: AchievementCategory,
  ): Promise<Array<Achievement & { userProgress?: UserAchievement }>> {
    const { achievements } = await this.getAchievements(userId);
    return achievements.filter((a) => a.category === category);
  }

  /**
   * Get user's unlocked achievements
   */
  async getUnlockedAchievements(userId: string): Promise<UserAchievement[]> {
    const userAchievements = await prisma.userAchievement.findMany({
      where: {
        userId,
        unlockedAt: { not: null },
      },
      include: { achievement: true },
      orderBy: { unlockedAt: "desc" },
    });

    return userAchievements.map(
      (ua: {
        id: string;
        achievementId: string;
        progress: number;
        unlockedAt: Date | null;
        rewardClaimed: boolean;
        claimedAt: Date | null;
        timesUnlocked: number;
        achievement?: unknown;
      }) => this.formatUserAchievement(ua),
    );
  }

  /**
   * Process a game event and check for achievements
   */
  async processEvent(event: GameEvent): Promise<{
    unlockedAchievements: Achievement[];
    progressUpdates: Array<{
      achievementId: string;
      progress: number;
      target: number;
    }>;
  }> {
    const { userId, type: eventType } = event;

    const unlockedAchievements: Achievement[] = [];
    const progressUpdates: Array<{
      achievementId: string;
      progress: number;
      target: number;
    }> = [];

    // Find matching achievements
    const matchingAchievements = ACHIEVEMENTS.filter((a) => {
      return a.criteria.event === eventType;
    });

    for (const achievement of matchingAchievements) {
      const result = await this.checkAndUpdateProgress(
        userId,
        achievement,
        event,
      );

      if (result.unlocked) {
        unlockedAchievements.push(achievement);
      } else if (result.progressUpdated) {
        progressUpdates.push({
          achievementId: achievement.id,
          progress: result.progress,
          target: achievement.targetValue || achievement.criteria.count || 1,
        });
      }
    }

    return { unlockedAchievements, progressUpdates };
  }

  /**
   * Claim achievement reward
   */
  async claimReward(
    userId: string,
    achievementId: string,
  ): Promise<{
    success: boolean;
    reward?: AchievementReward;
    pointsAwarded?: number;
  }> {
    const userAchievement = await prisma.userAchievement.findUnique({
      where: {
        userId_achievementId: { userId, achievementId },
      },
      include: { achievement: true },
    });

    if (!userAchievement) {
      throw new Error("Achievement not found");
    }

    if (!userAchievement.unlockedAt) {
      throw new Error("Achievement not yet unlocked");
    }

    if (userAchievement.rewardClaimed) {
      throw new Error("Reward already claimed");
    }

    const reward = userAchievement.achievement.reward as AchievementReward;

    // Award points
    if (reward.points) {
      await pointsService.awardBonusPoints({
        userId,
        points: reward.points,
        source: "ACHIEVEMENT",
        sourceId: achievementId,
        description: `Achievement: ${userAchievement.achievement.name}`,
      });
    }

    // Mark as claimed
    await prisma.userAchievement.update({
      where: { id: userAchievement.id },
      data: {
        rewardClaimed: true,
        claimedAt: new Date(),
      },
    });

    return {
      success: true,
      reward,
      pointsAwarded: reward.points,
    };
  }

  /**
   * Get recently unlocked achievements (for notifications)
   */
  async getRecentUnlocks(
    userId: string,
    since: Date,
  ): Promise<Array<{ achievement: Achievement; unlockedAt: Date }>> {
    const recent = await prisma.userAchievement.findMany({
      where: {
        userId,
        unlockedAt: { gte: since },
      },
      include: { achievement: true },
      orderBy: { unlockedAt: "desc" },
    });

    return recent.map(
      (ua: { achievementId: string; unlockedAt: Date | null }) => ({
        achievement: ACHIEVEMENTS.find((a) => a.id === ua.achievementId)!,
        unlockedAt: ua.unlockedAt!,
      }),
    );
  }

  /**
   * Get achievement leaderboard
   */
  async getLeaderboard(limit: number = 10): Promise<
    Array<{
      userId: string;
      achievementCount: number;
      totalPoints: number;
      rank: number;
    }>
  > {
    const leaderboard = await prisma.userAchievement.groupBy({
      by: ["userId"],
      where: { unlockedAt: { not: null } },
      _count: { id: true },
    });

    // Sort and add ranks
    const sorted = leaderboard
      .sort(
        (a: { _count: { id: number } }, b: { _count: { id: number } }) =>
          b._count.id - a._count.id,
      )
      .slice(0, limit)
      .map(
        (entry: { userId: string; _count: { id: number } }, index: number) => ({
          userId: entry.userId,
          achievementCount: entry._count.id,
          totalPoints: 0, // TODO: Calculate from rewards
          rank: index + 1,
        }),
      );

    return sorted;
  }

  // ===========================================
  // PRIVATE HELPERS
  // ===========================================

  private async checkAndUpdateProgress(
    userId: string,
    achievement: Achievement,
    event: GameEvent,
  ): Promise<{
    unlocked: boolean;
    progressUpdated: boolean;
    progress: number;
  }> {
    // Get or create user achievement record
    let userAchievement = await prisma.userAchievement.findUnique({
      where: {
        userId_achievementId: { userId, achievementId: achievement.id },
      },
    });

    // If one-time and already unlocked, skip
    if (achievement.type === "ONE_TIME" && userAchievement?.unlockedAt) {
      return {
        unlocked: false,
        progressUpdated: false,
        progress: userAchievement.progress,
      };
    }

    // Check if event matches criteria
    const matches = this.eventMatchesCriteria(event, achievement.criteria);
    if (!matches) {
      return {
        unlocked: false,
        progressUpdated: false,
        progress: userAchievement?.progress || 0,
      };
    }

    // Calculate new progress
    const targetValue =
      achievement.targetValue || achievement.criteria.count || 1;
    let newProgress = (userAchievement?.progress || 0) + 1;

    // For unique tracking (e.g., unique restaurants)
    if (achievement.criteria.unique) {
      const uniqueKey = achievement.criteria.unique;
      const uniqueValue = event.data[uniqueKey];

      // Track unique values in metadata
      const metadata = (userAchievement?.metadata || { uniqueValues: [] }) as {
        uniqueValues: string[];
      };
      if (!metadata.uniqueValues.includes(String(uniqueValue))) {
        metadata.uniqueValues.push(String(uniqueValue));
        newProgress = metadata.uniqueValues.length;

        if (!userAchievement) {
          userAchievement = await prisma.userAchievement.create({
            data: {
              id: `ua_${nanoid(16)}`,
              userId,
              achievementId: achievement.id,
              progress: newProgress,
              metadata,
            },
          });
        } else {
          await prisma.userAchievement.update({
            where: { id: userAchievement.id },
            data: { progress: newProgress, metadata },
          });
        }
      } else {
        return {
          unlocked: false,
          progressUpdated: false,
          progress: newProgress,
        };
      }
    } else {
      // Standard count-based progress
      if (!userAchievement) {
        userAchievement = await prisma.userAchievement.create({
          data: {
            id: `ua_${nanoid(16)}`,
            userId,
            achievementId: achievement.id,
            progress: newProgress,
          },
        });
      } else {
        await prisma.userAchievement.update({
          where: { id: userAchievement.id },
          data: { progress: newProgress },
        });
      }
    }

    // Check if unlocked
    if (newProgress >= targetValue) {
      await prisma.userAchievement.update({
        where: { id: userAchievement.id },
        data: {
          unlockedAt: new Date(),
          timesUnlocked: { increment: 1 },
          lastUnlockedAt: new Date(),
          // Reset progress for repeatable achievements
          progress: achievement.type === "REPEATABLE" ? 0 : newProgress,
        },
      });

      // Clear cache
      await redis.del(`achievements:${userId}`);

      return { unlocked: true, progressUpdated: true, progress: newProgress };
    }

    return { unlocked: false, progressUpdated: true, progress: newProgress };
  }

  private eventMatchesCriteria(
    event: GameEvent,
    criteria: AchievementCriteria,
  ): boolean {
    // Check event type
    if (criteria.event !== event.type) {
      return false;
    }

    // Check time-based criteria
    if (criteria.timeBefore) {
      const eventTime = new Date(event.timestamp);
      const timeParts = criteria.timeBefore.split(":").map(Number);
      const hours = timeParts[0];
      const minutes = timeParts[1];
      if (
        hours !== undefined &&
        minutes !== undefined &&
        (eventTime.getHours() > hours ||
          (eventTime.getHours() === hours && eventTime.getMinutes() > minutes))
      ) {
        return false;
      }
    }

    // Check streak criteria
    if (criteria.streak && event.data.streak !== criteria.streak) {
      return false;
    }

    // Check services criteria
    if (criteria.services) {
      const usedServices = event.data.services as string[];
      if (!criteria.services.every((s) => usedServices?.includes(s))) {
        return false;
      }
    }

    // Check condition
    if (criteria.condition) {
      for (const [key, value] of Object.entries(criteria.condition)) {
        if (key === "afterHour" && typeof value === "number") {
          const eventTime = new Date(event.timestamp);
          if (eventTime.getHours() < value) {
            return false;
          }
        }
        // Add more condition checks as needed
      }
    }

    return true;
  }

  private formatUserAchievement(ua: {
    id: string;
    achievementId: string;
    progress: number;
    unlockedAt: Date | null;
    rewardClaimed: boolean;
    claimedAt: Date | null;
    timesUnlocked: number;
    achievement?: unknown;
  }): UserAchievement {
    return {
      id: ua.id,
      achievementId: ua.achievementId,
      progress: ua.progress,
      unlockedAt: ua.unlockedAt || undefined,
      rewardClaimed: ua.rewardClaimed,
      claimedAt: ua.claimedAt || undefined,
      timesUnlocked: ua.timesUnlocked,
      achievement: ua.achievement
        ? ACHIEVEMENTS.find((a) => a.id === ua.achievementId)
        : undefined,
    };
  }
}

// Export singleton
export const achievementsService = new AchievementsService();
