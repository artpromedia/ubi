/**
 * Payout Routes
 *
 * Handle payouts to drivers, restaurants, and merchants
 */

import { zValidator } from "@hono/zod-validator";
import { Currency } from "@prisma/client";
import { Hono } from "hono";
import { z } from "zod";
import { payoutLogger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { generateId } from "../lib/utils";
import { FraudDetectionService } from "../services/fraud-detection.service";
import { PayoutService } from "../services/payout.service";
import { TransactionStatus, TransactionType } from "../types";

const payoutRoutes = new Hono();
const payoutService = new PayoutService(prisma);
const fraudService = new FraudDetectionService(prisma);

// ============================================
// Types
// ============================================

enum PayoutStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

enum PayoutMethod {
  BANK_TRANSFER = "BANK_TRANSFER",
  MOBILE_MONEY = "MOBILE_MONEY",
  WALLET = "WALLET",
}

// NOTE: PayoutSchedule will be used when implementing scheduled payouts feature
// interface PayoutSchedule {
//   frequency: "instant" | "daily" | "weekly" | "biweekly" | "monthly";
//   dayOfWeek?: number; // 0-6 for weekly
//   dayOfMonth?: number; // 1-31 for monthly
//   minimumAmount: number;
// }

// ============================================
// Schemas
// ============================================

const requestPayoutSchema = z.object({
  amount: z.number().positive(),
  currency: z.nativeEnum(Currency),
  method: z.nativeEnum(PayoutMethod),
  destination: z.object({
    // Bank account details
    bankCode: z.string().optional(),
    accountNumber: z.string().optional(),
    accountName: z.string().optional(),
    // Mobile money details
    provider: z.string().optional(),
    phone: z.string().optional(),
    // Wallet
    walletId: z.string().optional(),
  }),
});

const updatePayoutSettingsSchema = z.object({
  preferredMethod: z.nativeEnum(PayoutMethod),
  bankAccount: z
    .object({
      bankCode: z.string(),
      bankName: z.string(),
      accountNumber: z.string(),
      accountName: z.string(),
    })
    .optional(),
  mobileMoneyAccount: z
    .object({
      provider: z.string(),
      phone: z.string(),
      name: z.string(),
    })
    .optional(),
  schedule: z.object({
    frequency: z.enum(["instant", "daily", "weekly", "biweekly", "monthly"]),
    dayOfWeek: z.number().min(0).max(6).optional(),
    dayOfMonth: z.number().min(1).max(31).optional(),
    minimumAmount: z.number().positive(),
  }),
});

// ============================================
// Bank Codes for African Countries
// ============================================

const BANK_CODES: Record<string, { code: string; name: string }[]> = {
  NG: [
    { code: "044", name: "Access Bank" },
    { code: "063", name: "Diamond Bank" },
    { code: "050", name: "Ecobank" },
    { code: "084", name: "Enterprise Bank" },
    { code: "070", name: "Fidelity Bank" },
    { code: "011", name: "First Bank of Nigeria" },
    { code: "214", name: "First City Monument Bank" },
    { code: "058", name: "Guaranty Trust Bank" },
    { code: "030", name: "Heritage Bank" },
    { code: "301", name: "Jaiz Bank" },
    { code: "082", name: "Keystone Bank" },
    { code: "076", name: "Polaris Bank" },
    { code: "101", name: "Providus Bank" },
    { code: "221", name: "Stanbic IBTC Bank" },
    { code: "068", name: "Standard Chartered Bank" },
    { code: "232", name: "Sterling Bank" },
    { code: "100", name: "Suntrust Bank" },
    { code: "032", name: "Union Bank of Nigeria" },
    { code: "033", name: "United Bank for Africa" },
    { code: "215", name: "Unity Bank" },
    { code: "035", name: "Wema Bank" },
    { code: "057", name: "Zenith Bank" },
  ],
  KE: [
    { code: "01", name: "Kenya Commercial Bank" },
    { code: "02", name: "Standard Chartered Bank Kenya" },
    { code: "03", name: "Barclays Bank of Kenya" },
    { code: "11", name: "Co-operative Bank of Kenya" },
    { code: "12", name: "National Bank of Kenya" },
    { code: "31", name: "Commercial Bank of Africa" },
    { code: "54", name: "Equity Bank" },
    { code: "68", name: "Family Bank" },
  ],
  GH: [
    { code: "280100", name: "Ghana Commercial Bank" },
    { code: "280300", name: "Standard Chartered Bank Ghana" },
    { code: "280400", name: "Barclays Bank Ghana" },
    { code: "280600", name: "National Investment Bank" },
    { code: "130100", name: "Ecobank Ghana" },
    { code: "030100", name: "Access Bank Ghana" },
    { code: "020100", name: "CAL Bank" },
  ],
};

// ============================================
// Routes
// ============================================

/**
 * GET /payouts/me/earnings - Get earnings summary
 */
payoutRoutes.get("/me/earnings", async (c) => {
  const userId = c.get("userId");

  // Get earnings wallet
  const wallet = await prisma.wallet.findFirst({
    where: {
      userId,
      type: "EARNINGS", // Assuming wallet has a type field for earnings
    },
  });

  // Get recent transactions
  const recentTransactions = wallet
    ? await prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        take: 20,
      })
    : [];

  // Calculate earnings breakdown
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const earnings = wallet
    ? {
        current: {
          balance: wallet.balance,
          lockedBalance: wallet.lockedBalance,
          availableBalance: wallet.balance - wallet.lockedBalance,
          currency: wallet.currency,
        },
        period: {
          today: await calculateEarnings(wallet.id, today, new Date()),
          thisWeek: await calculateEarnings(wallet.id, weekStart, new Date()),
          thisMonth: await calculateEarnings(wallet.id, monthStart, new Date()),
        },
        recentTransactions,
      }
    : null;

  return c.json({
    success: true,
    data: earnings,
  });
});

