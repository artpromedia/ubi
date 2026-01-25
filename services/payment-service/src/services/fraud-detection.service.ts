/**
 * Fraud Detection Service
 *
 * Real-time risk assessment and fraud prevention:
 * - Risk scoring (0-100 scale)
 * - Velocity checks (transactions per user/device/IP)
 * - Geographic anomaly detection
 * - Device fingerprinting
 * - Known fraud patterns
 * - Manual review queue
 *
 * Risk Levels:
 * - LOW (0-25): Auto-approve
 * - MEDIUM (26-50): Monitor, may require 3DS
 * - HIGH (51-75): Require 3DS + manual review
 * - CRITICAL (76-100): Block transaction
 *
 * Actions:
 * - ALLOW: Process normally
 * - REVIEW: Flag for manual review
 * - REQUIRE_3DS: Force 3D Secure authentication
 * - BLOCK: Reject transaction
 */

import { PrismaClient, RiskAction, RiskLevel } from "@prisma/client";

/**
 * Represents a single risk factor identified during fraud analysis
 */
export interface RiskFactor {
  name: string;
  score: number;
  weight: number;
  description: string;
}

/**
 * Result of a fraud check including risk level, score, factors, and recommended action
 */
export interface FraudCheckResult {
  assessmentId: string;
  riskScore: number;
  riskLevel: RiskLevel;
  action: RiskAction;
  factors: RiskFactor[];
  reasons: string[];
  requiresReview: boolean;
  requires3DS: boolean;
}

export interface RiskAssessmentRequest {
  userId: string;
  amount: number;
  currency: string;
  ipAddress?: string;
  deviceId?: string;
  userAgent?: string;
  location?: {
    latitude: number;
    longitude: number;
    country?: string;
    city?: string;
  };
  paymentMethod?: string;
  metadata?: Record<string, any>;
}

export interface RiskAssessmentResult {
  assessmentId: string;
  riskScore: number; // 0-100
  riskLevel: RiskLevel;
  action: RiskAction;
  reasons: string[];
  requiresReview: boolean;
  requires3DS: boolean;
  factors: Array<{
    name: string;
    score: number;
    description: string;
  }>;
}

export class FraudDetectionService {
  // Risk thresholds
  private readonly RISK_THRESHOLDS = {
    LOW: 25,
    MEDIUM: 50,
    HIGH: 75,
    CRITICAL: 100,
  };

  // Velocity limits
  private readonly VELOCITY_LIMITS = {
    transactionsPerHour: 10,
    transactionsPerDay: 50,
    amountPerHour: 50000, // Currency-agnostic (will normalize)
    amountPerDay: 200000,
  };

