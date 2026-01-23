/**
 * Subscription Service (UBI+)
 * Premium subscription management with billing
 */

import { nanoid } from "nanoid";
import { subscriptionLogger } from "../lib/logger";
import {
  notificationClient,
  NotificationPriority,
  NotificationType,
} from "../lib/notification-client";
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
// PROMO CODE TYPES
// ===========================================

interface PromoCode {
  id: string;
  code: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  maxUses: number | null;
  usedCount: number;
  validFrom: Date;
  validUntil: Date | null;
  applicablePlanIds: string[] | null;
  isActive: boolean;
}

interface PromoValidationResult {
  valid: boolean;
  promo?: PromoCode;
  discountAmount?: number;
  error?: string;
}

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
   * Validate and get promo code details
   */
  async validatePromoCode(
    code: string,
    planId: string,
    planPrice: number,
  ): Promise<PromoValidationResult> {
    const promo = await prisma.promoCode.findFirst({
      where: {
        code: code.toUpperCase(),
        isActive: true,
      },
    });

    if (!promo) {
      return { valid: false, error: "Invalid promo code" };
    }

    // Check validity period
    const now = new Date();
    if (promo.validFrom > now) {
      return { valid: false, error: "Promo code is not yet active" };
    }
    if (promo.validUntil && promo.validUntil < now) {
      return { valid: false, error: "Promo code has expired" };
    }

    // Check usage limit
    if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) {
      return { valid: false, error: "Promo code usage limit reached" };
    }

    // Check if applicable to this plan
    const applicablePlans = promo.applicablePlanIds as string[] | null;
    if (
      applicablePlans &&
      applicablePlans.length > 0 &&
      !applicablePlans.includes(planId)
    ) {
      return { valid: false, error: "Promo code not applicable to this plan" };
    }

    // Calculate discount
    let discountAmount: number;
    if (promo.discountType === "percentage") {
      discountAmount = Math.round((planPrice * promo.discountValue) / 100);
    } else {
      discountAmount = Math.min(promo.discountValue, planPrice);
    }

    return {
      valid: true,
      promo: promo as unknown as PromoCode,
      discountAmount,
    };
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
    let periodStart = now;
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
    let promoId: string | undefined;

    if (promoCode) {
      const promoValidation = await this.validatePromoCode(
        promoCode,
        plan.id,
        plan.price,
      );

      if (!promoValidation.valid) {
        throw new Error(promoValidation.error || "Invalid promo code");
      }

      discountApplied = true;
      discountAmount = promoValidation.discountAmount || 0;
      promoId = promoValidation.promo?.id;

      // Increment promo code usage
      await prisma.promoCode.update({
        where: { id: promoId },
        data: { usedCount: { increment: 1 } },
      });

      subscriptionLogger.info(
        { promoCode, discountAmount, planId: plan.id },
        "Promo code applied to subscription",
      );
    }

    const subscriptionId = `sub_${nanoid(16)}`;
    const finalPrice = Math.max(0, plan.price - discountAmount);

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
          promoId: promoId || null,
          discountApplied,
          discountAmount,
          originalPrice: plan.price,
          finalPrice,
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
      (subscription.currentPeriodEnd.getTime() - Date.now()) /
        (1000 * 60 * 60 * 24),
    );

    const updated = await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        planId: newPlan.id,
        metadata: {
          ...(subscription.metadata as Record<string, unknown>),
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
    if (!subscription?.plan) {
      return null;
    }

    const features = subscription.plan.features;
    const used =
      (subscription.benefitsUsed as Record<string, number> | null) ?? {};
    const freeCancellations = features.freeCancellations;

    return {
      freeDeliveriesUsed: used.freeDeliveries ?? 0,
      freeDeliveriesRemaining: features.freeDelivery ? "unlimited" : 0,
      freeCancellationsUsed: used.freeCancellations ?? 0,
      freeCancellationsRemaining:
        freeCancellations === "unlimited"
          ? "unlimited"
          : Math.max(
              0,
              Number(freeCancellations) - (used.freeCancellations ?? 0),
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
            freeDeliveries: (used.freeDeliveries ?? 0) + 1,
          },
        },
      });

      return { success: true, remaining: "unlimited" };
    }

    if (benefit === "freeCancellation") {
      const limit = features.freeCancellations;
      const currentUsed = used.freeCancellations ?? 0;
      const numericLimit = Number(limit);

      if (limit !== "unlimited" && currentUsed >= numericLimit) {
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
          limit === "unlimited" ? "unlimited" : numericLimit - currentUsed - 1,
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
        subscriptionLogger.error(
          { err: error, subscriptionId: subscription.id },
          "Renewal failed",
        );
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
          user: true,
        },
      });

      if (!subscription) {
        subscriptionLogger.error(
          { subscriptionId },
          "Subscription not found for payment",
        );
        return false;
      }

      // Get user's wallet
      const wallet = await prisma.wallet.findFirst({
        where: {
          userId: subscription.userId,
          currency,
        },
      });

      if (!wallet) {
        subscriptionLogger.error(
          { subscriptionId, userId: subscription.userId, currency },
          "Wallet not found for subscription payment",
        );
        return false;
      }

      // Check wallet balance
      const walletBalance = Number(wallet.balance);
      if (walletBalance < amount) {
        subscriptionLogger.warn(
          { subscriptionId, balance: walletBalance, required: amount },
          "Insufficient wallet balance for subscription payment",
        );

        // Notify user about payment failure
        await notificationClient.send({
          userId: subscription.userId,
          title: "Subscription Payment Failed",
          body: `Your subscription payment of ${currency} ${amount.toLocaleString()} failed due to insufficient balance. Please top up your wallet to continue enjoying UBI+ benefits.`,
          type: NotificationType.PAYMENT_FAILED,
          priority: NotificationPriority.HIGH,
          data: {
            subscriptionId,
            amount,
            currency,
            reason: "insufficient_balance",
          },
        });

        return false;
      }

      // Debit wallet for subscription
      await prisma.$transaction(async (tx) => {
        // Deduct from wallet
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balance: { decrement: amount },
          },
        });

        // Create wallet transaction
        await tx.walletTransaction.create({
          data: {
            id: `wtxn_${nanoid(16)}`,
            walletId: wallet.id,
            type: "SUBSCRIPTION",
            amount: -amount,
            balance: walletBalance - amount,
            reference: `sub_${subscriptionId}_${Date.now()}`,
            description: "UBI+ subscription payment",
            status: "COMPLETED",
          },
        });

        // Update the subscription invoice
        await tx.subscriptionInvoice.updateMany({
          where: {
            subscriptionId,
            status: "pending",
          },
          data: {
            status: "paid",
            paidAt: new Date(),
          },
        });
      });

      // Notify user about successful payment
      await notificationClient.send({
        userId: subscription.userId,
        title: "Subscription Renewed",
        body: `Your UBI+ subscription has been renewed for ${currency} ${amount.toLocaleString()}. Enjoy your premium benefits!`,
        type: NotificationType.SUBSCRIPTION_RENEWED,
        priority: NotificationPriority.NORMAL,
        data: {
          subscriptionId,
          amount,
          currency,
        },
      });

      subscriptionLogger.info(
        { subscriptionId, amount, currency },
        "Subscription payment processed successfully",
      );

      return true;
    } catch (error) {
      subscriptionLogger.error(
        { err: error, subscriptionId },
        "Failed to process subscription payment",
      );
      return false;
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
