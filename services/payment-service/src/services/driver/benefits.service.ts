// ===========================================
// UBI Driver Experience Platform
// Benefits & Insurance Service
// ===========================================

import { EventEmitter } from "events";
import {
  BenefitClaim,
  BenefitEnrollment,
  BenefitEnrollmentStatus,
  BenefitPackage,
  BenefitType,
  BillingCycle,
  ClaimInput,
  ClaimStatus,
  DRIVER_EVENTS,
  DriverBenefitPackage,
  EnrollmentOptions,
  FuelDiscount,
  FuelStation,
  FuelTransaction,
  IDriverBenefitsService,
} from "../../types/driver.types";

// -----------------------------------------
// FUEL DISCOUNT TIERS
// -----------------------------------------

const FUEL_DISCOUNT_TIERS = {
  starter: { minTrips: 0, discount: 3, monthlyLimit: 50000 },
  bronze: { minTrips: 100, discount: 5, monthlyLimit: 75000 },
  silver: { minTrips: 300, discount: 7, monthlyLimit: 100000 },
  gold: { minTrips: 500, discount: 10, monthlyLimit: 150000 },
  platinum: { minTrips: 1000, discount: 12, monthlyLimit: 200000 },
  diamond: { minTrips: 2000, discount: 15, monthlyLimit: 300000 },
};

// -----------------------------------------
// BENEFITS SERVICE
// -----------------------------------------

export class DriverBenefitsService implements IDriverBenefitsService {
  // @ts-expect-error - Reserved for future event handling
  private _eventEmitter: EventEmitter;
  // @ts-expect-error - Reserved for future caching
  private _cache: Map<string, { data: unknown; expiry: number }> = new Map();

  constructor(
    private db: any,
    // @ts-expect-error - Reserved for future Redis integration
    private _redis: any,
    private paymentService: any,
    private notificationService: any,
    private analyticsService: any
  ) {
    this._eventEmitter = new EventEmitter();
  }

  // -----------------------------------------
  // GET AVAILABLE BENEFITS
  // -----------------------------------------

  async getAvailableBenefits(
    driverId: string
  ): Promise<DriverBenefitPackage[]> {
    // Get driver profile
    const driver = await this.getDriverProfile(driverId);

    // Get all active benefit packages
    const packages = await this.db.benefitPackage.findMany({
      where: { isActive: true },
      orderBy: { monthlyPrice: "asc" },
    });

    // Get driver's current enrollments
    const enrollments = await this.db.benefitEnrollment.findMany({
      where: { driverId },
    });
    const enrollmentMap = new Map(
      enrollments.map((e: any) => [e.packageId, e])
    );

    // Map to driver-specific packages
    const driverPackages: DriverBenefitPackage[] = packages.map((pkg: any) => {
      const eligibility = this.checkEligibility(driver, pkg);
      const enrollment = enrollmentMap.get(pkg.id);

      return {
        ...this.mapPackage(pkg),
        isEligible: eligibility.eligible,
        eligibilityReason: eligibility.reason,
        enrollment: enrollment ? this.mapEnrollment(enrollment) : undefined,
        isRecommended: this.isRecommended(driver, pkg),
      };
    });

    // Track view
    this.trackEvent(driverId, DRIVER_EVENTS.BENEFIT_VIEWED, {
      packageCount: driverPackages.length,
    });

    return driverPackages;
  }

  async getBenefitPackage(packageId: string): Promise<BenefitPackage | null> {
    const pkg = await this.db.benefitPackage.findUnique({
      where: { id: packageId },
    });
    return pkg ? this.mapPackage(pkg) : null;
  }

  // -----------------------------------------
  // ENROLLMENT
  // -----------------------------------------