async function calculateEarnings(
  walletId: string,
  from: Date,
  to: Date,
): Promise<number> {
  const result = await prisma.walletTransaction.aggregate({
    where: {
      walletId,
      type: TransactionType.CREDIT,
      status: TransactionStatus.COMPLETED,
      createdAt: {
        gte: from,
        lte: to,
      },
    },
    _sum: {
      amount: true,
    },
  });
  return result._sum.amount || 0;
}

/**
 * GET /payouts/me/history - Get payout history
 */
payoutRoutes.get("/me/history", async (c) => {
  const userId = c.get("userId");
  const page = Number.parseInt(c.req.query("page") || "1");
  const limit = Number.parseInt(c.req.query("limit") || "20");
  const status = c.req.query("status") as PayoutStatus | undefined;

  const where: any = { userId };
  if (status) {
    where.status = status;
  }

  const [payouts, total] = await Promise.all([
    prisma.payout.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.payout.count({ where }),
  ]);

  return c.json({
    success: true,
    data: {
      payouts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  });
});

/**
 * POST /payouts/request - Request a payout
 */
payoutRoutes.post(
  "/request",
  zValidator("json", requestPayoutSchema),
  async (c) => {
    const userId = c.get("userId");
    const { amount, currency, method, destination } = c.req.valid("json");

    // Get earnings wallet
    const wallet = await prisma.wallet.findFirst({
      where: { userId, currency, type: "EARNINGS" },
    });

    if (!wallet) {
      return c.json(
        {
          success: false,
          error: { code: "NO_WALLET", message: "Earnings wallet not found" },
        },
        404,
      );
    }

    const availableBalance = wallet.balance - wallet.lockedBalance;
    if (availableBalance < amount) {
      return c.json(
        {
          success: false,
          error: {
            code: "INSUFFICIENT_BALANCE",
            message: `Insufficient balance. Available: ${availableBalance} ${currency}`,
          },
        },
        400,
      );
    }

    // Check minimum payout amount
    const minimumPayout = getMinimumPayout(currency);
    if (amount < minimumPayout) {
      return c.json(
        {
          success: false,
          error: {
            code: "BELOW_MINIMUM",
            message: `Minimum payout amount is ${minimumPayout} ${currency}`,
          },
        },
        400,
      );
    }

    // Check for pending payout
    const pendingPayout = await prisma.payout.findFirst({
      where: {
        userId,
        status: { in: [PayoutStatus.PENDING, PayoutStatus.PROCESSING] },
      },
    });

    if (pendingPayout) {
      return c.json(
        {
          success: false,
          error: {
            code: "PAYOUT_PENDING",
            message: "You have a pending payout request",
          },
        },
        400,
      );
    }

    const payoutId = generateId("payout");

    // Calculate fees
    const fees = calculatePayoutFees(amount, method, currency);
    const netAmount = amount - fees.total;

    // Create payout and lock funds
    const payout = await prisma.$transaction(async (tx) => {
      // Lock funds
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { lockedBalance: { increment: amount } },
      });

      // Create payout record
      return tx.payout.create({
        data: {
          id: payoutId,
          userId,
          walletId: wallet.id,
          amount,
          currency,
          method,
          status: PayoutStatus.PENDING,
          fees: fees.total,
          netAmount,
          destination,
          metadata: { fees },
        },
      });
    });

    // Queue payout for processing
    await redis.lpush(
      "payout:queue",
      JSON.stringify({
        payoutId: payout.id,
        method,
        destination,
        amount: netAmount,
        currency,
      }),
    );

    return c.json(
      {
        success: true,
        data: {
          payoutId: payout.id,
          amount,
          fees: fees.total,
          netAmount,
          currency,
          method,
          status: payout.status,
          estimatedArrival: getEstimatedArrival(method),
        },
      },
      201,
    );
  },
);

