/**
 * QR Payment Service
 * Merchant QR codes, dynamic QR generation, and scan-to-pay
 */

import type { Currency } from "@prisma/client";
import { nanoid } from "nanoid";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import type {
  DynamicQRParams,
  DynamicQRResult,
  MerchantQRCode,
  QRCodeType,
  QRPayload,
  QRPaymentParams,
  QRPaymentResult,
} from "../types/fintech.types";
import { enhancedWalletService } from "./enhanced-wallet.service";

// ===========================================
// CONSTANTS
// ===========================================

const QR_VERSION = "1";
const QR_EXPIRY_MINUTES = 15; // For dynamic QR codes
const MAX_MERCHANT_QR_CODES = 10;

// ===========================================
// QR PAYMENT SERVICE
// ===========================================

export class QRPaymentService {
  /**
   * Generate a static merchant QR code
   */
  async createMerchantQR(params: {
    merchantId: string;
    walletId: string;
    name: string;
    location?: string;
    defaultCurrency: Currency;
    fixedAmount?: number;
  }): Promise<MerchantQRCode> {
    const {
      merchantId,
      walletId,
      name,
      location,
      defaultCurrency,
      fixedAmount,
    } = params;

    // Check limit
    const existingCount = await prisma.merchantQRCode.count({
      where: { merchantId, isActive: true },
    });

    if (existingCount >= MAX_MERCHANT_QR_CODES) {
      throw new Error(
        `Maximum ${MAX_MERCHANT_QR_CODES} active QR codes allowed per merchant`
      );
    }

    const qrId = `qr_${nanoid(12)}`;
    const type: QRCodeType = fixedAmount ? "STATIC_FIXED" : "STATIC_VARIABLE";

    // Create QR payload
    const payload: QRPayload = {
      version: QR_VERSION,
      type,
      merchantId,
      qrId,
      currency: defaultCurrency,
      amount: fixedAmount,
    };

    const qrData = this.encodeQRPayload(payload);

    const qrCode = await prisma.merchantQRCode.create({
      data: {
        id: qrId,
        merchantId,
        walletId,
        name,
        type,
        qrData,
        location,
        defaultCurrency,
        fixedAmount,
        isActive: true,
      },
    });

    return {
      id: qrCode.id,
      merchantId: qrCode.merchantId,
      walletId: qrCode.walletId,
      name: qrCode.name,
      type: qrCode.type as QRCodeType,
      qrData: qrCode.qrData,
      location: qrCode.location || undefined,
      defaultCurrency: qrCode.defaultCurrency,
      fixedAmount: qrCode.fixedAmount ? Number(qrCode.fixedAmount) : undefined,
      isActive: qrCode.isActive,
      totalTransactions: qrCode.totalTransactions,
      totalAmount: Number(qrCode.totalAmount),
    };
  }

  /**
   * Generate a dynamic (one-time) QR code
   */
  async generateDynamicQR(params: DynamicQRParams): Promise<DynamicQRResult> {
    const {
      walletId,
      amount,
      currency,
      description,
      expiryMinutes = QR_EXPIRY_MINUTES,
    } = params;

    const qrId = `dqr_${nanoid(16)}`;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    // Create payload
    const payload: QRPayload = {
      version: QR_VERSION,
      type: "DYNAMIC",
      walletId,
      qrId,
      amount,
      currency,
      description,
      expiresAt: expiresAt.toISOString(),
    };

    const qrData = this.encodeQRPayload(payload);

    // Store in Redis with expiry
    await redis.setex(
      `dynamic_qr:${qrId}`,
      expiryMinutes * 60,
      JSON.stringify({
        walletId,
        amount,
        currency,
        description,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        used: false,
      })
    );

    return {
      qrId,
      qrData,
      amount,
      currency,
      description,
      expiresAt,
    };
  }

