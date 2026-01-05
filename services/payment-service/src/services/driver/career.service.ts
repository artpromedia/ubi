// ===========================================
// UBI Driver Experience Platform
// Career Progression & Training Service
// ===========================================

import {
  BadgeRarity,
  CertificationStatus,
  DRIVER_EVENTS,
  DRIVER_TIERS,
  DriverBadge,
  DriverCertification,
  DriverProfile,
  DriverTier,
  DriverTierHistory,
  IDriverCareerService,
  ITrainingService,
  TierBenefits,
  TierRequirements,
  TrainingCategory,
} from "../../types/driver.types";

// -----------------------------------------
// EXTENDED INTERFACES FOR IMPLEMENTATION
// -----------------------------------------

// Extended DriverProfile with additional computed fields
interface ExtendedDriverProfile extends DriverProfile {
  averageRating?: number;
  acceptanceRate?: number;
  completionRate?: number;
  cancellationRate?: number;
  totalPoints?: number;
  onlineHours?: number;
  currentStreak?: number;
  longestStreak?: number;
  badgeCount?: number;
  certificationsCount?: number;
  memberSince?: Date;
  tierAchievedAt?: Date;
  tenureDays?: number;
  monthlyTrips?: number;
}

// Extended TierProgress with metrics array
interface ExtendedTierProgress {
  currentTier: DriverTier;
  nextTier: DriverTier | null;
  currentTierConfig: any;
  nextTierConfig: any;
  metrics: Array<{
    name: string;
    current: number;
    required: number;
    progress: number;
  }>;
  overallProgress: number;
  estimatedDaysToNextTier?: number;
}

// Extended DriverCertification with code property
interface ExtendedDriverCertification extends Omit<DriverCertification, 'certificationCode'> {
  code: string;
  category: TrainingCategory;
  status: CertificationStatus;
}

// Extended TrainingModule with additional fields
interface ExtendedTrainingModule {
  id: string;
  code?: string;
  title: string;
  description: string;
  category: TrainingCategory;
  durationMinutes: number;
  thumbnailUrl?: string;
  videoUrl?: string;
  contentUrl: string;
  lessons?: any[];
  hasQuiz: boolean;
  passingScore: number;
  pointsReward?: number;
  certificationCode?: string;
  certificationName?: string;
  requiredTier?: DriverTier;
  prerequisites?: string[];
  orderIndex?: number;
  isActive: boolean;
  completion?: ExtendedTrainingCompletion;
}

// Extended TrainingCompletion with additional fields
interface ExtendedTrainingCompletion {
  id: string;
  driverId: string;
  moduleId: string;
  startedAt?: Date;
  completedAt?: Date;
  progress: number;
  quizScore?: number;
  passed: boolean;
  attempts?: number;
  lastAccessedAt?: Date;
  lastLessonId?: string;
}

// Extended DriverBadge with code and additional fields
interface ExtendedDriverBadge extends DriverBadge {
  code: string;
  category: string;
  rarity: BadgeRarity;
  points: number;
}

// -----------------------------------------
// TIER CONFIGURATION
// -----------------------------------------

// Extended interface for internal use with more detailed requirements
interface ExtendedTierRequirements extends TierRequirements {
  minAcceptanceRate?: number;
  minCompletionRate?: number;
  minTenureDays?: number;
  requiredCertifications?: string[];
}

const TIER_REQUIREMENTS: Record<DriverTier, ExtendedTierRequirements> = {
  [DriverTier.STARTER]: {
    trips: 0,
    rating: 0,
    minAcceptanceRate: 0,
    minCompletionRate: 0,
    minTenureDays: 0,
  },
  [DriverTier.BRONZE]: {
    trips: 100,
    rating: 4.5,
    minAcceptanceRate: 80,
    minCompletionRate: 90,
    minTenureDays: 30,
    requiredCertifications: ["safety_basics"],
  },
  [DriverTier.SILVER]: {
    trips: 500,
    rating: 4.6,
    minAcceptanceRate: 85,
    minCompletionRate: 92,
    minTenureDays: 90,
    requiredCertifications: ["safety_basics", "customer_service"],
  },
  [DriverTier.GOLD]: {
    trips: 1500,
    rating: 4.7,
    minAcceptanceRate: 88,
    minCompletionRate: 95,
    minTenureDays: 180,
    requiredCertifications: [
      "safety_basics",
      "customer_service",
      "vehicle_care",
    ],
  },
  [DriverTier.PLATINUM]: {
    trips: 3000,
    rating: 4.8,
    minAcceptanceRate: 90,
    minCompletionRate: 97,
    minTenureDays: 365,
    requiredCertifications: [
      "safety_basics",
      "customer_service",
      "vehicle_care",
      "advanced_navigation",
    ],
  },
  [DriverTier.DIAMOND]: {
    trips: 5000,
    rating: 4.9,
    minAcceptanceRate: 92,
    minCompletionRate: 98,
    minTenureDays: 730,
    requiredCertifications: [
      "safety_basics",
      "customer_service",
      "vehicle_care",
      "advanced_navigation",
      "mentorship",
    ],
  },
};

