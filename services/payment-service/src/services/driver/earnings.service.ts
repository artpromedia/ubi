// ===========================================
// UBI Driver Experience Platform
// Earnings Dashboard Service
// ===========================================

import { EventEmitter } from "events";
import {
  CreateGoalInput,
  DRIVER_EVENTS,
  DriverEarnings,
  DriverGoal,
  DriverGoalProgress,
  DriverGoalType,
  EarningSuggestion,
  EarningsComparison,
  EarningsPeriodType,
  EarningsProjection,
  IDriverEarningsService,
  IDriverGoalsService,
  SuggestionType,
  TodayEarnings,
  TripEarning,
  TripEarningType,
} from "../../types/driver.types";

// -----------------------------------------
// EARNINGS DASHBOARD SERVICE
// -----------------------------------------

export class DriverEarningsService implements IDriverEarningsService {
  private eventEmitter: EventEmitter;
  private cache: Map<string, { data: unknown; expiry: number }> = new Map();
  private readonly CACHE_TTL = 60 * 1000; // 1 minute

  constructor(
    private db: any,
    private redis: any,
    private analyticsService: any
  ) {
    this.eventEmitter = new EventEmitter();
  }

  // -----------------------------------------
  // TODAY'S EARNINGS
  // -----------------------------------------

  async getTodayEarnings(driverId: string): Promise<TodayEarnings> {
    const cacheKey = `today_earnings:${driverId}`;
    const cached = await this.getCached<TodayEarnings>(cacheKey);
    if (cached) return cached;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date();

    // Fetch trips and online time in parallel
    const [trips, onlineTime, goals] = await Promise.all([
      this.getTodayTrips(driverId),
      this.getOnlineTime(driverId, today, now),
      this.getDailyGoals(driverId),
    ]);

    // Calculate earnings breakdown
    const grossEarnings = this.sum(trips, "grossFare");
    const tips = this.sum(trips, "tip");
    const incentives = this.sum(trips, "incentiveBonus");
    const commission = this.sum(trips, "commission");
    const netEarnings = this.sum(trips, "netEarnings");

    // Calculate per-hour metrics
    const onlineHours = onlineTime / 60;
    const earningsPerHour = onlineHours > 0 ? netEarnings / onlineHours : 0;

    // Get comparison data
    const comparison = await this.getEarningsComparison(
      driverId,
      netEarnings,
      trips.length
    );

    // Get suggestions
    const suggestions = await this.getEarningsSuggestions(driverId);

    const result: TodayEarnings = {
      grossEarnings,
      netEarnings,
      tips,
      incentives,
      tripCount: trips.length,
      onlineHours: Math.round(onlineHours * 100) / 100,
      earningsPerHour: Math.round(earningsPerHour * 100) / 100,
      goals,
      suggestions,
      comparison,
      trips,
    };

    // Cache for 1 minute
    await this.setCache(cacheKey, result, this.CACHE_TTL);

    // Track analytics
    this.trackEvent(driverId, DRIVER_EVENTS.EARNINGS_VIEWED, {
      periodType: "today",
      grossEarnings,
      netEarnings,
      tripCount: trips.length,
    });

    return result;
  }

  private async getTodayTrips(driverId: string): Promise<TripEarning[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const trips = await this.db.tripEarning.findMany({
      where: {
        driverId,
        completedAt: {
          gte: today,
        },
      },
      orderBy: {
        completedAt: "desc",
      },
    });

    return trips.map(this.mapTripEarning);
  }

  private async getOnlineTime(
    driverId: string,
    start: Date,
    end: Date
  ): Promise<number> {
    // Get online sessions from Redis or database
    const sessions = await this.db.driverSession.findMany({
      where: {
        driverId,
        startedAt: { gte: start },
        OR: [{ endedAt: { lte: end } }, { endedAt: null }],
      },
    });

    let totalMinutes = 0;
    for (const session of sessions) {
      const sessionEnd = session.endedAt || end;
      const duration =
        (sessionEnd.getTime() - session.startedAt.getTime()) / (1000 * 60);
      totalMinutes += duration;
    }

    return totalMinutes;
  }

  private async getDailyGoals(driverId: string): Promise<DriverGoalProgress[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const goals = await this.db.driverGoal.findMany({
      where: {
        driverId,
        isActive: true,
        periodEnd: {
          gte: today,
          lt: tomorrow,
        },
      },
    });

    return goals.map((goal: any) => this.calculateGoalProgress(goal));
  }