  async enrollInBenefit(
    driverId: string,
    packageId: string,
    options?: EnrollmentOptions
  ): Promise<BenefitEnrollment> {
    // Get package
    const pkg = await this.db.benefitPackage.findUnique({
      where: { id: packageId },
    });
    if (!pkg) {
      throw new Error("Benefit package not found");
    }

    // Check eligibility
    const driver = await this.getDriverProfile(driverId);
    const eligibility = this.checkEligibility(driver, pkg);
    if (!eligibility.eligible) {
      throw new Error(`Not eligible: ${eligibility.reason}`);
    }

    // Check for existing enrollment
    const existing = await this.db.benefitEnrollment.findUnique({
      where: {
        driverId_packageId: { driverId, packageId },
      },
    });
    if (existing && existing.status === BenefitEnrollmentStatus.ACTIVE) {
      throw new Error("Already enrolled in this benefit");
    }

    // Calculate dates
    const now = new Date();
    const effectiveDate = new Date(now);
    effectiveDate.setDate(effectiveDate.getDate() + pkg.waitingPeriod);

    const expiryDate = this.calculateExpiryDate(
      effectiveDate,
      options?.billingCycle || BillingCycle.MONTHLY
    );

    // Process initial payment
    const amount = this.getPaymentAmount(pkg, options?.billingCycle);
    await this.processPayment(
      driverId,
      amount,
      `Benefit enrollment: ${pkg.name}`
    );

    // Create or update enrollment
    const enrollment = existing
      ? await this.db.benefitEnrollment.update({
          where: { id: existing.id },
          data: {
            status: BenefitEnrollmentStatus.ACTIVE,
            enrolledAt: now,
            effectiveDate,
            expiryDate,
            billingCycle: options?.billingCycle || BillingCycle.MONTHLY,
            lastPaymentAt: now,
            nextPaymentAt: expiryDate,
            autoRenew: options?.autoRenew ?? true,
            dependents: options?.dependents
              ? JSON.stringify(options.dependents)
              : null,
          },
        })
      : await this.db.benefitEnrollment.create({
          data: {
            driverId,
            packageId,
            status: BenefitEnrollmentStatus.ACTIVE,
            enrolledAt: now,
            effectiveDate,
            expiryDate,
            billingCycle: options?.billingCycle || BillingCycle.MONTHLY,
            lastPaymentAt: now,
            nextPaymentAt: expiryDate,
            autoRenew: options?.autoRenew ?? true,
            dependents: options?.dependents
              ? JSON.stringify(options.dependents)
              : null,
          },
        });

    // Generate policy number for insurance products
    if (
      pkg.benefitType.includes("INSURANCE") ||
      pkg.benefitType.includes("COVER")
    ) {
      await this.generatePolicyNumber(enrollment.id);
    }

    // Send notification
    await this.notificationService?.send({
      userId: driverId,
      title: "✅ Benefit Enrolled",
      body: `You're now enrolled in ${pkg.name}. Coverage starts ${effectiveDate.toDateString()}.`,
      data: { type: "benefit_enrolled", packageId },
    });

    // Track analytics
    this.trackEvent(driverId, DRIVER_EVENTS.BENEFIT_ENROLLED, {
      packageId,
      benefitType: pkg.benefitType,
      monthlyPrice: parseFloat(pkg.monthlyPrice),
      billingCycle: options?.billingCycle,
    });

    return this.mapEnrollment(enrollment);
  }

  async cancelEnrollment(
    driverId: string,
    enrollmentId: string
  ): Promise<boolean> {
    const enrollment = await this.db.benefitEnrollment.findFirst({
      where: { id: enrollmentId, driverId },
    });

    if (!enrollment) {
      throw new Error("Enrollment not found");
    }

    await this.db.benefitEnrollment.update({
      where: { id: enrollmentId },
      data: {
        status: BenefitEnrollmentStatus.CANCELLED,
        autoRenew: false,
      },
    });

    // Send notification
    await this.notificationService?.send({
      userId: driverId,
      title: "Benefit Cancelled",
      body: "Your benefit has been cancelled. Coverage ends at the end of the current period.",
      data: { type: "benefit_cancelled", enrollmentId },
    });

    return true;
  }

  async getEnrollments(driverId: string): Promise<BenefitEnrollment[]> {
    const enrollments = await this.db.benefitEnrollment.findMany({
      where: { driverId },
      include: { package: true },
    });

    return enrollments.map(this.mapEnrollment);
  }

  // -----------------------------------------
  // CLAIMS
  // -----------------------------------------