// -----------------------------------------
// BADGE DEFINITIONS
// -----------------------------------------

// Extended badge definition for internal use
interface BadgeDefinition {
  name: string;
  description: string;
  category: string;
  iconUrl: string;
  rarity: BadgeRarity;
  points: number;
}

const BADGE_DEFINITIONS: Record<string, BadgeDefinition> = {
  // Trip Milestones
  first_trip: {
    name: "First Trip",
    description: "Completed your first trip",
    category: "milestone",
    iconUrl: "/badges/first_trip.png",
    rarity: BadgeRarity.COMMON,
    points: 10,
  },
  century: {
    name: "Century Club",
    description: "Completed 100 trips",
    category: "milestone",
    iconUrl: "/badges/century.png",
    rarity: BadgeRarity.COMMON,
    points: 50,
  },
  five_hundred: {
    name: "Road Warrior",
    description: "Completed 500 trips",
    category: "milestone",
    iconUrl: "/badges/road_warrior.png",
    rarity: BadgeRarity.UNCOMMON,
    points: 100,
  },
  thousand: {
    name: "Elite Driver",
    description: "Completed 1,000 trips",
    category: "milestone",
    iconUrl: "/badges/elite.png",
    rarity: BadgeRarity.RARE,
    points: 200,
  },
  five_thousand: {
    name: "Legendary Driver",
    description: "Completed 5,000 trips",
    category: "milestone",
    iconUrl: "/badges/legendary.png",
    rarity: BadgeRarity.EPIC,
    points: 500,
  },
  ten_thousand: {
    name: "Master Driver",
    description: "Completed 10,000 trips",
    category: "milestone",
    iconUrl: "/badges/master.png",
    rarity: BadgeRarity.LEGENDARY,
    points: 1000,
  },

  // Rating Badges
  five_star: {
    name: "Five Star",
    description: "Maintained 5.0 rating for 50+ trips",
    category: "rating",
    iconUrl: "/badges/five_star.png",
    rarity: BadgeRarity.RARE,
    points: 150,
  },
  perfect_week: {
    name: "Perfect Week",
    description: "Received only 5-star ratings for a week",
    category: "rating",
    iconUrl: "/badges/perfect_week.png",
    rarity: BadgeRarity.UNCOMMON,
    points: 75,
  },

  // Streak Badges
  streak_7: {
    name: "Week Warrior",
    description: "7-day active streak",
    category: "streak",
    iconUrl: "/badges/streak_7.png",
    rarity: BadgeRarity.COMMON,
    points: 25,
  },
  streak_30: {
    name: "Monthly Master",
    description: "30-day active streak",
    category: "streak",
    iconUrl: "/badges/streak_30.png",
    rarity: BadgeRarity.UNCOMMON,
    points: 100,
  },
  streak_90: {
    name: "Quarterly Champion",
    description: "90-day active streak",
    category: "streak",
    iconUrl: "/badges/streak_90.png",
    rarity: BadgeRarity.RARE,
    points: 300,
  },

  // Special Badges
  night_owl: {
    name: "Night Owl",
    description: "Completed 100+ trips between 10 PM - 6 AM",
    category: "special",
    iconUrl: "/badges/night_owl.png",
    rarity: BadgeRarity.UNCOMMON,
    points: 75,
  },
  early_bird: {
    name: "Early Bird",
    description: "Completed 100+ trips between 5 AM - 8 AM",
    category: "special",
    iconUrl: "/badges/early_bird.png",
    rarity: BadgeRarity.UNCOMMON,
    points: 75,
  },
  mentor: {
    name: "Mentor",
    description: "Successfully mentored 10 new drivers",
    category: "community",
    iconUrl: "/badges/mentor.png",
    rarity: BadgeRarity.EPIC,
    points: 250,
  },
  community_leader: {
    name: "Community Leader",
    description: "Organized 5+ driver meetups",
    category: "community",
    iconUrl: "/badges/community_leader.png",
    rarity: BadgeRarity.EPIC,
    points: 300,
  },
  ev_pioneer: {
    name: "EV Pioneer",
    description: "Completed 1,000 trips in an electric vehicle",
    category: "special",
    iconUrl: "/badges/ev_pioneer.png",
    rarity: BadgeRarity.RARE,
    points: 200,
  },
};

// -----------------------------------------
// CAREER SERVICE
// -----------------------------------------

class DriverCareerService implements IDriverCareerService {
  constructor(
    private db: any,
    private notificationService: any,
    private analyticsService: any
  ) {}

  // -----------------------------------------
  // PROFILE MANAGEMENT
  // -----------------------------------------

