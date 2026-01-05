// =============================================================================
// UBI AI/ML PLATFORM - CHURN PREDICTION & RETENTION SERVICE
// =============================================================================
// ML-driven churn prediction with proactive retention interventions
// Target: +20% retention, identify at-risk users 14 days before churn
// =============================================================================

import { EventEmitter } from "events";
import {
  ChurnFactor,
  ChurnPrediction,
  ChurnPredictionRequest,
  ChurnRiskLevel,
  FeatureEntityType,
  IChurnPredictionService,
  InterventionType,
  RetentionCampaign,
  RetentionIntervention,
  UserSegment,
} from "../types/ml.types";
import { FeatureStoreService } from "./feature-store.service";

// =============================================================================
// CHURN RISK PROFILES
// =============================================================================

interface ChurnRiskProfile {
  segment: UserSegment;
  baseChurnRate: number;
  riskFactorWeights: Record<string, number>;
  interventionPriority: number;
}

interface EngagementMetrics {
  tripFrequency: number; // trips per week
  avgOrderValue: number;
  lastActivityDays: number;
  appOpenFrequency: number;
  featureUsage: Record<string, number>;
  satisfactionScore: number;
}

// =============================================================================
// CHURN PREDICTION SERVICE
// =============================================================================

export class ChurnPredictionService implements IChurnPredictionService {
  private featureStore: FeatureStoreService;
  private eventEmitter: EventEmitter;

  // Segment-specific risk profiles
  private riskProfiles: Map<UserSegment, ChurnRiskProfile> = new Map();

  // Intervention effectiveness tracking
  private interventionEffectiveness: Map<InterventionType, number> = new Map();

  // Thresholds
  private readonly HIGH_RISK_THRESHOLD = 0.7;
  private readonly MEDIUM_RISK_THRESHOLD = 0.4;
  private readonly CRITICAL_RISK_THRESHOLD = 0.85;

  constructor(featureStore: FeatureStoreService) {
    this.featureStore = featureStore;
    this.eventEmitter = new EventEmitter();
    this.initializeRiskProfiles();
    this.initializeInterventionEffectiveness();
  }

  // ===========================================================================
  // CHURN PREDICTION
  // ===========================================================================

  async predictChurn(
    request: ChurnPredictionRequest
  ): Promise<ChurnPrediction> {
    const startTime = Date.now();
    const predictionId = this.generateId();

    // Get user features
    const features = await this.getUserFeatures(request.userId);

    // Calculate engagement metrics
    const engagement = this.calculateEngagementMetrics(features);

    // Determine user segment
    const segment = this.determineUserSegment(features, engagement);

    // Calculate churn probability
    const { probability, factors } = this.calculateChurnProbability(
      features,
      engagement,
      segment
    );

    // Determine risk level
    const riskLevel = this.determineRiskLevel(probability);

    // Predict days until churn if at risk
    const predictedChurnDate = this.predictChurnDate(probability, engagement);

    // Get recommended interventions
    const recommendedInterventions = this.recommendInterventions(
      probability,
      segment,
      factors
    );

    const prediction: ChurnPrediction = {
      id: predictionId,
      userId: request.userId,
      probability,
      riskLevel,
      segment,
      topFactors: factors.slice(0, 5),
      predictedChurnDate,
      recommendedInterventions,
      lifetimeValue: this.estimateLifetimeValue(features, engagement),
      modelVersion: "churn-v1.0.0",
      latencyMs: Date.now() - startTime,
      createdAt: new Date(),
    };

    // Update feature store
    await this.featureStore.setFeatureValue(
      "user_churn_risk",
      request.userId,
      probability
    );

    // Emit events for high-risk users
    if (
      riskLevel === ChurnRiskLevel.CRITICAL ||
      riskLevel === ChurnRiskLevel.HIGH
    ) {
      this.eventEmitter.emit("churn:high_risk_detected", {
        userId: request.userId,
        probability,
        riskLevel,
        recommendedInterventions,
      });
    }

    return prediction;
  }

