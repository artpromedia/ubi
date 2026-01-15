/**
 * Subscription Service (UBI+)
 * Premium subscription management with billing
 */

import { nanoid } from "nanoid";

import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

import type {
  BillingPeriod,
  CreateSubscriptionParams,
  Subscription,
  SubscriptionBenefitUsage,
  SubscriptionPlan,
  SubscriptionPlanFeatures,
  SubscriptionStatus,
} from "../types/loyalty.types";

// ===========================================
// SUBSCRIPTION SERVICE
// ===========================================

export class SubscriptionService {
  /**
   * Get all available plans
   */
  async getPlans(currency?: string): Promise<SubscriptionPlan[]> {
    const plans = await prisma.subscriptionPlan.findMany({
      where: {
        isActive: true,
        ...(currency && { currency }),
      },
      orderBy: { displayOrder: "asc" },
    });

    return plans.map(
      (p: {
        id: string;
        name: string;
        slug: string;
        description: string | null;
        price: unknown;
        currency: string;
        billingPeriod: string;
        trialDays: number;
        features: unknown;
        maxFamilyMembers: number;
        isPopular: boolean;
        displayOrder: number;
        isActive: boolean;
      }) => this.formatPlan(p),
    );
  }

  /**
   * Get plan by ID or slug
   */
  async getPlan(idOrSlug: string): Promise<SubscriptionPlan | null> {
    const plan = await prisma.subscriptionPlan.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
        isActive: true,
      },
    });

    return plan ? this.formatPlan(plan) : null;
  }

  /**
   * Get user's active subscription
   */
  async getSubscription(userId: string): Promise<Subscription | null> {
    const subscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
      },
      include: { plan: true },
    });

    return subscription ? this.formatSubscription(subscription) : null;
  }

  /**
   * Check if user has active subscription
   */
  async hasActiveSubscription(userId: string): Promise<boolean> {
    const subscription = await this.getSubscription(userId);
    return (
      subscription !== null &&
      ["ACTIVE", "TRIALING"].includes(subscription.status)
    );
  }

  /**
   * Create new subscription
   */
  async createSubscription(
    params: CreateSubscriptionParams,
  ): Promise<Subscription> {
    const { userId, planId, paymentMethodId, promoCode } = params;

    // Check for existing subscription
    const existing = await this.getSubscription(userId);
    if (existing) {
      throw new Error(
        "User already has an active subscription. Cancel first or change plan.",
      );
    }

    // Get plan
    const plan = await this.getPlan(planId);
    if (!plan) {
      throw new Error("Subscription plan not found");
    }

    // Calculate billing dates
    const now = new Date();
    const periodStart = now;
    let periodEnd: Date;
    let trialEnd: Date | undefined;

    // Apply trial if available
    if (plan.trialDays > 0) {
      trialEnd = new Date(now);
      trialEnd.setDate(trialEnd.getDate() + plan.trialDays);
      periodEnd = trialEnd;
    } else {
      periodEnd = this.calculatePeriodEnd(now, plan.billingPeriod);
    }

    // Apply promo code discount if provided
    let discountApplied = false;
    let discountAmount = 0;
    let discountPercentage = 0;

    if (promoCode) {
      const validPromo = await this.validatePromoCode(
        promoCode,
        userId,
        plan.id,
      );
      if (validPromo) {
        discountApplied = true;
        discountPercentage = validPromo.discountPercentage;
        discountAmount = validPromo.discountAmount;

        // Mark promo code as used
        await prisma.promoCodeUsage.create({
          data: {
            promoCodeId: validPromo.id,
            userId,
            usedAt: new Date(),
          },
        });

        // Increment usage count
        await prisma.promoCode.update({
          where: { id: validPromo.id },
          data: { usageCount: { increment: 1 } },
        });
      }
    }

    const subscriptionId = `sub_${nanoid(16)}`;

    const subscription = await prisma.subscription.create({
      data: {
        id: subscriptionId,
        userId,
        planId: plan.id,
        status: plan.trialDays > 0 ? "TRIALING" : "ACTIVE",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        trialStart: plan.trialDays > 0 ? now : null,
        trialEnd: trialEnd || null,
        paymentMethodId,
        nextBillingAt: periodEnd,
        benefitsUsed: {},
        metadata: {
          promoCode: promoCode || null,
          discountApplied,
          discountPercentage: discountApplied ? discountPercentage : null,
          discountAmount: discountApplied ? discountAmount : null,
        },
      },
      include: { plan: true },
    });

    // Create initial invoice (will be $0 for trial)
    await this.createInvoice({
      subscriptionId,
      amount: plan.trialDays > 0 ? 0 : Number(plan.price),
      currency: plan.currency,
      periodStart,
      periodEnd,
    });

    await redis.del(`subscription:${userId}`);

    return this.formatSubscription(subscription);
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(
    userId: string,
    options: { immediately?: boolean; reason?: string } = {},
  ): Promise<Subscription> {
    const { immediately = false, reason } = options;

    const subscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
      },
      include: { plan: true },
    });

    if (!subscription) {
      throw new Error("No active subscription found");
    }

    const updates: Record<string, unknown> = {
      cancelledAt: new Date(),
      cancelReason: reason,
    };

    if (immediately) {
      updates.status = "CANCELLED";
      updates.currentPeriodEnd = new Date();
    } else {
      updates.cancelAtPeriodEnd = true;
    }

    const updated = await prisma.subscription.update({
      where: { id: subscription.id },
      data: updates,
      include: { plan: true },
    });

    await redis.del(`subscription:${userId}`);

    return this.formatSubscription(updated);
  }

  /**
   * Pause subscription
   */
  async pauseSubscription(userId: string): Promise<Subscription> {
    const subscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: "ACTIVE",
      },
      include: { plan: true },
    });

    if (!subscription) {
      throw new Error("No active subscription to pause");
    }

    const updated = await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: "PAUSED" },
      include: { plan: true },
    });

    await redis.del(`subscription:${userId}`);

    return this.formatSubscription(updated);
  }

  /**
   * Resume paused subscription
   */
  async resumeSubscription(userId: string): Promise<Subscription> {
    const subscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: "PAUSED",
      },
      include: { plan: true },
    });

    if (!subscription) {
      throw new Error("No paused subscription to resume");
    }

    const updated = await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: "ACTIVE" },
      include: { plan: true },
    });

    await redis.del(`subscription:${userId}`);

    return this.formatSubscription(updated);
  }

  /**
   * Change subscription plan
   */
  async changePlan(userId: string, newPlanId: string): Promise<Subscription> {
    const subscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ["ACTIVE", "TRIALING"] },
      },
      include: { plan: true },
    });

    if (!subscription) {
      throw new Error("No active subscription found");
    }

    const newPlan = await this.getPlan(newPlanId);
    if (!newPlan) {
      throw new Error("New plan not found");
    }

    // Calculate proration if upgrading mid-cycle
    const daysRemaining = Math.ceil(
      (subscription.currentPeriodEnd.getTime() - new Date().getTime()) /
        (1000 * 60 * 60 * 24),
    );

    const updated = await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        planId: newPlan.id,
        metadata: {
          ...((subscription.metadata as Record<string, unknown>) || {}),
          previousPlanId: subscription.planId,
          planChangedAt: new Date().toISOString(),
          proratedDays: daysRemaining,
        },
      },
      include: { plan: true },
    });

    await redis.del(`subscription:${userId}`);

    return this.formatSubscription(updated);
  }

  /**
   * Get subscription benefits usage
   */
  async getBenefitUsage(
    userId: string,
  ): Promise<SubscriptionBenefitUsage | null> {
    const subscription = await this.getSubscription(userId);
    if (!subscription || !subscription.plan) {
      return null;
    }

    const features = subscription.plan.features;
    const used = (subscription.benefitsUsed || {}) as Record<string, number>;

    return {
      freeDeliveriesUsed: used.freeDeliveries || 0,
      freeDeliveriesRemaining: features.freeDelivery ? "unlimited" : 0,
      freeCancellationsUsed: used.freeCancellations || 0,
      freeCancellationsRemaining:
        features.freeCancellations === "unlimited"
          ? "unlimited"
          : Math.max(
              0,
              (features.freeCancellations as number) -
                (used.freeCancellations || 0),
            ),
    };
  }

  /**
   * Use a subscription benefit
   */
  async useBenefit(
    userId: string,
    benefit: "freeDelivery" | "freeCancellation",
  ): Promise<{ success: boolean; remaining: number | "unlimited" }> {
    const subscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ["ACTIVE", "TRIALING"] },
      },
      include: { plan: true },
    });

    if (!subscription) {
      return { success: false, remaining: 0 };
    }

    const features = subscription.plan.features as SubscriptionPlanFeatures;
    const used = (subscription.benefitsUsed || {}) as Record<string, number>;

    if (benefit === "freeDelivery") {
      if (!features.freeDelivery) {
        return { success: false, remaining: 0 };
      }

      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          benefitsUsed: {
            ...used,
            freeDeliveries: (used.freeDeliveries || 0) + 1,
          },
        },
      });

      return { success: true, remaining: "unlimited" };
    }

    if (benefit === "freeCancellation") {
      const limit = features.freeCancellations;
      const currentUsed = used.freeCancellations || 0;

      if (limit !== "unlimited" && currentUsed >= (limit as number)) {
        return { success: false, remaining: 0 };
      }

      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          benefitsUsed: {
            ...used,
            freeCancellations: currentUsed + 1,
          },
        },
      });

      return {
        success: true,
        remaining:
          limit === "unlimited"
            ? "unlimited"
            : (limit as number) - currentUsed - 1,
      };
    }

    return { success: false, remaining: 0 };
  }

  /**
   * Process subscription renewals (run daily)
   */
  async processRenewals(): Promise<{
    processed: number;
    renewed: number;
    failed: number;
    cancelled: number;
  }> {
    const now = new Date();

    // Find subscriptions due for renewal
    const dueSubscriptions = await prisma.subscription.findMany({
      where: {
        status: { in: ["ACTIVE", "TRIALING"] },
        currentPeriodEnd: { lte: now },
      },
      include: { plan: true },
    });

    let renewed = 0;
    let failed = 0;
    let cancelled = 0;

    for (const subscription of dueSubscriptions) {
      // Check if set to cancel at period end
      if (subscription.cancelAtPeriodEnd) {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: "CANCELLED" },
        });
        cancelled++;
        continue;
      }

      try {
        // Attempt payment
        const paymentSuccess = await this.processPayment(
          subscription.id,
          Number(subscription.plan.price),
          subscription.plan.currency,
        );

        if (paymentSuccess) {
          const newPeriodStart = subscription.currentPeriodEnd;
          const newPeriodEnd = this.calculatePeriodEnd(
            newPeriodStart,
            subscription.plan.billingPeriod as BillingPeriod,
          );

          await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
              status: "ACTIVE",
              currentPeriodStart: newPeriodStart,
              currentPeriodEnd: newPeriodEnd,
              nextBillingAt: newPeriodEnd,
              lastPaymentAt: now,
              benefitsUsed: {}, // Reset monthly benefits
            },
          });

          await this.createInvoice({
            subscriptionId: subscription.id,
            amount: Number(subscription.plan.price),
            currency: subscription.plan.currency,
            periodStart: newPeriodStart,
            periodEnd: newPeriodEnd,
          });

          renewed++;
        } else {
          // Mark as past due
          await prisma.subscription.update({
            where: { id: subscription.id },
            data: { status: "PAST_DUE" },
          });
          failed++;
        }
      } catch (error) {
        console.error(`Renewal failed for ${subscription.id}:`, error);
        failed++;
      }

      await redis.del(`subscription:${subscription.userId}`);
    }

    return {
      processed: dueSubscriptions.length,
      renewed,
      failed,
      cancelled,
    };
  }

  /**
   * Add family member to subscription
   */
  async addFamilyMember(
    userId: string,
    memberId: string,
  ): Promise<{ success: boolean; membersCount: number }> {
    const subscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ["ACTIVE", "TRIALING"] },
      },
      include: {
        plan: true,
        familyMembers: true,
      },
    });

    if (!subscription) {
      throw new Error("No active subscription found");
    }

    const features = subscription.plan.features as SubscriptionPlanFeatures;
    if (features.familyMembers <= 0) {
      throw new Error("Family sharing not available on this plan");
    }

    if (subscription.familyMembers.length >= features.familyMembers) {
      throw new Error(
        `Maximum ${features.familyMembers} family members allowed`,
      );
    }

    await prisma.subscriptionFamilyMember.create({
      data: {
        id: `sfm_${nanoid(16)}`,
        subscriptionId: subscription.id,
        memberId,
        role: "member",
      },
    });

    return {
      success: true,
      membersCount: subscription.familyMembers.length + 1,
    };
  }

  /**
   * Remove family member
   */
  async removeFamilyMember(userId: string, memberId: string): Promise<void> {
    const subscription = await prisma.subscription.findFirst({
      where: { userId },
    });

    if (!subscription) {
      throw new Error("No subscription found");
    }

    await prisma.subscriptionFamilyMember.deleteMany({
      where: {
        subscriptionId: subscription.id,
        memberId,
      },
    });
  }

  /**
   * Get subscription invoices
   */
  async getInvoices(
    userId: string,
    limit: number = 12,
  ): Promise<
    Array<{
      id: string;
      amount: number;
      currency: string;
      status: string;
      periodStart: Date;
      periodEnd: Date;
      paidAt?: Date;
      createdAt: Date;
    }>
  > {
    const subscription = await prisma.subscription.findFirst({
      where: { userId },
    });

    if (!subscription) {
      return [];
    }

    const invoices = await prisma.subscriptionInvoice.findMany({
      where: { subscriptionId: subscription.id },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return invoices.map(
      (inv: {
        id: string;
        amount: unknown;
        currency: string;
        status: string;
        periodStart: Date;
        periodEnd: Date;
        paidAt: Date | null;
        createdAt: Date;
      }) => ({
        id: inv.id,
        amount: Number(inv.amount),
        currency: inv.currency,
        status: inv.status,
        periodStart: inv.periodStart,
        periodEnd: inv.periodEnd,
        paidAt: inv.paidAt || undefined,
        createdAt: inv.createdAt,
      }),
    );
  }

  // ===========================================
  // PRIVATE HELPERS
  // ===========================================

  /**
   * Validate promo code for subscription
   */
  private async validatePromoCode(
    code: string,
    userId: string,
    planId: string,
  ): Promise<{
    id: string;
    discountPercentage: number;
    discountAmount: number;
  } | null> {
    const now = new Date();

    // Find the promo code
    const promoCode = await prisma.promoCode.findFirst({
      where: {
        code: code.toUpperCase(),
        isActive: true,
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gte: now } }],
      },
    });

    if (!promoCode) {
      return null;
    }

    // Check usage limit
    if (promoCode.maxUsage && promoCode.usageCount >= promoCode.maxUsage) {
      return null;
    }

    // Check if user already used this promo code
    const existingUsage = await prisma.promoCodeUsage.findFirst({
      where: {
        promoCodeId: promoCode.id,
        userId,
      },
    });

    if (existingUsage && !promoCode.allowMultipleUse) {
      return null;
    }

    // Check if promo code is valid for this plan
    const applicablePlans = promoCode.applicablePlans as string[] | null;
    if (
      applicablePlans &&
      applicablePlans.length > 0 &&
      !applicablePlans.includes(planId)
    ) {
      return null;
    }

    // Check minimum purchase requirement
    if (promoCode.minimumPurchase) {
      const plan = await this.getPlan(planId);
      if (plan && plan.price < Number(promoCode.minimumPurchase)) {
        return null;
      }
    }

    return {
      id: promoCode.id,
      discountPercentage: promoCode.discountPercentage || 0,
      discountAmount: Number(promoCode.discountAmount) || 0,
    };
  }

  private calculatePeriodEnd(start: Date, period: BillingPeriod): Date {
    const end = new Date(start);

    switch (period) {
      case "WEEKLY":
        end.setDate(end.getDate() + 7);
        break;
      case "MONTHLY":
        end.setMonth(end.getMonth() + 1);
        break;
      case "QUARTERLY":
        end.setMonth(end.getMonth() + 3);
        break;
      case "ANNUAL":
        end.setFullYear(end.getFullYear() + 1);
        break;
    }

    return end;
  }

  private async createInvoice(params: {
    subscriptionId: string;
    amount: number;
    currency: string;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<void> {
    await prisma.subscriptionInvoice.create({
      data: {
        id: `inv_${nanoid(16)}`,
        subscriptionId: params.subscriptionId,
        amount: params.amount,
        currency: params.currency,
        status: params.amount === 0 ? "paid" : "pending",
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
        paidAt: params.amount === 0 ? new Date() : null,
      },
    });
  }

  private async processPayment(
    subscriptionId: string,
    amount: number,
    currency: string,
  ): Promise<boolean> {
    try {
      // Get the subscription with user and payment method details
      const subscription = await prisma.subscription.findUnique({
        where: { id: subscriptionId },
        include: {
          user: {
            include: {
              paymentMethods: {
                where: { isDefault: true },
                take: 1,
              },
            },
          },
        },
      });

      if (!subscription || !subscription.user) {
        console.error(
          `[Subscription] User not found for subscription ${subscriptionId}`,
        );
        return false;
      }

      const user = subscription.user;
      const paymentMethod = user.paymentMethods[0];

      // Create payment transaction record
      const paymentTx = await prisma.paymentTransaction.create({
        data: {
          userId: user.id,
          paymentMethodId: paymentMethod?.id,
          provider: paymentMethod?.provider || "PAYSTACK",
          amount: amount,
          currency: currency as any,
          status: "PENDING",
          metadata: {
            subscriptionId,
            type: "subscription_renewal",
          },
        },
      });

      // If user has a saved payment method, charge it
      if (paymentMethod && paymentMethod.token) {
        // Use Paystack recurring charge for cards
        if (
          paymentMethod.type === "CARD" &&
          paymentMethod.provider === "PAYSTACK"
        ) {
          const paystackResponse = await this.chargePaystackCard({
            email: user.email,
            amount: Math.round(amount * 100), // Paystack expects kobo/cents
            currency,
            authorizationCode: paymentMethod.token,
            reference: paymentTx.id,
            metadata: {
              subscriptionId,
              userId: user.id,
            },
          });

          if (paystackResponse.status === "success") {
            await prisma.paymentTransaction.update({
              where: { id: paymentTx.id },
              data: {
                status: "COMPLETED",
                providerReference: paystackResponse.reference,
                confirmedAt: new Date(),
              },
            });
            return true;
          }
        }

        // Mobile money payment (M-Pesa, MTN MoMo)
        if (paymentMethod.type === "MOBILE_MONEY") {
          const mobileMoneyResponse = await this.chargeMobileMoney({
            phoneNumber: paymentMethod.phoneNumber!,
            amount,
            currency,
            provider: paymentMethod.provider,
            reference: paymentTx.id,
            description: `UBI+ Subscription Renewal`,
          });

          if (
            mobileMoneyResponse.status === "pending" ||
            mobileMoneyResponse.status === "success"
          ) {
            await prisma.paymentTransaction.update({
              where: { id: paymentTx.id },
              data: {
                status:
                  mobileMoneyResponse.status === "success"
                    ? "COMPLETED"
                    : "PROCESSING",
                providerReference: mobileMoneyResponse.reference,
              },
            });
            return mobileMoneyResponse.status === "success";
          }
        }
      }

      // Mark as failed if no valid payment method
      await prisma.paymentTransaction.update({
        where: { id: paymentTx.id },
        data: {
          status: "FAILED",
          failureReason: "No valid payment method available",
          failedAt: new Date(),
        },
      });

      return false;
    } catch (error) {
      console.error(
        `[Subscription] Payment failed for ${subscriptionId}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Charge a saved Paystack card using authorization code
   */
  private async chargePaystackCard(params: {
    email: string;
    amount: number;
    currency: string;
    authorizationCode: string;
    reference: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ status: string; reference: string }> {
    const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecretKey) {
      throw new Error("PAYSTACK_SECRET_KEY not configured");
    }

    const response = await fetch(
      "https://api.paystack.co/transaction/charge_authorization",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${paystackSecretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: params.email,
          amount: params.amount,
          currency: params.currency,
          authorization_code: params.authorizationCode,
          reference: params.reference,
          metadata: params.metadata,
        }),
      },
    );

    const data = (await response.json()) as any;

    if (!response.ok || !data.status) {
      console.error("[Paystack] Charge failed:", data);
      return { status: "failed", reference: params.reference };
    }

    return {
      status: data.data?.status || "failed",
      reference: data.data?.reference || params.reference,
    };
  }

  /**
   * Charge mobile money (M-Pesa or MTN MoMo)
   */
  private async chargeMobileMoney(params: {
    phoneNumber: string;
    amount: number;
    currency: string;
    provider: string;
    reference: string;
    description: string;
  }): Promise<{ status: string; reference: string }> {
    const { provider, phoneNumber, amount, currency, reference, description } =
      params;

    // M-Pesa STK Push for Kenya
    if (provider === "MPESA" && currency === "KES") {
      return this.initiateMpesaStkPush({
        phoneNumber,
        amount,
        reference,
        description,
      });
    }

    // MTN MoMo for Ghana, Rwanda, Uganda
    if (provider.startsWith("MTN_MOMO")) {
      return this.initiateMomoPayment({
        phoneNumber,
        amount,
        currency,
        reference,
        description,
        country: provider.split("_")[2] || "GH", // MTN_MOMO_GH -> GH
      });
    }

    return { status: "failed", reference };
  }

  /**
   * Initiate M-Pesa STK Push
   */
  private async initiateMpesaStkPush(params: {
    phoneNumber: string;
    amount: number;
    reference: string;
    description: string;
  }): Promise<{ status: string; reference: string }> {
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const shortcode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;
    const callbackUrl = process.env.MPESA_CALLBACK_URL;

    if (!consumerKey || !consumerSecret || !shortcode || !passkey) {
      console.error("[M-Pesa] Missing configuration");
      return { status: "failed", reference: params.reference };
    }

    try {
      // Get OAuth token
      const authString = Buffer.from(
        `${consumerKey}:${consumerSecret}`,
      ).toString("base64");
      const tokenResponse = await fetch(
        "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
        {
          headers: { Authorization: `Basic ${authString}` },
        },
      );
      const tokenData = (await tokenResponse.json()) as any;
      const accessToken = tokenData.access_token;

      // Generate timestamp and password
      const timestamp = new Date()
        .toISOString()
        .replace(/[-:TZ.]/g, "")
        .slice(0, 14);
      const password = Buffer.from(
        `${shortcode}${passkey}${timestamp}`,
      ).toString("base64");

      // Initiate STK Push
      const stkResponse = await fetch(
        "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            BusinessShortCode: shortcode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerPayBillOnline",
            Amount: Math.round(params.amount),
            PartyA: params.phoneNumber.replace(/^\+/, ""),
            PartyB: shortcode,
            PhoneNumber: params.phoneNumber.replace(/^\+/, ""),
            CallBackURL: callbackUrl,
            AccountReference: params.reference.slice(0, 12),
            TransactionDesc: params.description.slice(0, 13),
          }),
        },
      );

      const stkData = (await stkResponse.json()) as any;

      if (stkData.ResponseCode === "0") {
        return { status: "pending", reference: stkData.CheckoutRequestID };
      }

      return { status: "failed", reference: params.reference };
    } catch (error) {
      console.error("[M-Pesa] STK Push error:", error);
      return { status: "failed", reference: params.reference };
    }
  }

  /**
   * Initiate MTN MoMo payment
   */
  private async initiateMomoPayment(params: {
    phoneNumber: string;
    amount: number;
    currency: string;
    reference: string;
    description: string;
    country: string;
  }): Promise<{ status: string; reference: string }> {
    const subscriptionKey =
      process.env[`MTN_MOMO_${params.country}_SUBSCRIPTION_KEY`];
    const apiUserId = process.env[`MTN_MOMO_${params.country}_API_USER`];
    const apiKey = process.env[`MTN_MOMO_${params.country}_API_KEY`];
    const callbackUrl = process.env.MTN_MOMO_CALLBACK_URL;

    if (!subscriptionKey || !apiUserId || !apiKey) {
      console.error(`[MoMo] Missing configuration for ${params.country}`);
      return { status: "failed", reference: params.reference };
    }

    try {
      // Get access token
      const credentials = Buffer.from(`${apiUserId}:${apiKey}`).toString(
        "base64",
      );
      const tokenResponse = await fetch(
        `https://proxy.momoapi.mtn.com/collection/token/`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${credentials}`,
            "Ocp-Apim-Subscription-Key": subscriptionKey,
          },
        },
      );
      const tokenData = (await tokenResponse.json()) as any;
      const accessToken = tokenData.access_token;

      // Initiate payment request
      const paymentResponse = await fetch(
        `https://proxy.momoapi.mtn.com/collection/v1_0/requesttopay`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-Reference-Id": params.reference,
            "X-Target-Environment":
              process.env.NODE_ENV === "production" ? "mtnghana" : "sandbox",
            "Ocp-Apim-Subscription-Key": subscriptionKey,
            "Content-Type": "application/json",
            ...(callbackUrl && { "X-Callback-Url": callbackUrl }),
          },
          body: JSON.stringify({
            amount: String(params.amount),
            currency: params.currency,
            externalId: params.reference,
            payer: {
              partyIdType: "MSISDN",
              partyId: params.phoneNumber.replace(/^\+/, ""),
            },
            payerMessage: params.description,
            payeeNote: `UBI Subscription - ${params.reference}`,
          }),
        },
      );

      if (paymentResponse.status === 202) {
        return { status: "pending", reference: params.reference };
      }

      return { status: "failed", reference: params.reference };
    } catch (error) {
      console.error("[MoMo] Payment error:", error);
      return { status: "failed", reference: params.reference };
    }
  }

  private formatPlan(plan: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    price: unknown;
    currency: string;
    billingPeriod: string;
    trialDays: number;
    features: unknown;
    maxFamilyMembers: number;
    isPopular: boolean;
    displayOrder: number;
    isActive: boolean;
  }): SubscriptionPlan {
    return {
      id: plan.id,
      name: plan.name,
      slug: plan.slug,
      description: plan.description || undefined,
      price: Number(plan.price),
      currency: plan.currency,
      billingPeriod: plan.billingPeriod as BillingPeriod,
      trialDays: plan.trialDays,
      features: plan.features as SubscriptionPlanFeatures,
      maxFamilyMembers: plan.maxFamilyMembers,
      isPopular: plan.isPopular,
      displayOrder: plan.displayOrder,
      isActive: plan.isActive,
    };
  }

  private formatSubscription(subscription: {
    id: string;
    userId: string;
    planId: string;
    plan?: {
      id: string;
      name: string;
      slug: string;
      description: string | null;
      price: unknown;
      currency: string;
      billingPeriod: string;
      trialDays: number;
      features: unknown;
      maxFamilyMembers: number;
      isPopular: boolean;
      displayOrder: number;
      isActive: boolean;
    };
    status: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    trialStart: Date | null;
    trialEnd: Date | null;
    cancelledAt: Date | null;
    cancelReason: string | null;
    cancelAtPeriodEnd: boolean;
    nextBillingAt: Date | null;
    benefitsUsed: unknown;
    createdAt: Date;
  }): Subscription {
    return {
      id: subscription.id,
      userId: subscription.userId,
      planId: subscription.planId,
      plan: subscription.plan ? this.formatPlan(subscription.plan) : undefined,
      status: subscription.status as SubscriptionStatus,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      trialStart: subscription.trialStart || undefined,
      trialEnd: subscription.trialEnd || undefined,
      cancelledAt: subscription.cancelledAt || undefined,
      cancelReason: subscription.cancelReason || undefined,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      nextBillingAt: subscription.nextBillingAt || undefined,
      benefitsUsed: subscription.benefitsUsed as
        | Record<string, number>
        | undefined,
      createdAt: subscription.createdAt,
    };
  }
}

// Export singleton
export const subscriptionService = new SubscriptionService();
