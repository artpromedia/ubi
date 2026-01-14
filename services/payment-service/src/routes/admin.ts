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
import { prisma } from "../lib/prisma";
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

// ============================================
// Refund Processing Helper
// ============================================

interface RefundResult {
  success: boolean;
  providerReference?: string;
  error?: string;
  providerResponse?: any;
}

/**
 * Process refund with the appropriate payment provider
 */
async function processRefundWithProvider(
  transaction: any,
  refundAmount: number,
  refundId: string
): Promise<RefundResult> {
  const provider = transaction.provider;
  const providerReference = transaction.providerReference;

  if (!providerReference) {
    return { success: false, error: "No provider reference found for transaction" };
  }

  switch (provider) {
    case "PAYSTACK":
      return processPaystackRefund(providerReference, refundAmount, transaction.currency, refundId);

    case "MPESA":
      return processMpesaRefund(providerReference, refundAmount, transaction.currency, refundId);

    case "MTN_MOMO_GH":
    case "MTN_MOMO_RW":
    case "MTN_MOMO_UG":
      return processMomoRefund(provider, providerReference, refundAmount, transaction.currency, refundId);

    case "FLUTTERWAVE":
      return processFlutterwaveRefund(providerReference, refundAmount, refundId);

    default:
      return { success: false, error: `Refunds not supported for provider: ${provider}` };
  }
}

/**
 * Process Paystack refund
 */
async function processPaystackRefund(
  transactionReference: string,
  amount: number,
  currency: string,
  refundId: string
): Promise<RefundResult> {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return { success: false, error: "Paystack not configured" };
  }

  try {
    const response = await fetch("https://api.paystack.co/refund", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transaction: transactionReference,
        amount: Math.round(amount * 100), // Paystack expects kobo/cents
        currency,
        merchant_note: `Refund ${refundId}`,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.status) {
      return {
        success: false,
        error: data.message || "Paystack refund failed",
        providerResponse: data,
      };
    }

    return {
      success: true,
      providerReference: data.data?.id || data.data?.refund_reference,
      providerResponse: data.data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Paystack request failed",
    };
  }
}

/**
 * Process M-Pesa reversal (B2C payment)
 * Note: M-Pesa STK Push doesn't support direct refunds, so we do a B2C payment
 */
async function processMpesaRefund(
  originalTransactionId: string,
  amount: number,
  _currency: string,
  refundId: string
): Promise<RefundResult> {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const initiatorName = process.env.MPESA_INITIATOR_NAME;
  const initiatorPassword = process.env.MPESA_INITIATOR_PASSWORD;
  const shortcode = process.env.MPESA_SHORTCODE;
  const callbackUrl = process.env.MPESA_B2C_CALLBACK_URL;

  if (!consumerKey || !consumerSecret || !initiatorName || !shortcode) {
    return { success: false, error: "M-Pesa B2C not configured" };
  }

  try {
    // Get OAuth token
    const authString = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
    const tokenResponse = await fetch(
      "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: { Authorization: `Basic ${authString}` },
      }
    );
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Get original transaction to find the phone number
    const originalTx = await prisma.paymentTransaction.findFirst({
      where: { providerReference: originalTransactionId },
      include: { user: { select: { phone: true } } },
    });

    if (!originalTx?.user?.phone) {
      return { success: false, error: "Could not find customer phone number for refund" };
    }

    // Initiate B2C payment (refund)
    const b2cResponse = await fetch(
      "https://api.safaricom.co.ke/mpesa/b2c/v1/paymentrequest",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          InitiatorName: initiatorName,
          SecurityCredential: initiatorPassword, // In production, this should be encrypted
          CommandID: "BusinessPayment",
          Amount: Math.round(amount),
          PartyA: shortcode,
          PartyB: originalTx.user.phone.replace(/^\+/, ""),
          Remarks: `Refund for ${refundId}`,
          QueueTimeOutURL: callbackUrl,
          ResultURL: callbackUrl,
          Occasion: `Refund-${refundId}`,
        }),
      }
    );

    const b2cData = await b2cResponse.json();

    if (b2cData.ResponseCode === "0") {
      return {
        success: true,
        providerReference: b2cData.ConversationID,
        providerResponse: b2cData,
      };
    }

    return {
      success: false,
      error: b2cData.ResponseDescription || "M-Pesa B2C failed",
      providerResponse: b2cData,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "M-Pesa request failed",
    };
  }
}

/**
 * Process MTN MoMo refund (disbursement)
 */
