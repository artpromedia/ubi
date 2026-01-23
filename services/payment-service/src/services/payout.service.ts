/**
 * Driver Payout Service
 *
 * Handles driver earnings and instant cashout:
 * - Instant cashout (M-Pesa B2C, MTN MoMo disbursement)
 * - Weekly automatic batch payouts
 * - Commission calculation (UBI + CEERION)
 * - Payout approval workflow
 * - Transaction fee deduction
 *
 * Flow:
 * 1. Driver completes ride → Earnings credited to DRIVER_WALLET
 * 2. Driver requests cashout → Create payout record
 * 3. Fraud check → Risk assessment
 * 4. Initiate payout → M-Pesa B2C / MoMo transfer
 * 5. Webhook received → Mark as completed
 * 6. Debit DRIVER_WALLET → Credit UBI_FLOAT
 *
 * Commission Structure:
 * - UBI takes 15% commission
 * - CEERION takes 5% of UBI's commission (0.75% of total)
 * - Driver receives 85% of ride fare
 *
 * Example: ₦1,000 ride
 * - Driver: ₦850
 * - UBI: ₦150 (15%)
 * - CEERION: ₦7.50 (0.75% of total, 5% of UBI's cut)
 */

import {
  Currency,
  PaymentProvider,
  PayoutStatus,
  PrismaClient,
} from "@prisma/client";
import { payoutLogger } from "../lib/logger";
import { MoMoService } from "../providers/momo.service";
import { MpesaService } from "../providers/mpesa.service";
import { PaystackService } from "../providers/paystack.service";
import { WalletService } from "./wallet.service";

export interface CashoutRequest {
  userId: string; // User ID (driver or merchant)
  driverId?: string; // Optional driver ID if applicable
  merchantId?: string; // Optional merchant ID if applicable
  amount: number;
  currency: Currency;
  paymentMethod: "mobile_money" | "bank_transfer";
  phoneNumber?: string; // Required for mobile money
  bankAccount?: {
    accountNumber: string;
    bankCode: string;
    accountName: string;
  };
  reason?: string;
  metadata?: Record<string, any>; // Additional metadata for the cashout
}

export interface CreatePayoutRequest {
  driverId: string;
  amount: number;
  currency: Currency;
  paymentMethod: "mobile_money" | "bank_transfer";
  phoneNumber?: string; // Required for mobile money
  bankAccount?: {
    accountNumber: string;
    bankCode: string;
    accountName: string;
  };
  reason?: string;
}

export interface PayoutResult {
  payoutId: string;
  status: PayoutStatus;
  amount: number;
  fee: number;
  netAmount: number;
  estimatedArrival?: Date;
}

export interface PayoutConfig {
  // Instant cashout limits
  minAmount: number; // Minimum cashout amount
  maxAmountPerDay: number; // Max daily cashout per driver
  maxAmountPerTransaction: number; // Max per transaction

  // Fees
  instantCashoutFeePercent: number; // 2% instant cashout fee
  instantCashoutFeeFixed: number; // Fixed fee per transaction

  // Weekly payout
  weeklyPayoutDay: number; // 0 = Sunday, 6 = Saturday
  weeklyPayoutMinimum: number; // Minimum balance for automatic payout

  // Approval thresholds
  autoApprovalLimit: number; // Auto-approve below this amount
  manualReviewLimit: number; // Require manual review above this
}

export class PayoutService {
  private walletService: WalletService;

  private config: PayoutConfig = {
    minAmount: 100, // Min ₦100 / KES 100
    maxAmountPerDay: 50000, // Max ₦50,000 / KES 50,000 per day
    maxAmountPerTransaction: 20000, // Max ₦20,000 / KES 20,000 per transaction
    instantCashoutFeePercent: 2, // 2% fee
    instantCashoutFeeFixed: 50, // ₦50 / KES 50 fixed fee
    weeklyPayoutDay: 5, // Friday
    weeklyPayoutMinimum: 1000, // Min ₦1,000 for automatic payout
    autoApprovalLimit: 10000, // Auto-approve below ₦10,000
    manualReviewLimit: 50000, // Manual review above ₦50,000
  };

  constructor(private prisma: PrismaClient) {
    this.walletService = new WalletService(prisma);
  }

