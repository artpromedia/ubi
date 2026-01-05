/**
 * P2P Transfer Service
 * Person-to-person money transfers with phone/email/username lookup
 */

import type { Currency } from "@prisma/client";
import { nanoid } from "nanoid";
import { prisma } from "../lib/prisma";
import type {
  Beneficiary,
  BeneficiaryParams,
  MoneyRequestParams,
  MoneyRequestResult,
  P2PTransferParams,
  P2PTransferResult,
  TransferStatus,
} from "../types/fintech.types";
import { enhancedWalletService } from "./enhanced-wallet.service";

// ===========================================
// CONSTANTS
// ===========================================

const PENDING_TRANSFER_EXPIRY_DAYS = 7;
const MAX_BENEFICIARIES = 50;
const TRANSFER_FEE_PERCENTAGE = 0; // Free P2P transfers (can be configured)

// ===========================================
// P2P TRANSFER SERVICE
// ===========================================

export class P2PTransferService {
  /**
   * Send money to another user
   */
  async sendMoney(params: P2PTransferParams): Promise<P2PTransferResult> {
    const {
      senderWalletId,
      recipientIdentifier,
      identifierType,
      amount,
      currency,
      note,
      pin,
    } = params;

    // Validate sender wallet
    const senderWallet =
      await enhancedWalletService.getWalletById(senderWalletId);
    if (!senderWallet) {
      throw new Error("Sender wallet not found");
    }

    // Verify PIN
    const pinValid = await enhancedWalletService.verifyPin(senderWalletId, pin);
    if (!pinValid) {
      throw new Error("Invalid PIN");
    }

    // Check P2P limits
    const limitCheck = await enhancedWalletService.checkLimit(
      senderWalletId,
      amount,
      "p2p"
    );
    if (!limitCheck.allowed) {
      throw new Error(limitCheck.reason || "Transfer limit exceeded");
    }

    // Check sufficient balance
    const balance = await enhancedWalletService.getBalance(
      senderWalletId,
      currency
    );
    const fee = this.calculateFee(amount);
    const totalDebit = amount + fee;

    if (balance.available < totalDebit) {
      throw new Error("Insufficient balance");
    }

    // Resolve recipient
    const recipient = await this.resolveRecipient(
      recipientIdentifier,
      identifierType
    );
    const transferId = `p2p_${nanoid(16)}`;

    if (recipient.found && recipient.walletId) {
      // Instant transfer to existing UBI user
      return this.executeInstantTransfer({
        transferId,
        senderWalletId,
        recipientWalletId: recipient.walletId,
        recipientUserId: recipient.userId!,
        amount,
        fee,
        currency,
        note,
      });
    } else {
      // Create pending transfer for non-UBI user
      return this.createPendingTransfer({
        transferId,
        senderWalletId,
        recipientIdentifier,
        identifierType,
        amount,
        fee,
        currency,
        note,
      });
    }
  }

  /**
   * Claim a pending transfer (when non-UBI user signs up)
   */
  async claimPendingTransfer(
    transferId: string,
    claimerWalletId: string
  ): Promise<P2PTransferResult> {
    const transfer = await prisma.p2PTransfer.findUnique({
      where: { id: transferId },
    });

    if (!transfer) {
      throw new Error("Transfer not found");
    }

    if (transfer.status !== "PENDING") {
      throw new Error(`Transfer is ${transfer.status.toLowerCase()}`);
    }

    // Check expiry
    if (transfer.expiresAt && transfer.expiresAt < new Date()) {
      // Refund expired transfer
      await this.refundExpiredTransfer(transferId);
      throw new Error("Transfer has expired");
    }

    // Get claimer wallet info
    const claimerWallet =
      await enhancedWalletService.getWalletById(claimerWalletId);
    if (!claimerWallet) {
      throw new Error("Claimer wallet not found");
    }

    // Credit recipient
    await enhancedWalletService.credit({
      walletId: claimerWalletId,
      amount: Number(transfer.amount),
      currency: transfer.currency,
      description: `P2P transfer from ${transfer.senderPhone || "UBI user"}`,
      reference: transferId,
    });

    // Update transfer record
    await prisma.p2PTransfer.update({
      where: { id: transferId },
      data: {
        status: "COMPLETED",
        recipientWalletId: claimerWalletId,
        recipientUserId: claimerWallet.userId,
        completedAt: new Date(),
      },
    });

    // Notify sender
    await this.notifyTransferCompleted(transferId);

    return {
      transferId,
      status: "COMPLETED",
      amount: Number(transfer.amount),
      fee: Number(transfer.fee),
      currency: transfer.currency,
      recipientName: "Recipient",
      completedAt: new Date(),
    };
  }

