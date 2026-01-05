/**
 * UBI Rewards - Loyalty & Gamification Types
 * Complete type definitions for loyalty system
 */

// ===========================================
// ENUMS
// ===========================================

export type LoyaltyTier = "GREEN" | "SILVER" | "GOLD" | "PLATINUM";

export type PointsTransactionType =
  | "EARN"
  | "REDEEM"
  | "EXPIRE"
  | "BONUS"
  | "ADJUSTMENT"
  | "TRANSFER"
  | "REFUND";

export type PointsSource =
  | "RIDE"
  | "FOOD_ORDER"
  | "DELIVERY"
  | "WALLET_TOPUP"
  | "BILL_PAYMENT"
  | "REFERRAL"
  | "ACHIEVEMENT"
  | "STREAK"
  | "CHALLENGE"
  | "PROMOTION"
  | "SIGNUP_BONUS"
  | "TIER_BONUS"
  | "SUBSCRIPTION"
  | "MANUAL";

export type SubscriptionStatus =
  | "ACTIVE"
  | "PAUSED"
  | "CANCELLED"
  | "EXPIRED"
  | "PAST_DUE"
  | "TRIALING";

export type BillingPeriod = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "ANNUAL";

export type AchievementType = "ONE_TIME" | "PROGRESSIVE" | "REPEATABLE";

export type AchievementCategory =
  | "RIDES"
  | "FOOD"
  | "DELIVERY"
  | "WALLET"
  | "ENGAGEMENT"
  | "SOCIAL"
  | "EXPLORER"
  | "PREMIUM"
  | "SPECIAL";

export type ChallengeType =
  | "DAILY"
  | "WEEKLY"
  | "MONTHLY"
  | "SPECIAL"
  | "SEASONAL";

export type ChallengeStatus = "ACTIVE" | "COMPLETED" | "EXPIRED" | "CLAIMED";

export type ReferralStatus =
  | "PENDING"
  | "QUALIFIED"
  | "REWARDED"
  | "EXPIRED"
  | "CANCELLED";

export type LeaderboardType =
  | "POINTS_EARNED"
  | "RIDES_COMPLETED"
  | "FOOD_ORDERS"
  | "REFERRALS"
  | "STREAK"
  | "ACHIEVEMENTS";

export type LeaderboardPeriod = "DAILY" | "WEEKLY" | "MONTHLY" | "ALL_TIME";

// ===========================================
// POINTS CONFIGURATION
// ===========================================

export interface PointsConfig {
  earning: Record<PointsSource, number>;
  tierMultipliers: Record<LoyaltyTier, number>;
  redemption: {
    rides: number;
    food: number;
    cash: number;
    partner: number;
  };
  expiryMonths: number;
}

export const DEFAULT_POINTS_CONFIG: PointsConfig = {
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
  },
  tierMultipliers: {
    GREEN: 1.0,
    SILVER: 1.25,
    GOLD: 1.5,
    PLATINUM: 2.0,
  },
  redemption: {
    rides: 100,
    food: 100,
    cash: 150,
    partner: 80,
  },
  expiryMonths: 12,
};

// ===========================================
// TIER CONFIGURATION
// ===========================================

export interface TierBenefits {
  pointsMultiplier: number;
  prioritySupport: boolean;
  priorityMatching: boolean;
  freeDeliveries: number | "unlimited";
  freeCancellations: number;
  exclusiveOffers: boolean;
  exclusiveDiscounts: number;
  loungeAccess: boolean;
  dedicatedManager: boolean;
  surgeProtection: number;
}

export interface TierConfig {
  tier: LoyaltyTier;
  name: string;
  displayName: string;
  color: string;
  icon: string;
  minPoints: number;
  qualificationPeriodMonths: number;
  gracePeriodMonths: number;
  benefits: TierBenefits;
}