  /**
   * Calculate payout fee
   */
  private calculatePayoutFee(amount: number, isInstant: boolean): number {
    if (!isInstant) {
      return 0; // Weekly payouts are free
    }

    const percentFee = amount * (this.config.instantCashoutFeePercent / 100);
    const totalFee = percentFee + this.config.instantCashoutFeeFixed;

    return Math.round(totalFee);
  }

  /**
   * Validate payout request
   */
  private async validatePayoutRequest(
    driverId: string,
    amount: number,
    currency: Currency,
  ): Promise<{ valid: boolean; error?: string }> {
    // Check minimum amount
    if (amount < this.config.minAmount) {
      return {
        valid: false,
        error: `Minimum payout is ${currency} ${this.config.minAmount}`,
      };
    }

    // Check maximum per transaction
    if (amount > this.config.maxAmountPerTransaction) {
      return {
        valid: false,
        error: `Maximum payout per transaction is ${currency} ${this.config.maxAmountPerTransaction}`,
      };
    }

    // Check daily limit
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayPayouts = await this.prisma.payout.aggregate({
      where: {
        driverId,
        createdAt: { gte: today },
        status: {
          in: [
            PayoutStatus.PENDING,
            PayoutStatus.PROCESSING,
            PayoutStatus.COMPLETED,
          ],
        },
      },
      _sum: { amount: true },
    });

    const totalToday = Number(todayPayouts._sum.amount || 0);
    if (totalToday + amount > this.config.maxAmountPerDay) {
      return {
        valid: false,
        error: `Daily payout limit of ${currency} ${this.config.maxAmountPerDay} exceeded`,
      };
    }

    // Check available balance
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: { user: true },
    });

    if (!driver) {
      return { valid: false, error: "Driver not found" };
    }

    const balance = await this.walletService.getBalance(
      driver.userId,
      "DRIVER_WALLET" as any,
      currency,
    );

    if (balance.availableBalance < amount) {
      return {
        valid: false,
        error: `Insufficient balance. Available: ${currency} ${balance.availableBalance}`,
      };
    }

    return { valid: true };
  }

  /**
   * Create instant cashout payout
   */
  async createInstantCashout(
    request: CreatePayoutRequest,
  ): Promise<PayoutResult> {
    const {
      driverId,
      amount,
      currency,
      paymentMethod,
      phoneNumber,
      bankAccount,
      reason,
    } = request;

    // Validate request
    const validation = await this.validatePayoutRequest(
      driverId,
      amount,
      currency,
    );
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Validate payment details
    if (paymentMethod === "mobile_money" && !phoneNumber) {
      throw new Error("Phone number required for mobile money payout");
    }

    if (paymentMethod === "bank_transfer" && !bankAccount) {
      throw new Error("Bank account required for bank transfer payout");
    }

    // Calculate fee
    const fee = this.calculatePayoutFee(amount, true);
    const netAmount = amount - fee;

    // Get driver info
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: { user: true },
    });

    if (!driver) {
      throw new Error("Driver not found");
    }

    // Determine provider based on currency and method
    let provider: PaymentProvider;
    if (paymentMethod === "mobile_money") {
      if (currency === "KES") {
        provider = PaymentProvider.MPESA;
      } else if (currency === "GHS") {
        provider = PaymentProvider.MTN_MOMO_GH;
      } else if (currency === Currency.RWF) {
        provider = PaymentProvider.MTN_MOMO_RW;
      } else if (currency === Currency.USD) {
        // Use default provider for USD
        provider = PaymentProvider.PAYSTACK;
      } else {
        throw new Error(`Mobile money not supported for ${currency}`);
      }
    } else {
      // Bank transfer via Paystack
      provider = PaymentProvider.PAYSTACK;
    }

    // Determine initial status
    let initialStatus = PayoutStatus.PENDING;
    if (amount > this.config.manualReviewLimit) {
      initialStatus = PayoutStatus.PENDING; // Will require manual approval
    } else if (amount <= this.config.autoApprovalLimit) {
      initialStatus = PayoutStatus.PROCESSING; // Auto-approve
    }

    // Create payout record
    const payout = await this.prisma.payout.create({
      data: {
        driverId,
        provider,
        amount,
        currency,
        fee,
        netAmount,
        status: initialStatus,
        payoutMethod: paymentMethod.toUpperCase(),
        payoutDetails: {
          phoneNumber,
          bankAccount,
          reason: reason || "Instant cashout",
        },
        scheduledFor: new Date(), // Instant
      },
    });

    // If auto-approved, process immediately
    if (initialStatus === PayoutStatus.PROCESSING) {
      // Process in background
      this.processPayoutAsync(payout.id).catch((error) => {
        payoutLogger.error(`Failed to process payout ${payout.id}:`, error);
      });
    }

    return {
      payoutId: payout.id,
      status: payout.status,
      amount: Number(payout.amount),
      fee: Number(payout.fee),
      netAmount: Number(payout.netAmount),
      estimatedArrival: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
    };
  }

  /**
   * Process payout asynchronously
   */
  private async processPayoutAsync(payoutId: string): Promise<void> {
    try {
      const payout = await this.prisma.payout.findUnique({
        where: { id: payoutId },
        include: { driver: { include: { user: true } } },
      });

      if (!payout) {
        throw new Error("Payout not found");
      }

      if (payout.status !== PayoutStatus.PROCESSING) {
        return; // Already processed or cancelled
      }

      // Get driver's wallet account
      const driverAccount = await this.prisma.walletAccount.findFirst({
        where: {
          userId: payout.driver.userId,
          accountType: "DRIVER_WALLET" as any,
          currency: payout.currency,
        },
      });

      if (!driverAccount) {
        throw new Error("Driver wallet account not found");
      }

      // Hold funds in wallet (prevent double payout)
      const holdResult = await this.walletService.holdFunds({
        accountId: driverAccount.id,
        amount: Number(payout.amount),
        currency: payout.currency,
        reason: `Payout ${payoutId}`,
        expiresInMinutes: 30, // Hold for 30 minutes
        metadata: { payoutId },
      });

      // Update payout with hold ID
      await this.prisma.payout.update({
        where: { id: payoutId },
        data: {
          metadata: { holdId: holdResult.hold.id },
        },
      });

      // Initiate payout with provider
      const providerResult = await this.initiateProviderPayout(payout);

      // Update payout with provider reference
      await this.prisma.payout.update({
        where: { id: payoutId },
        data: {
          providerReference: providerResult.reference,
          providerResponse: providerResult as any,
        },
      });

      payoutLogger.info(
        `Payout ${payoutId} initiated with provider: ${providerResult.reference}`,
      );
    } catch (error: any) {
      payoutLogger.error(`Payout processing failed for ${payoutId}:`, error);

      // Mark as failed
      await this.prisma.payout.update({
        where: { id: payoutId },
        data: {
          status: PayoutStatus.FAILED,
          failureReason: error.message,
        },
      });
    }
  }

  /**
   * Initiate payout with provider (M-Pesa B2C, MoMo, etc.)
   */
  private async initiateProviderPayout(
    payout: any,
  ): Promise<{ reference: string; status: string }> {
    const payoutDetails = payout.payoutDetails as any;

    // Helper to get required env var or throw
    const requireEnv = (name: string): string => {
      const value = process.env[name];
      if (!value) {
        throw new Error(`Required environment variable ${name} is not set`);
      }
      return value;
    };

    try {
      switch (payout.provider) {
        case PaymentProvider.MPESA: {
          // M-Pesa B2C (Business to Customer)
          const mpesaService = new MpesaService(
            {
              consumerKey: requireEnv("MPESA_CONSUMER_KEY"),
              consumerSecret: requireEnv("MPESA_CONSUMER_SECRET"),
              shortCode: requireEnv("MPESA_SHORT_CODE"),
              passkey: requireEnv("MPESA_PASSKEY"),
              callbackUrl: requireEnv("MPESA_CALLBACK_URL"),
              b2cShortCode: process.env.MPESA_B2C_SHORT_CODE,
              b2cInitiatorName: process.env.MPESA_B2C_INITIATOR_NAME,
              b2cSecurityCredential: process.env.MPESA_B2C_SECURITY_CREDENTIAL,
              b2cQueueTimeoutUrl: process.env.MPESA_B2C_QUEUE_TIMEOUT_URL,
              b2cResultUrl: process.env.MPESA_B2C_RESULT_URL,
              environment:
                process.env.MPESA_ENVIRONMENT === "production"
                  ? "production"
                  : "sandbox",
            },
            this.prisma,
          );

          const b2cResponse = await mpesaService.initiateB2CPayment({
            phoneNumber: payoutDetails.phoneNumber,
            amount: Number(payout.netAmount),
            occasion: payout.reason || "Driver payout",
            remarks: `Payout for driver ${payout.driverId}`,
          });

          // Start background polling for B2C result
          // In production, you'd use a queue system (Bull, etc.)
          setTimeout(() => {
            // B2C callback will update the payout status automatically
            payoutLogger.info(
              `M-Pesa B2C initiated: ${b2cResponse.OriginatorConversationID}`,
            );
          }, 0);

          return {
            reference: b2cResponse.OriginatorConversationID,
            status: "processing",
          };
        }

        case PaymentProvider.MTN_MOMO_GH:
        case PaymentProvider.MTN_MOMO_RW:
        case PaymentProvider.MTN_MOMO_UG: {
          // MTN MoMo Disbursement API
          const country =
            payout.provider === PaymentProvider.MTN_MOMO_GH
              ? "GH"
              : payout.provider === PaymentProvider.MTN_MOMO_RW
                ? "RW"
                : "UG";

          const momoService = new MoMoService(
            {
              subscriptionKey:
                process.env[`MOMO_${country}_SUBSCRIPTION_KEY`] || "",
              apiUser: process.env[`MOMO_${country}_API_USER`] || "",
              apiKey: process.env[`MOMO_${country}_API_KEY`] || "",
              disbursementSubscriptionKey:
                process.env[`MOMO_${country}_DISBURSEMENT_SUBSCRIPTION_KEY`],
              disbursementApiUser:
                process.env[`MOMO_${country}_DISBURSEMENT_API_USER`],
              disbursementApiKey:
                process.env[`MOMO_${country}_DISBURSEMENT_API_KEY`],
              environment:
                process.env.MOMO_ENVIRONMENT === "production"
                  ? "production"
                  : "sandbox",
              country,
              callbackUrl: process.env.MOMO_CALLBACK_URL,
            },
            this.prisma,
          );

          const disbursementResponse = await momoService.initiateDisbursement({
            phoneNumber: payoutDetails.phoneNumber,
            amount: Number(payout.netAmount),
            currency: payout.currency as any,
            externalId: payout.id,
            payeeNote: payout.reason || "Driver payout",
          });

          // Start background polling
          setTimeout(() => {
            momoService
              .pollDisbursementStatus(
                disbursementResponse.referenceId,
                payout.id,
              )
              .catch((error) => {
                payoutLogger.error("MoMo disbursement polling error:", error);
              });
          }, 0);

          return {
            reference: disbursementResponse.referenceId,
            status: "processing",
          };
        }

        case PaymentProvider.PAYSTACK: {
          // Paystack Transfer API
          const paystackService = new PaystackService(
            {
              secretKey: requireEnv("PAYSTACK_SECRET_KEY"),
              publicKey: requireEnv("PAYSTACK_PUBLIC_KEY"),
              webhookSecret: requireEnv("PAYSTACK_WEBHOOK_SECRET"),
              environment:
                process.env.PAYSTACK_ENVIRONMENT === "live" ? "live" : "test",
            },
            this.prisma,
          );

          // Determine recipient type and bank code
          let recipientType: "nuban" | "mobile_money" | "basa" = "nuban";
          let bankCode = payoutDetails.bankCode || "058"; // Default GTBank

          if (payout.paymentMethod === "mobile_money") {
            recipientType = "mobile_money";
            // Mobile money codes vary by country
            if (payout.currency === "GHS") {
              bankCode = "MTN"; // MTN Mobile Money Ghana
            }
          }

          const transferResult = await paystackService.completePayout(
            payout.id,
            {
              name: payoutDetails.accountName || "Driver Account",
              accountNumber:
                payoutDetails.phoneNumber || payoutDetails.accountNumber,
              bankCode,
              type: recipientType,
            },
            Number(payout.netAmount),
            payout.currency as any,
            payout.reason || "Driver payout",
          );

          // Start background polling
          setTimeout(() => {
            paystackService
              .pollTransferStatus(transferResult.transferCode, payout.id)
              .catch((error) => {
                payoutLogger.error("Paystack transfer polling error:", error);
              });
          }, 0);

          return {
            reference: transferResult.transferCode,
            status: "processing",
          };
        }

        default:
          throw new Error(
            `Payout not supported for provider: ${payout.provider}`,
          );
      }
    } catch (error) {
      payoutLogger.error({ err: error }, "Provider payout initiation error");
      throw error;
    }
  }

  /**
   * Complete payout (called by webhook)
   */

  async completePayout(
    payoutId: string,
    providerReference?: string,
  ): Promise<void> {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      include: { driver: { include: { user: true } } },
    });

    if (!payout) {
      throw new Error("Payout not found");
    }

    if (payout.status === PayoutStatus.COMPLETED) {
      return; // Already completed
    }

    // Get hold ID from metadata
    const metadata = payout.metadata as any;
    const holdId = metadata?.holdId;

    if (!holdId) {
      throw new Error("Hold ID not found in payout metadata");
    }

    // Get UBI_FLOAT account ID
    const ubiFloat = await this.prisma.walletAccount.findFirst({
      where: {
        accountType: "UBI_FLOAT",
        currency: payout.currency,
      },
    });

    if (!ubiFloat) {
      throw new Error(`UBI_FLOAT account not found for ${payout.currency}`);
    }

    // Capture held funds (debit driver wallet, credit UBI_FLOAT)
    await this.walletService.captureFunds(holdId, {
      transactionType: "PAYOUT" as any,
      toAccountId: ubiFloat.id,
      description: `Payout to driver - ${providerReference || payout.providerReference}`,
      metadata: {
        payoutId,
        providerReference: providerReference || payout.providerReference,
        fee: Number(payout.fee),
      },
    });

    // Update payout status
    await this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: PayoutStatus.COMPLETED,
        completedAt: new Date(),
        providerReference: providerReference || payout.providerReference,
      },
    });

    payoutLogger.info(
      `Payout completed: ${payoutId} (${payout.currency} ${payout.netAmount} to ${payout.driver.user.phone})`,
    );
  }

  /**
   * Fail payout (called by webhook or timeout)
   */
  async failPayout(payoutId: string, reason: string): Promise<void> {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
    });

    if (!payout) {
      throw new Error("Payout not found");
    }

    if (payout.status === PayoutStatus.COMPLETED) {
      throw new Error("Cannot fail completed payout");
    }

    // Release held funds if exists
    const metadata = payout.metadata as any;
    const holdId = metadata?.holdId;

    if (holdId) {
      try {
        await this.walletService.releaseFunds(holdId);
      } catch (error) {
        payoutLogger.error({ err: error, holdId }, "Failed to release hold");
      }
    }

    // Update payout status
    await this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: PayoutStatus.FAILED,
        failureReason: reason,
      },
    });

    payoutLogger.info(`Payout failed: ${payoutId} - ${reason}`);
  }

  /**
   * Get payout status
   */
  async getPayoutStatus(payoutId: string): Promise<{
    status: PayoutStatus;
    amount: number;
    fee: number;
    netAmount: number;
    providerReference?: string;
    completedAt?: Date;
    failureReason?: string;
  }> {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
    });

    if (!payout) {
      throw new Error("Payout not found");
    }

    return {
      status: payout.status,
      amount: Number(payout.amount),
      fee: Number(payout.fee),
      netAmount: Number(payout.netAmount),
      providerReference: payout.providerReference || undefined,
      completedAt: payout.completedAt || undefined,
      failureReason: payout.failureReason || undefined,
    };
  }

  /**
   * Get driver payout history
   */
  async getPayoutHistory(
    driverId: string,
    options: {
      limit?: number;
      offset?: number;
      status?: PayoutStatus;
    } = {},
  ): Promise<Array<any>> {
    const { limit = 20, offset = 0, status } = options;

    const payouts = await this.prisma.payout.findMany({
      where: {
        driverId,
        ...(status && { status }),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });

    return payouts.map((payout) => ({
      id: payout.id,
      amount: Number(payout.amount),
      fee: Number(payout.fee),
      netAmount: Number(payout.netAmount),
      currency: payout.currency,
      status: payout.status,
      provider: payout.provider,
      createdAt: payout.createdAt,
      completedAt: payout.completedAt,
      failureReason: payout.failureReason,
    }));
  }

  /**
   * Get driver available balance for payout
   */
  async getAvailableBalance(
    driverId: string,
    currency: Currency,
  ): Promise<{
    balance: number;
    availableForPayout: number;
    pendingPayouts: number;
  }> {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: { user: true },
    });

    if (!driver) {
      throw new Error("Driver not found");
    }

    const balance = await this.walletService.getBalance(
      driver.userId,
      "DRIVER_WALLET" as any,
      currency,
    );

    // Get pending payouts
    const pendingPayouts = await this.prisma.payout.aggregate({
      where: {
        driverId,
        status: { in: [PayoutStatus.PENDING, PayoutStatus.PROCESSING] },
      },
      _sum: { amount: true },
    });

    const totalPending = Number(pendingPayouts._sum.amount || 0);

    return {
      balance: balance.balance,
      availableForPayout: balance.availableBalance,
      pendingPayouts: totalPending,
    };
  }

  /**
   * Approve pending payout (manual review)
   */
  async approvePayout(payoutId: string, approvedBy: string): Promise<void> {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
    });

    if (!payout) {
      throw new Error("Payout not found");
    }

    if (payout.status !== PayoutStatus.PENDING) {
      throw new Error(`Cannot approve payout with status: ${payout.status}`);
    }

    // Update to processing
    await this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: PayoutStatus.PROCESSING,
        metadata: {
          ...(payout.metadata as any),
          approvedBy,
          approvedAt: new Date(),
        },
      },
    });

    // Process payout
    this.processPayoutAsync(payoutId).catch((error) => {
      payoutLogger.error(
        `Failed to process approved payout ${payoutId}:`,
        error,
      );
    });
  }

  /**
   * Cancel pending payout
   */
  async cancelPayout(payoutId: string, reason: string): Promise<void> {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
    });

    if (!payout) {
      throw new Error("Payout not found");
    }

    if (payout.status === PayoutStatus.COMPLETED) {
      throw new Error("Cannot cancel completed payout");
    }

    if (payout.status === PayoutStatus.PROCESSING) {
      throw new Error("Cannot cancel payout in processing");
    }

    await this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: PayoutStatus.CANCELLED,
        failureReason: reason,
      },
    });
  }

  /**
   * Process weekly automatic payouts
   * Called by cron job every Friday
   */
  async processWeeklyPayouts(): Promise<{
    processed: number;
    failed: number;
    totalAmount: number;
  }> {
    let processed = 0;
    let failed = 0;
    let totalAmount = 0;

    // Get all drivers with balance >= minimum
    const drivers = await this.prisma.driver.findMany({
      where: {
        status: "ACTIVE",
      },
      include: { user: true },
    });

    for (const driver of drivers) {
      try {
        // Check balance for each currency
        for (const currency of Object.values(Currency)) {
          try {
            const balance = await this.walletService.getBalance(
              driver.userId,
              "DRIVER_WALLET" as any,
              currency,
            );

            if (balance.availableBalance >= this.config.weeklyPayoutMinimum) {
              // Create automatic payout (no fee for weekly)
              const payout = await this.prisma.payout.create({
                data: {
                  driverId: driver.id,
                  provider:
                    currency === "KES"
                      ? PaymentProvider.MPESA
                      : PaymentProvider.PAYSTACK,
                  amount: balance.availableBalance,
                  currency,
                  fee: 0, // No fee for weekly payouts
                  netAmount: balance.availableBalance,
                  status: PayoutStatus.PROCESSING,
                  payoutMethod: "MOBILE_MONEY",
                  payoutDetails: {
                    phoneNumber: driver.user.phone,
                    reason: "Weekly automatic payout",
                  },
                  scheduledFor: new Date(),
                },
              });

              // Process payout
              await this.processPayoutAsync(payout.id);

              processed++;
              totalAmount += balance.availableBalance;
            }
          } catch (error) {
            payoutLogger.error(
              { err: error, driverId: driver.id, currency },
              "Failed to process weekly payout",
            );
            failed++;
          }
        }
      } catch (error) {
        payoutLogger.error(
          { err: error, driverId: driver.id },
          "Failed to process driver",
        );
        failed++;
      }
    }

    payoutLogger.info(
      `Weekly payouts: ${processed} processed, ${failed} failed, total: ${totalAmount}`,
    );

    return { processed, failed, totalAmount };
  }
}

// Singleton instance
let payoutServiceInstance: PayoutService | null = null;

// Create new instance
export function createPayoutService(prisma: PrismaClient): PayoutService {
  return new PayoutService(prisma);
}

// Get singleton instance
export function getPayoutService(prisma: PrismaClient): PayoutService {
  if (!payoutServiceInstance) {
    payoutServiceInstance = createPayoutService(prisma);
  }
  return payoutServiceInstance;
}