  async getDriverProfile(driverId: string): Promise<ExtendedDriverProfile | null> {
    const profile = await this.db.driverProfile.findUnique({
      where: { driverId },
      include: {
        tierHistory: {
          orderBy: { achievedAt: "desc" },
          take: 1,
        },
      },
    });

    if (!profile) return null;

    // Get driver base info
    const driver = await this.db.driver.findUnique({
      where: { id: driverId },
    });

    // Calculate current stats
    const stats = await this.calculateDriverStats(driverId);

    return {
      id: profile.id,
      driverId: profile.driverId,
      currentTier: profile.currentTier as DriverTier,
      tierSince: profile.tierHistory[0]?.achievedAt || profile.createdAt,
      tierProgress: 0,
      lifetimeTrips: profile.lifetimeTrips,
      lifetimeEarnings: parseFloat(profile.lifetimeEarnings),
      lifetimeRating: parseFloat(profile.averageRating || "5"),
      totalRatings: profile.totalRatings,
      commissionRate: 0.25,
      preferredAreas: [],
      onlineStatus: profile.onlineStatus || "OFFLINE",
      certifications: [],
      badges: [],
      // Extended fields
      averageRating: parseFloat(profile.averageRating || "0"),
      acceptanceRate: parseFloat(profile.acceptanceRate || "0"),
      completionRate: parseFloat(profile.completionRate || "0"),
      cancellationRate: parseFloat(profile.cancellationRate || "0"),
      totalPoints: profile.totalPoints || 0,
      onlineHours: parseFloat(profile.onlineHours || "0"),
      currentStreak: profile.currentStreak || 0,
      longestStreak: profile.longestStreak || 0,
      badgeCount: profile.badgeCount || 0,
      certificationsCount: profile.certificationsCount || 0,
      memberSince: driver?.createdAt || profile.createdAt,
      tierAchievedAt: profile.tierHistory[0]?.achievedAt || profile.createdAt,
      ...stats,
    } as ExtendedDriverProfile;
  }

  async createOrUpdateProfile(
    driverId: string,
    data: Partial<ExtendedDriverProfile>
  ): Promise<ExtendedDriverProfile> {
    const existing = await this.db.driverProfile.findUnique({
      where: { driverId },
    });

    await (existing
      ? this.db.driverProfile.update({
          where: { driverId },
          data: {
            currentTier: data.currentTier,
            lifetimeTrips: data.lifetimeTrips,
            lifetimeEarnings: data.lifetimeEarnings,
          },
        })
      : this.db.driverProfile.create({
          data: {
            driverId,
            currentTier: DriverTier.STARTER,
            lifetimeTrips: 0,
            lifetimeEarnings: 0,
            totalRatings: 0,
          },
        }));

    return this.getDriverProfile(driverId) as Promise<ExtendedDriverProfile>;
  }

  // -----------------------------------------
  // TIER MANAGEMENT
  // -----------------------------------------

  async getTierProgress(driverId: string): Promise<ExtendedTierProgress> {
    const profile = await this.getDriverProfile(driverId);
    if (!profile) {
      throw new Error("Driver profile not found");
    }

    const currentTierConfig = DRIVER_TIERS[profile.currentTier];
    const tierOrder = Object.values(DriverTier);
    const currentIndex = tierOrder.indexOf(profile.currentTier);
    const nextTier =
      currentIndex < tierOrder.length - 1 ? tierOrder[currentIndex + 1] : null;

    // Calculate progress metrics
    const progressMetrics: Array<{
      name: string;
      current: number;
      required: number;
      progress: number;
    }> = [];

    if (nextTier) {
      const nextRequirements = TIER_REQUIREMENTS[nextTier];
      const certifications = await this.getDriverCertifications(driverId);
      const certCodes = certifications.map((c) => c.code);

      // Trips progress
      progressMetrics.push({
        name: "Trips Completed",
        current: profile.lifetimeTrips,
        required: nextRequirements.trips,
        progress: Math.min(
          100,
          (profile.lifetimeTrips / nextRequirements.trips) * 100
        ),
      });

      // Rating progress
      progressMetrics.push({
        name: "Average Rating",
        current: profile.averageRating || 0,
        required: nextRequirements.rating,
        progress:
          (profile.averageRating || 0) >= nextRequirements.rating
            ? 100
            : ((profile.averageRating || 0) / nextRequirements.rating) * 100,
      });

      // Acceptance rate progress
      if (nextRequirements.minAcceptanceRate) {
        progressMetrics.push({
          name: "Acceptance Rate",
          current: profile.acceptanceRate || 0,
          required: nextRequirements.minAcceptanceRate,
          progress:
            (profile.acceptanceRate || 0) >= nextRequirements.minAcceptanceRate
              ? 100
              : ((profile.acceptanceRate || 0) / nextRequirements.minAcceptanceRate) *
                100,
        });
      }

      // Completion rate progress
      if (nextRequirements.minCompletionRate) {
        progressMetrics.push({
          name: "Completion Rate",
          current: profile.completionRate || 0,
          required: nextRequirements.minCompletionRate,
          progress:
            (profile.completionRate || 0) >= nextRequirements.minCompletionRate
              ? 100
              : ((profile.completionRate || 0) / nextRequirements.minCompletionRate) *
                100,
        });
      }

      // Certifications progress
      if (nextRequirements.requiredCertifications) {
        const completedCerts = nextRequirements.requiredCertifications.filter(
          (c: string) => certCodes.includes(c)
        ).length;
        const totalRequired = nextRequirements.requiredCertifications.length;

        progressMetrics.push({
          name: "Certifications",
          current: completedCerts,
          required: totalRequired,
          progress: (completedCerts / totalRequired) * 100,
        });
      }
    }

    // Overall progress
    const overallProgress =
      progressMetrics.length > 0
        ? progressMetrics.reduce((sum: number, m: any) => sum + m.progress, 0) /
          progressMetrics.length
        : 100;

    return {
      currentTier: profile.currentTier,
      nextTier: nextTier || null,
      currentTierConfig,
      nextTierConfig: nextTier ? DRIVER_TIERS[nextTier] : null,
      metrics: progressMetrics,
      overallProgress,
      estimatedDaysToNextTier: this.estimateDaysToNextTier(profile, nextTier || null),
    };
  }