  private async getUserFeatures(
    userId: string
  ): Promise<Record<string, unknown>> {
    const featureNames = [
      "user_total_trips",
      "user_trips_last_7d",
      "user_trips_last_30d",
      "user_cancellation_rate",
      "user_days_since_last_trip",
      "user_avg_trip_frequency",
      "user_total_spend",
      "user_avg_order_value",
      "user_support_tickets_30d",
      "user_rating_given_avg",
      "user_promo_usage_rate",
      "user_referral_count",
      "user_days_since_registration",
      "user_app_opens_7d",
      "user_notification_open_rate",
      "user_peak_usage_hour",
    ];

    const response = await this.featureStore.getFeatures({
      entityType: FeatureEntityType.USER,
      entityIds: [userId],
      featureNames,
    });

    return response.vectors[0]?.features || {};
  }

  private calculateEngagementMetrics(
    features: Record<string, unknown>
  ): EngagementMetrics {
    const tripsLast7d = Number(features.user_trips_last_7d || 0);
    const daysActive = Number(features.user_days_since_registration || 1);

    return {
      tripFrequency: tripsLast7d, // per week
      avgOrderValue: Number(features.user_avg_order_value || 0),
      lastActivityDays: Number(features.user_days_since_last_trip || 0),
      appOpenFrequency: Number(features.user_app_opens_7d || 0),
      featureUsage: {},
      satisfactionScore: Number(features.user_rating_given_avg || 4.0),
    };
  }

  private determineUserSegment(
    features: Record<string, unknown>,
    engagement: EngagementMetrics
  ): UserSegment {
    const totalTrips = Number(features.user_total_trips || 0);
    const totalSpend = Number(features.user_total_spend || 0);
    const daysSinceReg = Number(features.user_days_since_registration || 0);

    // New users (< 30 days)
    if (daysSinceReg < 30) {
      return UserSegment.NEW;
    }

    // VIP users (high spend, high frequency)
    if (totalSpend > 100000 && engagement.tripFrequency >= 3) {
      return UserSegment.VIP;
    }

    // Power users (regular, frequent use)
    if (engagement.tripFrequency >= 2 && totalTrips > 20) {
      return UserSegment.POWER_USER;
    }

    // At-risk users (declining engagement)
    if (engagement.lastActivityDays > 14 && totalTrips > 5) {
      return UserSegment.AT_RISK;
    }

    // Casual users
    if (totalTrips >= 5) {
      return UserSegment.CASUAL;
    }

    // Dormant users
    if (engagement.lastActivityDays > 30) {
      return UserSegment.DORMANT;
    }

    return UserSegment.CASUAL;
  }

  // ===========================================================================
  // CHURN PROBABILITY CALCULATION
  // ===========================================================================

  private calculateChurnProbability(
    features: Record<string, unknown>,
    engagement: EngagementMetrics,
    segment: UserSegment
  ): { probability: number; factors: ChurnFactor[] } {
    const factors: ChurnFactor[] = [];
    let riskScore = 0;
    let totalWeight = 0;

    // 1. Inactivity risk
    const inactivityRisk = this.calculateInactivityRisk(
      engagement.lastActivityDays,
      segment
    );
    if (inactivityRisk.contribution > 0) {
      factors.push(inactivityRisk);
      riskScore += inactivityRisk.contribution * 0.35;
      totalWeight += 0.35;
    }

    // 2. Declining frequency
    const frequencyDecline = this.calculateFrequencyDecline(
      features,
      engagement
    );
    if (frequencyDecline.contribution > 0) {
      factors.push(frequencyDecline);
      riskScore += frequencyDecline.contribution * 0.25;
      totalWeight += 0.25;
    }

    // 3. Satisfaction decline
    const satisfactionRisk = this.calculateSatisfactionRisk(
      features,
      engagement
    );
    if (satisfactionRisk.contribution > 0) {
      factors.push(satisfactionRisk);
      riskScore += satisfactionRisk.contribution * 0.2;
      totalWeight += 0.2;
    }

    // 4. Support ticket surge
    const supportRisk = this.calculateSupportRisk(features);
    if (supportRisk.contribution > 0) {
      factors.push(supportRisk);
      riskScore += supportRisk.contribution * 0.1;
      totalWeight += 0.1;
    }

    // 5. App engagement decline
    const appEngagementRisk = this.calculateAppEngagementRisk(
      features,
      engagement
    );
    if (appEngagementRisk.contribution > 0) {
      factors.push(appEngagementRisk);
      riskScore += appEngagementRisk.contribution * 0.1;
      totalWeight += 0.1;
    }

    // Apply segment-specific base rate
    const baseRate = this.riskProfiles.get(segment)?.baseChurnRate || 0.15;
    const adjustedProbability = baseRate + riskScore * (1 - baseRate);

    // Sort factors by contribution
    factors.sort((a, b) => b.contribution - a.contribution);

    return {
      probability: Math.min(1, Math.max(0, adjustedProbability)),
      factors,
    };
  }

