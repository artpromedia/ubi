/**
 * Settlement Service
 *
 * Handles settlements to merchants, restaurants, and partners:
 * - Daily restaurant settlements
 * - Weekly merchant settlements
 * - Monthly partner payouts
 * - Commission deductions
 * - Settlement batching
 *
 * Settlement Types:
 * 1. Restaurant - Food delivery orders
 * 2. Merchant - Retail/service transactions
 * 3. Partner - Fleet operators, franchise partners
 *
 * Commission Structure:
 * - Restaurant: UBI 20%, CEERION 1% (5% of UBI's cut)
 * - Merchant: UBI 3%, CEERION 0.15% (5% of UBI's cut)
 * - Ride (Driver): UBI 15%, CEERION 0.75% (5% of UBI's cut)
 */

import { Currency, PaymentProvider, PrismaClient } from "@prisma/client";

export interface SettlementConfig {
  // Settlement schedules
  restaurantSettlementHour: number; // Hour to run daily settlement (0-23)
  merchantSettlementDay: number; // Day of week for merchant settlement (0-6)
  partnerSettlementDay: number; // Day of month for partner settlement (1-28)

  // Minimum thresholds
  restaurantMinimumSettlement: number; // Min amount to trigger settlement
  merchantMinimumSettlement: number;
  partnerMinimumSettlement: number;

  // Fees
  settlementFeePercent: number; // Processing fee
  settlementFeeFixed: number; // Fixed fee per settlement
}

export interface SettlementRequest {
  recipientId: string;
  recipientType: "RESTAURANT" | "MERCHANT" | "PARTNER" | "DRIVER";
  amount: number;
  currency: Currency;
  paymentMethod: "bank_transfer" | "mobile_money";
  bankDetails?: {
    accountNumber: string;
    bankCode: string;
    accountName: string;
  };
  mobileMoneyDetails?: {
    phoneNumber: string;
    provider: PaymentProvider;
  };
}

export interface SettlementResult {
  settlementId: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  grossAmount: number;
  commission: number;
  fee: number;
  netAmount: number;
  estimatedArrival?: Date;
}

export interface CommissionBreakdown {
  grossAmount: number;
  ubiCommissionPercent: number;
  ubiCommission: number;
  ceerionCommissionPercent: number;
  ceerionCommission: number;
  totalCommission: number;
  settlementFee: number;
  netAmount: number;
}

export class SettlementService {
  private config: SettlementConfig = {
    restaurantSettlementHour: 6, // 6 AM
    merchantSettlementDay: 1, // Monday
    partnerSettlementDay: 1, // 1st of month

    restaurantMinimumSettlement: 5000, // ₦5,000 / KES 5,000
    merchantMinimumSettlement: 10000, // ₦10,000 / KES 10,000
    partnerMinimumSettlement: 50000, // ₦50,000 / KES 50,000

    settlementFeePercent: 0.5, // 0.5% processing fee
    settlementFeeFixed: 100, // ₦100 / KES 100 fixed fee
  };

  // Commission rates by recipient type
  private commissionRates: Record<
    string,
    { ubiPercent: number; ceerionPercent: number }
  > = {
    RESTAURANT: { ubiPercent: 20, ceerionPercent: 1 }, // UBI 20%, CEERION 1%
    MERCHANT: { ubiPercent: 3, ceerionPercent: 0.15 }, // UBI 3%, CEERION 0.15%
    PARTNER: { ubiPercent: 10, ceerionPercent: 0.5 }, // UBI 10%, CEERION 0.5%
    DRIVER: { ubiPercent: 15, ceerionPercent: 0.75 }, // UBI 15%, CEERION 0.75%
  };

  constructor(private prisma: PrismaClient) {}

