/**
 * P2P Transfer Service
 * Person-to-person money transfers with phone/email/username lookup
 */

import type { Currency } from "@prisma/client";
import { nanoid } from "nanoid";
import { prisma } from "../lib/prisma";
import { notificationClient } from "../lib/notification-client";
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
      amount,
      currency,
      note,
      pin,
    } = params;
    const identifierType = (params as any).identifierType || "walletId";

    // Validate sender wallet
    const senderWallet =
      await enhancedWalletService.getWalletById(senderWalletId);
    if (!senderWallet) {
      throw new Error("Sender wallet not found");
    }

    // Verify PIN
    if (!pin) {
      throw new Error("PIN is required");
    }
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
      currency as Currency
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
        currency: currency as Currency,
        note,
      });
    } else {
      // Create pending transfer for non-UBI user
      return this.createPendingTransfer({
        transferId,
        senderWalletId,
        recipientIdentifier,
        identifierType: identifierType as "phone" | "email" | "username",
        amount,
        fee,
        currency: currency as Currency,
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
      senderName: "Sender",
      recipientName: "Recipient",
      amount: Number(transfer.amount),
      fee: Number(transfer.fee),
      currency: transfer.currency,
      isPending: false,
      createdAt: transfer.createdAt,
    } as P2PTransferResult;
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
      senderName: "Sender",
      recipientName: transfer.recipientName || "Recipient",
      amount: Number(transfer.amount),
      fee: Number(transfer.fee),
      currency: transfer.currency,
      note: transfer.note || undefined,
      isPending: transfer.status === "PENDING",
      expiresAt: transfer.expiresAt || undefined,
      createdAt: transfer.createdAt,
    } as P2PTransferResult;
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
      transfers: transfers.map((t: any) => ({
        transferId: t.id,
        status: t.status as TransferStatus,
        amount: Number(t.amount),
        fee: Number(t.fee),
        currency: t.currency,
        recipientName: t.recipientName || undefined,
        note: t.note || undefined,
        direction: t.senderWalletId === walletId ? "sent" : "received",
        createdAt: t.createdAt,
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
      amount,
      currency,
      note,
    } = params;
    const requesterWalletId = (params as any).requestorWalletId;
    const payerIdentifier = (params as any).responderIdentifier;
    const identifierType: "phone" | "email" | "username" = "phone";

    const requestId = `req_${nanoid(16)}`;

    // Resolve payer
    const payer = await this.resolveRecipient(payerIdentifier, identifierType);

    // Create money request
    await prisma.moneyRequest.create({
      data: {
        id: requestId,
        requesterWalletId,
        payerPhone: payerIdentifier.includes("@") ? null : payerIdentifier,
        payerEmail: payerIdentifier.includes("@") ? payerIdentifier : null,
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
      requestorName: "Requestor",
      amount,
      currency,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      shareLink: `${process.env.APP_URL}/pay/${requestId}`,
    } as MoneyRequestResult;
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
      amount: Number(request.amount),
      currency: request.currency,
      note: request.note || `Payment for request ${requestId}`,
      pin,
    } as any);

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
      requests: requests.map((r: any) => ({
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
      beneficiaries: beneficiaries.map((b: any) => this.formatBeneficiary(b)),
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
      senderName: "Sender",
      recipientName,
      amount,
      fee,
      currency,
      note,
      isPending: false,
      createdAt: new Date(),
    } as P2PTransferResult;
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
      senderName: "Sender",
      recipientName: recipientIdentifier,
      amount,
      fee,
      currency,
      note,
      isPending: true,
      createdAt: new Date(),
      expiresAt,
    } as P2PTransferResult;
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
      type: "p2p" as const,
      isFavorite: b.isFrequent,
      lastUsedAt: b.lastTransferAt || undefined,
    } as Beneficiary;
  }

  // ===========================================
  // NOTIFICATIONS
  // ===========================================

  private async notifyTransferCompleted(transferId: string): Promise<void> {
    try {
      const transfer = await prisma.p2pTransfer.findUnique({
        where: { id: transferId },
        include: {
          sender: { select: { id: true, firstName: true, lastName: true } },
          recipient: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      if (!transfer || !transfer.sender || !transfer.recipient) {
        console.warn(`[P2P] Transfer not found for notification: ${transferId}`);
        return;
      }

      const recipientName = `${transfer.recipient.firstName} ${transfer.recipient.lastName}`.trim();

      await notificationClient.notifyTransferCompleted(
        transfer.senderId,
        transfer.recipientId,
        Number(transfer.amount),
        transfer.currency,
        recipientName
      );

      console.log(`[P2P] Transfer notification sent for ${transferId}`);
    } catch (error) {
      console.error(`[P2P] Failed to send transfer notification:`, error);
    }
  }

  private async notifyMoneyRequest(
    requestId: string,
    payerUserId: string
  ): Promise<void> {
    try {
      const request = await prisma.moneyRequest.findUnique({
        where: { id: requestId },
        include: {
          requester: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      if (!request || !request.requester) {
        console.warn(`[P2P] Money request not found: ${requestId}`);
        return;
      }

      const requesterName = `${request.requester.firstName} ${request.requester.lastName}`.trim();

      await notificationClient.notifyMoneyRequest(
        payerUserId,
        request.requesterId,
        Number(request.amount),
        request.currency,
        requesterName,
        request.note || undefined
      );

      console.log(`[P2P] Money request notification sent for ${requestId}`);
    } catch (error) {
      console.error(`[P2P] Failed to send money request notification:`, error);
    }
  }

  private async notifyRequestDeclined(requestId: string): Promise<void> {
    try {
      const request = await prisma.moneyRequest.findUnique({
        where: { id: requestId },
        include: {
          requester: { select: { id: true } },
          payer: { select: { firstName: true, lastName: true } },
        },
      });

      if (!request || !request.requester || !request.payer) {
        console.warn(`[P2P] Money request not found for decline: ${requestId}`);
        return;
      }

      const payerName = `${request.payer.firstName} ${request.payer.lastName}`.trim();

      await notificationClient.notifyRequestDeclined(
        request.requesterId,
        payerName,
        Number(request.amount),
        request.currency
      );

      console.log(`[P2P] Request declined notification sent for ${requestId}`);
    } catch (error) {
      console.error(`[P2P] Failed to send decline notification:`, error);
    }
  }

  private async sendInviteNotification(
    identifier: string,
    type: "phone" | "email" | "username",
    amount: number,
    currency: Currency
  ): Promise<void> {
    try {
      // For now, log the invite - in production, this would send an SMS/email
      console.log(`[P2P] Sending invite to ${type}:${identifier} for ${amount} ${currency}`);

      // TODO: Integrate with SMS/Email service for user invites
      // This would send a message like:
      // "Someone wants to send you money on UBI! Download the app to receive your {amount} {currency}."

      if (type === "phone") {
        // Send SMS via notification service
        const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || "http://notification-service:4006";
        await fetch(`${NOTIFICATION_SERVICE_URL}/v1/sms/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: identifier,
            message: `You've received a pending payment of ${currency} ${amount.toLocaleString()} on UBI! Download the app to claim it: https://ubi.africa/app`,
            type: "transactional",
          }),
        });
      } else if (type === "email") {
        // Send email via notification service
        const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || "http://notification-service:4006";
        await fetch(`${NOTIFICATION_SERVICE_URL}/v1/email/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: identifier,
            subject: `You've received ${currency} ${amount.toLocaleString()} on UBI!`,
            template: "money_received_invite",
            data: { amount, currency },
          }),
        });
      }
    } catch (error) {
      console.error(`[P2P] Failed to send invite notification:`, error);
    }
  }
}

// Export singleton instance
export const p2pTransferService = new P2PTransferService();

// Export with expected names for index.ts
export { P2PTransferService as P2PService };
export const p2pService = p2pTransferService;