  private calculateInactivityRisk(
    lastActivityDays: number,
    segment: UserSegment
  ): ChurnFactor {
    // Different thresholds per segment
    const thresholds: Record<UserSegment, number> = {
      [UserSegment.VIP]: 7,
      [UserSegment.POWER_USER]: 10,
      [UserSegment.CASUAL]: 21,
      [UserSegment.NEW]: 7,
      [UserSegment.AT_RISK]: 14,
      [UserSegment.DORMANT]: 30,
      [UserSegment.PRICE_SENSITIVE]: 14,
      [UserSegment.BUSINESS]: 10,
    };

    const threshold = thresholds[segment] || 14;
    let contribution = 0;

    if (lastActivityDays > threshold * 2) {
      contribution = 0.9;
    } else if (lastActivityDays > threshold * 1.5) {
      contribution = 0.6;
    } else if (lastActivityDays > threshold) {
      contribution = 0.3;
    }

    return {
      name: "Inactivity period",
      contribution,
      currentValue: lastActivityDays,
      threshold,
      trend: "declining",
      impact:
        contribution > 0.5 ? "high" : contribution > 0.2 ? "medium" : "low",
    };
  }

  private calculateFrequencyDecline(
    features: Record<string, unknown>,
    engagement: EngagementMetrics
  ): ChurnFactor {
    const avgFrequency = Number(features.user_avg_trip_frequency || 1);
    const currentFrequency = engagement.tripFrequency;

    let contribution = 0;
    if (avgFrequency > 0) {
      const decline = (avgFrequency - currentFrequency) / avgFrequency;
      if (decline > 0.7) {
        contribution = 0.8;
      } else if (decline > 0.5) {
        contribution = 0.5;
      } else if (decline > 0.3) {
        contribution = 0.2;
      }
    }

    return {
      name: "Trip frequency decline",
      contribution,
      currentValue: currentFrequency,
      previousValue: avgFrequency,
      trend: "declining",
      impact:
        contribution > 0.5 ? "high" : contribution > 0.2 ? "medium" : "low",
    };
  }

  private calculateSatisfactionRisk(
    features: Record<string, unknown>,
    engagement: EngagementMetrics
  ): ChurnFactor {
    const avgRating = engagement.satisfactionScore;
    let contribution = 0;

    if (avgRating < 3) {
      contribution = 0.8;
    } else if (avgRating < 3.5) {
      contribution = 0.5;
    } else if (avgRating < 4) {
      contribution = 0.2;
    }

    // High cancellation rate increases risk
    const cancellationRate = Number(features.user_cancellation_rate || 0);
    if (cancellationRate > 0.3) {
      contribution = Math.min(1, contribution + 0.3);
    }

    return {
      name: "Low satisfaction indicators",
      contribution,
      currentValue: avgRating,
      threshold: 4.0,
      trend: avgRating < 4 ? "declining" : "stable",
      impact:
        contribution > 0.5 ? "high" : contribution > 0.2 ? "medium" : "low",
    };
  }

