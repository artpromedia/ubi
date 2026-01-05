/**
 * UBI Rewards - Challenges Service
 *
 * Manages daily, weekly, and special challenges that drive engagement
 *
 * Challenge Types:
 * - DAILY: Reset every day, quick wins (e.g., "Morning Commuter")
 * - WEEKLY: Longer-term goals (e.g., "Road Warrior - 10 rides")
 * - MONTHLY: Ambitious targets with big rewards
 * - SPECIAL: Limited-time seasonal/promotional challenges
 * - TEAM: Group challenges for social engagement
 */

import { prisma } from "../lib/prisma";
import {
  Challenge,
  GameEvent,
  LoyaltyTier,
  UserChallenge,
} from "../types/loyalty.types";

// ============================================================================
// CHALLENGE DEFINITIONS
// ============================================================================

interface ChallengeDefinition {
  id: string;
  name: string;
  description: string;
  type: "DAILY" | "WEEKLY" | "MONTHLY" | "SPECIAL" | "SEASONAL";
  category:
    | "RIDES"
    | "FOOD"
    | "DELIVERY"
    | "ENGAGEMENT"
    | "SOCIAL"
    | "MULTI_SERVICE"
    | "SAVINGS";
  targetType: string;
  targetValue: number;
  pointsReward: number;
  bonusReward?: {
    type: "FREE_RIDE" | "FREE_DELIVERY" | "DISCOUNT" | "BADGE" | "MULTIPLIER";
    value: string;
  };
  minTier?: LoyaltyTier;
  isRepeatable: boolean;
  cooldownDays?: number;
  expiresInDays: number;
  iconUrl?: string;
  difficulty: "EASY" | "MEDIUM" | "HARD" | "EXPERT";
}

// Daily Challenges - Quick wins to start the day
const DAILY_CHALLENGES: ChallengeDefinition[] = [
  {
    id: "daily_morning_commute",
    name: "Morning Commuter",
    description: "Complete a ride before 9 AM",
    type: "DAILY",
    category: "RIDES",
    targetType: "RIDE_BEFORE_TIME",
    targetValue: 9, // 9 AM
    pointsReward: 100,
    isRepeatable: true,
    expiresInDays: 1,
    difficulty: "EASY",
  },
  {
    id: "daily_night_owl",
    name: "Night Owl",
    description: "Order food after 10 PM",
    type: "DAILY",
    category: "FOOD",
    targetType: "FOOD_AFTER_TIME",
    targetValue: 22, // 10 PM
    pointsReward: 100,
    isRepeatable: true,
    expiresInDays: 1,
    difficulty: "EASY",
  },
  {
    id: "daily_double_up",
    name: "Double Up",
    description: "Use 2 different UBI services today",
    type: "DAILY",
    category: "MULTI_SERVICE",
    targetType: "UNIQUE_SERVICES",
    targetValue: 2,
    pointsReward: 200,
    isRepeatable: true,
    expiresInDays: 1,
    difficulty: "MEDIUM",
  },
  {
    id: "daily_try_new",
    name: "Try Something New",
    description: "Order from a restaurant you've never tried",
    type: "DAILY",
    category: "FOOD",
    targetType: "NEW_RESTAURANT",
    targetValue: 1,
    pointsReward: 150,
    bonusReward: { type: "DISCOUNT", value: "10%_NEXT_ORDER" },
    isRepeatable: true,
    expiresInDays: 1,
    difficulty: "MEDIUM",
  },
  {
    id: "daily_peak_avoider",
    name: "Peak Avoider",
    description: "Complete a ride outside surge hours (10AM-4PM)",
    type: "DAILY",
    category: "RIDES",
    targetType: "RIDE_OFF_PEAK",
    targetValue: 1,
    pointsReward: 75,
    isRepeatable: true,
    expiresInDays: 1,
    difficulty: "EASY",
  },
  {
    id: "daily_green_choice",
    name: "Green Choice",
    description: "Choose UbiGreen (eco-friendly) for your ride",
    type: "DAILY",
    category: "RIDES",
    targetType: "GREEN_RIDE",
    targetValue: 1,
    pointsReward: 125,
    isRepeatable: true,
    expiresInDays: 1,
    difficulty: "EASY",
  },
  {
    id: "daily_cashless",
    name: "Go Cashless",
    description: "Pay with UBI Wallet 3 times today",
    type: "DAILY",
    category: "ENGAGEMENT",
    targetType: "WALLET_PAYMENTS",
    targetValue: 3,
    pointsReward: 150,
    isRepeatable: true,
    expiresInDays: 1,
    difficulty: "MEDIUM",
  },
];

