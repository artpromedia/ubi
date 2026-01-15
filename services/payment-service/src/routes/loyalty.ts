/**
 * UBI Rewards - Loyalty Routes
 *
 * Comprehensive loyalty and gamification API endpoints:
 * - Points management (earn, redeem, balance)
 * - Tier status and benefits
 * - UBI+ subscriptions
 * - Achievements and badges
 * - Streaks and milestones
 * - Referral program
 * - Challenges (daily/weekly/monthly)
 * - Leaderboards
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { achievementsService } from "../services/achievements.service";
import { challengesService } from "../services/challenges.service";
import { leaderboardsService } from "../services/leaderboards.service";
import { pointsService } from "../services/points.service";
import { referralsService } from "../services/referrals.service";
import { streaksService } from "../services/streaks.service";
import { subscriptionService } from "../services/subscription.service";
import { tierService } from "../services/tier.service";

const loyaltyRoutes = new Hono();

// ============================================================================
// SCHEMAS
// ============================================================================

// Common schemas
const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

// Points schemas
const earnPointsSchema = z.object({
  userId: z.string().uuid(),
  source: z.enum([
    "RIDE",
    "FOOD_ORDER",
    "DELIVERY",
    "WALLET_TOPUP",
    "BILL_PAYMENT",
    "REFERRAL",
    "PROMO",
    "CHALLENGE_BONUS",
    "STREAK_BONUS",
    "ACHIEVEMENT",
    "SIGNUP_BONUS",
    "REVIEW",
    "OTHER",
  ]),
  amount: z.number().positive(),
  sourceId: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

const redeemPointsSchema = z.object({
  userId: z.string().uuid(),
  points: z.number().positive(),
  redemptionType: z.enum(["rides", "food", "cash", "partner", "catalog"]),
  catalogItemId: z.string().optional(),
  description: z.string().optional(),
});

// Subscription schemas
const createSubscriptionSchema = z.object({
  userId: z.string().uuid(),
  planId: z.string(),
  paymentMethodId: z.string().optional(),
  autoRenew: z.boolean().default(true),
  trialDays: z.number().min(0).default(0),
});

const changePlanSchema = z.object({
  newPlanId: z.string(),
  immediate: z.boolean().default(false),
});

// Referral schemas
const applyReferralSchema = z.object({
  userId: z.string().uuid(),
  code: z.string().min(4).max(20),
});

// Challenge schemas
const joinChallengeSchema = z.object({
  userId: z.string().uuid(),
  challengeId: z.string(),
});

const createChallengeSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().max(500),
  type: z.enum(["DAILY", "WEEKLY", "MONTHLY", "SPECIAL", "SEASONAL"]),
  category: z.string(),
  targetType: z.string(),
  targetValue: z.number().positive(),
  pointsReward: z.number().positive(),
  bonusReward: z
    .object({
      type: z.string(),
      value: z.string(),
    })
    .optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  minTier: z.enum(["GREEN", "SILVER", "GOLD", "PLATINUM"]).optional(),
  maxParticipants: z.number().positive().optional(),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD", "EXPERT"]),
});

// Game event schema
const gameEventSchema = z.object({
  userId: z.string().uuid(),
  eventType: z.string(),
  timestamp: z.coerce.date().default(() => new Date()),
  metadata: z.record(z.any()).optional(),
});

// Leaderboard schemas
const leaderboardQuerySchema = z.object({
  type: z.enum([
    "POINTS_EARNED",
    "RIDES_COMPLETED",
    "FOOD_ORDERS",
    "REFERRALS",
    "STREAK",
    "ACHIEVEMENTS",
    "SAVINGS",
  ]),
  period: z.enum(["DAILY", "WEEKLY", "MONTHLY", "ALL_TIME"]),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
  region: z.string().optional(),
  tier: z.enum(["GREEN", "SILVER", "GOLD", "PLATINUM"]).optional(),
});

// ============================================================================
// POINTS ROUTES
// ============================================================================

/**
 * GET /loyalty/points/:userId
 * Get user's points balance and account info
 */
