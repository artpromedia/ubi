// =============================================================================
// UBI AI/ML PLATFORM - FRAUD DETECTION SERVICE
// =============================================================================
// Real-time fraud scoring with ensemble models and graph analysis
// Target: -80% fraud losses, <50ms scoring latency
// =============================================================================

import { EventEmitter } from "events";
import {
  CollusionDetectionRequest,
  CollusionMember,
  CollusionNetwork,
  CollusionPattern,
  FeatureEntityType,
  FraudContext,
  FraudFactor,
  FraudRiskLevel,
  FraudScore,
  FraudScoreRequest,
  FraudType,
  FraudTypeScore,
  IFraudDetectionService,
} from "../types/ml.types";
import { FeatureStoreService } from "./feature-store.service";

// =============================================================================
// FRAUD DETECTION MODELS
// =============================================================================

interface FraudRule {
  id: string;
  name: string;
  type: FraudType;
  condition: (
    features: Record<string, unknown>,
    context?: FraudContext
  ) => boolean;
  score: number; // 0-1 contribution to fraud score
  weight: number;
  autoBlock: boolean;
}

interface VelocityCheck {
  metric: string;
  windowMinutes: number;
  threshold: number;
  score: number;
}

interface DeviceFingerprint {
  deviceId: string;
  userAgent: string;
  platform: string;
  screenResolution: string;
  timezone: string;
  language: string;
  plugins: string[];
  canvasHash: string;
}

// =============================================================================
// FRAUD DETECTION SERVICE
// =============================================================================

export class FraudDetectionService implements IFraudDetectionService {
  private featureStore: FeatureStoreService;
  private eventEmitter: EventEmitter;

  // Rule-based fraud detection
  private fraudRules: FraudRule[] = [];

  // Velocity tracking (in production, use Redis)
  private velocityCache: Map<string, { count: number; lastUpdate: number }[]> =
    new Map();

  // Known fraud patterns
  private knownFraudDevices: Set<string> = new Set();
  private knownFraudIPs: Set<string> = new Set();
  private highRiskCountries: Set<string> = new Set(["XX"]); // Placeholder

  // Thresholds
  private readonly BLOCK_THRESHOLD = 0.85;
  private readonly REVIEW_THRESHOLD = 0.5;
  private readonly HIGH_RISK_THRESHOLD = 0.7;

  constructor(featureStore: FeatureStoreService) {
    this.featureStore = featureStore;
    this.eventEmitter = new EventEmitter();
    this.initializeFraudRules();
  }

  // ===========================================================================
  // FRAUD SCORING
  // ===========================================================================

  async scoreEntity(request: FraudScoreRequest): Promise<FraudScore> {
    const startTime = Date.now();
    const scoreId = this.generateId();

    // Get features from feature store
    const entityFeatures = await this.getEntityFeatures(
      request.entityType,
      request.entityId
    );

    // Merge with provided features
    const features = { ...entityFeatures, ...request.features };

    // Run through all fraud models
    const fraudTypeScores = await this.calculateFraudTypeScores(
      features,
      request.context
    );

    // Calculate aggregate score
    const { score, topFactors } = this.aggregateFraudScores(
      fraudTypeScores,
      features,
      request.context
    );

    // Determine risk level
    const riskLevel = this.determineRiskLevel(score);

    // Determine recommendation
    const recommendation = this.determineRecommendation(score, fraudTypeScores);

    const fraudScore: FraudScore = {
      id: scoreId,
      entityType: request.entityType,
      entityId: request.entityId,
      score,
      riskLevel,
      fraudTypes: fraudTypeScores,
      topFactors,
      recommendation,
      modelVersion: "fraud-v1.0.0",
      latencyMs: Date.now() - startTime,
      createdAt: new Date(),
    };

    // Update feature store with new fraud score
    await this.featureStore.setFeatureValue(
      `${request.entityType}_fraud_score`,
      request.entityId,
      score
    );

    // Emit event for logging/alerting
    this.eventEmitter.emit("fraud:scored", fraudScore);

    // Auto-block if threshold exceeded
    if (recommendation === "block") {
      this.eventEmitter.emit("fraud:blocked", {
        entityType: request.entityType,
        entityId: request.entityId,
        score,
        reason: topFactors[0]?.name || "High fraud risk",
      });
    }

    return fraudScore;
  }