// Weekly Challenges - Bigger goals, bigger rewards
const WEEKLY_CHALLENGES: ChallengeDefinition[] = [
  {
    id: "weekly_road_warrior",
    name: "Road Warrior",
    description: "Complete 10 rides this week",
    type: "WEEKLY",
    category: "RIDES",
    targetType: "TOTAL_RIDES",
    targetValue: 10,
    pointsReward: 1000,
    bonusReward: { type: "FREE_RIDE", value: "1" },
    isRepeatable: true,
    expiresInDays: 7,
    difficulty: "MEDIUM",
  },
  {
    id: "weekly_foodie_explorer",
    name: "Foodie Explorer",
    description: "Order from 5 different restaurants",
    type: "WEEKLY",
    category: "FOOD",
    targetType: "UNIQUE_RESTAURANTS",
    targetValue: 5,
    pointsReward: 750,
    bonusReward: { type: "FREE_DELIVERY", value: "1" },
    isRepeatable: true,
    expiresInDays: 7,
    difficulty: "MEDIUM",
  },
  {
    id: "weekly_variety_pack",
    name: "Variety Pack",
    description: "Use Ride, Food, and Delivery services this week",
    type: "WEEKLY",
    category: "MULTI_SERVICE",
    targetType: "ALL_SERVICES",
    targetValue: 3,
    pointsReward: 1500,
    bonusReward: { type: "MULTIPLIER", value: "2x_24h" },
    isRepeatable: true,
    expiresInDays: 7,
    difficulty: "HARD",
  },
  {
    id: "weekly_early_bird",
    name: "Early Bird Week",
    description: "Complete 5 morning rides (before 9 AM)",
    type: "WEEKLY",
    category: "RIDES",
    targetType: "MORNING_RIDES",
    targetValue: 5,
    pointsReward: 800,
    isRepeatable: true,
    expiresInDays: 7,
    difficulty: "HARD",
  },
  {
    id: "weekly_big_spender",
    name: "Big Spender",
    description: "Spend ₦50,000 across all services",
    type: "WEEKLY",
    category: "ENGAGEMENT",
    targetType: "TOTAL_SPEND",
    targetValue: 50000,
    pointsReward: 2000,
    bonusReward: { type: "DISCOUNT", value: "15%_NEXT_ORDER" },
    minTier: "SILVER",
    isRepeatable: true,
    expiresInDays: 7,
    difficulty: "HARD",
  },
  {
    id: "weekly_social_butterfly",
    name: "Social Butterfly",
    description: "Share your ride ETA with 3 contacts",
    type: "WEEKLY",
    category: "SOCIAL",
    targetType: "SHARE_RIDES",
    targetValue: 3,
    pointsReward: 500,
    isRepeatable: true,
    expiresInDays: 7,
    difficulty: "EASY",
  },
  {
    id: "weekly_review_master",
    name: "Review Master",
    description: "Leave 5 ratings and reviews",
    type: "WEEKLY",
    category: "ENGAGEMENT",
    targetType: "REVIEWS",
    targetValue: 5,
    pointsReward: 400,
    isRepeatable: true,
    expiresInDays: 7,
    difficulty: "EASY",
  },
  {
    id: "weekly_delivery_pro",
    name: "Delivery Pro",
    description: "Send 5 packages via UBI Delivery",
    type: "WEEKLY",
    category: "DELIVERY",
    targetType: "TOTAL_DELIVERIES",
    targetValue: 5,
    pointsReward: 850,
    bonusReward: { type: "FREE_DELIVERY", value: "1" },
    isRepeatable: true,
    expiresInDays: 7,
    difficulty: "MEDIUM",
  },
];

