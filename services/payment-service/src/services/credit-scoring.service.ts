/**
 * Credit Scoring Engine
 * Alternative credit scoring using UBI platform data
 */

import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import type { CreditFactor, CreditScoreResult } from "../types/fintech.types";

// ===========================================
// CREDIT SCORE RANGES
// ===========================================

const SCORE_RANGES = {
  EXCELLENT: { min: 750, max: 850, label: "Excellent" },
  GOOD: { min: 670, max: 749, label: "Good" },
  FAIR: { min: 580, max: 669, label: "Fair" },
  POOR: { min: 300, max: 579, label: "Poor" },
};

// Factor weights (must sum to 100)
const FACTOR_WEIGHTS = {
  WALLET_ACTIVITY: 20, // Regular wallet usage
  PAYMENT_HISTORY: 25, // On-time payments (rides, bills)
  SAVINGS_BEHAVIOR: 15, // Savings habits
  INCOME_STABILITY: 20, // Regular income/deposits
  ACCOUNT_AGE: 10, // How long on platform
  KYC_LEVEL: 10, // Identity verification level
};

const CACHE_TTL = 3600; // 1 hour

// ===========================================
// CREDIT SCORING SERVICE
// ===========================================

export class CreditScoringService {
  /**
   * Calculate credit score for a user
   */
  async calculateScore(userId: string): Promise<CreditScoreResult> {
    // Check cache
    const cacheKey = `credit_score:${userId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Get user data
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallet: {
          include: {
            balances: true,
          },
        },
        rider: true,
        driver: true,
      },
    });

    if (!user) {
      throw new Error("User not found");
    }

    // Calculate each factor
    const factors: CreditFactor[] = [];

    // 1. Wallet Activity Score
    const walletActivityScore = await this.calculateWalletActivityScore(userId);
    factors.push({
      name: "Wallet Activity",
      score: walletActivityScore.score,
      weight: FACTOR_WEIGHTS.WALLET_ACTIVITY,
      impact: this.getImpactLevel(walletActivityScore.score),
      description: walletActivityScore.description,
    });

    // 2. Payment History Score
    const paymentHistoryScore = await this.calculatePaymentHistoryScore(userId);
    factors.push({
      name: "Payment History",
      score: paymentHistoryScore.score,
      weight: FACTOR_WEIGHTS.PAYMENT_HISTORY,
      impact: this.getImpactLevel(paymentHistoryScore.score),
      description: paymentHistoryScore.description,
    });

    // 3. Savings Behavior Score
    const savingsScore = await this.calculateSavingsScore(userId);
    factors.push({
      name: "Savings Behavior",
      score: savingsScore.score,
      weight: FACTOR_WEIGHTS.SAVINGS_BEHAVIOR,
      impact: this.getImpactLevel(savingsScore.score),
      description: savingsScore.description,
    });

    // 4. Income Stability Score
    const incomeScore = await this.calculateIncomeStabilityScore(userId);
    factors.push({
      name: "Income Stability",
      score: incomeScore.score,
      weight: FACTOR_WEIGHTS.INCOME_STABILITY,
      impact: this.getImpactLevel(incomeScore.score),
      description: incomeScore.description,
    });

    // 5. Account Age Score
    const accountAgeScore = this.calculateAccountAgeScore(user.createdAt);
    factors.push({
      name: "Account Age",
      score: accountAgeScore.score,
      weight: FACTOR_WEIGHTS.ACCOUNT_AGE,
      impact: this.getImpactLevel(accountAgeScore.score),
      description: accountAgeScore.description,
    });

    // 6. KYC Level Score
    const kycScore = this.calculateKYCScore(user.wallet?.kycLevel || "NONE");
    factors.push({
      name: "Identity Verification",
      score: kycScore.score,
      weight: FACTOR_WEIGHTS.KYC_LEVEL,
      impact: this.getImpactLevel(kycScore.score),
      description: kycScore.description,
    });

    // Calculate weighted total score
    let totalScore = 0;
    for (const factor of factors) {
      totalScore += (factor.score * factor.weight) / 100;
    }

    // Normalize to 300-850 range
    const normalizedScore = Math.round(300 + (totalScore / 100) * 550);
    const finalScore = Math.max(300, Math.min(850, normalizedScore));

    // Determine category
    let category: "EXCELLENT" | "GOOD" | "FAIR" | "POOR";
    if (finalScore >= SCORE_RANGES.EXCELLENT.min) {
      category = "EXCELLENT";
    } else if (finalScore >= SCORE_RANGES.GOOD.min) {
      category = "GOOD";
    } else if (finalScore >= SCORE_RANGES.FAIR.min) {
      category = "FAIR";
    } else {
      category = "POOR";
    }

    // Get previous score for trend
    const previousScore = await this.getPreviousScore(userId);
    const trend = previousScore
      ? finalScore > previousScore.score
        ? "UP"
        : finalScore < previousScore.score
          ? "DOWN"
          : "STABLE"
      : "NEW";

    const result: CreditScoreResult = {
      userId,
      score: finalScore,
      category,
      categoryLabel: SCORE_RANGES[category].label,
      factors,
      trend,
      previousScore: previousScore?.score,
      calculatedAt: new Date(),
      validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000), // Valid for 24 hours
    };

    // Save score
    await this.saveScore(userId, result);

    // Cache result
    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result));

    return result;
  }

  /**
   * Get current credit score
   */
  async getScore(userId: string): Promise<CreditScoreResult | null> {
    const score = await prisma.creditScore.findFirst({
      where: { userId },
      orderBy: { calculatedAt: "desc" },
    });

    if (!score) {
      return null;
    }

    return {
      userId: score.userId,
      score: score.score,
      category: score.category as "EXCELLENT" | "GOOD" | "FAIR" | "POOR",
      categoryLabel:
        SCORE_RANGES[score.category as keyof typeof SCORE_RANGES].label,
      factors: score.factors as CreditFactor[],
      trend: score.trend as "UP" | "DOWN" | "STABLE" | "NEW",
      previousScore: score.previousScore || undefined,
      calculatedAt: score.calculatedAt,
      validUntil: score.validUntil,
    };
  }

  /**
   * Get score history
   */
  async getScoreHistory(
    userId: string,
    limit: number = 12
  ): Promise<Array<{ score: number; calculatedAt: Date }>> {
    const scores = await prisma.creditScore.findMany({
      where: { userId },
      orderBy: { calculatedAt: "desc" },
      take: limit,
      select: {
        score: true,
        calculatedAt: true,
      },
    });

    return scores;
  }

  /**
   * Check loan eligibility based on score
   */
  async checkLoanEligibility(userId: string): Promise<{
    eligible: boolean;
    score: number;
    maxLoanAmount: number;
    maxTenureMonths: number;
    interestRate: number;
    reasons: string[];
  }> {
    const scoreResult = await this.calculateScore(userId);
    const score = scoreResult.score;

    const reasons: string[] = [];
    let eligible = true;
    let maxLoanAmount = 0;
    let maxTenureMonths = 0;
    let interestRate = 0;

    // Minimum score requirement
    if (score < SCORE_RANGES.FAIR.min) {
      eligible = false;
      reasons.push(
        `Credit score (${score}) below minimum requirement (${SCORE_RANGES.FAIR.min})`
      );
    }

    // Check KYC level
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: true },
    });

    if (
      !user?.wallet ||
      user.wallet.kycLevel === "NONE" ||
      user.wallet.kycLevel === "BASIC"
    ) {
      eligible = false;
      reasons.push("Complete identity verification (KYC) to access loans");
    }

    // Check account age
    const accountAgeMonths = this.getAccountAgeInMonths(
      user?.createdAt || new Date()
    );
    if (accountAgeMonths < 3) {
      eligible = false;
      reasons.push("Account must be at least 3 months old");
    }

    if (eligible) {
      // Calculate loan parameters based on score
      if (score >= SCORE_RANGES.EXCELLENT.min) {
        maxLoanAmount = 500000;
        maxTenureMonths = 12;
        interestRate = 0.15; // 15% APR
      } else if (score >= SCORE_RANGES.GOOD.min) {
        maxLoanAmount = 200000;
        maxTenureMonths = 6;
        interestRate = 0.2; // 20% APR
      } else if (score >= SCORE_RANGES.FAIR.min) {
        maxLoanAmount = 50000;
        maxTenureMonths = 3;
        interestRate = 0.25; // 25% APR
      }

      reasons.push(
        `Your score of ${score} qualifies for loans up to ${maxLoanAmount}`
      );
    }

    return {
      eligible,
      score,
      maxLoanAmount,
      maxTenureMonths,
      interestRate,
      reasons,
    };
  }

  /**
   * Get tips to improve score
   */
  async getImprovementTips(userId: string): Promise<string[]> {
    const scoreResult =
      (await this.getScore(userId)) || (await this.calculateScore(userId));
    const tips: string[] = [];

    // Sort factors by impact (lowest score first)
    const sortedFactors = [...scoreResult.factors].sort(
      (a, b) => a.score - b.score
    );

    for (const factor of sortedFactors.slice(0, 3)) {
      if (factor.name === "Wallet Activity" && factor.score < 70) {
        tips.push("Use your wallet more frequently for transactions");
        tips.push("Set up recurring bill payments through your wallet");
      }

      if (factor.name === "Payment History" && factor.score < 70) {
        tips.push("Always pay your bills and ride fares on time");
        tips.push("Avoid cancelling rides or orders after booking");
      }

      if (factor.name === "Savings Behavior" && factor.score < 70) {
        tips.push("Start a savings pocket and contribute regularly");
        tips.push("Enable auto-save or round-up savings");
      }

      if (factor.name === "Income Stability" && factor.score < 70) {
        tips.push("Maintain regular deposits into your wallet");
        tips.push("If you're a driver, maintain consistent earning activity");
      }

      if (factor.name === "Identity Verification" && factor.score < 100) {
        tips.push("Complete your KYC verification to improve your score");
      }
    }

    return [...new Set(tips)].slice(0, 5); // Return unique tips, max 5
  }

  // ===========================================
  // PRIVATE FACTOR CALCULATIONS
  // ===========================================

  private async calculateWalletActivityScore(
    userId: string
  ): Promise<{ score: number; description: string }> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Count transactions in last 30 days
    const transactionCount = await prisma.transaction.count({
      where: {
        userId,
        createdAt: { gte: thirtyDaysAgo },
      },
    });

    // Score based on transaction frequency
    let score: number;
    let description: string;

    if (transactionCount >= 30) {
      score = 100;
      description = "Very high wallet activity";
    } else if (transactionCount >= 20) {
      score = 85;
      description = "High wallet activity";
    } else if (transactionCount >= 10) {
      score = 70;
      description = "Moderate wallet activity";
    } else if (transactionCount >= 5) {
      score = 50;
      description = "Low wallet activity";
    } else {
      score = 30;
      description = "Very low wallet activity";
    }

    return { score, description };
  }

  private async calculatePaymentHistoryScore(
    userId: string
  ): Promise<{ score: number; description: string }> {
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

    // Get completed payments
    const payments = await prisma.paymentTransaction.findMany({
      where: {
        userId,
        createdAt: { gte: sixMonthsAgo },
      },
    });

    const totalPayments = payments.length;
    const completedPayments = payments.filter(
      (p) => p.status === "COMPLETED"
    ).length;
    const failedPayments = payments.filter((p) => p.status === "FAILED").length;

    if (totalPayments === 0) {
      return { score: 50, description: "No payment history" };
    }

    const successRate = completedPayments / totalPayments;
    const failureImpact = Math.min(failedPayments * 5, 30); // Max 30 point penalty

    let score = Math.round(successRate * 100 - failureImpact);
    score = Math.max(0, Math.min(100, score));

    let description: string;
    if (score >= 90) {
      description = "Excellent payment history";
    } else if (score >= 70) {
      description = "Good payment history";
    } else if (score >= 50) {
      description = "Fair payment history";
    } else {
      description = "Payment issues detected";
    }

    return { score, description };
  }

  private async calculateSavingsScore(
    userId: string
  ): Promise<{ score: number; description: string }> {
    const wallet = await prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      return { score: 0, description: "No wallet found" };
    }

    // Check savings pockets
    const pockets = await prisma.savingsPocket.findMany({
      where: { walletId: wallet.id, status: { not: "CLOSED" } },
    });

    const totalSavings = pockets.reduce(
      (sum, p) => sum + Number(p.currentBalance),
      0
    );
    const hasAutoSave = pockets.some((p) => p.autoSaveEnabled);
    const hasRoundUp = pockets.some((p) => p.roundUpEnabled);

    let score = 0;

    // Base score for having savings
    if (pockets.length > 0) score += 30;
    if (totalSavings >= 10000) score += 20;
    if (totalSavings >= 50000) score += 15;
    if (hasAutoSave) score += 20;
    if (hasRoundUp) score += 15;

    score = Math.min(100, score);

    let description: string;
    if (score >= 80) {
      description = "Excellent savings habits";
    } else if (score >= 50) {
      description = "Good savings habits";
    } else if (score > 0) {
      description = "Building savings habits";
    } else {
      description = "No savings activity";
    }

    return { score, description };
  }

  private async calculateIncomeStabilityScore(
    userId: string
  ): Promise<{ score: number; description: string }> {
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

    // Get wallet credits (income) by month
    const wallet = await prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      return { score: 0, description: "No wallet found" };
    }

    const credits = await prisma.walletTransaction.findMany({
      where: {
        walletId: wallet.id,
        type: "CREDIT",
        createdAt: { gte: sixMonthsAgo },
      },
    });

    // Group by month
    const monthlyIncome = new Map<string, number>();
    for (const credit of credits) {
      const monthKey = credit.createdAt.toISOString().slice(0, 7);
      const current = monthlyIncome.get(monthKey) || 0;
      monthlyIncome.set(monthKey, current + Number(credit.amount));
    }

    const monthCount = monthlyIncome.size;
    const incomes = Array.from(monthlyIncome.values());

    if (monthCount === 0) {
      return { score: 30, description: "No income data" };
    }

    const avgIncome = incomes.reduce((a, b) => a + b, 0) / incomes.length;
    const variance =
      incomes.reduce((sum, val) => sum + Math.pow(val - avgIncome, 2), 0) /
      incomes.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = avgIncome > 0 ? stdDev / avgIncome : 1;

    // Score based on consistency (lower CV is better)
    let score: number;
    if (coefficientOfVariation <= 0.2) {
      score = 100;
    } else if (coefficientOfVariation <= 0.4) {
      score = 80;
    } else if (coefficientOfVariation <= 0.6) {
      score = 60;
    } else {
      score = 40;
    }

    // Bonus for consistent monthly deposits
    if (monthCount >= 6) score = Math.min(100, score + 10);

    let description: string;
    if (score >= 80) {
      description = "Stable income pattern";
    } else if (score >= 60) {
      description = "Moderately stable income";
    } else {
      description = "Variable income pattern";
    }

    return { score, description };
  }

  private calculateAccountAgeScore(createdAt: Date): {
    score: number;
    description: string;
  } {
    const ageMonths = this.getAccountAgeInMonths(createdAt);

    let score: number;
    if (ageMonths >= 24) {
      score = 100;
    } else if (ageMonths >= 12) {
      score = 80;
    } else if (ageMonths >= 6) {
      score = 60;
    } else if (ageMonths >= 3) {
      score = 40;
    } else {
      score = 20;
    }

    const description =
      ageMonths >= 12
        ? `${Math.floor(ageMonths / 12)} year(s) on UBI`
        : `${ageMonths} month(s) on UBI`;

    return { score, description };
  }

  private calculateKYCScore(kycLevel: string): {
    score: number;
    description: string;
  } {
    const scores: Record<string, { score: number; description: string }> = {
      NONE: { score: 0, description: "No verification" },
      BASIC: { score: 40, description: "Basic verification" },
      STANDARD: { score: 70, description: "Standard verification" },
      ENHANCED: { score: 90, description: "Enhanced verification" },
      FULL: { score: 100, description: "Fully verified" },
    };

    return scores[kycLevel] || scores.NONE;
  }

  private getImpactLevel(score: number): "HIGH" | "MEDIUM" | "LOW" {
    if (score >= 70) return "HIGH";
    if (score >= 40) return "MEDIUM";
    return "LOW";
  }

  private getAccountAgeInMonths(createdAt: Date): number {
    const now = new Date();
    return Math.floor(
      (now.getTime() - createdAt.getTime()) / (30 * 24 * 60 * 60 * 1000)
    );
  }

  private async getPreviousScore(
    userId: string
  ): Promise<{ score: number } | null> {
    const previous = await prisma.creditScore.findFirst({
      where: { userId },
      orderBy: { calculatedAt: "desc" },
      skip: 1, // Skip the most recent
      select: { score: true },
    });

    return previous;
  }

  private async saveScore(
    userId: string,
    result: CreditScoreResult
  ): Promise<void> {
    await prisma.creditScore.create({
      data: {
        userId,
        score: result.score,
        category: result.category,
        factors: result.factors as unknown as Record<string, unknown>,
        trend: result.trend,
        previousScore: result.previousScore,
        calculatedAt: result.calculatedAt,
        validUntil: result.validUntil,
      },
    });
  }
}

// Export singleton instance
export const creditScoringService = new CreditScoringService();