  // -----------------------------------------
  // EARNINGS HISTORY
  // -----------------------------------------

  async getEarningsHistory(
    driverId: string,
    period: EarningsPeriodType,
    count: number = 7
  ): Promise<DriverEarnings[]> {
    const earnings = await this.db.driverEarnings.findMany({
      where: {
        driverId,
        periodType: period,
      },
      orderBy: {
        periodStart: "desc",
      },
      take: count,
    });

    return earnings.map(this.mapDriverEarnings);
  }

  async getTripsForPeriod(
    driverId: string,
    start: Date,
    end: Date
  ): Promise<TripEarning[]> {
    const trips = await this.db.tripEarning.findMany({
      where: {
        driverId,
        completedAt: {
          gte: start,
          lte: end,
        },
      },
      orderBy: {
        completedAt: "desc",
      },
    });

    return trips.map(this.mapTripEarning);
  }

  // -----------------------------------------
  // EARNINGS COMPARISON
  // -----------------------------------------

  private async getEarningsComparison(
    driverId: string,
    todayEarnings: number,
    todayTrips: number
  ): Promise<EarningsComparison> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Yesterday
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Same day last week
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    // Get comparison data
    const [yesterdayData, lastWeekData, averageData] = await Promise.all([
      this.getEarningsForDate(driverId, yesterday),
      this.getEarningsForDate(driverId, lastWeek),
      this.getAverageEarnings(driverId, 30),
    ]);