  private async getEntityFeatures(
    entityType: string,
    entityId: string
  ): Promise<Record<string, unknown>> {
    const featureNames = this.getFraudFeatureNames(entityType);

    const featureType =
      entityType.toUpperCase() as keyof typeof FeatureEntityType;
    const response = await this.featureStore.getFeatures({
      entityType: FeatureEntityType[featureType] || FeatureEntityType.USER,
      entityIds: [entityId],
      featureNames,
    });

    return response.vectors[0]?.features || {};
  }

  private getFraudFeatureNames(entityType: string): string[] {
    switch (entityType) {
      case "user":
        return [
          "user_total_trips",
          "user_trips_last_7d",
          "user_cancellation_rate",
          "user_days_since_last_trip",
          "user_fraud_score",
          "user_total_spend",
        ];
      case "driver":
        return [
          "driver_total_trips",
          "driver_avg_rating",
          "driver_acceptance_rate",
          "driver_cancellation_rate",
          "driver_fraud_score",
        ];
      case "transaction":
        return [
          "payment_method_age_days",
          "payment_method_success_rate",
          "payment_velocity_24h",
          "payment_amount_velocity_24h",
        ];
      default:
        return [];
    }
  }

  // ===========================================================================
  // FRAUD TYPE SCORING
  // ===========================================================================

  private async calculateFraudTypeScores(
    features: Record<string, unknown>,
    context?: FraudContext
  ): Promise<FraudTypeScore[]> {
    const scores: FraudTypeScore[] = [];

    // Payment Fraud
    const paymentFraudScore = this.calculatePaymentFraudScore(
      features,
      context
    );
    scores.push({
      type: FraudType.PAYMENT_FRAUD,
      score: paymentFraudScore,
      isHighRisk: paymentFraudScore > this.HIGH_RISK_THRESHOLD,
    });

    // Account Takeover
    const atoScore = this.calculateAccountTakeoverScore(features, context);
    scores.push({
      type: FraudType.ACCOUNT_TAKEOVER,
      score: atoScore,
      isHighRisk: atoScore > this.HIGH_RISK_THRESHOLD,
    });

    // Promo Abuse
    const promoAbuseScore = this.calculatePromoAbuseScore(features);
    scores.push({
      type: FraudType.PROMO_ABUSE,
      score: promoAbuseScore,
      isHighRisk: promoAbuseScore > this.HIGH_RISK_THRESHOLD,
    });

    // Fake Trip
    const fakeTripScore = this.calculateFakeTripScore(features);
    scores.push({
      type: FraudType.FAKE_TRIP,
      score: fakeTripScore,
      isHighRisk: fakeTripScore > this.HIGH_RISK_THRESHOLD,
    });

    // GPS Spoofing
    const gpsSpoofingScore = this.calculateGPSSpoofingScore(features, context);
    scores.push({
      type: FraudType.GPS_SPOOFING,
      score: gpsSpoofingScore,
      isHighRisk: gpsSpoofingScore > this.HIGH_RISK_THRESHOLD,
    });

    // Refund Abuse
    const refundAbuseScore = this.calculateRefundAbuseScore(features);
    scores.push({
      type: FraudType.REFUND_ABUSE,
      score: refundAbuseScore,
      isHighRisk: refundAbuseScore > this.HIGH_RISK_THRESHOLD,
    });

    return scores;
  }