  async checkTierUpgrade(driverId: string): Promise<DriverTier | null> {
    const profile = await this.getDriverProfile(driverId);
    if (!profile) return null;

    const tierOrder = Object.values(DriverTier);
    const currentIndex = tierOrder.indexOf(profile.currentTier);

    // Check each tier above current
    for (let i = currentIndex + 1; i < tierOrder.length; i++) {
      const tier = tierOrder[i] as DriverTier;
      const requirements = TIER_REQUIREMENTS[tier];

      if (await this.meetsRequirements(profile, requirements, driverId)) {
        // Check if driver meets all requirements
        continue;
      }

      // Return the highest tier they qualify for (one above current)
      if (i > currentIndex + 1) {
        return tierOrder[i - 1] as DriverTier;
      }
      return null;
    }

    // If they passed all checks, they qualify for max tier
    if (currentIndex < tierOrder.length - 1) {
      return tierOrder[tierOrder.length - 1] as DriverTier;
    }

    return null;
  }

  async upgradeTier(driverId: string, newTier: DriverTier): Promise<boolean> {
    const profile = await this.getDriverProfile(driverId);
    if (!profile) return false;

    const tierOrder = Object.values(DriverTier);
    const currentIndex = tierOrder.indexOf(profile.currentTier);
    const newIndex = tierOrder.indexOf(newTier);

    // Can only upgrade
    if (newIndex <= currentIndex) {
      return false;
    }

    // Update profile
    await this.db.driverProfile.update({
      where: { driverId },
      data: { currentTier: newTier },
    });

    // Record history
    await this.db.driverTierHistory.create({
      data: {
        driverId,
        tier: newTier,
        previousTier: profile.currentTier,
        achievedAt: new Date(),
        tripsAtUpgrade: profile.lifetimeTrips,
        ratingAtUpgrade: profile.averageRating,
        earningsAtUpgrade: profile.lifetimeEarnings,
      },
    });

    // Award tier badge
    await this.awardTierBadge(driverId, newTier);

    // Send notification
    const tierConfig = DRIVER_TIERS[newTier];
    await this.notificationService?.send({
      userId: driverId,
      title: `🎉 Congratulations! You're now ${newTier}!`,
      body: `You've unlocked ${tierConfig.benefits.commissionRate * 100}% commission and amazing new benefits!`,
      data: { type: "tier_upgrade", newTier },
    });

    // Track analytics
    this.trackEvent(driverId, DRIVER_EVENTS.TIER_PROMOTED, {
      previousTier: profile.currentTier,
      newTier,
      lifetimeTrips: profile.lifetimeTrips,
    });

    return true;
  }

  async getTierHistory(driverId: string): Promise<DriverTierHistory[]> {
    const history = await this.db.driverTierHistory.findMany({
      where: { driverId },
      orderBy: { achievedAt: "desc" },
    });

    return history.map((h: any) => ({
      id: h.id,
      driverId: h.driverId,
      tier: h.tier as DriverTier,
      previousTier: h.previousTier as DriverTier | undefined,
      achievedAt: h.achievedAt,
      tripsAtUpgrade: h.tripsAtUpgrade,
      ratingAtUpgrade: parseFloat(h.ratingAtUpgrade),
      earningsAtUpgrade: parseFloat(h.earningsAtUpgrade),
    }));
  }

  async getTierRequirements(tier: DriverTier): Promise<TierRequirements> {
    return TIER_REQUIREMENTS[tier];
  }

  async getTierBenefits(tier: DriverTier): Promise<TierBenefits> {
    const config = DRIVER_TIERS[tier];
    return config.benefits;
  }

  // -----------------------------------------
  // BADGES
  // -----------------------------------------

