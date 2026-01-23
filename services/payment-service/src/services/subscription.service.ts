/**
 * Subscription Service (UBI+)
 * Premium subscription management with billing
 */

import { nanoid } from "nanoid";
import { subscriptionLogger } from "../lib/logger";
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
    if (promoCode) {
      // TODO: Validate promo code and apply discount
      discountApplied = true;
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
    _subscriptionId: string,
    _amount: number,
    _currency: string,
  ): Promise<boolean> {
    // TODO: Integrate with actual payment processor
    // For now, simulate success
    return true;
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