  private calculatePaymentFraudScore(
    features: Record<string, unknown>,
    context?: FraudContext
  ): number {
    let score = 0;
    let weights = 0;

    // New payment method
    const paymentMethodAge = Number(features.payment_method_age_days || 365);
    if (paymentMethodAge < 1) {
      score += 0.4;
      weights += 0.4;
    } else if (paymentMethodAge < 7) {
      score += 0.2;
      weights += 0.4;
    }

    // Payment velocity
    const velocity = Number(features.payment_velocity_24h || 0);
    if (velocity > 10) {
      score += 0.5;
      weights += 0.5;
    } else if (velocity > 5) {
      score += 0.2;
      weights += 0.5;
    }

    // Amount velocity
    const amountVelocity = Number(features.payment_amount_velocity_24h || 0);
    if (amountVelocity > 100000) {
      // > 100k NGN in 24h
      score += 0.4;
      weights += 0.4;
    } else if (amountVelocity > 50000) {
      score += 0.2;
      weights += 0.4;
    }

    // Historical success rate
    const successRate = Number(features.payment_method_success_rate || 1);
    if (successRate < 0.5) {
      score += 0.4;
      weights += 0.3;
    }

    // New device
    if (context?.isNewDevice) {
      score += 0.2;
      weights += 0.2;
    }

    // Known fraud device
    if (context?.deviceId && this.knownFraudDevices.has(context.deviceId)) {
      score += 0.8;
      weights += 0.8;
    }

    return weights > 0 ? score / weights : 0;
  }

  private calculateAccountTakeoverScore(
    features: Record<string, unknown>,
    context?: FraudContext
  ): number {
    let score = 0;

    // New device for established account
    const totalTrips = Number(features.user_total_trips || 0);
    if (context?.isNewDevice && totalTrips > 10) {
      score += 0.3;
    }

    // Unusual location
    // In production, compare to user's typical locations

    // Unusual time
    // In production, compare to user's typical activity times

    // Session duration anomaly
    if (context?.sessionDuration !== undefined) {
      if (context.sessionDuration < 10) {
        // Less than 10 seconds
        score += 0.2;
      }
    }

    // IP reputation
    if (context?.ipAddress && this.knownFraudIPs.has(context.ipAddress)) {
      score += 0.5;
    }

    return Math.min(1, score);
  }

  private calculatePromoAbuseScore(features: Record<string, unknown>): number {
    let score = 0;

    // New user with many promo uses
    const totalTrips = Number(features.user_total_trips || 0);
    const promoUses = Number(features.promo_uses_30d || 0);

    if (totalTrips < 5 && promoUses > 3) {
      score += 0.4;
    }

    // High promo to regular ratio
    if (totalTrips > 0) {
      const promoRatio = promoUses / totalTrips;
      if (promoRatio > 0.8) {
        score += 0.3;
      }
    }

    // Similar accounts (would use graph analysis)
    const similarAccounts = Number(features.similar_account_count || 0);
    if (similarAccounts > 2) {
      score += 0.4;
    }

    return Math.min(1, score);
  }

  private calculateFakeTripScore(features: Record<string, unknown>): number {
    let score = 0;

    // Very short trips
    const avgTripDistance = Number(features.avg_trip_distance || 5);
    if (avgTripDistance < 0.5) {
      // Less than 500m average
      score += 0.3;
    }

    // Same pickup/dropoff
    const sameLocationRate = Number(features.same_location_trip_rate || 0);
    if (sameLocationRate > 0.3) {
      score += 0.4;
    }

    // Suspicious driver-rider pairs
    const repeatedPairCount = Number(features.repeated_driver_pairs || 0);
    if (repeatedPairCount > 5) {
      score += 0.4;
    }

    return Math.min(1, score);
  }

  private calculateGPSSpoofingScore(
    features: Record<string, unknown>,
    context?: FraudContext
  ): number {
    let score = 0;

    // Location jump detection
    const locationJumps = Number(features.location_jump_count || 0);
    if (locationJumps > 3) {
      score += 0.5;
    }

    // Mock location detection
    const mockLocationDetected = features.mock_location_detected as boolean;
    if (mockLocationDetected) {
      score += 0.8;
    }

    // Impossible speed
    const maxSpeed = Number(features.max_recorded_speed || 0);
    if (maxSpeed > 200) {
      // km/h
      score += 0.6;
    }

    // Location accuracy anomaly
    const avgLocationAccuracy = Number(features.avg_location_accuracy || 10);
    if (avgLocationAccuracy > 100) {
      // meters
      score += 0.2;
    }

    return Math.min(1, score);
  }