  /**
   * Calculate commission breakdown for a settlement
   */
  calculateCommission(
    grossAmount: number,
    recipientType: "RESTAURANT" | "MERCHANT" | "PARTNER" | "DRIVER"
  ): CommissionBreakdown {
    const rates = this.commissionRates[recipientType];

    const ubiCommission = grossAmount * (rates.ubiPercent / 100);
    const ceerionCommission = grossAmount * (rates.ceerionPercent / 100);
    const totalCommission = ubiCommission + ceerionCommission;

    const settlementFee =
      grossAmount * (this.config.settlementFeePercent / 100) +
      this.config.settlementFeeFixed;

    const netAmount = grossAmount - totalCommission - settlementFee;

    return {
      grossAmount,
      ubiCommissionPercent: rates.ubiPercent,
      ubiCommission: Math.round(ubiCommission * 100) / 100,
      ceerionCommissionPercent: rates.ceerionPercent,
      ceerionCommission: Math.round(ceerionCommission * 100) / 100,
      totalCommission: Math.round(totalCommission * 100) / 100,
      settlementFee: Math.round(settlementFee * 100) / 100,
      netAmount: Math.round(netAmount * 100) / 100,
    };
  }

  /**
   * Create a settlement for a recipient
   */
  async createSettlement(
    request: SettlementRequest
  ): Promise<SettlementResult> {
    // Calculate commission
    const commission = this.calculateCommission(
      request.amount,
      request.recipientType
    );

    // Create settlement record
    const settlement = await this.prisma.settlement.create({
      data: {
        recipientId: request.recipientId,
        recipientType: request.recipientType,
        currency: request.currency,
        grossAmount: request.amount,
        ubiCommission: commission.ubiCommission,
        ceerionCommission: commission.ceerionCommission,
        settlementFee: commission.settlementFee,
        netAmount: commission.netAmount,
        paymentMethod: request.paymentMethod,
        bankDetails: request.bankDetails,
        mobileMoneyDetails: request.mobileMoneyDetails,
        status: "PENDING",
      },
    });

    // Create commission ledger entries
    await this.recordCommission(
      settlement.id,
      commission,
      request.currency,
      request.recipientType
    );

    return {
      settlementId: settlement.id,
      status: "PENDING",
      grossAmount: request.amount,
      commission: commission.totalCommission,
      fee: commission.settlementFee,
      netAmount: commission.netAmount,
    };
  }

  /**
   * Record commission entries in ledger
   */
  private async recordCommission(
    settlementId: string,
    commission: CommissionBreakdown,
    currency: Currency,
    recipientType: string
  ): Promise<void> {
    // Get UBI revenue and CEERION accounts
    const [ubiRevenue, ceerionAccount] = await Promise.all([
      this.prisma.walletAccount.findFirst({
        where: { accountType: "UBI_REVENUE", currency },
      }),
      this.prisma.walletAccount.findFirst({
        where: { accountType: "CEERION_REVENUE", currency },
      }),
    ]);

    if (!ubiRevenue || !ceerionAccount) {
      throw new Error(`Revenue accounts not found for ${currency}`);
    }

    // Create ledger entries for commission
    await this.prisma.$transaction([
      // UBI Commission
      this.prisma.ledgerEntry.create({
        data: {
          accountId: ubiRevenue.id,
          type: "CREDIT",
          amount: commission.ubiCommission,
          currency,
          description: `${recipientType} commission - Settlement ${settlementId}`,
          reference: settlementId,
          metadata: {
            settlementId,
            recipientType,
            commissionPercent: commission.ubiCommissionPercent,
          },
        },
      }),

      // CEERION Commission
      this.prisma.ledgerEntry.create({
        data: {
          accountId: ceerionAccount.id,
          type: "CREDIT",
          amount: commission.ceerionCommission,
          currency,
          description: `${recipientType} commission - Settlement ${settlementId}`,
          reference: settlementId,
          metadata: {
            settlementId,
            recipientType,
            commissionPercent: commission.ceerionCommissionPercent,
          },
        },
      }),

      // Update UBI revenue balance
      this.prisma.walletAccount.update({
        where: { id: ubiRevenue.id },
        data: { balance: { increment: commission.ubiCommission } },
      }),

      // Update CEERION balance
      this.prisma.walletAccount.update({
        where: { id: ceerionAccount.id },
        data: { balance: { increment: commission.ceerionCommission } },
      }),
    ]);
  }

