/**
 * Vehicle Financing Service
 * Vehicle marketplace and financing functionality with alternative credit scoring
 *
 * Features:
 * - Vehicle marketplace listings
 * - Financing eligibility check using UBI earnings history
 * - Financing application processing
 * - Payment schedule generation
 * - Auto-deduction from driver earnings
 * - Default handling and collections
 */

import { nanoid } from "nanoid";

import { vehicleFinancingLogger } from "../lib/logger";
import {
  notificationClient,
  NotificationPriority,
  NotificationType,
} from "../lib/notification-client";
import { prisma } from "../lib/prisma";
import { enhancedWalletService } from "./enhanced-wallet.service";

import type { Currency } from "@prisma/client";
import type {
  ApplicationDecision,
  AutoDeductResult,
  EligibilityCheckParams,
  EligibilityResult,
  FinancingApplication,
  FinancingApplicationParams,
  FinancingConfig,
  FinancingCreditFactors,
  FinancingCreditResult,
  FinancingDashboard,
  FinancingPayment,
  FinancingPaymentParams,
  FinancingPaymentResult,
  FinancingSummary,
  UpcomingPayment,
  VehicleFinancing,
  VehicleFinancingStatus,
  VehicleListingFilters,
  VehicleListingResult,
  VehicleMarketplaceListing,
} from "../types/vehicle-financing.types";

// ===========================================
// CONFIGURATION
// ===========================================

const FINANCING_CONFIG: FinancingConfig = {
  minDownPaymentPercentage: 10,
  maxFinancingTermMonths: 48,
  minCreditScore: 500,
  baseInterestRate: 0.15,
  lateFeePercentage: 0.05,
  gracePeriodDays: 7,
  defaultThresholdMissedPayments: 3,
  autoDeductMaxPercentage: 30,
};

// Interest rate adjustments based on credit grade
const INTEREST_RATE_BY_GRADE: Record<string, number> = {
  A: 0.12, // 12% for excellent
  B: 0.15, // 15% for good
  C: 0.18, // 18% for fair
  D: 0.22, // 22% for poor
  F: 0.25, // 25% for very poor (usually rejected)
};

// ===========================================
// VEHICLE FINANCING SERVICE
// ===========================================

export class VehicleFinancingService {
  // ===========================================
  // MARKETPLACE METHODS
  // ===========================================

  /**
   * Get vehicle marketplace listings with filters
   */
  async getListings(
    filters: VehicleListingFilters,
  ): Promise<VehicleListingResult> {
    const {
      make,
      model,
      yearMin,
      yearMax,
      priceMin,
      priceMax,
      vehicleType,
      condition,
      fuelType,
      transmission,
      financingAvailable,
      location,
      sortBy = "newest",
      limit = 20,
      offset = 0,
    } = filters;

    // Build where clause
    const where: any = {
      status: "AVAILABLE",
    };

    if (make) {
      where.make = { contains: make, mode: "insensitive" };
    }
    if (model) {
      where.model = { contains: model, mode: "insensitive" };
    }
    if (yearMin) {
      where.year = { ...where.year, gte: yearMin };
    }
    if (yearMax) {
      where.year = { ...where.year, lte: yearMax };
    }
    if (priceMin) {
      where.listPrice = { ...where.listPrice, gte: priceMin };
    }
    if (priceMax) {
      where.listPrice = { ...where.listPrice, lte: priceMax };
    }
    if (vehicleType) {
      where.vehicleType = vehicleType;
    }
    if (condition) {
      where.condition = condition;
    }
    if (fuelType) {
      where.fuelType = fuelType;
    }
    if (transmission) {
      where.transmission = transmission;
    }
    if (financingAvailable !== undefined) {
      where.financingAvailable = financingAvailable;
    }
    if (location) {
      where.location = { contains: location, mode: "insensitive" };
    }

    // Build orderBy
    let orderBy: any;
    switch (sortBy) {
      case "price_asc":
        orderBy = { listPrice: "asc" };
        break;
      case "price_desc":
        orderBy = { listPrice: "desc" };
        break;
      case "year_desc":
        orderBy = { year: "desc" };
        break;
      case "newest":
      default:
        orderBy = { createdAt: "desc" };
    }

    const [listings, total] = await Promise.all([
      prisma.vehicleMarketplaceListing.findMany({
        where,
        orderBy,
        skip: offset,
        take: limit,
      }),
      prisma.vehicleMarketplaceListing.count({ where }),
    ]);

    return {
      listings: listings.map((l) => this.mapListingToType(l)),
      total,
      pagination: {
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    };
  }

  /**
   * Get single listing by ID
   */
  async getListingById(id: string): Promise<VehicleMarketplaceListing | null> {
    const listing = await prisma.vehicleMarketplaceListing.findUnique({
      where: { id },
    });

    if (!listing) {
      return null;
    }

    // Increment view count
    await prisma.vehicleMarketplaceListing.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });

