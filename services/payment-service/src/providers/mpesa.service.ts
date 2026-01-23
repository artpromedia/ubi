/**
 * M-Pesa Payment Service (Kenya)
 *
 * Implements Safaricom M-Pesa STK Push (Lipa Na M-Pesa Online) for Kenya.
 *
 * Key Features:
 * - STK Push initiation (sends payment popup to customer phone)
 * - Transaction status polling
 * - Webhook callback handling
 * - Automatic retry on network failures
 * - Timeout management (60s default)
 *
 * Flow:
 * 1. Initiate STK Push → Customer receives popup
 * 2. Customer enters M-Pesa PIN
 * 3. M-Pesa processes payment
 * 4. Webhook callback received
 * 5. Transaction marked as completed
 *
 * Error Handling:
 * - Network timeout → Poll transaction status
 * - Insufficient balance → Fail gracefully
 * - Invalid phone → Validate before initiating
 * - Duplicate transaction → Idempotency check
 */

import {
  PaymentProvider,
  PaymentStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { mpesaLogger } from "../lib/logger.js";

export interface MpesaConfig {
  consumerKey: string;
  consumerSecret: string;
  shortCode: string;
  passkey: string;
  callbackUrl: string;
  b2cShortCode?: string; // B2C business short code (may differ from paybill)
  b2cInitiatorName?: string; // B2C API operator username
  b2cSecurityCredential?: string; // Encrypted B2C password
  b2cQueueTimeoutUrl?: string; // B2C timeout callback URL
  b2cResultUrl?: string; // B2C result callback URL
  environment: "sandbox" | "production";
}

export interface MpesaSTKPushRequest {
  phoneNumber: string; // Format: 254XXXXXXXXX
  amount: number;
  accountReference: string;
  transactionDesc: string;
}

export interface MpesaB2CRequest {
  phoneNumber: string; // Format: 254XXXXXXXXX
  amount: number;
  occasion: string; // Purpose of payment
  remarks?: string; // Additional info
  commandID?: "BusinessPayment" | "SalaryPayment" | "PromotionPayment"; // Payment type
}

export interface MpesaB2CResponse {
  ConversationID: string;
  OriginatorConversationID: string;
  ResponseCode: string; // "0" = success
  ResponseDescription: string;
}

export interface MpesaB2CCallback {
  Result: {
    ResultType: number;
    ResultCode: number; // 0 = success
    ResultDesc: string;
    OriginatorConversationID: string;
    ConversationID: string;
    TransactionID: string;
    ResultParameters?: {
      ResultParameter: Array<{
        Key: string;
        Value: string | number;
      }>;
    };
  };
}

export interface MpesaSTKPushResponse {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: string; // "0" = success
  ResponseDescription: string;
  CustomerMessage: string;
}

export interface MpesaCallback {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number; // 0 = success
      ResultDesc: string;
      CallbackMetadata?: {
        Item: Array<{
          Name: string;
          Value: string | number;
        }>;
      };
    };
  };
}

export interface MpesaTransactionStatusResponse {
  ResponseCode: string;
  ResponseDescription: string;
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResultCode: string;
  ResultDesc: string;
}

export class MpesaService {
  private readonly baseUrl: string;
  private accessToken?: string;
  private tokenExpiresAt?: Date;

  constructor(
    private readonly config: MpesaConfig,
    private readonly prisma: PrismaClient,
  ) {
    this.baseUrl =
      config.environment === "production"
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke";
  }

  /**
   * Get OAuth access token (cached for 1 hour)
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

    const auth = Buffer.from(
      `${this.config.consumerKey}:${this.config.consumerSecret}`,
    ).toString("base64");

    const response = await fetch(
      `${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `Failed to get M-Pesa access token: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { access_token: string };
    this.accessToken = data.access_token;
    this.tokenExpiresAt = new Date(Date.now() + 55 * 60 * 1000); // 55 minutes (token valid for 1 hour)

    return this.accessToken;
  }

  /**
   * Generate password for STK Push
   * Formula: Base64(Shortcode + Passkey + Timestamp)
   */
  private generatePassword(timestamp: string): string {
    const str = `${this.config.shortCode}${this.config.passkey}${timestamp}`;
    return Buffer.from(str).toString("base64");
  }

