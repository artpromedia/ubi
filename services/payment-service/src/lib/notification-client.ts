/**
 * Notification Service Client
 *
 * Provides a client for communicating with the notification-service
 * for sending push notifications, SMS, emails, and in-app messages.
 */

import { prisma } from "./prisma";

// Notification service configuration
const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL || "http://notification-service:4006";
const NOTIFICATION_API_KEY = process.env.NOTIFICATION_SERVICE_API_KEY;

// Types
export interface NotificationPayload {
  userId: string;
  title: string;
  body: string;
  type: NotificationType;
  priority?: NotificationPriority;
  data?: Record<string, unknown>;
  channels?: NotificationChannel[];
}

export enum NotificationType {
  SAVINGS_TARGET_REACHED = "savings_target_reached",
  LOAN_OVERDUE = "loan_overdue",
  LOAN_DUE_REMINDER = "loan_due_reminder",
  TRANSFER_COMPLETED = "transfer_completed",
  TRANSFER_RECEIVED = "transfer_received",
  MONEY_REQUEST = "money_request",
  MONEY_REQUEST_DECLINED = "money_request_declined",
  PAYMENT_SUCCESS = "payment_success",
  PAYMENT_FAILED = "payment_failed",
  REFUND_PROCESSED = "refund_processed",
  WALLET_LOW_BALANCE = "wallet_low_balance",
  SUBSCRIPTION_RENEWED = "subscription_renewed",
  SUBSCRIPTION_EXPIRING = "subscription_expiring",
  PAYOUT_COMPLETED = "payout_completed",
}

export enum NotificationPriority {
  LOW = "low",
  NORMAL = "normal",
  HIGH = "high",
  URGENT = "urgent",
}

export enum NotificationChannel {
  PUSH = "push",
  SMS = "sms",
  EMAIL = "email",
  IN_APP = "in_app",
  WHATSAPP = "whatsapp",
}

interface SendResult {
  success: boolean;
  notificationId?: string;
  error?: string;
  channels?: {
    channel: NotificationChannel;
    success: boolean;
    messageId?: string;
  }[];
}

