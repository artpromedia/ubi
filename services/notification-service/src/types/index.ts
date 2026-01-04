/**
 * Notification Types
 */

// Notification channels
export enum NotificationChannel {
  PUSH = "PUSH",
  SMS = "SMS",
  EMAIL = "EMAIL",
  IN_APP = "IN_APP",
}

// Notification types
export enum NotificationType {
  // Account & Security
  WELCOME = "WELCOME",
  EMAIL_VERIFICATION = "EMAIL_VERIFICATION",
  PASSWORD_RESET = "PASSWORD_RESET",
  PASSWORD_CHANGED = "PASSWORD_CHANGED",
  ACCOUNT_DEACTIVATED = "ACCOUNT_DEACTIVATED",
  OTP = "OTP",
  SECURITY_ALERT = "SECURITY_ALERT",
  ACCOUNT_LOCKED = "ACCOUNT_LOCKED",
  SOS_ALERT = "SOS_ALERT",

  // Ride
  RIDE_REQUESTED = "RIDE_REQUESTED",
  RIDE_ACCEPTED = "RIDE_ACCEPTED",
  DRIVER_ARRIVING = "DRIVER_ARRIVING",
  DRIVER_ARRIVED = "DRIVER_ARRIVED",
  RIDE_STARTED = "RIDE_STARTED",
  RIDE_COMPLETED = "RIDE_COMPLETED",
  RIDE_CANCELLED = "RIDE_CANCELLED",

  // Food
  ORDER_PLACED = "ORDER_PLACED",
  ORDER_CONFIRMED = "ORDER_CONFIRMED",
  ORDER_PREPARING = "ORDER_PREPARING",
  ORDER_READY = "ORDER_READY",
  ORDER_PICKED_UP = "ORDER_PICKED_UP",
  ORDER_DELIVERED = "ORDER_DELIVERED",
  ORDER_CANCELLED = "ORDER_CANCELLED",
  FOOD_ORDER_CONFIRMED = "FOOD_ORDER_CONFIRMED",
  FOOD_PREPARING = "FOOD_PREPARING",
  FOOD_READY_FOR_PICKUP = "FOOD_READY_FOR_PICKUP",
  FOOD_OUT_FOR_DELIVERY = "FOOD_OUT_FOR_DELIVERY",
  FOOD_DELIVERED = "FOOD_DELIVERED",

  // Delivery
  DELIVERY_CREATED = "DELIVERY_CREATED",
  DELIVERY_CONFIRMED = "DELIVERY_CONFIRMED",
  DELIVERY_DRIVER_ASSIGNED = "DELIVERY_DRIVER_ASSIGNED",
  DELIVERY_PICKED_UP = "DELIVERY_PICKED_UP",
  DELIVERY_IN_TRANSIT = "DELIVERY_IN_TRANSIT",
  DELIVERY_DELIVERED = "DELIVERY_DELIVERED",
  DELIVERY_CANCELLED = "DELIVERY_CANCELLED",
  DELIVERY_COMPLETED = "DELIVERY_COMPLETED",

  // Payment
  PAYMENT_RECEIVED = "PAYMENT_RECEIVED",
  PAYMENT_FAILED = "PAYMENT_FAILED",
  PAYMENT_SUCCESSFUL = "PAYMENT_SUCCESSFUL",
  REFUND_PROCESSED = "REFUND_PROCESSED",
  PAYOUT_SENT = "PAYOUT_SENT",
  WALLET_TOPPED_UP = "WALLET_TOPPED_UP",
  WALLET_LOW_BALANCE = "WALLET_LOW_BALANCE",

  // Driver
  NEW_RIDE_REQUEST = "NEW_RIDE_REQUEST",
  NEW_DELIVERY_REQUEST = "NEW_DELIVERY_REQUEST",
  EARNINGS_SUMMARY = "EARNINGS_SUMMARY",
  RATING_RECEIVED = "RATING_RECEIVED",
  DOCUMENTS_EXPIRING = "DOCUMENTS_EXPIRING",
  ACCOUNT_VERIFIED = "ACCOUNT_VERIFIED",

  // Restaurant
  NEW_ORDER = "NEW_ORDER",
  ORDER_REVIEW = "ORDER_REVIEW",
  RESTAURANT_PAYOUT = "RESTAURANT_PAYOUT",
  MENU_ITEM_LOW_STOCK = "MENU_ITEM_LOW_STOCK",

  // Promotions & Marketing
  PROMO_CODE = "PROMO_CODE",
  DISCOUNT_OFFER = "DISCOUNT_OFFER",
  REFERRAL_BONUS = "REFERRAL_BONUS",
  MARKETING = "MARKETING",

  // System
  MAINTENANCE = "MAINTENANCE",
  APP_UPDATE = "APP_UPDATE",
  POLICY_UPDATE = "POLICY_UPDATE",
}

// Notification status
export enum NotificationStatus {
  PENDING = "PENDING",
  SENT = "SENT",
  DELIVERED = "DELIVERED",
  FAILED = "FAILED",
  READ = "READ",
}

// Notification priority
export enum NotificationPriority {
  LOW = "LOW",
  NORMAL = "NORMAL",
  HIGH = "HIGH",
  URGENT = "URGENT",
}

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
