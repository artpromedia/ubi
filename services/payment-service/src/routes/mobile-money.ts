/**
 * Mobile Money Routes
 *
 * Integrations with M-Pesa, MTN MoMo, Airtel Money, and other mobile money providers
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { generateId } from "../lib/utils";
import {
  Currency,
  PaymentMethod,
  PaymentStatus,
  TransactionStatus,
  TransactionType,
} from "../types";

const mobileMoneyRoutes = new Hono();

// ============================================
// Types
// ============================================

enum MobileMoneyProvider {
  MPESA = "MPESA",
  MTN_MOMO = "MTN_MOMO",
  AIRTEL_MONEY = "AIRTEL_MONEY",
  ORANGE_MONEY = "ORANGE_MONEY",
  TIGO_PESA = "TIGO_PESA",
}

interface ProviderConfig {
  name: string;
  countries: string[];
  currencies: Currency[];
  phoneFormat: RegExp;
  minAmount: number;
  maxAmount: number;
}

const PROVIDER_CONFIGS: Record<MobileMoneyProvider, ProviderConfig> = {
  [MobileMoneyProvider.MPESA]: {
    name: "M-Pesa",
    countries: ["KE", "TZ", "GH"],
    currencies: [Currency.KES],
    phoneFormat: /^254\d{9}$/,
    minAmount: 10,
    maxAmount: 150000,
  },
  [MobileMoneyProvider.MTN_MOMO]: {
    name: "MTN Mobile Money",
    countries: ["GH", "UG", "RW", "CM", "CI", "BJ"],
    currencies: [Currency.GHS, Currency.UGX, Currency.XOF],
    phoneFormat: /^\d{10,12}$/,
    minAmount: 1,
    maxAmount: 500000,
  },
  [MobileMoneyProvider.AIRTEL_MONEY]: {
    name: "Airtel Money",
    countries: ["KE", "UG", "TZ", "RW", "NG"],
    currencies: [Currency.KES, Currency.UGX, Currency.NGN],
    phoneFormat: /^\d{10,13}$/,
    minAmount: 10,
    maxAmount: 200000,
  },
  [MobileMoneyProvider.ORANGE_MONEY]: {
    name: "Orange Money",
    countries: ["CI", "SN", "ML", "CM"],
    currencies: [Currency.XOF],
    phoneFormat: /^\d{10}$/,
    minAmount: 100,
    maxAmount: 1000000,
  },
  [MobileMoneyProvider.TIGO_PESA]: {
    name: "Tigo Pesa",
    countries: ["TZ", "GH"],
    currencies: [Currency.TZS, Currency.GHS],
    phoneFormat: /^\d{10,12}$/,
    minAmount: 500,
    maxAmount: 3000000,
  },
};

// ============================================
// Schemas
// ============================================

const initiateCollectionSchema = z.object({
  provider: z.nativeEnum(MobileMoneyProvider),
  phone: z.string().min(9).max(15),
  amount: z.number().positive(),
  currency: z.nativeEnum(Currency),
  referenceId: z.string().optional(),
  description: z.string().optional(),
});

const initiateDisbursementSchema = z.object({
  provider: z.nativeEnum(MobileMoneyProvider),
  phone: z.string().min(9).max(15),
  amount: z.number().positive(),
  currency: z.nativeEnum(Currency),
  recipientName: z.string(),
  reason: z.string().optional(),
});

// NOTE: checkStatusSchema will be used when implementing status check endpoint
// const checkStatusSchema = z.object({
//   transactionId: z.string(),
// });

// ============================================
// Provider API Clients
// ============================================

interface MoMoTransactionResult {
  success: boolean;
  transactionId: string;
  status: "pending" | "processing" | "completed" | "failed";
  message?: string;
  providerReference?: string;
}

async function initiateMpesaSTKPush(
  phone: string,
  amount: number,
  reference: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _description: string,
): Promise<MoMoTransactionResult> {
  // M-Pesa STK Push integration
  // This would integrate with Safaricom's Daraja API
  // NOTE: Additional M-Pesa credentials (MPESA_SHORTCODE, MPESA_PASSKEY) will be used
  // for password generation when implementing actual M-Pesa API calls

  const apiKey = process.env.MPESA_CONSUMER_KEY;
  const apiSecret = process.env.MPESA_CONSUMER_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error("M-Pesa credentials not configured");
  }

  // Generate access token timestamp
  const timestamp = new Date()
    .toISOString()
    .replaceAll(/[^\d]/g, "")
    .slice(0, 14);
  console.log("[M-Pesa] Generated timestamp:", timestamp);

  try {
    // In production, this would make actual API calls
    // Simulating for development
    console.log("[M-Pesa] Initiating STK Push:", { phone, amount, reference });

    return {
      success: true,
      transactionId: generateId("mpesa"),
      status: "pending",
      message: "STK Push sent. Please enter your M-Pesa PIN.",
    };
  } catch (error) {
    console.error("M-Pesa STK Push failed:", error);
    return {
      success: false,
      transactionId: "",
      status: "failed",
      message: "Failed to initiate M-Pesa payment",
    };
  }
}

async function initiateMtnMomoCollection(
  phone: string,
  amount: number,
  currency: Currency,
  reference: string,
): Promise<MoMoTransactionResult> {
  // MTN MoMo Collection API
  // NOTE: Additional credentials (MTN_MOMO_USER_ID, MTN_MOMO_SUBSCRIPTION_KEY)
  // will be used when implementing actual MTN MoMo API calls
  const apiKey = process.env.MTN_MOMO_API_KEY;

  if (!apiKey) {
    throw new Error("MTN MoMo credentials not configured");
  }

  try {
    console.log("[MTN MoMo] Initiating collection:", {
      phone,
      amount,
      currency,
      reference,
    });

    return {
      success: true,
      transactionId: generateId("mtn"),
      status: "pending",
      message: "Payment request sent. Please approve on your phone.",
    };
  } catch (error) {
    console.error("MTN MoMo collection failed:", error);
    return {
      success: false,
      transactionId: "",
      status: "failed",
      message: "Failed to initiate MTN MoMo payment",
    };
  }
}

async function initiateAirtelMoneyCollection(
  phone: string,
  amount: number,
  currency: Currency,
  reference: string,
): Promise<MoMoTransactionResult> {
  // NOTE: AIRTEL_SECRET_KEY will be used when implementing actual Airtel Money API calls
  const apiKey = process.env.AIRTEL_API_KEY;

  if (!apiKey) {
    throw new Error("Airtel Money credentials not configured");
  }

  try {
    console.log("[Airtel Money] Initiating collection:", {
      phone,
      amount,
      currency,
      reference,
    });

    return {
      success: true,
      transactionId: generateId("airtel"),
      status: "pending",
      message: "Payment request sent. Please approve on your phone.",
    };
  } catch (error) {
    console.error("Airtel Money collection failed:", error);
    return {
      success: false,
      transactionId: "",
      status: "failed",
      message: "Failed to initiate Airtel Money payment",
    };
  }
}

// ============================================
// Routes
// ============================================

/**
 * GET /mobile-money/providers - List available providers for a country
 */