  /**
   * Process pending settlements in batch
   */
  async processSettlementBatch(batchSize: number = 50): Promise<{
    processed: number;
    successful: number;
    failed: number;
  }> {
    const pendingSettlements = await this.prisma.settlement.findMany({
      where: { status: "PENDING" },
      take: batchSize,
      orderBy: { createdAt: "asc" },
    });

    const results = {
      processed: pendingSettlements.length,
      successful: 0,
      failed: 0,
    };

    for (const settlement of pendingSettlements) {
      try {
        await this.processSettlement(settlement.id);
        results.successful++;
      } catch (error) {
        console.error(`Settlement ${settlement.id} failed:`, error);
        results.failed++;
      }
    }

    return results;
  }

  /**
   * Process a single settlement
   */
  async processSettlement(settlementId: string): Promise<void> {
    const settlement = await this.prisma.settlement.findUnique({
      where: { id: settlementId },
    });

    if (!settlement) {
      throw new Error("Settlement not found");
    }

    if (settlement.status !== "PENDING") {
      throw new Error(`Settlement is ${settlement.status}, cannot process`);
    }

    // Mark as processing
    await this.prisma.settlement.update({
      where: { id: settlementId },
      data: { status: "PROCESSING" },
    });

    try {
      // Initiate payout based on payment method
      let providerReference: string;

      if (settlement.paymentMethod === "mobile_money") {
        const momoDetails = settlement.mobileMoneyDetails as any;
        providerReference = await this.initiateMobileMoneyPayout(
          settlement,
          momoDetails
        );
      } else {
        const bankDetails = settlement.bankDetails as any;
        providerReference = await this.initiateBankTransfer(
          settlement,
          bankDetails
        );
      }

      // Update settlement with provider reference
      await this.prisma.settlement.update({
        where: { id: settlementId },
        data: {
          providerReference,
          status: "PROCESSING",
        },
      });
    } catch (error) {
      // Mark as failed
      await this.prisma.settlement.update({
        where: { id: settlementId },
        data: {
          status: "FAILED",
          failureReason:
            error instanceof Error ? error.message : "Unknown error",
        },
      });

      throw error;
    }
  }

  /**
   * Initiate mobile money payout
   */
  private async initiateMobileMoneyPayout(
    settlement: any,
    momoDetails: { phoneNumber: string; provider: PaymentProvider }
  ): Promise<string> {
    // Use the appropriate provider
    switch (momoDetails.provider) {
      case PaymentProvider.MPESA:
        // M-Pesa B2C
        return `MPESA_SETTLEMENT_${settlement.id}`;

      case PaymentProvider.MTN_MOMO_GH:
      case PaymentProvider.MTN_MOMO_RW:
      case PaymentProvider.MTN_MOMO_UG:
        // MTN MoMo Disbursement
        return `MOMO_SETTLEMENT_${settlement.id}`;

      default:
        throw new Error(
          `Unsupported mobile money provider: ${momoDetails.provider}`
        );
    }
  }

  /**
   * Initiate bank transfer payout
   */
  private async initiateBankTransfer(
    settlement: any,
    bankDetails: {
      accountNumber: string;
      bankCode: string;
      accountName: string;
    }
  ): Promise<string> {
    // Use Paystack for bank transfers
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      throw new Error("Paystack not configured for bank transfers");
    }