  // High-risk amount thresholds (normalized to USD equivalent)
  private readonly HIGH_AMOUNT_THRESHOLD = 1000; // $1000 USD

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Assess transaction risk
   */
  async assessRisk(
    request: RiskAssessmentRequest,
  ): Promise<RiskAssessmentResult> {
    const factors: Array<{ name: string; score: number; description: string }> =
      [];
    let totalScore = 0;

    // Factor 1: Velocity check (40% weight)
    const velocityScore = await this.checkVelocity(
      request.userId,
      request.amount,
    );
    factors.push({
      name: "velocity",
      score: velocityScore,
      description:
        velocityScore > 50
          ? "Unusual transaction frequency detected"
          : "Normal transaction frequency",
    });
    totalScore += velocityScore * 0.4;

    // Factor 2: Amount anomaly (25% weight)
    const amountScore = await this.checkAmountAnomaly(
      request.userId,
      request.amount,
    );
    factors.push({
      name: "amount",
      score: amountScore,
      description:
        amountScore > 50
          ? "Transaction amount significantly higher than usual"
          : "Normal transaction amount",
    });
    totalScore += amountScore * 0.25;

    // Factor 3: Geographic anomaly (15% weight)
    const geoScore = await this.checkGeographicAnomaly(
      request.userId,
      request.location,
    );
    factors.push({
      name: "geography",
      score: geoScore,
      description:
        geoScore > 50
          ? "Transaction from unusual location"
          : "Transaction from known location",
    });
    totalScore += geoScore * 0.15;

    // Factor 4: Device/IP check (10% weight)
    const deviceScore = await this.checkDevice(
      request.userId,
      request.deviceId,
      request.ipAddress,
    );
    factors.push({
      name: "device",
      score: deviceScore,
      description:
        deviceScore > 50 ? "New or suspicious device detected" : "Known device",
    });
    totalScore += deviceScore * 0.1;

    // Factor 5: User history (10% weight)
    const historyScore = await this.checkUserHistory(request.userId);
    factors.push({
      name: "history",
      score: historyScore,
      description:
        historyScore > 50
          ? "User has previous fraud flags or disputes"
          : "User has clean history",
    });
    totalScore += historyScore * 0.1;

    // Round to integer
    const riskScore = Math.round(totalScore);

    // Determine risk level
    let riskLevel: RiskLevel;
    if (riskScore <= this.RISK_THRESHOLDS.LOW) {
      riskLevel = RiskLevel.LOW;
    } else if (riskScore <= this.RISK_THRESHOLDS.MEDIUM) {
      riskLevel = RiskLevel.MEDIUM;
    } else if (riskScore <= this.RISK_THRESHOLDS.HIGH) {
      riskLevel = RiskLevel.HIGH;
    } else {
      riskLevel = RiskLevel.CRITICAL;
    }

    // Determine action
    let action: RiskAction;
    let requiresReview = false;
    let requires3DS = false;

    if (riskLevel === RiskLevel.LOW) {
      action = RiskAction.ALLOW;
    } else if (riskLevel === RiskLevel.MEDIUM) {
      action = RiskAction.ALLOW;
      requires3DS = request.paymentMethod === "card"; // Force 3DS for cards
    } else if (riskLevel === RiskLevel.HIGH) {
      action = RiskAction.REVIEW;
      requiresReview = true;
      requires3DS = true;
    } else {
      action = RiskAction.BLOCK;
      requiresReview = true;
    }

    // Generate reasons
    const reasons = this.generateReasons(factors, riskLevel);

    // Save risk assessment
    const assessment = await this.prisma.riskAssessment.create({
      data: {
        userId: request.userId,
        riskScore,
        riskLevel,
        action,
        metadata: {
          factors,
          request,
        },
      },
    });

    // Save individual risk factors
    for (const factor of factors) {
      await this.prisma.riskFactor.create({
        data: {
          assessmentId: assessment.id,
          factorType: factor.name,
          score: factor.score,
          description: factor.description,
        },
      });
    }

    return {
      assessmentId: assessment.id,
      riskScore,
      riskLevel,
      action,
      reasons,
      requiresReview,
      requires3DS,
      factors,
    };
  }

  /**
   * Check velocity (transaction frequency)
   */
  private async checkVelocity(
    userId: string,
    _amount: number,
  ): Promise<number> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Count transactions in last hour
    const hourCount = await this.prisma.paymentTransaction.count({
      where: {
        userId,
        createdAt: { gte: oneHourAgo },
        status: { in: ["PENDING", "COMPLETED"] },
      },
    });

    // Count transactions in last day
    const dayCount = await this.prisma.paymentTransaction.count({
      where: {
        userId,
        createdAt: { gte: oneDayAgo },
        status: { in: ["PENDING", "COMPLETED"] },
      },
    });

    // Sum amounts in last hour
    const hourSum = await this.prisma.paymentTransaction.aggregate({
      where: {
        userId,
        createdAt: { gte: oneHourAgo },
        status: { in: ["PENDING", "COMPLETED"] },
      },
      _sum: { amount: true },
    });

    // Sum amounts in last day
    const daySum = await this.prisma.paymentTransaction.aggregate({
      where: {
        userId,
        createdAt: { gte: oneDayAgo },
        status: { in: ["PENDING", "COMPLETED"] },
      },
      _sum: { amount: true },
    });

    const hourAmount = Number(hourSum._sum.amount || 0);
    const dayAmount = Number(daySum._sum.amount || 0);

    // Calculate velocity score (0-100)
    let score = 0;

    // Frequency score
    const hourFreqScore = Math.min(
      (hourCount / this.VELOCITY_LIMITS.transactionsPerHour) * 100,
      100,
    );
    const dayFreqScore = Math.min(
      (dayCount / this.VELOCITY_LIMITS.transactionsPerDay) * 100,
      100,
    );
    score += Math.max(hourFreqScore, dayFreqScore) * 0.5;

    // Amount score
    const hourAmountScore = Math.min(
      (hourAmount / this.VELOCITY_LIMITS.amountPerHour) * 100,
      100,
    );
    const dayAmountScore = Math.min(
      (dayAmount / this.VELOCITY_LIMITS.amountPerDay) * 100,
      100,
    );
    score += Math.max(hourAmountScore, dayAmountScore) * 0.5;

