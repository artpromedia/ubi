// ===========================================
// UBI Driver Experience & Benefits Platform
// Types & Interfaces
// ===========================================

// -----------------------------------------
// EARNINGS TYPES
// -----------------------------------------

export enum EarningsPeriodType {
  HOURLY = "HOURLY",
  DAILY = "DAILY",
  WEEKLY = "WEEKLY",
  MONTHLY = "MONTHLY",
  YEARLY = "YEARLY",
}

export enum TripEarningType {
  RIDE = "RIDE",
  RIDE_SHARE = "RIDE_SHARE",
  RIDE_PREMIUM = "RIDE_PREMIUM",
  DELIVERY_FOOD = "DELIVERY_FOOD",
  DELIVERY_PACKAGE = "DELIVERY_PACKAGE",
  DELIVERY_GROCERY = "DELIVERY_GROCERY",
}

export interface DriverEarnings {
  id: string;
  driverId: string;
  periodStart: Date;
  periodEnd: Date;
  periodType: EarningsPeriodType;

  grossEarnings: number;
  tips: number;
  incentives: number;
  bonuses: number;
  surgeEarnings: number;

  commission: number;
  commissionRate: number;
  ceerionDeduction: number;
  otherDeductions: number;
  netEarnings: number;

  tripCount: number;
  rideTrips: number;
  deliveryTrips: number;
  onlineMinutes: number;
  activeMinutes: number;
  totalDistance: number;

  acceptanceRate: number;
  completionRate: number;
  averageRating: number;

  currency: string;
}

export interface TripEarning {
  id: string;
  driverId: string;
  tripId: string;
  tripType: TripEarningType;

  baseFare: number;
  distanceFare: number;
  timeFare: number;
  surgeFare: number;
  surgeMultiplier: number;
  tollsCollected: number;

  grossFare: number;
  tip: number;
  incentiveBonus: number;

  commission: number;
  commissionRate: number;
  netEarnings: number;

  distance: number;
  duration: number;
  pickupLocation: string;
  dropoffLocation: string;
  rating?: number;

  currency: string;
  completedAt: Date;
}

export interface TodayEarnings {
  grossEarnings: number;
  netEarnings: number;
  tips: number;
  incentives: number;
  tripCount: number;
  onlineHours: number;
  earningsPerHour: number;
  goals: DriverGoalProgress[];
  suggestions: EarningSuggestion[];
  comparison: EarningsComparison;
  trips: TripEarning[];
}

export interface EarningsComparison {
  vsYesterday: {
    earnings: number;
    percentChange: number;
    trips: number;
  };
  vsLastWeek: {
    earnings: number;
    percentChange: number;
    trips: number;
  };
  vsAverage: {
    earnings: number;
    percentChange: number;
    trips: number;
  };
}

export interface EarningSuggestion {
  type: SuggestionType;
  title: string;
  description: string;
  impact: "low" | "medium" | "high";
  actionUrl?: string;
  data?: Record<string, unknown>;
}

export enum SuggestionType {
  ACCEPTANCE_RATE = "acceptance_rate",
  PEAK_HOURS = "peak_hours",
  HIGH_DEMAND_AREA = "high_demand_area",
  COMPLETE_QUEST = "complete_quest",
  MAINTAIN_STREAK = "maintain_streak",
  IMPROVE_RATING = "improve_rating",
  ENABLE_DELIVERY = "enable_delivery",
  GO_ONLINE = "go_online",
}

// -----------------------------------------
// GOALS TYPES
// -----------------------------------------

export enum DriverGoalType {
  DAILY_EARNINGS = "DAILY_EARNINGS",
  DAILY_TRIPS = "DAILY_TRIPS",
  WEEKLY_EARNINGS = "WEEKLY_EARNINGS",
  WEEKLY_TRIPS = "WEEKLY_TRIPS",
  MONTHLY_EARNINGS = "MONTHLY_EARNINGS",
  MONTHLY_TRIPS = "MONTHLY_TRIPS",
  ONLINE_HOURS = "ONLINE_HOURS",
  ACCEPTANCE_RATE = "ACCEPTANCE_RATE",
  RATING_TARGET = "RATING_TARGET",
  CUSTOM = "CUSTOM",
}

export interface DriverGoal {
  id: string;
  driverId: string;
  goalType: DriverGoalType;
  targetValue: number;
  currentValue: number;
  targetUnit: string;
  periodStart: Date;
  periodEnd: Date;
  achieved: boolean;
  achievedAt?: Date;
  progress: number;
  rewardType?: string;
  rewardValue?: number;
  rewardClaimed: boolean;
  isActive: boolean;
}

export interface DriverGoalProgress {
  goal: DriverGoal;
  percentComplete: number;
  remaining: number;
  estimatedCompletion?: Date;
  onTrack: boolean;
}

export interface CreateGoalInput {
  driverId: string;
  goalType: DriverGoalType;
  targetValue: number;
  targetUnit: string;
  periodEnd: Date;
  rewardType?: string;
  rewardValue?: number;
}

// -----------------------------------------
// INCENTIVES TYPES
// -----------------------------------------

export enum IncentiveType {
  TRIP_COUNT = "TRIP_COUNT",
  CONSECUTIVE_TRIPS = "CONSECUTIVE_TRIPS",
  PEAK_HOUR = "PEAK_HOUR",
  AREA_BONUS = "AREA_BONUS",
  QUEST = "QUEST",
  STREAK = "STREAK",
  RATING_BONUS = "RATING_BONUS",
  REFERRAL = "REFERRAL",
  FIRST_TRIP = "FIRST_TRIP",
  COMEBACK = "COMEBACK",
}