mobileMoneyRoutes.get("/providers", async (c) => {
  const country = c.req.query("country")?.toUpperCase() || "KE";
  const currency = c.req.query("currency")?.toUpperCase() as Currency;

  const availableProviders = Object.entries(PROVIDER_CONFIGS)
    .filter(([_, config]) => {
      const countryMatch = config.countries.includes(country);
      const currencyMatch = !currency || config.currencies.includes(currency);
      return countryMatch && currencyMatch;
    })
    .map(([provider, config]) => ({
      provider,
      name: config.name,
      currencies: config.currencies,
      minAmount: config.minAmount,
      maxAmount: config.maxAmount,
    }));

  return c.json({
    success: true,
    data: {
      country,
      providers: availableProviders,
    },
  });
});

/**
 * POST /mobile-money/collect - Initiate mobile money collection (payment from customer)
 */
mobileMoneyRoutes.post(
  "/collect",
  zValidator("json", initiateCollectionSchema),
  async (c) => {
    const userId = c.get("userId");
    const { provider, phone, amount, currency, referenceId, description } =
      c.req.valid("json");
    const idempotencyKey = c.req.header("X-Idempotency-Key");

    // Check idempotency
    if (idempotencyKey) {
      const existing = await redis.get(`idempotency:momo:${idempotencyKey}`);
      if (existing) {
        return c.json(JSON.parse(existing));
      }
    }

    // Validate provider config
    const config = PROVIDER_CONFIGS[provider];
    if (!config) {
      return c.json(
        {
          success: false,
          error: {
            code: "INVALID_PROVIDER",
            message: "Invalid mobile money provider",
          },
        },
        400,
      );
    }

    if (!config.currencies.includes(currency)) {
      return c.json(
        {
          success: false,
          error: {
            code: "INVALID_CURRENCY",
            message: `${provider} does not support ${currency}`,
          },
        },
        400,
      );
    }

    if (amount < config.minAmount || amount > config.maxAmount) {
      return c.json(
        {
          success: false,
          error: {
            code: "INVALID_AMOUNT",
            message: `Amount must be between ${config.minAmount} and ${config.maxAmount} ${currency}`,
          },
        },
        400,
      );
    }

    const reference = generateId("momo");

    // Create payment record
    const payment = await prisma.payment.create({
      data: {
        id: reference,
        userId,
        referenceId: referenceId || reference,
        type: "WALLET_TOPUP",
        amount,
        currency,
        method: PaymentMethod.MOBILE_MONEY,
        status: PaymentStatus.PENDING,
        metadata: {
          provider,
          phone: phone.replaceAll(/\D/g, ""),
          description,
        },
      },
    });

    // Initiate collection based on provider
    let result: MoMoTransactionResult;

    switch (provider) {
      case MobileMoneyProvider.MPESA:
        result = await initiateMpesaSTKPush(
          phone,
          amount,
          reference,
          description || "UBI Payment",
        );
        break;

      case MobileMoneyProvider.MTN_MOMO:
        result = await initiateMtnMomoCollection(
          phone,
          amount,
          currency,
          reference,
        );
        break;

      case MobileMoneyProvider.AIRTEL_MONEY:
        result = await initiateAirtelMoneyCollection(
          phone,
          amount,
          currency,
          reference,
        );
        break;

      default:
        result = {
          success: false,
          transactionId: "",
          status: "failed",
          message: `Provider ${provider} not yet implemented`,
        };
    }

    // Update payment with provider reference
    if (result.success) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.PROCESSING,
          providerReference: result.transactionId,
        },
      });

      // Store transaction for status polling
      await redis.setex(
        `momo:txn:${result.transactionId}`,
        3600,
        JSON.stringify({
          paymentId: payment.id,
          userId,
          provider,
          phone,
          amount,
          currency,
          status: result.status,
          createdAt: new Date().toISOString(),
        }),
      );
    } else {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          failureReason: result.message,
        },
      });
    }

    const response = {
      success: result.success,
      data: {
        paymentId: payment.id,
        provider,
        transactionId: result.transactionId,
        status: result.status,
        message: result.message,
        amount,
        currency,
      },
    };

    if (idempotencyKey) {
      await redis.setex(
        `idempotency:momo:${idempotencyKey}`,
        3600,
        JSON.stringify(response),
      );
    }

    return c.json(response, result.success ? 201 : 400);
  },
);