  /**
   * Decode and validate a QR code
   */
  async decodeQR(
    qrData: string
  ): Promise<QRPayload & { valid: boolean; error?: string }> {
    try {
      const payload = this.decodeQRPayload(qrData);

      // Validate version
      if (payload.version !== QR_VERSION) {
        return { ...payload, valid: false, error: "Unsupported QR version" };
      }

      // Validate based on type
      if (payload.type === "DYNAMIC") {
        const stored = await redis.get(`dynamic_qr:${payload.qrId}`);
        if (!stored) {
          return {
            ...payload,
            valid: false,
            error: "QR code expired or invalid",
          };
        }

        const data = JSON.parse(stored);
        if (data.used) {
          return { ...payload, valid: false, error: "QR code already used" };
        }

        if (new Date(data.expiresAt) < new Date()) {
          return { ...payload, valid: false, error: "QR code expired" };
        }
      } else {
        // Static QR - validate merchant
        const qrCode = await prisma.merchantQRCode.findUnique({
          where: { id: payload.qrId },
        });

        if (!qrCode || !qrCode.isActive) {
          return {
            ...payload,
            valid: false,
            error: "QR code not found or inactive",
          };
        }
      }

      return { ...payload, valid: true };
    } catch (error) {
      return {
        version: "",
        type: "STATIC_VARIABLE",
        qrId: "",
        valid: false,
        error: "Invalid QR code format",
      };
    }
  }

  /**
   * Process QR payment
   */
  async payWithQR(params: QRPaymentParams): Promise<QRPaymentResult> {
    const { payerWalletId, qrData, amount: inputAmount, pin, note } = params;

    // Decode and validate QR
    const payload = await this.decodeQR(qrData);
    if (!payload.valid) {
      throw new Error(payload.error || "Invalid QR code");
    }

    // Verify PIN
    const pinValid = await enhancedWalletService.verifyPin(payerWalletId, pin);
    if (!pinValid) {
      throw new Error("Invalid PIN");
    }

    // Determine amount and recipient
    let amount: number;
    let recipientWalletId: string;
    let currency: Currency;

    if (payload.type === "DYNAMIC") {
      // Dynamic QR - use stored amount
      const stored = await redis.get(`dynamic_qr:${payload.qrId}`);
      if (!stored) {
        throw new Error("QR code expired");
      }
      const data = JSON.parse(stored);
      amount = data.amount;
      recipientWalletId = data.walletId;
      currency = data.currency;

      // Mark as used
      await redis.setex(
        `dynamic_qr:${payload.qrId}`,
        60, // Keep for 1 minute for reference
        JSON.stringify({ ...data, used: true })
      );
    } else if (payload.type === "STATIC_FIXED") {
      // Fixed amount merchant QR
      const qrCode = await prisma.merchantQRCode.findUnique({
        where: { id: payload.qrId },
      });
      if (!qrCode) {
        throw new Error("QR code not found");
      }
      amount = Number(qrCode.fixedAmount);
      recipientWalletId = qrCode.walletId;
      currency = qrCode.defaultCurrency;
    } else {
      // Variable amount merchant QR
      if (!inputAmount || inputAmount <= 0) {
        throw new Error("Amount is required for this QR code");
      }
      const qrCode = await prisma.merchantQRCode.findUnique({
        where: { id: payload.qrId },
      });
      if (!qrCode) {
        throw new Error("QR code not found");
      }
      amount = inputAmount;
      recipientWalletId = qrCode.walletId;
      currency = qrCode.defaultCurrency;
    }

    // Check balance
    const balance = await enhancedWalletService.getBalance(
      payerWalletId,
      currency
    );
    if (balance.available < amount) {
      throw new Error("Insufficient balance");
    }

    const paymentId = `qrpay_${nanoid(16)}`;

    // Execute payment
    await prisma.$transaction(async (tx) => {
      // Debit payer
      await enhancedWalletService.debit({
        walletId: payerWalletId,
        amount,
        currency,
        description:
          payload.type === "DYNAMIC"
            ? `QR Payment - ${payload.description || "Dynamic QR"}`
            : `QR Payment - Merchant`,
        reference: paymentId,
      });

      // Credit recipient
      await enhancedWalletService.credit({
        walletId: recipientWalletId,
        amount,
        currency,
        description: "QR Payment received",
        reference: paymentId,
      });

      // Create payment record
      await tx.qRPayment.create({
        data: {
          id: paymentId,
          payerWalletId,
          recipientWalletId,
          qrCodeId: payload.type !== "DYNAMIC" ? payload.qrId : null,
          qrType: payload.type,
          amount,
          currency,
          note,
          status: "COMPLETED",
          completedAt: new Date(),
        },
      });

      // Update merchant QR statistics
      if (payload.type !== "DYNAMIC") {
        await tx.merchantQRCode.update({
          where: { id: payload.qrId },
          data: {
            totalTransactions: { increment: 1 },
            totalAmount: { increment: amount },
            lastUsedAt: new Date(),
          },
        });
      }
    });

    // Get recipient info
    const recipientWallet =
      await enhancedWalletService.getWalletById(recipientWalletId);
    const recipientUser = recipientWallet
      ? await prisma.user.findUnique({ where: { id: recipientWallet.userId } })
      : null;

    return {
      paymentId,
      status: "COMPLETED",
      amount,
      currency,
      recipientName: recipientUser?.firstName
        ? `${recipientUser.firstName} ${recipientUser.lastName || ""}`
        : "UBI User",
      note,
      completedAt: new Date(),
    };
  }