  /**
   * Generate timestamp in M-Pesa format: YYYYMMDDHHmmss
   */
  private generateTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
  }

  /**
   * Validate phone number format
   * Must be: 254XXXXXXXXX (Kenya country code + 9 digits)
   */
  private validatePhoneNumber(phoneNumber: string): boolean {
    const regex = /^254\d{9}$/;
    return regex.test(phoneNumber);
  }

  /**
   * Format phone number to M-Pesa format
   * Accepts: 254XXXXXXXXX, 0XXXXXXXXX, or XXXXXXXXX
   * Returns: 254XXXXXXXXX
   */
  private formatPhoneNumber(phoneNumber: string): string {
    // Remove any spaces or special characters
    let cleaned = phoneNumber.replaceAll(/[\s\-()]/g, "");

    // If starts with 0, replace with 254
    if (cleaned.startsWith("0")) {
      cleaned = "254" + cleaned.substring(1);
    }

    // If starts with +254, remove +
    if (cleaned.startsWith("+254")) {
      cleaned = cleaned.substring(1);
    }

    // If doesn't start with 254, add it
    if (!cleaned.startsWith("254")) {
      cleaned = "254" + cleaned;
    }

    if (!this.validatePhoneNumber(cleaned)) {
      throw new Error(`Invalid phone number format: ${phoneNumber}`);
    }

    return cleaned;
  }

  /**
   * Initiate STK Push (Lipa Na M-Pesa Online)
   * Sends payment popup to customer's phone
   */
  async initiateSTKPush(
    request: MpesaSTKPushRequest,
  ): Promise<MpesaSTKPushResponse> {
    const token = await this.getAccessToken();
    const timestamp = this.generateTimestamp();
    const password = this.generatePassword(timestamp);
    const formattedPhone = this.formatPhoneNumber(request.phoneNumber);

    if (request.amount <= 0) {
      throw new Error("Amount must be positive");
    }

    if (request.amount < 1) {
      throw new Error("Amount must be at least KES 1");
    }

    const payload = {
      BusinessShortCode: this.config.shortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: Math.round(request.amount), // M-Pesa requires integer
      PartyA: formattedPhone,
      PartyB: this.config.shortCode,
      PhoneNumber: formattedPhone,
      CallBackURL: this.config.callbackUrl,
      AccountReference: request.accountReference,
      TransactionDesc: request.transactionDesc || "Payment",
    };

    const response = await fetch(
      `${this.baseUrl}/mpesa/stkpush/v1/processrequest`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    const data = (await response.json()) as MpesaSTKPushResponse & {
      errorMessage?: string;
    };

    if (!response.ok || data.ResponseCode !== "0") {
      throw new Error(
        `M-Pesa STK Push failed: ${data.ResponseDescription || data.errorMessage || "Unknown error"}`,
      );
    }

    return data as MpesaSTKPushResponse;
  }

  /**
   * Query transaction status
   * Used to check status if webhook is not received
   */
  async queryTransactionStatus(
    checkoutRequestId: string,
  ): Promise<MpesaTransactionStatusResponse> {
    const token = await this.getAccessToken();
    const timestamp = this.generateTimestamp();
    const password = this.generatePassword(timestamp);

    const payload = {
      BusinessShortCode: this.config.shortCode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    };

    const response = await fetch(
      `${this.baseUrl}/mpesa/stkpushquery/v1/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    const data = (await response.json()) as MpesaTransactionStatusResponse & {
      errorMessage?: string;
    };

    if (!response.ok) {
      throw new Error(
        `Failed to query M-Pesa transaction: ${data.errorMessage || "Unknown error"}`,
      );
    }

    return data as MpesaTransactionStatusResponse;
  }

  /**
   * Handle M-Pesa callback
   * Called when payment is completed or fails
   */
  async handleCallback(callback: MpesaCallback): Promise<void> {
    const { stkCallback } = callback.Body;
    const {
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode,
      ResultDesc,
      CallbackMetadata,
    } = stkCallback;

    // Log webhook for debugging
    await this.prisma.webhookEvent.create({
      data: {
        provider: PaymentProvider.MPESA,
        eventId: CheckoutRequestID,
        eventType: "stkpush_callback",
        payload: callback as any,
        processed: false,
      },
    });

    // Find payment transaction by merchant request ID
    const paymentTx = await this.prisma.paymentTransaction.findFirst({
      where: {
        provider: PaymentProvider.MPESA,
        metadata: {
          path: ["mpesaMerchantRequestID"],
          equals: MerchantRequestID,
        },
      },
    });

    if (!paymentTx) {
      mpesaLogger.warn(
        { MerchantRequestID },
        "Payment transaction not found for M-Pesa MerchantRequestID",
      );
      return;
    }

    // Already processed
    if (paymentTx.status !== PaymentStatus.PENDING) {
      mpesaLogger.info(
        { paymentId: paymentTx.id, status: paymentTx.status },
        "Payment transaction already processed",
      );
      return;
    }

    // Success
    if (ResultCode === 0) {
      // Extract metadata
      const metadata: Record<string, any> = {};
      if (CallbackMetadata) {
        for (const item of CallbackMetadata.Item) {
          metadata[item.Name] = item.Value;
        }
      }

      await this.prisma.paymentTransaction.update({
        where: { id: paymentTx.id },
        data: {
          status: PaymentStatus.COMPLETED,
          confirmedAt: new Date(),
          providerReference: metadata.MpesaReceiptNumber || CheckoutRequestID,
          providerResponse: {
            resultCode: ResultCode,
            resultDesc: ResultDesc,
            metadata,
            checkoutRequestID: CheckoutRequestID,
            merchantRequestID: MerchantRequestID,
          },
          webhookReceived: true,
        },
      });

      // Mark webhook as processed
      await this.prisma.webhookEvent.updateMany({
        where: {
          eventId: CheckoutRequestID,
          provider: PaymentProvider.MPESA,
        },
        data: {
          processed: true,
          processedAt: new Date(),
        },
      });

      mpesaLogger.info(
        { paymentId: paymentTx.id, receipt: metadata.MpesaReceiptNumber },
        "M-Pesa payment completed",
      );
    }
    // Failure
    else {
      await this.prisma.paymentTransaction.update({
        where: { id: paymentTx.id },
        data: {
          status: PaymentStatus.FAILED,
          failedAt: new Date(),
          failureReason: ResultDesc,
          providerResponse: {
            resultCode: ResultCode,
            resultDesc: ResultDesc,
            checkoutRequestID: CheckoutRequestID,
            merchantRequestID: MerchantRequestID,
          },
          webhookReceived: true,
        },
      });

      // Mark webhook as processed
      await this.prisma.webhookEvent.updateMany({
        where: {
          eventId: CheckoutRequestID,
          provider: PaymentProvider.MPESA,
        },
        data: {
          processed: true,
          processedAt: new Date(),
        },
      });

      mpesaLogger.info(
        { paymentId: paymentTx.id, reason: ResultDesc },
        "M-Pesa payment failed",
      );
    }
  }

  /**
   * Poll transaction status until complete or timeout
   * Used when webhook is not received
   */
  async pollTransactionStatus(
    checkoutRequestId: string,
    maxAttempts: number = 20,
    intervalMs: number = 3000,
  ): Promise<MpesaTransactionStatusResponse> {
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;

      try {
        const status = await this.queryTransactionStatus(checkoutRequestId);

        // Success or definitive failure
        if (status.ResultCode === "0" || status.ResultCode === "1") {
          return status;
        }

        // Still processing, wait and retry
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      } catch (error) {
        mpesaLogger.error(
          { err: error, attempts, maxAttempts },
          "Error polling M-Pesa transaction",
        );

        // Continue polling unless it's the last attempt
        if (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        } else {
          throw error;
        }
      }
    }

    throw new Error(
      `Transaction polling timeout after ${maxAttempts} attempts`,
    );
  }

  /**
   * Initiate payment with automatic status polling fallback
   */
  async initiatePayment(params: {
    userId: string;
    phoneNumber: string;
    amount: number;
    transactionId: string;
    description?: string;
  }): Promise<{
    paymentTransactionId: string;
    checkoutRequestId: string;
    status: "pending" | "completed" | "failed";
  }> {
    const { userId, phoneNumber, amount, transactionId, description } = params;

    // Initiate STK Push
    const stkResponse = await this.initiateSTKPush({
      phoneNumber,
      amount,
      accountReference: transactionId,
      transactionDesc: description || "UBI Payment",
    });

    // Create payment transaction record
    const paymentTx = await this.prisma.paymentTransaction.create({
      data: {
        userId,
        provider: PaymentProvider.MPESA,
        amount,
        currency: "KES",
        status: PaymentStatus.PENDING,
        metadata: {
          phoneNumber,
          transactionId,
          mpesaMerchantRequestID: stkResponse.MerchantRequestID,
          mpesaCheckoutRequestID: stkResponse.CheckoutRequestID,
          stkPushResponse: stkResponse as unknown as Prisma.InputJsonValue,
        },
      },
    });

    // Start background polling (in case webhook fails)
    this.startBackgroundPolling(
      stkResponse.CheckoutRequestID,
      paymentTx.id,
    ).catch((error) => {
      mpesaLogger.error({ err: error }, "Background polling error");
    });

    return {
      paymentTransactionId: paymentTx.id,
      checkoutRequestId: stkResponse.CheckoutRequestID,
      status: "pending",
    };
  }

  /**
   * Background polling with exponential backoff
   * Checks transaction status if webhook is not received
   */
  private async startBackgroundPolling(
    checkoutRequestId: string,
    paymentTxId: string,
  ): Promise<void> {
    // Wait 60 seconds (typical STK Push timeout)
    await new Promise((resolve) => setTimeout(resolve, 60000));

    // Check if webhook was already received
    const paymentTx = await this.prisma.paymentTransaction.findUnique({
      where: { id: paymentTxId },
    });

    if (!paymentTx || paymentTx.webhookReceived) {
      return; // Webhook already processed
    }

    // Poll status
    try {
      const status = await this.queryTransactionStatus(checkoutRequestId);

      // Update transaction based on status
      if (status.ResultCode === "0") {
        await this.prisma.paymentTransaction.update({
          where: { id: paymentTxId },
          data: {
            status: PaymentStatus.COMPLETED,
            confirmedAt: new Date(),
            providerReference: checkoutRequestId,
            providerResponse: status as unknown as Prisma.InputJsonValue,
          },
        });
      } else {
        await this.prisma.paymentTransaction.update({
          where: { id: paymentTxId },
          data: {
            status: PaymentStatus.FAILED,
            failedAt: new Date(),
            failureReason: status.ResultDesc,
            providerResponse: status as unknown as Prisma.InputJsonValue,
          },
        });
      }
    } catch (error) {
      mpesaLogger.error(
        { err: error },
        "Failed to poll M-Pesa transaction status",
      );

      // Mark as failed after polling timeout
      await this.prisma.paymentTransaction.update({
        where: { id: paymentTxId },
        data: {
          status: PaymentStatus.FAILED,
          failedAt: new Date(),
          failureReason: "Transaction status polling timeout",
        },
      });
    }
  }

  /**
   * Get payment transaction status
   */
  async getPaymentStatus(paymentTransactionId: string): Promise<{
    status: PaymentStatus;
    providerReference?: string;
    amount: number;
    currency: string;
  }> {
    const paymentTx = await this.prisma.paymentTransaction.findUnique({
      where: { id: paymentTransactionId },
    });

    if (!paymentTx) {
      throw new Error("Payment transaction not found");
    }

    return {
      status: paymentTx.status,
      providerReference: paymentTx.providerReference || undefined,
      amount: Number(paymentTx.amount),
      currency: paymentTx.currency,
    };
  }

  /**
   * Initiate B2C (Business to Customer) payment
   * Used for payouts - sending money from business to customer phone
   */
  async initiateB2CPayment(
    request: MpesaB2CRequest,
  ): Promise<MpesaB2CResponse> {
    if (
      !this.config.b2cShortCode ||
      !this.config.b2cInitiatorName ||
      !this.config.b2cSecurityCredential
    ) {
      throw new Error(
        "B2C configuration missing. Please configure b2cShortCode, b2cInitiatorName, and b2cSecurityCredential",
      );
    }

    if (!this.config.b2cQueueTimeoutUrl || !this.config.b2cResultUrl) {
      throw new Error(
        "B2C callback URLs missing. Please configure b2cQueueTimeoutUrl and b2cResultUrl",
      );
    }

    const token = await this.getAccessToken();
    const formattedPhone = this.formatPhoneNumber(request.phoneNumber);

    if (request.amount <= 0) {
      throw new Error("Amount must be positive");
    }

    if (request.amount < 10) {
      throw new Error("Amount must be at least KES 10 for B2C");
    }

    // Max B2C amount is KES 150,000 per transaction
    if (request.amount > 150000) {
      throw new Error("Amount exceeds M-Pesa B2C limit of KES 150,000");
    }

    const payload = {
      InitiatorName: this.config.b2cInitiatorName,
      SecurityCredential: this.config.b2cSecurityCredential,
      CommandID: request.commandID || "BusinessPayment", // Default to BusinessPayment
      Amount: Math.round(request.amount), // M-Pesa requires integer
      PartyA: this.config.b2cShortCode,
      PartyB: formattedPhone,
      Remarks: request.remarks || request.occasion,
      QueueTimeOutURL: this.config.b2cQueueTimeoutUrl,
      ResultURL: this.config.b2cResultUrl,
      Occasion: request.occasion,
    };

    const response = await fetch(
      `${this.baseUrl}/mpesa/b2c/v1/paymentrequest`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    const data = (await response.json()) as MpesaB2CResponse & {
      errorMessage?: string;
    };

    if (!response.ok || data.ResponseCode !== "0") {
      throw new Error(
        `M-Pesa B2C failed: ${data.ResponseDescription || data.errorMessage || "Unknown error"}`,
      );
    }

    return data as MpesaB2CResponse;
  }

  /**
   * Handle B2C callback from M-Pesa
   * Called when B2C payment completes or fails
   */
  async handleB2CCallback(
    callback: MpesaB2CCallback,
    payoutId: string,
  ): Promise<void> {
    const result = callback.Result;
    const isSuccess = result.ResultCode === 0;

    try {
      if (isSuccess) {
        // Extract transaction details from callback
        let transactionId = result.TransactionID;
        let recipientPhone: string | undefined;
        let transactionAmount: number | undefined;
        let chargesPaid: number | undefined;

        if (result.ResultParameters?.ResultParameter) {
          for (const param of result.ResultParameters.ResultParameter) {
            if (param.Key === "TransactionReceipt") {
              transactionId = String(param.Value);
            } else if (param.Key === "ReceiverPartyPublicName") {
              recipientPhone = String(param.Value);
            } else if (param.Key === "TransactionAmount") {
              transactionAmount = Number(param.Value);
            } else if (param.Key === "B2CChargesPaidAccountAvailableFunds") {
              chargesPaid = Number(param.Value);
            }
          }
        }

        // Update payout in database
        await this.prisma.payout.update({
          where: { id: payoutId },
          data: {
            status: "COMPLETED",
            providerReference: transactionId,
            completedAt: new Date(),
            providerMetadata: {
              conversationId: result.ConversationID,
              originatorConversationId: result.OriginatorConversationID,
              transactionId,
              recipientPhone,
              transactionAmount,
              chargesPaid,
              resultDesc: result.ResultDesc,
            },
          },
        });

        mpesaLogger.info(
          { payoutId, transactionId },
          "M-Pesa B2C payout completed successfully",
        );
      } else {
        // B2C payment failed
        await this.prisma.payout.update({
          where: { id: payoutId },
          data: {
            status: "FAILED",
            failedAt: new Date(),
            failureReason: result.ResultDesc,
            providerMetadata: {
              conversationId: result.ConversationID,
              originatorConversationId: result.OriginatorConversationID,
              resultCode: result.ResultCode,
              resultDesc: result.ResultDesc,
            },
          },
        });

        mpesaLogger.error(
          { payoutId, reason: result.ResultDesc },
          "M-Pesa B2C payout failed",
        );
      }
    } catch (error) {
      mpesaLogger.error(
        { err: error, payoutId },
        "Failed to process M-Pesa B2C callback",
      );
      throw error;
    }
  }

  /**
   * Query B2C transaction status
   * Used when callback is not received within timeout period
   */
  async queryB2CStatus(originatorConversationId: string): Promise<{
    status: "COMPLETED" | "FAILED" | "PENDING";
    description: string;
  }> {
    // Note: M-Pesa doesn't have a direct B2C status query API like STK Push
    // You typically need to wait for the callback or implement your own tracking
    // This is a placeholder that would need custom implementation based on your tracking

    const payout = await this.prisma.payout.findFirst({
      where: {
        metadata: {
          path: ["originatorConversationId"],
          equals: originatorConversationId,
        },
      },
    });

    if (!payout) {
      return {
        status: "PENDING",
        description: "Payout not found in database",
      };
    }

    if (payout.status === "COMPLETED") {
      return {
        status: "COMPLETED",
        description: "Payout completed successfully",
      };
    }

    if (payout.status === "FAILED") {
      return {
        status: "FAILED",
        description: payout.failureReason || "Payout failed",
      };
    }

    return {
      status: "PENDING",
      description: "Payout is still processing",
    };
  }
}