    return {
      vsYesterday: {
        earnings: yesterdayData.netEarnings,
        percentChange: this.calculatePercentChange(
          todayEarnings,
          yesterdayData.netEarnings
        ),
        trips: yesterdayData.tripCount,
      },
      vsLastWeek: {
        earnings: lastWeekData.netEarnings,
        percentChange: this.calculatePercentChange(
          todayEarnings,
          lastWeekData.netEarnings
        ),
        trips: lastWeekData.tripCount,
      },
      vsAverage: {
        earnings: averageData.netEarnings,
        percentChange: this.calculatePercentChange(
          todayEarnings,
          averageData.netEarnings
        ),
        trips: averageData.tripCount,
      },
    };
  }

  private async getEarningsForDate(
    driverId: string,
    date: Date
  ): Promise<{ netEarnings: number; tripCount: number }> {
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);

    const result = await this.db.tripEarning.aggregate({
      where: {
        driverId,
        completedAt: {
          gte: date,
          lt: nextDay,
        },
      },
      _sum: {
        netEarnings: true,
      },
      _count: true,
    });

    return {
      netEarnings: result._sum.netEarnings || 0,
      tripCount: result._count,
    };
  }

  private async getAverageEarnings(
    driverId: string,
    days: number
  ): Promise<{ netEarnings: number; tripCount: number }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const result = await this.db.driverEarnings.aggregate({
      where: {
        driverId,
        periodType: EarningsPeriodType.DAILY,
        periodStart: {
          gte: startDate,
        },
      },
      _avg: {
        netEarnings: true,
        tripCount: true,
      },
    });

    return {
      netEarnings: result._avg.netEarnings || 0,
      tripCount: Math.round(result._avg.tripCount || 0),
    };
  }

  // -----------------------------------------
  // EARNINGS SUGGESTIONS
  // -----------------------------------------

  async getEarningsSuggestions(driverId: string): Promise<EarningSuggestion[]> {
    const suggestions: EarningSuggestion[] = [];

    // Get driver stats
    const stats = await this.getDriverStats(driverId);
    const currentHour = new Date().getHours();
    const isPeakHour = this.isPeakHour(currentHour);

    // Suggestion 1: Acceptance rate
    if (stats.acceptanceRate < 0.8) {
      suggestions.push({
        type: SuggestionType.ACCEPTANCE_RATE,
        title: "Improve acceptance rate",
        description: `Your acceptance rate is ${Math.round(stats.acceptanceRate * 100)}%. Accept more trips to qualify for bonuses.`,
        impact: "high",
        data: {
          currentRate: stats.acceptanceRate,
          targetRate: 0.85,
        },
      });
    }

    // Suggestion 2: Peak hours
    if (!stats.isOnline && isPeakHour) {
      suggestions.push({
        type: SuggestionType.PEAK_HOURS,
        title: "Go online now!",
        description:
          "Peak hours are active. Earn up to 40% more during busy times.",
        impact: "high",
        data: {
          surgeMultiplier: 1.4,
          peakEnd: this.getPeakEnd(currentHour),
        },
      });
    }

    // Suggestion 3: Peak hours coming
    if (stats.isOnline && !isPeakHour && this.isPeakHourSoon(currentHour)) {
      suggestions.push({
        type: SuggestionType.PEAK_HOURS,
        title: "Stay online!",
        description:
          "Peak hours starting soon. Stay online to maximize earnings.",
        impact: "medium",
        data: {
          peakStart: this.getNextPeakStart(currentHour),
        },
      });
    }

    // Suggestion 4: High demand area
    const nearbyDemand = await this.getNearbyHighDemand(driverId);
    if (nearbyDemand && nearbyDemand.surgeMultiplier >= 1.3) {
      suggestions.push({
        type: SuggestionType.HIGH_DEMAND_AREA,
        title: `High demand in ${nearbyDemand.areaName}`,
        description: `${nearbyDemand.surgeMultiplier}x surge active. ${nearbyDemand.distanceKm}km away.`,
        impact: "high",
        actionUrl: `/navigate?lat=${nearbyDemand.latitude}&lng=${nearbyDemand.longitude}`,
        data: nearbyDemand,
      });
    }

    // Suggestion 5: Active quest
    const activeQuest = await this.getActiveQuest(driverId);
    if (activeQuest && activeQuest.progress >= 0.7) {
      const remaining = activeQuest.target - activeQuest.current;
      suggestions.push({
        type: SuggestionType.COMPLETE_QUEST,
        title: `${remaining} trips to complete quest`,
        description: `Complete ${remaining} more trips to earn ₦${activeQuest.reward}`,
        impact: "high",
        data: activeQuest,
      });
    }

    // Suggestion 6: Rating improvement
    if (stats.averageRating < 4.7) {
      suggestions.push({
        type: SuggestionType.IMPROVE_RATING,
        title: "Boost your rating",
        description:
          "Higher ratings unlock better incentives. Focus on customer service.",
        impact: "medium",
        actionUrl: "/training/customer-service",
        data: {
          currentRating: stats.averageRating,
          targetRating: 4.8,
        },
      });
    }

    // Suggestion 7: Enable delivery
    if (!stats.deliveryEnabled && stats.tripCount > 50) {
      suggestions.push({
        type: SuggestionType.ENABLE_DELIVERY,
        title: "Enable food delivery",
        description:
          "Add delivery trips to increase your earning opportunities.",
        impact: "medium",
        actionUrl: "/settings/services",
      });
    }

    // Sort by impact
    const impactOrder = { high: 0, medium: 1, low: 2 };
    suggestions.sort((a, b) => impactOrder[a.impact] - impactOrder[b.impact]);

    return suggestions.slice(0, 5); // Return top 5 suggestions
  }

  private async getDriverStats(driverId: string): Promise<DriverStats> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [profile, recentTrips, onlineStatus] = await Promise.all([
      this.db.driverProfile.findUnique({ where: { driverId } }),
      this.db.tripEarning.findMany({
        where: {
          driverId,
          completedAt: { gte: thirtyDaysAgo },
        },
        select: {
          rating: true,
          tripType: true,
        },
      }),
      this.redis.get(`driver:online:${driverId}`),
    ]);

    const ratings = recentTrips
      .filter((t: any) => t.rating)
      .map((t: any) => t.rating);
    const averageRating =
      ratings.length > 0
        ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length
        : profile?.lifetimeRating || 5;

    return {
      acceptanceRate: profile?.acceptanceRate || 0.85,
      completionRate: profile?.completionRate || 0.95,
      averageRating,
      tripCount: recentTrips.length,
      isOnline: onlineStatus === "true",
      deliveryEnabled: recentTrips.some((t: any) =>
        t.tripType.startsWith("DELIVERY")
      ),
    };
  }

  private isPeakHour(hour: number): boolean {
    // Morning peak: 7-10 AM, Evening peak: 5-9 PM
    return (hour >= 7 && hour <= 10) || (hour >= 17 && hour <= 21);
  }

  private isPeakHourSoon(hour: number): boolean {
    // 30 minutes before peak
    return hour === 6 || hour === 16;
  }

  private getPeakEnd(hour: number): string {
    if (hour >= 7 && hour <= 10) return "10:00 AM";
    if (hour >= 17 && hour <= 21) return "9:00 PM";
    return "";
  }

  private getNextPeakStart(hour: number): string {
    if (hour < 7) return "7:00 AM";
    if (hour < 17) return "5:00 PM";
    return "7:00 AM (tomorrow)";
  }

  private async getNearbyHighDemand(
    driverId: string
  ): Promise<NearbyDemand | null> {
    // Get driver's current location
    const location = await this.redis.get(`driver:location:${driverId}`);
    if (!location) return null;

    const { lat, lng } = JSON.parse(location);

    // Find nearby high-demand areas
    const demandAreas = await this.db.demandHeatmap.findMany({
      where: {
        demandScore: { gte: 70 },
        timestamp: { gte: new Date(Date.now() - 5 * 60 * 1000) }, // Last 5 minutes
      },
      orderBy: {
        surgeMultiplier: "desc",
      },
      take: 5,
    });

    if (demandAreas.length === 0) return null;

    // Find closest high-demand area
    for (const area of demandAreas) {
      const distance = this.calculateDistance(
        lat,
        lng,
        area.latitude,
        area.longitude
      );
      if (distance <= 5) {
        // Within 5km
        return {
          areaName: area.areaName || "High demand area",
          surgeMultiplier: parseFloat(area.surgeMultiplier),
          distanceKm: Math.round(distance * 10) / 10,
          latitude: parseFloat(area.latitude),
          longitude: parseFloat(area.longitude),
        };
      }
    }

    return null;
  }

  private async getActiveQuest(driverId: string): Promise<ActiveQuest | null> {
    const quest = await this.db.driverIncentiveProgress.findFirst({
      where: {
        driverId,
        status: "ACTIVE",
        incentive: {
          incentiveType: "QUEST",
          endTime: { gt: new Date() },
        },
      },
      include: {
        incentive: true,
      },
    });

    if (!quest) return null;

    const targetTier = quest.incentive.rewardTiers[quest.currentTier];
    return {
      id: quest.incentive.id,
      name: quest.incentive.name,
      current: parseFloat(quest.currentValue),
      target: targetTier.threshold,
      progress: parseFloat(quest.currentValue) / targetTier.threshold,
      reward: targetTier.rewardValue,
      endsAt: quest.incentive.endTime,
    };
  }

  // -----------------------------------------
  // EARNINGS PROJECTION
  // -----------------------------------------

  async calculateEarningsProjection(
    driverId: string
  ): Promise<EarningsProjection> {
    // Get historical data
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const historicalEarnings = await this.db.driverEarnings.findMany({
      where: {
        driverId,
        periodType: EarningsPeriodType.DAILY,
        periodStart: { gte: thirtyDaysAgo },
      },
    });

    if (historicalEarnings.length === 0) {
      return {
        dailyProjection: 0,
        weeklyProjection: 0,
        monthlyProjection: 0,
        basedOnHours: 0,
        confidence: 0,
      };
    }

    // Calculate averages
    const avgDailyEarnings =
      historicalEarnings.reduce(
        (sum: number, e: any) => sum + parseFloat(e.netEarnings),
        0
      ) / historicalEarnings.length;

    const avgOnlineHours =
      historicalEarnings.reduce(
        (sum: number, e: any) => sum + e.onlineMinutes / 60,
        0
      ) / historicalEarnings.length;

    // Calculate confidence based on data consistency
    const stdDev = this.calculateStdDev(
      historicalEarnings.map((e: any) => parseFloat(e.netEarnings))
    );
    const confidence = Math.max(0, Math.min(1, 1 - stdDev / avgDailyEarnings));

    return {
      dailyProjection: Math.round(avgDailyEarnings),
      weeklyProjection: Math.round(avgDailyEarnings * 7),
      monthlyProjection: Math.round(avgDailyEarnings * 30),
      basedOnHours: Math.round(avgOnlineHours * 10) / 10,
      confidence: Math.round(confidence * 100) / 100,
    };
  }

  // -----------------------------------------
  // RECORD TRIP EARNINGS
  // -----------------------------------------

  async recordTripEarning(trip: Partial<TripEarning>): Promise<TripEarning> {
    // Calculate commission based on driver tier
    const profile = await this.db.driverProfile.findUnique({
      where: { driverId: trip.driverId },
    });

    const commissionRate = profile?.commissionRate || 0.25;
    const grossFare = trip.grossFare || 0;
    const commission = grossFare * commissionRate;
    const netEarnings =
      grossFare - commission + (trip.tip || 0) + (trip.incentiveBonus || 0);

    const tripEarning = await this.db.tripEarning.create({
      data: {
        driverId: trip.driverId,
        tripId: trip.tripId,
        tripType: trip.tripType,
        baseFare: trip.baseFare || 0,
        distanceFare: trip.distanceFare || 0,
        timeFare: trip.timeFare || 0,
        surgeFare: trip.surgeFare || 0,
        surgeMultiplier: trip.surgeMultiplier || 1,
        tollsCollected: trip.tollsCollected || 0,
        grossFare,
        tip: trip.tip || 0,
        incentiveBonus: trip.incentiveBonus || 0,
        commission,
        commissionRate,
        netEarnings,
        distance: trip.distance || 0,
        duration: trip.duration || 0,
        pickupLocation: trip.pickupLocation || "",
        dropoffLocation: trip.dropoffLocation || "",
        rating: trip.rating,
        currency: trip.currency || "NGN",
        completedAt: trip.completedAt || new Date(),
      },
    });

    // Invalidate cache
    await this.invalidateCache(`today_earnings:${trip.driverId}`);

    // Track analytics
    this.trackEvent(trip.driverId!, DRIVER_EVENTS.TRIP_COMPLETED, {
      tripType: trip.tripType,
      grossFare,
      netEarnings,
      distance: trip.distance,
      duration: trip.duration,
      rating: trip.rating,
    });

    // Emit event for other services
    this.eventEmitter.emit("trip:completed", tripEarning);

    return this.mapTripEarning(tripEarning);
  }

  // -----------------------------------------
  // AGGREGATE EARNINGS
  // -----------------------------------------

  async aggregateDailyEarnings(
    driverId: string,
    date: Date
  ): Promise<DriverEarnings> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    // Get all trips for the day
    const trips = await this.db.tripEarning.findMany({
      where: {
        driverId,
        completedAt: {
          gte: startOfDay,
          lt: endOfDay,
        },
      },
    });

    // Get online time
    const onlineMinutes = await this.getOnlineTime(
      driverId,
      startOfDay,
      endOfDay
    );

    // Get profile for commission rate
    const profile = await this.db.driverProfile.findUnique({
      where: { driverId },
    });

    // Calculate aggregates
    const grossEarnings = this.sum(trips, "grossFare");
    const tips = this.sum(trips, "tip");
    const incentives = this.sum(trips, "incentiveBonus");
    const surgEarnings = this.sum(trips, "surgeFare");
    const commission = this.sum(trips, "commission");
    const netEarnings = this.sum(trips, "netEarnings");
    const totalDistance = this.sum(trips, "distance");

    // Calculate rates
    const ratings = trips
      .filter((t: any) => t.rating)
      .map((t: any) => t.rating);
    const averageRating =
      ratings.length > 0
        ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length
        : null;

    // Upsert daily earnings
    const earnings = await this.db.driverEarnings.upsert({
      where: {
        driverId_periodStart_periodEnd_periodType: {
          driverId,
          periodStart: startOfDay,
          periodEnd: endOfDay,
          periodType: EarningsPeriodType.DAILY,
        },
      },
      update: {
        grossEarnings,
        tips,
        incentives,
        surgeEarnings: surgEarnings,
        commission,
        commissionRate: profile?.commissionRate || 0.25,
        netEarnings,
        tripCount: trips.length,
        rideTrips: trips.filter((t: any) => t.tripType.startsWith("RIDE"))
          .length,
        deliveryTrips: trips.filter((t: any) =>
          t.tripType.startsWith("DELIVERY")
        ).length,
        onlineMinutes: Math.round(onlineMinutes),
        activeMinutes: this.sum(trips, "duration"),
        totalDistance,
        acceptanceRate: profile?.acceptanceRate || 0.85,
        completionRate: profile?.completionRate || 0.95,
        averageRating: averageRating || profile?.lifetimeRating || 5,
        currency: "NGN",
      },
      create: {
        driverId,
        periodStart: startOfDay,
        periodEnd: endOfDay,
        periodType: EarningsPeriodType.DAILY,
        grossEarnings,
        tips,
        incentives,
        surgeEarnings: surgEarnings,
        commission,
        commissionRate: profile?.commissionRate || 0.25,
        netEarnings,
        tripCount: trips.length,
        rideTrips: trips.filter((t: any) => t.tripType.startsWith("RIDE"))
          .length,
        deliveryTrips: trips.filter((t: any) =>
          t.tripType.startsWith("DELIVERY")
        ).length,
        onlineMinutes: Math.round(onlineMinutes),
        activeMinutes: this.sum(trips, "duration"),
        totalDistance,
        acceptanceRate: profile?.acceptanceRate || 0.85,
        completionRate: profile?.completionRate || 0.95,
        averageRating: averageRating || profile?.lifetimeRating || 5,
        currency: "NGN",
      },
    });

    return this.mapDriverEarnings(earnings);
  }

  // -----------------------------------------
  // HELPER METHODS
  // -----------------------------------------

  private sum(items: any[], field: string): number {
    return items.reduce((total, item) => {
      const value = parseFloat(item[field]) || 0;
      return total + value;
    }, 0);
  }

  private calculatePercentChange(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  }

  private calculateDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLng = this.toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  private calculateStdDev(values: number[]): number {
    const n = values.length;
    if (n === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / n);
  }

  private mapTripEarning(trip: any): TripEarning {
    return {
      id: trip.id,
      driverId: trip.driverId,
      tripId: trip.tripId,
      tripType: trip.tripType as TripEarningType,
      baseFare: parseFloat(trip.baseFare),
      distanceFare: parseFloat(trip.distanceFare),
      timeFare: parseFloat(trip.timeFare),
      surgeFare: parseFloat(trip.surgeFare),
      surgeMultiplier: parseFloat(trip.surgeMultiplier),
      tollsCollected: parseFloat(trip.tollsCollected),
      grossFare: parseFloat(trip.grossFare),
      tip: parseFloat(trip.tip),
      incentiveBonus: parseFloat(trip.incentiveBonus),
      commission: parseFloat(trip.commission),
      commissionRate: parseFloat(trip.commissionRate),
      netEarnings: parseFloat(trip.netEarnings),
      distance: parseFloat(trip.distance),
      duration: trip.duration,
      pickupLocation: trip.pickupLocation,
      dropoffLocation: trip.dropoffLocation,
      rating: trip.rating,
      currency: trip.currency,
      completedAt: trip.completedAt,
    };
  }

  private mapDriverEarnings(earnings: any): DriverEarnings {
    return {
      id: earnings.id,
      driverId: earnings.driverId,
      periodStart: earnings.periodStart,
      periodEnd: earnings.periodEnd,
      periodType: earnings.periodType as EarningsPeriodType,
      grossEarnings: parseFloat(earnings.grossEarnings),
      tips: parseFloat(earnings.tips),
      incentives: parseFloat(earnings.incentives),
      bonuses: parseFloat(earnings.bonuses || 0),
      surgeEarnings: parseFloat(earnings.surgeEarnings),
      commission: parseFloat(earnings.commission),
      commissionRate: parseFloat(earnings.commissionRate),
      ceerionDeduction: parseFloat(earnings.ceerionDeduction || 0),
      otherDeductions: parseFloat(earnings.otherDeductions || 0),
      netEarnings: parseFloat(earnings.netEarnings),
      tripCount: earnings.tripCount,
      rideTrips: earnings.rideTrips,
      deliveryTrips: earnings.deliveryTrips,
      onlineMinutes: earnings.onlineMinutes,
      activeMinutes: earnings.activeMinutes,
      totalDistance: parseFloat(earnings.totalDistance),
      acceptanceRate: parseFloat(earnings.acceptanceRate),
      completionRate: parseFloat(earnings.completionRate),
      averageRating: parseFloat(earnings.averageRating),
      currency: earnings.currency,
    };
  }

  private calculateGoalProgress(goal: any): DriverGoalProgress {
    const progress =
      goal.targetValue > 0
        ? parseFloat(goal.currentValue) / parseFloat(goal.targetValue)
        : 0;
    const remaining = Math.max(
      0,
      parseFloat(goal.targetValue) - parseFloat(goal.currentValue)
    );
    const onTrack =
      progress >= this.getExpectedProgress(goal.periodStart, goal.periodEnd);

    return {
      goal: {
        id: goal.id,
        driverId: goal.driverId,
        goalType: goal.goalType as DriverGoalType,
        targetValue: parseFloat(goal.targetValue),
        currentValue: parseFloat(goal.currentValue),
        targetUnit: goal.targetUnit,
        periodStart: goal.periodStart,
        periodEnd: goal.periodEnd,
        achieved: goal.achieved,
        achievedAt: goal.achievedAt,
        progress: parseFloat(goal.progress),
        rewardType: goal.rewardType,
        rewardValue: goal.rewardValue
          ? parseFloat(goal.rewardValue)
          : undefined,
        rewardClaimed: goal.rewardClaimed,
        isActive: goal.isActive,
      },
      percentComplete: Math.round(progress * 100),
      remaining,
      onTrack,
    };
  }

  private getExpectedProgress(start: Date, end: Date): number {
    const now = Date.now();
    const total = end.getTime() - start.getTime();
    const elapsed = now - start.getTime();
    return Math.min(1, elapsed / total);
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

  onTripCompleted(handler: (trip: TripEarning) => void): void {
    this.eventEmitter.on("trip:completed", handler);
  }
}