class NotificationClient {
  /**
   * Send a notification to a user
   */
  async send(payload: NotificationPayload): Promise<SendResult> {
    try {
      // Get user's notification preferences
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          id: true,
          email: true,
          phone: true,
          firstName: true,
          lastName: true,
        },
      });

      if (!user) {
        console.warn(`[Notification] User not found: ${payload.userId}`);
        return { success: false, error: "User not found" };
      }

      // Determine channels based on priority and user preferences
      const channels =
        payload.channels ||
        this.getDefaultChannels(payload.type, payload.priority);

      // Send via notification service
      const response = await fetch(
        `${NOTIFICATION_SERVICE_URL}/v1/notifications/send`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(NOTIFICATION_API_KEY && {
              Authorization: `Bearer ${NOTIFICATION_API_KEY}`,
            }),
          },
          body: JSON.stringify({
            userId: payload.userId,
            email: user.email,
            phone: user.phone,
            title: payload.title,
            body: payload.body,
            type: payload.type,
            priority: payload.priority || NotificationPriority.NORMAL,
            channels,
            data: {
              ...payload.data,
              userName: `${user.firstName} ${user.lastName}`.trim(),
            },
          }),
        },
      );

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as any;
        console.error("[Notification] Service error:", errorData);
        return {
          success: false,
          error: errorData.message || "Notification service error",
        };
      }

      const result = (await response.json()) as any;
      return {
        success: true,
        notificationId: result.data?.notificationId,
        channels: result.data?.channels,
      };
    } catch (error) {
      console.error("[Notification] Send error:", error);

      // Fallback: Store notification in database for later delivery
      await this.queueNotification(payload);

      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to send notification",
      };
    }
  }

  /**
   * Send bulk notifications
   */
  async sendBulk(
    payloads: NotificationPayload[],
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    // Process in batches of 50
    const batchSize = 50;
    for (let i = 0; i < payloads.length; i += batchSize) {
      const batch = payloads.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(async (p) => this.send(p)));

      for (const result of results) {
        if (result.success) {
          sent++;
        } else {
          failed++;
        }
      }
    }

    return { sent, failed };
  }

  /**
   * Queue notification for later delivery (fallback)
   */
  private async queueNotification(payload: NotificationPayload): Promise<void> {
    try {
      await prisma.notification.create({
        data: {
          userId: payload.userId,
          title: payload.title,
          body: payload.body,
          type: payload.type,
          priority: payload.priority || NotificationPriority.NORMAL,
          data: payload.data as any,
          channels: payload.channels || [],
          status: "PENDING",
        },
      });
    } catch (error) {
      console.error("[Notification] Failed to queue notification:", error);
    }
  }

  /**
   * Get default channels based on notification type and priority
   */
  private getDefaultChannels(
    type: NotificationType,
    priority?: NotificationPriority,
  ): NotificationChannel[] {
    // High priority notifications go to all channels
    if (
      priority === NotificationPriority.HIGH ||
      priority === NotificationPriority.URGENT
    ) {
      return [
        NotificationChannel.PUSH,
        NotificationChannel.SMS,
        NotificationChannel.IN_APP,
      ];
    }

    // Map notification types to appropriate channels
    switch (type) {
      case NotificationType.LOAN_OVERDUE:
      case NotificationType.PAYMENT_FAILED:
        return [
          NotificationChannel.PUSH,
          NotificationChannel.SMS,
          NotificationChannel.EMAIL,
        ];

      case NotificationType.TRANSFER_RECEIVED:
      case NotificationType.MONEY_REQUEST:
        return [NotificationChannel.PUSH, NotificationChannel.IN_APP];

      case NotificationType.SAVINGS_TARGET_REACHED:
      case NotificationType.SUBSCRIPTION_RENEWED:
        return [
          NotificationChannel.PUSH,
          NotificationChannel.IN_APP,
          NotificationChannel.EMAIL,
        ];

      case NotificationType.LOAN_DUE_REMINDER:
      case NotificationType.SUBSCRIPTION_EXPIRING:
        return [NotificationChannel.PUSH, NotificationChannel.SMS];

      default:
        return [NotificationChannel.PUSH, NotificationChannel.IN_APP];
    }
  }

  // ===========================================
  // CONVENIENCE METHODS
  // ===========================================

  /**
   * Notify user that savings target has been reached
   */
  async notifySavingsTargetReached(
    userId: string,
    pocketName: string,
    targetAmount: number,
    currency: string,
  ): Promise<SendResult> {
    return this.send({
      userId,
      title: "Savings Goal Achieved! 🎉",
      body: `Congratulations! You've reached your ${currency} ${targetAmount.toLocaleString()} savings target for "${pocketName}".`,
      type: NotificationType.SAVINGS_TARGET_REACHED,
      priority: NotificationPriority.HIGH,
      data: { pocketName, targetAmount, currency },
    });
  }

  /**
   * Notify user about overdue loan
   */
  async notifyLoanOverdue(
    userId: string,
    loanId: string,
    amountDue: number,
    currency: string,
    daysOverdue: number,
  ): Promise<SendResult> {
    return this.send({
      userId,
      title: "Loan Payment Overdue",
      body: `Your loan payment of ${currency} ${amountDue.toLocaleString()} is ${daysOverdue} day${daysOverdue > 1 ? "s" : ""} overdue. Please make a payment to avoid penalties.`,
      type: NotificationType.LOAN_OVERDUE,
      priority: NotificationPriority.HIGH,
      data: { loanId, amountDue, currency, daysOverdue },
    });
  }

  /**
   * Notify user about completed transfer
   */
  async notifyTransferCompleted(
    senderId: string,
    recipientId: string,
    amount: number,
    currency: string,
    recipientName: string,
  ): Promise<{ sender: SendResult; recipient: SendResult }> {
    const senderResult = await this.send({
      userId: senderId,
      title: "Transfer Successful",
      body: `You sent ${currency} ${amount.toLocaleString()} to ${recipientName}.`,
      type: NotificationType.TRANSFER_COMPLETED,
      data: { amount, currency, recipientName },
    });

    const recipientResult = await this.send({
      userId: recipientId,
      title: "Money Received! 💰",
      body: `You received ${currency} ${amount.toLocaleString()}.`,
      type: NotificationType.TRANSFER_RECEIVED,
      priority: NotificationPriority.HIGH,
      data: { amount, currency },
    });

    return { sender: senderResult, recipient: recipientResult };
  }

  /**
   * Notify user about money request
   */
  async notifyMoneyRequest(
    payerId: string,
    requesterId: string,
    amount: number,
    currency: string,
    requesterName: string,
    note?: string,
  ): Promise<SendResult> {
    return this.send({
      userId: payerId,
      title: "Money Request",
      body: `${requesterName} requested ${currency} ${amount.toLocaleString()}${note ? `: "${note}"` : "."}`,
      type: NotificationType.MONEY_REQUEST,
      priority: NotificationPriority.HIGH,
      data: { requesterId, amount, currency, requesterName, note },
    });
  }

  /**
   * Notify user that their money request was declined
   */
  async notifyRequestDeclined(
    requesterId: string,
    payerName: string,
    amount: number,
    currency: string,
  ): Promise<SendResult> {
    return this.send({
      userId: requesterId,
      title: "Request Declined",
      body: `${payerName} declined your request for ${currency} ${amount.toLocaleString()}.`,
      type: NotificationType.MONEY_REQUEST_DECLINED,
      data: { payerName, amount, currency },
    });
  }

  /**
   * Notify user about successful refund
   */
  async notifyRefundProcessed(
    userId: string,
    amount: number,
    currency: string,
    reason: string,
  ): Promise<SendResult> {
    return this.send({
      userId,
      title: "Refund Processed",
      body: `${currency} ${amount.toLocaleString()} has been refunded to your wallet.`,
      type: NotificationType.REFUND_PROCESSED,
      data: { amount, currency, reason },
    });
  }

  /**
   * Notify driver about payout
   */
  async notifyPayoutCompleted(
    userId: string,
    amount: number,
    currency: string,
    payoutMethod: string,
  ): Promise<SendResult> {
    return this.send({
      userId,
      title: "Payout Successful! 💵",
      body: `${currency} ${amount.toLocaleString()} has been sent to your ${payoutMethod}.`,
      type: NotificationType.PAYOUT_COMPLETED,
      priority: NotificationPriority.HIGH,
      data: { amount, currency, payoutMethod },
    });
  }
}

// Export singleton instance
export const notificationClient = new NotificationClient();
