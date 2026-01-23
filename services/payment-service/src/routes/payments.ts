/**
 * Payment Routes
 *
 * Handle payment processing for rides, food orders, deliveries
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { paymentLogger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { generateId } from "../lib/utils";
import { PaystackClient } from "../providers/paystack";
import {
  Currency,
  PaymentMethod,
  PaymentStatus,
  PaymentType,
  TransactionStatus,
  TransactionType,
} from "../types";

const paymentRoutes = new Hono();

// ============================================
// Schemas
// ============================================

const initiatePaymentSchema = z.object({
  type: z.nativeEnum(PaymentType),
  referenceId: z.string(), // Ride ID, Order ID, etc.
  amount: z.number().positive(),
  currency: z.nativeEnum(Currency).default(Currency.NGN),
  method: z.nativeEnum(PaymentMethod),
  metadata: z.record(z.any()).optional(),
});

const confirmPaymentSchema = z.object({
  paymentId: z.string(),
  otp: z.string().optional(), // For card OTP validation
  pin: z.string().optional(), // For card PIN
});

// ============================================
// Routes
// ============================================

/**
 * POST /payments/initiate - Initiate a payment
 */
paymentRoutes.post(
  "/initiate",
  zValidator("json", initiatePaymentSchema),
  async (c) => {
    const userId = c.get("userId");
    const { type, referenceId, amount, currency, method, metadata } =
      c.req.valid("json");
    const idempotencyKey = c.req.header("X-Idempotency-Key");

    // Check idempotency
    if (idempotencyKey) {
      const existing = await redis.get(`idempotency:payment:${idempotencyKey}`);
      if (existing) {
        return c.json(JSON.parse(existing));
      }
    }

    // Check for duplicate payment
    const existingPayment = await prisma.payment.findFirst({
      where: {
        referenceId,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] },
      },
    });

    if (existingPayment) {
      return c.json(
        {
          success: false,
          error: {
            code: "DUPLICATE_PAYMENT",
            message: "A payment for this reference is already in progress",
          },
        },
        409,
      );
    }

    const reference = generateId("pay");

    // Create payment record
    const payment = await prisma.payment.create({
      data: {
        id: reference,
        userId,
        referenceId,
        type,
        amount,
        currency,
        method,
        status: PaymentStatus.PENDING,
        metadata: metadata || {},
      },
    });

    let paymentData: any = {
      paymentId: payment.id,
      reference,
      amount,
      currency,
      method,
      status: "pending",
    };

    // Handle different payment methods
    switch (method) {
      case PaymentMethod.WALLET: {
        // Check wallet balance
        const wallet = await prisma.wallet.findFirst({
          where: { userId, currency },
        });

        if (!wallet || wallet.balance - wallet.lockedBalance < amount) {
          await prisma.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.FAILED,
              failureReason: "Insufficient balance",
            },
          });

          return c.json(
            {
              success: false,
              error: {
                code: "INSUFFICIENT_BALANCE",
                message: "Insufficient wallet balance",
              },
            },
            400,
          );
        }

        // Lock the funds
        await prisma.wallet.update({
          where: { id: wallet.id },
          data: { lockedBalance: { increment: amount } },
        });

        await redis.setex(
          `payment:lock:${payment.id}`,
          3600,
          JSON.stringify({
            walletId: wallet.id,
            amount,
          }),
        );

        paymentData.status = "locked";
        paymentData.message = "Funds locked. Complete transaction to capture.";
        break;
      }

      case PaymentMethod.CARD: {
        // Initialize card payment with Paystack
        const paystack = new PaystackClient();
        const initResult = await paystack.initializeTransaction({
          email: metadata?.email || `${userId}@ubi.africa`,
          amount: amount * 100, // Paystack uses kobo
          reference,
          callback_url: `${process.env.API_URL}/webhooks/paystack`,
          metadata: {
            paymentId: payment.id,
            userId,
            type,
          },
        });

        if (initResult.status) {
          paymentData.paymentUrl = initResult.data.authorization_url;
          paymentData.accessCode = initResult.data.access_code;
        }
        break;
      }

      case PaymentMethod.MOBILE_MONEY: {
        // Will be handled by mobile-money routes
        paymentData.message = "Use /mobile-money endpoints to complete payment";
        break;
      }

      case PaymentMethod.CASH: {
        // Cash payments are confirmed on delivery
        paymentData.status = "awaiting_collection";
        paymentData.message = "Payment will be collected in cash";
        break;
      }
    }

    const response = {
      success: true,
      data: paymentData,
    };

    if (idempotencyKey) {
      await redis.setex(
        `idempotency:payment:${idempotencyKey}`,
        86400,
        JSON.stringify(response),
      );
    }

    return c.json(response, 201);
  },
);