async function processMomoRefund(
  provider: string,
  originalTransactionId: string,
  amount: number,
  currency: string,
  refundId: string
): Promise<RefundResult> {
  const country = provider.split("_")[2] || "GH";
  const subscriptionKey = process.env[`MTN_MOMO_${country}_SUBSCRIPTION_KEY`];
  const apiUserId = process.env[`MTN_MOMO_${country}_API_USER`];
  const apiKey = process.env[`MTN_MOMO_${country}_API_KEY`];

  if (!subscriptionKey || !apiUserId || !apiKey) {
    return { success: false, error: `MoMo ${country} not configured` };
  }

  try {
    // Get access token
    const credentials = Buffer.from(`${apiUserId}:${apiKey}`).toString("base64");
    const tokenResponse = await fetch(
      `https://proxy.momoapi.mtn.com/disbursement/token/`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Ocp-Apim-Subscription-Key": subscriptionKey,
        },
      }
    );
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Get original transaction to find the phone number
    const originalTx = await prisma.paymentTransaction.findFirst({
      where: { providerReference: originalTransactionId },
      include: { user: { select: { phone: true } } },
    });

    if (!originalTx?.user?.phone) {
      return { success: false, error: "Could not find customer phone number for refund" };
    }

    // Initiate disbursement (refund)
    const disbursementResponse = await fetch(
      `https://proxy.momoapi.mtn.com/disbursement/v1_0/transfer`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Reference-Id": refundId,
          "X-Target-Environment": process.env.NODE_ENV === "production" ? `mtn${country.toLowerCase()}` : "sandbox",
          "Ocp-Apim-Subscription-Key": subscriptionKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: String(amount),
          currency,
          externalId: refundId,
          payee: {
            partyIdType: "MSISDN",
            partyId: originalTx.user.phone.replace(/^\+/, ""),
          },
          payerMessage: `Refund for transaction ${originalTransactionId.slice(0, 8)}`,
          payeeNote: `UBI Refund - ${refundId}`,
        }),
      }
    );

    if (disbursementResponse.status === 202) {
      return {
        success: true,
        providerReference: refundId,
      };
    }

    const errorData = await disbursementResponse.json().catch(() => ({}));
    return {
      success: false,
      error: errorData.message || "MoMo disbursement failed",
      providerResponse: errorData,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "MoMo request failed",
    };
  }
}

/**
 * Process Flutterwave refund
 */
async function processFlutterwaveRefund(
  transactionId: string,
  amount: number,
  refundId: string
): Promise<RefundResult> {
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) {
    return { success: false, error: "Flutterwave not configured" };
  }

  try {
    const response = await fetch(
      `https://api.flutterwave.com/v3/transactions/${transactionId}/refund`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount,
          comments: `Refund ${refundId}`,
        }),
      }
    );

    const data = await response.json();

    if (data.status === "success") {
      return {
        success: true,
        providerReference: data.data?.id,
        providerResponse: data.data,
      };
    }

    return {
      success: false,
      error: data.message || "Flutterwave refund failed",
      providerResponse: data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Flutterwave request failed",
    };
  }
}

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
      404
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
      400
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
      404
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
      400
    );
  }

  const refundAmount = parsed.data.amount || Number(transaction.amount);

  // Check if partial refund is within limits
  if (refundAmount > Number(transaction.amount)) {
    return c.json(
      {
        success: false,
        error: {
          code: "INVALID_AMOUNT",
          message: "Refund amount cannot exceed original transaction amount",
        },
      },
      400
    );
  }

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
    const refundResult = await processRefundWithProvider(transaction, refundAmount, refund.id);

    // Update refund record with result
    await prisma.refund.update({
      where: { id: refund.id },
      data: {
        status: refundResult.success ? "PROCESSING" : "FAILED",
        failureReason: refundResult.error,
        metadata: refundResult.providerResponse ? { providerResponse: refundResult.providerResponse } : undefined,
      },
    });

    if (!refundResult.success) {
      return c.json({
        success: false,
        error: {
          code: "REFUND_FAILED",
          message: refundResult.error || "Failed to process refund with payment provider",
        },
        data: { refundId: refund.id },
      }, 500);
    }

    return c.json({
      success: true,
      data: {
        refundId: refund.id,
        amount: refundAmount,
        status: "PROCESSING",
        providerReference: refundResult.providerReference,
        message: "Refund initiated successfully",
      },
    });
  } catch (error) {
    // Update refund as failed
    await prisma.refund.update({
      where: { id: refund.id },
      data: {
        status: "FAILED",
        failureReason: error instanceof Error ? error.message : "Unknown error",
      },
    });

    console.error("[Admin] Refund processing error:", error);
    return c.json({
      success: false,
      error: {
        code: "REFUND_ERROR",
        message: "An error occurred while processing the refund",
      },
      data: { refundId: refund.id },
    }, 500);
  }
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
      400
    );
  }

  const result = await reconciliationService.runDailyReconciliation(
    parsed.data.provider as any,
    new Date(parsed.data.date),
    parsed.data.currency as any
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
      400
    );
  }

  const userId = c.get("userId") || "admin";

  if (parsed.data.action === "resolve") {
    await reconciliationService.resolveDiscrepancy(
      id,
      parsed.data.resolution,
      userId
    );
  } else {
    await reconciliationService.ignoreDiscrepancy(
      id,
      parsed.data.resolution,
      userId
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
      400
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
    query.recipientType
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
      400
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
      400
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
      400
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
      400
    );
  }

  if (parsed.data.action === "approve") {
    await fraudService.approveTransaction(assessmentId, userId);
  } else {
    await fraudService.rejectTransaction(
      assessmentId,
      userId,
      parsed.data.reason || "Rejected by admin"
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
      404
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
      400
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