  /**
   * Cancel a pending transfer (refund to sender)
   */
  async cancelTransfer(
    transferId: string,
    senderWalletId: string
  ): Promise<void> {
    const transfer = await prisma.p2PTransfer.findUnique({
      where: { id: transferId },
    });

    if (!transfer) {
      throw new Error("Transfer not found");
    }

    if (transfer.senderWalletId !== senderWalletId) {
      throw new Error("Not authorized to cancel this transfer");
    }

    if (transfer.status !== "PENDING") {
      throw new Error(
        `Cannot cancel ${transfer.status.toLowerCase()} transfer`
      );
    }

    await this.refundTransfer(transferId);
  }

  /**
   * Get transfer by ID
   */
  async getTransfer(transferId: string): Promise<P2PTransferResult | null> {
    const transfer = await prisma.p2PTransfer.findUnique({
      where: { id: transferId },
    });

    if (!transfer) {
      return null;
    }

    return {
      transferId: transfer.id,
      status: transfer.status as TransferStatus,
      amount: Number(transfer.amount),
      fee: Number(transfer.fee),
      currency: transfer.currency,
      recipientName: transfer.recipientName || undefined,
      note: transfer.note || undefined,
      createdAt: transfer.createdAt,
      completedAt: transfer.completedAt || undefined,
      expiresAt: transfer.expiresAt || undefined,
    };
  }

