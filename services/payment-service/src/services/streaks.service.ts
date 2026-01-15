/**
 * Streaks Service
 * Daily activity streaks with rewards and freeze protection
 */

import { nanoid } from "nanoid";

import { achievementsService } from "./achievements.service";
import { pointsService } from "./points.service";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

import type { StreakMilestone, UserStreak } from "../types/loyalty.types";

// ===========================================
// STREAK MILESTONES
// ===========================================

const MILESTONES: StreakMilestone[] = [
  { days: 3, reward: { points: 100 } },
  { days: 7, reward: { points: 500, badge: "weekly_warrior" } },
  { days: 14, reward: { points: 1000, freezes: 1 } },
  { days: 30, reward: { points: 3000, badge: "monthly_master" } },
  { days: 60, reward: { points: 6000, freezes: 2 } },
  { days: 90, reward: { points: 10000, badge: "quarter_champion" } },
  { days: 180, reward: { points: 25000, badge: "half_year_hero", freezes: 3 } },
  { days: 365, reward: { points: 50000, badge: "annual_legend", freezes: 5 } },
];

// ===========================================
// STREAKS SERVICE
// ===========================================

export class StreaksService {
  /**
   * Get user's streak info
   */
  async getStreak(userId: string): Promise<UserStreak> {
    let streak = await prisma.userStreak.findUnique({
      where: { userId },
    });

    if (!streak) {
      streak = await prisma.userStreak.create({
        data: {
          id: `strk_${nanoid(16)}`,
          userId,
          currentStreak: 0,
          longestStreak: 0,
          freezesAvailable: 0,
          freezesUsed: 0,
          milestonesReached: [],
        },
      });
    }

    return this.formatStreak(streak);
  }

  /**
   * Record daily activity and update streak
   */
  async recordActivity(
    userId: string,
    _activityType: string = "general",
  ): Promise<{
    streak: UserStreak;
    isNewDay: boolean;
    milestoneReached?: StreakMilestone;
    pointsAwarded?: number;
  }> {
    const today = this.getDateOnly(new Date());
    const streak = await this.getStreak(userId);

    // Check if already recorded today
    if (streak.lastActivityDate) {
      const lastDate = this.getDateOnly(streak.lastActivityDate);
      if (lastDate.getTime() === today.getTime()) {
        return { streak, isNewDay: false };
      }
    }

    // Check if streak continues or breaks
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    let newStreak: number;
    let streakBroken = false;

    if (!streak.lastActivityDate) {
      // First activity ever
      newStreak = 1;
    } else {
      const lastDate = this.getDateOnly(streak.lastActivityDate);

      if (lastDate.getTime() === yesterday.getTime()) {
        // Continuing streak
        newStreak = streak.currentStreak + 1;
      } else {
        // Streak broken
        streakBroken = true;
        newStreak = 1;
      }
    }

    // Update streak
    const longestStreak = Math.max(streak.longestStreak, newStreak);
    const streakStartDate =
      streakBroken || !streak.streakStartDate ? today : streak.streakStartDate;

    await prisma.$transaction(async (tx) => {
      await tx.userStreak.update({
        where: { userId },
        data: {
          currentStreak: newStreak,
          longestStreak,
          lastActivityDate: today,
          streakStartDate,
        },
      });

      // Record in history
      await tx.streakHistory.create({
        data: {
          id: `sh_${nanoid(16)}`,
          streakId: streak.id,
          userId,
          date: today,
          activityType: streakBroken ? "break" : "activity",
          streakValue: newStreak,
        },
      });
    });

    // Check for milestone
    const milestoneReached = await this.checkMilestone(userId, newStreak);

    let pointsAwarded: number | undefined;
    if (milestoneReached) {
      pointsAwarded = milestoneReached.reward.points;

      await pointsService.awardBonusPoints({
        userId,
        points: pointsAwarded,
        source: "STREAK",
        description: `${newStreak}-day streak milestone!`,
      });

      // Award freeze if applicable
      if (milestoneReached.reward.freezes) {
        await prisma.userStreak.update({
          where: { userId },
          data: {
            freezesAvailable: { increment: milestoneReached.reward.freezes },
          },
        });
      }

      // Trigger achievement event
      await achievementsService.processEvent({
        type: "streak_milestone",
        userId,
        timestamp: new Date(),
        data: { streak: newStreak },
      });
    }

    // Clear cache
    await redis.del(`streak:${userId}`);

    const updatedStreak = await this.getStreak(userId);

    return {
      streak: updatedStreak,
      isNewDay: true,
      milestoneReached,
      pointsAwarded,
    };
  }