loyaltyRoutes.get("/points/:userId", async (c) => {
  const userId = c.req.param("userId");

  try {
    const [account, balance, tierProgress] = await Promise.all([
      pointsService.getOrCreateAccount(userId),
      pointsService.getBalance(userId),
      pointsService.getTierProgress(userId),
    ]);

    return c.json({
      success: true,
      data: {
        account,
        balance,
        tierProgress,
      },
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "POINTS_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * POST /loyalty/points/earn
 * Award points for an activity
 */
loyaltyRoutes.post(
  "/points/earn",
  zValidator("json", earnPointsSchema),
  async (c) => {
    const data = c.req.valid("json");

    try {
      const result = await pointsService.earnPoints({
        userId: data.userId,
        source: data.source as any,
        amount: data.amount,
        sourceId: data.sourceId,
        description: data.description,
      });

      // Check for tier upgrade
      const account = await pointsService.getOrCreateAccount(data.userId);
      const tierUpgrade = account.tier;

      return c.json({
        success: true,
        data: {
          ...result,
          tierUpgrade,
        },
      });
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: { code: "EARN_POINTS_ERROR", message: error.message },
        },
        400,
      );
    }
  },
);

/**
 * POST /loyalty/points/redeem
 * Redeem points for rewards
 */
loyaltyRoutes.post(
  "/points/redeem",
  zValidator("json", redeemPointsSchema),
  async (c) => {
    const data = c.req.valid("json");

    try {
      const result = await pointsService.redeemPoints({
        userId: data.userId,
        points: data.points,
        redemptionType: data.redemptionType,
        catalogItemId: data.catalogItemId,
        description: data.description,
      });

      return c.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: { code: "REDEEM_POINTS_ERROR", message: error.message },
        },
        400,
      );
    }
  },
);

/**
 * GET /loyalty/points/:userId/transactions
 * Get user's points transaction history
 */
loyaltyRoutes.get(
  "/points/:userId/transactions",
  zValidator("query", paginationSchema),
  async (c) => {
    const userId = c.req.param("userId");
    const { page, limit } = c.req.valid("query");

    try {
      const offset = (page - 1) * limit;
      const transactions = await pointsService.getTransactions(userId, {
        offset,
        limit,
      });

      return c.json({
        success: true,
        data: transactions,
      });
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: { code: "TRANSACTIONS_ERROR", message: error.message },
        },
        400,
      );
    }
  },
);

// ============================================================================
// TIER ROUTES
// ============================================================================

/**
 * GET /loyalty/tiers
 * Get all tier configurations
 */