  /**
   * Get transfer history for a wallet
   */
  async getTransferHistory(
    walletId: string,
    options: {
      direction?: "sent" | "received" | "all";
      status?: TransferStatus;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ transfers: P2PTransferResult[]; total: number }> {
    const { direction = "all", status, limit = 20, offset = 0 } = options;

    const where: Record<string, unknown> = {};

    if (direction === "sent") {
      where.senderWalletId = walletId;
    } else if (direction === "received") {
      where.recipientWalletId = walletId;
    } else {
      where.OR = [
        { senderWalletId: walletId },
        { recipientWalletId: walletId },
      ];
    }

    if (status) {
      where.status = status;
    }

    const [transfers, total] = await Promise.all([
      prisma.p2PTransfer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.p2PTransfer.count({ where }),
    ]);

    return {
      transfers: transfers.map((t) => ({
        transferId: t.id,
        status: t.status as TransferStatus,
        amount: Number(t.amount),
        fee: Number(t.fee),
        currency: t.currency,
        recipientName: t.recipientName || undefined,
        note: t.note || undefined,
        direction: t.senderWalletId === walletId ? "sent" : "received",
        createdAt: t.createdAt,
        completedAt: t.completedAt || undefined,
      })),
      total,
    };
  }

  // ===========================================
  // MONEY REQUESTS
  // ===========================================

  /**
   * Request money from another user
   */
  async requestMoney(params: MoneyRequestParams): Promise<MoneyRequestResult> {
    const {
      requesterWalletId,
      payerIdentifier,
      identifierType,
      amount,
      currency,
      note,
    } = params;

    const requestId = `req_${nanoid(16)}`;

    // Resolve payer
    const payer = await this.resolveRecipient(payerIdentifier, identifierType);

    // Create money request
    await prisma.moneyRequest.create({
      data: {
        id: requestId,
        requesterWalletId,
        payerPhone: identifierType === "phone" ? payerIdentifier : null,
        payerEmail: identifierType === "email" ? payerIdentifier : null,
        payerUserId: payer.found ? payer.userId : null,
        amount,
        currency,
        note,
        status: "PENDING",
        expiresAt: new Date(
          Date.now() + PENDING_TRANSFER_EXPIRY_DAYS * 24 * 60 * 60 * 1000
        ),
      },
    });

    // Send notification to payer if they're a UBI user
    if (payer.found && payer.userId) {
      await this.notifyMoneyRequest(requestId, payer.userId);
    }

    return {
      requestId,
      status: "PENDING",
      amount,
      currency,
      payerName: payer.found ? payer.name : undefined,
    };
  }

  /**
   * Pay a money request
   */
  async payMoneyRequest(
    requestId: string,
    payerWalletId: string,
    pin: string
  ): Promise<P2PTransferResult> {
    const request = await prisma.moneyRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new Error("Request not found");
    }

    if (request.status !== "PENDING") {
      throw new Error(`Request is ${request.status.toLowerCase()}`);
    }

    // Check expiry
    if (request.expiresAt && request.expiresAt < new Date()) {
      await prisma.moneyRequest.update({
        where: { id: requestId },
        data: { status: "EXPIRED" },
      });
      throw new Error("Request has expired");
    }

    // Execute transfer
    const transfer = await this.sendMoney({
      senderWalletId: payerWalletId,
      recipientIdentifier: request.requesterWalletId,
      identifierType: "walletId",
      amount: Number(request.amount),
      currency: request.currency,
      note: request.note || `Payment for request ${requestId}`,
      pin,
    });

    // Update request status
    await prisma.moneyRequest.update({
      where: { id: requestId },
      data: {
        status: "PAID",
        transferId: transfer.transferId,
      },
    });

    return transfer;
  }

  /**
   * Decline a money request
   */
  async declineMoneyRequest(
    requestId: string,
    payerWalletId: string
  ): Promise<void> {
    const request = await prisma.moneyRequest.findUnique({
      where: { id: requestId },
      include: {
        requesterWallet: true,
      },
    });

    if (!request) {
      throw new Error("Request not found");
    }

    // Verify the payer is authorized to decline
    const payerWallet =
      await enhancedWalletService.getWalletById(payerWalletId);
    if (!payerWallet) {
      throw new Error("Payer wallet not found");
    }

    // Check if this payer matches the request
    const user = await prisma.user.findUnique({
      where: { id: payerWallet.userId },
    });

    if (!user) {
      throw new Error("User not found");
    }

    const isAuthorized =
      request.payerUserId === payerWallet.userId ||
      request.payerPhone === user.phoneNumber ||
      request.payerEmail === user.email;

    if (!isAuthorized) {
      throw new Error("Not authorized to decline this request");
    }

    await prisma.moneyRequest.update({
      where: { id: requestId },
      data: { status: "DECLINED" },
    });

    // Notify requester
    await this.notifyRequestDeclined(requestId);
  }

  /**
   * Cancel a money request
   */
  async cancelMoneyRequest(
    requestId: string,
    requesterWalletId: string
  ): Promise<void> {
    const request = await prisma.moneyRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new Error("Request not found");
    }

    if (request.requesterWalletId !== requesterWalletId) {
      throw new Error("Not authorized to cancel this request");
    }

    if (request.status !== "PENDING") {
      throw new Error(`Cannot cancel ${request.status.toLowerCase()} request`);
    }

