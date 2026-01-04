/**
 * Wallet Routes
 *
 * Manage user wallets, balances, and transactions
 */

import { zValidator } from "@hono/zod-validator";
import { Prisma } from "@prisma/client";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { generateId } from "../lib/utils";
import { Currency, TransactionStatus, TransactionType } from "../types";

const walletRoutes = new Hono();

// ============================================
// Schemas
// ============================================

// NOTE: createWalletSchema will be used for admin wallet creation endpoint
// const createWalletSchema = z.object({
//   userId: z.string().uuid(),
//   currency: z.nativeEnum(Currency).default(Currency.NGN),
// });

const topUpSchema = z.object({
  amount: z.number().positive().min(100), // Minimum 100 smallest unit (e.g., 100 kobo = ₦1)
  paymentMethodId: z.string().optional(),
  promoCode: z.string().optional(),
});

const transferSchema = z.object({
  toUserId: z.string().uuid(),
  amount: z.number().positive(),
  description: z.string().max(200).optional(),
});

const paginationSchema = z.object({
  page: z.string().transform(Number).default("1"),
  limit: z.string().transform(Number).default("20"),
});

// ============================================
// Helper Functions
// ============================================

async function getOrCreateWallet(
  userId: string,
  currency: Currency = Currency.NGN
) {
  let wallet = await prisma.wallet.findFirst({
    where: { userId, currency },
  });

  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: {
        id: generateId("wal"),
        userId,
        currency,
        balance: 0,
        lockedBalance: 0,
        isActive: true,
      },
    });
  }

  return wallet;
}

async function recordTransaction(data: {
  walletId: string;
  type: TransactionType;
  amount: number;
  currency: Currency;
  status: TransactionStatus;
  reference: string;
  description?: string;
  metadata?: Record<string, any>;
}) {
  return prisma.walletTransaction.create({
    data: {
      id: generateId("txn"),
      ...data,
    },
  });
}

// ============================================
// Routes
// ============================================

/**
 * GET /wallets/me - Get current user's wallet
 */
walletRoutes.get("/me", async (c) => {
  const userId = c.get("userId");
  const currency = (c.req.query("currency") as Currency) || Currency.NGN;

  const wallet = await getOrCreateWallet(userId, currency);

  return c.json({
    success: true,
    data: {
      id: wallet.id,
      balance: wallet.balance,
      lockedBalance: wallet.lockedBalance,
      availableBalance: wallet.balance - wallet.lockedBalance,
      currency: wallet.currency,
      isActive: wallet.isActive,
    },
  });
});

/**
 * GET /wallets/me/balances - Get all wallet balances
 */
walletRoutes.get("/me/balances", async (c) => {
  const userId = c.get("userId");

  const wallets = await prisma.wallet.findMany({
    where: { userId },
    select: {
      id: true,
      currency: true,
      balance: true,
      lockedBalance: true,
      isActive: true,
    },
  });

  type WalletSelect = (typeof wallets)[number];
  const balances = wallets.map((w: WalletSelect) => ({
    ...w,
    availableBalance: w.balance - w.lockedBalance,
  }));

  return c.json({
    success: true,
    data: balances,
  });
});

/**
 * POST /wallets/me/topup - Top up wallet
 */
walletRoutes.post("/me/topup", zValidator("json", topUpSchema), async (c) => {
  const userId = c.get("userId");
  const { amount, paymentMethodId, promoCode } = c.req.valid("json");
  const idempotencyKey = c.req.header("X-Idempotency-Key");

  // Check idempotency
  if (idempotencyKey) {
    const existing = await redis.get(`idempotency:${idempotencyKey}`);
    if (existing) {
      return c.json(JSON.parse(existing));
    }
  }

  const wallet = await getOrCreateWallet(userId);

  // Generate reference
  const reference = generateId("top");

  // Create pending transaction
  const transaction = await recordTransaction({
    walletId: wallet.id,
    type: TransactionType.CREDIT,
    amount,
    currency: wallet.currency as Currency,
    status: TransactionStatus.PENDING,
    reference,
    description: "Wallet top-up",
    metadata: { paymentMethodId, promoCode },
  });

  // NOTE: Payment provider integration (Paystack/Flutterwave) implemented in providers/
  // This endpoint returns initialization data for client-side payment flow

  const response = {
    success: true,
    data: {
      transactionId: transaction.id,
      reference,
      amount,
      currency: wallet.currency,
      status: "pending",
      paymentUrl: `https://pay.ubi.africa/checkout/${reference}`, // Would be actual payment URL
    },
  };

  // Store idempotency result
  if (idempotencyKey) {
    await redis.setex(
      `idempotency:${idempotencyKey}`,
      86400,
      JSON.stringify(response)
    );
  }

  return c.json(response, 201);
});

/**
 * POST /wallets/me/transfer - Transfer to another user
 */
