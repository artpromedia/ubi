// =============================================================================
// UBI AI/ML PLATFORM - CHURN PREDICTION & RETENTION SERVICE
// =============================================================================
// ML-driven churn prediction with proactive retention interventions
// Target: +20% retention, identify at-risk users 14 days before churn
// =============================================================================

import { EventEmitter } from "events";

import {
  type ChurnFactor,
  type ChurnPrediction,
  type ChurnPredictionRequest,
  ChurnRiskLevel,
  FeatureEntityType,
  type IChurnPredictionService,
  InterventionType,
  type RetentionCampaign,
  type RetentionAction,
} from "../../types/ml.types";

import type { FeatureStoreService } from "./feature-store.service";

// User segment types for churn prediction
enum UserSegmentType {
  VIP = "VIP",
  POWER_USER = "POWER_USER",
  CASUAL = "CASUAL",
  NEW = "NEW",
  AT_RISK = "AT_RISK",
  DORMANT = "DORMANT",
  PRICE_SENSITIVE = "PRICE_SENSITIVE",
  BUSINESS = "BUSINESS",
}

// Internal type for retention recommendations (before converting to RetentionAction)
interface RetentionRecommendation {
  id: string;
  type: InterventionType;
  channel: string;
  message: string;
  offerValue: number;
  validityDays: number;
  expectedLiftPercent: number;
  priority: string;
}

// =============================================================================
// CHURN RISK PROFILES
// =============================================================================