export const TIER_CONFIGS: Record<LoyaltyTier, TierConfig> = {
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
// POINTS TYPES
// ===========================================

export interface PointsAccount {
  id: string;
  userId: string;
  availablePoints: number;
  pendingPoints: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  lifetimeExpired: number;
  tier: LoyaltyTier;
  tierPoints: number;
  tierQualifiedAt?: Date;
  tierExpiresAt?: Date;
  lastActivityAt?: Date;
  createdAt: Date;
}

export interface PointsTransaction {
  id: string;
  accountId: string;
  type: PointsTransactionType;
  points: number;
  balanceAfter: number;
  source?: PointsSource;
  sourceId?: string;
  description?: string;
  basePoints?: number;
  multiplier?: number;
  expiresAt?: Date;
  createdAt: Date;
}

export interface EarnPointsParams {
  userId: string;
  amount: number;
  source: PointsSource;
  sourceId?: string;
  description?: string;
  skipMultiplier?: boolean;
}

export interface RedeemPointsParams {
  userId: string;
  points: number;
  redemptionType: "rides" | "food" | "cash" | "partner" | "catalog";
  catalogItemId?: string;
  description?: string;
}

export interface PointsBalance {
  available: number;
  pending: number;
  expiringNext30Days: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
}

// ===========================================
// SUBSCRIPTION TYPES
// ===========================================

export interface SubscriptionPlanFeatures {
  freeDelivery: boolean;
  priorityMatching: boolean;
  freeCancellations: number | "unlimited";
  exclusiveDiscountsPercent: number;
  pointsMultiplier: number;
  surgeProtectionPercent: number;
  familyMembers: number;
  loungeAccess: boolean;
  dedicatedSupport: boolean;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  slug: string;
  description?: string;
  price: number;
  currency: string;
  billingPeriod: BillingPeriod;
  trialDays: number;
  features: SubscriptionPlanFeatures;
  maxFamilyMembers: number;
  isPopular: boolean;
  displayOrder: number;
  isActive: boolean;
}

export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  plan?: SubscriptionPlan;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialStart?: Date;
  trialEnd?: Date;
  cancelledAt?: Date;
  cancelReason?: string;
  cancelAtPeriodEnd: boolean;
  nextBillingAt?: Date;
  benefitsUsed?: Record<string, number>;
  createdAt: Date;
}

export interface CreateSubscriptionParams {
  userId: string;
  planId: string;
  paymentMethodId: string;
  promoCode?: string;
}

export interface SubscriptionBenefitUsage {
  freeDeliveriesUsed: number;
  freeDeliveriesRemaining: number | "unlimited";
  freeCancellationsUsed: number;
  freeCancellationsRemaining: number | "unlimited";
}

// ===========================================
// ACHIEVEMENT TYPES
// ===========================================

export interface AchievementCriteria {
  event: string;
  count?: number;
  unique?: string;
  streak?: number;
  timeBefore?: string;
  services?: string[];
  condition?: Record<string, unknown>;
}

export interface AchievementReward {
  points?: number;
  badge?: string;
  title?: string;
  discount?: number;
}

export interface Achievement {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: AchievementCategory;
  type: AchievementType;
  criteria: AchievementCriteria;
  targetValue?: number;
  reward: AchievementReward;
  isHidden: boolean;
  rarity?: "common" | "uncommon" | "rare" | "epic" | "legendary";
  displayOrder: number;
}

export interface UserAchievement {
  id: string;
  achievementId: string;
  achievement?: Achievement;
  progress: number;
  unlockedAt?: Date;
  rewardClaimed: boolean;
  claimedAt?: Date;
  timesUnlocked: number;
}

// ===========================================
// STREAK TYPES
// ===========================================

export interface UserStreak {
  id: string;
  userId: string;
  currentStreak: number;
  longestStreak: number;
  lastActivityDate?: Date;
  streakStartDate?: Date;
  freezesAvailable: number;
  freezesUsed: number;
  milestonesReached: number[];
}

export interface StreakMilestone {
  days: number;
  reward: {
    points: number;
    badge?: string;
    freezes?: number;
  };
}