walletRoutes.post(
  "/me/transfer",
  zValidator("json", transferSchema),
  async (c) => {
    const userId = c.get("userId");
    const { toUserId, amount, description } = c.req.valid("json");
    const idempotencyKey = c.req.header("X-Idempotency-Key");

    if (userId === toUserId) {
      return c.json(
        {
          success: false,
          error: {
            code: "INVALID_TRANSFER",
            message: "Cannot transfer to yourself",
          },
        },
        400
      );
    }

    // Check idempotency
    if (idempotencyKey) {
      const existing = await redis.get(`idempotency:${idempotencyKey}`);
      if (existing) {
        return c.json(JSON.parse(existing));
      }
    }

    const sourceWallet = await getOrCreateWallet(userId);
    const destWallet = await getOrCreateWallet(toUserId);

    // Check balance
    const availableBalance = sourceWallet.balance - sourceWallet.lockedBalance;
    if (availableBalance < amount) {
      return c.json(
        {
          success: false,
          error: {
            code: "INSUFFICIENT_BALANCE",
            message: "Insufficient wallet balance",
          },
        },
        400
      );
    }

    const reference = generateId("tfr");

    // Execute transfer in transaction
    const result = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // Debit source wallet
        await tx.wallet.update({
          where: { id: sourceWallet.id },
          data: { balance: { decrement: amount } },
        });

        // Credit destination wallet
        await tx.wallet.update({
          where: { id: destWallet.id },
          data: { balance: { increment: amount } },
        });

        // Record debit transaction
        await tx.walletTransaction.create({
          data: {
            id: generateId("txn"),
            walletId: sourceWallet.id,
            type: TransactionType.DEBIT,
            amount,
            currency: sourceWallet.currency,
            status: TransactionStatus.COMPLETED,
            reference,
            description: description || "Transfer to user",
            metadata: { toUserId, toWalletId: destWallet.id },
          },
        });

        // Record credit transaction
        await tx.walletTransaction.create({
          data: {
            id: generateId("txn"),
            walletId: destWallet.id,
            type: TransactionType.CREDIT,
            amount,
            currency: destWallet.currency,
            status: TransactionStatus.COMPLETED,
            reference,
            description: description || "Transfer from user",
            metadata: { fromUserId: userId, fromWalletId: sourceWallet.id },
          },
        });

        return { reference };
      }
    );

    const response = {
      success: true,
      data: {
        reference: result.reference,
        amount,
        toUserId,
        status: "completed",
      },
    };

    if (idempotencyKey) {
      await redis.setex(
        `idempotency:${idempotencyKey}`,
        86400,
        JSON.stringify(response)
      );
    }

    return c.json(response);
  }
);

/**
 * GET /wallets/me/transactions - Get transaction history
 */
walletRoutes.get(
  "/me/transactions",
  zValidator("query", paginationSchema),
  async (c) => {
    const userId = c.get("userId");
    const { page, limit } = c.req.valid("query");
    const skip = (page - 1) * limit;

    const wallet = await getOrCreateWallet(userId);

    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip,
      }),
      prisma.walletTransaction.count({
        where: { walletId: wallet.id },
      }),
    ]);

    return c.json({
      success: true,
      data: transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  }
);

/**
 * POST /wallets/lock - Lock funds for a transaction (internal)
 */
walletRoutes.post("/lock", async (c) => {
  const { userId, amount, reference, reason } = await c.req.json<{
    userId: string;
    amount: number;
    reference: string;
    reason: string;
  }>();

  const wallet = await getOrCreateWallet(userId);

  const availableBalance = wallet.balance - wallet.lockedBalance;
  if (availableBalance < amount) {
    return c.json(
      {
        success: false,
        error: {
          code: "INSUFFICIENT_BALANCE",
          message: "Insufficient balance",
        },
      },
      400
    );
  }

  await prisma.wallet.update({
    where: { id: wallet.id },
    data: { lockedBalance: { increment: amount } },
  });

  // Record the lock
  await redis.setex(
    `lock:${reference}`,
    3600,
    JSON.stringify({
      walletId: wallet.id,
      amount,
      reason,
      lockedAt: new Date().toISOString(),
    })
  );

  return c.json({
    success: true,
    data: { reference, amount, lockedBalance: wallet.lockedBalance + amount },
  });
});

/**
 * POST /wallets/unlock - Unlock/release funds (internal)
 */
walletRoutes.post("/unlock", async (c) => {
  const { reference, capture } = await c.req.json<{
    reference: string;
    capture: boolean; // true = deduct funds, false = release back to available
  }>();

  const lockData = await redis.get(`lock:${reference}`);
  if (!lockData) {
    return c.json(
      {
        success: false,
        error: { code: "LOCK_NOT_FOUND", message: "Lock not found or expired" },
      },
      404
    );
  }

  const { walletId, amount, reason } = JSON.parse(lockData);

  if (capture) {
    // Deduct from both balance and locked balance
    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        balance: { decrement: amount },
        lockedBalance: { decrement: amount },
      },
    });

    // Record transaction
    await recordTransaction({
      walletId,
      type: TransactionType.DEBIT,
      amount,
      currency: Currency.NGN,
      status: TransactionStatus.COMPLETED,
      reference,
      description: reason,
    });
  } else {
    // Just release the lock
    await prisma.wallet.update({
      where: { id: walletId },
      data: { lockedBalance: { decrement: amount } },
    });
  }

  // Remove lock record
  await redis.del(`lock:${reference}`);

  return c.json({
    success: true,
    data: { reference, captured: capture, amount },
  });
});

export { walletRoutes };
