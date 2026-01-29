/**
 * Notification Service Client
 *
 * Provides a client for communicating with the notification-service
 * for sending push notifications, SMS, emails, and in-app messages.
 */

import { notificationLogger } from "./logger.js";
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
  // Safety & Emergency notifications
  SOS_TRIGGERED = "sos_triggered",
  SOS_RESOLVED = "sos_resolved",
  EMERGENCY_CONTACT_ALERT = "emergency_contact_alert",
  TRIP_SHARED = "trip_shared",
  TRIP_SHARE_ENDED = "trip_share_ended",
  SAFETY_CHECK = "safety_check",
  SAFETY_CHECK_TIMEOUT = "safety_check_timeout",
  CRASH_DETECTED = "crash_detected",
  ROUTE_DEVIATION = "route_deviation",
  DRIVER_ARRIVED = "driver_arrived",
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
        notificationLogger.warn(
          { userId: payload.userId },
          "User not found for notification",
        );
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
        notificationLogger.error(
          { err: errorData },
          "Notification service error",
        );
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
      notificationLogger.error({ err: error }, "Failed to send notification");

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
      notificationLogger.error({ err: error }, "Failed to queue notification");
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
    const noteText = note ? `: "${note}"` : ".";
    return this.send({
      userId: payerId,
      title: "Money Request",
      body: `${requesterName} requested ${currency} ${amount.toLocaleString()}${noteText}`,
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

  // ===========================================
  // SAFETY & EMERGENCY METHODS
  // ===========================================

  /**
   * Send emergency SMS to contacts
   */
  async sendEmergencySMS(
    phoneNumber: string,
    userName: string,
    locationLink: string,
    emergencyType: "sos" | "crash" | "route_deviation" = "sos",
  ): Promise<SendResult> {
    const messages: Record<string, string> = {
      sos: `🚨 EMERGENCY: ${userName} has triggered an SOS alert on UBI. Track their live location: ${locationLink}. If unreachable, call emergency services.`,
      crash: `🚨 CRASH DETECTED: ${userName} may have been in an accident. Track their location: ${locationLink}. Please try to contact them immediately.`,
      route_deviation: `⚠️ SAFETY ALERT: ${userName}'s trip has deviated from the expected route. Track their location: ${locationLink}.`,
    };

    try {
      const response = await fetch(
        `${NOTIFICATION_SERVICE_URL}/api/v1/sms/send`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(NOTIFICATION_API_KEY && {
              Authorization: `Bearer ${NOTIFICATION_API_KEY}`,
            }),
          },
          body: JSON.stringify({
            to: phoneNumber,
            message: messages[emergencyType],
            priority: "high",
          }),
        },
      );

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as any;
        notificationLogger.error(
          { err: errorData, phoneNumber: phoneNumber.slice(-4) },
          "Emergency SMS failed",
        );
        return { success: false, error: errorData.message || "SMS failed" };
      }

      const result = (await response.json()) as any;
      notificationLogger.info(
        { phoneNumber: phoneNumber.slice(-4), emergencyType },
        "Emergency SMS sent successfully",
      );
      return { success: true, notificationId: result.data?.messageId };
    } catch (error) {
      notificationLogger.error({ err: error }, "Failed to send emergency SMS");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to send emergency SMS",
      };
    }
  }

  /**
   * Send emergency push notification
   */
  async sendEmergencyPush(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<SendResult> {
    return this.send({
      userId,
      title,
      body,
      type: NotificationType.SOS_TRIGGERED,
      priority: NotificationPriority.URGENT,
      channels: [NotificationChannel.PUSH],
      data: {
        ...data,
        isEmergency: true,
        sound: "emergency_alert",
        vibrate: true,
      },
    });
  }

  /**
   * Notify emergency contacts about SOS
   */
  async notifyEmergencyContacts(
    contacts: Array<{
      phone: string;
      email?: string;
      whatsappEnabled?: boolean;
    }>,
    userName: string,
    locationLink: string,
    incidentId: string,
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    for (const contact of contacts) {
      // Send SMS
      const smsResult = await this.sendEmergencySMS(
        contact.phone,
        userName,
        locationLink,
        "sos",
      );
      if (smsResult.success) {
        sent++;
      } else {
        failed++;
      }

      // Send WhatsApp if enabled (via notification service)
      if (contact.whatsappEnabled) {
        try {
          await fetch(`${NOTIFICATION_SERVICE_URL}/api/v1/whatsapp/send`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(NOTIFICATION_API_KEY && {
                Authorization: `Bearer ${NOTIFICATION_API_KEY}`,
              }),
            },
            body: JSON.stringify({
              to: contact.phone,
              template: "emergency_sos",
              parameters: {
                userName,
                locationLink,
                incidentId,
              },
            }),
          });
        } catch (error) {
          notificationLogger.warn(
            { err: error },
            "WhatsApp emergency notification failed",
          );
        }
      }
    }

    return { sent, failed };
  }

  /**
   * Notify contact about trip sharing
   */
  async notifyTripShared(
    contactPhone: string,
    contactEmail: string | undefined,
    riderName: string,
    shareLink: string,
    estimatedArrival?: string,
  ): Promise<SendResult> {
    const message =
      `📍 ${riderName} is sharing their UBI trip with you. ` +
      `Track their journey: ${shareLink}` +
      (estimatedArrival ? `. ETA: ${estimatedArrival}` : "");

    try {
      // Send SMS
      const response = await fetch(
        `${NOTIFICATION_SERVICE_URL}/api/v1/sms/send`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(NOTIFICATION_API_KEY && {
              Authorization: `Bearer ${NOTIFICATION_API_KEY}`,
            }),
          },
          body: JSON.stringify({
            to: contactPhone,
            message,
          }),
        },
      );

      // Also send email if available
      if (contactEmail) {
        await fetch(`${NOTIFICATION_SERVICE_URL}/api/v1/email/send`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(NOTIFICATION_API_KEY && {
              Authorization: `Bearer ${NOTIFICATION_API_KEY}`,
            }),
          },
          body: JSON.stringify({
            to: contactEmail,
            subject: `${riderName} is sharing their trip with you`,
            template: "trip_shared",
            data: {
              riderName,
              shareLink,
              estimatedArrival,
            },
          }),
        });
      }

      if (!response.ok) {
        return {
          success: false,
          error: "Failed to send trip share notification",
        };
      }

      notificationLogger.info(
        { contactPhone: contactPhone.slice(-4) },
        "Trip share notification sent",
      );
      return { success: true };
    } catch (error) {
      notificationLogger.error({ err: error }, "Failed to notify trip share");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Notify contact that trip has ended safely
   */
  async notifyTripEnded(
    contactPhone: string,
    riderName: string,
  ): Promise<SendResult> {
    const message = `✅ ${riderName} has arrived safely at their destination.`;

    try {
      const response = await fetch(
        `${NOTIFICATION_SERVICE_URL}/api/v1/sms/send`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(NOTIFICATION_API_KEY && {
              Authorization: `Bearer ${NOTIFICATION_API_KEY}`,
            }),
          },
          body: JSON.stringify({
            to: contactPhone,
            message,
          }),
        },
      );

      if (!response.ok) {
        return {
          success: false,
          error: "Failed to send trip end notification",
        };
      }

      return { success: true };
    } catch (error) {
      notificationLogger.error({ err: error }, "Failed to notify trip end");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Send safety check notification to rider
   */
  async sendSafetyCheck(
    userId: string,
    tripId: string,
    reason: string,
    checkId: string,
  ): Promise<SendResult> {
    return this.send({
      userId,
      title: "Safety Check 🛡️",
      body: `Are you okay? ${reason}`,
      type: NotificationType.SAFETY_CHECK,
      priority: NotificationPriority.URGENT,
      channels: [NotificationChannel.PUSH, NotificationChannel.IN_APP],
      data: {
        tripId,
        checkId,
        reason,
        requiresResponse: true,
        responseOptions: ["I'm fine", "Need help"],
        timeoutSeconds: 60,
      },
    });
  }

  /**
   * Notify about crash detection
   */
  async notifyCrashDetected(
    userId: string,
    tripId: string,
    location: { lat: number; lng: number },
  ): Promise<SendResult> {
    return this.send({
      userId,
      title: "Crash Detected! 🚨",
      body: "We detected a possible accident. Emergency contacts will be notified if you don't respond.",
      type: NotificationType.CRASH_DETECTED,
      priority: NotificationPriority.URGENT,
      channels: [NotificationChannel.PUSH, NotificationChannel.SMS],
      data: {
        tripId,
        location,
        requiresResponse: true,
        autoEscalateSeconds: 30,
      },
    });
  }

  /**
   * Notify about route deviation
   */
  async notifyRouteDeviation(
    userId: string,
    tripId: string,
    deviationDetails: {
      expectedRoute: string;
      currentLocation: { lat: number; lng: number };
      deviationDistance: number;
    },
  ): Promise<SendResult> {
    return this.send({
      userId,
      title: "Route Change Detected",
      body: "Your trip has deviated from the expected route. Tap to view details.",
      type: NotificationType.ROUTE_DEVIATION,
      priority: NotificationPriority.HIGH,
      channels: [NotificationChannel.PUSH, NotificationChannel.IN_APP],
      data: {
        tripId,
        ...deviationDetails,
      },
    });
  }
}

// Export singleton instance
export const notificationClient = new NotificationClient();
