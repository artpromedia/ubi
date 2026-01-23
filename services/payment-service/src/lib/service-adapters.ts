/**
 * Service Adapters for Driver Experience Features
 *
 * These adapters wrap the actual service clients to provide
 * the interfaces expected by the driver service classes.
 */

import { analyticsService } from "./analytics.js";
import { logger } from "./logger.js";
import {
  NotificationChannel,
  notificationClient,
  NotificationPriority,
} from "./notification-client.js";

// ===========================================
// Analytics Adapter
// ===========================================

export interface IDriverAnalyticsService {
  track(event: string, properties: Record<string, unknown>): Promise<void>;
}

/**
 * Analytics adapter for driver services
 * Wraps the analytics service with driver-specific context
 */
export const driverAnalyticsAdapter: IDriverAnalyticsService = {
  async track(
    event: string,
    properties: Record<string, unknown>,
  ): Promise<void> {
    const driverId = properties.driverId as string | undefined;

    await analyticsService.track(
      `driver.${event}`,
      {
        ...properties,
        category: "driver_experience",
      },
      driverId,
    );
  },
};

// ===========================================
// Notification Adapter
// ===========================================

export interface DriverNotification {
  title: string;
  body: string;
  type?: string;
  data?: Record<string, unknown>;
  priority?: "low" | "normal" | "high" | "urgent";
  channels?: Array<"push" | "sms" | "email" | "in_app">;
}

export interface IDriverNotificationService {
  send(
    userId: string,
    notification: DriverNotification,
  ): Promise<{ success: boolean; error?: string }>;
  sendBulk(
    notifications: Array<{ userId: string; notification: DriverNotification }>,
  ): Promise<{ sent: number; failed: number }>;
}

/**
 * Notification adapter for driver services
 * Maps driver notification types to the notification client
 */
export const driverNotificationAdapter: IDriverNotificationService = {
  async send(userId: string, notification: DriverNotification) {
    try {
      const result = await notificationClient.send({
        userId,
        title: notification.title,
        body: notification.body,
        type: (notification.type || "DRIVER_NOTIFICATION") as any,
        priority: mapPriority(notification.priority),
        channels: notification.channels?.map(mapChannel),
        data: notification.data,
      });

      return {
        success: result.success,
        error: result.error,
      };
    } catch (error) {
      logger.error({ error, userId }, "Failed to send driver notification");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },

  async sendBulk(notifications) {
    const results = await Promise.all(
      notifications.map(async ({ userId, notification }) =>
        this.send(userId, notification),
      ),
    );

    return {
      sent: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    };
  },
};

function mapPriority(priority?: string): NotificationPriority {
  switch (priority) {
    case "low":
      return NotificationPriority.LOW;
    case "high":
      return NotificationPriority.HIGH;
    case "urgent":
      return NotificationPriority.URGENT;
    default:
      return NotificationPriority.NORMAL;
  }
}

function mapChannel(channel: string): NotificationChannel {
  switch (channel) {
    case "push":
      return NotificationChannel.PUSH;
    case "sms":
      return NotificationChannel.SMS;
    case "email":
      return NotificationChannel.EMAIL;
    case "in_app":
      return NotificationChannel.IN_APP;
    default:
      return NotificationChannel.PUSH;
  }
}

// ===========================================
// Payment Adapter
// ===========================================

export interface PaymentRequest {
  userId: string;
  amount: number;
  currency: string;
  type: "withdrawal" | "payout" | "benefit_purchase" | "fee";
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  error?: string;
}

export interface IDriverPaymentService {
  process(payment: PaymentRequest): Promise<PaymentResult>;
  processWithdrawal(
    userId: string,
    amount: number,
    currency: string,
    method: string,
  ): Promise<PaymentResult>;
  processBenefitPurchase(
    userId: string,
    benefitId: string,
    amount: number,
    currency: string,
  ): Promise<PaymentResult>;
}

/**
 * Payment adapter for driver services
 * Integrates with wallet and payout services
 */
class DriverPaymentAdapter implements IDriverPaymentService {
  async process(payment: PaymentRequest): Promise<PaymentResult> {
    try {
      // Import dynamically to avoid circular dependencies
      const { walletService } = await import("../services/wallet.service.js");

      switch (payment.type) {
        case "withdrawal":
        case "payout":
          return this.processWithdrawal(
            payment.userId,
            payment.amount,
            payment.currency,
            (payment.metadata?.method as string) || "bank_transfer",
          );

        case "benefit_purchase":
          return this.processBenefitPurchase(
            payment.userId,
            (payment.metadata?.benefitId as string) || "",
            payment.amount,
            payment.currency,
          );

        case "fee":
          // Deduct fee from wallet
          const feeResult = await walletService.debit(
            payment.userId,
            payment.amount,
            payment.currency,
            "FEE",
            payment.description || "Service fee",
          );
          return {
            success: feeResult.success,
            transactionId: feeResult.transactionId,
            error: feeResult.error,
          };

        default:
          return {
            success: false,
            error: `Unknown payment type: ${payment.type}`,
          };
      }
    } catch (error) {
      logger.error({ error, payment }, "Payment processing failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Payment failed",
      };
    }
  }

  async processWithdrawal(
    userId: string,
    amount: number,
    currency: string,
    method: string,
  ): Promise<PaymentResult> {
    try {
      const { payoutService } = await import("../services/payout.service.js");

      const result = await payoutService.initiatePayout({
        userId,
        amount,
        currency,
        method: method as any,
        description: "Driver withdrawal",
      });

      return {
        success: result.success,
        transactionId: result.payoutId,
        error: result.error,
      };
    } catch (error) {
      logger.error({ error, userId, amount }, "Withdrawal failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Withdrawal failed",
      };
    }
  }

  async processBenefitPurchase(
    userId: string,
    benefitId: string,
    amount: number,
    currency: string,
  ): Promise<PaymentResult> {
    try {
      const { walletService } = await import("../services/wallet.service.js");

      // Debit from driver's wallet for benefit purchase
      const result = await walletService.debit(
        userId,
        amount,
        currency,
        "BENEFIT_PURCHASE",
        `Benefit purchase: ${benefitId}`,
      );

      if (result.success) {
        // Track analytics
        await analyticsService.track(
          "driver.benefit_purchased",
          {
            driverId: userId,
            benefitId,
            amount,
            currency,
          },
          userId,
        );
      }

      return {
        success: result.success,
        transactionId: result.transactionId,
        error: result.error,
      };
    } catch (error) {
      logger.error({ error, userId, benefitId }, "Benefit purchase failed");
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Benefit purchase failed",
      };
    }
  }
}

export const driverPaymentAdapter = new DriverPaymentAdapter();

// ===========================================
// Export All Adapters
// ===========================================

export const serviceAdapters = {
  analytics: driverAnalyticsAdapter,
  notification: driverNotificationAdapter,
  payment: driverPaymentAdapter,
};

export default serviceAdapters;