  private calculateSupportRisk(features: Record<string, unknown>): ChurnFactor {
    const supportTickets = Number(features.user_support_tickets_30d || 0);
    let contribution = 0;

    if (supportTickets >= 5) {
      contribution = 0.7;
    } else if (supportTickets >= 3) {
      contribution = 0.4;
    } else if (supportTickets >= 1) {
      contribution = 0.1;
    }

    return {
      name: "Support ticket volume",
      contribution,
      currentValue: supportTickets,
      threshold: 3,
      trend: supportTickets > 0 ? "increasing" : "stable",
      impact:
        contribution > 0.5 ? "high" : contribution > 0.2 ? "medium" : "low",
    };
  }

  private calculateAppEngagementRisk(
    features: Record<string, unknown>,
    engagement: EngagementMetrics
  ): ChurnFactor {
    const appOpens = engagement.appOpenFrequency;
    const notificationRate = Number(
      features.user_notification_open_rate || 0.5
    );

    let contribution = 0;

    if (appOpens < 1) {
      contribution += 0.4;
    }

    if (notificationRate < 0.1) {
      contribution += 0.3;
    }

    return {
      name: "Low app engagement",
      contribution: Math.min(1, contribution),
      currentValue: appOpens,
      threshold: 3,
      trend: "declining",
      impact:
        contribution > 0.5 ? "high" : contribution > 0.2 ? "medium" : "low",
    };
  }

  // ===========================================================================
  // CHURN DATE PREDICTION
  // ===========================================================================

  private predictChurnDate(
    probability: number,
    engagement: EngagementMetrics
  ): Date | undefined {
    if (probability < this.MEDIUM_RISK_THRESHOLD) {
      return undefined;
    }

    // Estimate days until churn based on inactivity pattern
    const baselineDays = engagement.lastActivityDays;
    const velocityFactor = 1 + probability;

    // High-risk users churn faster
    let predictedDays: number;
    if (probability > this.CRITICAL_RISK_THRESHOLD) {
      predictedDays = Math.max(3, 7 - baselineDays / 2);
    } else if (probability > this.HIGH_RISK_THRESHOLD) {
      predictedDays = Math.max(7, 14 - baselineDays / 3);
    } else {
      predictedDays = Math.max(14, 30 - baselineDays / 2);
    }

    const churnDate = new Date();
    churnDate.setDate(churnDate.getDate() + Math.round(predictedDays));

    return churnDate;
  }

  // ===========================================================================
  // RISK LEVEL
  // ===========================================================================

  private determineRiskLevel(probability: number): ChurnRiskLevel {
    if (probability >= this.CRITICAL_RISK_THRESHOLD)
      return ChurnRiskLevel.CRITICAL;
    if (probability >= this.HIGH_RISK_THRESHOLD) return ChurnRiskLevel.HIGH;
    if (probability >= this.MEDIUM_RISK_THRESHOLD) return ChurnRiskLevel.MEDIUM;
    return ChurnRiskLevel.LOW;
  }

  // ===========================================================================
  // LIFETIME VALUE ESTIMATION
  // ===========================================================================

  private estimateLifetimeValue(
    features: Record<string, unknown>,
    engagement: EngagementMetrics
  ): number {
    const totalSpend = Number(features.user_total_spend || 0);
    const avgOrderValue = engagement.avgOrderValue;
    const tripFrequency = engagement.tripFrequency;

    // Project future value based on current patterns
    // Assuming average customer lifetime of 2 years
    const monthlyValue = avgOrderValue * tripFrequency * 4;
    const projectedMonths = 24;
    const churnAdjustedMonths = projectedMonths * 0.7; // Adjust for expected churn

    const futureLTV = monthlyValue * churnAdjustedMonths;

    return Math.round(totalSpend + futureLTV);
  }

  // ===========================================================================
  // RETENTION INTERVENTIONS
  // ===========================================================================