export interface Incentive {
  id: string;
  name: string;
  description: string;
  incentiveType: IncentiveType;

  targetCities: string[];
  targetTiers: string[];
  targetVehicles: string[];
  maxParticipants?: number;

  startTime: Date;
  endTime: Date;
  activeHours?: ActiveHours;
  activeDays: number[];

  requirements: IncentiveRequirements;
  rewardTiers: RewardTier[];

  totalBudget?: number;
  spentBudget: number;
  isActive: boolean;
}

export interface ActiveHours {
  start: string; // "07:00"
  end: string; // "10:00"
  timezone: string;
}

export interface IncentiveRequirements {
  minTrips?: number;
  maxTrips?: number;
  minAcceptanceRate?: number;
  minRating?: number;
  tripTypes?: TripEarningType[];
  areas?: string[]; // H3 indices
  consecutiveRequired?: boolean;
}

export interface RewardTier {
  tier: number;
  threshold: number;
  rewardType: "cash" | "points" | "badge" | "commission_reduction";
  rewardValue: number;
  description: string;
}

export interface DriverIncentive extends Incentive {
  progress: DriverIncentiveProgress;
  potentialEarnings: number;
  timeRemaining: number;
  isEligible: boolean;
  currentTierReward?: number;
  nextTierReward?: number;
}

export interface DriverIncentiveProgress {
  id: string;
  driverId: string;
  incentiveId: string;
  currentValue: number;
  currentTier: number;
  tiersCompleted: number[];
  totalEarned: number;
  pendingPayout: number;
  status: IncentiveProgressStatus;
  tripIds: string[];
}

export enum IncentiveProgressStatus {
  ACTIVE = "ACTIVE",
  COMPLETED = "COMPLETED",
  EXPIRED = "EXPIRED",
  FORFEITED = "FORFEITED",
}

export interface IncentiveUpdate {
  incentiveId: string;
  previousValue: number;
  newValue: number;
  tierCompleted?: number;
  reward?: RewardTier;
  tripId: string;
}

// -----------------------------------------
// STREAKS TYPES
// -----------------------------------------

export enum StreakType {
  DAILY_ACTIVE = "DAILY_ACTIVE",
  DAILY_TRIPS = "DAILY_TRIPS",
  FIVE_STAR = "FIVE_STAR",
  ACCEPTANCE = "ACCEPTANCE",
  COMPLETION = "COMPLETION",
}

export interface DriverStreak {
  id: string;
  driverId: string;
  streakType: StreakType;
  currentCount: number;
  lastActivityAt: Date;
  bestCount: number;
  bestStartDate?: Date;
  bestEndDate?: Date;
  nextMilestone: number;
  milestonesHit: number[];
}

export interface StreakMilestone {
  count: number;
  reward: {
    type: "cash" | "points" | "badge";
    value: number;
    description: string;
  };
}

// -----------------------------------------
// BENEFITS TYPES
// -----------------------------------------

export enum BenefitType {
  HEALTH_BASIC = "HEALTH_BASIC",
  HEALTH_FAMILY = "HEALTH_FAMILY",
  VEHICLE_INSURANCE = "VEHICLE_INSURANCE",
  ACCIDENT_COVER = "ACCIDENT_COVER",
  LIFE_INSURANCE = "LIFE_INSURANCE",
  FUEL_DISCOUNT = "FUEL_DISCOUNT",
  MAINTENANCE_DISCOUNT = "MAINTENANCE_DISCOUNT",
  PHONE_PLAN = "PHONE_PLAN",
  SAVINGS_PROGRAM = "SAVINGS_PROGRAM",
}

export interface BenefitPackage {
  id: string;
  name: string;
  description: string;
  benefitType: BenefitType;
  provider: string;

  coverageItems: CoverageItem[];
  exclusions: string[];
  waitingPeriod: number;

  monthlyPrice: number;
  annualPrice?: number;
  currency: string;

  minTrips: number;
  minTier?: string;
  minTenure: number;

  termsUrl?: string;
  claimProcess?: string;
  supportContact?: string;

  isActive: boolean;
}

export interface CoverageItem {
  name: string;
  description: string;
  limit?: number;
  currency?: string;
}

export interface DriverBenefitPackage extends BenefitPackage {
  isEligible: boolean;
  eligibilityReason?: string;
  enrollment?: BenefitEnrollment;
  isRecommended: boolean;
}

export interface BenefitEnrollment {
  id: string;
  driverId: string;
  packageId: string;
  status: BenefitEnrollmentStatus;
  enrolledAt?: Date;
  effectiveDate?: Date;
  expiryDate?: Date;
  billingCycle: BillingCycle;
  lastPaymentAt?: Date;
  nextPaymentAt?: Date;
  autoRenew: boolean;
  dependents?: Dependent[];
  policyNumber?: string;
  policyDocument?: string;
}

export enum BenefitEnrollmentStatus {
  PENDING = "PENDING",
  ACTIVE = "ACTIVE",
  SUSPENDED = "SUSPENDED",
  CANCELLED = "CANCELLED",
  EXPIRED = "EXPIRED",
}

export enum BillingCycle {
  MONTHLY = "MONTHLY",
  QUARTERLY = "QUARTERLY",
  ANNUALLY = "ANNUALLY",
}

export interface Dependent {
  name: string;
  relationship: "spouse" | "child" | "parent";
  dateOfBirth: Date;
  gender: "male" | "female";
}

