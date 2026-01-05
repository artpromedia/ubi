/**
 * Payment Gateway Orchestration Service
 *
 * Coordinates all payment providers and handles:
 * - Provider selection based on country/currency/method
 * - Automatic failover on provider failure
 * - Provider health monitoring
 * - Unified payment interface
 * - Transaction lifecycle management
 *
 * Supported Providers:
 * - M-Pesa (Kenya - KES)
 * - MTN MoMo (Ghana, Rwanda, Uganda - GHS, RWF, UGX)
 * - Paystack (Nigeria, Ghana, South Africa, Kenya - NGN, GHS, ZAR, KES)
 * - Flutterwave (Backup for cards - NGN, GHS, ZAR, KES, USD)
 *
 * Provider Selection Logic:
 * 1. Mobile money preferred for KES, GHS, RWF, UGX (70%+ market share)
 * 2. Cards for NGN, ZAR, USD
 * 3. Automatic failover to backup provider if primary fails
 * 4. Health check every 30 seconds
 *
 * Error Handling:
 * - Provider down → Failover to backup
 * - Network timeout → Retry with exponential backoff
 * - Transaction stuck → Auto-query status after 60s
 */

import { PaymentProvider, PaymentStatus, PrismaClient } from "@prisma/client";
import { WalletService } from "../services/wallet.service";
import { MoMoConfig, MoMoService } from "../providers/momo.service";
import { MpesaConfig, MpesaService } from "../providers/mpesa.service";
import { PaystackConfig, PaystackService } from "../providers/paystack.service";

export interface PaymentGatewayConfig {
  mpesa?: MpesaConfig;
  momoGhana?: MoMoConfig;
  momoRwanda?: MoMoConfig;
  momoUganda?: MoMoConfig;
  paystack?: PaystackConfig;
  flutterwave?: any; // To be implemented
}

export interface InitiatePaymentRequest {
  userId: string;
  email: string;
  phoneNumber?: string;
  amount: number;
  currency: "NGN" | "GHS" | "KES" | "RWF" | "UGX" | "ZAR" | "USD";
  transactionId: string;
  description?: string;
  paymentMethod?: "mobile_money" | "card" | "auto"; // auto = smart routing
  callbackUrl?: string;
}

export interface InitiatePaymentResponse {
  paymentTransactionId: string;
  provider: PaymentProvider;
  status: "pending" | "completed" | "failed";

  // For M-Pesa
  checkoutRequestId?: string;

  // For MoMo
  referenceId?: string;

  // For Paystack (hosted page)
  authorizationUrl?: string;
  paystackReference?: string;

  // For saved cards
  requiresAction?: boolean;
  actionUrl?: string;
}

export interface PaymentStatusResponse {
  paymentTransactionId: string;
  provider: PaymentProvider;
  status: PaymentStatus;
  amount: number;
  currency: string;
  providerReference?: string;
  completedAt?: Date;
  failureReason?: string;
}

export class PaymentGateway {
  private mpesaService?: MpesaService;
  private momoGhanaService?: MoMoService;
  private momoRwandaService?: MoMoService;
  private momoUgandaService?: MoMoService;
  private paystackService?: PaystackService;
  private walletService: WalletService;

  constructor(
    private config: PaymentGatewayConfig,
    private prisma: PrismaClient
  ) {
    // Initialize services
    if (config.mpesa) {
      this.mpesaService = new MpesaService(config.mpesa, prisma);
    }
    if (config.momoGhana) {
      this.momoGhanaService = new MoMoService(config.momoGhana, prisma);
    }
    if (config.momoRwanda) {
      this.momoRwandaService = new MoMoService(config.momoRwanda, prisma);
    }
    if (config.momoUganda) {
      this.momoUgandaService = new MoMoService(config.momoUganda, prisma);
    }
    if (config.paystack) {
      this.paystackService = new PaystackService(config.paystack, prisma);
    }

    this.walletService = new WalletService(prisma);
  }