    await prisma.moneyRequest.update({
      where: { id: requestId },
      data: { status: "CANCELLED" },
    });
  }

  /**
   * Get money requests
   */
  async getMoneyRequests(
    walletId: string,
    type: "sent" | "received",
    options: { status?: string; limit?: number; offset?: number } = {}
  ): Promise<{ requests: MoneyRequestResult[]; total: number }> {
    const { status, limit = 20, offset = 0 } = options;

    const where: Record<string, unknown> =
      type === "sent"
        ? { requesterWalletId: walletId }
        : { payerWalletId: walletId };

    if (status) where.status = status;

    const [requests, total] = await Promise.all([
      prisma.moneyRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.moneyRequest.count({ where }),
    ]);

    return {
      requests: requests.map((r) => ({
        requestId: r.id,
        status: r.status as TransferStatus,
        amount: Number(r.amount),
        currency: r.currency,
        note: r.note || undefined,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt || undefined,
      })),
      total,
    };
  }

  // ===========================================
  // BENEFICIARIES
  // ===========================================

  /**
   * Add a beneficiary
   */
  async addBeneficiary(params: BeneficiaryParams): Promise<Beneficiary> {
    const { walletId, name, identifier, identifierType, isFrequent } = params;

    // Check beneficiary limit
    const count = await prisma.beneficiary.count({
      where: { walletId },
    });

    if (count >= MAX_BENEFICIARIES) {
      throw new Error(`Maximum ${MAX_BENEFICIARIES} beneficiaries allowed`);
    }

    // Check for duplicate
    const existing = await prisma.beneficiary.findFirst({
      where: {
        walletId,
        OR: [
          { phone: identifier },
          { email: identifier },
          { ubiUsername: identifier },
        ],
      },
    });

    if (existing) {
      throw new Error("Beneficiary already exists");
    }

    // Resolve recipient to get their details
    const recipient = await this.resolveRecipient(identifier, identifierType);

    const beneficiary = await prisma.beneficiary.create({
      data: {
        walletId,
        name,
        phone: identifierType === "phone" ? identifier : null,
        email: identifierType === "email" ? identifier : null,
        ubiUsername: identifierType === "username" ? identifier : null,
        recipientWalletId: recipient.found ? recipient.walletId : null,
        isFrequent: isFrequent ?? false,
      },
    });

    return this.formatBeneficiary(beneficiary);
  }

  /**
   * Get beneficiaries
   */
  async getBeneficiaries(
    walletId: string,
    options: { frequentOnly?: boolean; limit?: number; offset?: number } = {}
  ): Promise<{ beneficiaries: Beneficiary[]; total: number }> {
    const { frequentOnly = false, limit = 50, offset = 0 } = options;

    const where: Record<string, unknown> = { walletId };
    if (frequentOnly) where.isFrequent = true;

    const [beneficiaries, total] = await Promise.all([
      prisma.beneficiary.findMany({
        where,
        orderBy: [
          { isFrequent: "desc" },
          { transferCount: "desc" },
          { name: "asc" },
        ],
        take: limit,
        skip: offset,
      }),
      prisma.beneficiary.count({ where }),
    ]);

    return {
      beneficiaries: beneficiaries.map((b) => this.formatBeneficiary(b)),
      total,
    };
  }

  /**
   * Update beneficiary
   */
  async updateBeneficiary(
    beneficiaryId: string,
    walletId: string,
    updates: { name?: string; isFrequent?: boolean }
  ): Promise<Beneficiary> {
    const beneficiary = await prisma.beneficiary.findUnique({
      where: { id: beneficiaryId },
    });

    if (!beneficiary || beneficiary.walletId !== walletId) {
      throw new Error("Beneficiary not found");
    }

    const updated = await prisma.beneficiary.update({
      where: { id: beneficiaryId },
      data: updates,
    });

    return this.formatBeneficiary(updated);
  }

  /**
   * Delete beneficiary
   */
  async deleteBeneficiary(
    beneficiaryId: string,
    walletId: string
  ): Promise<void> {
    const beneficiary = await prisma.beneficiary.findUnique({
      where: { id: beneficiaryId },
    });

    if (!beneficiary || beneficiary.walletId !== walletId) {
      throw new Error("Beneficiary not found");
    }

    await prisma.beneficiary.delete({
      where: { id: beneficiaryId },
    });
  }

  // ===========================================
  // PRIVATE HELPERS
  // ===========================================

  private async resolveRecipient(
    identifier: string,
    type: "phone" | "email" | "username" | "walletId"
  ): Promise<{
    found: boolean;
    walletId?: string;
    userId?: string;
    name?: string;
  }> {
    let user = null;

    if (type === "walletId") {
      // Direct wallet lookup
      const wallet = await prisma.wallet.findUnique({
        where: { id: identifier },
        include: { user: true },
      });
      if (wallet) {
        return {
          found: true,
          walletId: wallet.id,
          userId: wallet.userId,
          name: wallet.user.firstName
            ? `${wallet.user.firstName} ${wallet.user.lastName || ""}`
            : undefined,
        };
      }
    } else if (type === "phone") {
      user = await prisma.user.findUnique({
        where: { phoneNumber: identifier },
        include: { wallet: true },
      });
    } else if (type === "email") {
      user = await prisma.user.findUnique({
        where: { email: identifier },
        include: { wallet: true },
      });
    } else if (type === "username") {
      user = await prisma.user.findFirst({
        where: { ubiUsername: identifier },
        include: { wallet: true },
      });
    }

    if (user && user.wallet) {
      return {
        found: true,
        walletId: user.wallet.id,
        userId: user.id,
        name: user.firstName
          ? `${user.firstName} ${user.lastName || ""}`
          : undefined,
      };
    }

    return { found: false };
  }

  private async executeInstantTransfer(params: {
    transferId: string;
    senderWalletId: string;
    recipientWalletId: string;
    recipientUserId: string;
    amount: number;
    fee: number;
    currency: Currency;
    note?: string;
  }): Promise<P2PTransferResult> {
    const {
      transferId,
      senderWalletId,
      recipientWalletId,
      recipientUserId,
      amount,
      fee,
      currency,
      note,
    } = params;

    // Get recipient details
    const recipientUser = await prisma.user.findUnique({
      where: { id: recipientUserId },
    });

    const recipientName = recipientUser?.firstName
      ? `${recipientUser.firstName} ${recipientUser.lastName || ""}`
      : "UBI User";

    // Execute transfer in transaction
    await prisma.$transaction(async (tx) => {
      // Debit sender
      await enhancedWalletService.debit({
        walletId: senderWalletId,
        amount: amount + fee,
        currency,
        description: `P2P transfer to ${recipientName}`,
        reference: transferId,
      });

      // Credit recipient
      await enhancedWalletService.credit({
        walletId: recipientWalletId,
        amount,
        currency,
        description: `P2P transfer received`,
        reference: transferId,
      });

      // Create transfer record
      await tx.p2PTransfer.create({
        data: {
          id: transferId,
          senderWalletId,
          recipientWalletId,
          recipientUserId,
          recipientName,
          amount,
          fee,
          currency,
          note,
          status: "COMPLETED",
          completedAt: new Date(),
        },
      });
    });

    // Update beneficiary transfer count
    await this.updateBeneficiaryTransferCount(
      senderWalletId,
      recipientWalletId
    );

    // Send notifications
    await this.notifyTransferCompleted(transferId);

    return {
      transferId,
      status: "COMPLETED",
      amount,
      fee,
      currency,
      recipientName,
      note,
      completedAt: new Date(),
    };
  }

  private async createPendingTransfer(params: {
    transferId: string;
    senderWalletId: string;
    recipientIdentifier: string;
    identifierType: "phone" | "email" | "username";
    amount: number;
    fee: number;
    currency: Currency;
    note?: string;
  }): Promise<P2PTransferResult> {
    const {
      transferId,
      senderWalletId,
      recipientIdentifier,
      identifierType,
      amount,
      fee,
      currency,
      note,
    } = params;

    const expiresAt = new Date(
      Date.now() + PENDING_TRANSFER_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    );

    // Hold funds from sender
    await enhancedWalletService.debit({
      walletId: senderWalletId,
      amount: amount + fee,
      currency,
      description: `P2P transfer (pending) - ${recipientIdentifier}`,
      reference: transferId,
    });

    // Create pending transfer record
    await prisma.p2PTransfer.create({
      data: {
        id: transferId,
        senderWalletId,
        recipientPhone: identifierType === "phone" ? recipientIdentifier : null,
        recipientEmail: identifierType === "email" ? recipientIdentifier : null,
        amount,
        fee,
        currency,
        note,
        status: "PENDING",
        expiresAt,
      },
    });

    // Send invite notification to recipient
    await this.sendInviteNotification(
      recipientIdentifier,
      identifierType,
      amount,
      currency
    );

    return {
      transferId,
      status: "PENDING",
      amount,
      fee,
      currency,
      note,
      expiresAt,
      message: `Transfer pending. Recipient will receive ${amount} ${currency} when they join UBI.`,
    };
  }

  private async refundExpiredTransfer(transferId: string): Promise<void> {
    await prisma.p2PTransfer.update({
      where: { id: transferId },
      data: { status: "EXPIRED" },
    });

    await this.refundTransfer(transferId);
  }

  private async refundTransfer(transferId: string): Promise<void> {
    const transfer = await prisma.p2PTransfer.findUnique({
      where: { id: transferId },
    });

    if (!transfer) return;

    // Refund sender
    await enhancedWalletService.credit({
      walletId: transfer.senderWalletId,
      amount: Number(transfer.amount) + Number(transfer.fee),
      currency: transfer.currency,
      description: `Refund - P2P transfer ${transferId}`,
      reference: `refund_${transferId}`,
    });

    await prisma.p2PTransfer.update({
      where: { id: transferId },
      data: {
        status: "REFUNDED",
        completedAt: new Date(),
      },
    });
  }

  private async updateBeneficiaryTransferCount(
    senderWalletId: string,
    recipientWalletId: string
  ): Promise<void> {
    await prisma.beneficiary.updateMany({
      where: {
        walletId: senderWalletId,
        recipientWalletId,
      },
      data: {
        transferCount: { increment: 1 },
        lastTransferAt: new Date(),
      },
    });
  }

  private calculateFee(amount: number): number {
    return Math.round(amount * TRANSFER_FEE_PERCENTAGE * 100) / 100;
  }

  private formatBeneficiary(b: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    ubiUsername: string | null;
    isFrequent: boolean;
    transferCount: number;
    lastTransferAt: Date | null;
    recipientWalletId: string | null;
  }): Beneficiary {
    return {
      id: b.id,
      name: b.name,
      phone: b.phone || undefined,
      email: b.email || undefined,
      ubiUsername: b.ubiUsername || undefined,
      isUbiUser: !!b.recipientWalletId,
      isFrequent: b.isFrequent,
      transferCount: b.transferCount,
      lastTransferAt: b.lastTransferAt || undefined,
    };
  }

  // ===========================================
  // NOTIFICATIONS (stubs - implement with notification service)
  // ===========================================

  private async notifyTransferCompleted(transferId: string): Promise<void> {
    // TODO: Integrate with notification service
    console.log(`[P2P] Transfer completed: ${transferId}`);
  }

  private async notifyMoneyRequest(
    requestId: string,
    payerUserId: string
  ): Promise<void> {
    console.log(`[P2P] Money request ${requestId} sent to user ${payerUserId}`);
  }

  private async notifyRequestDeclined(requestId: string): Promise<void> {
    console.log(`[P2P] Money request ${requestId} declined`);
  }

  private async sendInviteNotification(
    identifier: string,
    type: "phone" | "email" | "username",
    amount: number,
    currency: Currency
  ): Promise<void> {
    console.log(
      `[P2P] Invite sent to ${type}:${identifier} for ${amount} ${currency}`
    );
  }
}

// Export singleton instance
export const p2pTransferService = new P2PTransferService();
