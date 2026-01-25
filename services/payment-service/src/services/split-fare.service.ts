/**
 * Split Fare Service
 * Multi-party fare splitting with UBI and non-UBI user support
 *
 * Features:
 * - Equal, custom, and percentage-based splits
 * - SMS/Push/WhatsApp invitation delivery
 * - Deep link support for non-UBI users
 * - Primary payer fallback for uncollected amounts
 * - Automated reminders
 * - Refund handling for cancelled rides
 */

import { nanoid } from "nanoid";

import { splitFareLogger } from "../lib/logger";
import {
  NotificationChannel,
  notificationClient,
  NotificationPriority,
  NotificationType,
} from "../lib/notification-client";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { enhancedWalletService } from "./enhanced-wallet.service";

import type { Currency } from "@prisma/client";
import type {
  AcceptSplitParams,
  AcceptSplitResult,
  DeclineSplitParams,
  FareSplitStatus,
  InitiateSplitParams,
  InitiateSplitResult,
  NotificationChannelType,
  ParticipantInviteResult,
  ParticipantStatus,
  ParticipantStatusDetail,
  PaySplitShareParams,
  PaySplitShareResult,
  SplitFareConfig,
  SplitStatusResult,
  SplitType,
} from "../types/split-fare.types";

// ===========================================
// CONSTANTS
// ===========================================