loyaltyRoutes.get("/tiers", async (c) => {
  try {
    const tiers = await tierService.getAllTiers();
    return c.json({
      success: true,
      data: tiers,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "TIERS_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * GET /loyalty/tiers/:userId
 * Get user's current tier and benefits
 */
loyaltyRoutes.get("/tiers/:userId", async (c) => {
  const userId = c.req.param("userId");

  try {
    const [tier, benefits, history] = await Promise.all([
      tierService.getUserTier(userId),
      tierService.getUserBenefits(userId),
      tierService.getTierHistory(userId),
    ]);

    return c.json({
      success: true,
      data: {
        currentTier: tier,
        benefits,
        history,
      },
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "TIER_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * POST /loyalty/tiers/:userId/use-benefit
 * Use a tier benefit (e.g., free delivery)
 */
loyaltyRoutes.post("/tiers/:userId/use-benefit", async (c) => {
  const userId = c.req.param("userId");
  const { benefitType } = await c.req.json();

  try {
    const result = await tierService.useBenefit(userId, benefitType);
    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "USE_BENEFIT_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * GET /loyalty/tiers/:userId/surge-discount
 * Get surge protection discount for user
 */
loyaltyRoutes.get("/tiers/:userId/surge-discount", async (c) => {
  const userId = c.req.param("userId");
  const surgeMultiplier = parseFloat(c.req.query("surgeMultiplier") || "1.0");

  try {
    const discount = await tierService.getSurgeDiscount(
      userId,
      surgeMultiplier,
    );
    return c.json({
      success: true,
      data: { discount },
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "SURGE_DISCOUNT_ERROR", message: error.message },
      },
      400,
    );
  }
});

// ============================================================================
// SUBSCRIPTION ROUTES (UBI+)
// ============================================================================

/**
 * GET /loyalty/subscriptions/plans
 * Get available subscription plans
 */
loyaltyRoutes.get("/subscriptions/plans", async (c) => {
  try {
    const plans = await subscriptionService.getPlans();
    return c.json({
      success: true,
      data: plans,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "PLANS_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * GET /loyalty/subscriptions/:userId
 * Get user's subscription status
 */
loyaltyRoutes.get("/subscriptions/:userId", async (c) => {
  const userId = c.req.param("userId");

  try {
    const [subscription, benefitUsage] = await Promise.all([
      subscriptionService.getSubscription(userId),
      subscriptionService.getBenefitUsage(userId),
    ]);

    return c.json({
      success: true,
      data: {
        subscription,
        benefitUsage,
      },
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "SUBSCRIPTION_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * POST /loyalty/subscriptions
 * Create a new subscription
 */
loyaltyRoutes.post(
  "/subscriptions",
  zValidator("json", createSubscriptionSchema),
  async (c) => {
    const data = c.req.valid("json");

    try {
      const subscription = await subscriptionService.createSubscription({
        userId: data.userId,
        planId: data.planId,
        paymentMethodId: data.paymentMethodId ?? "",
      });

      return c.json(
        {
          success: true,
          data: subscription,
        },
        201,
      );
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: { code: "CREATE_SUBSCRIPTION_ERROR", message: error.message },
        },
        400,
      );
    }
  },
);

/**
 * POST /loyalty/subscriptions/:userId/cancel
 * Cancel subscription
 */
loyaltyRoutes.post("/subscriptions/:userId/cancel", async (c) => {
  const userId = c.req.param("userId");
  const { reason, immediate } = await c.req.json();

  try {
    const result = await subscriptionService.cancelSubscription(userId, {
      immediately: immediate,
      reason,
    });
    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "CANCEL_SUBSCRIPTION_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * POST /loyalty/subscriptions/:userId/pause
 * Pause subscription
 */
loyaltyRoutes.post("/subscriptions/:userId/pause", async (c) => {
  const userId = c.req.param("userId");

  try {
    const result = await subscriptionService.pauseSubscription(userId);
    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "PAUSE_SUBSCRIPTION_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * POST /loyalty/subscriptions/:userId/resume
 * Resume paused subscription
 */
loyaltyRoutes.post("/subscriptions/:userId/resume", async (c) => {
  const userId = c.req.param("userId");

  try {
    const result = await subscriptionService.resumeSubscription(userId);
    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "RESUME_SUBSCRIPTION_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * PUT /loyalty/subscriptions/:userId/plan
 * Change subscription plan
 */
loyaltyRoutes.put(
  "/subscriptions/:userId/plan",
  zValidator("json", changePlanSchema),
  async (c) => {
    const userId = c.req.param("userId");
    const { newPlanId, immediate: _immediate } = c.req.valid("json");

    try {
      const result = await subscriptionService.changePlan(userId, newPlanId);
      return c.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: { code: "CHANGE_PLAN_ERROR", message: error.message },
        },
        400,
      );
    }
  },
);

/**
 * POST /loyalty/subscriptions/:userId/use-benefit
 * Use a subscription benefit
 */
loyaltyRoutes.post("/subscriptions/:userId/use-benefit", async (c) => {
  const userId = c.req.param("userId");
  const { benefitType, quantity: _quantity } = await c.req.json();

  try {
    const result = await subscriptionService.useBenefit(userId, benefitType);
    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "USE_BENEFIT_ERROR", message: error.message },
      },
      400,
    );
  }
});

// ============================================================================
// ACHIEVEMENTS ROUTES
// ============================================================================

/**
 * GET /loyalty/achievements
 * Get all achievements
 */
loyaltyRoutes.get("/achievements", async (c) => {
  const category = c.req.query("category");

  try {
    const achievements = category
      ? await achievementsService.getAchievementsByCategory(
          "system",
          category as any,
        )
      : await achievementsService.getAchievements("system");

    return c.json({
      success: true,
      data: achievements,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "ACHIEVEMENTS_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * GET /loyalty/achievements/:userId
 * Get user's achievements
 */
loyaltyRoutes.get("/achievements/:userId", async (c) => {
  const userId = c.req.param("userId");

  try {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    const [unlocked, recent, leaderboard] = await Promise.all([
      achievementsService.getUnlockedAchievements(userId),
      achievementsService.getRecentUnlocks(userId, fiveDaysAgo),
      achievementsService.getLeaderboard(),
    ]);

    return c.json({
      success: true,
      data: {
        unlocked,
        recent,
        leaderboard,
      },
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "USER_ACHIEVEMENTS_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * POST /loyalty/achievements/:userId/claim
 * Claim achievement reward
 */
loyaltyRoutes.post("/achievements/:userId/claim", async (c) => {
  const userId = c.req.param("userId");
  const { achievementId } = await c.req.json();

  try {
    const result = await achievementsService.claimReward(userId, achievementId);
    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "CLAIM_ACHIEVEMENT_ERROR", message: error.message },
      },
      400,
    );
  }
});

// ============================================================================
// STREAKS ROUTES
// ============================================================================

/**
 * GET /loyalty/streaks/:userId
 * Get user's streak info
 */
loyaltyRoutes.get("/streaks/:userId", async (c) => {
  const userId = c.req.param("userId");

  try {
    const streak = await streaksService.getStreak(userId);
    const currentStreakValue = streak
      ? Number(streak.currentStreak as any) || 0
      : 0;
    const nextMilestone = streaksService.getNextMilestone(currentStreakValue);
    const milestones = streaksService.getMilestones(currentStreakValue);

    return c.json({
      success: true,
      data: {
        streak,
        nextMilestone,
        milestones,
      },
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "STREAK_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * POST /loyalty/streaks/:userId/record
 * Record daily activity for streak
 */
loyaltyRoutes.post("/streaks/:userId/record", async (c) => {
  const userId = c.req.param("userId");
  const { activityType, referenceId: _referenceId } = await c.req.json();

  try {
    const result = await streaksService.recordActivity(userId, activityType);
    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "RECORD_STREAK_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * POST /loyalty/streaks/:userId/freeze
 * Use streak freeze
 */
loyaltyRoutes.post("/streaks/:userId/freeze", async (c) => {
  const userId = c.req.param("userId");

  try {
    const result = await streaksService.useFreeze(userId);
    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "FREEZE_STREAK_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * GET /loyalty/streaks/:userId/calendar
 * Get streak calendar
 */
loyaltyRoutes.get("/streaks/:userId/calendar", async (c) => {
  const userId = c.req.param("userId");
  const month = parseInt(
    c.req.query("month") || String(new Date().getMonth() + 1),
  );
  const year = parseInt(
    c.req.query("year") || String(new Date().getFullYear()),
  );

  try {
    const calendar = await streaksService.getCalendar(userId, month, year);
    return c.json({
      success: true,
      data: calendar,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "CALENDAR_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * GET /loyalty/streaks/leaderboard
 * Get streak leaderboard
 */
loyaltyRoutes.get("/streaks/leaderboard", async (c) => {
  const limit = parseInt(c.req.query("limit") || "50");
  const streakType = c.req.query("type") as "current" | "longest" | undefined;

  try {
    const leaderboard = await streaksService.getLeaderboard(
      streakType || "current",
      limit,
    );
    return c.json({
      success: true,
      data: leaderboard,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "STREAK_LEADERBOARD_ERROR", message: error.message },
      },
      400,
    );
  }
});

// ============================================================================
// REFERRALS ROUTES
// ============================================================================

/**
 * GET /loyalty/referrals/program
 * Get active referral program
 */
loyaltyRoutes.get("/referrals/program", async (c) => {
  try {
    const program = await referralsService.getActiveProgram();
    return c.json({
      success: true,
      data: program,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "PROGRAM_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * GET /loyalty/referrals/:userId/code
 * Get or create user's referral code
 */
loyaltyRoutes.get("/referrals/:userId/code", async (c) => {
  const userId = c.req.param("userId");

  try {
    const code = await referralsService.getOrCreateCode(userId);
    const shareLink = await referralsService.getShareableLink(code.code);

    return c.json({
      success: true,
      data: {
        ...code,
        shareLink,
      },
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "REFERRAL_CODE_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * POST /loyalty/referrals/apply
 * Apply a referral code
 */
loyaltyRoutes.post(
  "/referrals/apply",
  zValidator("json", applyReferralSchema),
  async (c) => {
    const { userId, code } = c.req.valid("json");

    try {
      const result = await referralsService.applyCode(userId, code);
      return c.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: { code: "APPLY_REFERRAL_ERROR", message: error.message },
        },
        400,
      );
    }
  },
);

/**
 * POST /loyalty/referrals/:referralId/complete
 * Complete a referral (after qualification)
 */
loyaltyRoutes.post("/referrals/:referralId/complete", async (c) => {
  const referralId = c.req.param("referralId");

  try {
    const result = await referralsService.completeReferral(referralId);
    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "COMPLETE_REFERRAL_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * GET /loyalty/referrals/:userId/stats
 * Get user's referral statistics
 */
loyaltyRoutes.get("/referrals/:userId/stats", async (c) => {
  const userId = c.req.param("userId");

  try {
    const [stats, referrals] = await Promise.all([
      referralsService.getStats(userId),
      referralsService.getReferrals(userId),
    ]);

    return c.json({
      success: true,
      data: {
        stats,
        referrals,
      },
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "REFERRAL_STATS_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * GET /loyalty/referrals/leaderboard
 * Get referral leaderboard
 */
loyaltyRoutes.get("/referrals/leaderboard", async (c) => {
  const period = (c.req.query("period") || "MONTHLY") as any;
  const limit = parseInt(c.req.query("limit") || "50");

  try {
    const leaderboard = await referralsService.getLeaderboard(period, limit);
    return c.json({
      success: true,
      data: leaderboard,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "REFERRAL_LEADERBOARD_ERROR", message: error.message },
      },
      400,
    );
  }
});

// ============================================================================
// CHALLENGES ROUTES
// ============================================================================

/**
 * GET /loyalty/challenges/:userId
 * Get available challenges for user
 */
loyaltyRoutes.get("/challenges/:userId", async (c) => {
  const userId = c.req.param("userId");

  try {
    const [available, active] = await Promise.all([
      challengesService.getAvailableChallenges(userId),
      challengesService.getUserChallenges(userId, "ACTIVE"),
    ]);

    return c.json({
      success: true,
      data: {
        available,
        active,
      },
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "CHALLENGES_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * GET /loyalty/challenges/:userId/daily
 * Get daily challenges
 */
loyaltyRoutes.get("/challenges/:userId/daily", async (c) => {
  const userId = c.req.param("userId");

  try {
    const dailies = await challengesService.getDailyChallenges(userId);
    return c.json({
      success: true,
      data: dailies,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "DAILY_CHALLENGES_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * GET /loyalty/challenges/:userId/weekly
 * Get weekly challenges
 */
loyaltyRoutes.get("/challenges/:userId/weekly", async (c) => {
  const userId = c.req.param("userId");

  try {
    const weeklies = await challengesService.getWeeklyChallenges(userId);
    return c.json({
      success: true,
      data: weeklies,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "WEEKLY_CHALLENGES_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * POST /loyalty/challenges/join
 * Join a challenge
 */
loyaltyRoutes.post(
  "/challenges/join",
  zValidator("json", joinChallengeSchema),
  async (c) => {
    const { userId, challengeId } = c.req.valid("json");

    try {
      const result = await challengesService.joinChallenge(userId, challengeId);
      return c.json(
        {
          success: true,
          data: result,
        },
        201,
      );
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: { code: "JOIN_CHALLENGE_ERROR", message: error.message },
        },
        400,
      );
    }
  },
);

/**
 * POST /loyalty/challenges/:userChallengeId/claim
 * Claim challenge reward
 */
loyaltyRoutes.post("/challenges/:userChallengeId/claim", async (c) => {
  const userChallengeId = c.req.param("userChallengeId");
  const { userId } = await c.req.json();

  try {
    const result = await challengesService.claimReward(userId, userChallengeId);
    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "CLAIM_CHALLENGE_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * GET /loyalty/challenges/:challengeId/leaderboard
 * Get challenge leaderboard
 */
loyaltyRoutes.get("/challenges/:challengeId/leaderboard", async (c) => {
  const challengeId = c.req.param("challengeId");
  const limit = parseInt(c.req.query("limit") || "50");

  try {
    const leaderboard = await challengesService.getChallengeLeaderboard(
      challengeId,
      limit,
    );
    return c.json({
      success: true,
      data: leaderboard,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "CHALLENGE_LEADERBOARD_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * POST /loyalty/challenges (admin)
 * Create a custom challenge
 */
loyaltyRoutes.post(
  "/challenges",
  zValidator("json", createChallengeSchema),
  async (c) => {
    const data = c.req.valid("json");

    try {
      const challenge = await challengesService.createChallenge(data);
      return c.json(
        {
          success: true,
          data: challenge,
        },
        201,
      );
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: { code: "CREATE_CHALLENGE_ERROR", message: error.message },
        },
        400,
      );
    }
  },
);

// ============================================================================
// LEADERBOARDS ROUTES
// ============================================================================

/**
 * GET /loyalty/leaderboards
 * Get available leaderboards
 */
loyaltyRoutes.get("/leaderboards", async (c) => {
  try {
    const leaderboards = await leaderboardsService.getLeaderboards();
    return c.json({
      success: true,
      data: leaderboards,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "LEADERBOARDS_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * GET /loyalty/leaderboards/view
 * Get a specific leaderboard
 */
loyaltyRoutes.get(
  "/leaderboards/view",
  zValidator("query", leaderboardQuerySchema),
  async (c) => {
    const { type, period, limit, offset, region, tier } = c.req.valid("query");

    try {
      const leaderboard = await leaderboardsService.getLeaderboard(
        type as any,
        period,
        { limit, offset, region, tier },
      );
      return c.json({
        success: true,
        data: leaderboard,
      });
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: { code: "LEADERBOARD_ERROR", message: error.message },
        },
        400,
      );
    }
  },
);

/**
 * GET /loyalty/leaderboards/:userId/rank
 * Get user's rank on leaderboard
 */
loyaltyRoutes.get("/leaderboards/:userId/rank", async (c) => {
  const userId = c.req.param("userId");
  const type = c.req.query("type") as any;
  const period = (c.req.query("period") as any) || "WEEKLY";

  try {
    const rank = await leaderboardsService.getUserRank(userId, type, period);
    return c.json({
      success: true,
      data: rank,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "USER_RANK_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * GET /loyalty/leaderboards/:userId/summary
 * Get user's positions across all leaderboards
 */
loyaltyRoutes.get("/leaderboards/:userId/summary", async (c) => {
  const userId = c.req.param("userId");

  try {
    const summary = await leaderboardsService.getUserLeaderboardSummary(userId);
    return c.json({
      success: true,
      data: summary,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "LEADERBOARD_SUMMARY_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * GET /loyalty/leaderboards/:userId/friends
 * Get friends leaderboard
 */
loyaltyRoutes.get("/leaderboards/:userId/friends", async (c) => {
  const userId = c.req.param("userId");
  const type = (c.req.query("type") as any) || "POINTS_EARNED";
  const period = (c.req.query("period") as any) || "WEEKLY";

  try {
    const leaderboard = await leaderboardsService.getFriendsLeaderboard(
      userId,
      type,
      period,
    );
    return c.json({
      success: true,
      data: leaderboard,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "FRIENDS_LEADERBOARD_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * GET /loyalty/leaderboards/:userId/rewards
 * Get user's leaderboard rewards history
 */
loyaltyRoutes.get("/leaderboards/:userId/rewards", async (c) => {
  const userId = c.req.param("userId");

  try {
    const rewards = await leaderboardsService.getUserRewards(userId);
    return c.json({
      success: true,
      data: rewards,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "REWARDS_HISTORY_ERROR", message: error.message },
      },
      400,
    );
  }
});

// ============================================================================
// EVENT PROCESSING ROUTE
// ============================================================================

/**
 * POST /loyalty/events
 * Process a game event (updates achievements, challenges, streaks, leaderboards)
 */
loyaltyRoutes.post(
  "/events",
  zValidator("json", gameEventSchema),
  async (c) => {
    const event = c.req.valid("json");

    try {
      // Process event across all gamification systems
      const [achievementResult, challengeResult] = await Promise.all([
        achievementsService.processEvent(event as any),
        challengesService.processEvent(event.userId, event as any),
      ]);

      // Update leaderboards based on event type
      if (event.eventType === "RIDE_COMPLETED") {
        await leaderboardsService.updateUserEntry(
          event.userId,
          "RIDES_COMPLETED",
        );
      } else if (event.eventType === "FOOD_ORDERED") {
        await leaderboardsService.updateUserEntry(event.userId, "FOOD_ORDERS");
      } else if (event.eventType === "REFERRAL_COMPLETED") {
        await leaderboardsService.updateUserEntry(event.userId, "REFERRALS");
      }

      return c.json({
        success: true,
        data: {
          achievements: achievementResult,
          challenges: challengeResult,
        },
      });
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: { code: "EVENT_PROCESSING_ERROR", message: error.message },
        },
        400,
      );
    }
  },
);

// ============================================================================
// ADMIN ROUTES
// ============================================================================

/**
 * POST /loyalty/admin/process-expirations
 * Process expired points, streaks, challenges
 */
loyaltyRoutes.post("/admin/process-expirations", async (c) => {
  try {
    const [expiredPoints, expiredChallenges] = await Promise.all([
      pointsService.processExpiredPoints(),
      challengesService.processExpiredChallenges(),
    ]);

    return c.json({
      success: true,
      data: {
        expiredPoints,
        expiredChallenges,
      },
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "EXPIRATION_PROCESSING_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * POST /loyalty/admin/process-renewals
 * Process subscription renewals
 */
loyaltyRoutes.post("/admin/process-renewals", async (c) => {
  try {
    const result = await subscriptionService.processRenewals();
    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "RENEWAL_PROCESSING_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * POST /loyalty/admin/process-leaderboard-rewards
 * Process end-of-period leaderboard rewards
 */
loyaltyRoutes.post("/admin/process-leaderboard-rewards", async (c) => {
  const { type, period } = await c.req.json();

  try {
    const result = await leaderboardsService.processRewards(type, period);
    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "LEADERBOARD_REWARDS_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * POST /loyalty/admin/recalculate-leaderboard
 * Recalculate a leaderboard
 */
loyaltyRoutes.post("/admin/recalculate-leaderboard", async (c) => {
  const { type, period } = await c.req.json();

  try {
    const count = await leaderboardsService.recalculateLeaderboard(
      type,
      period,
    );
    return c.json({
      success: true,
      data: { recalculatedEntries: count },
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "RECALCULATE_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * GET /loyalty/admin/tier-analytics
 * Get tier distribution analytics
 */
loyaltyRoutes.get("/admin/tier-analytics", async (c) => {
  try {
    const analytics = await tierService.getTierAnalytics();
    return c.json({
      success: true,
      data: analytics,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "TIER_ANALYTICS_ERROR", message: error.message },
      },
      400,
    );
  }
});

/**
 * GET /loyalty/admin/at-risk-streaks
 * Get users with at-risk streaks
 */
loyaltyRoutes.get("/admin/at-risk-streaks", async (c) => {
  try {
    const atRisk = await streaksService.getAtRiskStreaks();
    return c.json({
      success: true,
      data: atRisk,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: { code: "AT_RISK_STREAKS_ERROR", message: error.message },
      },
      400,
    );
  }
});

export { loyaltyRoutes };