  async submitClaim(
    driverId: string,
    enrollmentId: string,
    claim: ClaimInput
  ): Promise<BenefitClaim> {
    // Verify enrollment
    const enrollment = await this.db.benefitEnrollment.findFirst({
      where: {
        id: enrollmentId,
        driverId,
        status: BenefitEnrollmentStatus.ACTIVE,
      },
      include: { package: true },
    });

    if (!enrollment) {
      throw new Error("Active enrollment not found");
    }

    // Verify effective date
    if (enrollment.effectiveDate > new Date()) {
      throw new Error("Coverage has not started yet");
    }

    // Verify incident date is within coverage period
    if (claim.incidentDate < enrollment.effectiveDate) {
      throw new Error("Incident occurred before coverage started");
    }

    // Create claim
    const newClaim = await this.db.benefitClaim.create({
      data: {
        enrollmentId,
        driverId,
        claimType: claim.claimType,
        description: claim.description,
        amount: claim.amount,
        currency: "NGN",
        documents: claim.documents,
        incidentDate: claim.incidentDate,
        status: ClaimStatus.SUBMITTED,
      },
    });

    // Send notification
    await this.notificationService?.send({
      userId: driverId,
      title: "📋 Claim Submitted",
      body: `Your claim for ₦${claim.amount.toLocaleString()} has been submitted. We'll review it shortly.`,
      data: { type: "claim_submitted", claimId: newClaim.id },
    });

    // Track analytics
    this.trackEvent(driverId, DRIVER_EVENTS.CLAIM_SUBMITTED, {
      enrollmentId,
      claimType: claim.claimType,
      amount: claim.amount,
    });

    return this.mapClaim(newClaim);
  }

  async getClaims(driverId: string): Promise<BenefitClaim[]> {
    const claims = await this.db.benefitClaim.findMany({
      where: { driverId },
      orderBy: { createdAt: "desc" },
    });

    return claims.map(this.mapClaim);
  }

  async getClaimDetails(
    driverId: string,
    claimId: string
  ): Promise<BenefitClaim | null> {
    const claim = await this.db.benefitClaim.findFirst({
      where: { id: claimId, driverId },
    });

    return claim ? this.mapClaim(claim) : null;
  }

  // Admin: Review claim
  async reviewClaim(
    claimId: string,
    reviewerId: string,
    approved: boolean,
    approvedAmount?: number,
    notes?: string
  ): Promise<BenefitClaim> {
    const existingClaim = await this.db.benefitClaim.findUnique({
      where: { id: claimId },
    });

    const claim = await this.db.benefitClaim.update({
      where: { id: claimId },
      data: {
        status: approved ? ClaimStatus.APPROVED : ClaimStatus.REJECTED,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        reviewNotes: notes,
        approvedAmount: approved ? approvedAmount || existingClaim.amount : null,
      },
    });

    // Notify driver
    await this.notificationService?.send({
      userId: claim.driverId,
      title: approved ? "✅ Claim Approved" : "❌ Claim Rejected",
      body: approved
        ? `Your claim has been approved for ₦${(approvedAmount || claim.amount).toLocaleString()}.`
        : `Your claim has been rejected. ${notes || "Contact support for details."}`,
      data: { type: "claim_reviewed", claimId, approved },
    });

    // If approved, process payout
    if (approved) {
      await this.processClaimPayout(claim.id);
    }

    return this.mapClaim(claim);
  }

  private async processClaimPayout(claimId: string): Promise<void> {
    const claim = await this.db.benefitClaim.findUnique({
      where: { id: claimId },
    });

    if (claim.status !== ClaimStatus.APPROVED) return;

    // Credit to driver wallet
    await this.paymentService?.creditWallet(
      claim.driverId,
      claim.approvedAmount,
      `Benefit claim payout: ${claim.claimType}`
    );

    // Update claim status
    await this.db.benefitClaim.update({
      where: { id: claimId },
      data: {
        status: ClaimStatus.PAID,
        paidAmount: claim.approvedAmount,
        paidAt: new Date(),
      },
    });

    // Notify driver
    await this.notificationService?.send({
      userId: claim.driverId,
      title: "💰 Claim Paid",
      body: `₦${claim.approvedAmount.toLocaleString()} has been credited to your wallet.`,
      data: { type: "claim_paid", claimId },
    });
  }

  // -----------------------------------------
  // FUEL DISCOUNT
  // -----------------------------------------

