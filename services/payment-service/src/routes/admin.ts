/**
 * Admin Dashboard API Routes
 *
 * Provides administrative APIs for:
 * - Transaction monitoring
 * - Reconciliation management
 * - Settlement oversight
 * - User/driver/merchant management
 * - Financial reporting
 * - System health monitoring
 */

import { Hono } from "hono";
import { z } from "zod";
import {
  notificationClient,
  NotificationPriority,
  NotificationType,
} from "../lib/notification-client.js";
import { prisma } from "../lib/prisma";
import { PaystackService } from "../providers/paystack.service";
import { FraudDetectionService } from "../services/fraud-detection.service";
import { PayoutService } from "../services/payout.service";
import { ReconciliationService } from "../services/reconciliation.service";
import { SettlementService } from "../services/settlement.service";

const adminRoutes = new Hono();

// Initialize services
const reconciliationService = new ReconciliationService(prisma);
const settlementService = new SettlementService(prisma);
const payoutService = new PayoutService(prisma);
const fraudService = new FraudDetectionService(prisma);

// Initialize Paystack service for refunds
const paystackService = new PaystackService(
  {
    secretKey: process.env.PAYSTACK_SECRET_KEY || "",
    publicKey: process.env.PAYSTACK_PUBLIC_KEY || "",
    webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET || "",
    environment: (process.env.NODE_ENV === "production" ? "live" : "test") as
      | "test"
      | "live",
  },
  prisma,
);

// ============================================
// Dashboard Overview
// ============================================

/**
 * GET /admin/dashboard
 * Get dashboard overview metrics
 */
adminRoutes.get("/dashboard", async (c) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  // Get today's metrics
  const [
    todayTransactions,
    todayVolume,
    todayPayouts,
    pendingReconciliations,
    pendingSettlements,
    pendingFraudReviews,
  ] = await Promise.all([
    // Today's transaction count
    prisma.paymentTransaction.count({
      where: {
        createdAt: { gte: today },
      },
    }),

    // Today's transaction volume
    prisma.paymentTransaction.aggregate({
      where: {
        createdAt: { gte: today },
        status: "COMPLETED",
      },
      _sum: { amount: true },
    }),

    // Today's payouts
    prisma.payout.aggregate({
      where: {
        createdAt: { gte: today },
        status: "COMPLETED",
      },
      _sum: { netAmount: true },
      _count: true,
    }),

    // Pending reconciliations
    prisma.reconciliation.count({
      where: { status: "PENDING" },
    }),

    // Pending settlements
    prisma.settlement.count({
      where: { status: "PENDING" },
    }),

    // Pending fraud reviews
    prisma.riskAssessment.count({
      where: {
        reviewStatus: "PENDING",
        riskLevel: { in: ["HIGH", "CRITICAL"] },
      },
    }),
  ]);

  // Get monthly metrics
  const monthlyVolume = await prisma.paymentTransaction.aggregate({
    where: {
      createdAt: { gte: thisMonth },
      status: "COMPLETED",
    },
    _sum: { amount: true },
  });

  const monthlyCommission = await prisma.settlement.aggregate({
    where: {
      createdAt: { gte: thisMonth },
      status: "COMPLETED",
    },
    _sum: {
      ubiCommission: true,
      ceerionCommission: true,
    },
  });

  return c.json({
    success: true,
    data: {
      today: {
        transactions: todayTransactions,
        volume: Number(todayVolume._sum.amount) || 0,
        payouts: {
          count: todayPayouts._count,
          amount: Number(todayPayouts._sum.netAmount) || 0,
        },
      },
      month: {
        volume: Number(monthlyVolume._sum.amount) || 0,
        commission: {
          ubi: Number(monthlyCommission._sum.ubiCommission) || 0,
          ceerion: Number(monthlyCommission._sum.ceerionCommission) || 0,
          total:
            (Number(monthlyCommission._sum.ubiCommission) || 0) +
            (Number(monthlyCommission._sum.ceerionCommission) || 0),
        },
      },
      pending: {
        reconciliations: pendingReconciliations,
        settlements: pendingSettlements,
        fraudReviews: pendingFraudReviews,
      },
      lastUpdated: new Date().toISOString(),
    },
  });
});