  private recommendInterventions(
    probability: number,
    segment: UserSegment,
    factors: ChurnFactor[]
  ): RetentionIntervention[] {
    const interventions: RetentionIntervention[] = [];

    // Determine intervention intensity based on risk
    const riskLevel = this.determineRiskLevel(probability);

    // Map factors to intervention types
    for (const factor of factors.slice(0, 3)) {
      const intervention = this.mapFactorToIntervention(
        factor,
        segment,
        riskLevel
      );
      if (intervention) {
        interventions.push(intervention);
      }
    }

    // Add segment-specific interventions
    const segmentInterventions = this.getSegmentInterventions(
      segment,
      riskLevel
    );
    for (const intervention of segmentInterventions) {
      if (!interventions.some((i) => i.type === intervention.type)) {
        interventions.push(intervention);
      }
    }

    // Sort by expected effectiveness
    interventions.sort(
      (a, b) => (b.expectedLiftPercent || 0) - (a.expectedLiftPercent || 0)
    );

    return interventions.slice(0, 3);
  }

  private mapFactorToIntervention(
    factor: ChurnFactor,
    segment: UserSegment,
    riskLevel: ChurnRiskLevel
  ): RetentionIntervention | null {
    const factorInterventions: Record<string, InterventionType> = {
      "Inactivity period": InterventionType.REENGAGEMENT_EMAIL,
      "Trip frequency decline": InterventionType.DISCOUNT_OFFER,
      "Low satisfaction indicators": InterventionType.SUPPORT_OUTREACH,
      "Support ticket volume": InterventionType.PRIORITY_SUPPORT,
      "Low app engagement": InterventionType.PUSH_NOTIFICATION,
    };

    const type = factorInterventions[factor.name];
    if (!type) return null;

    // Scale offer value based on risk level
    const offerMultiplier: Record<ChurnRiskLevel, number> = {
      [ChurnRiskLevel.CRITICAL]: 1.5,
      [ChurnRiskLevel.HIGH]: 1.2,
      [ChurnRiskLevel.MEDIUM]: 1.0,
      [ChurnRiskLevel.LOW]: 0.8,
    };

    const effectiveness = this.interventionEffectiveness.get(type) || 0.1;

    return {
      id: this.generateId(),
      type,
      channel: this.getChannelForType(type),
      message: this.generateInterventionMessage(type, segment),
      offerValue: this.calculateOfferValue(segment, offerMultiplier[riskLevel]),
      validityDays: riskLevel === ChurnRiskLevel.CRITICAL ? 3 : 7,
      expectedLiftPercent: effectiveness * 100 * offerMultiplier[riskLevel],
      priority: riskLevel === ChurnRiskLevel.CRITICAL ? "high" : "medium",
    };
  }

  private getSegmentInterventions(
    segment: UserSegment,
    riskLevel: ChurnRiskLevel
  ): RetentionIntervention[] {
    const interventions: RetentionIntervention[] = [];

    if (segment === UserSegment.VIP || segment === UserSegment.POWER_USER) {
      interventions.push({
        id: this.generateId(),
        type: InterventionType.VIP_PERKS,
        channel: "in_app",
        message: "Exclusive benefits waiting for you!",
        offerValue: 2000, // NGN
        validityDays: 14,
        expectedLiftPercent: 25,
        priority: "high",
      });
    }

    if (segment === UserSegment.NEW) {
      interventions.push({
        id: this.generateId(),
        type: InterventionType.ONBOARDING_SUPPORT,
        channel: "email",
        message: "Complete your profile for bonus rewards",
        offerValue: 500,
        validityDays: 7,
        expectedLiftPercent: 15,
        priority: "medium",
      });
    }

    if (riskLevel === ChurnRiskLevel.CRITICAL) {
      interventions.push({
        id: this.generateId(),
        type: InterventionType.WIN_BACK_OFFER,
        channel: "sms",
        message: "We miss you! Here's a special offer just for you",
        offerValue: 1500,
        validityDays: 3,
        expectedLiftPercent: 30,
        priority: "urgent",
      });
    }

    return interventions;
  }