// Monthly Challenges - Major goals with major rewards
const MONTHLY_CHALLENGES: ChallengeDefinition[] = [
  {
    id: "monthly_centurion",
    name: "Centurion",
    description: "Complete 100 transactions this month",
    type: "MONTHLY",
    category: "ENGAGEMENT",
    targetType: "TOTAL_TRANSACTIONS",
    targetValue: 100,
    pointsReward: 10000,
    bonusReward: { type: "BADGE", value: "centurion_badge" },
    minTier: "SILVER",
    isRepeatable: true,
    expiresInDays: 30,
    difficulty: "EXPERT",
  },
  {
    id: "monthly_super_saver",
    name: "Super Saver",
    description: "Save ₦20,000 in your UBI Savings Goal",
    type: "MONTHLY",
    category: "SAVINGS",
    targetType: "SAVINGS_AMOUNT",
    targetValue: 20000,
    pointsReward: 5000,
    bonusReward: { type: "MULTIPLIER", value: "1.5x_7d" },
    isRepeatable: true,
    expiresInDays: 30,
    difficulty: "HARD",
  },
  {
    id: "monthly_perfect_streak",
    name: "Perfect Month",
    description: "Maintain a 30-day activity streak",
    type: "MONTHLY",
    category: "ENGAGEMENT",
    targetType: "STREAK_DAYS",
    targetValue: 30,
    pointsReward: 8000,
    bonusReward: { type: "BADGE", value: "perfect_month" },
    isRepeatable: true,
    expiresInDays: 30,
    difficulty: "EXPERT",
  },
  {
    id: "monthly_referral_champ",
    name: "Referral Champion",
    description: "Successfully refer 5 new users",
    type: "MONTHLY",
    category: "SOCIAL",
    targetType: "SUCCESSFUL_REFERRALS",
    targetValue: 5,
    pointsReward: 15000,
    bonusReward: { type: "FREE_RIDE", value: "3" },
    isRepeatable: true,
    expiresInDays: 30,
    difficulty: "HARD",
  },
  {
    id: "monthly_platinum_path",
    name: "Path to Platinum",
    description: "Earn 15,000 points this month",
    type: "MONTHLY",
    category: "ENGAGEMENT",
    targetType: "POINTS_EARNED",
    targetValue: 15000,
    pointsReward: 5000,
    bonusReward: { type: "MULTIPLIER", value: "2x_3d" },
    minTier: "GOLD",
    isRepeatable: true,
    expiresInDays: 30,
    difficulty: "EXPERT",
  },
];

// Special/Seasonal Challenges
const SPECIAL_CHALLENGES: ChallengeDefinition[] = [
  {
    id: "special_independence_day",
    name: "Independence Day Special",
    description: "Celebrate with 10 rides in October",
    type: "SPECIAL",
    category: "RIDES",
    targetType: "TOTAL_RIDES",
    targetValue: 10,
    pointsReward: 2500,
    bonusReward: { type: "BADGE", value: "independence_2024" },
    isRepeatable: false,
    expiresInDays: 31,
    difficulty: "MEDIUM",
  },
  {
    id: "special_ramadan_feast",
    name: "Ramadan Feast",
    description: "Order iftar from 7 different restaurants",
    type: "SPECIAL",
    category: "FOOD",
    targetType: "UNIQUE_RESTAURANTS",
    targetValue: 7,
    pointsReward: 3000,
    bonusReward: { type: "FREE_DELIVERY", value: "3" },
    isRepeatable: false,
    expiresInDays: 30,
    difficulty: "MEDIUM",
  },
  {
    id: "special_new_year_start",
    name: "New Year, New Rides",
    description: "Complete 20 rides in January",
    type: "SPECIAL",
    category: "RIDES",
    targetType: "TOTAL_RIDES",
    targetValue: 20,
    pointsReward: 5000,
    bonusReward: { type: "BADGE", value: "new_year_2025" },
    isRepeatable: false,
    expiresInDays: 31,
    difficulty: "HARD",
  },
  {
    id: "special_valentine_share",
    name: "Valentine's Ride",
    description: "Share 5 rides with friends in February",
    type: "SPECIAL",
    category: "SOCIAL",
    targetType: "SHARED_RIDES",
    targetValue: 5,
    pointsReward: 2000,
    bonusReward: { type: "DISCOUNT", value: "50%_NEXT_RIDE" },
    isRepeatable: false,
    expiresInDays: 28,
    difficulty: "MEDIUM",
  },
];

// Combine all challenge definitions
const ALL_CHALLENGES: ChallengeDefinition[] = [
  ...DAILY_CHALLENGES,
  ...WEEKLY_CHALLENGES,
  ...MONTHLY_CHALLENGES,
  ...SPECIAL_CHALLENGES,
];

// ============================================================================
// CHALLENGES SERVICE
// ============================================================================

export class ChallengesService {
  // --------------------------------------------------------------------------
  // GET CHALLENGES
  // --------------------------------------------------------------------------