// ============================================
// Transaction Management
// ============================================

/**
 * GET /admin/transactions
 * List transactions with filters
 */
adminRoutes.get("/transactions", async (c) => {
  const query = c.req.query();

  const where: any = {};

  if (query.status) {
    where.status = query.status;
  }

  if (query.provider) {
    where.provider = query.provider;
  }

  if (query.currency) {
    where.currency = query.currency;
  }

  if (query.startDate) {
    where.createdAt = {
      ...where.createdAt,
      gte: new Date(query.startDate),
    };
  }

  if (query.endDate) {
    where.createdAt = {
      ...where.createdAt,
      lte: new Date(query.endDate),
    };
  }

  if (query.minAmount) {
    where.amount = {
      ...where.amount,
      gte: Number(query.minAmount),
    };
  }

  if (query.search) {
    where.OR = [
      { providerReference: { contains: query.search } },
      { id: { contains: query.search } },
    ];
  }

  const [transactions, total] = await Promise.all([
    prisma.paymentTransaction.findMany({
      where,
      include: {
        payment: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                phone: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: Number(query.limit) || 50,
      skip: Number(query.offset) || 0,
    }),
    prisma.paymentTransaction.count({ where }),
  ]);

  return c.json({
    success: true,
    data: transactions,
    pagination: {
      total,
      limit: Number(query.limit) || 50,
      offset: Number(query.offset) || 0,
    },
  });
});

/**
 * GET /admin/transactions/:id
 * Get transaction details
 */
adminRoutes.get("/transactions/:id", async (c) => {
  const id = c.req.param("id");

  const transaction = await prisma.paymentTransaction.findUnique({
    where: { id },
    include: {
      payment: {
        include: {
          user: {
            select: {
              id: true,
              email: true,
              phone: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },
      ledgerEntries: true,
    },
  });

  if (!transaction) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Transaction not found" },
      },
      404,
    );
  }

  return c.json({
    success: true,
    data: transaction,
  });
});

/**
 * POST /admin/transactions/:id/refund
 * Initiate a refund
 */
adminRoutes.post("/transactions/:id/refund", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();

  const schema = z.object({
    amount: z.number().positive().optional(),
    reason: z.string().min(1),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", details: parsed.error.errors },
      },
      400,
    );
  }

  const transaction = await prisma.paymentTransaction.findUnique({
    where: { id },
  });

  if (!transaction) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Transaction not found" },
      },
      404,
    );
  }

  if (transaction.status !== "COMPLETED") {
    return c.json(
      {
        success: false,
        error: {
          code: "INVALID_STATUS",
          message: "Can only refund completed transactions",
        },
      },
      400,
    );
  }

  const refundAmount = parsed.data.amount || Number(transaction.amount);

  // Create refund record
  const refund = await prisma.refund.create({
    data: {
      transactionId: transaction.id,
      amount: refundAmount,
      currency: transaction.currency,
      reason: parsed.data.reason,
      status: "PENDING",
      initiatedBy: c.get("userId") || "admin",
    },
  });

  // Initiate actual refund with provider
  try {
    // Get the provider reference from transaction metadata
    const metadata = transaction.metadata as Record<string, any> | null;
    const paystackReference = metadata?.paystackReference || transaction.id;

    if (transaction.provider === "PAYSTACK") {
      const refundResult = await paystackService.createRefund({
        transactionReference: paystackReference,
        amount: refundAmount,
        currency: transaction.currency,
        merchantNote: parsed.data.reason,
        customerNote: "Refund processed for your transaction",
      });

      if (refundResult.status) {
        await prisma.refund.update({
          where: { id: refund.id },
          data: {
            status: "PROCESSING",
            providerRefundId: String(refundResult.data.id),
            metadata: {
              providerResponse: refundResult.data,
              expectedAt: refundResult.data.expected_at,
            },
          },
        });

        // Notify user about refund
        await notificationClient.send({
          userId: transaction.userId,
          title: "Refund Initiated",
          body: `A refund of ${transaction.currency} ${refundAmount.toLocaleString()} has been initiated for your transaction. It may take 5-10 business days to reflect.`,
          type: NotificationType.REFUND_PROCESSED,
          priority: NotificationPriority.HIGH,
          data: {
            refundId: refund.id,
            transactionId: transaction.id,
            amount: refundAmount,
            currency: transaction.currency,
          },
        });
      }
    } else {
      // For other providers, mark as pending manual processing
      await prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: "PENDING",
          metadata: {
            requiresManualProcessing: true,
            provider: transaction.provider,
          },
        },
      });
    }
  } catch (error) {
    // Log error but don't fail - refund record is created for manual follow-up
    await prisma.refund.update({
      where: { id: refund.id },
      data: {
        status: "FAILED",
        failureReason:
          error instanceof Error ? error.message : "Provider refund failed",
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      },
    });
  }

  return c.json({
    success: true,
    data: {
      refundId: refund.id,
      amount: refundAmount,
      status: "PENDING",
      message: "Refund initiated",
    },
  });
});

