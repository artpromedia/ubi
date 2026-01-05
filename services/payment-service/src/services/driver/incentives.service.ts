// ===========================================
// UBI Driver Experience Platform
// Incentives & Bonuses Service
// ===========================================

import { EventEmitter } from "events";
import {
  DRIVER_EVENTS,
  DriverIncentive,
  DriverIncentiveProgress,
  DriverStreak,
  IIncentiveService,
  Incentive,
  IncentiveProgressStatus,
  IncentiveRequirements,
  IncentiveType,
  IncentiveUpdate,
  RewardTier,
  StreakMilestone,
  StreakType,
  TripEarning,
} from "../../types/driver.types";

// -----------------------------------------
// INCENTIVE CONFIGURATIONS
// -----------------------------------------

const STREAK_MILESTONES: Record<StreakType, StreakMilestone[]> = {
  [StreakType.DAILY_ACTIVE]: [
    {
      count: 7,
      reward: { type: "cash", value: 500, description: "7-day streak bonus" },
    },
    {
      count: 14,
      reward: { type: "cash", value: 1500, description: "14-day streak bonus" },
    },
    {
      count: 30,
      reward: { type: "cash", value: 5000, description: "30-day streak bonus" },
    },
    {
      count: 60,
      reward: {
        type: "badge",
        value: 1,
        description: "Consistency Champion badge",
      },
    },
    {
      count: 90,
      reward: {
        type: "cash",
        value: 15000,
        description: "90-day streak bonus",
      },
    },
  ],
  [StreakType.DAILY_TRIPS]: [
    {
      count: 5,
      reward: { type: "cash", value: 200, description: "5 trips streak" },
    },
    {
      count: 10,
      reward: { type: "cash", value: 500, description: "10 trips streak" },
    },
    {
      count: 20,
      reward: { type: "cash", value: 1500, description: "20 trips streak" },
    },
    {
      count: 50,
      reward: { type: "badge", value: 1, description: "Trip Master badge" },
    },
  ],
  [StreakType.FIVE_STAR]: [
    {
      count: 10,
      reward: { type: "cash", value: 300, description: "10 five-star streak" },
    },
    {
      count: 25,
      reward: { type: "cash", value: 1000, description: "25 five-star streak" },
    },
    {
      count: 50,
      reward: { type: "badge", value: 1, description: "Service Star badge" },
    },
    {
      count: 100,
      reward: {
        type: "cash",
        value: 5000,
        description: "100 five-star streak",
      },
    },
  ],
  [StreakType.ACCEPTANCE]: [
    {
      count: 20,
      reward: { type: "cash", value: 500, description: "20 accepts streak" },
    },
    {
      count: 50,
      reward: { type: "cash", value: 1500, description: "50 accepts streak" },
    },
    {
      count: 100,
      reward: { type: "badge", value: 1, description: "Reliable Driver badge" },
    },
  ],
  [StreakType.COMPLETION]: [
    {
      count: 30,
      reward: {
        type: "cash",
        value: 500,
        description: "30 completions streak",
      },
    },
    {
      count: 75,
      reward: {
        type: "cash",
        value: 2000,
        description: "75 completions streak",
      },
    },
    {
      count: 150,
      reward: { type: "badge", value: 1, description: "Completion Pro badge" },
    },
  ],
};

// -----------------------------------------
// INCENTIVE SERVICE
// -----------------------------------------