  async awardBadge(
    driverId: string,
    badgeCode: string
  ): Promise<ExtendedDriverBadge | null> {
    // Check if already has badge
    const existing = await this.db.driverBadge.findUnique({
      where: {
        driverId_badgeCode: { driverId, badgeCode },
      },
    });

    if (existing) return null;

    // Get badge definition
    const definition = BADGE_DEFINITIONS[badgeCode];
    if (!definition) {
      throw new Error(`Unknown badge: ${badgeCode}`);
    }

    // Create badge
    const badge = await this.db.driverBadge.create({
      data: {
        driverId,
        badgeCode,
        name: definition.name,
        description: definition.description,
        iconUrl: definition.iconUrl,
        level: 1,
        maxLevel: 1,
        isDisplayed: true,
        earnedAt: new Date(),
      },
    });

    // Update badge count
    await this.db.driverProfile.update({
      where: { driverId },
      data: {
        badgeCount: { increment: 1 },
      },
    });

    // Send notification
    await this.notificationService?.send({
      userId: driverId,
      title: `🏅 New Badge Earned!`,
      body: `You've earned the "${definition.name}" badge! +${definition.points} points`,
      data: { type: "badge_earned", badgeCode },
    });

    // Track analytics
    this.trackEvent(driverId, DRIVER_EVENTS.BADGE_EARNED, {
      badgeCode,
      badgeName: definition.name,
      rarity: definition.rarity,
      points: definition.points,
    });

    return {
      id: badge.id,
      driverId: badge.driverId,
      badgeCode: badge.badgeCode,
      code: badgeCode,
      name: badge.name,
      description: badge.description,
      category: definition.category,
      iconUrl: badge.iconUrl,
      level: badge.level,
      maxLevel: badge.maxLevel,
      rarity: definition.rarity,
      points: definition.points,
      earnedAt: badge.earnedAt,
      isDisplayed: badge.isDisplayed,
    };
  }

  async getDriverBadges(driverId: string): Promise<DriverBadge[]> {
    const badges = await this.db.driverBadge.findMany({
      where: { driverId },
      orderBy: { earnedAt: "desc" },
    });

    return badges.map((b: any) => ({
      id: b.id,
      driverId: b.driverId,
      badgeCode: b.badgeCode,
      name: b.name,
      description: b.description,
      iconUrl: b.iconUrl,
      level: b.level,
      maxLevel: b.maxLevel,
      earnedAt: b.earnedAt,
      isDisplayed: b.isDisplayed,
    }));
  }

  async checkBadgeEligibility(driverId: string): Promise<string[]> {
    const profile = await this.getDriverProfile(driverId);
    if (!profile) return [];

    const earnedBadges = await this.db.driverBadge.findMany({
      where: { driverId },
      select: { badgeCode: true },
    });
    const earnedCodes = new Set(earnedBadges.map((b: any) => b.badgeCode));

    const eligibleBadges: string[] = [];

    // Check trip milestones
    if (!earnedCodes.has("first_trip") && profile.lifetimeTrips >= 1) {
      eligibleBadges.push("first_trip");
    }
    if (!earnedCodes.has("century") && profile.lifetimeTrips >= 100) {
      eligibleBadges.push("century");
    }
    if (!earnedCodes.has("five_hundred") && profile.lifetimeTrips >= 500) {
      eligibleBadges.push("five_hundred");
    }
    if (!earnedCodes.has("thousand") && profile.lifetimeTrips >= 1000) {
      eligibleBadges.push("thousand");
    }
    if (!earnedCodes.has("five_thousand") && profile.lifetimeTrips >= 5000) {
      eligibleBadges.push("five_thousand");
    }
    if (!earnedCodes.has("ten_thousand") && profile.lifetimeTrips >= 10000) {
      eligibleBadges.push("ten_thousand");
    }

    // Check streak badges
    if (!earnedCodes.has("streak_7") && (profile.longestStreak || 0) >= 7) {
      eligibleBadges.push("streak_7");
    }
    if (!earnedCodes.has("streak_30") && (profile.longestStreak || 0) >= 30) {
      eligibleBadges.push("streak_30");
    }
    if (!earnedCodes.has("streak_90") && (profile.longestStreak || 0) >= 90) {
      eligibleBadges.push("streak_90");
    }

    // Check rating badges (would need more detailed trip data)
    // These would typically be checked after each trip

    return eligibleBadges;
  }

  // -----------------------------------------
  // HELPER METHODS
  // -----------------------------------------

  private async calculateDriverStats(
    driverId: string
  ): Promise<Partial<ExtendedDriverProfile>> {
    // Get recent trip stats
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentTrips = await this.db.tripEarning.findMany({
      where: {
        driverId,
        completedAt: { gte: thirtyDaysAgo },
      },
      select: {
        rating: true,
        completedAt: true,
      },
    });

    // Calculate tenure days
    const driver = await this.db.driver.findUnique({
      where: { id: driverId },
      select: { createdAt: true },
    });

    const tenureDays = driver
      ? Math.floor(
          (Date.now() - driver.createdAt.getTime()) / (1000 * 60 * 60 * 24)
        )
      : 0;

    return {
      tenureDays,
      monthlyTrips: recentTrips.length,
    };
  }

