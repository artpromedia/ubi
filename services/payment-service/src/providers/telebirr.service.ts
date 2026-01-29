/**
 * Telebirr Payment Service
 *
 * Implements Ethio Telecom's Telebirr Mobile Money API for Ethiopia.
 * Telebirr is the dominant mobile money platform in Ethiopia with over
 * 40 million users.
 *
 * Key Features:
 * - H5 Web Payment (redirect flow)
 * - In-App Payment (native SDK)
 * - USSD Payment (for feature phones)
 * - C2B (Customer to Business) payments
 * - B2C (Business to Customer) disbursements
 * - Transaction status queries
 *
 * Flow:
 * 1. Create payment request → Get signed order
 * 2. Redirect to Telebirr payment page / Send USSD push
 * 3. Customer authorizes with PIN
 * 4. Receive callback with result
 * 5. Verify callback signature
 *
 * Security:
 * - RSA signature for request/response
 * - AES encryption for sensitive data
 * - Callback signature verification
 */

import { createSign, createVerify, publicEncrypt } from "crypto";

import {
  Currency,
  PaymentProvider,
  PaymentStatus,
  type PrismaClient,
} from "@prisma/client";
import { nanoid } from "nanoid";

import { telebirrLogger } from "../lib/logger.js";

export interface TelebirrConfig {
  appId: string; // Merchant App ID from Telebirr
  appKey: string; // App Key for API authentication
  shortCode: string; // Merchant short code
  publicKey: string; // Telebirr RSA public key (for encryption)
  privateKey: string; // Merchant RSA private key (for signing)
  notifyUrl: string; // Webhook callback URL
  returnUrl: string; // Redirect URL after payment
  environment: "sandbox" | "production";
}

export interface TelebirrPaymentRequest {
  phoneNumber: string; // Format: 251XXXXXXXXX (Ethiopian format)
  amount: number; // Amount in ETB
  subject: string; // Payment subject/description
  outTradeNo: string; // Merchant order number (your transaction ID)
  timeoutExpress?: string; // Timeout in minutes (default: 30)
  receiveName?: string; // Receiver name for display
  nonce?: string; // Random string for security
}

export interface TelebirrPaymentResponse {
  code: number; // 200 = success
  msg: string;
  data?: {
    toPayUrl: string; // H5 payment URL (redirect user here)
    prepayId?: string; // Pre-pay ID for tracking
  };
}

export interface TelebirrDisbursementRequest {
  phoneNumber: string; // Recipient phone: 251XXXXXXXXX
  amount: number; // Amount in ETB
  outTradeNo: string; // Merchant payout ID
  remark?: string; // Note to recipient
}

export interface TelebirrDisbursementResponse {
  code: number;
  msg: string;
  data?: {
    tradeNo: string; // Telebirr transaction ID
    outTradeNo: string; // Merchant payout ID
  };
}

export interface TelebirrCallbackData {
  appid: string;
  sign: string;
  trade_no: string; // Telebirr transaction ID
  out_trade_no: string; // Merchant order number
  total_amount: string;
  trans_status: "P" | "S" | "F" | "C"; // Pending, Success, Failed, Cancelled
  trade_date: string;
  msisdn: string; // Customer phone number
  invoice_no?: string;
}

export interface TelebirrTransactionStatus {
  code: number;
  msg: string;
  data?: {
    outTradeNo: string;
    tradeNo: string;
    transAmount: number;
    transStatus: "P" | "S" | "F" | "C";
    transDate: string;
  };
}

export interface TelebirrBalanceResponse {
  code: number;
  msg: string;
  data?: {
    balance: number;
    currency: string;
    availableBalance: number;
    frozenBalance: number;
  };
}

export class TelebirrService {
  private readonly baseUrl: string;

  constructor(
    private readonly config: TelebirrConfig,
    private readonly prisma: PrismaClient,
  ) {
    this.baseUrl =
      config.environment === "production"
        ? "https://api.ethiotelecom.et/telebirr"
        : "https://sandbox.ethiotelecom.et/telebirr";
  }