export const STREAK_MILESTONES: StreakMilestone[] = [
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
// REFERRAL TYPES
// ===========================================

export interface ReferralReward {
  points?: number;
  cash?: number;
  discount?: number;
  freeRides?: number;
}

export interface ReferralProgram {
  id: string;
  name: string;
  description?: string;
  referrerReward: ReferralReward;
  refereeReward: ReferralReward;
  qualificationCriteria: {
    minTransactions?: number;
    minSpend?: number;
    withinDays?: number;
  };
  maxUsesPerReferrer?: number;
  isActive: boolean;
}

export interface ReferralCode {
  id: string;
  userId: string;
  code: string;
  uses: number;
  maxUses?: number;
  isActive: boolean;
}

export interface Referral {
  id: string;
  referrerId: string;
  refereeId: string;
  codeId: string;
  status: ReferralStatus;
  qualifiedAt?: Date;
  referrerRewardedAt?: Date;
  refereeRewardedAt?: Date;
  referrerReward?: ReferralReward;
  refereeReward?: ReferralReward;
  createdAt: Date;
}

export interface ReferralStats {
  totalReferrals: number;
  pendingReferrals: number;
  qualifiedReferrals: number;
  rewardedReferrals: number;
  totalPointsEarned: number;
  totalCashEarned: number;
}

// ===========================================
// CHALLENGE TYPES
// ===========================================

export interface ChallengeCriteria {
  event: string;
  count?: number;
  services?: string[];
  timeBefore?: string;
  timeAfter?: string;
  newRestaurant?: boolean;
  minAmount?: number;
}

export interface ChallengeReward {
  points?: number;
  cash?: number;
  discount?: number;
  badge?: string;
}

export interface Challenge {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon?: string;
  type: ChallengeType;
  criteria: ChallengeCriteria;
  targetValue: number;
  reward: ChallengeReward;
  startsAt: Date;
  endsAt: Date;
  targetTiers?: LoyaltyTier[];
  maxParticipants?: number;
  currentParticipants: number;
  isActive: boolean;
}

export interface UserChallenge {
  id: string;
  userId: string;
  challengeId: string;
  challenge?: Challenge;
  status: ChallengeStatus;
  progress: number;
  startedAt: Date;
  completedAt?: Date;
  claimedAt?: Date;
  rewardClaimed: boolean;
}

export interface ActiveChallenges {
  daily: UserChallenge[];
  weekly: UserChallenge[];
  monthly: UserChallenge[];
  special: UserChallenge[];
}

// ===========================================
// LEADERBOARD TYPES
// ===========================================

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  userName?: string;
  userAvatar?: string;
  score: number;
  previousRank?: number;
  movement?: "up" | "down" | "same" | "new";
}

export interface Leaderboard {
  type: LeaderboardType;
  period: LeaderboardPeriod;
  periodStart: Date;
  periodEnd: Date;
  entries: LeaderboardEntry[];
  totalParticipants: number;
  userRank?: number;
  userScore?: number;
}

export interface LeaderboardReward {
  minRank: number;
  maxRank: number;
  reward: {
    points?: number;
    cash?: number;
    badge?: string;
  };
}

// ===========================================
// GAME EVENT TYPES
// ===========================================

export interface GameEvent {
  type: string;
  userId: string;
  timestamp: Date;
  data: Record<string, unknown>;
}

export interface RideCompletedEvent extends GameEvent {
  type: "ride_completed";
  data: {
    rideId: string;
    amount: number;
    currency: string;
    rideType: string;
    pickupTime?: string;
  };
}

export interface FoodOrderEvent extends GameEvent {
  type: "food_order";
  data: {
    orderId: string;
    amount: number;
    currency: string;
    restaurantId: string;
    isNewRestaurant: boolean;
  };
}

export interface DeliveryCompletedEvent extends GameEvent {
  type: "delivery_completed";
  data: {
    deliveryId: string;
    amount: number;
    currency: string;
  };
}

export interface DailyActivityEvent extends GameEvent {
  type: "daily_activity";
  data: {
    activityType: "ride" | "food" | "delivery" | "wallet" | "bill";
  };
}

// ===========================================
// REWARD CATALOG TYPES
// ===========================================

export interface RewardCatalogItem {
  id: string;
  name: string;
  description: string;
  category: string;
  pointsCost: number;
  rewardType: "discount" | "cashback" | "partner" | "merchandise";
  rewardValue: {
    discountPercent?: number;
    discountAmount?: number;
    cashbackAmount?: number;
    partnerCode?: string;
    merchandiseId?: string;
  };
  totalQuantity?: number;
  remainingQuantity?: number;
  minTier?: LoyaltyTier;
  maxRedemptionsPerUser?: number;
  validFrom?: Date;
  validUntil?: Date;
  imageUrl?: string;
  isFeatured: boolean;
  isActive: boolean;
}

export interface RewardRedemption {
  id: string;
  userId: string;
  itemId: string;
  item?: RewardCatalogItem;
  pointsSpent: number;
  status: "pending" | "fulfilled" | "expired" | "cancelled";
  redemptionCode?: string;
  fulfilledAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
}

// ===========================================
// ANALYTICS TYPES
// ===========================================

export interface LoyaltyAnalytics {
  totalMembers: number;
  activeMembers: number;
  tierDistribution: Record<LoyaltyTier, number>;
  pointsIssued: number;
  pointsRedeemed: number;
  pointsExpired: number;
  pointsLiability: number;
  avgPointsPerUser: number;
  redemptionRate: number;
}

export interface EngagementMetrics {
  dailyActiveUsers: number;
  weeklyActiveUsers: number;
  monthlyActiveUsers: number;
  avgSessionsPerUser: number;
  avgTransactionsPerUser: number;
  streakRetentionRate: number;
  challengeCompletionRate: number;
  referralConversionRate: number;
}
