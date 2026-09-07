/**
 * Notification Types
 *
 * The notification enums are owned by the Prisma schema (the database is the
 * source of truth for which channels/types/statuses/priorities are persistable).
 * We re-export the generated enums so route handlers and DB writes share one
 * nominal type — a service-local copy would be structurally incompatible with
 * the Prisma client's `where`/`data` inputs even when the members line up.
 */

import {
  NotificationChannel,
  NotificationType,
  NotificationStatus,
  NotificationPriority,
} from "@prisma/client";

export {
  NotificationChannel,
  NotificationType,
  NotificationStatus,
  NotificationPriority,
};

// Push notification payload
export interface PushNotification {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  image?: string;
  badge?: number;
  sound?: string;
  priority?: NotificationPriority;
  ttl?: number; // Time to live in seconds
  collapseKey?: string;
}

// SMS notification payload
export interface SMSNotification {
  userId?: string;
  phone: string;
  message: string;
  senderId?: string;
}

// Email notification payload
export interface EmailNotification {
  userId?: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  templateId?: string;
  templateData?: Record<string, any>;
  from?: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: string;
    contentType: string;
  }>;
}

// In-app notification
export interface InAppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, any>;
  icon?: string;
  image?: string;
  actionUrl?: string;
  status: NotificationStatus;
  readAt?: Date;
  createdAt: Date;
}

// User notification preferences
export interface NotificationPreferences {
  userId: string;
  push: {
    enabled: boolean;
    rides: boolean;
    orders: boolean;
    deliveries: boolean;
    payments: boolean;
    promotions: boolean;
    system: boolean;
  };
  sms: {
    enabled: boolean;
    rides: boolean;
    orders: boolean;
    deliveries: boolean;
    otp: boolean;
  };
  email: {
    enabled: boolean;
    receipts: boolean;
    promotions: boolean;
    newsletter: boolean;
    accountUpdates: boolean;
  };
  quiet: {
    enabled: boolean;
    startTime: string; // HH:mm
    endTime: string;
  };
}

// Notification template
export interface NotificationTemplate {
  id: string;
  type: NotificationType;
  channel: NotificationChannel;
  locale: string;
  title: string;
  body: string;
  htmlBody?: string;
  variables: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Batch notification request
export interface BatchNotificationRequest {
  userIds: string[];
  channel: NotificationChannel;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, any>;
}

// Notification event from other services
export interface NotificationEvent {
  type: string;
  userId?: string;
  data: Record<string, any>;
  timestamp: string;
}