    return Math.round(score);
  }

  /**
   * Check if transaction amount is anomalous
   */
  private async checkAmountAnomaly(
    userId: string,
    amount: number,
  ): Promise<number> {
    // Get user's average transaction amount
    const stats = await this.prisma.paymentTransaction.aggregate({
      where: {
        userId,
        status: "COMPLETED",
      },
      _avg: { amount: true },
      _max: { amount: true },
      _count: true,
    });

    const avgAmount = Number(stats._avg.amount || 0);
    const maxAmount = Number(stats._max.amount || 0);
    const count = stats._count;

    // New user (no history)
    if (count === 0) {
      // High amount for new user is risky
      if (amount > this.HIGH_AMOUNT_THRESHOLD) {
        return 75; // High risk
      }
      return 30; // Medium risk for new users
    }

    // Calculate deviation from average
    if (avgAmount > 0) {
      const deviation = (amount - avgAmount) / avgAmount;

      // Transaction is 3x or more of average
      if (deviation >= 2) {
        return 80;
      }
      // Transaction is 2x average
      if (deviation >= 1) {
        return 60;
      }
      // Transaction is 1.5x average
      if (deviation >= 0.5) {
        return 40;
      }
    }

    // Transaction exceeds previous max
    if (amount > maxAmount * 1.5) {
      return 70;
    }

    return 10; // Normal
  }

  /**
   * Check geographic anomaly
   */
  private async checkGeographicAnomaly(
    userId: string,
    location?: { latitude: number; longitude: number; country?: string },
  ): Promise<number> {
    if (!location) {
      return 0; // No location data, can't assess
    }

    // Get user's previous transaction locations
    const recentTransactions = await this.prisma.paymentTransaction.findMany({
      where: {
        userId,
        status: "COMPLETED",
        metadata: {
          path: ["location"],
          not: null,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    if (recentTransactions.length === 0) {
      return 20; // New user, slight risk
    }

    // Check if location is significantly different from previous transactions
    let differentCountry = false;
    let maxDistance = 0;

    for (const tx of recentTransactions) {
      const txMetadata = tx.metadata;
      const txLocation = (txMetadata as Record<string, unknown>)?.location as
        | { country?: string; lat?: number; lng?: number }
        | undefined;

      if (txLocation) {
        // Check country
        if (
          location.country &&
          txLocation.country &&
          location.country !== txLocation.country
        ) {
          differentCountry = true;
        }

        // Calculate distance (Haversine formula - simplified)
        const distance = this.calculateDistance(
          location.latitude,
          location.longitude,
          txLocation.latitude,
          txLocation.longitude,
        );

        maxDistance = Math.max(maxDistance, distance);
      }
    }

    // Different country from usual
    if (differentCountry) {
      return 70;
    }

    // Very far from usual locations (>1000km)
    if (maxDistance > 1000) {
      return 60;
    }

    // Moderately far (>100km)
    if (maxDistance > 100) {
      return 30;
    }

    return 10; // Normal location
  }

  /**
   * Check device/IP
   */
  private async checkDevice(
    userId: string,
    deviceId?: string,
    ipAddress?: string,
  ): Promise<number> {
    if (!deviceId && !ipAddress) {
      return 30; // No device data is suspicious
    }

    // Check if device/IP has been used before by this user
    const previousTransactions = await this.prisma.paymentTransaction.findMany({
      where: {
        userId,
        status: { in: ["COMPLETED", "PENDING"] },
        OR: [
          deviceId
            ? { metadata: { path: ["deviceId"], equals: deviceId } }
            : {},
          ipAddress
            ? { metadata: { path: ["ipAddress"], equals: ipAddress } }
            : {},
        ],
      },
      take: 1,
    });

    if (previousTransactions.length === 0) {
      return 50; // New device/IP
    }

    // Check if device/IP is blacklisted (used in fraud)
    const blacklisted = await this.prisma.riskAssessment.findFirst({
      where: {
        action: RiskAction.BLOCK,
        metadata: {
          path: ["request", deviceId ? "deviceId" : "ipAddress"],
          equals: deviceId || ipAddress,
        },
      },
    });

    if (blacklisted) {
      return 100; // Device/IP used in fraud
    }

    return 10; // Known device/IP
  }

  /**
   * Check user history
   */
  private async checkUserHistory(userId: string): Promise<number> {
    // Check for previous fraud assessments
    const fraudAssessments = await this.prisma.riskAssessment.count({
      where: {
        userId,
        riskLevel: { in: [RiskLevel.HIGH, RiskLevel.CRITICAL] },
      },
    });

    if (fraudAssessments > 0) {
      return Math.min(fraudAssessments * 25, 100);
    }

    // Check for disputes
    const disputes = await this.prisma.dispute.count({
      where: {
        transaction: {
          userId,
        },
        status: { not: "WON" },
      },
    });

    if (disputes > 0) {
      return Math.min(disputes * 30, 100);
    }

    // Check account age
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (user) {
      const accountAge = Date.now() - user.createdAt.getTime();
      const daysOld = accountAge / (1000 * 60 * 60 * 24);

      // Very new account (<1 day)
      if (daysOld < 1) {
        return 40;
      }

      // New account (<7 days)
      if (daysOld < 7) {
        return 20;
      }
    }

    return 5; // Clean history
  }

  /**
   * Calculate distance between two coordinates (km)
   * Haversine formula
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Generate human-readable reasons for risk score
   */
  private generateReasons(
    factors: Array<{ name: string; score: number; description: string }>,
    riskLevel: RiskLevel,
  ): string[] {
    const reasons: string[] = [];

    // Add high-scoring factors as reasons
    const highRiskFactors = factors.filter((f) => f.score > 50);
    for (const factor of highRiskFactors) {
      reasons.push(factor.description);
    }

    // Add risk level context
    if (riskLevel === RiskLevel.CRITICAL) {
      reasons.push(
        "Transaction flagged as high risk - requires immediate review",
      );
    } else if (riskLevel === RiskLevel.HIGH) {
      reasons.push("Transaction requires manual review before processing");
    } else if (riskLevel === RiskLevel.MEDIUM) {
      reasons.push("Transaction flagged for monitoring");
    }

    return reasons.length > 0
      ? reasons
      : ["No specific risk factors identified"];
  }

  /**
   * Get pending review queue
   */
  async getPendingReviews(
    options: {
      limit?: number;
      offset?: number;
      minRiskScore?: number;
    } = {},
  ): Promise<Array<any>> {
    const { limit = 20, offset = 0, minRiskScore = 50 } = options;

    const assessments = await this.prisma.riskAssessment.findMany({
      where: {
        action: { in: [RiskAction.REVIEW, RiskAction.BLOCK] },
        riskScore: { gte: minRiskScore },
        reviewedAt: null, // Not yet reviewed
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
          },
        },
        factors: true,
      },
      orderBy: { riskScore: "desc" },
      take: limit,
      skip: offset,
    });

    return assessments.map((assessment) => ({
      id: assessment.id,
      userId: assessment.userId,
      user: assessment.user,
      riskScore: assessment.riskScore,
      riskLevel: assessment.riskLevel,
      action: assessment.action,
      factors: assessment.factors,
      createdAt: assessment.createdAt,
      metadata: assessment.metadata,
    }));
  }

  /**
   * Approve transaction after manual review
   */
  async approveTransaction(
    assessmentId: string,
    reviewedBy: string,
  ): Promise<void> {
    await this.prisma.riskAssessment.update({
      where: { id: assessmentId },
      data: {
        action: RiskAction.ALLOW,
        reviewedAt: new Date(),
        metadata: {
          reviewedBy,
          reviewNote: "Manually approved",
        },
      },
    });
  }

  /**
   * Reject transaction after manual review
   */
  async rejectTransaction(
    assessmentId: string,
    reviewedBy: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.riskAssessment.update({
      where: { id: assessmentId },
      data: {
        action: RiskAction.BLOCK,
        reviewedAt: new Date(),
        metadata: {
          reviewedBy,
          reviewNote: reason,
        },
      },
    });
  }
}

// Singleton instance
let fraudDetectionServiceInstance: FraudDetectionService | null = null;

// Create new instance
export function createFraudDetectionService(
  prisma: PrismaClient,
): FraudDetectionService {
  return new FraudDetectionService(prisma);
}

// Get singleton instance
export function getFraudDetectionService(
  prisma: PrismaClient,
): FraudDetectionService {
  fraudDetectionServiceInstance ??= createFraudDetectionService(prisma);
  return fraudDetectionServiceInstance;
}