    // Create transfer recipient
    const recipientResponse = await fetch(
      "https://api.paystack.co/transferrecipient",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "nuban",
          name: bankDetails.accountName,
          account_number: bankDetails.accountNumber,
          bank_code: bankDetails.bankCode,
          currency: settlement.currency,
        }),
      }
    );

    const recipientData = await recipientResponse.json();
    if (!recipientData.status) {
      throw new Error(`Failed to create recipient: ${recipientData.message}`);
    }

    // Initiate transfer
    const transferResponse = await fetch("https://api.paystack.co/transfer", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: "balance",
        amount: Math.round(Number(settlement.netAmount) * 100), // Convert to kobo
        recipient: recipientData.data.recipient_code,
        reason: `Settlement ${settlement.id}`,
        reference: `SETTLEMENT_${settlement.id}`,
      }),
    });

    const transferData = await transferResponse.json();
    if (!transferData.status) {
      throw new Error(`Failed to initiate transfer: ${transferData.message}`);
    }

    return transferData.data.transfer_code;
  }

  /**
   * Complete a settlement (called by webhook)
   */
  async completeSettlement(
    settlementId: string,
    providerReference?: string
  ): Promise<void> {
    const settlement = await this.prisma.settlement.findUnique({
      where: { id: settlementId },
    });

    if (!settlement) {
      throw new Error("Settlement not found");
    }

    if (settlement.status === "COMPLETED") {
      return; // Already completed
    }

    await this.prisma.settlement.update({
      where: { id: settlementId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        providerReference: providerReference || settlement.providerReference,
      },
    });

    console.log(`Settlement ${settlementId} completed successfully`);
  }

  /**
   * Fail a settlement
   */
  async failSettlement(settlementId: string, reason: string): Promise<void> {
    await this.prisma.settlement.update({
      where: { id: settlementId },
      data: {
        status: "FAILED",
        failureReason: reason,
      },
    });
  }

  /**
   * Run daily restaurant settlements
   */
  async runDailyRestaurantSettlements(
    date: Date,
    currency: Currency
  ): Promise<{
    restaurantsSettled: number;
    totalAmount: number;
    totalCommission: number;
  }> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Get all restaurants with orders from the day
    const restaurantOrders = await this.prisma.order.groupBy({
      by: ["restaurantId"],
      where: {
        status: "DELIVERED",
        currency,
        deliveredAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
        settlementId: null, // Not yet settled
      },
      _sum: {
        subtotal: true,
      },
    });

    const results = {
      restaurantsSettled: 0,
      totalAmount: 0,
      totalCommission: 0,
    };

    for (const orderGroup of restaurantOrders) {
      const grossAmount = Number(orderGroup._sum.subtotal) || 0;

      // Skip if below minimum
      if (grossAmount < this.config.restaurantMinimumSettlement) {
        continue;
      }

      // Get restaurant details
      const restaurant = await this.prisma.restaurant.findUnique({
        where: { id: orderGroup.restaurantId },
        include: {
          bankDetails: true,
        },
      });

      if (!restaurant) continue;

      // Create settlement
      const settlementResult = await this.createSettlement({
        recipientId: restaurant.id,
        recipientType: "RESTAURANT",
        amount: grossAmount,
        currency,
        paymentMethod: restaurant.preferredPayoutMethod || "bank_transfer",
        bankDetails: restaurant.bankDetails
          ? {
              accountNumber: restaurant.bankDetails.accountNumber,
              bankCode: restaurant.bankDetails.bankCode,
              accountName: restaurant.bankDetails.accountName,
            }
          : undefined,
      });

      // Link orders to settlement
      await this.prisma.order.updateMany({
        where: {
          restaurantId: restaurant.id,
          status: "DELIVERED",
          currency,
          deliveredAt: {
            gte: startOfDay,
            lte: endOfDay,
          },
          settlementId: null,
        },
        data: {
          settlementId: settlementResult.settlementId,
        },
      });

      results.restaurantsSettled++;
      results.totalAmount += grossAmount;
      results.totalCommission += settlementResult.commission;
    }

    console.log(
      `[Settlement] Daily restaurant settlements: ${results.restaurantsSettled} restaurants, ${currency} ${results.totalAmount} total`
    );

    return results;
  }

  /**
   * Get settlement history for a recipient
   */
  async getSettlementHistory(
    recipientId: string,
    options?: {
      limit?: number;
      offset?: number;
      status?: string;
      startDate?: Date;
      endDate?: Date;
    }
  ): Promise<any[]> {
    const where: any = {
      recipientId,
    };

    if (options?.status) {
      where.status = options.status;
    }

    if (options?.startDate || options?.endDate) {
      where.createdAt = {};
      if (options.startDate) {
        where.createdAt.gte = options.startDate;
      }
      if (options.endDate) {
        where.createdAt.lte = options.endDate;
      }
    }

    return await this.prisma.settlement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: options?.limit || 50,
      skip: options?.offset || 0,
    });
  }

  /**
   * Get settlement summary for a date range
   */
  async getSettlementSummary(
    startDate: Date,
    endDate: Date,
    recipientType?: string
  ): Promise<{
    totalSettlements: number;
    completedSettlements: number;
    pendingSettlements: number;
    failedSettlements: number;
    totalGrossAmount: number;
    totalCommission: number;
    totalNetAmount: number;
    byRecipientType: Record<
      string,
      {
        count: number;
        grossAmount: number;
        commission: number;
        netAmount: number;
      }
    >;
  }> {
    const where: any = {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (recipientType) {
      where.recipientType = recipientType;
    }

    const settlements = await this.prisma.settlement.findMany({
      where,
    });

    const summary = {
      totalSettlements: settlements.length,
      completedSettlements: 0,
      pendingSettlements: 0,
      failedSettlements: 0,
      totalGrossAmount: 0,
      totalCommission: 0,
      totalNetAmount: 0,
      byRecipientType: {} as Record<
        string,
        {
          count: number;
          grossAmount: number;
          commission: number;
          netAmount: number;
        }
      >,
    };

    for (const settlement of settlements) {
      // Count by status
      if (settlement.status === "COMPLETED") {
        summary.completedSettlements++;
      } else if (
        settlement.status === "PENDING" ||
        settlement.status === "PROCESSING"
      ) {
        summary.pendingSettlements++;
      } else {
        summary.failedSettlements++;
      }

      // Sum amounts
      summary.totalGrossAmount += Number(settlement.grossAmount);
      summary.totalCommission +=
        Number(settlement.ubiCommission) + Number(settlement.ceerionCommission);
      summary.totalNetAmount += Number(settlement.netAmount);

      // Group by recipient type
      if (!summary.byRecipientType[settlement.recipientType]) {
        summary.byRecipientType[settlement.recipientType] = {
          count: 0,
          grossAmount: 0,
          commission: 0,
          netAmount: 0,
        };
      }

      summary.byRecipientType[settlement.recipientType].count++;
      summary.byRecipientType[settlement.recipientType].grossAmount += Number(
        settlement.grossAmount
      );
      summary.byRecipientType[settlement.recipientType].commission +=
        Number(settlement.ubiCommission) + Number(settlement.ceerionCommission);
      summary.byRecipientType[settlement.recipientType].netAmount += Number(
        settlement.netAmount
      );
    }

    return summary;
  }

  /**
   * Retry a failed settlement
   */
  async retrySettlement(settlementId: string): Promise<void> {
    const settlement = await this.prisma.settlement.findUnique({
      where: { id: settlementId },
    });

    if (!settlement) {
      throw new Error("Settlement not found");
    }

    if (settlement.status !== "FAILED") {
      throw new Error(`Settlement is ${settlement.status}, cannot retry`);
    }

    // Reset status to pending
    await this.prisma.settlement.update({
      where: { id: settlementId },
      data: {
        status: "PENDING",
        failureReason: null,
      },
    });

    // Process the settlement
    await this.processSettlement(settlementId);
  }
}