/**
 * POST /mobile-money/disburse - Send money to mobile money account
 */
mobileMoneyRoutes.post(
  "/disburse",
  zValidator("json", initiateDisbursementSchema),
  async (c) => {
    const { provider, phone, amount, currency, recipientName, reason } =
      c.req.valid("json");

    // This endpoint is internal-only (for payouts to drivers)
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

    const config = PROVIDER_CONFIGS[provider];
    if (!config) {
      return c.json(
        {
          success: false,
          error: { code: "INVALID_PROVIDER", message: "Invalid provider" },
        },
        400,
      );
    }

    const reference = generateId("disb");

    // Store disbursement request
    const disbursement = {
      id: reference,
      provider,
      phone: phone.replaceAll(/\D/g, ""),
      amount,
      currency,
      recipientName,
      reason,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    await redis.setex(
      `momo:disb:${reference}`,
      86400,
      JSON.stringify(disbursement),
    );

    // In production, this would initiate the actual disbursement
    console.log("[MoMo Disbursement] Initiated:", disbursement);

    return c.json({
      success: true,
      data: {
        disbursementId: reference,
        status: "pending",
        message: "Disbursement initiated",
      },
    });
  },
);

/**
 * GET /mobile-money/status/:transactionId - Check transaction status
 */
mobileMoneyRoutes.get("/status/:transactionId", async (c) => {
  const transactionId = c.req.param("transactionId");

  // Check cached status
  const cachedTxn = await redis.get(`momo:txn:${transactionId}`);
  if (!cachedTxn) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Transaction not found" },
      },
      404,
    );
  }

  const txn = JSON.parse(cachedTxn);

  // In production, we would poll the provider API for actual status
  // For now, return cached status
  return c.json({
    success: true,
    data: {
      transactionId,
      paymentId: txn.paymentId,
      provider: txn.provider,
      amount: txn.amount,
      currency: txn.currency,
      status: txn.status,
      createdAt: txn.createdAt,
    },
  });
});