/**
 * POST /payments/confirm - Confirm/complete a payment
 */
paymentRoutes.post(
  "/confirm",
  zValidator("json", confirmPaymentSchema),
  async (c) => {
    const userId = c.get("userId");
    const { paymentId, otp, pin } = c.req.valid("json");

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      return c.json(
        {
          success: false,
          error: { code: "PAYMENT_NOT_FOUND", message: "Payment not found" },
        },
        404,
      );
    }

    if (payment.userId !== userId) {
      return c.json(
        {
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Not authorized to confirm this payment",
          },
        },
        403,
      );
    }

    if (payment.status !== PaymentStatus.PENDING) {
      return c.json(
        {
          success: false,
          error: {
            code: "INVALID_STATUS",
            message: `Payment is ${payment.status}`,
          },
        },
        400,
      );
    }

    // Handle wallet payment capture
    if (payment.method === PaymentMethod.WALLET) {
      const lockData = await redis.get(`payment:lock:${payment.id}`);
      if (!lockData) {
        return c.json(
          {
            success: false,
            error: { code: "LOCK_EXPIRED", message: "Payment lock expired" },
          },
          400,
        );
      }

      const { walletId, amount } = JSON.parse(lockData);

      // Capture the payment
      await prisma.$transaction(async (tx) => {
        // Deduct from wallet
        await tx.wallet.update({
          where: { id: walletId },
          data: {
            balance: { decrement: amount },
            lockedBalance: { decrement: amount },
          },
        });

        // Record transaction
        await tx.walletTransaction.create({
          data: {
            id: generateId("txn"),
            walletId,
            type: TransactionType.DEBIT,
            amount,
            currency: payment.currency,
            status: TransactionStatus.COMPLETED,
            reference: payment.id,
            description: `Payment for ${payment.type}`,
            metadata: { referenceId: payment.referenceId },
          },
        });

        // Update payment status
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.COMPLETED,
            completedAt: new Date(),
          },
        });
      });

      await redis.del(`payment:lock:${payment.id}`);

      return c.json({
        success: true,
        data: {
          paymentId: payment.id,
          status: "completed",
          method: payment.method,
          amount: payment.amount,
          currency: payment.currency,
        },
      });
    }

    // Handle card OTP/PIN submission
    if (payment.method === PaymentMethod.CARD && (otp || pin)) {
      const paystack = new PaystackClient();

      try {
        const result = await paystack.submitOtp(payment.id, otp || "");

        if (result.status && result.data.status === "success") {
          await prisma.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.COMPLETED,
              completedAt: new Date(),
              providerReference: result.data.reference,
            },
          });

          return c.json({
            success: true,
            data: {
              paymentId: payment.id,
              status: "completed",
            },
          });
        }
      } catch (error) {
        paymentLogger.error({ err: error }, "Card confirmation failed");
      }
    }

    return c.json(
      {
        success: false,
        error: {
          code: "CONFIRMATION_FAILED",
          message: "Payment confirmation failed",
        },
      },
      400,
    );
  },
);

/**
 * GET /payments/:paymentId - Get payment details
 */
paymentRoutes.get("/:paymentId", async (c) => {
  const paymentId = c.req.param("paymentId");

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
  });

  if (!payment) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Payment not found" },
      },
      404,
    );
  }

  return c.json({
    success: true,
    data: payment,
  });
});

/**
 * POST /payments/:paymentId/refund - Refund a payment
 */