  private async meetsRequirements(
    profile: ExtendedDriverProfile,
    requirements: ExtendedTierRequirements,
    driverId: string
  ): Promise<boolean> {
    // Check basic requirements
    if (profile.lifetimeTrips < requirements.trips) return false;
    if ((profile.averageRating || 0) < requirements.rating) return false;
    if (requirements.minAcceptanceRate && (profile.acceptanceRate || 0) < requirements.minAcceptanceRate) return false;
    if (requirements.minCompletionRate && (profile.completionRate || 0) < requirements.minCompletionRate) return false;
    if (requirements.minTenureDays && (profile.tenureDays || 0) < requirements.minTenureDays) return false;

    // Check certifications
    if (requirements.requiredCertifications?.length) {
      const certifications = await this.getDriverCertifications(driverId);
      const certCodes = certifications
        .filter((c) => c.status === CertificationStatus.ACTIVE)
        .map((c) => c.code);

      for (const required of requirements.requiredCertifications) {
        if (!certCodes.includes(required)) return false;
      }
    }

    return true;
  }

  private estimateDaysToNextTier(
    profile: ExtendedDriverProfile,
    nextTier: DriverTier | null
  ): number | undefined {
    if (!nextTier) return undefined;

    const requirements = TIER_REQUIREMENTS[nextTier];

    // Estimate based on trips (primary bottleneck)
    const tripsNeeded = requirements.trips - profile.lifetimeTrips;
    if (tripsNeeded <= 0) return 0;

    // Assume average of 3 trips/day
    const avgTripsPerDay = 3;
    return Math.ceil(tripsNeeded / avgTripsPerDay);
  }

  private async getDriverCertifications(
    driverId: string
  ): Promise<ExtendedDriverCertification[]> {
    const certifications = await this.db.driverCertification.findMany({
      where: { driverId },
    });

    return certifications.map((c: any) => ({
      id: c.id,
      driverId: c.driverId,
      certificationCode: c.certificationCode,
      code: c.certificationCode,
      name: c.name,
      description: c.description,
      category: c.category as TrainingCategory,
      issuedAt: c.issuedAt,
      expiresAt: c.expiresAt,
      isActive: c.isActive,
      status: c.isActive ? CertificationStatus.ACTIVE : CertificationStatus.EXPIRED,
      certificateUrl: c.certificateUrl,
      verificationCode: c.verificationCode,
    }));
  }

  private async awardTierBadge(
    driverId: string,
    tier: DriverTier
  ): Promise<void> {
    const badgeCodes: Record<DriverTier, string> = {
      [DriverTier.STARTER]: "tier_starter",
      [DriverTier.BRONZE]: "tier_bronze",
      [DriverTier.SILVER]: "tier_silver",
      [DriverTier.GOLD]: "tier_gold",
      [DriverTier.PLATINUM]: "tier_platinum",
      [DriverTier.DIAMOND]: "tier_diamond",
    };

    const badgeCode = badgeCodes[tier];

    // Define tier badges if not in definitions
    const tierBadge = {
      name: `${tier} Tier`,
      description: `Achieved ${tier} tier status`,
      iconUrl: `/badges/tier_${tier.toLowerCase()}.png`,
    };

    await this.db.driverBadge.upsert({
      where: {
        driverId_badgeCode: { driverId, badgeCode },
      },
      update: {},
      create: {
        driverId,
        badgeCode,
        name: tierBadge.name,
        description: tierBadge.description,
        iconUrl: tierBadge.iconUrl,
        level: 1,
        maxLevel: 1,
        isDisplayed: true,
        earnedAt: new Date(),
      },
    });
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

  // Interface compatibility methods
  async getCareerStatus(_driverId: string): Promise<any> {
    throw new Error("Not implemented");
  }

  async getProfile(_driverId: string): Promise<DriverProfile> {
    throw new Error("Not implemented");
  }

  async updateProfile(_driverId: string, _updates: Partial<DriverProfile>): Promise<DriverProfile> {
    throw new Error("Not implemented");
  }

  async checkTierPromotion(_driverId: string): Promise<any> {
    throw new Error("Not implemented");
  }

  async getLeaderboard(_city: string, _period: "week" | "month"): Promise<any[]> {
    throw new Error("Not implemented");
  }
}

// -----------------------------------------
// TRAINING SERVICE
// -----------------------------------------

class TrainingService implements ITrainingService {
  constructor(
    private db: any,
    private notificationService: any,
    private analyticsService: any
  ) {}

  // -----------------------------------------
  // MODULES
  // -----------------------------------------

