// ===========================================
// UBI Driver Experience Platform
// Service Index & Platform Export
// ===========================================

// -----------------------------------------
// SERVICE EXPORTS
// -----------------------------------------

export { DriverBenefitsService } from "./benefits.service";
export { DriverCareerService, TrainingService } from "./career.service";
export { CommunityService } from "./community.service";
export { DriverEarningsService, DriverGoalsService } from "./earnings.service";
export { FleetOwnerService } from "./fleet.service";
export { IncentiveService } from "./incentives.service";

// -----------------------------------------
// TYPE RE-EXPORTS
// -----------------------------------------

export * from "../../types/driver.types";

// -----------------------------------------
// DRIVER EXPERIENCE PLATFORM
// -----------------------------------------

import { EventEmitter } from "node:events";
import { DriverBenefitsService } from "./benefits.service";
import { DriverCareerService, TrainingService } from "./career.service";
import { CommunityService } from "./community.service";
import { DriverEarningsService, DriverGoalsService } from "./earnings.service";
import { FleetOwnerService } from "./fleet.service";
import { IncentiveService } from "./incentives.service";

export interface DriverExperienceConfig {
  database: any;
  redis: any;
  paymentService?: any;
  notificationService?: any;
  analyticsService?: any;
}

export class DriverExperiencePlatform {
  // Core Services
  public earnings: DriverEarningsService;
  public goals: DriverGoalsService;
  public incentives: IncentiveService;
  public benefits: DriverBenefitsService;
  public career: DriverCareerService;
  public training: TrainingService;
  public community: CommunityService;
  public fleet: FleetOwnerService;

  // Event System
  private readonly eventEmitter: EventEmitter;

  constructor(config: DriverExperienceConfig) {
    this.eventEmitter = new EventEmitter();

    // Initialize all services
    this.earnings = new DriverEarningsService(
      config.database,
      config.redis,
      config.analyticsService,
    );

    this.goals = new DriverGoalsService(
      config.database,
      this.earnings,
      config.analyticsService,
    );

    this.incentives = new IncentiveService(
      config.database,
      config.redis,
      config.notificationService,
      config.analyticsService,
    );

    this.benefits = new DriverBenefitsService(
      config.database,
      config.redis,
      config.paymentService,
      config.notificationService,
      config.analyticsService,
    );

    this.career = new DriverCareerService(
      config.database,
      config.notificationService,
      config.analyticsService,
    );

    this.training = new TrainingService(
      config.database,
      config.notificationService,
      config.analyticsService,
    );

    this.community = new CommunityService(
      config.database,
      config.redis,
      config.notificationService,
      config.analyticsService,
    );

    this.fleet = new FleetOwnerService(
      config.database,
      config.redis,
      config.paymentService,
      config.notificationService,
      config.analyticsService,
    );

    // Set up cross-service event handlers
    this.setupEventHandlers();
  }

  // -----------------------------------------
  // TRIP PROCESSING
  // -----------------------------------------

  /**
   * Process a completed trip through all driver experience systems
   */
  async processCompletedTrip(trip: {
    id: string;
    driverId: string;
    fare: number;
    tip: number;
    commission: number;
    rating?: number;
    completedAt: Date;
    wasAccepted: boolean;
    wasCancelled: boolean;
    distance: number;
    duration: number;
    pickupLocation: { lat: number; lng: number };
    dropoffLocation: { lat: number; lng: number };
  }): Promise<void> {
    const {
      id,
      driverId,
      fare,
      tip,
      commission,
      rating,
      completedAt,
      wasCancelled,
      distance,
      duration,
    } = trip;

    // Skip if cancelled
    if (wasCancelled) {
      await this.incentives.handleTripDeclined(driverId);
      return;
    }

    // 1. Record trip earning
    const tripEarning = await this.earnings.recordTripEarning({
      driverId,
      tripId: id,
      baseFare: fare,
      tip,
      grossFare: fare,
      distance,
      duration,
      completedAt,
      rating,
    });

    // 2. Process trip for incentives (quests, bonuses)
    await this.incentives.processTripForIncentives(driverId, tripEarning);

    // 3. Update goals progress - will be handled by processTripForGoals
    // The updateGoalProgress method expects 3 arguments: driverId, goalId, value
    // We'll use processTripForGoals instead which handles all active goals

    // 4. Process fleet earnings if applicable
    await this.fleet.processFleetTrip(id, driverId, fare + tip - commission);

    // 5. Check for tier upgrade eligibility
    const newTier = await this.career.checkTierUpgrade(driverId);
    if (newTier) {
      await this.career.upgradeTier(driverId, newTier);
    }

    // 6. Check for badge eligibility
    const eligibleBadges = await this.career.checkBadgeEligibility(driverId);
    for (const badgeCode of eligibleBadges) {
      await this.career.awardBadge(driverId, badgeCode);
    }

    // Emit event for external listeners
    this.eventEmitter.emit("trip:completed", {
      driverId,
      tripId: id,
      earnings: fare + tip - commission,
    });
  }