// -----------------------------------------
// DRIVER GOALS SERVICE
// -----------------------------------------

export class DriverGoalsService implements IDriverGoalsService {
  constructor(
    private db: any,
    private earningsService: DriverEarningsService,
    private analyticsService: any
  ) {}

  async getActiveGoals(driverId: string): Promise<DriverGoalProgress[]> {
    const goals = await this.db.driverGoal.findMany({
      where: {
        driverId,
        isActive: true,
        periodEnd: { gt: new Date() },
      },
      orderBy: {
        periodEnd: "asc",
      },
    });

    return goals.map((goal: any) => this.calculateProgress(goal));
  }

  async createGoal(input: CreateGoalInput): Promise<DriverGoal> {
    // Determine period start based on goal type
    const now = new Date();
    let periodStart = new Date(now);

    switch (input.goalType) {
      case DriverGoalType.DAILY_EARNINGS:
      case DriverGoalType.DAILY_TRIPS:
        periodStart.setHours(0, 0, 0, 0);
        break;
      case DriverGoalType.WEEKLY_EARNINGS:
      case DriverGoalType.WEEKLY_TRIPS:
        periodStart.setDate(periodStart.getDate() - periodStart.getDay());
        periodStart.setHours(0, 0, 0, 0);
        break;
      case DriverGoalType.MONTHLY_EARNINGS:
      case DriverGoalType.MONTHLY_TRIPS:
        periodStart.setDate(1);
        periodStart.setHours(0, 0, 0, 0);
        break;
      default:
        periodStart = now;
    }

    const goal = await this.db.driverGoal.create({
      data: {
        driverId: input.driverId,
        goalType: input.goalType,
        targetValue: input.targetValue,
        currentValue: 0,
        targetUnit: input.targetUnit,
        periodStart,
        periodEnd: input.periodEnd,
        progress: 0,
        rewardType: input.rewardType,
        rewardValue: input.rewardValue,
        isActive: true,
      },
    });

    // Track analytics
    this.analyticsService?.track({
      userId: input.driverId,
      event: DRIVER_EVENTS.GOAL_CREATED,
      properties: {
        goalType: input.goalType,
        targetValue: input.targetValue,
        targetUnit: input.targetUnit,
      },
    });

    return this.mapGoal(goal);
  }

