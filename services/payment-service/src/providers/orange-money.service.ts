/**
 * Orange Money Payment Service
 *
 * Implements Orange Money API for mobile payments in Francophone Africa:
 * - Côte d'Ivoire (CI)
 * - Senegal (SN)
 * - Cameroon (CM)
 * - Mali (ML)
 * - Burkina Faso (BF)
 * - Guinea (GN)
 *
 * Orange Money is the leading mobile money platform in French-speaking
 * African countries with over 60 million users.
 *
 * Key Features:
 * - Web Payment (redirect flow)
 * - USSD Push Payment
 * - QR Code Payment
 * - Merchant Payment
 * - Disbursements (B2C transfers)
 * - Transaction status queries
 *
 * API Flow:
 * 1. Generate OAuth token
 * 2. Initiate payment request
 * 3. Customer receives notification/USSD prompt
 * 4. Customer confirms with PIN
 * 5. Receive callback with result
 *
 * Currency: XOF (West African CFA Franc) for WAEMU countries
 */

import {
  Currency,
  PaymentProvider,
  PaymentStatus,
  type PrismaClient,
} from "@prisma/client";
import { nanoid } from "nanoid";

import { orangeMoneyLogger } from "../lib/logger.js";

/** Orange Money transaction status values */
export type OrangeMoneyStatus = "SUCCESS" | "FAILED" | "PENDING" | "CANCELLED";

export interface OrangeMoneyConfig {
  merchantKey: string; // Merchant API key
  merchantSecret: string; // Merchant secret for OAuth
  merchantCode: string; // Merchant code/ID
  country: "CI" | "SN" | "CM" | "ML" | "BF" | "GN";
  notifyUrl: string; // Callback URL
  returnUrl: string; // Redirect URL after payment
  cancelUrl?: string; // Cancel redirect URL
  environment: "sandbox" | "production";
}

// Country-specific configurations
const COUNTRY_CONFIG: Record<
  string,
  {
    baseUrl: {
      sandbox: string;
      production: string;
    };
    currency: Currency;
    phonePrefix: string;
    provider: PaymentProvider;
  }
> = {
  CI: {
    baseUrl: {
      sandbox: "https://api.sandbox.orange-sonatel.com",
      production: "https://api.orange.com/orange-money-webpay/cm/v1",
    },
    currency: Currency.XOF,
    phonePrefix: "225",
    provider: PaymentProvider.ORANGE_MONEY,
  },
  SN: {
    baseUrl: {
      sandbox: "https://api.sandbox.orange-sonatel.com",
      production: "https://api.orange.com/orange-money-webpay/sn/v1",
    },
    currency: Currency.XOF,
    phonePrefix: "221",
    provider: PaymentProvider.ORANGE_MONEY,
  },
  CM: {
    baseUrl: {
      sandbox: "https://api.sandbox.orange-sonatel.com",
      production: "https://api.orange.com/orange-money-webpay/cm/v1",
    },
    currency: Currency.XOF,
    phonePrefix: "237",
    provider: PaymentProvider.ORANGE_MONEY,
  },
  ML: {
    baseUrl: {
      sandbox: "https://api.sandbox.orange-sonatel.com",
      production: "https://api.orange.com/orange-money-webpay/ml/v1",
    },
    currency: Currency.XOF,
    phonePrefix: "223",
    provider: PaymentProvider.ORANGE_MONEY,
  },
  BF: {
    baseUrl: {
      sandbox: "https://api.sandbox.orange-sonatel.com",
      production: "https://api.orange.com/orange-money-webpay/bf/v1",
    },
    currency: Currency.XOF,
    phonePrefix: "226",
    provider: PaymentProvider.ORANGE_MONEY,
  },
  GN: {
    baseUrl: {
      sandbox: "https://api.sandbox.orange-sonatel.com",
      production: "https://api.orange.com/orange-money-webpay/gn/v1",
    },
    currency: Currency.XOF,
    phonePrefix: "224",
    provider: PaymentProvider.ORANGE_MONEY,
  },
};