paymentRoutes.post("/:paymentId/refund", async (c) => {
  const paymentId = c.req.param("paymentId");
  const { amount, reason } = await c.req.json<{
    amount?: number;
    reason: string;
  }>();

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
  });

  if (!payment) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Payment not found" },
      },
      404,
    );
  }

  if (payment.status !== PaymentStatus.COMPLETED) {
    return c.json(
      {
        success: false,
        error: {
          code: "INVALID_STATUS",
          message: "Can only refund completed payments",
        },
      },
      400,
    );
  }

  const refundAmount = amount || payment.amount;
  if (refundAmount > payment.amount) {
    return c.json(
      {
        success: false,
        error: {
          code: "INVALID_AMOUNT",
          message: "Refund amount exceeds payment amount",
        },
      },
      400,
    );
  }

  const refundId = generateId("ref");

  // Process refund based on payment method
  if (payment.method === PaymentMethod.WALLET) {
    // Credit back to wallet
    const wallet = await prisma.wallet.findFirst({
      where: { userId: payment.userId, currency: payment.currency },
    });

    if (wallet) {
      await prisma.$transaction(async (tx) => {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: refundAmount } },
        });

        await tx.walletTransaction.create({
          data: {
            id: generateId("txn"),
            walletId: wallet.id,
            type: TransactionType.CREDIT,
            amount: refundAmount,
            currency: payment.currency,
            status: TransactionStatus.COMPLETED,
            reference: refundId,
            description: `Refund: ${reason}`,
            metadata: { originalPaymentId: payment.id },
          },
        });

        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status:
              refundAmount === payment.amount
                ? PaymentStatus.REFUNDED
                : PaymentStatus.PARTIALLY_REFUNDED,
            refundedAmount: { increment: refundAmount },
          },
        });
      });
    }
  } else if (payment.method === PaymentMethod.CARD) {
    // Initiate card refund via payment provider
    const paystack = new PaystackClient();
    await paystack.initiateRefund(
      payment.providerReference || payment.id,
      refundAmount * 100,
    );
  }

  return c.json({
    success: true,
    data: {
      refundId,
      originalPaymentId: payment.id,
      amount: refundAmount,
      status: "processed",
    },
  });
});

/**
 * POST /payments/escrow/create - Create escrow for a ride/order
 */
paymentRoutes.post("/escrow/create", async (c) => {
  const { userId, amount, currency, referenceId, type, expiresIn } =
    await c.req.json<{
      userId: string;
      amount: number;
      currency: Currency;
      referenceId: string;
      type: PaymentType;
      expiresIn?: number; // seconds, default 2 hours
    }>();

  const escrowId = generateId("esc");

  // Lock funds in user's wallet
  const wallet = await prisma.wallet.findFirst({
    where: { userId, currency },
  });

  if (!wallet || wallet.balance - wallet.lockedBalance < amount) {
    return c.json(
      {
        success: false,
        error: {
          code: "INSUFFICIENT_BALANCE",
          message: "Insufficient balance for escrow",
        },
      },
      400,
    );
  }

  await prisma.wallet.update({
    where: { id: wallet.id },
    data: { lockedBalance: { increment: amount } },
  });

  // Store escrow data
  const escrowData = {
    id: escrowId,
    userId,
    walletId: wallet.id,
    amount,
    currency,
    referenceId,
    type,
    status: "locked",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + (expiresIn || 7200) * 1000).toISOString(),
  };

  await redis.setex(
    `escrow:${escrowId}`,
    expiresIn || 7200,
    JSON.stringify(escrowData),
  );
  await redis.setex(`escrow:ref:${referenceId}`, expiresIn || 7200, escrowId);

  return c.json({
    success: true,
    data: escrowData,
  });
});

/**
 * POST /payments/escrow/release - Release escrow to recipient
 */