  async getFuelDiscount(driverId: string): Promise<FuelDiscount> {
    // Get or create fuel discount record
    let discount = await this.db.fuelDiscount.findUnique({
      where: { driverId },
    });

    if (!discount) {
      // Get driver's monthly trips
      const driver = await this.getDriverProfile(driverId);
      const tier = this.getFuelDiscountTier(driver.monthlyTrips);

      discount = await this.db.fuelDiscount.create({
        data: {
          driverId,
          discountTier: tier.name,
          discountPercent: tier.discount,
          monthlyLimit: tier.monthlyLimit,
          usedThisMonth: 0,
          totalSaved: 0,
          cardStatus: "pending",
        },
      });
    }

    return {
      id: discount.id,
      driverId: discount.driverId,
      discountTier: discount.discountTier,
      discountPercent: parseFloat(discount.discountPercent),
      monthlyLimit: parseFloat(discount.monthlyLimit),
      usedThisMonth: parseFloat(discount.usedThisMonth),
      totalSaved: parseFloat(discount.totalSaved),
      fuelCardNumber: discount.fuelCardNumber,
      cardStatus: discount.cardStatus,
    };
  }

  async getNearbyFuelStations(
    latitude: number,
    longitude: number,
    radius: number = 5
  ): Promise<FuelStation[]> {
    // Get partner stations near location
    const stations = await this.db.fuelStation.findMany({
      where: {
        isActive: true,
        latitude: {
          gte: latitude - 0.05, // ~5km
          lte: latitude + 0.05,
        },
        longitude: {
          gte: longitude - 0.05,
          lte: longitude + 0.05,
        },
      },
    });

    // Calculate actual distances and filter
    const stationsWithDistance = stations
      .map((station: any) => ({
        ...this.mapFuelStation(station),
        distance: this.calculateDistance(
          latitude,
          longitude,
          parseFloat(station.latitude),
          parseFloat(station.longitude)
        ),
      }))
      .filter((s: FuelStation) => (s.distance || 0) <= radius)
      .sort(
        (a: FuelStation, b: FuelStation) =>
          (a.distance || 0) - (b.distance || 0)
      );

    return stationsWithDistance;
  }

  async recordFuelTransaction(
    driverId: string,
    transaction: Omit<FuelTransaction, "id">
  ): Promise<FuelTransaction> {
    const discount = await this.getFuelDiscount(driverId);

    // Verify monthly limit
    if (
      discount.usedThisMonth + transaction.originalAmount >
      discount.monthlyLimit
    ) {
      throw new Error("Monthly fuel discount limit exceeded");
    }

    // Create transaction
    const newTransaction = await this.db.fuelTransaction.create({
      data: {
        discountId: discount.id,
        driverId,
        stationId: transaction.stationId,
        stationName: transaction.stationName,
        liters: transaction.liters,
        pricePerLiter: transaction.pricePerLiter,
        originalAmount: transaction.originalAmount,
        discountAmount: transaction.discountAmount,
        finalAmount: transaction.finalAmount,
        currency: transaction.currency,
        transactionRef: `FUEL-${Date.now()}`,
        transactedAt: transaction.transactedAt,
      },
    });

    // Update discount usage
    await this.db.fuelDiscount.update({
      where: { id: discount.id },
      data: {
        usedThisMonth: { increment: transaction.originalAmount },
        totalSaved: { increment: transaction.discountAmount },
      },
    });

    // Track analytics
    this.trackEvent(driverId, DRIVER_EVENTS.FUEL_DISCOUNT_USED, {
      stationId: transaction.stationId,
      liters: transaction.liters,
      discountAmount: transaction.discountAmount,
    });

    return {
      id: newTransaction.id,
      stationId: newTransaction.stationId,
      stationName: newTransaction.stationName,
      liters: parseFloat(newTransaction.liters),
      pricePerLiter: parseFloat(newTransaction.pricePerLiter),
      originalAmount: parseFloat(newTransaction.originalAmount),
      discountAmount: parseFloat(newTransaction.discountAmount),
      finalAmount: parseFloat(newTransaction.finalAmount),
      currency: newTransaction.currency,
      transactedAt: newTransaction.transactedAt,
    };
  }

