/**
 * Split Fare Types
 * Type definitions for fare splitting functionality
 */

import type { Currency } from "@prisma/client";

// ===========================================
// ENUMS & STATUS
// ===========================================

export type FareSplitStatus =
  | "PENDING" // Split initiated, invitations sent
  | "ACTIVE" // At least one participant accepted
  | "COMPLETED" // All participants paid
  | "PARTIALLY_PAID" // Some participants paid, ride completed
  | "CANCELLED" // Split cancelled by initiator
  | "EXPIRED"; // Invitation timed out

export type ParticipantStatus =
  | "INVITED" // Invitation sent
  | "ACCEPTED" // Accepted, waiting for payment
  | "DECLINED" // Opted out
  | "PAID" // Successfully paid their share
  | "FAILED" // Payment failed
  | "REFUNDED" // Refunded after cancellation
  | "PENDING_FALLBACK"; // Failed/declined, awaiting primary payer fallback

export type SplitType =
  | "EQUAL" // Split equally among participants
  | "CUSTOM" // Custom amounts per participant
  | "PERCENTAGE"; // Percentage-based split

// ===========================================
// SPLIT FARE INTERFACES
// ===========================================

export interface FareSplitParticipant {
  id: string;
  fareSplitId: string;
  userId?: string; // Null for non-UBI users
  phone: string; // Required - used for invitations
  name?: string; // Display name
  email?: string; // Optional email
  amount: number; // Their share amount
  percentage?: number; // Their percentage (if percentage split)
  status: ParticipantStatus;
  invitationToken: string; // Unique token for accepting invite
  invitationSentAt?: Date;
  invitationAcceptedAt?: Date;
  paymentId?: string; // Reference to payment transaction
  paidAt?: Date;
  declinedAt?: Date;
  declineReason?: string;
  notificationChannel: NotificationChannelType;
  reminderCount: number; // Number of reminders sent
  lastReminderAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface FareSplit {
  id: string;
  rideId: string;
  orderId?: string; // For food order splits
  initiatorUserId: string; // Primary payer
  totalAmount: number;
  currency: Currency;
  splitType: SplitType;
  status: FareSplitStatus;
  participantCount: number;
  paidCount: number;
  amountCollected: number;
  amountPending: number;
  primaryPayerFallbackEnabled: boolean; // If true, initiator pays uncollected
  fallbackAmount?: number; // Amount initiator had to cover
  invitationExpiresAt: Date;
  paymentDeadline?: Date; // When ride ends, payment is due
  completedAt?: Date;
  cancelledAt?: Date;
  cancelReason?: string;
  metadata?: Record<string, unknown>;
  participants: FareSplitParticipant[];
  createdAt: Date;
  updatedAt: Date;
}

// ===========================================
// REQUEST/RESPONSE TYPES
// ===========================================

export interface InitiateSplitParams {
  rideId: string;
  orderId?: string;
  totalAmount: number;
  currency: Currency;
  splitType: SplitType;
  participants: SplitParticipantInput[];
  primaryPayerFallbackEnabled?: boolean; // Default true
  expiresInMinutes?: number; // Default 60
  metadata?: Record<string, unknown>;
}

export interface SplitParticipantInput {
  phone: string;
  name?: string;
  email?: string;
  amount?: number; // Required for CUSTOM split
  percentage?: number; // Required for PERCENTAGE split
}

export interface InitiateSplitResult {
  splitId: string;
  status: FareSplitStatus;
  totalAmount: number;
  perPersonAmount: number; // For EQUAL splits
  currency: Currency;
  participants: ParticipantInviteResult[];
  invitationExpiresAt: Date;
  shareLink: string; // Universal deep link
}

export interface ParticipantInviteResult {
  phone: string;
  name?: string;
  amount: number;
  status: ParticipantStatus;
  invitationSent: boolean;
  invitationChannel: NotificationChannelType;
  isUbiUser: boolean;
  shareLink: string; // Individual deep link with token
}

export interface AcceptSplitParams {
  token: string; // Invitation token
  userId?: string; // If accepting as logged-in user
  phone?: string; // If accepting without account
}

export interface AcceptSplitResult {
  success: boolean;
  splitId: string;
  amount: number;
  currency: Currency;
  paymentRequired: boolean;
  paymentMethods: string[]; // Available payment methods
  paymentDeadline?: Date;
}

export interface DeclineSplitParams {
  token: string;
  reason?: string;
}

export interface PaySplitShareParams {
  splitId: string;
  participantId?: string; // If paying for specific participant
  userId?: string;
  paymentMethod: PaymentMethodType;
  paymentDetails?: Record<string, unknown>;
  pin?: string; // For wallet payments
}

export interface PaySplitShareResult {
  success: boolean;
  paymentId: string;
  amount: number;
  status: ParticipantStatus;
  splitStatus: FareSplitStatus;
  remainingAmount: number;
  allPaid: boolean;
}

export interface SplitStatusResult {
  splitId: string;
  rideId: string;
  status: FareSplitStatus;
  totalAmount: number;
  currency: Currency;
  splitType: SplitType;
  amountCollected: number;
  amountPending: number;
  participants: ParticipantStatusDetail[];
  initiator: {
    userId: string;
    name: string;
    phone: string;
  };
  fallbackTriggered: boolean;
  fallbackAmount?: number;
  invitationExpiresAt: Date;
  createdAt: Date;
}

export interface ParticipantStatusDetail {
  id: string;
  phone: string;
  name?: string;
  amount: number;
  status: ParticipantStatus;
  isUbiUser: boolean;
  paidAt?: Date;
  declinedAt?: Date;
}

// ===========================================
// NOTIFICATION TYPES
// ===========================================

export type NotificationChannelType = "SMS" | "PUSH" | "WHATSAPP" | "IN_APP";

export interface SplitInvitationNotification {
  participantPhone: string;
  participantName?: string;
  initiatorName: string;
  amount: number;
  currency: Currency;
  rideDetails?: {
    pickup: string;
    dropoff: string;
    date: Date;
  };
  shareLink: string;
  expiresAt: Date;
}

export interface SplitReminderNotification {
  participantPhone: string;
  participantName?: string;
  initiatorName: string;
  amount: number;
  currency: Currency;
  deadline?: Date;
  shareLink: string;
  reminderNumber: number;
}

export interface SplitPaymentNotification {
  initiatorPhone: string;
  initiatorName: string;
  participantName: string;
  amount: number;
  currency: Currency;
  remainingAmount: number;
  allPaid: boolean;
}

// ===========================================
// PAYMENT METHOD TYPES
// ===========================================

export type PaymentMethodType =
  | "WALLET"
  | "CARD"
  | "MPESA"
  | "MTN_MOMO"
  | "AIRTEL_MONEY"
  | "CASH";

// ===========================================
// DEEP LINK TYPES
// ===========================================

export interface SplitDeepLinkData {
  action: "accept" | "pay" | "view";
  splitId: string;
  token?: string;
  amount?: number;
  currency?: Currency;
}

// ===========================================
// CONFIGURATION
// ===========================================

export interface SplitFareConfig {
  maxParticipants: number; // Default 4
  invitationExpiryMinutes: number; // Default 60
  paymentDeadlineMinutes: number; // After ride completion
  maxReminders: number; // Default 3
  reminderIntervalMinutes: number; // Default 15
  minSplitAmount: number; // Minimum amount per person
  supportedCurrencies: Currency[];
}

export const DEFAULT_SPLIT_CONFIG: SplitFareConfig = {
  maxParticipants: 4,
  invitationExpiryMinutes: 60,
  paymentDeadlineMinutes: 30,
  maxReminders: 3,
  reminderIntervalMinutes: 15,
  minSplitAmount: 100, // Minimum 100 units (NGN, KES, etc.)
  supportedCurrencies: [
    "NGN",
    "KES",
    "ZAR",
    "GHS",
    "RWF",
    "ETB",
    "USD",
  ] as Currency[],
};