export interface BenefitClaim {
  id: string;
  enrollmentId: string;
  driverId: string;
  claimType: string;
  description: string;
  amount: number;
  currency: string;
  documents: string[];
  incidentDate: Date;
  status: ClaimStatus;
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNotes?: string;
  approvedAmount?: number;
  paidAmount?: number;
  paidAt?: Date;
}

export enum ClaimStatus {
  SUBMITTED = "SUBMITTED",
  UNDER_REVIEW = "UNDER_REVIEW",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
  PAID = "PAID",
  APPEALED = "APPEALED",
}

export interface FuelDiscount {
  id: string;
  driverId: string;
  discountTier: string;
  discountPercent: number;
  monthlyLimit: number;
  usedThisMonth: number;
  totalSaved: number;
  fuelCardNumber?: string;
  cardStatus: string;
}

export interface FuelStation {
  id: string;
  name: string;
  brand: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  discountPercent: number;
  amenities: string[];
  operatingHours: Record<string, { open: string; close: string }>;
  is24Hours: boolean;
  distance?: number;
}

export interface FuelTransaction {
  id: string;
  stationId: string;
  stationName: string;
  liters: number;
  pricePerLiter: number;
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  currency: string;
  transactedAt: Date;
}

// -----------------------------------------
// CAREER & PROGRESSION TYPES
// -----------------------------------------

export enum DriverTier {
  STARTER = "STARTER",
  BRONZE = "BRONZE",
  SILVER = "SILVER",
  GOLD = "GOLD",
  PLATINUM = "PLATINUM",
  DIAMOND = "DIAMOND",
}

export interface TierRequirements {
  trips: number;
  rating: number;
  tenure?: number; // days
  certifications?: string[];
}

export interface TierBenefits {
  commissionRate: number;
  fuelDiscount?: number;
  prioritySupport?: boolean;
  priorityRequests?: boolean;
  dedicatedManager?: boolean;
  fleetOwnerEligible?: boolean;
  earlyPayout?: boolean;
  bonusMultiplier?: number;
}

export interface TierConfig {
  name: string;
  requirements: TierRequirements;
  benefits: TierBenefits;
  badge: string;
  color: string;
}

export const DRIVER_TIERS: Record<DriverTier, TierConfig> = {
  [DriverTier.STARTER]: {
    name: "Starter",
    requirements: { trips: 0, rating: 0 },
    benefits: { commissionRate: 0.25 },
    badge: "🚗",
    color: "#6B7280",
  },
  [DriverTier.BRONZE]: {
    name: "Bronze",
    requirements: { trips: 100, rating: 4.5 },
    benefits: { commissionRate: 0.23, fuelDiscount: 5 },
    badge: "🥉",
    color: "#CD7F32",
  },
  [DriverTier.SILVER]: {
    name: "Silver",
    requirements: { trips: 500, rating: 4.7 },
    benefits: { commissionRate: 0.21, fuelDiscount: 7, prioritySupport: true },
    badge: "🥈",
    color: "#C0C0C0",
  },
  [DriverTier.GOLD]: {
    name: "Gold",
    requirements: { trips: 2000, rating: 4.8 },
    benefits: {
      commissionRate: 0.19,
      fuelDiscount: 10,
      priorityRequests: true,
      earlyPayout: true,
    },
    badge: "🥇",
    color: "#FFD700",
  },
  [DriverTier.PLATINUM]: {
    name: "Platinum Captain",
    requirements: { trips: 5000, rating: 4.9 },
    benefits: {
      commissionRate: 0.17,
      fuelDiscount: 12,
      dedicatedManager: true,
      fleetOwnerEligible: true,
      bonusMultiplier: 1.2,
    },
    badge: "💎",
    color: "#E5E4E2",
  },
  [DriverTier.DIAMOND]: {
    name: "Diamond Elite",
    requirements: {
      trips: 10000,
      rating: 4.95,
      certifications: ["fleet_captain"],
    },
    benefits: {
      commissionRate: 0.15,
      fuelDiscount: 15,
      dedicatedManager: true,
      fleetOwnerEligible: true,
      bonusMultiplier: 1.5,
      priorityRequests: true,
      prioritySupport: true,
      earlyPayout: true,
    },
    badge: "👑",
    color: "#B9F2FF",
  },
};

export interface DriverProfile {
  id: string;
  driverId: string;
  currentTier: DriverTier;
  tierSince: Date;
  tierProgress: number;

  lifetimeTrips: number;
  lifetimeEarnings: number;
  lifetimeRating: number;
  totalRatings: number;

  commissionRate: number;
  preferredAreas: string[];
  workSchedule?: WorkSchedule;

  onlineStatus: DriverOnlineStatus;
  lastOnlineAt?: Date;

  certifications: DriverCertification[];
  badges: DriverBadge[];
}

export interface DriverTierHistory {
  id: string;
  driverId: string;
  tier: DriverTier;
  previousTier?: DriverTier;
  achievedAt: Date;
  tripsAtUpgrade: number;
  ratingAtUpgrade: number;
  earningsAtUpgrade: number;
}

export enum DriverOnlineStatus {
  OFFLINE = "OFFLINE",
  ONLINE = "ONLINE",
  ON_TRIP = "ON_TRIP",
  BUSY = "BUSY",
}

export interface WorkSchedule {
  monday?: { start: string; end: string };
  tuesday?: { start: string; end: string };
  wednesday?: { start: string; end: string };
  thursday?: { start: string; end: string };
  friday?: { start: string; end: string };
  saturday?: { start: string; end: string };
  sunday?: { start: string; end: string };
}