  async getFuelTransactions(
    driverId: string,
    limit: number = 20
  ): Promise<FuelTransaction[]> {
    const transactions = await this.db.fuelTransaction.findMany({
      where: { driverId },
      orderBy: { transactedAt: "desc" },
      take: limit,
    });

    return transactions.map((t: any) => ({
      id: t.id,
      stationId: t.stationId,
      stationName: t.stationName,
      liters: parseFloat(t.liters),
      pricePerLiter: parseFloat(t.pricePerLiter),
      originalAmount: parseFloat(t.originalAmount),
      discountAmount: parseFloat(t.discountAmount),
      finalAmount: parseFloat(t.finalAmount),
      currency: t.currency,
      transactedAt: t.transactedAt,
    }));
  }

  async updateFuelDiscountTier(driverId: string): Promise<FuelDiscount> {
    const driver = await this.getDriverProfile(driverId);
    const tier = this.getFuelDiscountTier(driver.monthlyTrips);

    const discount = await this.db.fuelDiscount.update({
      where: { driverId },
      data: {
        discountTier: tier.name,
        discountPercent: tier.discount,
        monthlyLimit: tier.monthlyLimit,
      },
    });

    return {
      id: discount.id,
      driverId: discount.driverId,
      discountTier: discount.discountTier,
      discountPercent: parseFloat(discount.discountPercent),
      monthlyLimit: parseFloat(discount.monthlyLimit),
      usedThisMonth: parseFloat(discount.usedThisMonth),
      totalSaved: parseFloat(discount.totalSaved),
      fuelCardNumber: discount.fuelCardNumber,
      cardStatus: discount.cardStatus,
    };
  }

  // Reset monthly fuel usage (run at start of each month)
  async resetMonthlyFuelUsage(): Promise<void> {
    await this.db.fuelDiscount.updateMany({
      data: { usedThisMonth: 0 },
    });
  }

  // -----------------------------------------
  // RENEWAL PROCESSING
  // -----------------------------------------

  async processRenewals(): Promise<void> {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get enrollments expiring soon
    const expiringEnrollments = await this.db.benefitEnrollment.findMany({
      where: {
        status: BenefitEnrollmentStatus.ACTIVE,
        autoRenew: true,
        expiryDate: {
          gte: now,
          lt: tomorrow,
        },
      },
      include: { package: true },
    });

    for (const enrollment of expiringEnrollments) {
      try {
        await this.renewEnrollment(enrollment);
      } catch (error) {
        console.error(`Failed to renew enrollment ${enrollment.id}:`, error);

        // Suspend enrollment if renewal fails
        await this.db.benefitEnrollment.update({
          where: { id: enrollment.id },
          data: { status: BenefitEnrollmentStatus.SUSPENDED },
        });

        // Notify driver
        await this.notificationService?.send({
          userId: enrollment.driverId,
          title: "⚠️ Benefit Renewal Failed",
          body: `Unable to renew ${enrollment.package.name}. Please update your payment method.`,
          data: { type: "renewal_failed", enrollmentId: enrollment.id },
        });
      }
    }
  }

  private async renewEnrollment(enrollment: any): Promise<void> {
    const amount = this.getPaymentAmount(
      enrollment.package,
      enrollment.billingCycle
    );

    // Process payment
    await this.processPayment(
      enrollment.driverId,
      amount,
      `Benefit renewal: ${enrollment.package.name}`
    );

    // Update enrollment
    const newExpiryDate = this.calculateExpiryDate(
      enrollment.expiryDate,
      enrollment.billingCycle
    );

    await this.db.benefitEnrollment.update({
      where: { id: enrollment.id },
      data: {
        lastPaymentAt: new Date(),
        nextPaymentAt: newExpiryDate,
        expiryDate: newExpiryDate,
      },
    });

    // Notify driver
    await this.notificationService?.send({
      userId: enrollment.driverId,
      title: "✅ Benefit Renewed",
      body: `${enrollment.package.name} has been renewed. Next renewal: ${newExpiryDate.toDateString()}`,
      data: { type: "benefit_renewed", enrollmentId: enrollment.id },
    });
  }

  // -----------------------------------------
  // HELPER METHODS
  // -----------------------------------------