// ============================================
// Reconciliation Management
// ============================================

/**
 * GET /admin/reconciliations
 * List reconciliation reports
 */
adminRoutes.get("/reconciliations", async (c) => {
  const query = c.req.query();

  const where: any = {};

  if (query.status) {
    where.status = query.status;
  }

  if (query.provider) {
    where.provider = query.provider;
  }

  if (query.startDate) {
    where.date = {
      ...where.date,
      gte: new Date(query.startDate),
    };
  }

  if (query.endDate) {
    where.date = {
      ...where.date,
      lte: new Date(query.endDate),
    };
  }

  const reconciliations = await prisma.reconciliation.findMany({
    where,
    include: {
      _count: {
        select: { discrepancies: true },
      },
    },
    orderBy: { date: "desc" },
    take: Number(query.limit) || 50,
    skip: Number(query.offset) || 0,
  });

  return c.json({
    success: true,
    data: reconciliations,
  });
});

/**
 * POST /admin/reconciliations/run
 * Trigger manual reconciliation
 */
adminRoutes.post("/reconciliations/run", async (c) => {
  const body = await c.req.json();

  const schema = z.object({
    provider: z.enum([
      "MPESA",
      "PAYSTACK",
      "MTN_MOMO_GH",
      "MTN_MOMO_RW",
      "MTN_MOMO_UG",
    ]),
    date: z.string(),
    currency: z.enum(["NGN", "KES", "GHS", "ZAR", "RWF", "UGX"]),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", details: parsed.error.errors },
      },
      400,
    );
  }

  const result = await reconciliationService.runDailyReconciliation(
    parsed.data.provider as any,
    new Date(parsed.data.date),
    parsed.data.currency as any,
  );

  return c.json({
    success: true,
    data: result,
  });
});

/**
 * GET /admin/reconciliations/discrepancies
 * List pending discrepancies
 */
adminRoutes.get("/reconciliations/discrepancies", async (c) => {
  const query = c.req.query();

  const discrepancies = await reconciliationService.getPendingDiscrepancies({
    provider: query.provider as any,
    severity: query.severity as any,
    limit: Number(query.limit) || 50,
    offset: Number(query.offset) || 0,
  });

  return c.json({
    success: true,
    data: discrepancies,
  });
});

/**
 * POST /admin/reconciliations/discrepancies/:id/resolve
 * Resolve a discrepancy
 */