  /**
   * Get all available challenges for a user
   */
  async getAvailableChallenges(userId: string): Promise<{
    daily: Challenge[];
    weekly: Challenge[];
    monthly: Challenge[];
    special: Challenge[];
  }> {
    // Get user's tier
    const pointsAccount = await prisma.pointsAccount.findUnique({
      where: { userId },
    });
    const userTier = (pointsAccount?.tier as LoyaltyTier) || "GREEN";

    // Get user's active challenges
    const activeUserChallenges = await prisma.userChallenge.findMany({
      where: {
        userId,
        status: { in: ["ACTIVE", "COMPLETED"] },
      },
    });

    const activeChallengeIds = new Set(
      activeUserChallenges.map((uc: any) => uc.challengeId)
    );

    // Filter challenges by tier and not already active
    const availableChallenges = ALL_CHALLENGES.filter((challenge) => {
      // Check tier requirement
      if (challenge.minTier) {
        const tierOrder = ["GREEN", "SILVER", "GOLD", "PLATINUM"];
        if (
          tierOrder.indexOf(userTier) < tierOrder.indexOf(challenge.minTier)
        ) {
          return false;
        }
      }

      // Check if already active (unless repeatable and completed)
      if (activeChallengeIds.has(challenge.id) && !challenge.isRepeatable) {
        return false;
      }

      return true;
    });

    // Convert to Challenge format
    const convertChallenge = (def: ChallengeDefinition): Challenge => ({
      id: def.id,
      slug: def.id,
      name: def.name,
      description: def.description,
      icon: def.iconUrl,
      type: def.type,
      criteria: { event: def.targetType, count: def.targetValue },
      targetValue: def.targetValue,
      reward: { points: def.pointsReward },
      startsAt: new Date(),
      endsAt: new Date(Date.now() + def.expiresInDays * 24 * 60 * 60 * 1000),
      targetTiers: def.minTier ? [def.minTier] : undefined,
      currentParticipants: 0,
      isActive: true,
    });

    return {
      daily: availableChallenges
        .filter((c) => c.type === "DAILY")
        .map(convertChallenge),
      weekly: availableChallenges
        .filter((c) => c.type === "WEEKLY")
        .map(convertChallenge),
      monthly: availableChallenges
        .filter((c) => c.type === "MONTHLY")
        .map(convertChallenge),
      special: availableChallenges
        .filter((c) => c.type === "SPECIAL")
        .map(convertChallenge),
    };
  }

  /**
   * Get user's active challenges
   */
  async getUserChallenges(
    userId: string,
    status?: "ACTIVE" | "COMPLETED" | "EXPIRED" | "CLAIMED"
  ): Promise<UserChallenge[]> {
    const where: any = { userId };
    if (status) {
      where.status = status;
    }

    const userChallenges = await prisma.userChallenge.findMany({
      where,
      include: { challenge: true },
      orderBy: [{ status: "asc" }, { expiresAt: "asc" }],
    });

    return userChallenges.map((uc: any) => this.mapUserChallenge(uc));
  }

  /**
   * Get daily challenges for today
   */
  async getDailyChallenges(userId: string): Promise<{
    available: Challenge[];
    active: UserChallenge[];
    completed: UserChallenge[];
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get user's daily challenges for today
    const userDailyChallenges = await prisma.userChallenge.findMany({
      where: {
        userId,
        challenge: { type: "DAILY" },
        joinedAt: { gte: today },
      },
      include: { challenge: true },
    });

    const activeChallengeIds = new Set(
      userDailyChallenges.map((uc: any) => uc.challengeId)
    );

    // Get available daily challenges not yet joined
    const availableDailies = DAILY_CHALLENGES.filter(
      (c) => !activeChallengeIds.has(c.id)
    ).map(
      (def) =>
        ({
          id: def.id,
          slug: def.id,
          name: def.name,
          description: def.description,
          icon: def.iconUrl,
          type: def.type,
          criteria: { event: def.targetType, count: def.targetValue },
          targetValue: def.targetValue,
          reward: { points: def.pointsReward },
          startsAt: today,
          endsAt: tomorrow,
          currentParticipants: 0,
          isActive: true,
        }) as Challenge
    );

    return {
      available: availableDailies,
      active: userDailyChallenges
        .filter((uc: any) => uc.status === "ACTIVE")
        .map((uc: any) => this.mapUserChallenge(uc)),
      completed: userDailyChallenges
        .filter((uc: any) => uc.status === "COMPLETED" || uc.status === "CLAIMED")
        .map((uc: any) => this.mapUserChallenge(uc)),
    };
  }