  private async getDriverProfile(
    driverId: string
  ): Promise<DriverProfileForBenefits> {
    const profile = await this.db.driverProfile.findUnique({
      where: { driverId },
    });

    // Get monthly trips
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthlyTrips = await this.db.tripEarning.count({
      where: {
        driverId,
        completedAt: { gte: startOfMonth },
      },
    });

    // Get tenure
    const driver = await this.db.driver.findUnique({
      where: { id: driverId },
      select: { createdAt: true, vehicleType: true },
    });

    const tenureDays = driver
      ? Math.floor(
          (Date.now() - driver.createdAt.getTime()) / (1000 * 60 * 60 * 24)
        )
      : 0;

    return {
      driverId,
      tier: profile?.currentTier || "STARTER",
      lifetimeTrips: profile?.lifetimeTrips || 0,
      monthlyTrips,
      tenureDays,
      vehicleType: driver?.vehicleType || "SEDAN",
    };
  }

  private checkEligibility(
    driver: DriverProfileForBenefits,
    pkg: any
  ): { eligible: boolean; reason?: string } {
    // Check minimum trips
    if (pkg.minTrips && driver.lifetimeTrips < pkg.minTrips) {
      return {
        eligible: false,
        reason: `Requires ${pkg.minTrips} lifetime trips (you have ${driver.lifetimeTrips})`,
      };
    }

    // Check minimum tier
    if (pkg.minTier) {
      const tierOrder = [
        "STARTER",
        "BRONZE",
        "SILVER",
        "GOLD",
        "PLATINUM",
        "DIAMOND",
      ];
      const driverTierIndex = tierOrder.indexOf(driver.tier);
      const requiredTierIndex = tierOrder.indexOf(pkg.minTier);

      if (driverTierIndex < requiredTierIndex) {
        return {
          eligible: false,
          reason: `Requires ${pkg.minTier} tier or higher`,
        };
      }
    }

    // Check minimum tenure
    if (pkg.minTenure && driver.tenureDays < pkg.minTenure) {
      return {
        eligible: false,
        reason: `Requires ${pkg.minTenure} days as a driver`,
      };
    }

    return { eligible: true };
  }

  private isRecommended(driver: DriverProfileForBenefits, pkg: any): boolean {
    // Recommend based on driver profile
    switch (pkg.benefitType as BenefitType) {
      case BenefitType.HEALTH_BASIC:
        return driver.lifetimeTrips >= 100 && driver.lifetimeTrips < 500;
      case BenefitType.HEALTH_FAMILY:
        return driver.lifetimeTrips >= 500;
      case BenefitType.VEHICLE_INSURANCE:
        return true; // Always recommended
      case BenefitType.ACCIDENT_COVER:
        return driver.lifetimeTrips >= 50;
      default:
        return false;
    }
  }

  private getFuelDiscountTier(monthlyTrips: number): {
    name: string;
    discount: number;
    monthlyLimit: number;
  } {
    if (monthlyTrips >= 2000) {
      return { name: "diamond", ...FUEL_DISCOUNT_TIERS.diamond };
    }
    if (monthlyTrips >= 1000) {
      return { name: "platinum", ...FUEL_DISCOUNT_TIERS.platinum };
    }
    if (monthlyTrips >= 500) {
      return { name: "gold", ...FUEL_DISCOUNT_TIERS.gold };
    }
    if (monthlyTrips >= 300) {
      return { name: "silver", ...FUEL_DISCOUNT_TIERS.silver };
    }
    if (monthlyTrips >= 100) {
      return { name: "bronze", ...FUEL_DISCOUNT_TIERS.bronze };
    }
    return { name: "starter", ...FUEL_DISCOUNT_TIERS.starter };
  }

  private getPaymentAmount(pkg: any, billingCycle?: BillingCycle): number {
    const monthlyPrice = parseFloat(pkg.monthlyPrice);

    switch (billingCycle) {
      case BillingCycle.QUARTERLY:
        return monthlyPrice * 3 * 0.95; // 5% discount
      case BillingCycle.ANNUALLY:
        return pkg.annualPrice
          ? parseFloat(pkg.annualPrice)
          : monthlyPrice * 12 * 0.85; // 15% discount
      default:
        return monthlyPrice;
    }
  }