adminRoutes.post("/reconciliations/discrepancies/:id/resolve", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();

  const schema = z.object({
    resolution: z.string().min(1),
    action: z.enum(["resolve", "ignore"]),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", details: parsed.error.errors },
      },
      400,
    );
  }

  const userId = c.get("userId") || "admin";

  if (parsed.data.action === "resolve") {
    await reconciliationService.resolveDiscrepancy(
      id,
      parsed.data.resolution,
      userId,
    );
  } else {
    await reconciliationService.ignoreDiscrepancy(
      id,
      parsed.data.resolution,
      userId,
    );
  }

  return c.json({
    success: true,
    message: `Discrepancy ${parsed.data.action}d`,
  });
});

// ============================================
// Settlement Management
// ============================================

/**
 * GET /admin/settlements
 * List settlements
 */
adminRoutes.get("/settlements", async (c) => {
  const query = c.req.query();

  const where: any = {};

  if (query.status) {
    where.status = query.status;
  }

  if (query.recipientType) {
    where.recipientType = query.recipientType;
  }

  if (query.recipientId) {
    where.recipientId = query.recipientId;
  }

  if (query.startDate) {
    where.createdAt = {
      ...where.createdAt,
      gte: new Date(query.startDate),
    };
  }

  if (query.endDate) {
    where.createdAt = {
      ...where.createdAt,
      lte: new Date(query.endDate),
    };
  }

  const [settlements, total] = await Promise.all([
    prisma.settlement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Number(query.limit) || 50,
      skip: Number(query.offset) || 0,
    }),
    prisma.settlement.count({ where }),
  ]);

  return c.json({
    success: true,
    data: settlements,
    pagination: {
      total,
      limit: Number(query.limit) || 50,
      offset: Number(query.offset) || 0,
    },
  });
});

/**
 * POST /admin/settlements/:id/retry
 * Retry a failed settlement
 */
adminRoutes.post("/settlements/:id/retry", async (c) => {
  const id = c.req.param("id");

  try {
    await settlementService.retrySettlement(id);

    return c.json({
      success: true,
      message: "Settlement retry initiated",
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: "RETRY_FAILED",
          message: error instanceof Error ? error.message : "Retry failed",
        },
      },
      400,
    );
  }
});

/**
 * GET /admin/settlements/summary
 * Get settlement summary
 */
adminRoutes.get("/settlements/summary", async (c) => {
  const query = c.req.query();

  const startDate = query.startDate
    ? new Date(query.startDate)
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const endDate = query.endDate ? new Date(query.endDate) : new Date();

  const summary = await settlementService.getSettlementSummary(
    startDate,
    endDate,
    query.recipientType,
  );

  return c.json({
    success: true,
    data: summary,
  });
});

// ============================================
// Payout Management
// ============================================

/**
 * GET /admin/payouts
 * List payouts
 */
adminRoutes.get("/payouts", async (c) => {
  const query = c.req.query();

  const where: any = {};

  if (query.status) {
    where.status = query.status;
  }

  if (query.driverId) {
    where.driverId = query.driverId;
  }

  if (query.startDate) {
    where.createdAt = {
      ...where.createdAt,
      gte: new Date(query.startDate),
    };
  }

  if (query.endDate) {
    where.createdAt = {
      ...where.createdAt,
      lte: new Date(query.endDate),
    };
  }

  const [payouts, total] = await Promise.all([
    prisma.payout.findMany({
      where,
      include: {
        driver: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                phone: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: Number(query.limit) || 50,
      skip: Number(query.offset) || 0,
    }),
    prisma.payout.count({ where }),
  ]);

  return c.json({
    success: true,
    data: payouts,
    pagination: {
      total,
      limit: Number(query.limit) || 50,
      offset: Number(query.offset) || 0,
    },
  });
});

/**
 * POST /admin/payouts/:id/approve
 * Approve a pending payout
 */
adminRoutes.post("/payouts/:id/approve", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("userId") || "admin";

  try {
    await payoutService.approvePayout(id, userId);

    return c.json({
      success: true,
      message: "Payout approved",
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: "APPROVAL_FAILED",
          message: error instanceof Error ? error.message : "Approval failed",
        },
      },
      400,
    );
  }
});