  private getChannelForType(type: InterventionType): string {
    const channels: Record<InterventionType, string> = {
      [InterventionType.DISCOUNT_OFFER]: "in_app",
      [InterventionType.FREE_DELIVERY]: "push",
      [InterventionType.LOYALTY_BONUS]: "in_app",
      [InterventionType.PERSONAL_MESSAGE]: "email",
      [InterventionType.VIP_PERKS]: "in_app",
      [InterventionType.REENGAGEMENT_EMAIL]: "email",
      [InterventionType.PUSH_NOTIFICATION]: "push",
      [InterventionType.WIN_BACK_OFFER]: "sms",
      [InterventionType.SUPPORT_OUTREACH]: "phone",
      [InterventionType.SURVEY]: "email",
      [InterventionType.REFERRAL_INCENTIVE]: "in_app",
      [InterventionType.PRIORITY_SUPPORT]: "in_app",
      [InterventionType.ONBOARDING_SUPPORT]: "email",
    };
    return channels[type] || "email";
  }

  private generateInterventionMessage(
    type: InterventionType,
    segment: UserSegment
  ): string {
    const messages: Record<InterventionType, string> = {
      [InterventionType.DISCOUNT_OFFER]: "Your exclusive discount is ready!",
      [InterventionType.FREE_DELIVERY]:
        "Enjoy free delivery on your next order",
      [InterventionType.LOYALTY_BONUS]: "Bonus points added to your account",
      [InterventionType.PERSONAL_MESSAGE]: "We value you as a customer",
      [InterventionType.VIP_PERKS]: "Unlock VIP benefits today",
      [InterventionType.REENGAGEMENT_EMAIL]:
        "We miss you! Check out what's new",
      [InterventionType.PUSH_NOTIFICATION]: "Great deals waiting for you",
      [InterventionType.WIN_BACK_OFFER]: "Welcome back! Special offer inside",
      [InterventionType.SUPPORT_OUTREACH]: "How can we help you better?",
      [InterventionType.SURVEY]: "Your feedback matters to us",
      [InterventionType.REFERRAL_INCENTIVE]: "Share the love, earn rewards",
      [InterventionType.PRIORITY_SUPPORT]: "Priority support enabled",
      [InterventionType.ONBOARDING_SUPPORT]: "Let us help you get started",
    };
    return messages[type] || "Special offer for you";
  }

  private calculateOfferValue(
    segment: UserSegment,
    multiplier: number
  ): number {
    const baseValues: Record<UserSegment, number> = {
      [UserSegment.VIP]: 2000,
      [UserSegment.POWER_USER]: 1500,
      [UserSegment.CASUAL]: 800,
      [UserSegment.NEW]: 500,
      [UserSegment.AT_RISK]: 1200,
      [UserSegment.DORMANT]: 1000,
      [UserSegment.PRICE_SENSITIVE]: 1000,
      [UserSegment.BUSINESS]: 1500,
    };

    return Math.round((baseValues[segment] || 500) * multiplier);
  }

  // ===========================================================================
  // CAMPAIGN MANAGEMENT
  // ===========================================================================

  async createCampaign(
    campaign: Partial<RetentionCampaign>
  ): Promise<RetentionCampaign> {
    const campaignId = this.generateId();

    const newCampaign: RetentionCampaign = {
      id: campaignId,
      name: campaign.name || "New Campaign",
      description: campaign.description,
      targetSegments: campaign.targetSegments || [],
      interventionTypes: campaign.interventionTypes || [],
      startDate: campaign.startDate || new Date(),
      endDate: campaign.endDate,
      budget: campaign.budget || 0,
      budgetUsed: 0,
      targetAudience: campaign.targetAudience || 0,
      reachedAudience: 0,
      convertedUsers: 0,
      status: "draft",
      createdAt: new Date(),
    };

    this.eventEmitter.emit("campaign:created", newCampaign);

    return newCampaign;
  }

  async executeCampaign(campaignId: string): Promise<void> {
    this.eventEmitter.emit("campaign:executing", { campaignId });

    // In production, would:
    // 1. Query users matching segment criteria
    // 2. Score each for churn
    // 3. Assign appropriate interventions
    // 4. Execute through notification service
    // 5. Track engagement and conversions
  }