paymentRoutes.post("/escrow/release", async (c) => {
  const { escrowId, referenceId, recipientId, platformFee } = await c.req.json<{
    escrowId?: string;
    referenceId?: string;
    recipientId: string;
    platformFee?: number; // Amount to deduct as platform fee
  }>();

  // Find escrow by ID or reference
  let escrowKey = escrowId ? `escrow:${escrowId}` : null;
  if (!escrowKey && referenceId) {
    const id = await redis.get(`escrow:ref:${referenceId}`);
    if (id) escrowKey = `escrow:${id}`;
  }

  if (!escrowKey) {
    return c.json(
      {
        success: false,
        error: { code: "ESCROW_NOT_FOUND", message: "Escrow not found" },
      },
      404,
    );
  }

  const escrowData = await redis.get(escrowKey);
  if (!escrowData) {
    return c.json(
      {
        success: false,
        error: { code: "ESCROW_EXPIRED", message: "Escrow has expired" },
      },
      400,
    );
  }

  const escrow = JSON.parse(escrowData);
  if (escrow.status !== "locked") {
    return c.json(
      {
        success: false,
        error: {
          code: "INVALID_STATUS",
          message: `Escrow is ${escrow.status}`,
        },
      },
      400,
    );
  }

  const fee = platformFee || 0;
  const recipientAmount = escrow.amount - fee;

  // Get or create recipient wallet
  let recipientWallet = await prisma.wallet.findFirst({
    where: { userId: recipientId, currency: escrow.currency },
  });

  if (!recipientWallet) {
    recipientWallet = await prisma.wallet.create({
      data: {
        id: generateId("wal"),
        userId: recipientId,
        currency: escrow.currency,
        balance: 0,
        lockedBalance: 0,
        isActive: true,
      },
    });
  }

  // Execute transfer
  await prisma.$transaction(async (tx) => {
    // Release lock from payer's wallet and deduct
    await tx.wallet.update({
      where: { id: escrow.walletId },
      data: {
        balance: { decrement: escrow.amount },
        lockedBalance: { decrement: escrow.amount },
      },
    });

    // Credit recipient
    await tx.wallet.update({
      where: { id: recipientWallet!.id },
      data: { balance: { increment: recipientAmount } },
    });

    // Record payer's transaction
    await tx.walletTransaction.create({
      data: {
        id: generateId("txn"),
        walletId: escrow.walletId,
        type: TransactionType.DEBIT,
        amount: escrow.amount,
        currency: escrow.currency,
        status: TransactionStatus.COMPLETED,
        reference: escrow.id,
        description: `Payment for ${escrow.type}`,
        metadata: { referenceId: escrow.referenceId, recipientId },
      },
    });

    // Record recipient's transaction
    await tx.walletTransaction.create({
      data: {
        id: generateId("txn"),
        walletId: recipientWallet!.id,
        type: TransactionType.CREDIT,
        amount: recipientAmount,
        currency: escrow.currency,
        status: TransactionStatus.COMPLETED,
        reference: escrow.id,
        description: `Earnings from ${escrow.type}`,
        metadata: { referenceId: escrow.referenceId, platformFee: fee },
      },
    });
  });

  // Update escrow status
  escrow.status = "released";
  escrow.releasedAt = new Date().toISOString();
  escrow.recipientId = recipientId;
  escrow.platformFee = fee;
  await redis.setex(escrowKey, 86400, JSON.stringify(escrow));

  return c.json({
    success: true,
    data: {
      escrowId: escrow.id,
      status: "released",
      amount: escrow.amount,
      recipientAmount,
      platformFee: fee,
    },
  });
});

/**
 * POST /payments/escrow/cancel - Cancel/refund escrow
 */
paymentRoutes.post("/escrow/cancel", async (c) => {
  const { escrowId, referenceId, reason } = await c.req.json<{
    escrowId?: string;
    referenceId?: string;
    reason: string;
  }>();

  let escrowKey = escrowId ? `escrow:${escrowId}` : null;
  if (!escrowKey && referenceId) {
    const id = await redis.get(`escrow:ref:${referenceId}`);
    if (id) escrowKey = `escrow:${id}`;
  }

  if (!escrowKey) {
    return c.json(
      {
        success: false,
        error: { code: "ESCROW_NOT_FOUND", message: "Escrow not found" },
      },
      404,
    );
  }

  const escrowData = await redis.get(escrowKey);
  if (!escrowData) {
    return c.json(
      {
        success: false,
        error: { code: "ESCROW_EXPIRED", message: "Escrow has expired" },
      },
      400,
    );
  }

  const escrow = JSON.parse(escrowData);
  if (escrow.status !== "locked") {
    return c.json(
      {
        success: false,
        error: {
          code: "INVALID_STATUS",
          message: `Escrow is ${escrow.status}`,
        },
      },
      400,
    );
  }

  // Release lock back to payer
  await prisma.wallet.update({
    where: { id: escrow.walletId },
    data: { lockedBalance: { decrement: escrow.amount } },
  });

  // Update escrow status
  escrow.status = "cancelled";
  escrow.cancelledAt = new Date().toISOString();
  escrow.cancellationReason = reason;
  await redis.setex(escrowKey, 86400, JSON.stringify(escrow));

  return c.json({
    success: true,
    data: {
      escrowId: escrow.id,
      status: "cancelled",
      amount: escrow.amount,
    },
  });
});

export { paymentRoutes };