const SPLIT_CONFIG: SplitFareConfig = {
  maxParticipants: 4,
  invitationExpiryMinutes: 60,
  paymentDeadlineMinutes: 30,
  maxReminders: 3,
  reminderIntervalMinutes: 15,
  minSplitAmount: 100,
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

const DEEP_LINK_BASE_URL =
  process.env.DEEP_LINK_BASE_URL || "https://ubi.app/split";
const SMS_SENDER_ID = process.env.SMS_SENDER_ID || "UBI";

// ===========================================
// SPLIT FARE SERVICE
// ===========================================

export class SplitFareService {
  /**
   * Initiate a fare split for a ride or order
   */
  async initiateSplit(
    initiatorUserId: string,
    params: InitiateSplitParams,
  ): Promise<InitiateSplitResult> {
    const {
      rideId,
      orderId,
      totalAmount,
      currency,
      splitType,
      participants,
      primaryPayerFallbackEnabled = true,
      expiresInMinutes = SPLIT_CONFIG.invitationExpiryMinutes,
      metadata,
    } = params;

    splitFareLogger.info(
      {
        initiatorUserId,
        rideId,
        totalAmount,
        participantCount: participants.length,
      },
      "Initiating fare split",
    );

    // Validate participant count
    if (participants.length < 1) {
      throw new Error("At least one participant is required");
    }
    if (participants.length > SPLIT_CONFIG.maxParticipants - 1) {
      throw new Error(
        `Maximum ${SPLIT_CONFIG.maxParticipants - 1} participants allowed (plus initiator)`,
      );
    }

    // Validate currency
    if (!SPLIT_CONFIG.supportedCurrencies.includes(currency)) {
      throw new Error(`Currency ${currency} is not supported for split fare`);
    }

    // Check for existing active split
    const existingSplit = await prisma.fareSplit.findFirst({
      where: {
        rideId,
        status: { in: ["PENDING", "ACTIVE"] },
      },
    });

    if (existingSplit) {
      throw new Error("An active split already exists for this ride");
    }

    // Get initiator info
    const initiator = await prisma.user.findUnique({
      where: { id: initiatorUserId },
      select: { id: true, firstName: true, lastName: true, phone: true },
    });

    if (!initiator) {
      throw new Error("Initiator not found");
    }

    const initiatorName = `${initiator.firstName} ${initiator.lastName}`.trim();

    // Calculate amounts based on split type
    const totalParticipants = participants.length + 1; // Include initiator
    const calculatedParticipants = this.calculateSplitAmounts(
      totalAmount,
      participants,
      splitType,
      totalParticipants,
    );

    // Validate minimum amounts
    for (const p of calculatedParticipants) {
      if (p.amount < SPLIT_CONFIG.minSplitAmount) {
        throw new Error(
          `Split amount ${p.amount} is below minimum ${SPLIT_CONFIG.minSplitAmount} ${currency}`,
        );
      }
    }

    // Calculate initiator's share
    const participantTotal = calculatedParticipants.reduce(
      (sum, p) => sum + p.amount,
      0,
    );
    const initiatorShare = totalAmount - participantTotal;

    if (initiatorShare < 0) {
      throw new Error("Participant amounts exceed total fare");
    }

    // Create split record
    const splitId = `split_${nanoid(16)}`;
    const invitationExpiresAt = new Date(
      Date.now() + expiresInMinutes * 60 * 1000,
    );

    // Resolve UBI users and create participant records
    const participantRecords = await Promise.all(
      calculatedParticipants.map(async (p) => {
        const token = nanoid(24);
        const ubiUser = await this.resolveUserByPhone(p.phone);
        const channel = await this.determineNotificationChannel(
          p.phone,
          ubiUser?.id,
        );

        return {
          id: `participant_${nanoid(12)}`,
          fareSplitId: splitId,
          userId: ubiUser?.id || null,
          phone: p.phone,
          name: p.name || ubiUser?.firstName || null,
          email: p.email || ubiUser?.email || null,
          amount: p.amount,
          percentage: p.percentage || null,
          status: "INVITED" as ParticipantStatus,
          invitationToken: token,
          notificationChannel: channel,
          reminderCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }),
    );

    // Create fare split in database
    await prisma.$transaction(async (tx) => {
      await tx.fareSplit.create({
        data: {
          id: splitId,
          rideId,
          orderId: orderId || null,
          initiatorUserId,
          totalAmount,
          currency,
          splitType,
          status: "PENDING",
          participantCount: participantRecords.length,
          paidCount: 0,
          amountCollected: 0,
          amountPending: participantTotal,
          primaryPayerFallbackEnabled,
          invitationExpiresAt,
          metadata: metadata ? JSON.stringify(metadata) : null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Create participant records
      for (const participant of participantRecords) {
        await tx.fareSplitParticipant.create({
          data: participant,
        });
      }
    });

    // Send invitations
    const inviteResults = await this.sendInvitations(
      splitId,
      participantRecords,
      initiatorName,
      totalAmount,
      currency,
      rideId,
      invitationExpiresAt,
    );

    // Schedule expiry check
    await this.scheduleExpiryCheck(splitId, invitationExpiresAt);

    // Generate share link
    const shareLink = this.generateShareLink(splitId);

    splitFareLogger.info(
      { splitId, participantCount: participantRecords.length, inviteResults },
      "Fare split initiated successfully",
    );

    return {
      splitId,
      status: "PENDING",
      totalAmount,
      perPersonAmount:
        splitType === "EQUAL" ? Math.ceil(totalAmount / totalParticipants) : 0,
      currency,
      participants: inviteResults,
      invitationExpiresAt,
      shareLink,
    };
  }

  /**
   * Accept a split fare invitation
   */
  async acceptSplit(params: AcceptSplitParams): Promise<AcceptSplitResult> {
    const { token, userId, phone: _phone } = params;

    // Find participant by token
    const participant = await prisma.fareSplitParticipant.findFirst({
      where: { invitationToken: token },
      include: { fareSplit: true },
    });

    if (!participant) {
      throw new Error("Invalid invitation token");
    }

    const split = participant.fareSplit;

    // Check if split is still active
    if (split.status === "CANCELLED") {
      throw new Error("This fare split has been cancelled");
    }

    if (split.status === "COMPLETED") {
      throw new Error("This fare split has already been completed");
    }

    // Check invitation expiry
    if (split.invitationExpiresAt < new Date()) {
      throw new Error("This invitation has expired");
    }

    // Check if already accepted/paid/declined
    if (participant.status !== "INVITED") {
      return {
        success: true,
        splitId: split.id,
        amount: Number(participant.amount),
        currency: split.currency,
        paymentRequired: participant.status === "ACCEPTED",
        paymentMethods: this.getAvailablePaymentMethods(split.currency),
        paymentDeadline: split.paymentDeadline || undefined,
      };
    }

    // Update participant status
    await prisma.fareSplitParticipant.update({
      where: { id: participant.id },
      data: {
        status: "ACCEPTED",
        userId: userId || participant.userId,
        invitationAcceptedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Update split status if first acceptance
    if (split.status === "PENDING") {
      await prisma.fareSplit.update({
        where: { id: split.id },
        data: {
          status: "ACTIVE",
          updatedAt: new Date(),
        },
      });
    }

    // Notify initiator
    await this.notifyInitiatorOfAcceptance(split, participant);

    splitFareLogger.info(
      {
        splitId: split.id,
        participantId: participant.id,
        phone: participant.phone,
      },
      "Split invitation accepted",
    );

    return {
      success: true,
      splitId: split.id,
      amount: Number(participant.amount),
      currency: split.currency,
      paymentRequired: true,
      paymentMethods: this.getAvailablePaymentMethods(split.currency),
      paymentDeadline: split.paymentDeadline || undefined,
    };
  }

  /**
   * Decline a split fare invitation
   */
  async declineSplit(
    params: DeclineSplitParams,
  ): Promise<{ success: boolean }> {
    const { token, reason } = params;

    const participant = await prisma.fareSplitParticipant.findFirst({
      where: { invitationToken: token },
      include: { fareSplit: true },
    });

    if (!participant) {
      throw new Error("Invalid invitation token");
    }

    const split = participant.fareSplit;

    if (participant.status !== "INVITED" && participant.status !== "ACCEPTED") {
      throw new Error("Cannot decline - already processed");
    }

    // Update participant
    await prisma.fareSplitParticipant.update({
      where: { id: participant.id },
      data: {
        status: "DECLINED",
        declinedAt: new Date(),
        declineReason: reason,
        updatedAt: new Date(),
      },
    });

    // Update split pending amount
    const newAmountPending =
      Number(split.amountPending) - Number(participant.amount);
    await prisma.fareSplit.update({
      where: { id: split.id },
      data: {
        amountPending: newAmountPending,
        updatedAt: new Date(),
      },
    });

    // Notify initiator
    await this.notifyInitiatorOfDecline(split, participant, reason);

    // If primary payer fallback enabled, add to their responsibility
    if (split.primaryPayerFallbackEnabled) {
      await this.handleFallbackAmount(split.id, Number(participant.amount));
    }

    splitFareLogger.info(
      { splitId: split.id, participantId: participant.id, reason },
      "Split invitation declined",
    );

    return { success: true };
  }

  /**
   * Pay participant's share
   */
  async payShare(
    _initiatorOrUserId: string,
    params: PaySplitShareParams,
  ): Promise<PaySplitShareResult> {
    const {
      splitId,
      participantId,
      userId,
      paymentMethod,
      paymentDetails,
      pin,
    } = params;

    // Get split and participant
    const split = await prisma.fareSplit.findUnique({
      where: { id: splitId },
      include: { participants: true },
    });

    if (!split) {
      throw new Error("Split not found");
    }

    // Find the participant
    let participant: (typeof split.participants)[0] | undefined;

    if (participantId) {
      participant = split.participants.find(
        (p: (typeof split.participants)[0]) => p.id === participantId,
      );
    } else if (userId) {
      participant = split.participants.find(
        (p: (typeof split.participants)[0]) => p.userId === userId,
      );
    }

    if (!participant) {
      throw new Error("Participant not found");
    }

    // Validate status
    if (participant.status === "PAID") {
      throw new Error("Already paid");
    }

    if (participant.status !== "ACCEPTED" && participant.status !== "INVITED") {
      throw new Error("Cannot pay - invalid status");
    }

    const amount = Number(participant.amount);

    // Process payment based on method
    let paymentId: string;

    try {
      switch (paymentMethod) {
        case "WALLET":
          paymentId = await this.processWalletPayment(
            participant.userId || userId!,
            amount,
            split.currency,
            splitId,
            pin,
          );
          break;
        case "MPESA":
          paymentId = await this.processMpesaPayment(
            participant.phone,
            amount,
            split.currency,
            splitId,
            paymentDetails,
          );
          break;
        case "MTN_MOMO":
          paymentId = await this.processMomoPayment(
            participant.phone,
            amount,
            split.currency,
            splitId,
            paymentDetails,
          );
          break;
        case "CARD":
          paymentId = await this.processCardPayment(
            participant.userId || userId!,
            amount,
            split.currency,
            splitId,
            paymentDetails,
          );
          break;
        default:
          throw new Error(`Payment method ${paymentMethod} not supported`);
      }
    } catch (error) {
      // Update participant status to failed
      await prisma.fareSplitParticipant.update({
        where: { id: participant.id },
        data: {
          status: "FAILED",
          updatedAt: new Date(),
        },
      });

      splitFareLogger.error(
        { err: error, splitId, participantId: participant.id, paymentMethod },
        "Split payment failed",
      );

      throw error;
    }

    // Update participant as paid
    await prisma.fareSplitParticipant.update({
      where: { id: participant.id },
      data: {
        status: "PAID",
        paymentId,
        paidAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Update split totals
    const newAmountCollected = Number(split.amountCollected) + amount;
    const newAmountPending = Number(split.amountPending) - amount;
    const newPaidCount = split.paidCount + 1;

    // Check if all participants paid
    const allPaid = newPaidCount === split.participantCount;
    const newStatus: FareSplitStatus = allPaid ? "COMPLETED" : "PARTIALLY_PAID";

    await prisma.fareSplit.update({
      where: { id: splitId },
      data: {
        amountCollected: newAmountCollected,
        amountPending: newAmountPending,
        paidCount: newPaidCount,
        status: newStatus,
        completedAt: allPaid ? new Date() : null,
        updatedAt: new Date(),
      },
    });

    // Notify initiator
    await this.notifyInitiatorOfPayment(split, participant, amount, allPaid);

    splitFareLogger.info(
      { splitId, participantId: participant.id, amount, paymentId, allPaid },
      "Split payment successful",
    );

    return {
      success: true,
      paymentId,
      amount,
      status: "PAID",
      splitStatus: newStatus,
      remainingAmount: newAmountPending,
      allPaid,
    };
  }

  /**
   * Get split status
   */
  async getSplitStatus(splitId: string): Promise<SplitStatusResult> {
    const split = await prisma.fareSplit.findUnique({
      where: { id: splitId },
      include: {
        participants: true,
      },
    });

    if (!split) {
      throw new Error("Split not found");
    }

    // Get initiator info
    const initiator = await prisma.user.findUnique({
      where: { id: split.initiatorUserId },
      select: { id: true, firstName: true, lastName: true, phone: true },
    });

    const participantDetails: ParticipantStatusDetail[] =
      split.participants.map((p: (typeof split.participants)[0]) => ({
        id: p.id,
        phone: p.phone,
        name: p.name || undefined,
        amount: Number(p.amount),
        status: p.status as ParticipantStatus,
        isUbiUser: !!p.userId,
        paidAt: p.paidAt || undefined,
        declinedAt: p.declinedAt || undefined,
      }));

    return {
      splitId: split.id,
      rideId: split.rideId,
      status: split.status as FareSplitStatus,
      totalAmount: Number(split.totalAmount),
      currency: split.currency,
      splitType: split.splitType as SplitType,
      amountCollected: Number(split.amountCollected),
      amountPending: Number(split.amountPending),
      participants: participantDetails,
      initiator: {
        userId: initiator!.id,
        name: `${initiator!.firstName} ${initiator!.lastName}`.trim(),
        phone: initiator!.phone,
      },
      fallbackTriggered:
        split.fallbackAmount !== null && Number(split.fallbackAmount) > 0,
      fallbackAmount: split.fallbackAmount
        ? Number(split.fallbackAmount)
        : undefined,
      invitationExpiresAt: split.invitationExpiresAt,
      createdAt: split.createdAt,
    };
  }

  /**
   * Cancel a fare split (initiator only)
   */
  async cancelSplit(
    splitId: string,
    initiatorUserId: string,
    reason?: string,
  ): Promise<{ success: boolean }> {
    const split = await prisma.fareSplit.findUnique({
      where: { id: splitId },
      include: { participants: true },
    });

    if (!split) {
      throw new Error("Split not found");
    }

    if (split.initiatorUserId !== initiatorUserId) {
      throw new Error("Only the initiator can cancel the split");
    }

    if (split.status === "COMPLETED" || split.status === "CANCELLED") {
      throw new Error(
        "Cannot cancel - split is already " + split.status.toLowerCase(),
      );
    }

    // Refund any paid participants
    for (const participant of split.participants) {
      if (participant.status === "PAID" && participant.paymentId) {
        await this.refundParticipant(participant, split.currency, reason);
      }
    }

    // Update split status
    await prisma.fareSplit.update({
      where: { id: splitId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: reason,
        updatedAt: new Date(),
      },
    });

    // Notify all participants
    await this.notifyParticipantsOfCancellation(split, reason);

    splitFareLogger.info(
      { splitId, initiatorUserId, reason },
      "Fare split cancelled",
    );

    return { success: true };
  }

  /**
   * Handle ride completion - trigger payment deadline
   */
  async handleRideCompletion(rideId: string): Promise<void> {
    const split = await prisma.fareSplit.findFirst({
      where: {
        rideId,
        status: { in: ["PENDING", "ACTIVE", "PARTIALLY_PAID"] },
      },
      include: { participants: true },
    });

    if (!split) {
      return; // No active split for this ride
    }

    const paymentDeadline = new Date(
      Date.now() + SPLIT_CONFIG.paymentDeadlineMinutes * 60 * 1000,
    );

    // Update split with payment deadline
    await prisma.fareSplit.update({
      where: { id: split.id },
      data: {
        paymentDeadline,
        updatedAt: new Date(),
      },
    });

    // Send urgent reminders to unpaid participants
    for (const participant of split.participants) {
      if (
        participant.status === "INVITED" ||
        participant.status === "ACCEPTED"
      ) {
        await this.sendPaymentReminder(split, participant, true);
      }
    }

    // Schedule deadline check
    await this.scheduleDeadlineCheck(split.id, paymentDeadline);

    splitFareLogger.info(
      { splitId: split.id, rideId, paymentDeadline },
      "Ride completed - payment deadline set",
    );
  }

  /**
   * Handle payment deadline - trigger primary payer fallback
   */
  async handlePaymentDeadline(splitId: string): Promise<void> {
    const split = await prisma.fareSplit.findUnique({
      where: { id: splitId },
      include: { participants: true },
    });

    if (
      !split ||
      split.status === "COMPLETED" ||
      split.status === "CANCELLED"
    ) {
      return;
    }

    // Calculate unpaid amount
    let unpaidAmount = 0;
    for (const participant of split.participants) {
      if (participant.status !== "PAID") {
        unpaidAmount += Number(participant.amount);

        // Mark unpaid participants for fallback
        await prisma.fareSplitParticipant.update({
          where: { id: participant.id },
          data: {
            status: "PENDING_FALLBACK",
            updatedAt: new Date(),
          },
        });
      }
    }

    if (unpaidAmount > 0 && split.primaryPayerFallbackEnabled) {
      await this.handleFallbackAmount(splitId, unpaidAmount);

      // Charge initiator for unpaid amount
      await this.chargeInitiatorFallback(
        split.initiatorUserId,
        unpaidAmount,
        split.currency,
        splitId,
      );

      // Update split as completed with fallback
      await prisma.fareSplit.update({
        where: { id: splitId },
        data: {
          status: "COMPLETED",
          amountCollected: split.totalAmount,
          amountPending: 0,
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }

    splitFareLogger.info(
      {
        splitId,
        unpaidAmount,
        fallbackEnabled: split.primaryPayerFallbackEnabled,
      },
      "Payment deadline reached - fallback processed",
    );
  }

  // ===========================================
  // PRIVATE METHODS
  // ===========================================

  /**
   * Calculate split amounts based on split type
   */
  private calculateSplitAmounts(
    totalAmount: number,
    participants: {
      phone: string;
      name?: string;
      email?: string;
      amount?: number;
      percentage?: number;
    }[],
    splitType: SplitType,
    totalParticipants: number,
  ): {
    phone: string;
    name?: string;
    email?: string;
    amount: number;
    percentage?: number;
  }[] {
    switch (splitType) {
      case "EQUAL": {
        const perPersonAmount = Math.ceil(totalAmount / totalParticipants);
        return participants.map((p) => ({
          ...p,
          amount: perPersonAmount,
        }));
      }

      case "CUSTOM": {
        // Validate all amounts are provided
        for (const p of participants) {
          if (p.amount === undefined || p.amount <= 0) {
            throw new Error(`Amount required for participant ${p.phone}`);
          }
        }
        return participants.map((p) => ({
          ...p,
          amount: p.amount!,
        }));
      }

      case "PERCENTAGE": {
        // Validate percentages
        let totalPercentage = 0;
        for (const p of participants) {
          if (p.percentage === undefined || p.percentage <= 0) {
            throw new Error(`Percentage required for participant ${p.phone}`);
          }
          totalPercentage += p.percentage;
        }

        if (totalPercentage > 100) {
          throw new Error("Total percentage cannot exceed 100%");
        }

        return participants.map((p) => ({
          ...p,
          amount: Math.ceil((totalAmount * p.percentage!) / 100),
          percentage: p.percentage,
        }));
      }

      default:
        throw new Error(`Invalid split type: ${splitType}`);
    }
  }

  /**
   * Resolve user by phone number
   */
  private async resolveUserByPhone(phone: string): Promise<{
    id: string;
    firstName: string;
    lastName: string;
    email?: string;
  } | null> {
    const user = await prisma.user.findFirst({
      where: { phone },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    return user;
  }

  /**
   * Determine best notification channel for user
   */
  private async determineNotificationChannel(
    _phone: string,
    userId?: string | null,
  ): Promise<NotificationChannelType> {
    if (userId) {
      // Check if user has push notifications enabled
      const hasDevice = await prisma.deviceToken.findFirst({
        where: { userId },
      });

      if (hasDevice) {
        return "PUSH";
      }

      // Check WhatsApp preference
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { preferences: true },
      });

      if (
        user?.preferences &&
        typeof user.preferences === "object" &&
        (user.preferences as Record<string, unknown>).whatsappEnabled
      ) {
        return "WHATSAPP";
      }
    }

    // Default to SMS for non-UBI users or users without push
    return "SMS";
  }

  /**
   * Send invitations to all participants
   */
  private async sendInvitations(
    splitId: string,
    participants: {
      id: string;
      phone: string;
      name?: string | null;
      userId?: string | null;
      amount: number;
      invitationToken: string;
      notificationChannel: NotificationChannelType;
    }[],
    initiatorName: string,
    _totalAmount: number,
    currency: Currency,
    _rideId: string,
    expiresAt: Date,
  ): Promise<ParticipantInviteResult[]> {
    const results: ParticipantInviteResult[] = [];

    for (const participant of participants) {
      const shareLink = this.generateShareLink(
        splitId,
        participant.invitationToken,
      );
      const amount = Number(participant.amount);

      try {
        let invitationSent = false;

        switch (participant.notificationChannel) {
          case "PUSH":
            if (participant.userId) {
              await notificationClient.send({
                userId: participant.userId,
                title: "Split Fare Request",
                body: `${initiatorName} wants to split a ${currency} ${amount} fare with you`,
                type: NotificationType.TRANSFER_RECEIVED,
                priority: NotificationPriority.HIGH,
                channels: [
                  NotificationChannel.PUSH,
                  NotificationChannel.IN_APP,
                ],
                data: {
                  type: "split_fare_invitation",
                  splitId,
                  amount,
                  currency,
                  initiatorName,
                  shareLink,
                  expiresAt: expiresAt.toISOString(),
                },
              });
              invitationSent = true;
            }
            break;

          case "WHATSAPP":
            await this.sendWhatsAppInvitation(
              participant.phone,
              participant.name || "there",
              initiatorName,
              amount,
              currency,
              shareLink,
              expiresAt,
            );
            invitationSent = true;
            break;

          case "SMS":
          default:
            await this.sendSmsInvitation(
              participant.phone,
              participant.name || "there",
              initiatorName,
              amount,
              currency,
              shareLink,
            );
            invitationSent = true;
            break;
        }

        // Update invitation sent timestamp
        await prisma.fareSplitParticipant.update({
          where: { id: participant.id },
          data: { invitationSentAt: new Date() },
        });

        results.push({
          phone: participant.phone,
          name: participant.name || undefined,
          amount,
          status: "INVITED",
          invitationSent,
          invitationChannel: participant.notificationChannel,
          isUbiUser: !!participant.userId,
          shareLink,
        });
      } catch (error) {
        splitFareLogger.error(
          {
            err: error,
            phone: participant.phone,
            channel: participant.notificationChannel,
          },
          "Failed to send invitation",
        );

        results.push({
          phone: participant.phone,
          name: participant.name || undefined,
          amount,
          status: "INVITED",
          invitationSent: false,
          invitationChannel: participant.notificationChannel,
          isUbiUser: !!participant.userId,
          shareLink,
        });
      }
    }

    return results;
  }

  /**
   * Send SMS invitation
   */
  private async sendSmsInvitation(
    phone: string,
    recipientName: string,
    initiatorName: string,
    amount: number,
    currency: Currency,
    shareLink: string,
  ): Promise<void> {
    const message = `Hi ${recipientName}! ${initiatorName} wants to split a ride fare with you. Your share: ${currency} ${amount}. Tap to pay: ${shareLink}`;

    // Call notification service to send SMS
    await fetch(
      `${process.env.NOTIFICATION_SERVICE_URL || "http://notification-service:4006"}/v1/sms/send`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: phone,
          message,
          senderId: SMS_SENDER_ID,
        }),
      },
    );
  }

  /**
   * Send WhatsApp invitation
   */
  private async sendWhatsAppInvitation(
    phone: string,
    recipientName: string,
    initiatorName: string,
    amount: number,
    currency: Currency,
    shareLink: string,
    expiresAt: Date,
  ): Promise<void> {
    const message = {
      template: "split_fare_invitation",
      params: {
        recipientName,
        initiatorName,
        amount,
        currency,
        shareLink,
        expiresAt: expiresAt.toISOString(),
      },
    };

    // Call notification service for WhatsApp
    await fetch(
      `${process.env.NOTIFICATION_SERVICE_URL || "http://notification-service:4006"}/v1/whatsapp/send`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: phone,
          ...message,
        }),
      },
    );
  }

  /**
   * Send payment reminder
   */
  private async sendPaymentReminder(
    split: any,
    participant: any,
    isUrgent: boolean,
  ): Promise<void> {
    if (participant.reminderCount >= SPLIT_CONFIG.maxReminders) {
      return;
    }

    const shareLink = this.generateShareLink(
      split.id,
      participant.invitationToken,
    );
    const message = isUrgent
      ? `URGENT: Your ride fare payment of ${split.currency} ${participant.amount} is due now. Pay here: ${shareLink}`
      : `Reminder: Please pay your share of ${split.currency} ${participant.amount} for the split fare. Pay here: ${shareLink}`;

    try {
      await fetch(
        `${process.env.NOTIFICATION_SERVICE_URL || "http://notification-service:4006"}/v1/sms/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: participant.phone,
            message,
            senderId: SMS_SENDER_ID,
          }),
        },
      );

      await prisma.fareSplitParticipant.update({
        where: { id: participant.id },
        data: {
          reminderCount: participant.reminderCount + 1,
          lastReminderAt: new Date(),
        },
      });
    } catch (error) {
      splitFareLogger.error(
        { err: error, phone: participant.phone },
        "Failed to send reminder",
      );
    }
  }

  /**
   * Generate share link
   */
  private generateShareLink(splitId: string, token?: string): string {
    const params = new URLSearchParams({ splitId });
    if (token) {
      params.set("token", token);
    }
    return `${DEEP_LINK_BASE_URL}?${params.toString()}`;
  }

  /**
   * Get available payment methods for currency
   */
  private getAvailablePaymentMethods(currency: Currency): string[] {
    const baseMethods = ["WALLET", "CARD"];

    switch (currency) {
      case "KES":
        return [...baseMethods, "MPESA"];
      case "NGN":
        return [...baseMethods, "CARD"]; // Paystack
      case "GHS":
        return [...baseMethods, "MTN_MOMO"];
      case "RWF":
        return [...baseMethods, "MTN_MOMO"];
      default:
        return baseMethods;
    }
  }

  /**
   * Process wallet payment
   */
  private async processWalletPayment(
    userId: string,
    amount: number,
    currency: Currency,
    splitId: string,
    pin?: string,
  ): Promise<string> {
    // Get user's wallet
    const wallet = await prisma.walletAccount.findFirst({
      where: { userId, currency },
    });

    if (!wallet) {
      throw new Error("Wallet not found");
    }

    // Verify PIN if provided
    if (pin) {
      const pinValid = await enhancedWalletService.verifyPin(wallet.id, pin);
      if (!pinValid) {
        throw new Error("Invalid PIN");
      }
    }

    // Debit wallet
    const paymentId = `splitpay_${nanoid(16)}`;

    await enhancedWalletService.debit({
      walletId: wallet.id,
      amount,
      currency,
      description: `Split fare payment for ${splitId}`,
      reference: paymentId,
    });

    return paymentId;
  }

  /**
   * Process M-Pesa payment (STK Push)
   */
  private async processMpesaPayment(
    phone: string,
    amount: number,
    _currency: Currency,
    splitId: string,
    _paymentDetails?: Record<string, unknown>,
  ): Promise<string> {
    const paymentId = `splitpay_mpesa_${nanoid(16)}`;

    // Initiate STK Push via payment service
    const response = await fetch(
      `${process.env.PAYMENT_SERVICE_URL || "http://localhost:4004"}/v1/mpesa/stk-push`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          amount,
          accountReference: splitId,
          transactionDesc: "Split Fare Payment",
          callbackUrl: `${process.env.API_URL}/webhooks/mpesa/split-fare/${paymentId}`,
        }),
      },
    );

    if (!response.ok) {
      const error = (await response.json()) as { message?: string };
      throw new Error(error.message || "M-Pesa payment failed");
    }

    return paymentId;
  }

  /**
   * Process MTN MoMo payment
   */
  private async processMomoPayment(
    phone: string,
    amount: number,
    currency: Currency,
    splitId: string,
    _paymentDetails?: Record<string, unknown>,
  ): Promise<string> {
    const paymentId = `splitpay_momo_${nanoid(16)}`;

    // Initiate MoMo collection
    const response = await fetch(
      `${process.env.PAYMENT_SERVICE_URL || "http://localhost:4004"}/v1/mtn-momo/request-to-pay`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          amount,
          currency,
          externalId: paymentId,
          payerMessage: "Split Fare Payment",
          payeeNote: `Split: ${splitId}`,
        }),
      },
    );

    if (!response.ok) {
      const error = (await response.json()) as { message?: string };
      throw new Error(error.message || "MTN MoMo payment failed");
    }

    return paymentId;
  }

  /**
   * Process card payment
   */
  private async processCardPayment(
    userId: string,
    amount: number,
    currency: Currency,
    splitId: string,
    paymentDetails?: Record<string, unknown>,
  ): Promise<string> {
    const paymentId = `splitpay_card_${nanoid(16)}`;

    // Get user's saved card or use provided card details
    const cardId = paymentDetails?.cardId as string | undefined;

    const response = await fetch(
      `${process.env.PAYMENT_SERVICE_URL || "http://localhost:4004"}/v1/payments/charge`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          amount,
          currency,
          cardId,
          reference: paymentId,
          description: "Split Fare Payment",
          metadata: { splitId },
        }),
      },
    );

    if (!response.ok) {
      const error = (await response.json()) as { message?: string };
      throw new Error(error.message || "Card payment failed");
    }

    return paymentId;
  }

  /**
   * Refund participant
   */
  private async refundParticipant(
    participant: any,
    currency: Currency,
    reason?: string,
  ): Promise<void> {
    if (!participant.paymentId) {
      return;
    }

    try {
      // Credit back to wallet if they have one
      if (participant.userId) {
        const wallet = await prisma.walletAccount.findFirst({
          where: { userId: participant.userId, currency },
        });

        if (wallet) {
          const reasonSuffix = reason ? ` - ${reason}` : "";
          await enhancedWalletService.credit({
            walletId: wallet.id,
            amount: Number(participant.amount),
            currency,
            description: `Refund: Split fare cancelled${reasonSuffix}`,
            reference: `refund_${participant.paymentId}`,
          });
        }
      }

      // Update participant status
      await prisma.fareSplitParticipant.update({
        where: { id: participant.id },
        data: {
          status: "REFUNDED",
          updatedAt: new Date(),
        },
      });

      splitFareLogger.info(
        { participantId: participant.id, amount: participant.amount },
        "Participant refunded",
      );
    } catch (error) {
      splitFareLogger.error(
        { err: error, participantId: participant.id },
        "Failed to refund participant",
      );
    }
  }

  /**
   * Handle fallback amount
   */
  private async handleFallbackAmount(
    splitId: string,
    amount: number,
  ): Promise<void> {
    await prisma.fareSplit.update({
      where: { id: splitId },
      data: {
        fallbackAmount: amount,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Charge initiator for uncollected amounts
   */
  private async chargeInitiatorFallback(
    initiatorUserId: string,
    amount: number,
    currency: Currency,
    splitId: string,
  ): Promise<void> {
    try {
      const wallet = await prisma.walletAccount.findFirst({
        where: { userId: initiatorUserId, currency },
      });

      if (wallet) {
        await enhancedWalletService.debit({
          walletId: wallet.id,
          amount,
          currency,
          description: `Split fare fallback - uncollected amounts for ${splitId}`,
          reference: `fallback_${splitId}`,
        });
      }

      // Notify initiator
      await notificationClient.send({
        userId: initiatorUserId,
        title: "Split Fare Fallback",
        body: `You've been charged ${currency} ${amount} for uncollected split fare amounts`,
        type: NotificationType.PAYMENT_SUCCESS,
        priority: NotificationPriority.HIGH,
        data: {
          type: "split_fare_fallback",
          splitId,
          amount,
          currency,
        },
      });
    } catch (error) {
      splitFareLogger.error(
        { err: error, initiatorUserId, amount, splitId },
        "Failed to charge initiator fallback",
      );
    }
  }

  /**
   * Notify initiator of acceptance
   */
  private async notifyInitiatorOfAcceptance(
    split: any,
    participant: any,
  ): Promise<void> {
    await notificationClient.send({
      userId: split.initiatorUserId,
      title: "Split Fare Accepted",
      body: `${participant.name || participant.phone} accepted your split fare request`,
      type: NotificationType.TRANSFER_COMPLETED,
      priority: NotificationPriority.NORMAL,
      data: {
        type: "split_fare_accepted",
        splitId: split.id,
        participantPhone: participant.phone,
      },
    });
  }

  /**
   * Notify initiator of decline
   */
  private async notifyInitiatorOfDecline(
    split: any,
    participant: any,
    reason?: string,
  ): Promise<void> {
    const participantName = participant.name || participant.phone;
    const reasonSuffix = reason ? `: ${reason}` : "";
    await notificationClient.send({
      userId: split.initiatorUserId,
      title: "Split Fare Declined",
      body: `${participantName} declined your split fare request${reasonSuffix}`,
      type: NotificationType.MONEY_REQUEST_DECLINED,
      priority: NotificationPriority.NORMAL,
      data: {
        type: "split_fare_declined",
        splitId: split.id,
        participantPhone: participant.phone,
        reason,
      },
    });
  }

  /**
   * Notify initiator of payment
   */
  private async notifyInitiatorOfPayment(
    split: any,
    participant: any,
    amount: number,
    allPaid: boolean,
  ): Promise<void> {
    await notificationClient.send({
      userId: split.initiatorUserId,
      title: allPaid ? "Split Fare Complete!" : "Split Fare Payment Received",
      body: allPaid
        ? "All participants have paid their share!"
        : `${participant.name || participant.phone} paid ${split.currency} ${amount}`,
      type: NotificationType.PAYMENT_SUCCESS,
      priority: allPaid
        ? NotificationPriority.HIGH
        : NotificationPriority.NORMAL,
      data: {
        type: "split_fare_payment",
        splitId: split.id,
        participantPhone: participant.phone,
        amount,
        allPaid,
      },
    });
  }

  /**
   * Notify participants of cancellation
   */
  private async notifyParticipantsOfCancellation(
    split: any,
    reason?: string,
  ): Promise<void> {
    const reasonSuffix = reason ? `: ${reason}` : "";
    const smsReasonSuffix = reason ? `. Reason: ${reason}` : "";
    for (const participant of split.participants) {
      if (participant.userId) {
        await notificationClient.send({
          userId: participant.userId,
          title: "Split Fare Cancelled",
          body: `The split fare has been cancelled${reasonSuffix}`,
          type: NotificationType.TRANSFER_COMPLETED,
          priority: NotificationPriority.HIGH,
          data: {
            type: "split_fare_cancelled",
            splitId: split.id,
            reason,
          },
        });
      } else {
        // SMS notification for non-UBI users
        await fetch(
          `${process.env.NOTIFICATION_SERVICE_URL || "http://notification-service:4006"}/v1/sms/send`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: participant.phone,
              message: `The split fare request has been cancelled${smsReasonSuffix}`,
              senderId: SMS_SENDER_ID,
            }),
          },
        );
      }
    }
  }

  /**
   * Schedule expiry check
   */
  private async scheduleExpiryCheck(
    splitId: string,
    expiresAt: Date,
  ): Promise<void> {
    const delay = Math.max(0, expiresAt.getTime() - Date.now());

    // Store in Redis for background job
    await redis.zadd("split_fare:expiry_queue", expiresAt.getTime(), splitId);

    splitFareLogger.debug(
      { splitId, expiresAt, delay },
      "Scheduled expiry check",
    );
  }

  /**
   * Schedule deadline check
   */
  private async scheduleDeadlineCheck(
    splitId: string,
    deadline: Date,
  ): Promise<void> {
    await redis.zadd("split_fare:deadline_queue", deadline.getTime(), splitId);
  }

  /**
   * Get splits for a user
   */
  async getUserSplits(
    userId: string,
    type: "initiated" | "participated" | "all" = "all",
  ): Promise<SplitStatusResult[]> {
    let splits: any[];

    if (type === "initiated") {
      splits = await prisma.fareSplit.findMany({
        where: { initiatorUserId: userId },
        include: { participants: true },
        orderBy: { createdAt: "desc" },
      });
    } else if (type === "participated") {
      const participations = await prisma.fareSplitParticipant.findMany({
        where: { userId },
        include: { fareSplit: { include: { participants: true } } },
        orderBy: { createdAt: "desc" },
      });
      splits = participations.map(
        (p: (typeof participations)[0]) => p.fareSplit,
      );
    } else {
      const initiated = await prisma.fareSplit.findMany({
        where: { initiatorUserId: userId },
        include: { participants: true },
      });

      const participations = await prisma.fareSplitParticipant.findMany({
        where: { userId },
        include: { fareSplit: { include: { participants: true } } },
      });

      // Get unique participated splits that weren't initiated by this user
      const participated = participations
        .filter(
          (p: (typeof participations)[0]) =>
            !initiated.some(
              (i: (typeof initiated)[0]) => i.id === p.fareSplit.id,
            ),
        )
        .map((p: (typeof participations)[0]) => p.fareSplit);

      splits = [...initiated, ...participated].sort(
        (a: (typeof initiated)[0], b: (typeof initiated)[0]) =>
          b.createdAt.getTime() - a.createdAt.getTime(),
      );
    }

    return Promise.all(
      splits.map(async (split) => this.getSplitStatus(split.id)),
    );
  }
}

// Export singleton
export const splitFareService = new SplitFareService();