  async getTrainingModules(
    driverId: string,
    category?: TrainingCategory
  ): Promise<ExtendedTrainingModule[]> {
    const where: any = { isActive: true };
    if (category) where.category = category;

    const modules = await this.db.trainingModule.findMany({
      where,
      orderBy: [{ category: "asc" }, { orderIndex: "asc" }],
    });

    // Get completions for this driver
    const completions = await this.db.trainingCompletion.findMany({
      where: { driverId },
    });
    const completionMap = new Map(completions.map((c: any) => [c.moduleId, c]));

    return modules.map((m: any) => ({
      ...this.mapModule(m),
      completion: completionMap.get(m.id)
        ? this.mapCompletion(completionMap.get(m.id))
        : undefined,
    }));
  }

  async getModuleDetails(moduleId: string): Promise<ExtendedTrainingModule | null> {
    const module = await this.db.trainingModule.findUnique({
      where: { id: moduleId },
    });

    return module ? this.mapModule(module) : null;
  }

  async getRecommendedModules(driverId: string): Promise<ExtendedTrainingModule[]> {
    // Get driver profile
    const profile = await this.db.driverProfile.findUnique({
      where: { driverId },
    });

    // Get completed modules
    const completions = await this.db.trainingCompletion.findMany({
      where: { driverId, passed: true },
    });
    const completedIds = new Set(completions.map((c: any) => c.moduleId));

    // Get all modules
    const allModules = await this.db.trainingModule.findMany({
      where: { isActive: true },
    });

    // Filter and prioritize recommendations
    const recommendations: ExtendedTrainingModule[] = [];

    for (const module of allModules) {
      // Skip completed
      if (completedIds.has(module.id)) continue;

      // Check tier requirements
      if (module.requiredTier) {
        const tierOrder = Object.values(DriverTier);
        const driverTierIndex = tierOrder.indexOf(
          profile?.currentTier || DriverTier.STARTER
        );
        const requiredIndex = tierOrder.indexOf(module.requiredTier);
        if (driverTierIndex < requiredIndex) continue;
      }

      // Check prerequisites
      if (module.prerequisites?.length) {
        const hasPrereqs = module.prerequisites.every((p: string) => {
          const prereqCompletion = completions.find(
            (c: any) => c.moduleCode === p && c.passed
          );
          return !!prereqCompletion;
        });
        if (!hasPrereqs) continue;
      }

      recommendations.push(this.mapModule(module));
    }

    // Sort by priority
    return recommendations
      .sort((a, b) => {
        // Prioritize onboarding for new drivers
        if (profile?.lifetimeTrips < 10) {
          if (a.category === TrainingCategory.ONBOARDING) return -1;
          if (b.category === TrainingCategory.ONBOARDING) return 1;
        }
        // Then safety
        if (a.category === TrainingCategory.SAFETY) return -1;
        if (b.category === TrainingCategory.SAFETY) return 1;
        return 0;
      })
      .slice(0, 5);
  }

  // -----------------------------------------
  // PROGRESS & COMPLETION
  // -----------------------------------------

  async startModule(
    driverId: string,
    moduleId: string
  ): Promise<any> {
    // Check if already started
    const existing = await this.db.trainingCompletion.findUnique({
      where: {
        driverId_moduleId: { driverId, moduleId },
      },
    });

    if (existing) {
      return this.mapCompletion(existing);
    }

    // Create progress record
    const completion = await this.db.trainingCompletion.create({
      data: {
        driverId,
        moduleId,
        startedAt: new Date(),
        progress: 0,
        passed: false,
      },
    });

    // Track analytics
    this.analyticsService?.track({
      userId: driverId,
      event: DRIVER_EVENTS.TRAINING_STARTED,
      properties: { moduleId },
    });

    return this.mapCompletion(completion);
  }

  async updateProgress(
    driverId: string,
    moduleId: string,
    progress: number
  ): Promise<any> {
    const completion = await this.db.trainingCompletion.update({
      where: {
        driverId_moduleId: { driverId, moduleId },
      },
      data: {
        progress: Math.min(100, progress),
      },
    });

    return this.mapCompletion(completion);
  }

  async completeModule(
    driverId: string,
    moduleId: string,
    quizScore?: number
  ): Promise<ExtendedTrainingCompletion> {
    const module = await this.db.trainingModule.findUnique({
      where: { id: moduleId },
    });

    // Check if passed (>= 70% on quiz)
    const passed = !module.hasQuiz || (quizScore && quizScore >= 70);

    const completion = await this.db.trainingCompletion.update({
      where: {
        driverId_moduleId: { driverId, moduleId },
      },
      data: {
        progress: 100,
        completedAt: new Date(),
        passed,
      },
    });

    if (passed) {
      // Award certification if applicable
      if (module.certificationCode) {
        await this.awardCertification(driverId, module);
      }

      // Update profile
      await this.db.driverProfile.update({
        where: { driverId },
        data: {
          totalPoints: { increment: module.pointsReward || 0 },
        },
      });

      // Send notification
      await this.notificationService?.send({
        userId: driverId,
        title: "🎓 Training Complete!",
        body: `You've completed "${module.title}"${module.pointsReward ? ` and earned ${module.pointsReward} points!` : ""}`,
        data: { type: "training_completed", moduleId },
      });

      // Track analytics
      this.analyticsService?.track({
        userId: driverId,
        event: DRIVER_EVENTS.TRAINING_COMPLETED,
        properties: {
          moduleId,
          moduleName: module.title,
          quizScore,
          passed,
        },
      });
    }

    return this.mapCompletion(completion);
  }