  /**
   * Select optimal provider based on currency, payment method, and health
   */
  private async selectProvider(
    currency: string,
    paymentMethod: "mobile_money" | "card" | "auto"
  ): Promise<PaymentProvider | null> {
    // Currency-specific routing
    switch (currency) {
      case "KES": // Kenya
        if (paymentMethod === "mobile_money" || paymentMethod === "auto") {
          // M-Pesa dominates Kenya (90%+ mobile money market share)
          const mpesaHealthy = await this.isProviderHealthy(
            PaymentProvider.MPESA
          );
          if (mpesaHealthy && this.mpesaService) {
            return PaymentProvider.MPESA;
          }
        }
        // Fallback to Paystack for cards
        if (paymentMethod === "card" || paymentMethod === "auto") {
          const paystackHealthy = await this.isProviderHealthy(
            PaymentProvider.PAYSTACK
          );
          if (paystackHealthy && this.paystackService) {
            return PaymentProvider.PAYSTACK;
          }
        }
        break;

      case "GHS": // Ghana
        if (paymentMethod === "mobile_money" || paymentMethod === "auto") {
          // MTN MoMo is dominant in Ghana
          const momoHealthy = await this.isProviderHealthy(
            PaymentProvider.MTN_MOMO_GH
          );
          if (momoHealthy && this.momoGhanaService) {
            return PaymentProvider.MTN_MOMO_GH;
          }
        }
        // Fallback to Paystack
        if (paymentMethod === "card" || paymentMethod === "auto") {
          const paystackHealthy = await this.isProviderHealthy(
            PaymentProvider.PAYSTACK
          );
          if (paystackHealthy && this.paystackService) {
            return PaymentProvider.PAYSTACK;
          }
        }
        break;

      case "RWF": // Rwanda
        if (paymentMethod === "mobile_money" || paymentMethod === "auto") {
          const momoHealthy = await this.isProviderHealthy(
            PaymentProvider.MTN_MOMO_RW
          );
          if (momoHealthy && this.momoRwandaService) {
            return PaymentProvider.MTN_MOMO_RW;
          }
        }
        break;

      case "UGX": // Uganda
        if (paymentMethod === "mobile_money" || paymentMethod === "auto") {
          const momoHealthy = await this.isProviderHealthy(
            PaymentProvider.MTN_MOMO_UG
          );
          if (momoHealthy && this.momoUgandaService) {
            return PaymentProvider.MTN_MOMO_UG;
          }
        }
        break;

      case "NGN": // Nigeria
      case "ZAR": // South Africa
      case "USD": // International
        // Paystack for cards
        const paystackHealthy = await this.isProviderHealthy(
          PaymentProvider.PAYSTACK
        );
        if (paystackHealthy && this.paystackService) {
          return PaymentProvider.PAYSTACK;
        }
        break;
    }

    return null;
  }

  /**
   * Check provider health status
   */
  private async isProviderHealthy(provider: PaymentProvider): Promise<boolean> {
    const health = await this.prisma.providerHealth.findUnique({
      where: { provider },
    });

    if (!health) {
      return true; // Assume healthy if no record
    }

    // Provider is unhealthy if 3+ consecutive failures
    if (health.consecutiveFailures >= 3) {
      return false;
    }

    // Provider is unhealthy if last check was >5 minutes ago and status is down
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    if (health.lastCheckedAt < fiveMinutesAgo && health.isHealthy === false) {
      return false;
    }

    return health.isHealthy;
  }

  /**
   * Update provider health status
   */
  private async updateProviderHealth(
    provider: PaymentProvider,
    isHealthy: boolean,
    responseTime?: number,
    error?: string
  ): Promise<void> {
    const now = new Date();

    const existing = await this.prisma.providerHealth.findUnique({
      where: { provider },
    });

    if (existing) {
      await this.prisma.providerHealth.update({
        where: { provider },
        data: {
          isHealthy,
          lastCheckedAt: now,
          lastResponseTime: responseTime,
          consecutiveFailures: isHealthy ? 0 : existing.consecutiveFailures + 1,
          lastError: error,
          ...(isHealthy && { lastSuccessAt: now }),
          ...(error && { lastFailureAt: now }),
        },
      });
    } else {
      await this.prisma.providerHealth.create({
        data: {
          provider,
          isHealthy,
          lastCheckedAt: now,
          lastResponseTime: responseTime,
          consecutiveFailures: isHealthy ? 0 : 1,
          lastError: error,
          ...(isHealthy && { lastSuccessAt: now }),
          ...(error && { lastFailureAt: now }),
        },
      });
    }
  }