/**
 * GET /payouts/settings - Get payout settings
 */
payoutRoutes.get("/settings", async (c) => {
  const userId = c.get("userId");

  const settings = await redis.get(`payout:settings:${userId}`);

  return c.json({
    success: true,
    data: settings ? JSON.parse(settings) : null,
  });
});

/**
 * PUT /payouts/settings - Update payout settings
 */
payoutRoutes.put(
  "/settings",
  zValidator("json", updatePayoutSettingsSchema),
  async (c) => {
    const userId = c.get("userId");
    const settings = c.req.valid("json");

    // Validate bank account if provided
    if (settings.bankAccount) {
      const isValid = await validateBankAccount(
        settings.bankAccount.bankCode,
        settings.bankAccount.accountNumber,
        settings.bankAccount.accountName,
      );

      if (!isValid) {
        return c.json(
          {
            success: false,
            error: {
              code: "INVALID_BANK_ACCOUNT",
              message: "Bank account validation failed",
            },
          },
          400,
        );
      }
    }

    // Store settings
    await redis.set(
      `payout:settings:${userId}`,
      JSON.stringify({
        ...settings,
        updatedAt: new Date().toISOString(),
      }),
    );

    return c.json({
      success: true,
      data: settings,
    });
  },
);

/**
 * GET /payouts/banks - Get list of banks for a country
 */
payoutRoutes.get("/banks", async (c) => {
  const country = c.req.query("country")?.toUpperCase() || "NG";

  const banks = BANK_CODES[country] || [];

  return c.json({
    success: true,
    data: {
      country,
      banks,
    },
  });
});

/**
 * POST /payouts/verify-account - Verify bank account
 */