export interface OrangeMoneyPaymentRequest {
  phoneNumber: string; // Customer phone: country prefix + number
  amount: number; // Amount in XOF (no decimals)
  orderId: string; // Merchant order ID
  description: string; // Payment description
  reference?: string; // Additional reference
  customerName?: string; // Customer name for display
  customerEmail?: string; // Customer email for receipt
  metadata?: Record<string, unknown>;
}

export interface OrangeMoneyPaymentResponse {
  status: number;
  message: string;
  payToken?: string; // Token for tracking payment
  paymentUrl?: string; // URL to redirect customer (web flow)
  notifToken?: string; // Token for callback validation
  data?: {
    inittxnstatus: string;
    inittxnmessage: string;
    createtime: string;
    txnid: string;
  };
}

export interface OrangeMoneyDisbursementRequest {
  phoneNumber: string; // Recipient phone
  amount: number; // Amount in XOF
  orderId: string; // Merchant payout ID
  description?: string; // Note to recipient
}

export interface OrangeMoneyDisbursementResponse {
  status: number;
  message: string;
  data?: {
    txnid: string; // Orange Money transaction ID
    txnstatus: string;
    createtime: string;
  };
}

export interface OrangeMoneyCallbackData {
  notifToken: string;
  txnid: string;
  status: OrangeMoneyStatus;
  orderId: string;
  payToken: string;
  amount: string;
  txnmode?: string;
}

export interface OrangeMoneyTransactionStatus {
  status: number;
  message: string;
  data?: {
    orderId: string;
    txnid: string;
    amount: string;
    status: OrangeMoneyStatus;
    createtime: string;
    txnmode: string;
  };
}

export interface OrangeMoneyBalanceResponse {
  status: number;
  message: string;
  data?: {
    balance: number;
    currency: string;
  };
}

/** Type for country configuration */
type CountryConfigType = {
  baseUrl: {
    sandbox: string;
    production: string;
  };
  currency: Currency;
  phonePrefix: string;
  provider: PaymentProvider;
};

export class OrangeMoneyService {
  private readonly baseUrl: string;
  private readonly countryConfig: CountryConfigType;
  private accessToken?: string;
  private tokenExpiresAt?: Date;

  constructor(
    private readonly config: OrangeMoneyConfig,
    private readonly prisma: PrismaClient,
  ) {
    const countryConfig = COUNTRY_CONFIG[config.country];
    if (!countryConfig) {
      throw new Error(`Unsupported Orange Money country: ${config.country}`);
    }
    this.countryConfig = countryConfig;
    this.baseUrl =
      this.countryConfig.baseUrl[config.environment] ||
      this.countryConfig.baseUrl.sandbox;
  }

  /**
   * Get OAuth2 access token
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (
      this.accessToken &&
      this.tokenExpiresAt &&
      this.tokenExpiresAt > new Date()
    ) {
      return this.accessToken;
    }

    const authUrl =
      this.config.environment === "production"
        ? "https://api.orange.com/oauth/v3/token"
        : "https://api.sandbox.orange-sonatel.com/oauth/v3/token";

    const credentials = Buffer.from(
      `${this.config.merchantKey}:${this.config.merchantSecret}`,
    ).toString("base64");

    try {
      const response = await fetch(authUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });

      if (!response.ok) {
        throw new Error(`OAuth error: ${response.status}`);
      }

      const data = (await response.json()) as {
        access_token: string;
        token_type: string;
        expires_in: number;
      };

      this.accessToken = data.access_token;
      // Token expires slightly before actual expiry
      this.tokenExpiresAt = new Date(
        Date.now() + (data.expires_in - 60) * 1000,
      );

      orangeMoneyLogger.debug(
        { country: this.config.country },
        "[OrangeMoney] OAuth token obtained",
      );

      return this.accessToken;
    } catch (error) {
      orangeMoneyLogger.error(
        { err: error, country: this.config.country },
        "[OrangeMoney] OAuth token request failed",
      );
      throw error;
    }
  }

  /**
   * Validate phone number format for country
   */
  private validatePhoneNumber(phoneNumber: string): string {
    const prefix = this.countryConfig.phonePrefix;
    let normalized = phoneNumber.replaceAll(/\D/g, "");

    // Add country prefix if missing
    if (!normalized.startsWith(prefix)) {
      // Remove leading zeros
      normalized = normalized.replace(/^0+/, "");
      normalized = prefix + normalized;
    }

    return normalized;
  }