  /**
   * Get weekly challenges
   */
  async getWeeklyChallenges(userId: string): Promise<{
    available: Challenge[];
    active: UserChallenge[];
    completed: UserChallenge[];
  }> {
    // Get start of current week (Monday)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);

    // Get user's weekly challenges
    const userWeeklyChallenges = await prisma.userChallenge.findMany({
      where: {
        userId,
        challenge: { type: "WEEKLY" },
        joinedAt: { gte: startOfWeek },
      },
      include: { challenge: true },
    });

    const activeChallengeIds = new Set(
      userWeeklyChallenges.map((uc: any) => uc.challengeId)
    );

    // Get available weekly challenges
    const availableWeeklies = WEEKLY_CHALLENGES.filter(
      (c) => !activeChallengeIds.has(c.id)
    ).map(
      (def) =>
        ({
          id: def.id,
          slug: def.id,
          name: def.name,
          description: def.description,
          icon: def.iconUrl,
          type: def.type,
          criteria: { event: def.targetType, count: def.targetValue },
          targetValue: def.targetValue,
          reward: { points: def.pointsReward },
          startsAt: startOfWeek,
          endsAt: endOfWeek,
          targetTiers: def.minTier ? [def.minTier] : undefined,
          currentParticipants: 0,
          isActive: true,
        }) as Challenge
    );

    return {
      available: availableWeeklies,
      active: userWeeklyChallenges
        .filter((uc: any) => uc.status === "ACTIVE")
        .map((uc: any) => this.mapUserChallenge(uc)),
      completed: userWeeklyChallenges
        .filter((uc: any) => uc.status === "COMPLETED" || uc.status === "CLAIMED")
        .map((uc: any) => this.mapUserChallenge(uc)),
    };
  }

  // --------------------------------------------------------------------------
  // JOIN & PROGRESS
  // --------------------------------------------------------------------------

  /**
   * Join a challenge
   */
  async joinChallenge(
    userId: string,
    challengeId: string
  ): Promise<UserChallenge> {
    // Find challenge definition
    const challengeDef = ALL_CHALLENGES.find((c) => c.id === challengeId);
    if (!challengeDef) {
      throw new Error("Challenge not found");
    }

    // Check if user meets tier requirement
    const pointsAccount = await prisma.pointsAccount.findUnique({
      where: { userId },
    });
    const userTier = (pointsAccount?.tier as LoyaltyTier) || "GREEN";

    if (challengeDef.minTier) {
      const tierOrder = ["GREEN", "SILVER", "GOLD", "PLATINUM"];
      if (
        tierOrder.indexOf(userTier) < tierOrder.indexOf(challengeDef.minTier)
      ) {
        throw new Error(
          `This challenge requires ${challengeDef.minTier} tier or higher`
        );
      }
    }

    // Check if already active
    const existing = await prisma.userChallenge.findFirst({
      where: {
        userId,
        challengeId,
        status: "ACTIVE",
      },
    });

    if (existing) {
      throw new Error("Challenge already active");
    }

    // Create or get challenge record
    let challenge = await prisma.challenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      const now = new Date();
      challenge = await prisma.challenge.create({
        data: {
          id: challengeId,
          name: challengeDef.name,
          description: challengeDef.description,
          type: challengeDef.type,
          category: challengeDef.category,
          targetType: challengeDef.targetType,
          targetValue: challengeDef.targetValue,
          pointsReward: challengeDef.pointsReward,
          bonusReward: challengeDef.bonusReward as any,
          minTier: challengeDef.minTier,
          difficulty: challengeDef.difficulty,
          startDate: now,
          endDate: new Date(
            now.getTime() + challengeDef.expiresInDays * 24 * 60 * 60 * 1000
          ),
          isActive: true,
        },
      });
    }

    // Create user challenge
    const now = new Date();
    const userChallenge = await prisma.userChallenge.create({
      data: {
        userId,
        challengeId,
        status: "ACTIVE",
        progress: 0,
        targetValue: challengeDef.targetValue,
        progressData: {},
        joinedAt: now,
        expiresAt: new Date(
          now.getTime() + challengeDef.expiresInDays * 24 * 60 * 60 * 1000
        ),
      },
      include: { challenge: true },
    });