  async getDriverCompletions(driverId: string): Promise<ExtendedTrainingCompletion[]> {
    const completions = await this.db.trainingCompletion.findMany({
      where: { driverId },
      include: { module: true },
      orderBy: { startedAt: "desc" },
    });

    return completions.map((c: any) => this.mapCompletion(c));
  }

  // -----------------------------------------
  // CERTIFICATIONS
  // -----------------------------------------

  async getCertifications(driverId: string): Promise<DriverCertification[]> {
    const certifications = await this.db.driverCertification.findMany({
      where: { driverId },
      orderBy: { issuedAt: "desc" },
    });

    return certifications.map((c: any) => ({
      id: c.id,
      driverId: c.driverId,
      certificationCode: c.certificationCode,
      name: c.name,
      description: c.description,
      issuedAt: c.issuedAt,
      expiresAt: c.expiresAt,
      isActive: c.isActive,
      certificateUrl: c.certificateUrl,
      verificationCode: c.verificationCode,
    }));
  }

  async renewCertification(
    driverId: string,
    certificationId: string
  ): Promise<DriverCertification> {
    const cert = await this.db.driverCertification.findUnique({
      where: { id: certificationId },
    });

    if (cert.driverId !== driverId) {
      throw new Error("Certification not found");
    }

    // Extend by 1 year
    const newExpiry = new Date();
    newExpiry.setFullYear(newExpiry.getFullYear() + 1);

    const updated = await this.db.driverCertification.update({
      where: { id: certificationId },
      data: {
        expiresAt: newExpiry,
      },
    });

    return {
      id: updated.id,
      driverId: updated.driverId,
      certificationCode: updated.certificationCode,
      name: updated.name,
      description: updated.description,
      issuedAt: updated.issuedAt,
      expiresAt: updated.expiresAt,
      isActive: true,
      certificateUrl: updated.certificateUrl,
      verificationCode: updated.verificationCode,
    };
  }

  private async awardCertification(
    driverId: string,
    module: any
  ): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    await this.db.driverCertification.upsert({
      where: {
        driverId_certificationCode: { driverId, certificationCode: module.certificationCode },
      },
      update: {
        issuedAt: new Date(),
        expiresAt,
        isActive: true,
      },
      create: {
        driverId,
        certificationCode: module.certificationCode,
        name: module.certificationName || module.title,
        description: `Certification for completing ${module.title}`,
        issuedAt: new Date(),
        expiresAt,
        isActive: true,
      },
    });
  }

  // Interface compatibility methods
  async getAvailableModules(_driverId: string): Promise<any[]> {
    return this.getTrainingModules(_driverId);
  }

  async submitAssessment(_driverId: string, _moduleId: string, _answers: number[]): Promise<any> {
    throw new Error("Not implemented");
  }

  async getBadges(_driverId: string): Promise<DriverBadge[]> {
    // TrainingService doesn't handle badges, return empty array
    return [];
  }

  // -----------------------------------------
  // MAPPERS
  // -----------------------------------------

  private mapModule(m: any): ExtendedTrainingModule {
    return {
      id: m.id,
      code: m.code,
      title: m.title || m.name,
      description: m.description,
      category: m.category as TrainingCategory,
      durationMinutes: m.durationMinutes,
      thumbnailUrl: m.thumbnailUrl,
      videoUrl: m.videoUrl,
      contentUrl: m.contentUrl,
      lessons: m.lessons,
      hasQuiz: m.hasQuiz || m.hasAssessment || false,
      passingScore: m.passingScore,
      pointsReward: m.pointsReward,
      certificationCode: m.certificationCode || m.certification,
      certificationName: m.certificationName,
      requiredTier: m.requiredTier as DriverTier | undefined,
      prerequisites: m.prerequisites || m.prerequisiteIds,
      orderIndex: m.orderIndex,
      isActive: m.isActive,
    };
  }

  private mapCompletion(c: any): ExtendedTrainingCompletion {
    return {
      id: c.id,
      driverId: c.driverId,
      moduleId: c.moduleId,
      startedAt: c.startedAt,
      completedAt: c.completedAt,
      progress: c.progress,
      quizScore: c.quizScore || c.bestScore,
      passed: c.passed,
      attempts: c.attempts || c.attemptCount,
      lastAccessedAt: c.lastAccessedAt,
      lastLessonId: c.lastLessonId,
    };
  }
}

export { DriverCareerService, TrainingService };