export class IncentiveService implements IIncentiveService {
  private eventEmitter: EventEmitter;
  private cache: Map<string, { data: unknown; expiry: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(
    private db: any,
    // @ts-expect-error - Reserved for future Redis integration
    private _redis: any,
    private notificationService: any,
    private analyticsService: any
  ) {
    this.eventEmitter = new EventEmitter();
  }

  // -----------------------------------------
  // GET AVAILABLE INCENTIVES
  // -----------------------------------------

  async getAvailableIncentives(driverId: string): Promise<DriverIncentive[]> {
    const cacheKey = `incentives:${driverId}`;
    const cached = await this.getCached<DriverIncentive[]>(cacheKey);
    if (cached) return cached;

    // Get driver profile for targeting
    const driver = await this.getDriverProfile(driverId);
    const now = new Date();

    // Fetch active incentives
    const incentives = await this.db.incentive.findMany({
      where: {
        isActive: true,
        startTime: { lte: now },
        endTime: { gt: now },
        OR: [
          { targetCities: { isEmpty: true } },
          { targetCities: { has: driver.city } },
        ],
      },
      orderBy: {
        endTime: "asc",
      },
    });

    // Filter by eligibility and add progress
    const driverIncentives: DriverIncentive[] = [];

    for (const incentive of incentives) {
      const eligibility = this.checkEligibility(driver, incentive);
      if (!eligibility.eligible) continue;

      // Get or create progress
      let progress = await this.db.driverIncentiveProgress.findUnique({
        where: {
          driverId_incentiveId: {
            driverId,
            incentiveId: incentive.id,
          },
        },
      });

      if (!progress) {
        progress = await this.createProgress(driverId, incentive.id);
      }

      const driverIncentive = this.mapToDriverIncentive(
        incentive,
        progress,
        driver
      );
      driverIncentives.push(driverIncentive);
    }

    // Sort by potential earnings
    driverIncentives.sort((a, b) => b.potentialEarnings - a.potentialEarnings);

    await this.setCache(cacheKey, driverIncentives, this.CACHE_TTL);

    // Track view
    this.trackEvent(driverId, DRIVER_EVENTS.INCENTIVE_VIEWED, {
      count: driverIncentives.length,
    });

    return driverIncentives;
  }

  async getIncentiveProgress(
    driverId: string,
    incentiveId: string
  ): Promise<DriverIncentiveProgress> {
    const progress = await this.db.driverIncentiveProgress.findUnique({
      where: {
        driverId_incentiveId: {
          driverId,
          incentiveId,
        },
      },
    });

    if (!progress) {
      throw new Error("Incentive progress not found");
    }

    return this.mapProgress(progress);
  }

  // -----------------------------------------
  // PROCESS TRIP FOR INCENTIVES
  // -----------------------------------------

  async processTripForIncentives(
    driverId: string,
    trip: TripEarning
  ): Promise<IncentiveUpdate[]> {
    const updates: IncentiveUpdate[] = [];

    // Get active incentive progress
    const activeProgress = await this.db.driverIncentiveProgress.findMany({
      where: {
        driverId,
        status: IncentiveProgressStatus.ACTIVE,
        incentive: {
          isActive: true,
          endTime: { gt: new Date() },
        },
      },
      include: {
        incentive: true,
      },
    });

    for (const progress of activeProgress) {
      const incentive = progress.incentive;

      // Check if trip qualifies
      if (!this.tripQualifiesForIncentive(trip, incentive)) {
        continue;
      }

      // Update progress based on incentive type
      const update = await this.updateProgress(
        driverId,
        progress,
        trip,
        incentive
      );
      if (update) {
        updates.push(update);
      }
    }

    // Invalidate cache
    await this.invalidateCache(`incentives:${driverId}`);

    return updates;
  }

  private tripQualifiesForIncentive(
    trip: TripEarning,
    incentive: any
  ): boolean {
    const requirements: IncentiveRequirements = incentive.requirements;

    // Check trip type
    if (requirements.tripTypes && requirements.tripTypes.length > 0) {
      if (!requirements.tripTypes.includes(trip.tripType)) {
        return false;
      }
    }

    // Check area (if applicable)
    if (requirements.areas && requirements.areas.length > 0) {
      // Would check if trip is in specified H3 areas
      // Simplified for now
    }

    return true;
  }

  private async updateProgress(
    driverId: string,
    progress: any,
    trip: TripEarning,
    incentive: any
  ): Promise<IncentiveUpdate | null> {
    const previousValue = parseFloat(progress.currentValue);
    let incrementValue = 0;

    // Calculate increment based on incentive type
    switch (incentive.incentiveType as IncentiveType) {
      case IncentiveType.TRIP_COUNT:
      case IncentiveType.QUEST:
        incrementValue = 1;
        break;

      case IncentiveType.CONSECUTIVE_TRIPS:
        // Check if trip was accepted immediately
        if (trip.surgeMultiplier >= 1) {
          incrementValue = 1;
        } else {
          // Reset if declined
          await this.resetConsecutiveProgress(driverId, incentive.id);
          return null;
        }
        break;

      case IncentiveType.PEAK_HOUR:
        if (this.isDuringActiveHours(new Date(), incentive.activeHours)) {
          incrementValue = 1;
        }
        break;

      case IncentiveType.AREA_BONUS:
        // Area bonus is typically per-trip
        incrementValue = 1;
        break;

      case IncentiveType.RATING_BONUS:
        if (trip.rating === 5) {
          incrementValue = 1;
        }
        break;

      default:
        incrementValue = 1;
    }

    if (incrementValue === 0) return null;

    const newValue = previousValue + incrementValue;
    const rewardTiers: RewardTier[] = incentive.rewardTiers;

    // Check for tier completion
    let tierCompleted: number | undefined;
    let reward: RewardTier | undefined;

    for (const tier of rewardTiers) {
      if (previousValue < tier.threshold && newValue >= tier.threshold) {
        if (!progress.tiersCompleted.includes(tier.tier)) {
          tierCompleted = tier.tier;
          reward = tier;
          break;
        }
      }
    }

    // Update progress
    const updatedProgress = await this.db.driverIncentiveProgress.update({
      where: { id: progress.id },
      data: {
        currentValue: newValue,
        currentTier:
          tierCompleted !== undefined ? tierCompleted : progress.currentTier,
        tiersCompleted:
          tierCompleted !== undefined
            ? [...progress.tiersCompleted, tierCompleted]
            : progress.tiersCompleted,
        tripIds: [...progress.tripIds, trip.tripId],
        lastUpdated: new Date(),
      },
    });

    // Process reward if tier completed
    if (reward) {
      await this.awardReward(driverId, incentive, reward);

      // Check if all tiers completed
      const allTiersCompleted = rewardTiers.every((t) =>
        updatedProgress.tiersCompleted.includes(t.tier)
      );

      if (allTiersCompleted) {
        await this.db.driverIncentiveProgress.update({
          where: { id: progress.id },
          data: {
            status: IncentiveProgressStatus.COMPLETED,
            completedAt: new Date(),
          },
        });
      }
    }

    // Track progress
    this.trackEvent(driverId, DRIVER_EVENTS.INCENTIVE_PROGRESS, {
      incentiveId: incentive.id,
      incentiveType: incentive.incentiveType,
      previousValue,
      newValue,
      tierCompleted,
    });

    if (tierCompleted !== undefined) {
      this.trackEvent(driverId, DRIVER_EVENTS.INCENTIVE_COMPLETED, {
        incentiveId: incentive.id,
        tier: tierCompleted,
        reward: reward?.rewardValue,
      });
    }

    return {
      incentiveId: incentive.id,
      previousValue,
      newValue,
      tierCompleted,
      reward,
      tripId: trip.tripId,
    };
  }

  private async resetConsecutiveProgress(
    driverId: string,
    incentiveId: string
  ): Promise<void> {
    await this.db.driverIncentiveProgress.update({
      where: {
        driverId_incentiveId: { driverId, incentiveId },
      },
      data: {
        currentValue: 0,
        tripIds: [],
        lastUpdated: new Date(),
      },
    });
  }

  private async awardReward(
    driverId: string,
    incentive: any,
    tier: RewardTier
  ): Promise<void> {
    switch (tier.rewardType) {
      case "cash":
        await this.creditCashReward(driverId, tier.rewardValue);
        break;
      case "points":
        await this.creditPointsReward(driverId, tier.rewardValue);
        break;
      case "badge":
        await this.awardBadge(driverId, incentive.name);
        break;
      case "commission_reduction":
        await this.applyCommissionReduction(driverId, tier.rewardValue);
        break;
    }

    // Update spent budget
    if (tier.rewardType === "cash") {
      await this.db.incentive.update({
        where: { id: incentive.id },
        data: {
          spentBudget: {
            increment: tier.rewardValue,
          },
        },
      });
    }

    // Send notification
    await this.notificationService?.send({
      userId: driverId,
      title: "🎉 Reward Earned!",
      body: `You earned ${this.formatReward(tier)} from ${incentive.name}!`,
      data: {
        type: "incentive_reward",
        incentiveId: incentive.id,
        tier: tier.tier,
      },
    });
  }

  // -----------------------------------------
  // STREAKS
  // -----------------------------------------

  async getActiveStreaks(driverId: string): Promise<DriverStreak[]> {
    const streaks = await this.db.driverStreak.findMany({
      where: { driverId },
    });

    // Initialize missing streaks
    const allStreakTypes = Object.values(StreakType);
    const existingTypes = streaks.map((s: any) => s.streakType);
    const missingTypes = allStreakTypes.filter(
      (t) => !existingTypes.includes(t)
    );

    for (const type of missingTypes) {
      const newStreak = await this.db.driverStreak.create({
        data: {
          driverId,
          streakType: type,
          currentCount: 0,
          lastActivityAt: new Date(),
          bestCount: 0,
          nextMilestone: STREAK_MILESTONES[type][0]?.count || 1,
          milestonesHit: [],
        },
      });
      streaks.push(newStreak);
    }

    return streaks.map(this.mapStreak);
  }

  async updateStreak(
    driverId: string,
    streakType: StreakType
  ): Promise<DriverStreak> {
    let streak = await this.db.driverStreak.findUnique({
      where: {
        driverId_streakType: { driverId, streakType },
      },
    });

    if (!streak) {
      streak = await this.db.driverStreak.create({
        data: {
          driverId,
          streakType,
          currentCount: 0,
          lastActivityAt: new Date(),
          bestCount: 0,
          nextMilestone: STREAK_MILESTONES[streakType][0]?.count || 1,
          milestonesHit: [],
        },
      });
    }

    const now = new Date();
    const lastActivity = new Date(streak.lastActivityAt);
    const hoursSinceActivity =
      (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60);

    // Determine streak validity window
    let streakValid = false;
    switch (streakType) {
      case StreakType.DAILY_ACTIVE:
      case StreakType.DAILY_TRIPS:
        // Valid if last activity was within 24-48 hours
        streakValid = hoursSinceActivity <= 48;
        break;
      case StreakType.FIVE_STAR:
      case StreakType.ACCEPTANCE:
      case StreakType.COMPLETION:
        // These are continuous streaks
        streakValid = true;
        break;
    }

    let newCount: number;
    if (streakValid) {
      // Check if already counted today for daily streaks
      if (
        streakType === StreakType.DAILY_ACTIVE ||
        streakType === StreakType.DAILY_TRIPS
      ) {
        const isSameDay = lastActivity.toDateString() === now.toDateString();
        newCount = isSameDay ? streak.currentCount : streak.currentCount + 1;
      } else {
        newCount = streak.currentCount + 1;
      }
    } else {
      // Streak broken
      newCount = 1;

      this.trackEvent(driverId, DRIVER_EVENTS.STREAK_BROKEN, {
        streakType,
        previousCount: streak.currentCount,
      });
    }

    // Check for milestone
    const milestones = STREAK_MILESTONES[streakType];
    let milestoneHit: StreakMilestone | undefined;

    for (const milestone of milestones) {
      if (
        newCount >= milestone.count &&
        !streak.milestonesHit.includes(milestone.count)
      ) {
        milestoneHit = milestone;
        break;
      }
    }

    // Update streak
    const updatedStreak = await this.db.driverStreak.update({
      where: { id: streak.id },
      data: {
        currentCount: newCount,
        lastActivityAt: now,
        bestCount: Math.max(streak.bestCount, newCount),
        bestStartDate:
          newCount > streak.bestCount
            ? streak.bestStartDate || now
            : streak.bestStartDate,
        bestEndDate: newCount > streak.bestCount ? now : streak.bestEndDate,
        nextMilestone: this.getNextMilestone(newCount, milestones),
        milestonesHit: milestoneHit
          ? [...streak.milestonesHit, milestoneHit.count]
          : streak.milestonesHit,
      },
    });

    // Award milestone reward
    if (milestoneHit) {
      await this.awardStreakMilestone(driverId, streakType, milestoneHit);

      this.trackEvent(driverId, DRIVER_EVENTS.STREAK_MAINTAINED, {
        streakType,
        count: newCount,
        milestoneHit: milestoneHit.count,
      });
    }

    return this.mapStreak(updatedStreak);
  }

  private getNextMilestone(
    currentCount: number,
    milestones: StreakMilestone[]
  ): number {
    for (const milestone of milestones) {
      if (milestone.count > currentCount) {
        return milestone.count;
      }
    }
    return milestones[milestones.length - 1]?.count || currentCount + 1;
  }

  private async awardStreakMilestone(
    driverId: string,
    streakType: StreakType,
    milestone: StreakMilestone
  ): Promise<void> {
    switch (milestone.reward.type) {
      case "cash":
        await this.creditCashReward(driverId, milestone.reward.value);
        break;
      case "points":
        await this.creditPointsReward(driverId, milestone.reward.value);
        break;
      case "badge":
        await this.awardBadge(driverId, milestone.reward.description);
        break;
    }

    await this.notificationService?.send({
      userId: driverId,
      title: "🔥 Streak Milestone!",
      body: `${milestone.count}-day ${this.getStreakName(streakType)} streak! ${milestone.reward.description}`,
      data: {
        type: "streak_milestone",
        streakType,
        count: milestone.count,
      },
    });
  }

  private getStreakName(type: StreakType): string {
    const names: Record<StreakType, string> = {
      [StreakType.DAILY_ACTIVE]: "daily active",
      [StreakType.DAILY_TRIPS]: "trip",
      [StreakType.FIVE_STAR]: "five-star",
      [StreakType.ACCEPTANCE]: "acceptance",
      [StreakType.COMPLETION]: "completion",
    };
    return names[type];
  }

  // -----------------------------------------
  // TRIP HANDLERS FOR STREAKS
  // -----------------------------------------

  async handleTripForStreaks(
    driverId: string,
    trip: TripEarning
  ): Promise<void> {
    // Daily trips streak
    await this.updateStreak(driverId, StreakType.DAILY_TRIPS);
    await this.updateStreak(driverId, StreakType.DAILY_ACTIVE);
    await this.updateStreak(driverId, StreakType.COMPLETION);

    // Five-star streak
    if (trip.rating === 5) {
      await this.updateStreak(driverId, StreakType.FIVE_STAR);
    } else if (trip.rating && trip.rating < 5) {
      // Break five-star streak
      await this.resetStreak(driverId, StreakType.FIVE_STAR);
    }
  }

  async handleTripAccepted(driverId: string): Promise<void> {
    await this.updateStreak(driverId, StreakType.ACCEPTANCE);
  }

  async handleTripDeclined(driverId: string): Promise<void> {
    await this.resetStreak(driverId, StreakType.ACCEPTANCE);
  }

  private async resetStreak(
    driverId: string,
    streakType: StreakType
  ): Promise<void> {
    const streak = await this.db.driverStreak.findUnique({
      where: {
        driverId_streakType: { driverId, streakType },
      },
    });

    if (streak && streak.currentCount > 0) {
      this.trackEvent(driverId, DRIVER_EVENTS.STREAK_BROKEN, {
        streakType,
        previousCount: streak.currentCount,
      });

      await this.db.driverStreak.update({
        where: { id: streak.id },
        data: {
          currentCount: 0,
          lastActivityAt: new Date(),
        },
      });
    }
  }

  // -----------------------------------------
  // CREATE INCENTIVE
  // -----------------------------------------

  async createIncentive(input: CreateIncentiveInput): Promise<Incentive> {
    const incentive = await this.db.incentive.create({
      data: {
        name: input.name,
        description: input.description,
        incentiveType: input.incentiveType,
        targetCities: input.targetCities || [],
        targetTiers: input.targetTiers || [],
        targetVehicles: input.targetVehicles || [],
        maxParticipants: input.maxParticipants,
        startTime: input.startTime,
        endTime: input.endTime,
        activeHours: input.activeHours,
        activeDays: input.activeDays || [0, 1, 2, 3, 4, 5, 6],
        requirements: input.requirements,
        rewardTiers: input.rewardTiers,
        totalBudget: input.totalBudget,
        spentBudget: 0,
        isActive: true,
      },
    });

    return this.mapIncentive(incentive);
  }

  // -----------------------------------------
  // HELPER METHODS
  // -----------------------------------------

  private async getDriverProfile(
    driverId: string
  ): Promise<DriverProfileForIncentive> {
    const profile = await this.db.driverProfile.findUnique({
      where: { driverId },
      include: {
        certifications: true,
      },
    });

    const driver = await this.db.driver.findUnique({
      where: { id: driverId },
      select: {
        city: true,
        vehicleType: true,
      },
    });

    return {
      driverId,
      tier: profile?.currentTier || "STARTER",
      lifetimeTrips: profile?.lifetimeTrips || 0,
      lifetimeRating: parseFloat(profile?.lifetimeRating) || 5,
      city: driver?.city || "lagos",
      vehicleType: driver?.vehicleType || "SEDAN",
      certifications:
        profile?.certifications?.map((c: any) => c.certificationCode) || [],
    };
  }

  private checkEligibility(
    driver: DriverProfileForIncentive,
    incentive: any
  ): { eligible: boolean; reason?: string } {
    // Check tier
    if (
      incentive.targetTiers.length > 0 &&
      !incentive.targetTiers.includes(driver.tier)
    ) {
      return { eligible: false, reason: "Tier not eligible" };
    }

    // Check vehicle
    if (
      incentive.targetVehicles.length > 0 &&
      !incentive.targetVehicles.includes(driver.vehicleType)
    ) {
      return { eligible: false, reason: "Vehicle type not eligible" };
    }

    // Check requirements
    const requirements: IncentiveRequirements = incentive.requirements;

    if (
      requirements.minRating &&
      driver.lifetimeRating < requirements.minRating
    ) {
      return {
        eligible: false,
        reason: `Minimum rating ${requirements.minRating} required`,
      };
    }

    // Check max participants
    if (incentive.maxParticipants) {
      // Would need to count current participants
    }

    return { eligible: true };
  }

  private async createProgress(
    driverId: string,
    incentiveId: string
  ): Promise<any> {
    return this.db.driverIncentiveProgress.create({
      data: {
        driverId,
        incentiveId,
        currentValue: 0,
        currentTier: 0,
        tiersCompleted: [],
        totalEarned: 0,
        pendingPayout: 0,
        status: IncentiveProgressStatus.ACTIVE,
        tripIds: [],
      },
    });
  }

  private mapToDriverIncentive(
    incentive: any,
    progress: any,
    _driver: DriverProfileForIncentive
  ): DriverIncentive {
    const rewardTiers: RewardTier[] = incentive.rewardTiers;
    const currentValue = parseFloat(progress.currentValue);

    // Calculate potential earnings
    const potentialEarnings = rewardTiers.reduce((total, tier) => {
      if (
        !progress.tiersCompleted.includes(tier.tier) &&
        tier.rewardType === "cash"
      ) {
        return total + tier.rewardValue;
      }
      return total;
    }, 0);

    // Find current and next tier rewards
    let currentTierReward: number | undefined;
    let nextTierReward: number | undefined;

    for (const tier of rewardTiers) {
      if (currentValue >= tier.threshold && tier.rewardType === "cash") {
        currentTierReward = tier.rewardValue;
      } else if (
        currentValue < tier.threshold &&
        !nextTierReward &&
        tier.rewardType === "cash"
      ) {
        nextTierReward = tier.rewardValue;
      }
    }

    return {
      id: incentive.id,
      name: incentive.name,
      description: incentive.description,
      incentiveType: incentive.incentiveType as IncentiveType,
      targetCities: incentive.targetCities,
      targetTiers: incentive.targetTiers,
      targetVehicles: incentive.targetVehicles,
      maxParticipants: incentive.maxParticipants,
      startTime: incentive.startTime,
      endTime: incentive.endTime,
      activeHours: incentive.activeHours,
      activeDays: incentive.activeDays,
      requirements: incentive.requirements,
      rewardTiers,
      totalBudget: incentive.totalBudget
        ? parseFloat(incentive.totalBudget)
        : undefined,
      spentBudget: parseFloat(incentive.spentBudget),
      isActive: incentive.isActive,
      progress: this.mapProgress(progress),
      potentialEarnings,
      timeRemaining: incentive.endTime.getTime() - Date.now(),
      isEligible: true,
      currentTierReward,
      nextTierReward,
    };
  }

  private mapIncentive(incentive: any): Incentive {
    return {
      id: incentive.id,
      name: incentive.name,
      description: incentive.description,
      incentiveType: incentive.incentiveType as IncentiveType,
      targetCities: incentive.targetCities,
      targetTiers: incentive.targetTiers,
      targetVehicles: incentive.targetVehicles,
      maxParticipants: incentive.maxParticipants,
      startTime: incentive.startTime,
      endTime: incentive.endTime,
      activeHours: incentive.activeHours,
      activeDays: incentive.activeDays,
      requirements: incentive.requirements,
      rewardTiers: incentive.rewardTiers,
      totalBudget: incentive.totalBudget
        ? parseFloat(incentive.totalBudget)
        : undefined,
      spentBudget: parseFloat(incentive.spentBudget),
      isActive: incentive.isActive,
    };
  }

  private mapProgress(progress: any): DriverIncentiveProgress {
    return {
      id: progress.id,
      driverId: progress.driverId,
      incentiveId: progress.incentiveId,
      currentValue: parseFloat(progress.currentValue),
      currentTier: progress.currentTier,
      tiersCompleted: progress.tiersCompleted,
      totalEarned: parseFloat(progress.totalEarned),
      pendingPayout: parseFloat(progress.pendingPayout),
      status: progress.status as IncentiveProgressStatus,
      tripIds: progress.tripIds,
    };
  }

  private mapStreak(streak: any): DriverStreak {
    return {
      id: streak.id,
      driverId: streak.driverId,
      streakType: streak.streakType as StreakType,
      currentCount: streak.currentCount,
      lastActivityAt: streak.lastActivityAt,
      bestCount: streak.bestCount,
      bestStartDate: streak.bestStartDate,
      bestEndDate: streak.bestEndDate,
      nextMilestone: streak.nextMilestone,
      milestonesHit: streak.milestonesHit,
    };
  }

  private isDuringActiveHours(time: Date, activeHours: any): boolean {
    if (!activeHours) return true;

    const hour = time.getHours();
    const minute = time.getMinutes();
    const currentTime = hour * 60 + minute;

    const [startHour, startMin] = activeHours.start.split(":").map(Number);
    const [endHour, endMin] = activeHours.end.split(":").map(Number);

    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;

    return currentTime >= startTime && currentTime <= endTime;
  }

  private formatReward(tier: RewardTier): string {
    switch (tier.rewardType) {
      case "cash":
        return `₦${tier.rewardValue.toLocaleString()}`;
      case "points":
        return `${tier.rewardValue} points`;
      case "badge":
        return "a new badge";
      case "commission_reduction":
        return `${tier.rewardValue}% commission reduction`;
      default:
        return tier.description;
    }
  }

  private async creditCashReward(
    driverId: string,
    amount: number
  ): Promise<void> {
    // Credit to driver wallet
    console.log(`Crediting ₦${amount} to driver ${driverId}`);
  }

  private async creditPointsReward(
    driverId: string,
    points: number
  ): Promise<void> {
    // Credit points
    console.log(`Crediting ${points} points to driver ${driverId}`);
  }

  private async awardBadge(driverId: string, badgeName: string): Promise<void> {
    // Award badge
    console.log(`Awarding badge "${badgeName}" to driver ${driverId}`);
  }

  private async applyCommissionReduction(
    driverId: string,
    reduction: number
  ): Promise<void> {
    // Apply commission reduction
    console.log(
      `Applying ${reduction}% commission reduction to driver ${driverId}`
    );
  }

  // Cache methods
  private async getCached<T>(key: string): Promise<T | null> {
    const cached = this.cache.get(key);
    if (cached && cached.expiry > Date.now()) {
      return cached.data as T;
    }
    return null;
  }

  private async setCache(
    key: string,
    data: unknown,
    ttl: number
  ): Promise<void> {
    this.cache.set(key, { data, expiry: Date.now() + ttl });
  }

  private async invalidateCache(key: string): Promise<void> {
    this.cache.delete(key);
  }

  private trackEvent(
    driverId: string,
    eventName: string,
    properties: Record<string, unknown>
  ): void {
    this.analyticsService?.track({
      userId: driverId,
      event: eventName,
      properties: {
        ...properties,
        timestamp: new Date().toISOString(),
      },
    });
  }

  // Event handlers
  onRewardEarned(handler: (data: RewardEarnedEvent) => void): void {
    this.eventEmitter.on("reward:earned", handler);
  }
}

// -----------------------------------------
// SUPPORTING TYPES
// -----------------------------------------

interface DriverProfileForIncentive {
  driverId: string;
  tier: string;
  lifetimeTrips: number;
  lifetimeRating: number;
  city: string;
  vehicleType: string;
  certifications: string[];
}

interface CreateIncentiveInput {
  name: string;
  description: string;
  incentiveType: IncentiveType;
  targetCities?: string[];
  targetTiers?: string[];
  targetVehicles?: string[];
  maxParticipants?: number;
  startTime: Date;
  endTime: Date;
  activeHours?: { start: string; end: string; timezone: string };
  activeDays?: number[];
  requirements: IncentiveRequirements;
  rewardTiers: RewardTier[];
  totalBudget?: number;
}

interface RewardEarnedEvent {
  driverId: string;
  incentiveId: string;
  tier: number;
  reward: RewardTier;
}