export interface CareerStatus {
  currentTier: DriverTier;
  tierDetails: TierConfig;
  nextTier?: DriverTier;
  progress: TierProgress;
  certifications: DriverCertification[];
  badges: DriverBadge[];
  monthlyStats: MonthlyStats;
}

export interface TierProgress {
  tripsCompleted: number;
  tripsRequired: number;
  tripsProgress: number;
  currentRating: number;
  ratingRequired: number;
  ratingMet: boolean;
  estimatedPromotionDate?: Date;
  daysUntilReview: number;
}

export interface MonthlyStats {
  trips: number;
  earnings: number;
  onlineHours: number;
  rating: number;
  rank?: number;
  percentile?: number;
}

// -----------------------------------------
// TRAINING & CERTIFICATIONS TYPES
// -----------------------------------------

export enum TrainingCategory {
  ONBOARDING = "ONBOARDING",
  SAFETY = "SAFETY",
  CUSTOMER_SERVICE = "CUSTOMER_SERVICE",
  VEHICLE_CARE = "VEHICLE_CARE",
  EV_SPECIALIST = "EV_SPECIALIST",
  DELIVERY_PRO = "DELIVERY_PRO",
  FLEET_MANAGEMENT = "FLEET_MANAGEMENT",
  LEADERSHIP = "LEADERSHIP",
}

export enum TrainingContentType {
  VIDEO = "VIDEO",
  INTERACTIVE = "INTERACTIVE",
  DOCUMENT = "DOCUMENT",
  QUIZ = "QUIZ",
  WEBINAR = "WEBINAR",
}

export interface TrainingModule {
  id: string;
  name: string;
  description: string;
  category: TrainingCategory;
  durationMinutes: number;
  contentType: TrainingContentType;
  contentUrl: string;
  isRequired: boolean;
  prerequisiteIds: string[];
  hasAssessment: boolean;
  passingScore: number;
  questions?: QuizQuestion[];
  certification?: string;
  rewardType?: string;
  rewardValue?: Record<string, unknown>;
  targetTiers: string[];
  targetVehicles: string[];
  isActive: boolean;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation?: string;
}

export interface TrainingCompletion {
  id: string;
  driverId: string;
  moduleId: string;
  status: TrainingStatus;
  progress: number;
  startedAt?: Date;
  completedAt?: Date;
  attemptCount: number;
  bestScore?: number;
  passed: boolean;
  timeSpentMinutes: number;
}