  async updateGoalProgress(
    driverId: string,
    goalId: string,
    value: number
  ): Promise<DriverGoalProgress> {
    const goal = await this.db.driverGoal.findFirst({
      where: { id: goalId, driverId },
    });

    if (!goal) {
      throw new Error("Goal not found");
    }

    const newValue = parseFloat(goal.currentValue) + value;
    const progress =
      goal.targetValue > 0 ? newValue / parseFloat(goal.targetValue) : 0;
    const achieved = newValue >= parseFloat(goal.targetValue);

    const updated = await this.db.driverGoal.update({
      where: { id: goalId },
      data: {
        currentValue: newValue,
        progress: Math.min(1, progress),
        achieved,
        achievedAt: achieved && !goal.achieved ? new Date() : goal.achievedAt,
      },
    });

    // Track achievement
    if (achieved && !goal.achieved) {
      this.analyticsService?.track({
        userId: driverId,
        event: DRIVER_EVENTS.GOAL_ACHIEVED,
        properties: {
          goalType: goal.goalType,
          targetValue: parseFloat(goal.targetValue),
          achievedValue: newValue,
        },
      });
    }

    return this.calculateProgress(updated);
  }

  async claimReward(driverId: string, goalId: string): Promise<boolean> {
    const goal = await this.db.driverGoal.findFirst({
      where: { id: goalId, driverId, achieved: true, rewardClaimed: false },
    });

    if (!goal) {
      return false;
    }

    // Process reward based on type
    if (goal.rewardType === "cash" && goal.rewardValue) {
      // Credit reward to driver wallet
      await this.creditReward(driverId, parseFloat(goal.rewardValue));
    }

    await this.db.driverGoal.update({
      where: { id: goalId },
      data: { rewardClaimed: true },
    });

    return true;
  }

