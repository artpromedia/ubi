/**
 * Mobile Money Routes
 *
 * Integrations with M-Pesa, MTN MoMo, Airtel Money, and other mobile money providers
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { mobileMoneyLogger } from "../lib/logger";
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
  mobileMoneyLogger.info({ timestamp }, "[M-Pesa] Generated timestamp");

  try {
    // In production, this would make actual API calls
    // Simulating for development
    mobileMoneyLogger.info(
      { phone, amount, reference },
      "[M-Pesa] Initiating STK Push",
    );

    return {
      success: true,
      transactionId: generateId("mpesa"),
      status: "pending",
      message: "STK Push sent. Please enter your M-Pesa PIN.",
    };
  } catch (error) {
    mobileMoneyLogger.error({ err: error }, "M-Pesa STK Push failed");
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
  // MTN MoMo Collection API (Open API v1.0)
  // Reference: https://momodeveloper.mtn.com/docs/services/collection
  
  const apiKey = process.env.MTN_MOMO_API_KEY;
  const subscriptionKey = process.env.MTN_MOMO_SUBSCRIPTION_KEY;
  const userId = process.env.MTN_MOMO_USER_ID;
  const environment = process.env.MTN_MOMO_ENVIRONMENT || 'sandbox';
  const callbackUrl = process.env.MTN_MOMO_CALLBACK_URL;

  if (!apiKey || !subscriptionKey || !userId) {
    throw new Error("MTN MoMo credentials not configured");
  }

  // Determine base URL based on environment
  const baseUrl = environment === 'production' 
    ? 'https://proxy.momoapi.mtn.com'
    : 'https://sandbox.momodeveloper.mtn.com';

  try {
    mobileMoneyLogger.info(
      { phone, amount, currency, reference },
      "[MTN MoMo] Initiating collection request",
    );

    // Step 1: Get access token
    const authCredentials = Buffer.from(`${userId}:${apiKey}`).toString('base64');
    
    const tokenResponse = await fetch(`${baseUrl}/collection/token/`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authCredentials}`,
        'Ocp-Apim-Subscription-Key': subscriptionKey,
      },
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      mobileMoneyLogger.error(
        { status: tokenResponse.status, error: errorText },
        "[MTN MoMo] Failed to get access token"
      );
      throw new Error("Failed to authenticate with MTN MoMo");
    }

    const tokenData = await tokenResponse.json() as { access_token: string };
    const accessToken = tokenData.access_token;

    // Step 2: Request to pay
    const externalId = generateId("mtn");
    const payerMessage = `UBI Payment - ${reference}`;
    const payeeNote = `Payment collection for reference ${reference}`;

    // Format phone number (remove leading zeros, add country code if needed)
    const formattedPhone = phone.replace(/^0+/, '');

    const requestBody = {
      amount: amount.toString(),
      currency: currency,
      externalId: externalId,
      payer: {
        partyIdType: 'MSISDN',
        partyId: formattedPhone,
      },
      payerMessage: payerMessage,
      payeeNote: payeeNote,
    };

    const requestToPayHeaders: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'X-Reference-Id': externalId,
      'X-Target-Environment': environment,
      'Ocp-Apim-Subscription-Key': subscriptionKey,
      'Content-Type': 'application/json',
    };

    if (callbackUrl) {
      requestToPayHeaders['X-Callback-Url'] = callbackUrl;
    }

    const payResponse = await fetch(`${baseUrl}/collection/v1_0/requesttopay`, {
      method: 'POST',
      headers: requestToPayHeaders,
      body: JSON.stringify(requestBody),
    });

    if (payResponse.status === 202) {
      // Request accepted, payment is pending
      mobileMoneyLogger.info(
        { phone, amount, externalId },
        "[MTN MoMo] Collection request accepted"
      );

      return {
        success: true,
        transactionId: externalId,
        status: "pending",
        message: "Payment request sent. Please approve on your phone.",
        providerReference: externalId,
      };
    } else {
      const errorData = await payResponse.text();
      mobileMoneyLogger.error(
        { status: payResponse.status, error: errorData },
        "[MTN MoMo] Collection request failed"
      );

      return {
        success: false,
        transactionId: externalId,
        status: "failed",
        message: "Failed to initiate MTN MoMo payment. Please try again.",
      };
    }
  } catch (error) {
    mobileMoneyLogger.error({ err: error }, "MTN MoMo collection failed");
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
  // Airtel Money API Integration
  // Reference: https://developers.airtel.africa/documentation
  
  const clientId = process.env.AIRTEL_CLIENT_ID;
  const clientSecret = process.env.AIRTEL_CLIENT_SECRET;
  const environment = process.env.AIRTEL_ENVIRONMENT || 'sandbox';
  const callbackUrl = process.env.AIRTEL_CALLBACK_URL;

  if (!clientId || !clientSecret) {
    throw new Error("Airtel Money credentials not configured");
  }

  // Determine base URL based on environment
  const baseUrl = environment === 'production'
    ? 'https://openapi.airtel.africa'
    : 'https://openapiuat.airtel.africa';

  // Map currency to country code for Airtel
  const currencyCountryMap: Record<string, string> = {
    'KES': 'KE',
    'UGX': 'UG',
    'TZS': 'TZ',
    'RWF': 'RW',
    'NGN': 'NG',
    'ZMW': 'ZM',
    'MWK': 'MW',
  };

  const countryCode = currencyCountryMap[currency] || 'KE';

  try {
    mobileMoneyLogger.info(
      { phone, amount, currency, reference },
      "[Airtel Money] Initiating collection request",
    );

    // Step 1: Get OAuth access token
    const tokenResponse = await fetch(`${baseUrl}/auth/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      mobileMoneyLogger.error(
        { status: tokenResponse.status, error: errorText },
        "[Airtel Money] Failed to get access token"
      );
      throw new Error("Failed to authenticate with Airtel Money");
    }

    const tokenData = await tokenResponse.json() as { access_token: string };
    const accessToken = tokenData.access_token;

    // Step 2: Initiate USSD Push / Collection request
    const transactionId = generateId("airtel");
    
    // Format phone number (ensure it has country code, remove leading zeros)
    let formattedPhone = phone.replace(/^0+/, '');
    if (!formattedPhone.startsWith('254') && !formattedPhone.startsWith('256') && 
        !formattedPhone.startsWith('255') && !formattedPhone.startsWith('234')) {
      // Add default country code based on currency
      const countryPrefixes: Record<string, string> = {
        'KE': '254',
        'UG': '256',
        'TZ': '255',
        'NG': '234',
        'RW': '250',
        'ZM': '260',
        'MW': '265',
      };
      formattedPhone = (countryPrefixes[countryCode] || '254') + formattedPhone;
    }

    const requestBody = {
      reference: transactionId,
      subscriber: {
        country: countryCode,
        currency: currency,
        msisdn: formattedPhone,
      },
      transaction: {
        amount: amount,
        country: countryCode,
        currency: currency,
        id: transactionId,
      },
    };

    const collectionHeaders: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Country': countryCode,
      'X-Currency': currency,
    };

    if (callbackUrl) {
      collectionHeaders['X-Callback-Url'] = callbackUrl;
    }

    const payResponse = await fetch(`${baseUrl}/merchant/v1/payments/`, {
      method: 'POST',
      headers: collectionHeaders,
      body: JSON.stringify(requestBody),
    });

    const responseData = await payResponse.json() as { 
      status: { code: string; message: string; result_code: string; success: boolean };
      data: { transaction: { id: string; status: string } };
    };

    if (payResponse.ok && responseData.status?.success) {
      mobileMoneyLogger.info(
        { phone, amount, transactionId, responseCode: responseData.status?.code },
        "[Airtel Money] Collection request accepted"
      );

      return {
        success: true,
        transactionId: transactionId,
        status: "pending",
        message: "Payment request sent. Please enter your Airtel Money PIN.",
        providerReference: responseData.data?.transaction?.id || transactionId,
      };
    } else {
      mobileMoneyLogger.error(
        { status: payResponse.status, response: responseData },
        "[Airtel Money] Collection request failed"
      );

      // Map common Airtel error codes to user-friendly messages
      const errorMessages: Record<string, string> = {
        'DP00800001001': 'Insufficient balance on your Airtel Money account.',
        'DP00800001003': 'Transaction limit exceeded.',
        'DP00800001004': 'Invalid phone number format.',
        'DP00800001006': 'Service temporarily unavailable. Please try again.',
        'DP00800001007': 'Account not found or inactive.',
      };

      const userMessage = errorMessages[responseData.status?.result_code] || 
        responseData.status?.message || 
        'Failed to initiate Airtel Money payment. Please try again.';

      return {
        success: false,
        transactionId: transactionId,
        status: "failed",
        message: userMessage,
      };
    }
  } catch (error) {
    mobileMoneyLogger.error({ err: error }, "Airtel Money collection failed");
    return {
      success: false,
      transactionId: "",
      status: "failed",
      message: "Failed to initiate Airtel Money payment",
    };
  }
}

// ============================================
// Status Check Functions
// ============================================

interface StatusCheckResult {
  status: "pending" | "processing" | "completed" | "failed";
  reason?: string;
  providerReference?: string;
}

async function checkMtnMomoStatus(transactionId: string): Promise<StatusCheckResult> {
  const apiKey = process.env.MTN_MOMO_API_KEY;
  const subscriptionKey = process.env.MTN_MOMO_SUBSCRIPTION_KEY;
  const userId = process.env.MTN_MOMO_USER_ID;
  const environment = process.env.MTN_MOMO_ENVIRONMENT || 'sandbox';

  if (!apiKey || !subscriptionKey || !userId) {
    return { status: "pending", reason: "MTN MoMo not configured" };
  }

  const baseUrl = environment === 'production' 
    ? 'https://proxy.momoapi.mtn.com'
    : 'https://sandbox.momodeveloper.mtn.com';

  try {
    // Get access token
    const authCredentials = Buffer.from(`${userId}:${apiKey}`).toString('base64');
    const tokenResponse = await fetch(`${baseUrl}/collection/token/`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authCredentials}`,
        'Ocp-Apim-Subscription-Key': subscriptionKey,
      },
    });

    if (!tokenResponse.ok) {
      mobileMoneyLogger.error({ status: tokenResponse.status }, "[MTN MoMo] Token fetch failed");
      return { status: "pending" };
    }

    const tokenData = await tokenResponse.json() as { access_token: string };
    const accessToken = tokenData.access_token;

    // Check transaction status
    const statusResponse = await fetch(
      `${baseUrl}/collection/v1_0/requesttopay/${transactionId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'X-Target-Environment': environment,
          'Ocp-Apim-Subscription-Key': subscriptionKey,
        },
      }
    );

    if (!statusResponse.ok) {
      mobileMoneyLogger.error(
        { status: statusResponse.status, transactionId },
        "[MTN MoMo] Status check failed"
      );
      return { status: "pending" };
    }

    const statusData = await statusResponse.json() as { 
      status: string; 
      reason?: { code: string; message: string };
      financialTransactionId?: string;
    };

    // Map MTN status to our status
    switch (statusData.status) {
      case 'SUCCESSFUL':
        return { 
          status: "completed", 
          providerReference: statusData.financialTransactionId 
        };
      case 'FAILED':
        return { 
          status: "failed", 
          reason: statusData.reason?.message || "Payment was declined" 
        };
      case 'PENDING':
      default:
        return { status: "pending" };
    }
  } catch (error) {
    mobileMoneyLogger.error({ err: error, transactionId }, "MTN MoMo status check failed");
    return { status: "pending" };
  }
}

async function checkAirtelMoneyStatus(transactionId: string): Promise<StatusCheckResult> {
  const clientId = process.env.AIRTEL_CLIENT_ID;
  const clientSecret = process.env.AIRTEL_CLIENT_SECRET;
  const environment = process.env.AIRTEL_ENVIRONMENT || 'sandbox';

  if (!clientId || !clientSecret) {
    return { status: "pending", reason: "Airtel Money not configured" };
  }

  const baseUrl = environment === 'production'
    ? 'https://openapi.airtel.africa'
    : 'https://openapiuat.airtel.africa';

  try {
    // Get OAuth access token
    const tokenResponse = await fetch(`${baseUrl}/auth/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
    });

    if (!tokenResponse.ok) {
      mobileMoneyLogger.error({ status: tokenResponse.status }, "[Airtel Money] Token fetch failed");
      return { status: "pending" };
    }

    const tokenData = await tokenResponse.json() as { access_token: string };
    const accessToken = tokenData.access_token;

    // Check transaction status
    const statusResponse = await fetch(
      `${baseUrl}/standard/v1/payments/${transactionId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!statusResponse.ok) {
      mobileMoneyLogger.error(
        { status: statusResponse.status, transactionId },
        "[Airtel Money] Status check failed"
      );
      return { status: "pending" };
    }

    const statusData = await statusResponse.json() as { 
      data: { 
        transaction: { 
          id: string; 
          status: string;
          airtel_money_id?: string;
        } 
      };
      status: { code: string; message: string; result_code: string; success: boolean };
    };

    const txnStatus = statusData.data?.transaction?.status;

    // Map Airtel status codes
    // TS = Transaction Successful
    // TF = Transaction Failed
    // TP = Transaction Pending
    // TIP = Transaction In Progress
    switch (txnStatus) {
      case 'TS':
        return { 
          status: "completed", 
          providerReference: statusData.data?.transaction?.airtel_money_id 
        };
      case 'TF':
        return { 
          status: "failed", 
          reason: statusData.status?.message || "Payment was declined" 
        };
      case 'TIP':
        return { status: "processing" };
      case 'TP':
      default:
        return { status: "pending" };
    }
  } catch (error) {
    mobileMoneyLogger.error({ err: error, transactionId }, "Airtel Money status check failed");
    return { status: "pending" };
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
    mobileMoneyLogger.info({ disbursement }, "[MoMo Disbursement] Initiated");

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
  const poll = c.req.query("poll") === "true";

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

  // If status is already terminal (completed/failed), return cached
  if (txn.status === "completed" || txn.status === "failed") {
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
  }

  // If poll=true, check with the actual provider
  if (poll && (txn.status === "pending" || txn.status === "processing")) {
    let statusResult: StatusCheckResult = { status: "pending" };

    switch (txn.provider) {
      case MobileMoneyProvider.MTN_MOMO:
        statusResult = await checkMtnMomoStatus(transactionId);
        break;
      case MobileMoneyProvider.AIRTEL_MONEY:
        statusResult = await checkAirtelMoneyStatus(transactionId);
        break;
      // M-Pesa uses callbacks, so status is updated via webhook
      case MobileMoneyProvider.MPESA:
      default:
        // Return cached status for providers without status polling
        break;
    }

    // Update cache and payment if status changed
    if (statusResult.status !== txn.status) {
      txn.status = statusResult.status;
      await redis.setex(`momo:txn:${transactionId}`, 3600, JSON.stringify(txn));

      // Update payment in database
      if (statusResult.status === "completed" || statusResult.status === "failed") {
        const newStatus = statusResult.status === "completed" 
          ? PaymentStatus.COMPLETED 
          : PaymentStatus.FAILED;

        await prisma.payment.update({
          where: { id: txn.paymentId },
          data: {
            status: newStatus,
            completedAt: statusResult.status === "completed" ? new Date() : undefined,
            failureReason: statusResult.reason,
            providerReference: statusResult.providerReference,
          },
        });

        // If successful, credit user's wallet
        if (statusResult.status === "completed") {
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
                  description: `${txn.provider} top-up`,
                },
              }),
            ]);
          }
        }
      }
    }
  }

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

  mobileMoneyLogger.info({ body }, "[M-Pesa Callback] Received");

  const { Body } = body;
  if (!Body?.stkCallback) {
    return c.json({ success: true });
  }

  const { MerchantRequestID, ResultCode, ResultDesc, CallbackMetadata } =
    Body.stkCallback;

  // Find the payment by merchant request ID
  const txnData = await redis.get(`momo:txn:${MerchantRequestID}`);
  if (!txnData) {
    mobileMoneyLogger.error(
      { MerchantRequestID },
      "Transaction not found for M-Pesa callback",
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

  mobileMoneyLogger.info({ body }, "[MTN MoMo Callback] Received");

  // MTN MoMo callback structure
  // {
  //   "financialTransactionId": "string",
  //   "externalId": "string",
  //   "amount": "string",
  //   "currency": "string",
  //   "payer": { "partyIdType": "MSISDN", "partyId": "string" },
  //   "status": "SUCCESSFUL" | "FAILED" | "PENDING"
  // }

  const { externalId, status, financialTransactionId } = body;

  if (!externalId) {
    return c.json({ success: true });
  }

  // Find the transaction by external ID
  const txnData = await redis.get(`momo:txn:${externalId}`);
  if (!txnData) {
    mobileMoneyLogger.error(
      { externalId },
      "Transaction not found for MTN MoMo callback",
    );
    return c.json({ success: true });
  }

  const txn = JSON.parse(txnData);
  const isSuccess = status === "SUCCESSFUL";
  const isFailed = status === "FAILED";

  if (isSuccess || isFailed) {
    // Update payment status
    await prisma.payment.update({
      where: { id: txn.paymentId },
      data: {
        status: isSuccess ? PaymentStatus.COMPLETED : PaymentStatus.FAILED,
        completedAt: isSuccess ? new Date() : undefined,
        failureReason: isSuccess ? undefined : `MTN MoMo payment ${status}`,
        metadata: {
          ...((await prisma.payment.findUnique({ where: { id: txn.paymentId } }))
            ?.metadata as object),
          mtnFinancialTransactionId: financialTransactionId,
          mtnStatus: status,
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
              description: "MTN MoMo top-up",
            },
          }),
        ]);
      }
    }

    // Update cached transaction status
    txn.status = isSuccess ? "completed" : "failed";
    await redis.setex(`momo:txn:${externalId}`, 3600, JSON.stringify(txn));
  }

  return c.json({ success: true });
});

/**
 * POST /mobile-money/callback/airtel - Airtel Money callback webhook
 */