payoutRoutes.post("/verify-account", async (c) => {
  const { bankCode, accountNumber, country } = await c.req.json<{
    bankCode: string;
    accountNumber: string;
    country: string;
  }>();

  // In production, this would call Paystack/Flutterwave account verification API
  const verification = await verifyBankAccount(
    bankCode,
    accountNumber,
    country,
  );

  return c.json({
    success: verification.success,
    data: verification.success
      ? {
          accountNumber,
          accountName: verification.accountName,
          bankCode,
          bankName: verification.bankName,
        }
      : undefined,
    error: verification.success
      ? undefined
      : {
          code: "VERIFICATION_FAILED",
          message: verification.message,
        },
  });
});

/**
 * GET /payouts/:payoutId - Get payout details
 */
payoutRoutes.get("/:payoutId", async (c) => {
  const payoutId = c.req.param("payoutId");
  const userId = c.get("userId");

  const payout = await prisma.payout.findUnique({
    where: { id: payoutId },
  });

  if (!payout) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Payout not found" },
      },
      404,
    );
  }

  if (payout.userId !== userId) {
    return c.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authorized" },
      },
      403,
    );
  }

  return c.json({
    success: true,
    data: payout,
  });
});

/**
 * POST /payouts/:payoutId/cancel - Cancel a pending payout
 */
payoutRoutes.post("/:payoutId/cancel", async (c) => {
  const payoutId = c.req.param("payoutId");
  const userId = c.get("userId");

  const payout = await prisma.payout.findUnique({
    where: { id: payoutId },
  });

  if (!payout) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Payout not found" },
      },
      404,
    );
  }

  if (payout.userId !== userId) {
    return c.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authorized" },
      },
      403,
    );
  }

  if (payout.status !== PayoutStatus.PENDING) {
    return c.json(
      {
        success: false,
        error: {
          code: "CANNOT_CANCEL",
          message: `Cannot cancel payout with status: ${payout.status}`,
        },
      },
      400,
    );
  }

  // Release locked funds and update status
  await prisma.$transaction([
    prisma.wallet.update({
      where: { id: payout.walletId },
      data: { lockedBalance: { decrement: payout.amount } },
    }),
    prisma.payout.update({
      where: { id: payoutId },
      data: { status: "CANCELLED", completedAt: new Date() },
    }),
  ]);

  return c.json({
    success: true,
    data: {
      payoutId,
      status: "CANCELLED",
      message: "Payout cancelled and funds released",
    },
  });
});

// ============================================
// Internal Processing Endpoints
// ============================================

/**
 * POST /payouts/process - Process pending payouts (internal/cron)
 */