  private calculateRefundAbuseScore(features: Record<string, unknown>): number {
    let score = 0;

    // High refund rate
    const refundRate = Number(features.refund_rate_30d || 0);
    if (refundRate > 0.3) {
      score += 0.5;
    } else if (refundRate > 0.15) {
      score += 0.2;
    }

    // Pattern matching (same reason repeatedly)
    const sameReasonRefunds = Number(features.same_reason_refund_count || 0);
    if (sameReasonRefunds > 3) {
      score += 0.3;
    }

    // Claims right before subscription renewal
    const refundBeforeRenewal = features.refund_before_renewal as boolean;
    if (refundBeforeRenewal) {
      score += 0.2;
    }

    return Math.min(1, score);
  }

  // ===========================================================================
  // SCORE AGGREGATION
  // ===========================================================================

  private aggregateFraudScores(
    fraudTypeScores: FraudTypeScore[],
    features: Record<string, unknown>,
    context?: FraudContext
  ): { score: number; topFactors: FraudFactor[] } {
    // Weight each fraud type
    const weights: Record<FraudType, number> = {
      [FraudType.PAYMENT_FRAUD]: 1.0,
      [FraudType.ACCOUNT_TAKEOVER]: 0.9,
      [FraudType.COLLUSION]: 0.85,
      [FraudType.PROMO_ABUSE]: 0.6,
      [FraudType.FAKE_TRIP]: 0.8,
      [FraudType.GPS_SPOOFING]: 0.7,
      [FraudType.REFUND_ABUSE]: 0.65,
      [FraudType.IDENTITY_FRAUD]: 0.9,
    };

    // Calculate weighted average
    let totalWeight = 0;
    let weightedSum = 0;

    for (const fraudType of fraudTypeScores) {
      const weight = weights[fraudType.type] || 0.5;
      weightedSum += fraudType.score * weight;
      totalWeight += weight;
    }

    const aggregateScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

    // Apply rule-based adjustments
    let finalScore = aggregateScore;
    for (const rule of this.fraudRules) {
      if (rule.condition(features, context)) {
        finalScore = Math.max(finalScore, rule.score);
      }
    }

    // Cap at 1.0
    finalScore = Math.min(1, finalScore);

    // Extract top factors
    const topFactors = this.extractTopFactors(
      fraudTypeScores,
      features,
      context
    );

    return { score: finalScore, topFactors };
  }

  private extractTopFactors(
    fraudTypeScores: FraudTypeScore[],
    features: Record<string, unknown>,
    context?: FraudContext
  ): FraudFactor[] {
    const factors: FraudFactor[] = [];

    // Add high-risk fraud types
    for (const fraudType of fraudTypeScores) {
      if (fraudType.isHighRisk) {
        factors.push({
          name: this.fraudTypeToString(fraudType.type),
          contribution: fraudType.score,
          value: fraudType.score,
          direction: "increases_risk",
        });
      }
    }

    // Add specific feature factors
    const paymentMethodAge = Number(features.payment_method_age_days || 365);
    if (paymentMethodAge < 7) {
      factors.push({
        name: "New payment method",
        contribution: 0.3,
        value: paymentMethodAge,
        threshold: 7,
        direction: "increases_risk",
      });
    }

    const velocity = Number(features.payment_velocity_24h || 0);
    if (velocity > 5) {
      factors.push({
        name: "High payment velocity",
        contribution: 0.25,
        value: velocity,
        threshold: 5,
        direction: "increases_risk",
      });
    }

    if (context?.isNewDevice) {
      factors.push({
        name: "New device",
        contribution: 0.2,
        value: true,
        direction: "increases_risk",
      });
    }

    // Sort by contribution and take top 5
    return factors.sort((a, b) => b.contribution - a.contribution).slice(0, 5);
  }

  private fraudTypeToString(type: FraudType): string {
    const names: Record<FraudType, string> = {
      [FraudType.PAYMENT_FRAUD]: "Payment fraud indicators",
      [FraudType.ACCOUNT_TAKEOVER]: "Account takeover risk",
      [FraudType.PROMO_ABUSE]: "Promotional abuse",
      [FraudType.COLLUSION]: "Collusion detected",
      [FraudType.FAKE_TRIP]: "Fake trip pattern",
      [FraudType.IDENTITY_FRAUD]: "Identity verification issues",
      [FraudType.REFUND_ABUSE]: "Refund abuse pattern",
      [FraudType.GPS_SPOOFING]: "GPS spoofing detected",
    };
    return names[type] || "Unknown risk";
  }