/**
 * POST /mobile-money/callback/mpesa - M-Pesa callback webhook
 */
mobileMoneyRoutes.post("/callback/mpesa", async (c) => {
  const body = await c.req.json();

  console.log("[M-Pesa Callback]:", JSON.stringify(body, null, 2));

  const { Body } = body;
  if (!Body?.stkCallback) {
    return c.json({ success: true });
  }

  const { MerchantRequestID, ResultCode, ResultDesc, CallbackMetadata } =
    Body.stkCallback;

  // Find the payment by merchant request ID
  const txnData = await redis.get(`momo:txn:${MerchantRequestID}`);
  if (!txnData) {
    console.error(
      "Transaction not found for M-Pesa callback:",
      MerchantRequestID,
    );
    return c.json({ success: true });
  }

  const txn = JSON.parse(txnData);
  const isSuccess = ResultCode === 0;

  // Update payment status
  await prisma.payment.update({
    where: { id: txn.paymentId },
    data: {
      status: isSuccess ? PaymentStatus.COMPLETED : PaymentStatus.FAILED,
      completedAt: isSuccess ? new Date() : undefined,
      failureReason: isSuccess ? undefined : ResultDesc,
      metadata: {
        ...((await prisma.payment.findUnique({ where: { id: txn.paymentId } }))
          ?.metadata as object),
        mpesaReceiptNumber: CallbackMetadata?.Item?.find(
          (i: any) => i.Name === "MpesaReceiptNumber",
        )?.Value,
        transactionDate: CallbackMetadata?.Item?.find(
          (i: any) => i.Name === "TransactionDate",
        )?.Value,
      },
    },
  });

  // If successful, credit user's wallet
  if (isSuccess) {
    const wallet = await prisma.wallet.findFirst({
      where: { userId: txn.userId, currency: txn.currency },
    });

    if (wallet) {
      await prisma.$transaction([
        prisma.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: txn.amount } },
        }),
        prisma.walletTransaction.create({
          data: {
            id: generateId("txn"),
            walletId: wallet.id,
            type: TransactionType.CREDIT,
            amount: txn.amount,
            currency: txn.currency,
            status: TransactionStatus.COMPLETED,
            reference: txn.paymentId,
            description: "M-Pesa top-up",
          },
        }),
      ]);
    }
  }

  // Update cached transaction status
  txn.status = isSuccess ? "completed" : "failed";
  await redis.setex(`momo:txn:${MerchantRequestID}`, 3600, JSON.stringify(txn));

  return c.json({ success: true });
});

/**
 * POST /mobile-money/callback/mtn - MTN MoMo callback webhook
 */
mobileMoneyRoutes.post("/callback/mtn", async (c) => {
  const body = await c.req.json();

  console.log("[MTN MoMo Callback]:", JSON.stringify(body, null, 2));

  // Process MTN MoMo callback
  // Similar structure to M-Pesa callback

  return c.json({ success: true });
});

/**
 * POST /mobile-money/callback/airtel - Airtel Money callback webhook
 */
mobileMoneyRoutes.post("/callback/airtel", async (c) => {
  const body = await c.req.json();

  console.log("[Airtel Money Callback]:", JSON.stringify(body, null, 2));

  // Process Airtel Money callback

  return c.json({ success: true });
});

export { MobileMoneyProvider, mobileMoneyRoutes };