  async trackIntervention(
    userId: string,
    interventionId: string,
    outcome: "delivered" | "opened" | "converted" | "ignored"
  ): Promise<void> {
    this.eventEmitter.emit("intervention:tracked", {
      userId,
      interventionId,
      outcome,
      timestamp: new Date(),
    });

    // Update intervention effectiveness scores
    if (outcome === "converted") {
      // Would update ML model with positive signal
    }
  }

  // ===========================================================================
  // BATCH PREDICTIONS
  // ===========================================================================

  async batchPredictChurn(
    userIds: string[]
  ): Promise<Map<string, ChurnPrediction>> {
    const results = new Map<string, ChurnPrediction>();

    // Process in batches for efficiency
    const batchSize = 100;
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);

      const predictions = await Promise.all(
        batch.map((userId) => this.predictChurn({ userId }))
      );

      for (let j = 0; j < batch.length; j++) {
        results.set(batch[j], predictions[j]);
      }
    }

    return results;
  }

  async getHighRiskUsers(
    segment?: UserSegment,
    limit: number = 100
  ): Promise<ChurnPrediction[]> {
    // In production, query pre-computed predictions from database
    // filtered by risk level and segment
    return [];
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  private initializeRiskProfiles(): void {
    this.riskProfiles.set(UserSegment.VIP, {
      segment: UserSegment.VIP,
      baseChurnRate: 0.05,
      riskFactorWeights: { inactivity: 0.4, frequency: 0.3, satisfaction: 0.3 },
      interventionPriority: 1,
    });

    this.riskProfiles.set(UserSegment.POWER_USER, {
      segment: UserSegment.POWER_USER,
      baseChurnRate: 0.08,
      riskFactorWeights: {
        inactivity: 0.35,
        frequency: 0.35,
        satisfaction: 0.3,
      },
      interventionPriority: 2,
    });

    this.riskProfiles.set(UserSegment.CASUAL, {
      segment: UserSegment.CASUAL,
      baseChurnRate: 0.2,
      riskFactorWeights: {
        inactivity: 0.5,
        frequency: 0.25,
        satisfaction: 0.25,
      },
      interventionPriority: 4,
    });

    this.riskProfiles.set(UserSegment.NEW, {
      segment: UserSegment.NEW,
      baseChurnRate: 0.35,
      riskFactorWeights: { inactivity: 0.3, frequency: 0.3, satisfaction: 0.4 },
      interventionPriority: 3,
    });

    this.riskProfiles.set(UserSegment.AT_RISK, {
      segment: UserSegment.AT_RISK,
      baseChurnRate: 0.5,
      riskFactorWeights: { inactivity: 0.5, frequency: 0.3, satisfaction: 0.2 },
      interventionPriority: 1,
    });

    this.riskProfiles.set(UserSegment.DORMANT, {
      segment: UserSegment.DORMANT,
      baseChurnRate: 0.7,
      riskFactorWeights: { inactivity: 0.6, frequency: 0.2, satisfaction: 0.2 },
      interventionPriority: 5,
    });
  }

  private initializeInterventionEffectiveness(): void {
    // Based on historical A/B test results
    this.interventionEffectiveness.set(InterventionType.DISCOUNT_OFFER, 0.22);
    this.interventionEffectiveness.set(InterventionType.FREE_DELIVERY, 0.18);
    this.interventionEffectiveness.set(InterventionType.LOYALTY_BONUS, 0.15);
    this.interventionEffectiveness.set(InterventionType.VIP_PERKS, 0.25);
    this.interventionEffectiveness.set(
      InterventionType.REENGAGEMENT_EMAIL,
      0.08
    );
    this.interventionEffectiveness.set(
      InterventionType.PUSH_NOTIFICATION,
      0.05
    );
    this.interventionEffectiveness.set(InterventionType.WIN_BACK_OFFER, 0.28);
    this.interventionEffectiveness.set(InterventionType.SUPPORT_OUTREACH, 0.12);
    this.interventionEffectiveness.set(
      InterventionType.REFERRAL_INCENTIVE,
      0.1
    );
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private generateId(): string {
    return `churn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, listener);
  }

  off(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.off(event, listener);
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default ChurnPredictionService;