interface ChurnRiskProfile {
  segment: UserSegmentType;
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
  private riskProfiles: Map<UserSegmentType, ChurnRiskProfile> = new Map();

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
    request: ChurnPredictionRequest,
  ): Promise<ChurnPrediction> {
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
      segment,
    );

    // Determine risk level
    const riskLevel = this.determineRiskLevel(probability);

    // Get recommended interventions
    const recommendations = this.recommendInterventions(
      probability,
      segment,
      factors,
    );

    // Convert recommendations to RetentionAction format
    const recommendedActions: RetentionAction[] = recommendations.map(
      (rec) => ({
        type: rec.type,
        description: rec.message,
        expectedImpact: rec.expectedLiftPercent / 100,
        cost: rec.offerValue,
        priority: rec.priority === "high" || rec.priority === "urgent" ? 1 : 2,
        config: {
          channel: rec.channel,
          validityDays: rec.validityDays,
        },
      }),
    );

    const prediction: ChurnPrediction = {
      id: predictionId,
      userId: request.userId,
      churnProbability: probability,
      riskLevel,
      topFactors: factors.slice(0, 5),
      recommendedActions,
      modelVersion: "churn-v1.0.0",
      createdAt: new Date(),
    };

    // Update feature store
    await this.featureStore.setFeatureValue(
      "user_churn_risk",
      request.userId,
      probability,
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
        recommendedActions,
      });
    }

    return prediction;
  }

  private async getUserFeatures(
    userId: string,
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
    features: Record<string, unknown>,
  ): EngagementMetrics {
    const tripsLast7d = Number(features.user_trips_last_7d || 0);

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
    engagement: EngagementMetrics,
  ): UserSegmentType {
    const totalTrips = Number(features.user_total_trips || 0);
    const totalSpend = Number(features.user_total_spend || 0);
    const daysSinceReg = Number(features.user_days_since_registration || 0);

    // New users (< 30 days)
    if (daysSinceReg < 30) {
      return UserSegmentType.NEW;
    }

    // VIP users (high spend, high frequency)
    if (totalSpend > 100000 && engagement.tripFrequency >= 3) {
      return UserSegmentType.VIP;
    }

    // Power users (regular, frequent use)
    if (engagement.tripFrequency >= 2 && totalTrips > 20) {
      return UserSegmentType.POWER_USER;
    }

    // At-risk users (declining engagement)
    if (engagement.lastActivityDays > 14 && totalTrips > 5) {
      return UserSegmentType.AT_RISK;
    }

    // Casual users
    if (totalTrips >= 5) {
      return UserSegmentType.CASUAL;
    }

    // Dormant users
    if (engagement.lastActivityDays > 30) {
      return UserSegmentType.DORMANT;
    }

    return UserSegmentType.CASUAL;
  }

  // ===========================================================================
  // CHURN PROBABILITY CALCULATION
  // ===========================================================================

  private calculateChurnProbability(
    features: Record<string, unknown>,
    engagement: EngagementMetrics,
    segment: UserSegmentType,
  ): { probability: number; factors: ChurnFactor[] } {
    const factors: ChurnFactor[] = [];
    let riskScore = 0;
    let totalWeight = 0;

    // 1. Inactivity risk
    const inactivityRisk = this.calculateInactivityRisk(
      engagement.lastActivityDays,
      segment,
    );
    if (inactivityRisk.contribution > 0) {
      factors.push(inactivityRisk);
      riskScore += inactivityRisk.contribution * 0.35;
      totalWeight += 0.35;
    }

    // 2. Declining frequency
    const frequencyDecline = this.calculateFrequencyDecline(
      features,
      engagement,
    );
    if (frequencyDecline.contribution > 0) {
      factors.push(frequencyDecline);
      riskScore += frequencyDecline.contribution * 0.25;
      totalWeight += 0.25;
    }

    // 3. Satisfaction decline
    const satisfactionRisk = this.calculateSatisfactionRisk(
      features,
      engagement,
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
      engagement,
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
    segment: UserSegmentType,
  ): ChurnFactor {
    // Different thresholds per segment
    const thresholds: Record<UserSegmentType, number> = {
      [UserSegmentType.VIP]: 7,
      [UserSegmentType.POWER_USER]: 10,
      [UserSegmentType.CASUAL]: 21,
      [UserSegmentType.NEW]: 7,
      [UserSegmentType.AT_RISK]: 14,
      [UserSegmentType.DORMANT]: 30,
      [UserSegmentType.PRICE_SENSITIVE]: 14,
      [UserSegmentType.BUSINESS]: 10,
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
      description: `User has been inactive for ${lastActivityDays} days`,
      contribution,
      value: lastActivityDays,
      trend: contribution > 0.5 ? "worsening" : "stable",
      benchmark: threshold,
    };
  }

  private calculateFrequencyDecline(
    features: Record<string, unknown>,
    engagement: EngagementMetrics,
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
      description: `Trip frequency declined from ${avgFrequency} to ${currentFrequency}`,
      contribution,
      value: currentFrequency,
      trend:
        contribution > 0.5
          ? "worsening"
          : contribution > 0.2
            ? "worsening"
            : "stable",
      benchmark: avgFrequency,
    };
  }

  private calculateSatisfactionRisk(
    features: Record<string, unknown>,
    engagement: EngagementMetrics,
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
      description: `User satisfaction score is ${avgRating} (target: 4.0+)`,
      contribution,
      value: avgRating,
      trend: avgRating < 4 ? "worsening" : "stable",
      benchmark: 4.0,
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
      description: `User has ${supportTickets} support tickets in last 30 days`,
      contribution,
      value: supportTickets,
      trend: supportTickets >= 3 ? "worsening" : "stable",
      benchmark: 3,
    };
  }

  private calculateAppEngagementRisk(
    features: Record<string, unknown>,
    engagement: EngagementMetrics,
  ): ChurnFactor {
    const appOpens = engagement.appOpenFrequency;
    const notificationRate = Number(
      features.user_notification_open_rate || 0.5,
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
      description: `App opened ${appOpens} times in last 7 days`,
      contribution: Math.min(1, contribution),
      value: appOpens,
      trend: contribution > 0.3 ? "worsening" : "stable",
      benchmark: 3,
    };
  }

  // ===========================================================================
  // RISK LEVEL
  // ===========================================================================

  private determineRiskLevel(probability: number): ChurnRiskLevel {
    if (probability >= this.CRITICAL_RISK_THRESHOLD) {
      return ChurnRiskLevel.CRITICAL;
    }
    if (probability >= this.HIGH_RISK_THRESHOLD) {
      return ChurnRiskLevel.HIGH;
    }
    if (probability >= this.MEDIUM_RISK_THRESHOLD) {
      return ChurnRiskLevel.MEDIUM;
    }
    return ChurnRiskLevel.LOW;
  }

  // ===========================================================================
  // RETENTION INTERVENTIONS
  // ===========================================================================

  private recommendInterventions(
    probability: number,
    segment: UserSegmentType,
    factors: ChurnFactor[],
  ): RetentionRecommendation[] {
    const interventions: RetentionRecommendation[] = [];

    // Determine intervention intensity based on risk
    const riskLevel = this.determineRiskLevel(probability);

    // Map factors to intervention types
    for (const factor of factors.slice(0, 3)) {
      const intervention = this.mapFactorToIntervention(
        factor,
        segment,
        riskLevel,
      );
      if (intervention) {
        interventions.push(intervention);
      }
    }

    // Add segment-specific interventions
    const segmentInterventions = this.getSegmentInterventions(
      segment,
      riskLevel,
    );
    for (const intervention of segmentInterventions) {
      if (!interventions.some((i) => i.type === intervention.type)) {
        interventions.push(intervention);
      }
    }

    // Sort by expected effectiveness
    interventions.sort((a, b) => b.expectedLiftPercent - a.expectedLiftPercent);

    return interventions.slice(0, 3);
  }

  private mapFactorToIntervention(
    factor: ChurnFactor,
    segment: UserSegmentType,
    riskLevel: ChurnRiskLevel,
  ): RetentionRecommendation | null {
    const factorInterventions: Record<string, InterventionType> = {
      "Inactivity period": InterventionType.EMAIL,
      "Trip frequency decline": InterventionType.DISCOUNT,
      "Low satisfaction indicators": InterventionType.CALL,
      "Support ticket volume": InterventionType.PERSONALIZED_CONTENT,
      "Low app engagement": InterventionType.PUSH,
    };

    const type = factorInterventions[factor.name];
    if (!type) {
      return null;
    }

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
    segment: UserSegmentType,
    riskLevel: ChurnRiskLevel,
  ): RetentionRecommendation[] {
    const interventions: RetentionRecommendation[] = [];

    if (
      segment === UserSegmentType.VIP ||
      segment === UserSegmentType.POWER_USER
    ) {
      interventions.push({
        id: this.generateId(),
        type: InterventionType.PERSONALIZED_CONTENT,
        channel: "in_app",
        message: "Exclusive benefits waiting for you!",
        offerValue: 2000,
        validityDays: 14,
        expectedLiftPercent: 25,
        priority: "high",
      });
    }

    if (segment === UserSegmentType.NEW) {
      interventions.push({
        id: this.generateId(),
        type: InterventionType.IN_APP_MESSAGE,
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
        type: InterventionType.OFFER,
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
      [InterventionType.EMAIL]: "email",
      [InterventionType.SMS]: "sms",
      [InterventionType.PUSH]: "push",
      [InterventionType.CALL]: "phone",
      [InterventionType.DISCOUNT]: "in_app",
      [InterventionType.OFFER]: "in_app",
      [InterventionType.PERSONALIZED_CONTENT]: "in_app",
      [InterventionType.IN_APP_MESSAGE]: "in_app",
      [InterventionType.LOYALTY_BONUS]: "in_app",
    };
    return channels[type] || "email";
  }

  private generateInterventionMessage(
    type: InterventionType,
    _segment: UserSegmentType,
  ): string {
    const messages: Record<InterventionType, string> = {
      [InterventionType.EMAIL]: "We miss you! Check out what's new",
      [InterventionType.SMS]: "Special offer just for you!",
      [InterventionType.PUSH]: "Great deals waiting for you",
      [InterventionType.CALL]: "How can we help you better?",
      [InterventionType.DISCOUNT]: "Your exclusive discount is ready!",
      [InterventionType.OFFER]: "Welcome back! Special offer inside",
      [InterventionType.PERSONALIZED_CONTENT]: "We value you as a customer",
      [InterventionType.IN_APP_MESSAGE]:
        "Check out your personalized recommendations",
      [InterventionType.LOYALTY_BONUS]: "Bonus points added to your account",
    };
    return messages[type] || "Special offer for you";
  }

  private calculateOfferValue(
    segment: UserSegmentType,
    multiplier: number,
  ): number {
    const baseValues: Record<UserSegmentType, number> = {
      [UserSegmentType.VIP]: 2000,
      [UserSegmentType.POWER_USER]: 1500,
      [UserSegmentType.CASUAL]: 800,
      [UserSegmentType.NEW]: 500,
      [UserSegmentType.AT_RISK]: 1200,
      [UserSegmentType.DORMANT]: 1000,
      [UserSegmentType.PRICE_SENSITIVE]: 1000,
      [UserSegmentType.BUSINESS]: 1500,
    };

    return Math.round((baseValues[segment] || 500) * multiplier);
  }

  // ===========================================================================
  // CAMPAIGN MANAGEMENT
  // ===========================================================================

  async createCampaign(
    campaign: Partial<RetentionCampaign> & { name: string },
  ): Promise<RetentionCampaign> {
    const campaignId = this.generateId();

    const newCampaign: RetentionCampaign = {
      id: campaignId,
      name: campaign.name || "New Campaign",
      description: campaign.description,
      targetSegment: campaign.targetSegment || { riskLevels: [] },
      targetUserCount: campaign.targetUserCount,
      interventionType: campaign.interventionType || InterventionType.EMAIL,
      interventionConfig: campaign.interventionConfig || { channels: [] },
      startDate: campaign.startDate || new Date(),
      endDate: campaign.endDate,
      budgetTotal: campaign.budgetTotal,
      budgetUsed: 0,
      maxPerUser: campaign.maxPerUser,
      performance: campaign.performance,
      isActive: false,
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
    outcome: "delivered" | "opened" | "converted" | "ignored",
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

  async triggerIntervention(userId: string, campaignId: string): Promise<void> {
    this.eventEmitter.emit("intervention:triggered", {
      userId,
      campaignId,
      timestamp: new Date(),
    });
    // In production, would trigger the intervention through notification service
  }

  async recordOutcome(predictionId: string, churned: boolean): Promise<void> {
    this.eventEmitter.emit("churn:outcome_recorded", {
      predictionId,
      churned,
      timestamp: new Date(),
    });
    // In production, would update the model with actual outcome for continuous learning
  }

  // ===========================================================================
  // BATCH PREDICTIONS
  // ===========================================================================

  async batchPredictChurn(userIds: string[]): Promise<ChurnPrediction[]> {
    const results: ChurnPrediction[] = [];

    // Process in batches for efficiency
    const batchSize = 100;
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);

      const predictions = await Promise.all(
        batch.map(async (userId) => this.predictChurn({ userId })),
      );

      results.push(...predictions);
    }

    return results;
  }

  async getHighRiskUsers(
    _segment?: UserSegmentType,
    _limit: number = 100,
  ): Promise<ChurnPrediction[]> {
    // In production, query pre-computed predictions from database
    // filtered by risk level and segment
    return [];
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  private initializeRiskProfiles(): void {
    this.riskProfiles.set(UserSegmentType.VIP, {
      segment: UserSegmentType.VIP,
      baseChurnRate: 0.05,
      riskFactorWeights: { inactivity: 0.4, frequency: 0.3, satisfaction: 0.3 },
      interventionPriority: 1,
    });

    this.riskProfiles.set(UserSegmentType.POWER_USER, {
      segment: UserSegmentType.POWER_USER,
      baseChurnRate: 0.08,
      riskFactorWeights: {
        inactivity: 0.35,
        frequency: 0.35,
        satisfaction: 0.3,
      },
      interventionPriority: 2,
    });

    this.riskProfiles.set(UserSegmentType.CASUAL, {
      segment: UserSegmentType.CASUAL,
      baseChurnRate: 0.2,
      riskFactorWeights: {
        inactivity: 0.5,
        frequency: 0.25,
        satisfaction: 0.25,
      },
      interventionPriority: 4,
    });

    this.riskProfiles.set(UserSegmentType.NEW, {
      segment: UserSegmentType.NEW,
      baseChurnRate: 0.35,
      riskFactorWeights: { inactivity: 0.3, frequency: 0.3, satisfaction: 0.4 },
      interventionPriority: 3,
    });

    this.riskProfiles.set(UserSegmentType.AT_RISK, {
      segment: UserSegmentType.AT_RISK,
      baseChurnRate: 0.5,
      riskFactorWeights: { inactivity: 0.5, frequency: 0.3, satisfaction: 0.2 },
      interventionPriority: 1,
    });

    this.riskProfiles.set(UserSegmentType.DORMANT, {
      segment: UserSegmentType.DORMANT,
      baseChurnRate: 0.7,
      riskFactorWeights: { inactivity: 0.6, frequency: 0.2, satisfaction: 0.2 },
      interventionPriority: 5,
    });
  }

  private initializeInterventionEffectiveness(): void {
    // Based on historical A/B test results
    this.interventionEffectiveness.set(InterventionType.EMAIL, 0.08);
    this.interventionEffectiveness.set(InterventionType.SMS, 0.12);
    this.interventionEffectiveness.set(InterventionType.PUSH, 0.05);
    this.interventionEffectiveness.set(InterventionType.CALL, 0.12);
    this.interventionEffectiveness.set(InterventionType.DISCOUNT, 0.22);
    this.interventionEffectiveness.set(InterventionType.OFFER, 0.28);
    this.interventionEffectiveness.set(
      InterventionType.PERSONALIZED_CONTENT,
      0.15,
    );
    this.interventionEffectiveness.set(InterventionType.IN_APP_MESSAGE, 0.1);
    this.interventionEffectiveness.set(InterventionType.LOYALTY_BONUS, 0.15);
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