  // ===========================================================================
  // RISK LEVEL & RECOMMENDATION
  // ===========================================================================

  private determineRiskLevel(score: number): FraudRiskLevel {
    if (score >= this.BLOCK_THRESHOLD) return FraudRiskLevel.CRITICAL;
    if (score >= this.HIGH_RISK_THRESHOLD) return FraudRiskLevel.HIGH;
    if (score >= this.REVIEW_THRESHOLD) return FraudRiskLevel.MEDIUM;
    return FraudRiskLevel.LOW;
  }

  private determineRecommendation(
    score: number,
    fraudTypeScores: FraudTypeScore[]
  ): "approve" | "review" | "block" {
    // Auto-block if score exceeds threshold
    if (score >= this.BLOCK_THRESHOLD) {
      return "block";
    }

    // Block if any fraud type is critical
    const hasCriticalType = fraudTypeScores.some(
      (ft) => ft.isHighRisk && ft.score > 0.9
    );
    if (hasCriticalType) {
      return "block";
    }

    // Review if above review threshold
    if (score >= this.REVIEW_THRESHOLD) {
      return "review";
    }

    return "approve";
  }

  // ===========================================================================
  // COLLUSION DETECTION
  // ===========================================================================

  async detectCollusion(
    request: CollusionDetectionRequest
  ): Promise<CollusionNetwork[]> {
    const networks: CollusionNetwork[] = [];
    const lookbackDays = request.lookbackDays || 30;

    // Build connection graph based on trip patterns
    const connections = await this.buildConnectionGraph(
      request.driverId,
      request.userId,
      request.tripId,
      lookbackDays
    );

    // Detect suspicious clusters
    const clusters = this.detectSuspiciousClusters(connections);

    for (const cluster of clusters) {
      // Score the cluster
      const riskScore = this.scoreCollusionCluster(cluster);

      if (riskScore > 0.5) {
        const network: CollusionNetwork = {
          id: this.generateId(),
          members: cluster.members,
          patternType: cluster.type,
          connectionCount: cluster.connectionCount,
          totalTrips: cluster.totalTrips,
          totalAmount: cluster.totalAmount,
          riskScore,
          patterns: cluster.patterns,
          status: riskScore > 0.8 ? "confirmed" : "detected",
          detectedAt: new Date(),
        };

        networks.push(network);

        // Emit alert for high-risk networks
        if (riskScore > 0.7) {
          this.eventEmitter.emit("fraud:collusion_detected", network);
        }
      }
    }

    return networks;
  }

  private async buildConnectionGraph(
    driverId?: string,
    userId?: string,
    tripId?: string,
    lookbackDays: number = 30
  ): Promise<Map<string, Set<string>>> {
    // In production, query trip history and build driver-rider graph
    // For now, return empty graph
    const graph = new Map<string, Set<string>>();

    // Would query:
    // - All trips involving driver/user in lookback period
    // - Group by driver-rider pairs
    // - Calculate frequency, amount, patterns

    return graph;
  }

  private detectSuspiciousClusters(
    connections: Map<string, Set<string>>
  ): Array<{
    members: CollusionMember[];
    type: "ring" | "pair" | "cluster";
    connectionCount: number;
    totalTrips: number;
    totalAmount: number;
    patterns: CollusionPattern[];
  }> {
    const clusters: Array<{
      members: CollusionMember[];
      type: "ring" | "pair" | "cluster";
      connectionCount: number;
      totalTrips: number;
      totalAmount: number;
      patterns: CollusionPattern[];
    }> = [];

    // In production, use graph algorithms:
    // - Community detection
    // - Cycle detection (rings)
    // - Dense subgraph detection

    return clusters;
  }