    return this.mapUserChallenge(userChallenge);
  }

  /**
   * Process a game event for challenge progress
   */
  async processEvent(
    userId: string,
    event: GameEvent
  ): Promise<{
    updatedChallenges: UserChallenge[];
    completedChallenges: UserChallenge[];
  }> {
    // Get user's active challenges
    const activeChallenges = await prisma.userChallenge.findMany({
      where: {
        userId,
        status: "ACTIVE",
        expiresAt: { gt: new Date() },
      },
      include: { challenge: true },
    });

    const updatedChallenges: UserChallenge[] = [];
    const completedChallenges: UserChallenge[] = [];

    for (const userChallenge of activeChallenges) {
      const challenge = userChallenge.challenge;
      const progressData = (userChallenge.progressData as any) || {};
      let newProgress = userChallenge.progress;
      let shouldUpdate = false;

      // Match event to challenge target type
      switch (challenge.targetType) {
        case "TOTAL_RIDES":
          if (event.type === "RIDE_COMPLETED") {
            newProgress = userChallenge.progress + 1;
            shouldUpdate = true;
          }
          break;

        case "RIDE_BEFORE_TIME":
          if (event.type === "RIDE_COMPLETED") {
            const hour = new Date(event.timestamp).getHours();
            if (hour < challenge.targetValue) {
              newProgress = userChallenge.progress + 1;
              shouldUpdate = true;
            }
          }
          break;

        case "MORNING_RIDES":
          if (event.type === "RIDE_COMPLETED") {
            const hour = new Date(event.timestamp).getHours();
            if (hour < 9) {
              newProgress = userChallenge.progress + 1;
              shouldUpdate = true;
            }
          }
          break;

        case "RIDE_OFF_PEAK":
          if (event.type === "RIDE_COMPLETED") {
            const hour = new Date(event.timestamp).getHours();
            if (hour >= 10 && hour <= 16) {
              newProgress = userChallenge.progress + 1;
              shouldUpdate = true;
            }
          }
          break;

        case "GREEN_RIDE":
          if (
            event.type === "RIDE_COMPLETED" &&
            event.data?.rideType === "UBI_GREEN"
          ) {
            newProgress = userChallenge.progress + 1;
            shouldUpdate = true;
          }
          break;

        case "FOOD_AFTER_TIME":
          if (event.type === "FOOD_ORDERED") {
            const hour = new Date(event.timestamp).getHours();
            if (hour >= challenge.targetValue) {
              newProgress = userChallenge.progress + 1;
              shouldUpdate = true;
            }
          }
          break;

        case "UNIQUE_RESTAURANTS":
          if (event.type === "FOOD_ORDERED") {
            const restaurantId = event.data?.restaurantId;
            if (restaurantId) {
              const restaurants = progressData.restaurants || [];
              if (!restaurants.includes(restaurantId)) {
                restaurants.push(restaurantId);
                progressData.restaurants = restaurants;
                newProgress = restaurants.length;
                shouldUpdate = true;
              }
            }
          }
          break;

        case "NEW_RESTAURANT":
          if (
            event.type === "FOOD_ORDERED" &&
            event.data?.isNewRestaurant
          ) {
            newProgress = userChallenge.progress + 1;
            shouldUpdate = true;
          }
          break;

        case "UNIQUE_SERVICES":
        case "ALL_SERVICES":
          const services = progressData.services || [];
          let serviceType: string | null = null;

          if (event.type === "RIDE_COMPLETED") serviceType = "RIDE";
          else if (event.type === "FOOD_ORDERED") serviceType = "FOOD";
          else if (event.type === "DELIVERY_COMPLETED")
            serviceType = "DELIVERY";

          if (serviceType && !services.includes(serviceType)) {
            services.push(serviceType);
            progressData.services = services;
            newProgress = services.length;
            shouldUpdate = true;
          }
          break;

        case "TOTAL_DELIVERIES":
          if (event.type === "DELIVERY_COMPLETED") {
            newProgress = userChallenge.progress + 1;
            shouldUpdate = true;
          }
          break;

        case "WALLET_PAYMENTS":
          if (
            event.type === "PAYMENT_MADE" &&
            event.data?.method === "WALLET"
          ) {
            newProgress = userChallenge.progress + 1;
            shouldUpdate = true;
          }
          break;

        case "TOTAL_SPEND":
          if (
            ["RIDE_COMPLETED", "FOOD_ORDERED", "DELIVERY_COMPLETED"].includes(
              event.type
            )
          ) {
            const amount = Number(event.data?.amount || 0);
            newProgress = userChallenge.progress + amount;
            shouldUpdate = true;
          }
          break;

        case "SHARE_RIDES":
        case "SHARED_RIDES":
          if (event.type === "RIDE_SHARED") {
            newProgress = userChallenge.progress + 1;
            shouldUpdate = true;
          }
          break;

        case "REVIEWS":
          if (event.type === "REVIEW_SUBMITTED") {
            newProgress = userChallenge.progress + 1;
            shouldUpdate = true;
          }
          break;

        case "TOTAL_TRANSACTIONS":
          if (
            [
              "RIDE_COMPLETED",
              "FOOD_ORDERED",
              "DELIVERY_COMPLETED",
              "PAYMENT_MADE",
            ].includes(event.type)
          ) {
            newProgress = userChallenge.progress + 1;
            shouldUpdate = true;
          }
          break;

        case "SAVINGS_AMOUNT":
          if (event.type === "SAVINGS_DEPOSIT") {
            const amount = Number(event.data?.amount || 0);
            newProgress = userChallenge.progress + amount;
            shouldUpdate = true;
          }
          break;

        case "STREAK_DAYS":
          if (event.type === "STREAK_UPDATED") {
            newProgress = Number(event.data?.streakDays || 0);
            shouldUpdate = true;
          }
          break;

        case "SUCCESSFUL_REFERRALS":
          if (event.type === "REFERRAL_COMPLETED") {
            newProgress = userChallenge.progress + 1;
            shouldUpdate = true;
          }
          break;

        case "POINTS_EARNED":
          if (event.type === "POINTS_EARNED") {
            const points = Number(event.data?.points || 0);
            newProgress = userChallenge.progress + points;
            shouldUpdate = true;
          }
          break;
      }

      if (shouldUpdate) {
        const isCompleted = newProgress >= challenge.targetValue;

        const updated = await prisma.userChallenge.update({
          where: { id: userChallenge.id },
          data: {
            progress: newProgress,
            progressData,
            status: isCompleted ? "COMPLETED" : "ACTIVE",
            completedAt: isCompleted ? new Date() : null,
          },
          include: { challenge: true },
        });

        const mappedChallenge = this.mapUserChallenge(updated);
        updatedChallenges.push(mappedChallenge);

        if (isCompleted) {
          completedChallenges.push(mappedChallenge);
        }
      }
    }

    return { updatedChallenges, completedChallenges };
  }

  /**
   * Claim reward for completed challenge
   */
  async claimReward(
    userId: string,
    userChallengeId: string
  ): Promise<{
    success: boolean;
    pointsAwarded: number;
    bonusReward?: { type: string; value: string };
  }> {
    const userChallenge = await prisma.userChallenge.findFirst({
      where: {
        id: userChallengeId,
        userId,
        status: "COMPLETED",
      },
      include: { challenge: true },
    });

    if (!userChallenge) {
      throw new Error("Completed challenge not found or already claimed");
    }

    // Award points
    const pointsAccount = await prisma.pointsAccount.findUnique({
      where: { userId },
    });

    if (!pointsAccount) {
      throw new Error("Points account not found");
    }

    const challenge = userChallenge.challenge;
    const pointsAwarded = challenge.pointsReward;

    // Create points transaction
    await prisma.$transaction([
      prisma.pointsAccount.update({
        where: { userId },
        data: {
          totalEarned: { increment: pointsAwarded },
          currentBalance: { increment: pointsAwarded },
        },
      }),
      prisma.pointsTransaction.create({
        data: {
          accountId: pointsAccount.id,
          type: "EARNED",
          amount: pointsAwarded,
          source: "CHALLENGE_BONUS",
          description: `Challenge completed: ${challenge.name}`,
          referenceId: userChallengeId,
          referenceType: "CHALLENGE",
        },
      }),
      prisma.pointsBatch.create({
        data: {
          accountId: pointsAccount.id,
          originalAmount: pointsAwarded,
          remainingAmount: pointsAwarded,
          earnedAt: new Date(),
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
        },
      }),
      prisma.userChallenge.update({
        where: { id: userChallengeId },
        data: {
          status: "CLAIMED",
          rewardClaimedAt: new Date(),
        },
      }),
    ]);

    return {
      success: true,
      pointsAwarded,
      bonusReward: challenge.bonusReward as any,
    };
  }

  // --------------------------------------------------------------------------
  // ADMIN & MANAGEMENT
  // --------------------------------------------------------------------------

  /**
   * Create a custom challenge (admin)
   */
  async createChallenge(params: {
    name: string;
    description: string;
    type: "DAILY" | "WEEKLY" | "MONTHLY" | "SPECIAL" | "SEASONAL";
    category: string;
    targetType: string;
    targetValue: number;
    pointsReward: number;
    bonusReward?: { type: string; value: string };
    startDate: Date;
    endDate: Date;
    minTier?: LoyaltyTier;
    maxParticipants?: number;
    difficulty: "EASY" | "MEDIUM" | "HARD" | "EXPERT";
  }): Promise<Challenge> {
    const challenge = await prisma.challenge.create({
      data: {
        name: params.name,
        description: params.description,
        type: params.type,
        category: params.category,
        targetType: params.targetType,
        targetValue: params.targetValue,
        pointsReward: params.pointsReward,
        bonusReward: params.bonusReward as any,
        startDate: params.startDate,
        endDate: params.endDate,
        minTier: params.minTier,
        maxParticipants: params.maxParticipants,
        difficulty: params.difficulty,
        isActive: true,
      },
    });

    return {
      id: challenge.id,
      slug: challenge.id,
      name: challenge.name,
      description: challenge.description,
      type: challenge.type as any,
      criteria: { event: challenge.targetType, count: challenge.targetValue },
      targetValue: challenge.targetValue,
      reward: { points: challenge.pointsReward },
      startsAt: challenge.startDate,
      endsAt: challenge.endDate,
      targetTiers: challenge.minTier ? [challenge.minTier as LoyaltyTier] : undefined,
      maxParticipants: challenge.maxParticipants || undefined,
      currentParticipants: 0,
      isActive: challenge.isActive,
    };
  }

  /**
   * Process expired challenges
   */
  async processExpiredChallenges(): Promise<number> {
    const result = await prisma.userChallenge.updateMany({
      where: {
        status: "ACTIVE",
        expiresAt: { lt: new Date() },
      },
      data: {
        status: "EXPIRED",
      },
    });

    return result.count;
  }

  /**
   * Get challenge leaderboard
   */
  async getChallengeLeaderboard(
    challengeId: string,
    limit: number = 50
  ): Promise<
    {
      userId: string;
      progress: number;
      completedAt?: Date;
      rank: number;
    }[]
  > {
    const participants = await prisma.userChallenge.findMany({
      where: { challengeId },
      orderBy: [
        { status: "asc" }, // COMPLETED first
        { progress: "desc" },
        { completedAt: "asc" }, // Earlier completion wins tie
      ],
      take: limit,
      select: {
        userId: true,
        progress: true,
        completedAt: true,
        status: true,
      },
    });

    return participants.map((p: any, index: number) => ({
      userId: p.userId,
      progress: p.progress,
      completedAt: p.completedAt || undefined,
      rank: index + 1,
    }));
  }

  /**
   * Get challenge statistics
   */
  async getChallengeStats(challengeId: string): Promise<{
    totalParticipants: number;
    completedCount: number;
    averageProgress: number;
    completionRate: number;
  }> {
    const participants = await prisma.userChallenge.findMany({
      where: { challengeId },
      select: {
        status: true,
        progress: true,
        challenge: { select: { targetValue: true } },
      },
    });

    const totalParticipants = participants.length;
    const completedCount = participants.filter(
      (p: any) => p.status === "COMPLETED" || p.status === "CLAIMED"
    ).length;

    const totalProgress = participants.reduce((sum: number, p: any) => sum + p.progress, 0);
    const averageProgress =
      totalParticipants > 0 ? totalProgress / totalParticipants : 0;
    const completionRate =
      totalParticipants > 0 ? (completedCount / totalParticipants) * 100 : 0;

    return {
      totalParticipants,
      completedCount,
      averageProgress: Math.round(averageProgress * 100) / 100,
      completionRate: Math.round(completionRate * 100) / 100,
    };
  }

  // --------------------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------------------

  private mapUserChallenge(uc: any): UserChallenge {
    return {
      id: uc.id,
      userId: uc.userId,
      challengeId: uc.challengeId,
      challenge: uc.challenge
        ? {
            id: uc.challenge.id,
            slug: uc.challenge.id,
            name: uc.challenge.name,
            description: uc.challenge.description,
            icon: uc.challenge.iconUrl,
            type: uc.challenge.type,
            criteria: { event: uc.challenge.targetType, count: uc.challenge.targetValue },
            targetValue: uc.challenge.targetValue,
            reward: { points: uc.challenge.pointsReward },
            startsAt: uc.challenge.startDate,
            endsAt: uc.challenge.endDate,
            targetTiers: uc.challenge.minTier ? [uc.challenge.minTier] : undefined,
            maxParticipants: uc.challenge.maxParticipants || undefined,
            currentParticipants: 0,
            isActive: uc.challenge.isActive,
          }
        : undefined,
      status: uc.status,
      progress: uc.progress,
      startedAt: uc.joinedAt,
      completedAt: uc.completedAt,
      claimedAt: uc.rewardClaimedAt,
      rewardClaimed: uc.status === "CLAIMED",
    };
  }
}

export const challengesService = new ChallengesService();