export enum TrainingStatus {
  NOT_STARTED = "NOT_STARTED",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

export interface DriverTrainingModule extends TrainingModule {
  completion?: TrainingCompletion;
  isLocked: boolean;
  lockReason?: string;
}

export enum CertificationStatus {
  ACTIVE = "ACTIVE",
  EXPIRED = "EXPIRED",
  EXPIRING_SOON = "EXPIRING_SOON",
}

export interface DriverCertification {
  id: string;
  driverId: string;
  certificationCode: string;
  name: string;
  description?: string;
  issuedAt: Date;
  expiresAt?: Date;
  isActive: boolean;
  certificateUrl?: string;
  verificationCode?: string;
}

export enum BadgeRarity {
  COMMON = "COMMON",
  UNCOMMON = "UNCOMMON",
  RARE = "RARE",
  EPIC = "EPIC",
  LEGENDARY = "LEGENDARY",
}

export interface DriverBadge {
  id: string;
  driverId: string;
  badgeCode: string;
  name: string;
  description: string;
  iconUrl: string;
  level: number;
  maxLevel: number;
  earnedAt: Date;
  isDisplayed: boolean;
}

// -----------------------------------------
// COMMUNITY TYPES
// -----------------------------------------

export enum PostType {
  DISCUSSION = "DISCUSSION",
  QUESTION = "QUESTION",
  TIP = "TIP",
  ANNOUNCEMENT = "ANNOUNCEMENT",
  POLL = "POLL",
}

export interface ForumCategory {
  id: string;
  name: string;
  description: string;
  slug: string;
  iconUrl?: string;
  moderatorIds: string[];
  postCount: number;
  isActive: boolean;
}

export interface ForumPost {
  id: string;
  categoryId: string;
  category?: ForumCategory;
  authorId: string;
  author?: ForumAuthor;
  title: string;
  content: string;
  contentHtml: string;
  tags: string[];
  isPinned: boolean;
  isLocked: boolean;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  status: PostStatus;
  createdAt: Date;
  updatedAt: Date;
  isLiked?: boolean;
}

export interface ForumAuthor {
  id: string;
  firstName: string;
  lastName: string;
  tier: DriverTier;
  avatarUrl?: string;
  badgeCount: number;
}

export enum PostStatus {
  DRAFT = "DRAFT",
  PENDING = "PENDING",
  PUBLISHED = "PUBLISHED",
  HIDDEN = "HIDDEN",
  REMOVED = "REMOVED",
}

export interface ForumComment {
  id: string;
  postId: string;
  authorId: string;
  author?: ForumAuthor;
  parentId?: string;
  content: string;
  contentHtml: string;
  likeCount: number;
  status: PostStatus;
  createdAt: Date;
  replies?: ForumComment[];
  isLiked?: boolean;
}

export interface CreatePostInput {
  categoryId: string;
  title: string;
  content: string;
  tags?: string[];
}

export interface CreateCommentInput {
  postId: string;
  parentId?: string;
  content: string;
}

export interface DriverEvent {
  id: string;
  name: string;
  description: string;
  eventType: DriverEventType;
  city: string;
  venue: string;
  address: string;
  latitude?: number;
  longitude?: number;
  isVirtual: boolean;
  virtualUrl?: string;
  startTime: Date;
  endTime: Date;
  maxAttendees?: number;
  currentAttendees: number;
  minTier?: string;
  imageUrl?: string;
  isActive: boolean;
  registration?: EventRegistration;
}

export enum DriverEventType {
  MEETUP = "MEETUP",
  TRAINING = "TRAINING",
  CELEBRATION = "CELEBRATION",
  FEEDBACK = "FEEDBACK",
  TOWN_HALL = "TOWN_HALL",
  WEBINAR = "WEBINAR",
}

// Alias for backward compatibility
export type EventType = DriverEventType;
export const EventType = DriverEventType;

export interface EventRegistration {
  id: string;
  eventId: string;
  driverId: string;
  status: EventRegistrationStatus;
  checkedInAt?: Date;
}

export enum EventRegistrationStatus {
  REGISTERED = "REGISTERED",
  WAITLIST = "WAITLIST",
  CHECKED_IN = "CHECKED_IN",
  NO_SHOW = "NO_SHOW",
  CANCELLED = "CANCELLED",
}

// Alternative registration status enum used in community service
export enum RegistrationStatus {
  REGISTERED = "REGISTERED",
  WAITLISTED = "WAITLISTED",
  CHECKED_IN = "CHECKED_IN",
  NO_SHOW = "NO_SHOW",
  CANCELLED = "CANCELLED",
}

export interface MentorshipPair {
  id: string;
  mentorId: string;
  mentor?: DriverProfile;
  menteeId: string;
  mentee?: DriverProfile;
  status: MentorshipStatus;
  startedAt?: Date;
  endedAt?: Date;
  sessionsCompleted: number;
  targetSessions: number;
  goals: string[];
  notes?: string;
}

export enum MentorshipStatus {
  PENDING = "PENDING",
  ACTIVE = "ACTIVE",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
}

export interface DriverOfMonth {
  driverId: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  tier: DriverTier;
  trips: number;
  rating: number;
  city: string;
  month: string;
  story?: string;
}

export type LeaderboardPeriod = "DAILY" | "WEEKLY" | "MONTHLY" | "ALL_TIME";

// Export LeaderboardPeriod values for runtime use
export const LeaderboardPeriod = {
  DAILY: "DAILY" as const,
  WEEKLY: "WEEKLY" as const,
  MONTHLY: "MONTHLY" as const,
  ALL_TIME: "ALL_TIME" as const,
};

export interface DriverLeaderboard {
  type: string;
  period: LeaderboardPeriod;
  city?: string;
  entries: LeaderboardEntry[];
  lastUpdated: Date;
}

// -----------------------------------------
// FLEET OWNER TYPES
// -----------------------------------------

export enum ApplicationStatus {
  PENDING = "PENDING",
  UNDER_REVIEW = "UNDER_REVIEW",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
}

export enum BusinessType {
  INDIVIDUAL = "INDIVIDUAL",
  PARTNERSHIP = "PARTNERSHIP",
  LIMITED_COMPANY = "LIMITED_COMPANY",
  COOPERATIVE = "COOPERATIVE",
}

export enum FleetStatus {
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  SUSPENDED = "SUSPENDED",
  TERMINATED = "TERMINATED",
}

// Alias for backward compatibility
export type FleetOwnerStatus = FleetStatus;
export const FleetOwnerStatus = FleetStatus;

export enum FleetTier {
  STARTER = "STARTER",
  BRONZE = "BRONZE",
  SILVER = "SILVER",
  GOLD = "GOLD",
  PLATINUM = "PLATINUM",
}

export interface FleetOwner {
  id: string;
  ownerId: string;
  businessName: string;
  businessType: BusinessType;
  registrationNumber?: string;
  taxId?: string;
  status: FleetStatus;
  approvedAt?: Date;
  fleetTier: FleetTier;
  commissionRate: number;
  vehicleCount: number;
  activeDrivers: number;
  contactEmail: string;
  contactPhone: string;
}

export interface FleetApplication {
  driverId: string;
  businessName: string;
  businessType: BusinessType;
  registrationNumber?: string;
  taxId?: string;
  contactEmail: string;
  contactPhone: string;
  plannedVehicles: number;
  businessPlan?: string;
}

export interface FleetDashboard {
  fleet: FleetOwner;
  vehicles: FleetVehicle[];
  drivers: FleetDriver[];
  todayStats: FleetStats;
  weekStats: FleetStats;
  monthStats: FleetStats;
  alerts: FleetAlert[];
  upcomingMaintenance: VehicleMaintenance[];
}

export interface FleetStats {
  totalTrips: number;
  grossEarnings: number;
  netEarnings: number;
  activeVehicles: number;
  activeDrivers: number;
  averageRating: number;
  onlineHours: number;
}

export interface FleetEarningsBreakdown {
  date: Date;
  totalEarnings: number;
  ownerShare: number;
  driverShare: number;
  platformFee: number;
  trips: number;
}

export interface FleetEarnings {
  fleetId: string;
  period: {
    start: Date;
    end: Date;
  };
  totalEarnings: number;
  ownerShare: number;
  totalTrips: number;
  dailyBreakdown: FleetEarningsBreakdown[];
  vehicleBreakdown: any[];
  driverBreakdown: any[];
}

export interface FleetAlert {
  id: string;
  type: FleetAlertType;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  vehicleId?: string;
  driverId?: string;
  createdAt: Date;
  acknowledgedAt?: Date;
}

export enum FleetAlertType {
  INSURANCE_EXPIRING = "INSURANCE_EXPIRING",
  MAINTENANCE_DUE = "MAINTENANCE_DUE",
  DRIVER_INACTIVE = "DRIVER_INACTIVE",
  LOW_RATING = "LOW_RATING",
  DOCUMENT_EXPIRING = "DOCUMENT_EXPIRING",
  VEHICLE_OFFLINE = "VEHICLE_OFFLINE",
}

export interface FleetVehicle {
  id: string;
  fleetId: string;
  make: string;
  model: string;
  year: number;
  color: string;
  plateNumber: string;
  vin?: string;
  vehicleType: VehicleType;
  fuelType: FuelType;
  seatingCapacity: number;
  status: VehicleStatus;
  assignedDriverId?: string;
  assignedDriver?: FleetDriver;
  currentLocation?: { lat: number; lng: number };
  lastLocationAt?: Date;
  odometer: number;
  insuranceExpiry?: Date;
  inspectionExpiry?: Date;
  todayTrips?: number;
  todayEarnings?: number;
}

export enum VehicleType {
  SEDAN = "SEDAN",
  SUV = "SUV",
  HATCHBACK = "HATCHBACK",
  MINIVAN = "MINIVAN",
  MOTORCYCLE = "MOTORCYCLE",
  TRICYCLE = "TRICYCLE",
  CARGO_VAN = "CARGO_VAN",
  TRUCK = "TRUCK",
}

export enum FuelType {
  PETROL = "PETROL",
  DIESEL = "DIESEL",
  CNG = "CNG",
  ELECTRIC = "ELECTRIC",
  HYBRID = "HYBRID",
}

export enum VehicleStatus {
  PENDING_APPROVAL = "PENDING_APPROVAL",
  ACTIVE = "ACTIVE",
  MAINTENANCE = "MAINTENANCE",
  INACTIVE = "INACTIVE",
  DECOMMISSIONED = "DECOMMISSIONED",
}

// Alias for backward compatibility
export enum FleetVehicleStatus {
  PENDING = "PENDING",
  ACTIVE = "ACTIVE",
  MAINTENANCE = "MAINTENANCE",
  INACTIVE = "INACTIVE",
  DECOMMISSIONED = "DECOMMISSIONED",
}

export interface FleetDriver {
  id: string;
  fleetId: string;
  driverId: string;
  driver?: DriverProfile;
  vehicleId?: string;
  vehicle?: FleetVehicle;
  assignedAt: Date;
  status: FleetDriverStatus;
  revenueSharePercent: number;
  weeklyTarget?: number;
  monthlyTrips: number;
  monthlyEarnings: number;
}

export enum FleetDriverStatus {
  ACTIVE = "ACTIVE",
  SUSPENDED = "SUSPENDED",
  TERMINATED = "TERMINATED",
}

export interface AddVehicleInput {
  make: string;
  model: string;
  year: number;
  color: string;
  plateNumber: string;
  vin?: string;
  vehicleType: VehicleType;
  fuelType: FuelType;
  seatingCapacity: number;
  registrationDoc?: string;
  insuranceDoc?: string;
}

export interface AssignDriverInput {
  vehicleId: string;
  driverId: string;
  revenueSharePercent: number;
  weeklyTarget?: number;
}

export interface VehicleMaintenance {
  id: string;
  vehicleId: string;
  vehicle?: FleetVehicle;
  maintenanceType: MaintenanceType;
  description: string;
  scheduledDate?: Date;
  completedDate?: Date;
  cost?: number;
  currency?: string;
  provider?: string;
  odometerAtService?: number;
  nextServiceOdometer?: number;
  nextServiceDate?: Date;
  status: MaintenanceStatus;
}

export enum MaintenanceType {
  OIL_CHANGE = "OIL_CHANGE",
  TIRE_ROTATION = "TIRE_ROTATION",
  BRAKE_SERVICE = "BRAKE_SERVICE",
  ENGINE_SERVICE = "ENGINE_SERVICE",
  TRANSMISSION = "TRANSMISSION",
  AC_SERVICE = "AC_SERVICE",
  ELECTRICAL = "ELECTRICAL",
  BODY_REPAIR = "BODY_REPAIR",
  INSPECTION = "INSPECTION",
  OTHER = "OTHER",
}

export enum MaintenanceStatus {
  SCHEDULED = "SCHEDULED",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
}

// -----------------------------------------
// SUPPORT TYPES
// -----------------------------------------

export enum SupportCategory {
  EARNINGS = "EARNINGS",
  INCENTIVES = "INCENTIVES",
  ACCOUNT = "ACCOUNT",
  VEHICLE = "VEHICLE",
  PASSENGER = "PASSENGER",
  APP_ISSUE = "APP_ISSUE",
  SAFETY = "SAFETY",
  OTHER = "OTHER",
}

export enum TicketPriority {
  LOW = "LOW",
  NORMAL = "NORMAL",
  HIGH = "HIGH",
  URGENT = "URGENT",
}

export enum TicketStatus {
  OPEN = "OPEN",
  IN_PROGRESS = "IN_PROGRESS",
  WAITING_DRIVER = "WAITING_DRIVER",
  RESOLVED = "RESOLVED",
  CLOSED = "CLOSED",
}

export interface SupportTicket {
  id: string;
  driverId: string;
  category: SupportCategory;
  subcategory?: string;
  subject: string;
  description: string;
  tripId?: string;
  priority: TicketPriority;
  status: TicketStatus;
  assignedTo?: string;
  resolvedAt?: Date;
  satisfactionRating?: number;
  satisfactionComment?: string;
  messages: SupportMessage[];
  createdAt: Date;
}

export interface SupportMessage {
  id: string;
  ticketId: string;
  senderId: string;
  senderType: SenderType;
  message: string;
  attachments: string[];
  createdAt: Date;
}

export enum SenderType {
  DRIVER = "DRIVER",
  SUPPORT_AGENT = "SUPPORT_AGENT",
  SYSTEM = "SYSTEM",
}

export interface CreateTicketInput {
  category: SupportCategory;
  subcategory?: string;
  subject: string;
  description: string;
  tripId?: string;
  attachments?: string[];
}

// -----------------------------------------
// DEMAND & GUIDANCE TYPES
// -----------------------------------------

export interface DemandHeatmap {
  id: string;
  city: string;
  h3Index: string;
  timestamp: Date;
  demandScore: number;
  surgeMultiplier: number;
  estimatedWait: number;
  availableDrivers: number;
  activeTrips: number;
  predictedDemand?: number;
  confidence?: number;
}

export interface HeatmapCell {
  h3Index: string;
  latitude: number;
  longitude: number;
  demandScore: number;
  surgeMultiplier: number;
  color: string;
}

export interface DriverGuidance {
  id: string;
  driverId: string;
  currentH3: string;
  recommendedH3: string;
  distanceKm: number;
  estimatedTimeMinutes: number;
  currentDemand: number;
  targetDemand: number;
  expectedSurge: number;
  expiresAt: Date;
  destination: {
    name: string;
    latitude: number;
    longitude: number;
  };
}

// -----------------------------------------
// SERVICE INTERFACES
// -----------------------------------------

export interface IDriverEarningsService {
  getTodayEarnings(driverId: string): Promise<TodayEarnings>;
  getEarningsHistory(
    driverId: string,
    period: EarningsPeriodType,
    count: number,
  ): Promise<DriverEarnings[]>;
  getTripsForPeriod(
    driverId: string,
    start: Date,
    end: Date,
  ): Promise<TripEarning[]>;
  getEarningsSuggestions(driverId: string): Promise<EarningSuggestion[]>;
  calculateEarningsProjection(driverId: string): Promise<EarningsProjection>;
}

export interface EarningsProjection {
  dailyProjection: number;
  weeklyProjection: number;
  monthlyProjection: number;
  basedOnHours: number;
  confidence: number;
}

export interface IDriverGoalsService {
  getActiveGoals(driverId: string): Promise<DriverGoalProgress[]>;
  createGoal(input: CreateGoalInput): Promise<DriverGoal>;
  updateGoalProgress(
    driverId: string,
    goalId: string,
    value: number,
  ): Promise<DriverGoalProgress>;
  claimReward(driverId: string, goalId: string): Promise<boolean>;
  getSuggestedGoals(driverId: string): Promise<CreateGoalInput[]>;
}

export interface IIncentiveService {
  getAvailableIncentives(driverId: string): Promise<DriverIncentive[]>;
  getIncentiveProgress(
    driverId: string,
    incentiveId: string,
  ): Promise<DriverIncentiveProgress>;
  processTripForIncentives(
    driverId: string,
    trip: TripEarning,
  ): Promise<IncentiveUpdate[]>;
  getActiveStreaks(driverId: string): Promise<DriverStreak[]>;
  updateStreak(driverId: string, streakType: StreakType): Promise<DriverStreak>;
}

export interface IDriverBenefitsService {
  getAvailableBenefits(driverId: string): Promise<DriverBenefitPackage[]>;
  enrollInBenefit(
    driverId: string,
    packageId: string,
    options?: EnrollmentOptions,
  ): Promise<BenefitEnrollment>;
  cancelEnrollment(driverId: string, enrollmentId: string): Promise<boolean>;
  submitClaim(
    driverId: string,
    enrollmentId: string,
    claim: ClaimInput,
  ): Promise<BenefitClaim>;
  getFuelDiscount(driverId: string): Promise<FuelDiscount>;
  getNearbyFuelStations(
    latitude: number,
    longitude: number,
  ): Promise<FuelStation[]>;
}

export interface EnrollmentOptions {
  billingCycle?: BillingCycle;
  dependents?: Dependent[];
  autoRenew?: boolean;
}

export interface ClaimInput {
  claimType: string;
  description: string;
  amount: number;
  incidentDate: Date;
  documents: string[];
}

export interface IDriverCareerService {
  getCareerStatus(driverId: string): Promise<CareerStatus>;
  getProfile(driverId: string): Promise<DriverProfile>;
  updateProfile(
    driverId: string,
    updates: Partial<DriverProfile>,
  ): Promise<DriverProfile>;
  checkTierPromotion(driverId: string): Promise<TierPromotionResult>;
  getLeaderboard(
    city: string,
    period: "week" | "month",
  ): Promise<LeaderboardEntry[]>;
}

export interface TierPromotionResult {
  eligible: boolean;
  currentTier: DriverTier;
  nextTier?: DriverTier;
  reason?: string;
  promoted?: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  driverId: string;
  firstName: string;
  tier: DriverTier;
  trips: number;
  earnings: number;
  rating: number;
  isCurrentUser: boolean;
}

export interface ITrainingService {
  getAvailableModules(driverId: string): Promise<DriverTrainingModule[]>;
  startModule(driverId: string, moduleId: string): Promise<TrainingCompletion>;
  updateProgress(
    driverId: string,
    moduleId: string,
    progress: number,
  ): Promise<TrainingCompletion>;
  submitAssessment(
    driverId: string,
    moduleId: string,
    answers: number[],
  ): Promise<AssessmentResult>;
  getCertifications(driverId: string): Promise<DriverCertification[]>;
  getBadges(driverId: string): Promise<DriverBadge[]>;
}

export interface AssessmentResult {
  passed: boolean;
  score: number;
  passingScore: number;
  correctAnswers: number;
  totalQuestions: number;
  certification?: DriverCertification;
  reward?: { type: string; value: unknown };
}

export interface ICommunityService {
  getCategories(): Promise<ForumCategory[]>;
  getPosts(categoryId: string, page: number): Promise<ForumPost[]>;
  getPost(postId: string): Promise<ForumPost>;
  createPost(driverId: string, input: CreatePostInput): Promise<ForumPost>;
  createComment(
    driverId: string,
    input: CreateCommentInput,
  ): Promise<ForumComment>;
  likePost(driverId: string, postId: string): Promise<boolean>;
  getEvents(driverId: string, city: string): Promise<DriverEvent[]>;
  registerForEvent(
    driverId: string,
    eventId: string,
  ): Promise<EventRegistration>;
  getDriverOfMonth(city: string): Promise<DriverOfMonth>;
  getMentorship(driverId: string): Promise<MentorshipPair | null>;
  applyForMentorship(
    driverId: string,
    asMentor: boolean,
  ): Promise<MentorshipPair>;
}

export interface IFleetOwnerService {
  applyForFleetProgram(
    driverId: string,
    application: FleetApplication,
  ): Promise<FleetOwner>;
  getFleetDashboard(ownerId: string): Promise<FleetDashboard>;
  addVehicle(ownerId: string, vehicle: AddVehicleInput): Promise<FleetVehicle>;
  updateVehicle(
    ownerId: string,
    vehicleId: string,
    updates: Partial<FleetVehicle>,
  ): Promise<FleetVehicle>;
  removeVehicle(ownerId: string, vehicleId: string): Promise<boolean>;
  assignDriver(ownerId: string, input: AssignDriverInput): Promise<FleetDriver>;
  unassignDriver(ownerId: string, driverId: string): Promise<boolean>;
  getFleetEarnings(
    ownerId: string,
    period: "week" | "month",
  ): Promise<FleetEarnings>;
  scheduleMaintenance(
    ownerId: string,
    vehicleId: string,
    maintenance: Partial<VehicleMaintenance>,
  ): Promise<VehicleMaintenance>;
}

export interface IDemandService {
  getHeatmap(city: string): Promise<HeatmapCell[]>;
  getGuidance(driverId: string): Promise<DriverGuidance | null>;
  recordGuidanceFollowed(guidanceId: string, followed: boolean): Promise<void>;
  getSurgeAreas(city: string): Promise<SurgeArea[]>;
}

export interface SurgeArea {
  h3Index: string;
  name: string;
  surgeMultiplier: number;
  estimatedDuration: number;
  reason?: string;
}

// -----------------------------------------
// ANALYTICS EVENT TYPES
// -----------------------------------------

export interface DriverAnalyticsEvent {
  eventName: string;
  eventCategory: AnalyticsCategory;
  eventProperties: Record<string, unknown>;
  sessionId?: string;
  timestamp: Date;
}

export enum AnalyticsCategory {
  EARNINGS = "earnings",
  INCENTIVES = "incentives",
  BENEFITS = "benefits",
  CAREER = "career",
  TRAINING = "training",
  COMMUNITY = "community",
  FLEET = "fleet",
  NAVIGATION = "navigation",
}

// Analytics events
export const DRIVER_EVENTS = {
  // Earnings
  EARNINGS_VIEWED: "earnings_viewed",
  TRIP_COMPLETED: "trip_completed",
  GOAL_CREATED: "goal_created",
  GOAL_ACHIEVED: "goal_achieved",

  // Incentives
  INCENTIVE_VIEWED: "incentive_viewed",
  INCENTIVE_PROGRESS: "incentive_progress",
  INCENTIVE_COMPLETED: "incentive_completed",
  STREAK_MAINTAINED: "streak_maintained",
  STREAK_BROKEN: "streak_broken",

  // Benefits
  BENEFIT_VIEWED: "benefit_viewed",
  BENEFIT_ENROLLED: "benefit_enrolled",
  CLAIM_SUBMITTED: "claim_submitted",
  FUEL_DISCOUNT_USED: "fuel_discount_used",

  // Career
  TIER_PROMOTED: "tier_promoted",
  CERTIFICATION_EARNED: "certification_earned",
  BADGE_EARNED: "badge_earned",
  TRAINING_STARTED: "training_started",
  TRAINING_COMPLETED: "training_completed",

  // Community
  POST_CREATED: "post_created",
  COMMENT_ADDED: "comment_added",
  EVENT_REGISTERED: "event_registered",
  MENTORSHIP_STARTED: "mentorship_started",

  // Fleet
  FLEET_APPLICATION: "fleet_application",
  VEHICLE_ADDED: "vehicle_added",
  DRIVER_ASSIGNED: "driver_assigned",

  // Guidance
  GUIDANCE_SHOWN: "guidance_shown",
  GUIDANCE_FOLLOWED: "guidance_followed",
  HEATMAP_VIEWED: "heatmap_viewed",
} as const;