  private scoreCollusionCluster(cluster: {
    members: CollusionMember[];
    type: "ring" | "pair" | "cluster";
    connectionCount: number;
    totalTrips: number;
    totalAmount: number;
    patterns: CollusionPattern[];
  }): number {
    let score = 0;

    // Member count factor
    if (cluster.members.length >= 3) {
      score += 0.2;
    }

    // Trip frequency factor
    const tripsPerMember = cluster.totalTrips / cluster.members.length;
    if (tripsPerMember > 10) {
      score += 0.3;
    }

    // Pattern severity
    for (const pattern of cluster.patterns) {
      score += pattern.confidence * 0.2;
    }

    // Ring type is more suspicious
    if (cluster.type === "ring") {
      score += 0.2;
    }

    return Math.min(1, score);
  }

  // ===========================================================================
  // FRAUD REPORTING
  // ===========================================================================

  async reportFraud(
    entityType: string,
    entityId: string,
    fraudType: FraudType
  ): Promise<void> {
    this.eventEmitter.emit("fraud:reported", {
      entityType,
      entityId,
      fraudType,
      reportedAt: new Date(),
    });

    // Update fraud score with confirmed fraud
    await this.featureStore.setFeatureValue(
      `${entityType}_fraud_score`,
      entityId,
      1.0 // Max fraud score for confirmed fraud
    );
  }

  async updateInvestigation(
    investigationId: string,
    status: string,
    findings?: Record<string, unknown>
  ): Promise<void> {
    this.eventEmitter.emit("investigation:updated", {
      investigationId,
      status,
      findings,
      updatedAt: new Date(),
    });
  }

  // ===========================================================================
  // RULE INITIALIZATION
  // ===========================================================================

  private initializeFraudRules(): void {
    this.fraudRules = [
      {
        id: "rule_known_fraud_device",
        name: "Known Fraud Device",
        type: FraudType.PAYMENT_FRAUD,
        condition: (features, context) =>
          Boolean(
            context?.deviceId && this.knownFraudDevices.has(context.deviceId)
          ),
        score: 0.95,
        weight: 1.0,
        autoBlock: true,
      },
      {
        id: "rule_known_fraud_ip",
        name: "Known Fraud IP",
        type: FraudType.PAYMENT_FRAUD,
        condition: (features, context) =>
          Boolean(
            context?.ipAddress && this.knownFraudIPs.has(context.ipAddress)
          ),
        score: 0.9,
        weight: 0.9,
        autoBlock: true,
      },
      {
        id: "rule_velocity_spike",
        name: "Velocity Spike",
        type: FraudType.PAYMENT_FRAUD,
        condition: (features) =>
          Number(features.payment_velocity_24h || 0) > 20,
        score: 0.8,
        weight: 0.8,
        autoBlock: false,
      },
      {
        id: "rule_mock_location",
        name: "Mock Location Detected",
        type: FraudType.GPS_SPOOFING,
        condition: (features) => Boolean(features.mock_location_detected),
        score: 0.85,
        weight: 0.85,
        autoBlock: true,
      },
      {
        id: "rule_new_user_high_value",
        name: "New User High Value Transaction",
        type: FraudType.PAYMENT_FRAUD,
        condition: (features, context) => {
          const trips = Number(features.user_total_trips || 0);
          const amount = Number(features.transaction_amount || 0);
          return trips < 3 && amount > 20000; // > 20k NGN for new user
        },
        score: 0.6,
        weight: 0.6,
        autoBlock: false,
      },
    ];
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private generateId(): string {
    return `fraud_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, listener);
  }

  off(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.off(event, listener);
  }

  // ===========================================================================
  // DEVICE/IP BLOCKLIST MANAGEMENT
  // ===========================================================================

  addFraudDevice(deviceId: string): void {
    this.knownFraudDevices.add(deviceId);
  }

  removeFraudDevice(deviceId: string): void {
    this.knownFraudDevices.delete(deviceId);
  }

  addFraudIP(ipAddress: string): void {
    this.knownFraudIPs.add(ipAddress);
  }

  removeFraudIP(ipAddress: string): void {
    this.knownFraudIPs.delete(ipAddress);
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default FraudDetectionService;