mobileMoneyRoutes.post("/callback/airtel", async (c) => {
  const body = await c.req.json();

  mobileMoneyLogger.info({ body }, "[Airtel Money Callback] Received");

  // Airtel Money callback structure
  // {
  //   "transaction": {
  //     "id": "string",
  //     "message": "string",
  //     "status_code": "TS" | "TF" | "TP",
  //     "airtel_money_id": "string"
  //   }
  // }

  const { transaction } = body;
  
  if (!transaction?.id) {
    return c.json({ success: true });
  }

  const { id: transactionId, status_code, airtel_money_id } = transaction;

  // Find the transaction
  const txnData = await redis.get(`momo:txn:${transactionId}`);
  if (!txnData) {
    mobileMoneyLogger.error(
      { transactionId },
      "Transaction not found for Airtel Money callback",
    );
    return c.json({ success: true });
  }

  const txn = JSON.parse(txnData);
  
  // Map Airtel status codes
  // TS = Transaction Successful
  // TF = Transaction Failed  
  // TP = Transaction Pending
  const isSuccess = status_code === "TS";
  const isFailed = status_code === "TF";

  if (isSuccess || isFailed) {
    // Update payment status
    await prisma.payment.update({
      where: { id: txn.paymentId },
      data: {
        status: isSuccess ? PaymentStatus.COMPLETED : PaymentStatus.FAILED,
        completedAt: isSuccess ? new Date() : undefined,
        failureReason: isSuccess ? undefined : `Airtel Money payment failed`,
        metadata: {
          ...((await prisma.payment.findUnique({ where: { id: txn.paymentId } }))
            ?.metadata as object),
          airtelMoneyId: airtel_money_id,
          airtelStatusCode: status_code,
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
              description: "Airtel Money top-up",
            },
          }),
        ]);
      }
    }

    // Update cached transaction status
    txn.status = isSuccess ? "completed" : "failed";
    await redis.setex(`momo:txn:${transactionId}`, 3600, JSON.stringify(txn));
  }

  return c.json({ success: true });
});

export { MobileMoneyProvider, mobileMoneyRoutes };