/**
 * POST /admin/payouts/:id/cancel
 * Cancel a pending payout
 */
adminRoutes.post("/payouts/:id/cancel", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();

  const schema = z.object({
    reason: z.string().min(1),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", details: parsed.error.errors },
      },
      400,
    );
  }

  try {
    await payoutService.cancelPayout(id, parsed.data.reason);

    return c.json({
      success: true,
      message: "Payout cancelled",
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: "CANCEL_FAILED",
          message: error instanceof Error ? error.message : "Cancel failed",
        },
      },
      400,
    );
  }
});

// ============================================
// Fraud Management
// ============================================

/**
 * GET /admin/fraud/alerts
 * List fraud alerts and high-risk assessments
 */
adminRoutes.get("/fraud/alerts", async (c) => {
  const query = c.req.query();

  const where: any = {
    riskLevel: { in: ["HIGH", "CRITICAL"] },
  };

  if (query.status) {
    where.reviewStatus = query.status;
  }

  const alerts = await prisma.riskAssessment.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          email: true,
          phone: true,
          firstName: true,
          lastName: true,
        },
      },
      factors: true,
    },
    orderBy: [{ riskScore: "desc" }, { createdAt: "desc" }],
    take: Number(query.limit) || 50,
    skip: Number(query.offset) || 0,
  });

  return c.json({
    success: true,
    data: alerts,
  });
});

/**
 * POST /admin/fraud/:assessmentId/review
 * Review a fraud alert
 */
adminRoutes.post("/fraud/:assessmentId/review", async (c) => {
  const assessmentId = c.req.param("assessmentId");
  const body = await c.req.json();
  const userId = c.get("userId") || "admin";

  const schema = z.object({
    action: z.enum(["approve", "reject"]),
    reason: z.string().optional(),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", details: parsed.error.errors },
      },
      400,
    );
  }

  if (parsed.data.action === "approve") {
    await fraudService.approveTransaction(assessmentId, userId);
  } else {
    await fraudService.rejectTransaction(
      assessmentId,
      userId,
      parsed.data.reason || "Rejected by admin",
    );
  }

  return c.json({
    success: true,
    message: `Transaction ${parsed.data.action}d`,
  });
});

// ============================================
// User Management
// ============================================

/**
 * GET /admin/users/:id
 * Get user details with payment history
 */
adminRoutes.get("/users/:id", async (c) => {
  const id = c.req.param("id");

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      wallet: true,
      payments: {
        take: 10,
        orderBy: { createdAt: "desc" },
      },
      riskAssessments: {
        take: 5,
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!user) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "User not found" },
      },
      404,
    );
  }

  return c.json({
    success: true,
    data: user,
  });
});

/**
 * POST /admin/users/:id/block
 * Block a user from payments
 */
adminRoutes.post("/users/:id/block", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();

  const schema = z.object({
    reason: z.string().min(1),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", details: parsed.error.errors },
      },
      400,
    );
  }

  await prisma.user.update({
    where: { id },
    data: {
      paymentBlocked: true,
      paymentBlockReason: parsed.data.reason,
      paymentBlockedAt: new Date(),
    },
  });

  return c.json({
    success: true,
    message: "User blocked from payments",
  });
});

/**
 * POST /admin/users/:id/unblock
 * Unblock a user from payments
 */
adminRoutes.post("/users/:id/unblock", async (c) => {
  const id = c.req.param("id");

  await prisma.user.update({
    where: { id },
    data: {
      paymentBlocked: false,
      paymentBlockReason: null,
      paymentBlockedAt: null,
    },
  });

  return c.json({
    success: true,
    message: "User unblocked",
  });
});