  /**
   * Get merchant QR codes
   */
  async getMerchantQRCodes(merchantId: string): Promise<MerchantQRCode[]> {
    const qrCodes = await prisma.merchantQRCode.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
    });

    return qrCodes.map((qr) => ({
      id: qr.id,
      merchantId: qr.merchantId,
      walletId: qr.walletId,
      name: qr.name,
      type: qr.type as QRCodeType,
      qrData: qr.qrData,
      location: qr.location || undefined,
      defaultCurrency: qr.defaultCurrency,
      fixedAmount: qr.fixedAmount ? Number(qr.fixedAmount) : undefined,
      isActive: qr.isActive,
      totalTransactions: qr.totalTransactions,
      totalAmount: Number(qr.totalAmount),
      createdAt: qr.createdAt,
      lastUsedAt: qr.lastUsedAt || undefined,
    }));
  }

  /**
   * Update merchant QR code
   */
  async updateMerchantQR(
    qrId: string,
    merchantId: string,
    updates: { name?: string; location?: string; isActive?: boolean }
  ): Promise<MerchantQRCode> {
    const qrCode = await prisma.merchantQRCode.findUnique({
      where: { id: qrId },
    });

    if (!qrCode || qrCode.merchantId !== merchantId) {
      throw new Error("QR code not found");
    }

    const updated = await prisma.merchantQRCode.update({
      where: { id: qrId },
      data: updates,
    });

    return {
      id: updated.id,
      merchantId: updated.merchantId,
      walletId: updated.walletId,
      name: updated.name,
      type: updated.type as QRCodeType,
      qrData: updated.qrData,
      location: updated.location || undefined,
      defaultCurrency: updated.defaultCurrency,
      fixedAmount: updated.fixedAmount
        ? Number(updated.fixedAmount)
        : undefined,
      isActive: updated.isActive,
      totalTransactions: updated.totalTransactions,
      totalAmount: Number(updated.totalAmount),
    };
  }

  /**
   * Delete merchant QR code
   */
  async deleteMerchantQR(qrId: string, merchantId: string): Promise<void> {
    const qrCode = await prisma.merchantQRCode.findUnique({
      where: { id: qrId },
    });

    if (!qrCode || qrCode.merchantId !== merchantId) {
      throw new Error("QR code not found");
    }

    await prisma.merchantQRCode.delete({
      where: { id: qrId },
    });
  }

  /**
   * Get QR payment history
   */
  async getQRPaymentHistory(
    walletId: string,
    options: {
      role?: "payer" | "recipient" | "all";
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ payments: QRPaymentResult[]; total: number }> {
    const { role = "all", limit = 20, offset = 0 } = options;

    const where: Record<string, unknown> = {};

    if (role === "payer") {
      where.payerWalletId = walletId;
    } else if (role === "recipient") {
      where.recipientWalletId = walletId;
    } else {
      where.OR = [{ payerWalletId: walletId }, { recipientWalletId: walletId }];
    }

    const [payments, total] = await Promise.all([
      prisma.qRPayment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.qRPayment.count({ where }),
    ]);

    return {
      payments: payments.map((p) => ({
        paymentId: p.id,
        status: p.status as "COMPLETED" | "FAILED",
        amount: Number(p.amount),
        currency: p.currency,
        note: p.note || undefined,
        direction: p.payerWalletId === walletId ? "sent" : "received",
        createdAt: p.createdAt,
        completedAt: p.completedAt || undefined,
      })),
      total,
    };
  }

  /**
   * Get QR code analytics for merchant
   */
  async getQRAnalytics(
    merchantId: string,
    qrId?: string,
    dateRange?: { start: Date; end: Date }
  ): Promise<{
    totalTransactions: number;
    totalAmount: number;
    averageAmount: number;
    byQRCode: Array<{
      qrId: string;
      name: string;
      transactions: number;
      amount: number;
    }>;
    byDay: Array<{
      date: string;
      transactions: number;
      amount: number;
    }>;
  }> {
    const where: Record<string, unknown> = {};

    if (qrId) {
      where.qrCodeId = qrId;
    } else {
      // Get all QR codes for merchant
      const qrCodes = await prisma.merchantQRCode.findMany({
        where: { merchantId },
        select: { id: true },
      });
      where.qrCodeId = { in: qrCodes.map((q) => q.id) };
    }

    if (dateRange) {
      where.createdAt = {
        gte: dateRange.start,
        lte: dateRange.end,
      };
    }

    const payments = await prisma.qRPayment.findMany({
      where,
      include: {
        qrCode: true,
      },
    });

    // Calculate totals
    const totalTransactions = payments.length;
    const totalAmount = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const averageAmount =
      totalTransactions > 0 ? totalAmount / totalTransactions : 0;

    // Group by QR code
    const byQRCode = new Map<
      string,
      { name: string; transactions: number; amount: number }
    >();
    for (const payment of payments) {
      if (!payment.qrCodeId) continue;
      const existing = byQRCode.get(payment.qrCodeId) || {
        name: payment.qrCode?.name || "Unknown",
        transactions: 0,
        amount: 0,
      };
      existing.transactions++;
      existing.amount += Number(payment.amount);
      byQRCode.set(payment.qrCodeId, existing);
    }

    // Group by day
    const byDay = new Map<string, { transactions: number; amount: number }>();
    for (const payment of payments) {
      const date = payment.createdAt.toISOString().split("T")[0];
      const existing = byDay.get(date) || { transactions: 0, amount: 0 };
      existing.transactions++;
      existing.amount += Number(payment.amount);
      byDay.set(date, existing);
    }

    return {
      totalTransactions,
      totalAmount,
      averageAmount,
      byQRCode: Array.from(byQRCode.entries()).map(([qrId, data]) => ({
        qrId,
        ...data,
      })),
      byDay: Array.from(byDay.entries())
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  // ===========================================
  // PRIVATE HELPERS
  // ===========================================

  private encodeQRPayload(payload: QRPayload): string {
    // Create a compact, URL-safe encoded payload
    // Format: UBI1|type|qrId|merchantId|walletId|currency|amount|desc|exp
    const parts = [
      `UBI${payload.version}`,
      payload.type,
      payload.qrId,
      payload.merchantId || "",
      payload.walletId || "",
      payload.currency || "",
      payload.amount?.toString() || "",
      payload.description || "",
      payload.expiresAt || "",
    ];

    const data = parts.join("|");
    // Base64 encode for QR code
    return Buffer.from(data).toString("base64url");
  }

  private decodeQRPayload(qrData: string): QRPayload {
    try {
      const data = Buffer.from(qrData, "base64url").toString("utf-8");
      const parts = data.split("|");

      if (parts.length < 3 || !parts[0].startsWith("UBI")) {
        throw new Error("Invalid format");
      }

      const version = parts[0].replace("UBI", "");

      return {
        version,
        type: parts[1] as QRCodeType,
        qrId: parts[2],
        merchantId: parts[3] || undefined,
        walletId: parts[4] || undefined,
        currency: parts[5] ? (parts[5] as Currency) : undefined,
        amount: parts[6] ? Number(parts[6]) : undefined,
        description: parts[7] || undefined,
        expiresAt: parts[8] || undefined,
      };
    } catch {
      throw new Error("Failed to decode QR payload");
    }
  }
}

// Export singleton instance
export const qrPaymentService = new QRPaymentService();