  async getSuggestedGoals(driverId: string): Promise<CreateGoalInput[]> {
    const suggestions: CreateGoalInput[] = [];

    // Get driver's historical data
    const projection =
      await this.earningsService.calculateEarningsProjection(driverId);

    // Suggest daily earnings goal slightly above average
    if (projection.dailyProjection > 0) {
      const target = Math.round(projection.dailyProjection * 1.1);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(23, 59, 59, 999);

      suggestions.push({
        driverId,
        goalType: DriverGoalType.DAILY_EARNINGS,
        targetValue: target,
        targetUnit: "NGN",
        periodEnd: tomorrow,
        rewardType: "points",
        rewardValue: 50,
      });
    }

    // Suggest weekly trip goal
    const endOfWeek = new Date();
    endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
    endOfWeek.setHours(23, 59, 59, 999);

    suggestions.push({
      driverId,
      goalType: DriverGoalType.WEEKLY_TRIPS,
      targetValue: 50,
      targetUnit: "trips",
      periodEnd: endOfWeek,
      rewardType: "cash",
      rewardValue: 1000,
    });

    return suggestions;
  }

  // Update goals when trip is completed
  async processTripForGoals(
    driverId: string,
    trip: TripEarning
  ): Promise<void> {
    const activeGoals = await this.db.driverGoal.findMany({
      where: {
        driverId,
        isActive: true,
        achieved: false,
        periodEnd: { gt: new Date() },
      },
    });

    for (const goal of activeGoals) {
      let incrementValue = 0;

      switch (goal.goalType) {
        case DriverGoalType.DAILY_TRIPS:
        case DriverGoalType.WEEKLY_TRIPS:
        case DriverGoalType.MONTHLY_TRIPS:
          incrementValue = 1;
          break;
        case DriverGoalType.DAILY_EARNINGS:
        case DriverGoalType.WEEKLY_EARNINGS:
        case DriverGoalType.MONTHLY_EARNINGS:
          incrementValue = trip.netEarnings;
          break;
      }

      if (incrementValue > 0) {
        await this.updateGoalProgress(driverId, goal.id, incrementValue);
      }
    }
  }