payoutRoutes.post("/process", async (c) => {
  const serviceKey = c.req.header("X-Service-Key");
  if (serviceKey !== process.env.INTERNAL_SERVICE_KEY) {
    return c.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Internal endpoint" },
      },
      403,
    );
  }

  // Get payouts from queue
  const queuedPayouts = await redis.lrange("payout:queue", 0, 9);

  const results = [];

  for (const payoutData of queuedPayouts) {
    const payout = JSON.parse(payoutData);

    try {
      // Process based on method
      const result = await processPayout(payout);

      // Update payout status
      await prisma.payout.update({
        where: { id: payout.payoutId },
        data: {
          status: result.success ? PayoutStatus.COMPLETED : PayoutStatus.FAILED,
          completedAt: result.success ? new Date() : undefined,
          failureReason: result.success ? undefined : result.error,
          providerReference: result.providerReference,
        },
      });

      // If successful, deduct from wallet
      if (result.success) {
        const payoutRecord = await prisma.payout.findUnique({
          where: { id: payout.payoutId },
        });

        if (payoutRecord) {
          await prisma.$transaction([
            prisma.wallet.update({
              where: { id: payoutRecord.walletId },
              data: {
                balance: { decrement: payoutRecord.amount },
                lockedBalance: { decrement: payoutRecord.amount },
              },
            }),
            prisma.walletTransaction.create({
              data: {
                id: generateId("txn"),
                walletId: payoutRecord.walletId,
                type: TransactionType.DEBIT,
                amount: payoutRecord.amount,
                currency: payoutRecord.currency,
                status: TransactionStatus.COMPLETED,
                reference: payoutRecord.id,
                description: `Payout via ${payoutRecord.method}`,
              },
            }),
          ]);
        }
      } else {
        // Release lock on failure
        const payoutRecord = await prisma.payout.findUnique({
          where: { id: payout.payoutId },
        });

        if (payoutRecord) {
          await prisma.wallet.update({
            where: { id: payoutRecord.walletId },
            data: { lockedBalance: { decrement: payoutRecord.amount } },
          });
        }
      }

      // Remove from queue
      await redis.lrem("payout:queue", 1, payoutData);

      results.push({
        payoutId: payout.payoutId,
        success: result.success,
        error: result.error,
      });
    } catch (error) {
      payoutLogger.error(
        { err: error, payoutId: payout.payoutId },
        "Payout processing failed",
      );
      results.push({
        payoutId: payout.payoutId,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return c.json({
    success: true,
    data: {
      processed: results.length,
      results,
    },
  });
});

// ============================================
// Helper Functions
// ============================================

function getMinimumPayout(currency: Currency): number {
  const minimums: Partial<Record<Currency, number>> = {
    [Currency.NGN]: 1000,
    [Currency.KES]: 100,
    [Currency.GHS]: 10,
    [Currency.ZAR]: 50,
    [Currency.RWF]: 500,
    [Currency.ETB]: 100,
    [Currency.USD]: 5,
  };
  return minimums[currency] || 0;
}

function calculatePayoutFees(
  amount: number,
  method: PayoutMethod,
  currency: Currency,
): { processing: number; transfer: number; total: number } {
  // Fee structure varies by method and currency
  const fees = {
    processing: 0,
    transfer: 0,
    total: 0,
  };

  switch (method) {
    case PayoutMethod.BANK_TRANSFER:
      // Flat fee + percentage
      if (currency === Currency.NGN) {
        fees.processing = Math.min(amount * 0.01, 100); // 1% capped at 100
        fees.transfer = 50;
      } else if (currency === Currency.KES) {
        fees.processing = 0;
        fees.transfer = 30;
      } else {
        fees.processing = amount * 0.015;
        fees.transfer = 5;
      }
      break;

    case PayoutMethod.MOBILE_MONEY:
      // Usually lower fees
      fees.processing = amount * 0.005;
      fees.transfer = 0;
      break;

    case PayoutMethod.WALLET:
      // Free internal transfers
      fees.processing = 0;
      fees.transfer = 0;
      break;
  }

  fees.total = fees.processing + fees.transfer;
  return fees;
}

function getEstimatedArrival(method: PayoutMethod): string {
  switch (method) {
    case PayoutMethod.BANK_TRANSFER:
      return "24-48 hours";
    case PayoutMethod.MOBILE_MONEY:
      return "Within 1 hour";
    case PayoutMethod.WALLET:
      return "Instant";
    default:
      return "2-3 business days";
  }
}

async function validateBankAccount(
  bankCode: string,
  accountNumber: string,
  accountName: string,
): Promise<boolean> {
  // In production, verify via Paystack/Flutterwave
  payoutLogger.info(
    { bankCode, accountNumber, accountName },
    "Validating bank account",
  );
  return true;
}

async function verifyBankAccount(
  bankCode: string,
  accountNumber: string,
  country: string,
): Promise<{
  success: boolean;
  accountName?: string;
  bankName?: string;
  message?: string;
}> {
  // In production, this would call payment provider API
  payoutLogger.info(
    { bankCode, accountNumber, country },
    "Verifying bank account",
  );

  // Simulated response
  const banks = BANK_CODES[country] || [];
  const bank = banks.find((b) => b.code === bankCode);

  return {
    success: true,
    accountName: "JOHN DOE",
    bankName: bank?.name || "Unknown Bank",
  };
}

async function processPayout(payout: {
  payoutId: string;
  method: PayoutMethod;
  destination: any;
  amount: number;
  currency: Currency;
}): Promise<{
  success: boolean;
  providerReference?: string;
  error?: string;
}> {
  payoutLogger.info({ payout }, "Processing payout");

  // In production, this would call the appropriate provider API
  // Simulating successful payout
  return {
    success: true,
    providerReference: `prov_${generateId("ref")}`,
  };
}

// ============================================
// NEW ENDPOINTS - Instant Cashout
// ============================================

/**
 * Instant cashout (driver immediate payout)
 * POST /api/v1/payouts/instant-cashout
 */
payoutRoutes.post(
  "/instant-cashout",
  zValidator(
    "json",
    z.object({
      driverId: z.string(),
      amount: z.number().positive(),
      currency: z.nativeEnum(Currency),
      phoneNumber: z.string(),
      reason: z.string().optional(),
    }),
  ),
  async (c) => {
    try {
      const { driverId, amount, currency, phoneNumber, reason } =
        c.req.valid("json");
      const userId = c.get("userId");

      // Fraud check first
      const riskAssessment = await fraudService.assessRisk({
        userId,
        amount,
        currency,
        ipAddress: c.req.header("x-forwarded-for") || c.req.header("x-real-ip"),
        deviceId: c.req.header("x-device-id"),
        userAgent: c.req.header("user-agent"),
        metadata: { type: "instant_cashout" },
      });

      // Block if high risk
      if (riskAssessment.action === "BLOCK") {
        return c.json(
          {
            success: false,
            error: "Transaction blocked for security reasons",
            riskScore: riskAssessment.riskScore,
            reasons: riskAssessment.reasons,
          },
          403,
        );
      }

      // Create instant cashout
      const result = await payoutService.createInstantCashout({
        driverId,
        amount,
        currency,
        paymentMethod: "mobile_money",
        phoneNumber,
        reason,
      });

      return c.json({
        success: true,
        data: result,
        riskAssessment: {
          score: riskAssessment.riskScore,
          requiresReview: riskAssessment.requiresReview,
        },
      });
    } catch (error: any) {
      payoutLogger.error("Instant cashout error:", error);
      return c.json(
        {
          success: false,
          error: error.message || "Failed to process instant cashout",
        },
        400,
      );
    }
  },
);

/**
 * Get payout status
 * GET /api/v1/payouts/:payoutId
 */
payoutRoutes.get("/:payoutId", async (c) => {
  try {
    const payoutId = c.req.param("payoutId");
    const status = await payoutService.getPayoutStatus(payoutId);

    return c.json({
      success: true,
      data: status,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: error.message,
      },
      404,
    );
  }
});

/**
 * Get driver payout history
 * GET /api/v1/payouts/driver/:driverId/history
 */
payoutRoutes.get("/driver/:driverId/history", async (c) => {
  try {
    const driverId = c.req.param("driverId");
    const limit = Number(c.req.query("limit")) || 20;
    const offset = Number(c.req.query("offset")) || 0;

    const history = await payoutService.getPayoutHistory(driverId, {
      limit,
      offset,
    });

    return c.json({
      success: true,
      data: history,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: error.message,
      },
      400,
    );
  }
});

/**
 * Get available balance for payout
 * GET /api/v1/payouts/driver/:driverId/balance/:currency
 */
payoutRoutes.get("/driver/:driverId/balance/:currency", async (c) => {
  try {
    const driverId = c.req.param("driverId");
    const currency = c.req.param("currency") as Currency;

    const balance = await payoutService.getAvailableBalance(driverId, currency);

    return c.json({
      success: true,
      data: balance,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: error.message,
      },
      400,
    );
  }
});

export { PayoutMethod, payoutRoutes, PayoutStatus };