  /**
   * Create payment request
   */
  async createPayment(
    request: OrangeMoneyPaymentRequest,
  ): Promise<OrangeMoneyPaymentResponse> {
    const accessToken = await this.getAccessToken();
    const phoneNumber = this.validatePhoneNumber(request.phoneNumber);

    const payload = {
      merchant_key: this.config.merchantKey,
      currency: this.countryConfig.currency,
      order_id: request.orderId,
      amount: Math.round(request.amount), // XOF has no decimals
      return_url: this.config.returnUrl,
      cancel_url: this.config.cancelUrl || this.config.returnUrl,
      notif_url: this.config.notifyUrl,
      lang: "fr",
      reference: request.reference || request.orderId,
      customer: {
        phone: phoneNumber,
        name: request.customerName,
        email: request.customerEmail,
      },
    };

    orangeMoneyLogger.info(
      {
        orderId: request.orderId,
        amount: request.amount,
        country: this.config.country,
      },
      "[OrangeMoney] Creating payment request",
    );

    try {
      const response = await fetch(`${this.baseUrl}/webpayment`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as OrangeMoneyPaymentResponse;

      if (data.status !== 201 && data.status !== 200) {
        orangeMoneyLogger.error(
          {
            status: data.status,
            message: data.message,
            orderId: request.orderId,
          },
          "[OrangeMoney] Payment creation failed",
        );
        throw new Error(`Orange Money error: ${data.message}`);
      }

      // Store payment record
      await this.prisma.paymentTransaction.create({
        data: {
          id: nanoid(),
          provider: this.countryConfig.provider,
          providerReference: request.orderId,
          amount: request.amount,
          currency: this.countryConfig.currency,
          status: PaymentStatus.PENDING,
          metadata: {
            phoneNumber,
            payToken: data.payToken,
            notifToken: data.notifToken,
            country: this.config.country,
            ...request.metadata,
          },
        },
      });

      orangeMoneyLogger.info(
        { orderId: request.orderId, payToken: data.payToken },
        "[OrangeMoney] Payment created successfully",
      );

      return data;
    } catch (error) {
      orangeMoneyLogger.error(
        { err: error, orderId: request.orderId },
        "[OrangeMoney] Payment request failed",
      );
      throw error;
    }
  }

  /**
   * Send USSD push payment (direct debit)
   * Customer receives USSD prompt to enter PIN
   */
  async sendUssdPush(
    request: OrangeMoneyPaymentRequest,
  ): Promise<OrangeMoneyPaymentResponse> {
    const accessToken = await this.getAccessToken();
    const phoneNumber = this.validatePhoneNumber(request.phoneNumber);

    const payload = {
      merchant_key: this.config.merchantKey,
      currency: this.countryConfig.currency,
      order_id: request.orderId,
      amount: Math.round(request.amount),
      notif_url: this.config.notifyUrl,
      subscriber: {
        country: this.config.country,
        msisdn: phoneNumber,
      },
      description: request.description,
      reference: request.reference || request.orderId,
    };

    orangeMoneyLogger.info(
      { orderId: request.orderId, phoneNumber: phoneNumber.slice(-4) },
      "[OrangeMoney] Sending USSD push",
    );

    try {
      const response = await fetch(`${this.baseUrl}/mp/pay`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as OrangeMoneyPaymentResponse;

      if (data.status !== 201 && data.status !== 200) {
        orangeMoneyLogger.error(
          { status: data.status, message: data.message },
          "[OrangeMoney] USSD push failed",
        );
        throw new Error(`Orange Money USSD error: ${data.message}`);
      }

      // Store payment record
      await this.prisma.paymentTransaction.create({
        data: {
          id: nanoid(),
          provider: this.countryConfig.provider,
          providerReference: request.orderId,
          amount: request.amount,
          currency: this.countryConfig.currency,
          status: PaymentStatus.PENDING,
          metadata: {
            phoneNumber,
            paymentMethod: "USSD_PUSH",
            country: this.config.country,
            ...request.metadata,
          },
        },
      });

      orangeMoneyLogger.info(
        { orderId: request.orderId },
        "[OrangeMoney] USSD push sent",
      );

      return data;
    } catch (error) {
      orangeMoneyLogger.error(
        { err: error, orderId: request.orderId },
        "[OrangeMoney] USSD push failed",
      );
      throw error;
    }
  }

  /**
   * Query transaction status
   */
  async queryTransaction(
    orderId: string,
    payToken?: string,
  ): Promise<OrangeMoneyTransactionStatus> {
    const accessToken = await this.getAccessToken();

    const queryParams = new URLSearchParams({
      order_id: orderId,
      ...(payToken && { pay_token: payToken }),
    });

    try {
      const response = await fetch(
        `${this.baseUrl}/webpayment/check?${queryParams.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      const data = (await response.json()) as OrangeMoneyTransactionStatus;

      if (data.status === 200 && data.data) {
        // Update local record
        await this.prisma.paymentTransaction.updateMany({
          where: { providerReference: orderId },
          data: {
            status: this.mapTransactionStatus(data.data.status),
            providerTransactionId: data.data.txnid,
            providerResponse: data as unknown as Record<string, unknown>,
            updatedAt: new Date(),
          },
        });
      }

      return data;
    } catch (error) {
      orangeMoneyLogger.error(
        { err: error, orderId },
        "[OrangeMoney] Transaction query failed",
      );
      throw error;
    }
  }

  /**
   * Process B2C disbursement (transfer to customer)
   */
  async disbursement(
    request: OrangeMoneyDisbursementRequest,
  ): Promise<OrangeMoneyDisbursementResponse> {
    const accessToken = await this.getAccessToken();
    const phoneNumber = this.validatePhoneNumber(request.phoneNumber);

    const payload = {
      merchant_key: this.config.merchantKey,
      order_id: request.orderId,
      amount: Math.round(request.amount),
      currency: this.countryConfig.currency,
      subscriber: {
        country: this.config.country,
        msisdn: phoneNumber,
      },
      description: request.description || "UBI Payout",
    };

    orangeMoneyLogger.info(
      {
        orderId: request.orderId,
        amount: request.amount,
        phoneNumber: phoneNumber.slice(-4),
      },
      "[OrangeMoney] Processing disbursement",
    );

    try {
      const response = await fetch(`${this.baseUrl}/cashout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as OrangeMoneyDisbursementResponse;

      if (data.status !== 201 && data.status !== 200) {
        orangeMoneyLogger.error(
          { status: data.status, message: data.message },
          "[OrangeMoney] Disbursement failed",
        );
        throw new Error(`Orange Money disbursement error: ${data.message}`);
      }

      // Store disbursement record
      await this.prisma.payout.create({
        data: {
          id: nanoid(),
          provider: this.countryConfig.provider,
          providerReference: data.data?.txnid || request.orderId,
          amount: request.amount,
          currency: this.countryConfig.currency,
          status: PaymentStatus.COMPLETED,
          recipientPhone: phoneNumber,
          metadata: {
            description: request.description,
            country: this.config.country,
          },
        },
      });

      orangeMoneyLogger.info(
        { orderId: request.orderId, txnid: data.data?.txnid },
        "[OrangeMoney] Disbursement completed",
      );

      return data;
    } catch (error) {
      orangeMoneyLogger.error(
        { err: error, orderId: request.orderId },
        "[OrangeMoney] Disbursement failed",
      );
      throw error;
    }
  }

  /**
   * Get merchant account balance
   */
  async getBalance(): Promise<number> {
    const accessToken = await this.getAccessToken();

    try {
      const response = await fetch(`${this.baseUrl}/balance`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = (await response.json()) as OrangeMoneyBalanceResponse;

      if (data.status === 200 && data.data) {
        // Store balance for tracking
        await this.prisma.providerBalance.upsert({
          where: {
            provider_currency: {
              provider: this.countryConfig.provider,
              currency: this.countryConfig.currency,
            },
          },
          update: {
            balance: data.data.balance,
            updatedAt: new Date(),
          },
          create: {
            provider: this.countryConfig.provider,
            currency: this.countryConfig.currency,
            balance: data.data.balance,
          },
        });

        return data.data.balance;
      }

      return 0;
    } catch (error) {
      orangeMoneyLogger.error(
        { err: error, country: this.config.country },
        "[OrangeMoney] Balance query failed",
      );
      throw error;
    }
  }

  /**
   * Handle callback from Orange Money
   */
  async handleCallback(
    callbackData: OrangeMoneyCallbackData,
  ): Promise<{ success: boolean; message: string }> {
    orangeMoneyLogger.info(
      {
        orderId: callbackData.orderId,
        txnid: callbackData.txnid,
        status: callbackData.status,
      },
      "[OrangeMoney] Processing callback",
    );

    const status = this.mapTransactionStatus(callbackData.status);

    // Update transaction record
    await this.prisma.paymentTransaction.updateMany({
      where: { providerReference: callbackData.orderId },
      data: {
        status,
        providerTransactionId: callbackData.txnid,
        providerResponse: callbackData as unknown as Record<string, unknown>,
        completedAt:
          status === PaymentStatus.COMPLETED ? new Date() : undefined,
        updatedAt: new Date(),
      },
    });

    orangeMoneyLogger.info(
      { orderId: callbackData.orderId, status },
      "[OrangeMoney] Callback processed",
    );

    return { success: true, message: "Callback processed" };
  }

  /**
   * Map Orange Money status to internal status
   */
  private mapTransactionStatus(omStatus: OrangeMoneyStatus): PaymentStatus {
    switch (omStatus) {
      case "SUCCESS":
        return PaymentStatus.COMPLETED;
      case "FAILED":
        return PaymentStatus.FAILED;
      case "CANCELLED":
        return PaymentStatus.CANCELLED;
      case "PENDING":
      default:
        return PaymentStatus.PENDING;
    }
  }

  /**
   * Get the provider enum for this instance
   */
  getProvider(): PaymentProvider {
    return this.countryConfig.provider;
  }

  /**
   * Get the currency for this instance
   */
  getCurrency(): Currency {
    return this.countryConfig.currency;
  }
}

// Factory function
export function createOrangeMoneyService(
  config: OrangeMoneyConfig,
  prisma: PrismaClient,
): OrangeMoneyService {
  return new OrangeMoneyService(config, prisma);
}

// Create services for all supported countries
export function createOrangeMoneyServices(
  baseConfig: Omit<OrangeMoneyConfig, "country">,
  prisma: PrismaClient,
): Map<string, OrangeMoneyService> {
  const services = new Map<string, OrangeMoneyService>();

  const countries: Array<"CI" | "SN" | "CM" | "ML"> = ["CI", "SN", "CM", "ML"];

  for (const country of countries) {
    services.set(
      country,
      new OrangeMoneyService({ ...baseConfig, country }, prisma),
    );
  }

  return services;
}