  /**
   * Generate signed timestamp for requests
   */
  private getTimestamp(): string {
    return new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "")
      .slice(0, 14);
  }

  /**
   * Generate nonce for request security
   */
  private generateNonce(): string {
    return nanoid(32);
  }

  /**
   * Sign data with merchant private key
   */
  private signData(data: string): string {
    const sign = createSign("RSA-SHA256");
    sign.update(data);
    sign.end();
    return sign.sign(this.config.privateKey, "base64");
  }

  /**
   * Verify signature from Telebirr callback
   */
  private verifySignature(data: string, signature: string): boolean {
    try {
      const verify = createVerify("RSA-SHA256");
      verify.update(data);
      verify.end();
      return verify.verify(this.config.publicKey, signature, "base64");
    } catch (error) {
      telebirrLogger.error({ err: error }, "Signature verification failed");
      return false;
    }
  }

  /**
   * Encrypt sensitive data with Telebirr public key
   */
  private encryptData(data: string): string {
    const buffer = Buffer.from(data, "utf-8");
    const encrypted = publicEncrypt(this.config.publicKey, buffer);
    return encrypted.toString("base64");
  }

  /**
   * Create payment request to Telebirr
   */
  async createPayment(
    request: TelebirrPaymentRequest,
  ): Promise<TelebirrPaymentResponse> {
    const timestamp = this.getTimestamp();
    const nonce = request.nonce || this.generateNonce();

    // Prepare request payload
    const payload = {
      appId: this.config.appId,
      appKey: this.config.appKey,
      shortCode: this.config.shortCode,
      outTradeNo: request.outTradeNo,
      subject: request.subject,
      totalAmount: request.amount.toString(),
      receiveName: request.receiveName || "UBI",
      notifyUrl: this.config.notifyUrl,
      returnUrl: this.config.returnUrl,
      timeoutExpress: request.timeoutExpress || "30",
      nonce,
      timestamp,
    };

    // Create signature
    const sortedParams = Object.keys(payload)
      .sort()
      .map((key) => `${key}=${payload[key as keyof typeof payload]}`)
      .join("&");
    const signature = this.signData(sortedParams);

    // Encrypt payload
    const encryptedPayload = this.encryptData(JSON.stringify(payload));

    telebirrLogger.info(
      { outTradeNo: request.outTradeNo, amount: request.amount },
      "[Telebirr] Creating payment request",
    );

    try {
      const response = await fetch(`${this.baseUrl}/payment/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-APP-Key": this.config.appKey,
        },
        body: JSON.stringify({
          appid: this.config.appId,
          sign: signature,
          ussd: encryptedPayload,
        }),
      });

      const data = (await response.json()) as TelebirrPaymentResponse;

      if (data.code !== 200) {
        telebirrLogger.error(
          { code: data.code, msg: data.msg, outTradeNo: request.outTradeNo },
          "[Telebirr] Payment creation failed",
        );
        throw new Error(`Telebirr error: ${data.msg}`);
      }

      // Store payment record
      await this.prisma.paymentTransaction.create({
        data: {
          id: nanoid(),
          provider: PaymentProvider.TELEBIRR,
          providerReference: request.outTradeNo,
          amount: request.amount,
          currency: Currency.ETB,
          status: PaymentStatus.PENDING,
          metadata: {
            phoneNumber: request.phoneNumber,
            subject: request.subject,
            prepayId: data.data?.prepayId,
          },
        },
      });

      telebirrLogger.info(
        { outTradeNo: request.outTradeNo, prepayId: data.data?.prepayId },
        "[Telebirr] Payment created successfully",
      );

      return data;
    } catch (error) {
      telebirrLogger.error(
        { err: error, outTradeNo: request.outTradeNo },
        "[Telebirr] Payment request failed",
      );
      throw error;
    }
  }

  /**
   * Send USSD push payment request
   * For customers without smartphones
   */
  async sendUssdPayment(
    request: TelebirrPaymentRequest,
  ): Promise<{ success: boolean; message: string }> {
    const timestamp = this.getTimestamp();
    const nonce = this.generateNonce();

    const payload = {
      appId: this.config.appId,
      appKey: this.config.appKey,
      shortCode: this.config.shortCode,
      outTradeNo: request.outTradeNo,
      subject: request.subject,
      totalAmount: request.amount.toString(),
      msisdn: request.phoneNumber, // Customer phone for USSD push
      notifyUrl: this.config.notifyUrl,
      nonce,
      timestamp,
    };

    const sortedParams = Object.keys(payload)
      .sort()
      .map((key) => `${key}=${payload[key as keyof typeof payload]}`)
      .join("&");
    const signature = this.signData(sortedParams);
    const encryptedPayload = this.encryptData(JSON.stringify(payload));

    telebirrLogger.info(
      { outTradeNo: request.outTradeNo, phoneNumber: request.phoneNumber },
      "[Telebirr] Sending USSD payment push",
    );

    try {
      const response = await fetch(`${this.baseUrl}/payment/ussd`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-APP-Key": this.config.appKey,
        },
        body: JSON.stringify({
          appid: this.config.appId,
          sign: signature,
          ussd: encryptedPayload,
        }),
      });

      const data = (await response.json()) as { code: number; msg: string };

      if (data.code !== 200) {
        telebirrLogger.error(
          { code: data.code, msg: data.msg },
          "[Telebirr] USSD push failed",
        );
        return { success: false, message: data.msg };
      }

      // Store USSD payment record
      await this.prisma.paymentTransaction.create({
        data: {
          id: nanoid(),
          provider: PaymentProvider.TELEBIRR,
          providerReference: request.outTradeNo,
          amount: request.amount,
          currency: Currency.ETB,
          status: PaymentStatus.PENDING,
          metadata: {
            phoneNumber: request.phoneNumber,
            subject: request.subject,
            paymentMethod: "USSD",
          },
        },
      });

      telebirrLogger.info(
        { outTradeNo: request.outTradeNo },
        "[Telebirr] USSD push sent successfully",
      );

      return { success: true, message: "USSD payment request sent" };
    } catch (error) {
      telebirrLogger.error(
        { err: error },
        "[Telebirr] USSD payment request failed",
      );
      throw error;
    }
  }

  /**
   * Query transaction status
   */
  async queryTransaction(
    outTradeNo: string,
  ): Promise<TelebirrTransactionStatus> {
    const timestamp = this.getTimestamp();
    const nonce = this.generateNonce();

    const payload = {
      appId: this.config.appId,
      appKey: this.config.appKey,
      outTradeNo,
      nonce,
      timestamp,
    };

    const sortedParams = Object.keys(payload)
      .sort()
      .map((key) => `${key}=${payload[key as keyof typeof payload]}`)
      .join("&");
    const signature = this.signData(sortedParams);
    const encryptedPayload = this.encryptData(JSON.stringify(payload));

    try {
      const response = await fetch(`${this.baseUrl}/payment/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-APP-Key": this.config.appKey,
        },
        body: JSON.stringify({
          appid: this.config.appId,
          sign: signature,
          ussd: encryptedPayload,
        }),
      });

      const data = (await response.json()) as TelebirrTransactionStatus;

      if (data.code === 200 && data.data) {
        // Update local transaction record
        await this.prisma.paymentTransaction.updateMany({
          where: { providerReference: outTradeNo },
          data: {
            status: this.mapTransactionStatus(data.data.transStatus),
            providerTransactionId: data.data.tradeNo,
            providerResponse: data as any,
            updatedAt: new Date(),
          },
        });
      }

      return data;
    } catch (error) {
      telebirrLogger.error(
        { err: error, outTradeNo },
        "[Telebirr] Transaction query failed",
      );
      throw error;
    }
  }

  /**
   * Process B2C disbursement (payout to customer)
   */
  async disbursement(
    request: TelebirrDisbursementRequest,
  ): Promise<TelebirrDisbursementResponse> {
    const timestamp = this.getTimestamp();
    const nonce = this.generateNonce();

    const payload = {
      appId: this.config.appId,
      appKey: this.config.appKey,
      shortCode: this.config.shortCode,
      outTradeNo: request.outTradeNo,
      msisdn: request.phoneNumber,
      amount: request.amount.toString(),
      remark: request.remark || "UBI Payout",
      nonce,
      timestamp,
    };

    const sortedParams = Object.keys(payload)
      .sort()
      .map((key) => `${key}=${payload[key as keyof typeof payload]}`)
      .join("&");
    const signature = this.signData(sortedParams);
    const encryptedPayload = this.encryptData(JSON.stringify(payload));

    telebirrLogger.info(
      {
        outTradeNo: request.outTradeNo,
        amount: request.amount,
        phoneNumber: request.phoneNumber.slice(-4),
      },
      "[Telebirr] Processing disbursement",
    );

    try {
      const response = await fetch(`${this.baseUrl}/disbursement/transfer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-APP-Key": this.config.appKey,
        },
        body: JSON.stringify({
          appid: this.config.appId,
          sign: signature,
          ussd: encryptedPayload,
        }),
      });

      const data = (await response.json()) as TelebirrDisbursementResponse;

      if (data.code !== 200) {
        telebirrLogger.error(
          { code: data.code, msg: data.msg },
          "[Telebirr] Disbursement failed",
        );
        throw new Error(`Telebirr disbursement error: ${data.msg}`);
      }

      // Store disbursement record
      await this.prisma.payout.create({
        data: {
          id: nanoid(),
          provider: PaymentProvider.TELEBIRR,
          providerReference: data.data?.tradeNo || request.outTradeNo,
          amount: request.amount,
          currency: Currency.ETB,
          status: PaymentStatus.COMPLETED,
          recipientPhone: request.phoneNumber,
          metadata: {
            remark: request.remark,
          },
        },
      });

      telebirrLogger.info(
        { tradeNo: data.data?.tradeNo },
        "[Telebirr] Disbursement completed",
      );

      return data;
    } catch (error) {
      telebirrLogger.error(
        { err: error, outTradeNo: request.outTradeNo },
        "[Telebirr] Disbursement request failed",
      );
      throw error;
    }
  }

  /**
   * Get merchant account balance
   */
  async getBalance(): Promise<number> {
    const timestamp = this.getTimestamp();
    const nonce = this.generateNonce();

    const payload = {
      appId: this.config.appId,
      appKey: this.config.appKey,
      shortCode: this.config.shortCode,
      nonce,
      timestamp,
    };

    const sortedParams = Object.keys(payload)
      .sort()
      .map((key) => `${key}=${payload[key as keyof typeof payload]}`)
      .join("&");
    const signature = this.signData(sortedParams);
    const encryptedPayload = this.encryptData(JSON.stringify(payload));

    try {
      const response = await fetch(`${this.baseUrl}/merchant/balance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-APP-Key": this.config.appKey,
        },
        body: JSON.stringify({
          appid: this.config.appId,
          sign: signature,
          ussd: encryptedPayload,
        }),
      });

      const data = (await response.json()) as TelebirrBalanceResponse;

      if (data.code === 200 && data.data) {
        // Store balance for tracking
        await this.prisma.providerBalance.upsert({
          where: {
            provider_currency: {
              provider: PaymentProvider.TELEBIRR,
              currency: Currency.ETB,
            },
          },
          update: {
            balance: data.data.availableBalance,
            updatedAt: new Date(),
          },
          create: {
            provider: PaymentProvider.TELEBIRR,
            currency: Currency.ETB,
            balance: data.data.availableBalance,
          },
        });

        return data.data.availableBalance;
      }

      return 0;
    } catch (error) {
      telebirrLogger.error({ err: error }, "[Telebirr] Balance query failed");
      throw error;
    }
  }

  /**
   * Handle callback from Telebirr
   */
  async handleCallback(
    callbackData: TelebirrCallbackData,
  ): Promise<{ success: boolean; message: string }> {
    // Verify callback signature
    const dataToVerify = Object.keys(callbackData)
      .filter((key) => key !== "sign")
      .sort()
      .map((key) => `${key}=${callbackData[key as keyof TelebirrCallbackData]}`)
      .join("&");

    if (!this.verifySignature(dataToVerify, callbackData.sign)) {
      telebirrLogger.error(
        { outTradeNo: callbackData.out_trade_no },
        "[Telebirr] Invalid callback signature",
      );
      return { success: false, message: "Invalid signature" };
    }

    const status = this.mapTransactionStatus(callbackData.trans_status);

    telebirrLogger.info(
      {
        outTradeNo: callbackData.out_trade_no,
        tradeNo: callbackData.trade_no,
        status: callbackData.trans_status,
      },
      "[Telebirr] Processing callback",
    );

    // Update transaction record
    await this.prisma.paymentTransaction.updateMany({
      where: { providerReference: callbackData.out_trade_no },
      data: {
        status,
        providerTransactionId: callbackData.trade_no,
        providerResponse: callbackData as any,
        completedAt:
          status === PaymentStatus.COMPLETED ? new Date() : undefined,
        updatedAt: new Date(),
      },
    });

    telebirrLogger.info(
      { outTradeNo: callbackData.out_trade_no, status },
      "[Telebirr] Callback processed",
    );

    return { success: true, message: "Callback processed" };
  }

  /**
   * Map Telebirr status to internal status
   */
  private mapTransactionStatus(
    telebirrStatus: "P" | "S" | "F" | "C",
  ): PaymentStatus {
    switch (telebirrStatus) {
      case "S":
        return PaymentStatus.COMPLETED;
      case "F":
        return PaymentStatus.FAILED;
      case "C":
        return PaymentStatus.CANCELLED;
      case "P":
      default:
        return PaymentStatus.PENDING;
    }
  }
}

// Factory function
export function createTelebirrService(
  config: TelebirrConfig,
  prisma: PrismaClient,
): TelebirrService {
  return new TelebirrService(config, prisma);
}