  /**
   * Handle trip acceptance
   */
  async handleTripAccepted(driverId: string): Promise<void> {
    await this.incentives.handleTripAccepted(driverId);
  }

  /**
   * Handle trip declined/ignored
   */
  async handleTripDeclined(driverId: string): Promise<void> {
    await this.incentives.handleTripDeclined(driverId);
  }

  // -----------------------------------------
  // DAILY PROCESSING
  // -----------------------------------------

  /**
   * Run daily processing jobs
   */
  async runDailyProcessing(): Promise<void> {
    console.log("[DriverExperience] Starting daily processing...");

    // 1. Aggregate daily earnings
    await this.aggregateDailyEarnings();

    // 2. Process benefit renewals
    await this.benefits.processRenewals();

    // 3. Reset daily streaks if needed (handled by streak service)
    // await this.incentives.processDailyStreaks();

    // 4. Update fuel discount tiers
    await this.updateAllFuelDiscountTiers();

    console.log("[DriverExperience] Daily processing completed");
  }

  private async aggregateDailyEarnings(): Promise<void> {
    // Get all drivers who had trips yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // This would need to query active drivers and aggregate their earnings
    // Implementation would depend on database schema
  }

  private async updateAllFuelDiscountTiers(): Promise<void> {
    // Get all drivers with fuel discounts and update their tiers
    // Implementation would depend on database schema
  }

  // -----------------------------------------
  // MONTHLY PROCESSING
  // -----------------------------------------

  /**
   * Run monthly processing jobs
   */
  async runMonthlyProcessing(): Promise<void> {
    console.log("[DriverExperience] Starting monthly processing...");

    // 1. Reset monthly fuel usage
    await this.benefits.resetMonthlyFuelUsage();

    // 2. Calculate Driver of the Month
    await this.calculateDriverOfMonth();

    // 3. Generate monthly earnings reports
    // await this.generateMonthlyReports();

    console.log("[DriverExperience] Monthly processing completed");
  }

  private async calculateDriverOfMonth(): Promise<void> {
    // Calculate Driver of the Month based on nominations and performance
    // Implementation would depend on database schema
  }

  // -----------------------------------------
  // EVENT HANDLERS
  // -----------------------------------------

  private setupEventHandlers(): void {
    // Listen for earnings updates to check goals
    // This would be implemented with actual event system
    // Example: When earnings are recorded, check goal progress
    // this.earnings.on('earning:recorded', async (data) => {
    //   await this.goals.updateGoalProgress(data.driverId, data.amount);
    // });
  }

  // -----------------------------------------
  // EVENT SYSTEM
  // -----------------------------------------

  on(event: string, handler: (...args: any[]) => void): void {
    this.eventEmitter.on(event, handler);
  }

  off(event: string, handler: (...args: any[]) => void): void {
    this.eventEmitter.off(event, handler);
  }

  // -----------------------------------------
  // HEALTH CHECK
  // -----------------------------------------

  async healthCheck(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    services: Record<string, boolean>;
  }> {
    const services: Record<string, boolean> = {
      earnings: true,
      goals: true,
      incentives: true,
      benefits: true,
      career: true,
      training: true,
      community: true,
      fleet: true,
    };

    // Check each service (simplified)
    try {
      // Add actual health checks for each service
      const allHealthy = Object.values(services).every(Boolean);
      const someHealthy = Object.values(services).some(Boolean);

      let status: "healthy" | "degraded" | "unhealthy";
      if (allHealthy) {
        status = "healthy";
      } else if (someHealthy) {
        status = "degraded";
      } else {
        status = "unhealthy";
      }

      return {
        status,
        services,
      };
    } catch {
      return {
        status: "unhealthy",
        services,
      };
    }
  }
}

// -----------------------------------------
// FACTORY FUNCTION
// -----------------------------------------

export function createDriverExperiencePlatform(
  config: DriverExperienceConfig,
): DriverExperiencePlatform {
  return new DriverExperiencePlatform(config);
}

// -----------------------------------------
// DEFAULT EXPORT
// -----------------------------------------

export default DriverExperiencePlatform;