  private calculateExpiryDate(
    startDate: Date,
    billingCycle: BillingCycle
  ): Date {
    const expiry = new Date(startDate);

    switch (billingCycle) {
      case BillingCycle.QUARTERLY:
        expiry.setMonth(expiry.getMonth() + 3);
        break;
      case BillingCycle.ANNUALLY:
        expiry.setFullYear(expiry.getFullYear() + 1);
        break;
      default:
        expiry.setMonth(expiry.getMonth() + 1);
    }

    return expiry;
  }

  private async generatePolicyNumber(enrollmentId: string): Promise<string> {
    const policyNumber = `UBI-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    await this.db.benefitEnrollment.update({
      where: { id: enrollmentId },
      data: { policyNumber },
    });

    return policyNumber;
  }

  private async processPayment(
    driverId: string,
    amount: number,
    description: string
  ): Promise<void> {
    // Debit from driver wallet
    await this.paymentService?.debitWallet(driverId, amount, description);
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
    return Math.round(R * c * 10) / 10;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  // Mappers
  private mapPackage(pkg: any): BenefitPackage {
    return {
      id: pkg.id,
      name: pkg.name,
      description: pkg.description,
      benefitType: pkg.benefitType as BenefitType,
      provider: pkg.provider,
      coverageItems: pkg.coverageItems,
      exclusions: pkg.exclusions,
      waitingPeriod: pkg.waitingPeriod,
      monthlyPrice: parseFloat(pkg.monthlyPrice),
      annualPrice: pkg.annualPrice ? parseFloat(pkg.annualPrice) : undefined,
      currency: pkg.currency,
      minTrips: pkg.minTrips,
      minTier: pkg.minTier,
      minTenure: pkg.minTenure,
      termsUrl: pkg.termsUrl,
      claimProcess: pkg.claimProcess,
      supportContact: pkg.supportContact,
      isActive: pkg.isActive,
    };
  }

  private mapEnrollment(enrollment: any): BenefitEnrollment {
    return {
      id: enrollment.id,
      driverId: enrollment.driverId,
      packageId: enrollment.packageId,
      status: enrollment.status as BenefitEnrollmentStatus,
      enrolledAt: enrollment.enrolledAt,
      effectiveDate: enrollment.effectiveDate,
      expiryDate: enrollment.expiryDate,
      billingCycle: enrollment.billingCycle as BillingCycle,
      lastPaymentAt: enrollment.lastPaymentAt,
      nextPaymentAt: enrollment.nextPaymentAt,
      autoRenew: enrollment.autoRenew,
      dependents: enrollment.dependents
        ? JSON.parse(enrollment.dependents)
        : undefined,
      policyNumber: enrollment.policyNumber,
      policyDocument: enrollment.policyDocument,
    };
  }

  private mapClaim(claim: any): BenefitClaim {
    return {
      id: claim.id,
      enrollmentId: claim.enrollmentId,
      driverId: claim.driverId,
      claimType: claim.claimType,
      description: claim.description,
      amount: parseFloat(claim.amount),
      currency: claim.currency,
      documents: claim.documents,
      incidentDate: claim.incidentDate,
      status: claim.status as ClaimStatus,
      reviewedBy: claim.reviewedBy,
      reviewedAt: claim.reviewedAt,
      reviewNotes: claim.reviewNotes,
      approvedAmount: claim.approvedAmount
        ? parseFloat(claim.approvedAmount)
        : undefined,
      paidAmount: claim.paidAmount ? parseFloat(claim.paidAmount) : undefined,
      paidAt: claim.paidAt,
    };
  }

  private mapFuelStation(station: any): FuelStation {
    return {
      id: station.id,
      name: station.name,
      brand: station.brand,
      address: station.address,
      city: station.city,
      latitude: parseFloat(station.latitude),
      longitude: parseFloat(station.longitude),
      discountPercent: parseFloat(station.discountPercent),
      amenities: station.amenities,
      operatingHours: station.operatingHours,
      is24Hours: station.is24Hours,
    };
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
}

// -----------------------------------------
// SUPPORTING TYPES
// -----------------------------------------

interface DriverProfileForBenefits {
  driverId: string;
  tier: string;
  lifetimeTrips: number;
  monthlyTrips: number;
  tenureDays: number;
  vehicleType: string;
}