  private calculateProgress(goal: any): DriverGoalProgress {
    const progress =
      parseFloat(goal.targetValue) > 0
        ? parseFloat(goal.currentValue) / parseFloat(goal.targetValue)
        : 0;
    const remaining = Math.max(
      0,
      parseFloat(goal.targetValue) - parseFloat(goal.currentValue)
    );
    const expectedProgress = this.getExpectedProgress(
      goal.periodStart,
      goal.periodEnd
    );
    const onTrack = progress >= expectedProgress;

    return {
      goal: this.mapGoal(goal),
      percentComplete: Math.round(Math.min(1, progress) * 100),
      remaining,
      onTrack,
      estimatedCompletion: onTrack ? goal.periodEnd : undefined,
    };
  }

  private getExpectedProgress(start: Date, end: Date): number {
    const now = Date.now();
    const total = end.getTime() - start.getTime();
    const elapsed = now - start.getTime();
    return Math.min(1, elapsed / total);
  }

  private mapGoal(goal: any): DriverGoal {
    return {
      id: goal.id,
      driverId: goal.driverId,
      goalType: goal.goalType as DriverGoalType,
      targetValue: parseFloat(goal.targetValue),
      currentValue: parseFloat(goal.currentValue),
      targetUnit: goal.targetUnit,
      periodStart: goal.periodStart,
      periodEnd: goal.periodEnd,
      achieved: goal.achieved,
      achievedAt: goal.achievedAt,
      progress: parseFloat(goal.progress),
      rewardType: goal.rewardType,
      rewardValue: goal.rewardValue ? parseFloat(goal.rewardValue) : undefined,
      rewardClaimed: goal.rewardClaimed,
      isActive: goal.isActive,
    };
  }

  private async creditReward(driverId: string, amount: number): Promise<void> {
    // Implementation would credit to driver's wallet
    console.log(`Crediting ${amount} to driver ${driverId}`);
  }
}

// -----------------------------------------
// SUPPORTING TYPES
// -----------------------------------------

interface DriverStats {
  acceptanceRate: number;
  completionRate: number;
  averageRating: number;
  tripCount: number;
  isOnline: boolean;
  deliveryEnabled: boolean;
}

interface NearbyDemand {
  areaName: string;
  surgeMultiplier: number;
  distanceKm: number;
  latitude: number;
  longitude: number;
}

interface ActiveQuest {
  id: string;
  name: string;
  current: number;
  target: number;
  progress: number;
  reward: number;
  endsAt: Date;
}

export { DriverEarningsService, DriverGoalsService };