  /**
   * Use a streak freeze to protect streak
   */
  async useFreeze(userId: string): Promise<{
    success: boolean;
    freezesRemaining: number;
    streakProtected: number;
  }> {
    const streak = await this.getStreak(userId);

    if (streak.freezesAvailable <= 0) {
      throw new Error("No streak freezes available");
    }

    // Check if already used today or yesterday
    if (streak.lastActivityDate) {
      const lastDate = this.getDateOnly(streak.lastActivityDate);
      const today = this.getDateOnly(new Date());
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      if (lastDate.getTime() >= yesterday.getTime()) {
        throw new Error("Streak is still active, freeze not needed");
      }
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    await prisma.$transaction(async (tx) => {
      await tx.userStreak.update({
        where: { userId },
        data: {
          freezesAvailable: { decrement: 1 },
          freezesUsed: { increment: 1 },
          lastFreezeDate: new Date(),
          lastActivityDate: yesterday, // Set to yesterday to continue streak
        },
      });

      await tx.streakHistory.create({
        data: {
          id: `sh_${nanoid(16)}`,
          streakId: streak.id,
          userId,
          date: yesterday,
          activityType: "freeze",
          streakValue: streak.currentStreak,
        },
      });
    });

    await redis.del(`streak:${userId}`);

    return {
      success: true,
      freezesRemaining: streak.freezesAvailable - 1,
      streakProtected: streak.currentStreak,
    };
  }

  /**
   * Get streak history
   */
  async getHistory(
    userId: string,
    days: number = 30,
  ): Promise<
    Array<{
      date: Date;
      activityType: string;
      streakValue: number;
      pointsAwarded?: number;
    }>
  > {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const history = await prisma.streakHistory.findMany({
      where: {
        userId,
        date: { gte: startDate },
      },
      orderBy: { date: "desc" },
    });

    return history.map((h: any) => ({
      date: h.date,
      activityType: h.activityType,
      streakValue: h.streakValue,
      pointsAwarded: h.pointsAwarded || undefined,
    }));
  }

  /**
   * Get calendar view of activity
   */
  async getCalendar(
    userId: string,
    month: number,
    year: number,
  ): Promise<
    Array<{
      date: Date;
      hasActivity: boolean;
      activityType?: string;
      streakValue?: number;
    }>
  > {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const history = await prisma.streakHistory.findMany({
      where: {
        userId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    const activityMap = new Map(
      history.map((h: any) => [h.date.toISOString().split("T")[0], h]),
    );

    const calendar: Array<{
      date: Date;
      hasActivity: boolean;
      activityType?: string;
      streakValue?: number;
    }> = [];

    const current = new Date(startDate);
    while (current <= endDate) {
      const dateKey = current.toISOString().split("T")[0];
      const activity: any = activityMap.get(dateKey);

      calendar.push({
        date: new Date(current),
        hasActivity: !!activity,
        activityType: activity?.activityType,
        streakValue: activity?.streakValue,
      });

      current.setDate(current.getDate() + 1);
    }

    return calendar;
  }

  /**
   * Get next milestone info
   */
  getNextMilestone(currentStreak: number): {
    days: number;
    daysRemaining: number;
    reward: StreakMilestone["reward"];
  } | null {
    const nextMilestone = MILESTONES.find((m) => m.days > currentStreak);

    if (!nextMilestone) {
      return null;
    }

    return {
      days: nextMilestone.days,
      daysRemaining: nextMilestone.days - currentStreak,
      reward: nextMilestone.reward,
    };
  }

  /**
   * Get all milestones with progress
   */
  getMilestones(currentStreak: number): Array<{
    days: number;
    reward: StreakMilestone["reward"];
    achieved: boolean;
    progress: number;
  }> {
    return MILESTONES.map((m) => ({
      days: m.days,
      reward: m.reward,
      achieved: currentStreak >= m.days,
      progress: Math.min(100, Math.round((currentStreak / m.days) * 100)),
    }));
  }

  /**
   * Check for at-risk streaks (users who haven't been active today)
   * For notification service to remind users
   */
  async getAtRiskStreaks(minStreak: number = 3): Promise<
    Array<{
      userId: string;
      currentStreak: number;
      hoursUntilExpiry: number;
      hasFreeze: boolean;
    }>
  > {
    const today = this.getDateOnly(new Date());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Find users with significant streaks who were active yesterday but not today
    const atRisk = await prisma.userStreak.findMany({
      where: {
        currentStreak: { gte: minStreak },
        lastActivityDate: yesterday,
      },
    });

    // Calculate hours until midnight
    const now = new Date();
    const midnight = new Date(today);
    midnight.setDate(midnight.getDate() + 1);
    const hoursUntilMidnight =
      (midnight.getTime() - now.getTime()) / (1000 * 60 * 60);

    return atRisk.map((streak: any) => ({
      userId: streak.userId,
      currentStreak: streak.currentStreak,
      hoursUntilExpiry: Math.round(hoursUntilMidnight),
      hasFreeze: streak.freezesAvailable > 0,
    }));
  }

  /**
   * Get streak leaderboard
   */
  async getLeaderboard(
    type: "current" | "longest" = "current",
    limit: number = 10,
  ): Promise<
    Array<{
      userId: string;
      streak: number;
      rank: number;
    }>
  > {
    const streaks = await prisma.userStreak.findMany({
      orderBy:
        type === "current"
          ? { currentStreak: "desc" }
          : { longestStreak: "desc" },
      take: limit,
    });

    return streaks.map((s: any, index: number) => ({
      userId: s.userId,
      streak: type === "current" ? s.currentStreak : s.longestStreak,
      rank: index + 1,
    }));
  }

  // ===========================================
  // PRIVATE HELPERS
  // ===========================================

  private async checkMilestone(
    userId: string,
    streak: number,
  ): Promise<StreakMilestone | undefined> {
    // Check if this streak value is a milestone
    const milestone = MILESTONES.find((m) => m.days === streak);

    if (!milestone) {
      return undefined;
    }

    // Check if already reached this milestone
    const userStreak = await prisma.userStreak.findUnique({
      where: { userId },
    });

    const milestonesReached = (userStreak?.milestonesReached || []) as number[];

    if (milestonesReached.includes(milestone.days)) {
      return undefined; // Already reached
    }

    // Record milestone
    await prisma.userStreak.update({
      where: { userId },
      data: {
        milestonesReached: [...milestonesReached, milestone.days],
      },
    });

    return milestone;
  }

  private getDateOnly(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private formatStreak(streak: {
    id: string;
    userId: string;
    currentStreak: number;
    longestStreak: number;
    lastActivityDate: Date | null;
    streakStartDate: Date | null;
    freezesAvailable: number;
    freezesUsed: number;
    milestonesReached: unknown;
  }): UserStreak {
    return {
      id: streak.id,
      userId: streak.userId,
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
      lastActivityDate: streak.lastActivityDate || undefined,
      streakStartDate: streak.streakStartDate || undefined,
      freezesAvailable: streak.freezesAvailable,
      freezesUsed: streak.freezesUsed,
      milestonesReached: (streak.milestonesReached || []) as number[],
    };
  }
}

// Export singleton
export const streaksService = new StreaksService();