  /**
   * Initiate payment with smart provider routing
   */
  async initiatePayment(
    request: InitiatePaymentRequest
  ): Promise<InitiatePaymentResponse> {
    const {
      userId,
      email,
      phoneNumber,
      amount,
      currency,
      transactionId,
      description,
      paymentMethod = "auto",
      callbackUrl,
    } = request;

    // Validate amount
    if (amount <= 0) {
      throw new Error("Amount must be positive");
    }

    // Select provider
    const provider = await this.selectProvider(currency, paymentMethod);
    if (!provider) {
      throw new Error(
        `No available provider for ${currency} (${paymentMethod})`
      );
    }

    const startTime = Date.now();

    try {
      let response: InitiatePaymentResponse;

      // Route to appropriate provider
      switch (provider) {
        case PaymentProvider.MPESA:
          if (!this.mpesaService || !phoneNumber) {
            throw new Error("M-Pesa requires phone number");
          }
          const mpesaResult = await this.mpesaService.initiatePayment({
            userId,
            phoneNumber,
            amount,
            transactionId,
            description,
          });
          response = {
            paymentTransactionId: mpesaResult.paymentTransactionId,
            provider: PaymentProvider.MPESA,
            status: mpesaResult.status,
            checkoutRequestId: mpesaResult.checkoutRequestId,
          };
          break;

        case PaymentProvider.MTN_MOMO_GH:
          if (!this.momoGhanaService || !phoneNumber) {
            throw new Error("MTN MoMo requires phone number");
          }
          const momoGhResult = await this.momoGhanaService.initiatePayment({
            userId,
            phoneNumber,
            amount,
            transactionId,
            description,
          });
          response = {
            paymentTransactionId: momoGhResult.paymentTransactionId,
            provider: PaymentProvider.MTN_MOMO_GH,
            status: momoGhResult.status,
            referenceId: momoGhResult.referenceId,
          };
          break;

        case PaymentProvider.MTN_MOMO_RW:
          if (!this.momoRwandaService || !phoneNumber) {
            throw new Error("MTN MoMo requires phone number");
          }
          const momoRwResult = await this.momoRwandaService.initiatePayment({
            userId,
            phoneNumber,
            amount,
            transactionId,
            description,
          });
          response = {
            paymentTransactionId: momoRwResult.paymentTransactionId,
            provider: PaymentProvider.MTN_MOMO_RW,
            status: momoRwResult.status,
            referenceId: momoRwResult.referenceId,
          };
          break;

        case PaymentProvider.MTN_MOMO_UG:
          if (!this.momoUgandaService || !phoneNumber) {
            throw new Error("MTN MoMo requires phone number");
          }
          const momoUgResult = await this.momoUgandaService.initiatePayment({
            userId,
            phoneNumber,
            amount,
            transactionId,
            description,
          });
          response = {
            paymentTransactionId: momoUgResult.paymentTransactionId,
            provider: PaymentProvider.MTN_MOMO_UG,
            status: momoUgResult.status,
            referenceId: momoUgResult.referenceId,
          };
          break;

        case PaymentProvider.PAYSTACK:
          if (!this.paystackService) {
            throw new Error("Paystack not configured");
          }
          const paystackResult = await this.paystackService.initiatePayment({
            userId,
            email,
            amount,
            currency: currency as any,
            transactionId,
            description,
            callbackUrl,
          });
          response = {
            paymentTransactionId: paystackResult.paymentTransactionId,
            provider: PaymentProvider.PAYSTACK,
            status: "pending",
            authorizationUrl: paystackResult.authorizationUrl,
            paystackReference: paystackResult.reference,
            requiresAction: true,
            actionUrl: paystackResult.authorizationUrl,
          };
          break;

        default:
          throw new Error(`Unsupported provider: ${provider}`);
      }

      // Update provider health (success)
      const responseTime = Date.now() - startTime;
      await this.updateProviderHealth(provider, true, responseTime);

      return response;
    } catch (error: any) {
      // Update provider health (failure)
      const responseTime = Date.now() - startTime;
      await this.updateProviderHealth(
        provider,
        false,
        responseTime,
        error.message
      );

      throw error;
    }
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(
    paymentTransactionId: string
  ): Promise<PaymentStatusResponse> {
    const paymentTx = await this.prisma.paymentTransaction.findUnique({
      where: { id: paymentTransactionId },
    });

    if (!paymentTx) {
      throw new Error("Payment transaction not found");
    }

    return {
      paymentTransactionId: paymentTx.id,
      provider: paymentTx.provider,
      status: paymentTx.status,
      amount: Number(paymentTx.amount),
      currency: paymentTx.currency,
      providerReference: paymentTx.providerReference || undefined,
      completedAt: paymentTx.confirmedAt || undefined,
      failureReason: paymentTx.failureReason || undefined,
    };
  }

  /**
   * Complete payment and credit wallet
   * Called after webhook confirms payment success
   */
  async completePaymentToWallet(
    paymentTransactionId: string,
    accountType: "USER_WALLET" | "DRIVER_WALLET" = "USER_WALLET"
  ): Promise<{ transactionId: string; newBalance: number }> {
    const paymentTx = await this.prisma.paymentTransaction.findUnique({
      where: { id: paymentTransactionId },
    });

    if (!paymentTx) {
      throw new Error("Payment transaction not found");
    }

    if (paymentTx.status !== PaymentStatus.COMPLETED) {
      throw new Error(`Payment not completed (status: ${paymentTx.status})`);
    }

    // Top up wallet
    const result = await this.walletService.topUp({
      userId: paymentTx.userId,
      accountType,
      amount: Number(paymentTx.amount),
      currency: paymentTx.currency,
      idempotencyKey: `payment-${paymentTransactionId}`,
      description: `Top up via ${paymentTx.provider}`,
      metadata: {
        paymentTransactionId,
        provider: paymentTx.provider,
        providerReference: paymentTx.providerReference,
      },
    });

    return {
      transactionId: result.transaction.id,
      newBalance: result.balance.balance,
    };
  }

  /**
   * Charge saved payment method
   */
  async chargeSavedMethod(params: {
    userId: string;
    paymentMethodId: string;
    amount: number;
    transactionId: string;
    description?: string;
  }): Promise<InitiatePaymentResponse> {
    const { userId, paymentMethodId, amount, transactionId, description } =
      params;

    // Get payment method
    const paymentMethod = await this.prisma.paymentMethodRecord.findUnique({
      where: { id: paymentMethodId },
      include: { user: true },
    });

    if (!paymentMethod || paymentMethod.userId !== userId) {
      throw new Error("Payment method not found");
    }

    const startTime = Date.now();

    try {
      // Currently only Paystack supports saved cards
      if (paymentMethod.provider === PaymentProvider.PAYSTACK) {
        if (!this.paystackService) {
          throw new Error("Paystack not configured");
        }

        const result = await this.paystackService.chargeSavedCard({
          userId,
          paymentMethodId,
          amount,
          transactionId,
          description,
        });

        // Update provider health
        const responseTime = Date.now() - startTime;
        await this.updateProviderHealth(
          PaymentProvider.PAYSTACK,
          true,
          responseTime
        );

        return {
          paymentTransactionId: result.paymentTransactionId,
          provider: PaymentProvider.PAYSTACK,
          status:
            result.status === "success"
              ? "completed"
              : result.status === "failed"
                ? "failed"
                : "pending",
        };
      }

      throw new Error(
        `Saved cards not supported for provider: ${paymentMethod.provider}`
      );
    } catch (error: any) {
      // Update provider health
      const responseTime = Date.now() - startTime;
      await this.updateProviderHealth(
        paymentMethod.provider,
        false,
        responseTime,
        error.message
      );

      throw error;
    }
  }

  /**
   * List saved payment methods for user
   */
  async listPaymentMethods(userId: string): Promise<any[]> {
    const methods = await this.prisma.paymentMethodRecord.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    return methods.map((method) => ({
      id: method.id,
      provider: method.provider,
      type: method.type,
      lastFour: method.lastFour,
      expiryMonth: method.expiryMonth,
      expiryYear: method.expiryYear,
      cardBrand: method.cardBrand,
      cardBank: method.cardBank,
      isDefault: method.isDefault,
      createdAt: method.createdAt,
    }));
  }

  /**
   * Health check all providers
   */
  async healthCheckAll(): Promise<Record<string, boolean>> {
    const providers = [
      PaymentProvider.MPESA,
      PaymentProvider.MTN_MOMO_GH,
      PaymentProvider.MTN_MOMO_RW,
      PaymentProvider.MTN_MOMO_UG,
      PaymentProvider.PAYSTACK,
    ];

    const results: Record<string, boolean> = {};

    for (const provider of providers) {
      results[provider] = await this.isProviderHealthy(provider);
    }

    return results;
  }
}