    return this.mapListingToType(listing);
  }

  /**
   * Get featured/recommended listings for a user
   */
  async getRecommendedListings(
    userId: string,
    limit: number = 10,
  ): Promise<VehicleMarketplaceListing[]> {
    // Get listings based on potential preferences
    const listings = await prisma.vehicleMarketplaceListing.findMany({
      where: {
        status: "AVAILABLE",
        financingAvailable: true,
      },
      orderBy: [{ viewCount: "desc" }, { createdAt: "desc" }],
      take: limit,
    });

    return listings.map((l) => this.mapListingToType(l));
  }

  // ===========================================
  // ELIGIBILITY & CREDIT METHODS
  // ===========================================

  /**
   * Check financing eligibility for a user
   */
  async checkEligibility(
    params: EligibilityCheckParams,
  ): Promise<EligibilityResult> {
    const { userId, vehicleListingId, requestedAmount, requestedTermMonths } =
      params;

    vehicleFinancingLogger.info(
      { userId, vehicleListingId, requestedAmount },
      "Checking financing eligibility",
    );

    // Get vehicle listing
    const listing = await prisma.vehicleMarketplaceListing.findUnique({
      where: { id: vehicleListingId },
    });

    if (!listing) {
      throw new Error("Vehicle listing not found");
    }

    if (!listing.financingAvailable) {
      throw new Error("Financing not available for this vehicle");
    }

    // Calculate credit score using UBI data
    const creditResult = await this.calculateFinancingCreditScore(userId);

    // Determine eligibility
    const eligible = creditResult.score >= FINANCING_CONFIG.minCreditScore;
    const maxEligibleAmount = creditResult.maxEligibleAmount;
    const maxTermMonths = Math.min(
      requestedTermMonths,
      FINANCING_CONFIG.maxFinancingTermMonths,
    );
    const interestRate = creditResult.suggestedInterestRate;

    // Calculate estimated monthly payment
    const monthlyPayment = this.calculateMonthlyPayment(
      Math.min(requestedAmount, maxEligibleAmount),
      interestRate,
      maxTermMonths,
    );

    // Build factors
    const factors = [
      {
        name: "UBI Earnings History",
        score: Math.round(
          creditResult.factors.ubiEarningsHistory.earningsStability,
        ),
        maxScore: 100,
        impact:
          creditResult.factors.ubiEarningsHistory.earningsStability > 70
            ? "POSITIVE"
            : "NEUTRAL",
        description: `Average monthly earnings: ${listing.currency} ${creditResult.factors.ubiEarningsHistory.avgMonthlyEarnings.toFixed(0)}`,
      },
      {
        name: "Platform History",
        score: Math.min(
          creditResult.factors.platformHistory.tenureMonths * 5,
          100,
        ),
        maxScore: 100,
        impact:
          creditResult.factors.platformHistory.tenureMonths > 6
            ? "POSITIVE"
            : "NEUTRAL",
        description: `${creditResult.factors.platformHistory.tenureMonths} months on platform`,
      },
      {
        name: "Payment History",
        score: Math.round(
          creditResult.factors.paymentHistory.onTimePaymentRate,
        ),
        maxScore: 100,
        impact:
          creditResult.factors.paymentHistory.onTimePaymentRate > 90
            ? "POSITIVE"
            : "NEGATIVE",
        description: `${creditResult.factors.paymentHistory.onTimePaymentRate.toFixed(0)}% on-time payments`,
      },
      {
        name: "Driver Rating",
        score: Math.round(creditResult.factors.platformHistory.rating * 20),
        maxScore: 100,
        impact:
          creditResult.factors.platformHistory.rating > 4.5
            ? "POSITIVE"
            : "NEUTRAL",
        description: `${creditResult.factors.platformHistory.rating.toFixed(1)} star rating`,
      },
    ] as any[];

    // Build requirements
    const requirements = [
      {
        requirement: "Minimum credit score of 500",
        met: creditResult.score >= 500,
        details: `Your score: ${creditResult.score}`,
      },
      {
        requirement: "At least 3 months on UBI platform",
        met: creditResult.factors.platformHistory.tenureMonths >= 3,
        details: `Your tenure: ${creditResult.factors.platformHistory.tenureMonths} months`,
      },
      {
        requirement: "Verified driver's license",
        met: creditResult.factors.documentVerification.driversLicense,
      },
      {
        requirement: "Minimum 10% down payment",
        met: true,
        details: `Required: ${listing.currency} ${(Number(listing.listPrice) * 0.1).toFixed(0)}`,
      },
    ];

    // Build recommendations
    const recommendations: string[] = [];
    if (creditResult.score < 600) {
      recommendations.push("Complete more trips to improve your credit score");
    }
    if (creditResult.factors.paymentHistory.latePayments > 0) {
      recommendations.push(
        "Pay all outstanding obligations on time to improve eligibility",
      );
    }
    if (!creditResult.factors.documentVerification.nationalId) {
      recommendations.push("Complete your KYC verification for better rates");
    }
    if (requestedAmount > maxEligibleAmount) {
      recommendations.push(
        `Consider a lower loan amount or larger down payment`,
      );
    }

    vehicleFinancingLogger.info(
      {
        userId,
        eligible,
        creditScore: creditResult.score,
        maxAmount: maxEligibleAmount,
      },
      "Eligibility check completed",
    );

    return {
      eligible,
      maxEligibleAmount,
      maxTermMonths,
      estimatedInterestRate: interestRate,
      estimatedMonthlyPayment: monthlyPayment,
      creditScore: creditResult.score,
      creditGrade: creditResult.grade,
      factors,
      requirements,
      recommendations,
    };
  }

  /**
   * Determine credit grade from score
   */
  private determineGrade(score: number): "A" | "B" | "C" | "D" | "F" {
    if (score >= 750) return "A";
    if (score >= 650) return "B";
    if (score >= 550) return "C";
    if (score >= 450) return "D";
    return "F";
  }

  /**
   * Determine risk level from score
   */
  private determineRiskLevel(
    score: number,
  ): "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH" {
    if (score >= 700) return "LOW";
    if (score >= 600) return "MEDIUM";
    if (score >= 500) return "HIGH";
    return "VERY_HIGH";
  }

  /**
   * Generate credit recommendations based on factors
   */
  private generateCreditRecommendations(
    avgMonthlyEarnings: number,
    earningsStability: number,
    tenureMonths: number,
  ): string[] {
    const recommendations: string[] = [];
    if (avgMonthlyEarnings < 50000) {
      recommendations.push(
        "Increase your monthly earnings to qualify for higher amounts",
      );
    }
    if (earningsStability < 70) {
      recommendations.push(
        "Maintain more consistent earnings month-over-month",
      );
    }
    if (tenureMonths < 6) {
      recommendations.push("Build more platform history before applying");
    }
    return recommendations;
  }

  /**
   * Calculate financing-specific credit score using UBI data
   */
  async calculateFinancingCreditScore(
    userId: string,
  ): Promise<FinancingCreditResult> {
    // Get user data
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        driver: true,
      },
    });

    if (!user) {
      throw new Error("User not found");
    }

    // Get UBI earnings history (last 12 months)
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const earnings = await prisma.driverEarning.findMany({
      where: {
        driver: { userId },
        createdAt: { gte: twelveMonthsAgo },
      },
      orderBy: { createdAt: "desc" },
    });

    const totalEarnings = earnings.reduce(
      (sum, e) => sum + Number(e.amount),
      0,
    );
    const avgMonthlyEarnings = totalEarnings / 12;

    // Calculate earnings stability (variance-based)
    const monthlyEarnings: number[] = [];
    for (let i = 0; i < 12; i++) {
      const monthStart = new Date();
      monthStart.setMonth(monthStart.getMonth() - i - 1);
      const monthEnd = new Date();
      monthEnd.setMonth(monthEnd.getMonth() - i);

      const monthTotal = earnings
        .filter((e) => e.createdAt >= monthStart && e.createdAt < monthEnd)
        .reduce((sum, e) => sum + Number(e.amount), 0);
      monthlyEarnings.push(monthTotal);
    }

    const avgEarning =
      monthlyEarnings.reduce((a, b) => a + b, 0) / monthlyEarnings.length || 1;
    const variance =
      monthlyEarnings.reduce((sum, e) => sum + Math.pow(e - avgEarning, 2), 0) /
      monthlyEarnings.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = stdDev / avgEarning;
    const earningsStability = Math.max(
      0,
      Math.min(100, 100 - coefficientOfVariation * 100),
    );

    // Get platform history
    const tenureMonths = Math.floor(
      (Date.now() - user.createdAt.getTime()) / (30 * 24 * 60 * 60 * 1000),
    );

    // Get existing loans/financing
    const existingLoans = await prisma.vehicleFinancing.findMany({
      where: {
        driverUserId: userId,
        status: { in: ["FINANCED"] },
      },
    });

    const existingLoansBalance = existingLoans.reduce(
      (sum, l) => sum + Number(l.amountRemaining),
      0,
    );

    // Get payment history
    let onTimePaymentRate = 100;
    let latePayments = 0;

    if (existingLoans.length > 0) {
      const payments = await prisma.vehicleFinancingPayment.findMany({
        where: {
          financingId: { in: existingLoans.map((l) => l.id) },
          status: { in: ["PAID", "OVERDUE"] },
        },
      });

      const totalPayments = payments.length;
      latePayments = payments.filter(
        (p) => p.status === "OVERDUE" || (p.paidAt && p.paidAt > p.dueDate),
      ).length;
      onTimePaymentRate =
        totalPayments > 0
          ? ((totalPayments - latePayments) / totalPayments) * 100
          : 100;
    }

    // Build factors
    const earningsTrend = this.calculateEarningsTrend(monthlyEarnings);
    const factors: FinancingCreditFactors = {
      ubiEarningsHistory: {
        avgMonthlyEarnings,
        totalEarningsLast12Mo: totalEarnings,
        earningsStability,
        earningsTrend,
      },
      platformHistory: {
        tenureMonths,
        totalTrips: user.driver?.totalRides || 0,
        rating: user.driver?.rating || 0,
        acceptanceRate: user.driver?.acceptanceRate || 0,
        cancellationRate: user.driver?.cancellationRate || 0,
      },
      paymentHistory: {
        onTimePaymentRate,
        latePayments,
        existingLoansCount: existingLoans.length,
        existingLoansBalance,
      },
      kycLevel: "STANDARD", // Would come from wallet service
      documentVerification: {
        driversLicense: !!user.driver?.licenseNumber,
        nationalId: true, // Assume verified if on platform
        proofOfAddress: false,
      },
    };

    // Calculate score (0-850)
    let score = 300; // Base score
    score += Math.min(200, avgMonthlyEarnings / 500);
    score += earningsStability;
    score += Math.min(100, tenureMonths * 5);
    score += (onTimePaymentRate / 100) * 150;
    score -= latePayments * 20;

    if (user.driver?.rating) {
      score += (user.driver.rating - 3) * 25;
    }

    score = Math.max(300, Math.min(850, Math.round(score)));

    const grade = this.determineGrade(score);
    const maxEligibleAmount = avgMonthlyEarnings * 24 * (score / 850);
    const suggestedInterestRate = INTEREST_RATE_BY_GRADE[grade];
    const riskLevel = this.determineRiskLevel(score);
    const recommendations = this.generateCreditRecommendations(
      avgMonthlyEarnings,
      earningsStability,
      tenureMonths,
    );

    return {
      score,
      grade,
      maxEligibleAmount,
      suggestedInterestRate,
      suggestedTermMonths: Math.min(36, Math.max(12, Math.floor(score / 25))),
      factors,
      riskLevel,
      recommendations,
    };
  }

  // ===========================================
  // APPLICATION METHODS
  // ===========================================

  /**
   * Submit a financing application
   */
  async submitApplication(
    userId: string,
    params: FinancingApplicationParams,
  ): Promise<FinancingApplication> {
    const {
      vehicleListingId,
      requestedAmount,
      downPaymentAmount,
      requestedTermMonths,
      planType,
      currency,
      monthlyIncome,
      employmentStatus,
      drivingExperienceYears,
      documents,
      notes,
    } = params;

    vehicleFinancingLogger.info(
      { userId, vehicleListingId, requestedAmount, planType },
      "Submitting financing application",
    );

    // Validate listing
    const listing = await prisma.vehicleMarketplaceListing.findUnique({
      where: { id: vehicleListingId },
    });

    if (!listing) {
      throw new Error("Vehicle listing not found");
    }

    if (listing.status !== "AVAILABLE") {
      throw new Error("Vehicle is no longer available");
    }

    // Check for existing pending application
    const existingApp = await prisma.vehicleFinancingApplication.findFirst({
      where: {
        applicantUserId: userId,
        vehicleListingId,
        status: { in: ["PENDING", "REVIEWING"] },
      },
    });

    if (existingApp) {
      throw new Error(
        "You already have a pending application for this vehicle",
      );
    }

    // Validate down payment
    const minDownPayment =
      Number(listing.listPrice) *
      (FINANCING_CONFIG.minDownPaymentPercentage / 100);
    if (downPaymentAmount < minDownPayment) {
      throw new Error(
        `Minimum down payment is ${currency} ${minDownPayment.toFixed(0)}`,
      );
    }

    // Calculate credit score
    const creditResult = await this.calculateFinancingCreditScore(userId);

    // Get driver info
    const driver = await prisma.driver.findFirst({
      where: { userId },
    });

    // Create application
    const application = await prisma.vehicleFinancingApplication.create({
      data: {
        applicantUserId: userId,
        vehicleListingId,
        requestedAmount,
        downPaymentAmount,
        requestedTermMonths,
        planType,
        currency,
        monthlyIncome,
        employmentStatus,
        drivingExperienceYears,
        ubiDriverId: driver?.id,
        creditScore: creditResult.score,
        creditGrade: creditResult.grade,
        riskLevel: creditResult.riskLevel,
        avgMonthlyEarnings:
          creditResult.factors.ubiEarningsHistory.avgMonthlyEarnings,
        totalEarningsLast12Mo:
          creditResult.factors.ubiEarningsHistory.totalEarningsLast12Mo,
        onTimePaymentRate:
          creditResult.factors.paymentHistory.onTimePaymentRate,
        platformTenureMonths: creditResult.factors.platformHistory.tenureMonths,
        status: "PENDING",
        documents: documents ? JSON.stringify(documents) : null,
        notes,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      },
    });

    // Reserve the vehicle
    await prisma.vehicleMarketplaceListing.update({
      where: { id: vehicleListingId },
      data: { status: "RESERVED" },
    });

    // Auto-approve if credit score is high enough
    if (
      creditResult.score >= 650 &&
      requestedAmount <= creditResult.maxEligibleAmount
    ) {
      await this.processApplicationDecision(application.id, {
        approved: true,
        amount: requestedAmount,
        termMonths: requestedTermMonths,
        interestRate: creditResult.suggestedInterestRate,
        monthlyPayment: this.calculateMonthlyPayment(
          requestedAmount,
          creditResult.suggestedInterestRate,
          requestedTermMonths,
        ),
      });

      // Reload application
      const updatedApp = await prisma.vehicleFinancingApplication.findUnique({
        where: { id: application.id },
      });

      if (!updatedApp) {
        throw new Error("Application not found after update");
      }

      return this.mapApplicationToType(updatedApp);
    }

    // Mark for manual review
    await prisma.vehicleFinancingApplication.update({
      where: { id: application.id },
      data: { status: "REVIEWING" },
    });

    vehicleFinancingLogger.info(
      { applicationId: application.id, creditScore: creditResult.score },
      "Application submitted for review",
    );

    return this.mapApplicationToType(application);
  }

  /**
   * Process application decision (approve/reject)
   */
  async processApplicationDecision(
    applicationId: string,
    decision: ApplicationDecision,
  ): Promise<FinancingApplication> {
    const application = await prisma.vehicleFinancingApplication.findUnique({
      where: { id: applicationId },
      include: { vehicleListing: true },
    });

    if (!application) {
      throw new Error("Application not found");
    }

    if (
      application.status !== "PENDING" &&
      application.status !== "REVIEWING"
    ) {
      throw new Error("Application already processed");
    }

    if (decision.approved) {
      // Approve application
      await prisma.vehicleFinancingApplication.update({
        where: { id: applicationId },
        data: {
          status: "APPROVED",
          approvedAmount: decision.amount,
          approvedTermMonths: decision.termMonths,
          approvedInterestRate: decision.interestRate,
          monthlyPaymentAmount: decision.monthlyPayment,
          reviewedAt: new Date(),
        },
      });

      // Notify user
      await notificationClient.send({
        userId: application.applicantUserId,
        title: "Financing Approved! 🎉",
        body: `Your financing application for ${application.vehicleListing.make} ${application.vehicleListing.model} has been approved!`,
        type: NotificationType.PAYMENT_SUCCESS,
        priority: NotificationPriority.HIGH,
        data: {
          type: "financing_approved",
          applicationId,
          amount: decision.amount,
          monthlyPayment: decision.monthlyPayment,
        },
      });

      vehicleFinancingLogger.info(
        { applicationId, amount: decision.amount, rate: decision.interestRate },
        "Application approved",
      );
    } else {
      // Reject application
      await prisma.vehicleFinancingApplication.update({
        where: { id: applicationId },
        data: {
          status: "REJECTED",
          rejectionReason: decision.rejectionReason,
          reviewedAt: new Date(),
        },
      });

      // Release vehicle reservation
      await prisma.vehicleMarketplaceListing.update({
        where: { id: application.vehicleListingId },
        data: { status: "AVAILABLE" },
      });

      // Notify user
      await notificationClient.send({
        userId: application.applicantUserId,
        title: "Financing Application Update",
        body: `Your financing application was not approved. ${decision.rejectionReason || "Please contact support for more information."}`,
        type: NotificationType.PAYMENT_FAILED,
        priority: NotificationPriority.NORMAL,
        data: {
          type: "financing_rejected",
          applicationId,
          reason: decision.rejectionReason,
        },
      });

      vehicleFinancingLogger.info(
        { applicationId, reason: decision.rejectionReason },
        "Application rejected",
      );
    }

    const updated = await prisma.vehicleFinancingApplication.findUnique({
      where: { id: applicationId },
    });

    if (!updated) {
      throw new Error("Application not found after update");
    }

    return this.mapApplicationToType(updated);
  }

  /**
   * Accept approved financing (finalize the deal)
   */
  async acceptFinancing(
    applicationId: string,
    userId: string,
  ): Promise<VehicleFinancing> {
    const application = await prisma.vehicleFinancingApplication.findUnique({
      where: { id: applicationId },
      include: { vehicleListing: true },
    });

    if (!application) {
      throw new Error("Application not found");
    }

    if (application.applicantUserId !== userId) {
      throw new Error("Not authorized");
    }

    if (application.status !== "APPROVED") {
      throw new Error("Application is not approved");
    }

    if (application.expiresAt && application.expiresAt < new Date()) {
      throw new Error("Approval has expired");
    }

    const principalAmount = Number(application.approvedAmount);
    const interestRate = Number(application.approvedInterestRate);
    const termMonths = application.approvedTermMonths!;
    const monthlyPayment = Number(application.monthlyPaymentAmount);
    const totalInterest = monthlyPayment * termMonths - principalAmount;
    const totalPayable = principalAmount + totalInterest;

    const startDate = new Date();
    const expectedEndDate = new Date();
    expectedEndDate.setMonth(expectedEndDate.getMonth() + termMonths);

    // Create financing record
    const financing = await prisma.vehicleFinancing.create({
      data: {
        applicationId,
        driverUserId: userId,
        planType: application.planType,
        principalAmount,
        downPaymentPaid: Number(application.downPaymentAmount),
        interestRate,
        termMonths,
        monthlyPayment,
        totalInterest,
        totalPayable,
        currency: application.currency,
        amountPaid: 0,
        amountRemaining: totalPayable,
        paymentsCompleted: 0,
        paymentsRemaining: termMonths,
        autoDeductEnabled: true,
        autoDeductPercentage: 25, // Default 25% of earnings
        status: "FINANCED",
        startDate,
        expectedEndDate,
      },
    });

    // Generate payment schedule
    await this.generatePaymentSchedule(
      financing.id,
      termMonths,
      monthlyPayment,
      application.currency,
    );

    // Update first payment due date
    const firstPaymentDue = new Date();
    firstPaymentDue.setMonth(firstPaymentDue.getMonth() + 1);

    await prisma.vehicleFinancing.update({
      where: { id: financing.id },
      data: {
        nextPaymentDue: firstPaymentDue,
        nextPaymentAmount: monthlyPayment,
      },
    });

    // Update vehicle listing status
    await prisma.vehicleMarketplaceListing.update({
      where: { id: application.vehicleListingId },
      data: { status: "FINANCED" },
    });

    // Create vehicle record and link to financing (if not exists)
    const vehicle = await prisma.vehicle.create({
      data: {
        make: application.vehicleListing.make,
        model: application.vehicleListing.model,
        year: application.vehicleListing.year,
        color: application.vehicleListing.color,
        plateNumber: `PENDING_${nanoid(8)}`, // Will be updated when registered
        type: application.vehicleListing.vehicleType,
      },
    });

    await prisma.vehicleFinancing.update({
      where: { id: financing.id },
      data: { vehicleId: vehicle.id },
    });

    // Notify user
    await notificationClient.send({
      userId,
      title: "Congratulations on Your New Vehicle! 🚗",
      body: `Your financing for the ${application.vehicleListing.make} ${application.vehicleListing.model} is now active. First payment of ${application.currency} ${monthlyPayment.toFixed(0)} due on ${firstPaymentDue.toDateString()}.`,
      type: NotificationType.PAYMENT_SUCCESS,
      priority: NotificationPriority.HIGH,
      data: {
        type: "financing_activated",
        financingId: financing.id,
        firstPaymentDue: firstPaymentDue.toISOString(),
        monthlyPayment,
      },
    });

    vehicleFinancingLogger.info(
      { financingId: financing.id, applicationId, userId },
      "Financing activated",
    );

    return this.mapFinancingToType(financing);
  }

  // ===========================================
  // PAYMENT METHODS
  // ===========================================

  /**
   * Process payment through the appropriate payment source
   */
  private async processPaymentBySource(
    userId: string,
    totalToPay: number,
    currency: string,
    financingId: string,
    paymentSource: string,
  ): Promise<string> {
    switch (paymentSource) {
      case "WALLET":
        return this.processWalletPayment(userId, totalToPay, currency);
      case "MPESA":
        return this.processMpesaPayment(
          userId,
          totalToPay,
          currency,
          financingId,
        );
      case "MTN_MOMO":
        return this.processMomoPayment(
          userId,
          totalToPay,
          currency,
          financingId,
        );
      default:
        throw new Error(`Payment source ${paymentSource} not supported`);
    }
  }

  /**
   * Calculate late fee if payment is overdue
   */
  private calculateLateFee(payment: any): number {
    if (
      payment.status === "OVERDUE" ||
      (payment.dueDate < new Date() && payment.gracePeriodEnds < new Date())
    ) {
      return Number(payment.totalAmount) * FINANCING_CONFIG.lateFeePercentage;
    }
    return 0;
  }

  /**
   * Find the payment to process
   */
  private findPaymentToProcess(financing: any, paymentNumber?: number): any {
    if (paymentNumber) {
      return financing.payments.find(
        (p: any) => p.paymentNumber === paymentNumber,
      );
    }
    // Find next due payment
    return financing.payments.find(
      (p: any) =>
        p.status === "PENDING" ||
        p.status === "PARTIAL" ||
        p.status === "OVERDUE",
    );
  }

  /**
   * Make a financing payment
   */
  async makePayment(
    userId: string,
    params: FinancingPaymentParams,
  ): Promise<FinancingPaymentResult> {
    const { financingId, paymentNumber, amount, paymentSource } = params;

    const financing = await prisma.vehicleFinancing.findUnique({
      where: { id: financingId },
      include: { payments: { orderBy: { paymentNumber: "asc" } } },
    });

    if (!financing) {
      throw new Error("Financing not found");
    }

    if (financing.driverUserId !== userId) {
      throw new Error("Not authorized");
    }

    if (financing.status !== "FINANCED") {
      throw new Error(`Cannot make payment - financing is ${financing.status}`);
    }

    const payment = this.findPaymentToProcess(financing, paymentNumber);

    if (!payment) {
      throw new Error("No pending payment found");
    }

    const paymentAmount =
      amount || Number(payment.totalAmount) - Number(payment.amountPaid);

    const lateFee = this.calculateLateFee(payment);
    const totalToPay = paymentAmount + lateFee;

    // Process payment based on source
    let transactionId: string;

    try {
      transactionId = await this.processPaymentBySource(
        userId,
        totalToPay,
        financing.currency,
        financingId,
        paymentSource,
      );
    } catch (error) {
      vehicleFinancingLogger.error(
        { err: error, financingId, paymentNumber: payment.paymentNumber },
        "Payment processing failed",
      );
      throw error;
    }

    // Update payment record
    const newAmountPaid = Number(payment.amountPaid) + paymentAmount;
    const newStatus =
      newAmountPaid >= Number(payment.totalAmount) ? "PAID" : "PARTIAL";

    await prisma.vehicleFinancingPayment.update({
      where: { id: payment.id },
      data: {
        amountPaid: newAmountPaid,
        lateFee: Number(payment.lateFee) + lateFee,
        status: newStatus,
        paidAt: newStatus === "PAID" ? new Date() : null,
        paymentSource,
        transactionId,
        isAutoDeducted: paymentSource === "AUTO_DEDUCT",
      },
    });

    // Update financing totals
    const newFinancingAmountPaid = Number(financing.amountPaid) + paymentAmount;
    const newFinancingAmountRemaining =
      Number(financing.amountRemaining) - paymentAmount;
    const newPaymentsCompleted =
      financing.paymentsCompleted + (newStatus === "PAID" ? 1 : 0);
    const newPaymentsRemaining =
      financing.paymentsRemaining - (newStatus === "PAID" ? 1 : 0);

    const isFullyPaid = newPaymentsRemaining === 0;
    const newFinancingStatus = isFullyPaid ? "PAID_OFF" : "FINANCED";

    // Find next payment
    const nextPayment = financing.payments.find(
      (p) => p.paymentNumber > payment.paymentNumber && p.status !== "PAID",
    );

    await prisma.vehicleFinancing.update({
      where: { id: financingId },
      data: {
        amountPaid: newFinancingAmountPaid,
        amountRemaining: newFinancingAmountRemaining,
        paymentsCompleted: newPaymentsCompleted,
        paymentsRemaining: newPaymentsRemaining,
        status: newFinancingStatus,
        actualEndDate: isFullyPaid ? new Date() : null,
        nextPaymentDue: nextPayment?.dueDate || null,
        nextPaymentAmount: nextPayment ? Number(nextPayment.totalAmount) : null,
      },
    });

    // Notify user
    await notificationClient.send({
      userId,
      title: isFullyPaid ? "Financing Paid Off! 🎉" : "Payment Received",
      body: isFullyPaid
        ? "Congratulations! Your vehicle financing is now fully paid off!"
        : `Payment of ${financing.currency} ${paymentAmount.toFixed(0)} received. Remaining: ${financing.currency} ${newFinancingAmountRemaining.toFixed(0)}`,
      type: NotificationType.PAYMENT_SUCCESS,
      priority: isFullyPaid
        ? NotificationPriority.HIGH
        : NotificationPriority.NORMAL,
      data: {
        type: "financing_payment",
        financingId,
        paymentNumber: payment.paymentNumber,
        amountPaid: paymentAmount,
        isFullyPaid,
      },
    });

    vehicleFinancingLogger.info(
      {
        financingId,
        paymentNumber: payment.paymentNumber,
        amount: paymentAmount,
        transactionId,
      },
      "Payment processed successfully",
    );

    return {
      success: true,
      paymentId: payment.id,
      paymentNumber: payment.paymentNumber,
      amountPaid: paymentAmount,
      principalPaid:
        paymentAmount *
        (Number(payment.principalAmount) / Number(payment.totalAmount)),
      interestPaid:
        paymentAmount *
        (Number(payment.interestAmount) / Number(payment.totalAmount)),
      lateFee,
      totalPaid: totalToPay,
      balanceRemaining: newFinancingAmountRemaining,
      nextPaymentDue: nextPayment?.dueDate,
      nextPaymentAmount: nextPayment
        ? Number(nextPayment.totalAmount)
        : undefined,
      financingStatus: newFinancingStatus as VehicleFinancingStatus,
      isFullyPaid,
    };
  }

  /**
   * Process auto-deduction from driver earnings
   */
  async processAutoDeduction(
    earningsId: string,
    driverId: string,
    earningsAmount: number,
  ): Promise<AutoDeductResult | null> {
    // Find active financing with auto-deduct enabled
    const financing = await prisma.vehicleFinancing.findFirst({
      where: {
        driverUserId: driverId,
        status: "FINANCED",
        autoDeductEnabled: true,
      },
      include: {
        payments: {
          where: { status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
        },
      },
    });

    if (!financing?.payments.length) {
      return null;
    }

    // Check minimum threshold
    if (
      financing.minEarningsThreshold &&
      earningsAmount < Number(financing.minEarningsThreshold)
    ) {
      return {
        success: false,
        deductedAmount: 0,
        financingId: financing.id,
        earningsId,
        originalEarnings: earningsAmount,
        remainingEarnings: earningsAmount,
        message: "Earnings below minimum threshold",
      };
    }

    // Calculate deduction amount
    const deductPercentage =
      Number(financing.autoDeductPercentage) ||
      FINANCING_CONFIG.autoDeductMaxPercentage;
    const maxDeduction = (earningsAmount * deductPercentage) / 100;

    const nextPayment = financing.payments[0];
    const amountDue =
      Number(nextPayment.totalAmount) - Number(nextPayment.amountPaid);
    const deductionAmount = Math.min(maxDeduction, amountDue);

    if (deductionAmount <= 0) {
      return null;
    }

    // Process the deduction
    try {
      const result = await this.makePayment(driverId, {
        financingId: financing.id,
        paymentNumber: nextPayment.paymentNumber,
        amount: deductionAmount,
        paymentSource: "AUTO_DEDUCT",
      });

      return {
        success: true,
        deductedAmount: deductionAmount,
        financingId: financing.id,
        paymentId: result.paymentId,
        earningsId,
        originalEarnings: earningsAmount,
        remainingEarnings: earningsAmount - deductionAmount,
      };
    } catch (error) {
      vehicleFinancingLogger.error(
        { err: error, financingId: financing.id, earningsId },
        "Auto-deduction failed",
      );

      return {
        success: false,
        deductedAmount: 0,
        financingId: financing.id,
        earningsId,
        originalEarnings: earningsAmount,
        remainingEarnings: earningsAmount,
        message:
          error instanceof Error ? error.message : "Auto-deduction failed",
      };
    }
  }

  // ===========================================
  // DASHBOARD & SUMMARY METHODS
  // ===========================================

  /**
   * Get user's financing dashboard
   */
  async getDashboard(userId: string): Promise<FinancingDashboard> {
    const summary = await this.getFinancingSummary(userId);

    const activeFinancings = await prisma.vehicleFinancing.findMany({
      where: {
        driverUserId: userId,
        status: { in: ["FINANCED"] },
      },
      include: {
        payments: {
          where: { status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
          orderBy: { dueDate: "asc" },
          take: 1,
        },
      },
    });

    // Get upcoming payments
    const upcomingPayments: UpcomingPayment[] = activeFinancings.map((f) => {
      const nextPayment = f.payments[0];
      const daysUntilDue = nextPayment
        ? Math.ceil(
            (nextPayment.dueDate.getTime() - Date.now()) /
              (24 * 60 * 60 * 1000),
          )
        : 0;

      return {
        financingId: f.id,
        vehicleInfo: `Vehicle Financing #${f.id.slice(-6)}`,
        dueDate: nextPayment?.dueDate || new Date(),
        amount: nextPayment ? Number(nextPayment.totalAmount) : 0,
        currency: f.currency,
        isOverdue: daysUntilDue < 0,
        daysUntilDue,
      };
    });

    // Get recent payments
    const recentPayments = await prisma.vehicleFinancingPayment.findMany({
      where: {
        financing: { driverUserId: userId },
        status: "PAID",
      },
      orderBy: { paidAt: "desc" },
      take: 5,
    });

    // Get recommended vehicles
    const recommendations = await this.getRecommendedListings(userId, 5);

    return {
      summary,
      activeFinancings: activeFinancings.map((f) => this.mapFinancingToType(f)),
      upcomingPayments,
      recentPayments: recentPayments.map((p) => this.mapPaymentToType(p)),
      recommendations,
    };
  }

  /**
   * Get financing summary for user
   */
  async getFinancingSummary(userId: string): Promise<FinancingSummary> {
    const financings = await prisma.vehicleFinancing.findMany({
      where: {
        driverUserId: userId,
        status: { in: ["FINANCED", "PAID_OFF"] },
      },
    });

    const activeFinancings = financings.filter((f) => f.status === "FINANCED");

    const totalAmountFinanced = financings.reduce(
      (sum, f) => sum + Number(f.principalAmount),
      0,
    );
    const totalAmountPaid = financings.reduce(
      (sum, f) => sum + Number(f.amountPaid),
      0,
    );
    const totalAmountRemaining = activeFinancings.reduce(
      (sum, f) => sum + Number(f.amountRemaining),
      0,
    );

    // Get overdue info
    const overduePayments = await prisma.vehicleFinancingPayment.findMany({
      where: {
        financing: { driverUserId: userId, status: "FINANCED" },
        status: "OVERDUE",
      },
    });

    const overdueAmount = overduePayments.reduce(
      (sum, p) => sum + Number(p.totalAmount) - Number(p.amountPaid),
      0,
    );

    // Get next payment
    const nextPayment = await prisma.vehicleFinancingPayment.findFirst({
      where: {
        financing: { driverUserId: userId, status: "FINANCED" },
        status: { in: ["PENDING", "PARTIAL"] },
      },
      orderBy: { dueDate: "asc" },
    });

    // Get credit score
    const creditScore = await prisma.creditScore.findFirst({
      where: { userId },
      orderBy: { calculatedAt: "desc" },
    });

    return {
      userId,
      activeFinancings: activeFinancings.length,
      totalAmountFinanced,
      totalAmountPaid,
      totalAmountRemaining,
      currency: financings[0]?.currency || ("NGN" as Currency),
      nextPaymentDue: nextPayment?.dueDate,
      nextPaymentAmount: nextPayment
        ? Number(nextPayment.totalAmount)
        : undefined,
      overduePayments: overduePayments.length,
      overdueAmount,
      creditScore: creditScore?.score,
      creditGrade: creditScore?.category,
    };
  }

  // ===========================================
  // HELPER METHODS
  // ===========================================

  /**
   * Generate payment schedule
   */
  private async generatePaymentSchedule(
    financingId: string,
    termMonths: number,
    monthlyPayment: number,
    currency: Currency,
  ): Promise<void> {
    const financing = await prisma.vehicleFinancing.findUnique({
      where: { id: financingId },
    });

    if (!financing) {
      return;
    }

    const principal = Number(financing.principalAmount);
    const rate = Number(financing.interestRate) / 12; // Monthly rate
    let balance = principal;

    for (let i = 1; i <= termMonths; i++) {
      const interestAmount = balance * rate;
      const principalAmount = monthlyPayment - interestAmount;
      balance -= principalAmount;

      const dueDate = new Date(financing.startDate);
      dueDate.setMonth(dueDate.getMonth() + i);

      const gracePeriodEnds = new Date(dueDate);
      gracePeriodEnds.setDate(
        gracePeriodEnds.getDate() + FINANCING_CONFIG.gracePeriodDays,
      );

      await prisma.vehicleFinancingPayment.create({
        data: {
          financingId,
          paymentNumber: i,
          principalAmount,
          interestAmount,
          lateFee: 0,
          totalAmount: monthlyPayment,
          amountPaid: 0,
          currency,
          dueDate,
          gracePeriodEnds,
          status: "PENDING",
          isAutoDeducted: false,
        },
      });
    }
  }

  /**
   * Calculate monthly payment using amortization formula
   */
  private calculateMonthlyPayment(
    principal: number,
    annualRate: number,
    termMonths: number,
  ): number {
    const monthlyRate = annualRate / 12;
    if (monthlyRate === 0) {
      return principal / termMonths;
    }
    const payment =
      (principal * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
      (Math.pow(1 + monthlyRate, termMonths) - 1);
    return Math.ceil(payment);
  }

  /**
   * Process wallet payment
   */
  private async processWalletPayment(
    userId: string,
    amount: number,
    currency: Currency,
  ): Promise<string> {
    const wallet = await prisma.walletAccount.findFirst({
      where: { userId, currency },
    });

    if (!wallet) {
      throw new Error("Wallet not found");
    }

    const transactionId = `vfpay_${nanoid(16)}`;

    await enhancedWalletService.debit({
      walletId: wallet.id,
      amount,
      currency,
      description: "Vehicle Financing Payment",
      reference: transactionId,
    });

    return transactionId;
  }

  /**
   * Process M-Pesa payment
   */
  private async processMpesaPayment(
    userId: string,
    amount: number,
    currency: Currency,
    financingId: string,
  ): Promise<string> {
    // Get user phone
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });

    if (!user) {
      throw new Error("User not found");
    }

    const transactionId = `vfpay_mpesa_${nanoid(16)}`;

    // Initiate STK Push
    await fetch(
      `${process.env.PAYMENT_SERVICE_URL || "http://localhost:4004"}/v1/mpesa/stk-push`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: user.phone,
          amount,
          accountReference: financingId,
          transactionDesc: "Vehicle Financing Payment",
        }),
      },
    );

    return transactionId;
  }

  /**
   * Process MTN MoMo payment
   */
  private async processMomoPayment(
    userId: string,
    amount: number,
    currency: Currency,
    financingId: string,
  ): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });

    if (!user) {
      throw new Error("User not found");
    }

    const transactionId = `vfpay_momo_${nanoid(16)}`;

    await fetch(
      `${process.env.PAYMENT_SERVICE_URL || "http://localhost:4004"}/v1/mtn-momo/request-to-pay`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: user.phone,
          amount,
          currency,
          externalId: transactionId,
          payerMessage: "Vehicle Financing Payment",
        }),
      },
    );

    return transactionId;
  }

  // ===========================================
  // HELPER METHODS
  // ===========================================

  private calculateEarningsTrend(
    monthlyEarnings: number[],
  ): "UP" | "DOWN" | "STABLE" {
    const firstMonth = monthlyEarnings[0] || 0;
    const lastMonth = monthlyEarnings[11] || 0;
    if (firstMonth > lastMonth) {
      return "UP";
    }
    if (firstMonth < lastMonth) {
      return "DOWN";
    }
    return "STABLE";
  }

  // ===========================================
  // MAPPING METHODS
  // ===========================================

  private mapListingToType(listing: any): VehicleMarketplaceListing {
    return {
      id: listing.id,
      make: listing.make,
      model: listing.model,
      year: listing.year,
      color: listing.color,
      mileage: listing.mileage,
      condition: listing.condition,
      vehicleType: listing.vehicleType,
      fuelType: listing.fuelType,
      transmission: listing.transmission,
      engineCapacity: listing.engineCapacity,
      description: listing.description,
      images: listing.images || [],
      listPrice: Number(listing.listPrice),
      currency: listing.currency,
      financingAvailable: listing.financingAvailable,
      minDownPayment: listing.minDownPayment
        ? Number(listing.minDownPayment)
        : undefined,
      maxFinancingTerm: listing.maxFinancingTerm,
      location: listing.location,
      latitude: listing.latitude,
      longitude: listing.longitude,
      status: listing.status,
      sellerId: listing.sellerId,
      sellerType: listing.sellerType,
      viewCount: listing.viewCount,
      createdAt: listing.createdAt,
      updatedAt: listing.updatedAt,
    };
  }

  private mapApplicationToType(app: any): FinancingApplication {
    return {
      id: app.id,
      applicantUserId: app.applicantUserId,
      vehicleListingId: app.vehicleListingId,
      requestedAmount: Number(app.requestedAmount),
      downPaymentAmount: Number(app.downPaymentAmount),
      requestedTermMonths: app.requestedTermMonths,
      planType: app.planType,
      currency: app.currency,
      monthlyIncome: app.monthlyIncome ? Number(app.monthlyIncome) : undefined,
      employmentStatus: app.employmentStatus,
      drivingExperienceYears: app.drivingExperienceYears,
      ubiDriverId: app.ubiDriverId,
      creditScore: app.creditScore,
      creditGrade: app.creditGrade,
      riskLevel: app.riskLevel,
      avgMonthlyEarnings: app.avgMonthlyEarnings
        ? Number(app.avgMonthlyEarnings)
        : undefined,
      totalEarningsLast12Mo: app.totalEarningsLast12Mo
        ? Number(app.totalEarningsLast12Mo)
        : undefined,
      onTimePaymentRate: app.onTimePaymentRate
        ? Number(app.onTimePaymentRate)
        : undefined,
      platformTenureMonths: app.platformTenureMonths,
      status: app.status,
      approvedAmount: app.approvedAmount
        ? Number(app.approvedAmount)
        : undefined,
      approvedTermMonths: app.approvedTermMonths,
      approvedInterestRate: app.approvedInterestRate
        ? Number(app.approvedInterestRate)
        : undefined,
      monthlyPaymentAmount: app.monthlyPaymentAmount
        ? Number(app.monthlyPaymentAmount)
        : undefined,
      rejectionReason: app.rejectionReason,
      reviewedAt: app.reviewedAt,
      reviewedBy: app.reviewedBy,
      expiresAt: app.expiresAt,
      documents: app.documents ? JSON.parse(app.documents) : undefined,
      notes: app.notes,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
    };
  }

  private mapFinancingToType(financing: any): VehicleFinancing {
    return {
      id: financing.id,
      applicationId: financing.applicationId,
      driverUserId: financing.driverUserId,
      vehicleId: financing.vehicleId,
      planType: financing.planType,
      principalAmount: Number(financing.principalAmount),
      downPaymentPaid: Number(financing.downPaymentPaid),
      interestRate: Number(financing.interestRate),
      termMonths: financing.termMonths,
      monthlyPayment: Number(financing.monthlyPayment),
      totalInterest: Number(financing.totalInterest),
      totalPayable: Number(financing.totalPayable),
      currency: financing.currency,
      amountPaid: Number(financing.amountPaid),
      amountRemaining: Number(financing.amountRemaining),
      nextPaymentDue: financing.nextPaymentDue,
      nextPaymentAmount: financing.nextPaymentAmount
        ? Number(financing.nextPaymentAmount)
        : undefined,
      paymentsCompleted: financing.paymentsCompleted,
      paymentsRemaining: financing.paymentsRemaining,
      missedPayments: financing.missedPayments,
      latePayments: financing.latePayments,
      autoDeductEnabled: financing.autoDeductEnabled,
      autoDeductPercentage: financing.autoDeductPercentage
        ? Number(financing.autoDeductPercentage)
        : undefined,
      autoDeductDay: financing.autoDeductDay,
      minEarningsThreshold: financing.minEarningsThreshold
        ? Number(financing.minEarningsThreshold)
        : undefined,
      status: financing.status,
      startDate: financing.startDate,
      expectedEndDate: financing.expectedEndDate,
      actualEndDate: financing.actualEndDate,
      defaultedAt: financing.defaultedAt,
      createdAt: financing.createdAt,
      updatedAt: financing.updatedAt,
    };
  }

  private mapPaymentToType(payment: any): FinancingPayment {
    return {
      id: payment.id,
      financingId: payment.financingId,
      paymentNumber: payment.paymentNumber,
      principalAmount: Number(payment.principalAmount),
      interestAmount: Number(payment.interestAmount),
      lateFee: Number(payment.lateFee),
      totalAmount: Number(payment.totalAmount),
      amountPaid: Number(payment.amountPaid),
      currency: payment.currency,
      dueDate: payment.dueDate,
      paidAt: payment.paidAt,
      gracePeriodEnds: payment.gracePeriodEnds,
      paymentSource: payment.paymentSource,
      transactionId: payment.transactionId,
      status: payment.status,
      isAutoDeducted: payment.isAutoDeducted,
      notes: payment.notes,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }
}

// Export singleton
export const vehicleFinancingService = new VehicleFinancingService();