// ============================================
// Reports
// ============================================

/**
 * GET /admin/reports/daily
 * Get daily financial report
 */
adminRoutes.get("/reports/daily", async (c) => {
  const query = c.req.query();
  const date = query.date ? new Date(query.date) : new Date();

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const [transactions, payouts, settlements, refunds] = await Promise.all([
    // Transactions by status
    prisma.paymentTransaction.groupBy({
      by: ["status", "currency"],
      where: {
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
      _sum: { amount: true },
      _count: true,
    }),

    // Payouts by status
    prisma.payout.groupBy({
      by: ["status", "currency"],
      where: {
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
      _sum: { netAmount: true, fee: true },
      _count: true,
    }),

    // Settlements
    prisma.settlement.groupBy({
      by: ["recipientType", "currency"],
      where: {
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
      _sum: {
        grossAmount: true,
        ubiCommission: true,
        ceerionCommission: true,
        netAmount: true,
      },
      _count: true,
    }),

    // Refunds
    prisma.refund.aggregate({
      where: {
        createdAt: { gte: startOfDay, lte: endOfDay },
        status: "COMPLETED",
      },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  return c.json({
    success: true,
    data: {
      date: startOfDay.toISOString().split("T")[0],
      transactions,
      payouts,
      settlements,
      refunds: {
        count: refunds._count,
        amount: Number(refunds._sum.amount) || 0,
      },
    },
  });
});

/**
 * GET /admin/reports/monthly
 * Get monthly financial report
 */
adminRoutes.get("/reports/monthly", async (c) => {
  const query = c.req.query();
  const year = Number(query.year) || new Date().getFullYear();
  const month = Number(query.month) || new Date().getMonth() + 1;

  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

  const [transactionVolume, payoutVolume, commissionEarned, providerBreakdown] =
    await Promise.all([
      // Total transaction volume
      prisma.paymentTransaction.aggregate({
        where: {
          createdAt: { gte: startOfMonth, lte: endOfMonth },
          status: "COMPLETED",
        },
        _sum: { amount: true },
        _count: true,
      }),

      // Total payout volume
      prisma.payout.aggregate({
        where: {
          createdAt: { gte: startOfMonth, lte: endOfMonth },
          status: "COMPLETED",
        },
        _sum: { netAmount: true, fee: true },
        _count: true,
      }),

      // Commission earned
      prisma.settlement.aggregate({
        where: {
          createdAt: { gte: startOfMonth, lte: endOfMonth },
          status: "COMPLETED",
        },
        _sum: {
          ubiCommission: true,
          ceerionCommission: true,
        },
      }),

      // Volume by provider
      prisma.paymentTransaction.groupBy({
        by: ["provider"],
        where: {
          createdAt: { gte: startOfMonth, lte: endOfMonth },
          status: "COMPLETED",
        },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

  return c.json({
    success: true,
    data: {
      period: {
        year,
        month,
        startDate: startOfMonth.toISOString(),
        endDate: endOfMonth.toISOString(),
      },
      transactions: {
        count: transactionVolume._count,
        volume: Number(transactionVolume._sum.amount) || 0,
      },
      payouts: {
        count: payoutVolume._count,
        volume: Number(payoutVolume._sum.netAmount) || 0,
        fees: Number(payoutVolume._sum.fee) || 0,
      },
      commission: {
        ubi: Number(commissionEarned._sum.ubiCommission) || 0,
        ceerion: Number(commissionEarned._sum.ceerionCommission) || 0,
        total:
          (Number(commissionEarned._sum.ubiCommission) || 0) +
          (Number(commissionEarned._sum.ceerionCommission) || 0),
      },
      providerBreakdown: providerBreakdown.map((p) => ({
        provider: p.provider,
        count: p._count,
        volume: Number(p._sum.amount) || 0,
      })),
    },
  });
});

export { adminRoutes };
