/**
 * Paystack Payment Service (Nigeria, Ghana, South Africa, Kenya)
 *
 * Implements Paystack API for card payments across Africa.
 *
 * Key Features:
 * - Initialize transaction (hosted payment page)
 * - Charge authorization (saved cards)
 * - Webhook verification (HMAC signature)
 * - 3D Secure support
 * - Card tokenization
 * - Recurring payments
 * - Multi-currency support
 *
 * Flow:
 * 1. Initialize transaction → Get authorization URL
 * 2. Customer redirected to Paystack page
 * 3. Customer enters card details
 * 4. Paystack processes payment (with 3DS if needed)
 * 5. Webhook callback received
 * 6. Verify transaction
 *
 * Error Handling:
 * - Invalid card → Return clear error message
 * - Insufficient funds → Fail gracefully
import { paystackLogger } from "../lib/logger";
 * - 3DS failure → Redirect to bank
 * - Webhook signature mismatch → Reject
 */

import { PaymentProvider, PaymentStatus, PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { paystackLogger } from "../lib/logger.js";

export interface PaystackConfig {
  secretKey: string;
  publicKey: string;
  webhookSecret: string;
  environment: "test" | "live";
}

export interface PaystackInitializeRequest {
  email: string;
  amount: number; // In kobo (₦) or pesewas (GHS) or cents
  currency: "NGN" | "GHS" | "ZAR" | "KES" | "USD";
  reference: string; // Unique transaction reference
  callbackUrl?: string;
  metadata?: Record<string, any>;
  channels?: Array<
    "card" | "bank" | "ussd" | "qr" | "mobile_money" | "bank_transfer"
  >;
}

export interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

export interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: {
    id: number;
    domain: string;
    status: "success" | "failed" | "abandoned";
    reference: string;
    amount: number;
    message: string | null;
    gateway_response: string;
    paid_at: string | null;
    created_at: string;
    channel: string;
    currency: string;
    ip_address: string;
    metadata: Record<string, any>;
    fees: number;
    customer: {
      id: number;
      email: string;
      customer_code: string;
    };
    authorization: {
      authorization_code: string;
      bin: string; // First 6 digits
      last4: string; // Last 4 digits
      exp_month: string;
      exp_year: string;
      channel: string;
      card_type: string;
      bank: string;
      country_code: string;
      brand: string;
      reusable: boolean;
      signature: string;
      account_name: string | null;
    };
  };
}

export interface PaystackChargeAuthorizationRequest {
  email: string;
  amount: number; // In kobo/pesewas/cents
  authorizationCode: string; // From previous transaction
  reference: string;
  metadata?: Record<string, any>;
}

export interface PaystackChargeAuthorizationResponse {
  status: boolean;
  message: string;
  data: {
    amount: number;
    currency: string;
    transaction_date: string;
    status: "success" | "failed" | "pending";
    reference: string;
    domain: string;
    metadata: Record<string, any>;
    gateway_response: string;
    message: string | null;
    channel: string;
    ip_address: string;
    fees: number;
    authorization: {
      authorization_code: string;
      bin: string;
      last4: string;
      exp_month: string;
      exp_year: string;
      card_type: string;
      bank: string;
      country_code: string;
      brand: string;
      reusable: boolean;
    };
  };
}

export interface PaystackWebhookPayload {
  event: string; // "charge.success", "charge.failed", etc.
  data: any;
}

export interface PaystackTransferRecipient {
  type: "nuban" | "mobile_money" | "basa"; // nuban = bank account, basa = Ghanaian bank
  name: string; // Recipient name
  account_number: string; // Account number or mobile money number
  bank_code: string; // Bank code (e.g., "058" for GTBank Nigeria)
  currency: "NGN" | "GHS" | "ZAR" | "KES";
  metadata?: Record<string, any>;
}

export interface PaystackCreateRecipientResponse {
  status: boolean;
  message: string;
  data: {
    active: boolean;
    createdAt: string;
    currency: string;
    domain: string;
    id: number;
    integration: number;
    name: string;
    recipient_code: string; // Use this for transfer
    type: string;
    updatedAt: string;
    is_deleted: boolean;
    details: {
      authorization_code: string | null;
      account_number: string;
      account_name: string | null;
      bank_code: string;
      bank_name: string;
    };
  };
}

export interface PaystackInitiateTransferRequest {
  source: "balance"; // Always "balance" for payouts
  amount: number; // In kobo/pesewas/cents
  recipient: string; // recipient_code from createRecipient
  reason: string; // Purpose of transfer
  currency?: "NGN" | "GHS" | "ZAR" | "KES";
  reference?: string; // Unique reference
}

export interface PaystackInitiateTransferResponse {
  status: boolean;
  message: string;
  data: {
    integration: number;
    domain: string;
    amount: number;
    currency: string;
    source: string;
    reason: string;
    recipient: number;
    status: "pending" | "success" | "failed" | "reversed";
    transfer_code: string; // Transfer reference
    id: number;
    createdAt: string;
    updatedAt: string;
  };
}

export interface PaystackVerifyTransferResponse {
  status: boolean;
  message: string;
  data: {
    amount: number;
    createdAt: string;
    currency: string;
    domain: string;
    failures: any;
    id: number;
    integration: number;
    reason: string;
    reference: string;
    source: string;
    source_details: any;
    status: "pending" | "success" | "failed" | "reversed";
    titan_code: string;
    transfer_code: string;
    transferred_at: string | null;
    updatedAt: string;
    recipient: {
      active: boolean;
      currency: string;
      description: string;
      domain: string;
      email: string | null;
      id: number;
      integration: number;
      metadata: any;
      name: string;
      recipient_code: string;
      type: string;
    };
    session: {
      provider: string | null;
      id: string | null;
    };
  };
}

export class PaystackService {
  private baseUrl: string;

  constructor(
    private config: PaystackConfig,
    private prisma: PrismaClient,
  ) {
    this.baseUrl = "https://api.paystack.co";
  }

  /**
   * Make authenticated request to Paystack API
   */
  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    const data = (await response.json()) as {
      status?: boolean;
      message?: string;
    };

    if (!response.ok || !data.status) {
      throw new Error(`Paystack API error: ${data.message || "Unknown error"}`);
    }

    return data as T;
  }

  /**
   * Convert amount to kobo/pesewas/cents (smallest currency unit)
   * Paystack expects amounts in kobo (1 Naira = 100 kobo)
   */
  private toSubunit(amount: number, _currency: string): number {
    // All supported currencies use 100 subunits
    return Math.round(amount * 100);
  }

  /**
   * Convert from kobo/pesewas/cents to main currency unit
   */
  private fromSubunit(amount: number, _currency: string): number {
    return amount / 100;
  }

  /**
   * Initialize transaction (hosted payment page)
   * Customer will be redirected to Paystack to enter card details
   */
  async initializeTransaction(
    request: PaystackInitializeRequest,
  ): Promise<PaystackInitializeResponse> {
    const payload = {
      email: request.email,
      amount: this.toSubunit(request.amount, request.currency),
      currency: request.currency,
      reference: request.reference,
      callback_url: request.callbackUrl,
      metadata: request.metadata,
      channels: request.channels,
    };

    const response = await this.makeRequest<PaystackInitializeResponse>(
      "/transaction/initialize",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );

    return response;
  }

  /**
   * Verify transaction
   * ALWAYS call this after receiving webhook to confirm payment
   */
  async verifyTransaction(reference: string): Promise<PaystackVerifyResponse> {
    const response = await this.makeRequest<PaystackVerifyResponse>(
      `/transaction/verify/${reference}`,
      {
        method: "GET",
      },
    );

    return response;
  }

  /**
   * Charge authorization (saved card)
   * Use for recurring payments or subsequent charges
   */
  async chargeAuthorization(
    request: PaystackChargeAuthorizationRequest,
  ): Promise<PaystackChargeAuthorizationResponse> {
    const authCodeParts = request.authorizationCode.split("_");
    const currency = authCodeParts[0] || "NGN";

    const payload = {
      email: request.email,
      amount: this.toSubunit(request.amount, currency),
      authorization_code: request.authorizationCode,
      reference: request.reference,
      metadata: request.metadata,
    };

    const response =
      await this.makeRequest<PaystackChargeAuthorizationResponse>(
        "/transaction/charge_authorization",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );

    return response;
  }

  /**
   * Create a refund for a transaction
   * https://paystack.com/docs/api/refund/#create
   */
  async createRefund(request: {
    transactionReference: string;
    amount?: number; // Optional - partial refund amount in main currency unit
    currency?: string;
    customerNote?: string;
    merchantNote?: string;
  }): Promise<{
    status: boolean;
    message: string;
    data: {
      id: number;
      integration: number;
      domain: string;
      transaction: number;
      dispute: number | null;
      amount: number;
      deducted_amount: number;
      currency: string;
      channel: string;
      fully_deducted: boolean;
      refunded_by: string;
      refunded_at: string;
      expected_at: string;
      settlement: any;
      customer_note: string;
      merchant_note: string;
      created_at: string;
      updated_at: string;
      status: "pending" | "processed" | "processing" | "failed";
    };
  }> {
    const payload: Record<string, unknown> = {
      transaction: request.transactionReference,
    };

    if (request.amount) {
      payload.amount = this.toSubunit(
        request.amount,
        request.currency || "NGN",
      );
    }
    if (request.customerNote) {
      payload.customer_note = request.customerNote;
    }
    if (request.merchantNote) {
      payload.merchant_note = request.merchantNote;
    }

    const response = await this.makeRequest<{
      status: boolean;
      message: string;
      data: {
        id: number;
        integration: number;
        domain: string;
        transaction: number;
        dispute: number | null;
        amount: number;
        deducted_amount: number;
        currency: string;
        channel: string;
        fully_deducted: boolean;
        refunded_by: string;
        refunded_at: string;
        expected_at: string;
        settlement: any;
        customer_note: string;
        merchant_note: string;
        created_at: string;
        updated_at: string;
        status: "pending" | "processed" | "processing" | "failed";
      };
    }>("/refund", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    paystackLogger.info(
      {
        transactionRef: request.transactionReference,
        refundId: response.data?.id,
      },
      "Paystack refund created",
    );

    return response;
  }

  /**
   * Fetch a refund by ID
   */
  async getRefund(refundId: string): Promise<{
    status: boolean;
    message: string;
    data: {
      id: number;
      amount: number;
      currency: string;
      status: string;
      transaction: number;
    };
  }> {
    return this.makeRequest(`/refund/${refundId}`, { method: "GET" });
  }

  /**
   * Verify webhook signature
   * CRITICAL: Always verify webhook signature to prevent fraud
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    const hash = crypto
      .createHmac("sha512", this.config.webhookSecret)
      .update(payload)
      .digest("hex");

    return hash === signature;
  }

  /**
   * Handle webhook event
   */
  async handleWebhook(
    payload: PaystackWebhookPayload,
    signature: string,
  ): Promise<void> {
    // Verify signature
    const payloadString = JSON.stringify(payload);
    if (!this.verifyWebhookSignature(payloadString, signature)) {
      throw new Error("Invalid webhook signature");
    }

    const { event, data } = payload;

    // Log webhook for debugging
    await this.prisma.webhookEvent.create({
      data: {
        provider: PaymentProvider.PAYSTACK,
        eventId: data.reference || data.id?.toString() || crypto.randomUUID(),
        eventType: event,
        payload: payload as any,
        processed: false,
      },
    });

    // Handle different event types
    switch (event) {
      case "charge.success":
        await this.handleChargeSuccess(data);
        break;

      case "charge.failed":
        await this.handleChargeFailed(data);
        break;

      case "transfer.success":
      case "transfer.failed":
      case "transfer.reversed":
        // Handle payout events
        break;

      default:
        paystackLogger.info({ event }, "Unhandled Paystack webhook event");
    }
  }

  /**
   * Handle successful charge webhook
   */
  private async handleChargeSuccess(data: any): Promise<void> {
    const reference = data.reference;

    // Find payment transaction
    const paymentTx = await this.prisma.paymentTransaction.findFirst({
      where: {
        provider: PaymentProvider.PAYSTACK,
        metadata: {
          path: ["paystackReference"],
          equals: reference,
        },
      },
    });

    if (!paymentTx) {
      paystackLogger.warn(
        { reference },
        "Payment transaction not found for Paystack reference",
      );
      return;
    }

    // Already processed
    if (paymentTx.status !== PaymentStatus.PENDING) {
      paystackLogger.info(
        `Payment transaction ${paymentTx.id} already processed (status: ${paymentTx.status})`,
      );
      return;
    }

    // Verify transaction with Paystack API (CRITICAL: don't trust webhook alone)
    const verification = await this.verifyTransaction(reference);

    if (verification.data.status === "success") {
      // Save authorization for future charges
      if (verification.data.authorization.reusable) {
        await this.savePaymentMethod(
          paymentTx.userId,
          verification.data.authorization,
        );
      }

      await this.prisma.paymentTransaction.update({
        where: { id: paymentTx.id },
        data: {
          status: PaymentStatus.COMPLETED,
          confirmedAt: new Date(),
          providerReference: data.id.toString(),
          providerResponse: verification.data,
          webhookReceived: true,
        },
      });

      // Mark webhook as processed
      await this.prisma.webhookEvent.updateMany({
        where: {
          eventId: reference,
          provider: PaymentProvider.PAYSTACK,
        },
        data: {
          processed: true,
          processedAt: new Date(),
        },
      });

      paystackLogger.info(
        {
          paymentId: paymentTx.id,
          currency: verification.data.currency,
          amount: this.fromSubunit(
            verification.data.amount,
            verification.data.currency,
          ),
        },
        "Paystack payment completed",
      );
    }
  }

  /**
   * Handle failed charge webhook
   */
  private async handleChargeFailed(data: any): Promise<void> {
    const reference = data.reference;

    // Find payment transaction
    const paymentTx = await this.prisma.paymentTransaction.findFirst({
      where: {
        provider: PaymentProvider.PAYSTACK,
        metadata: {
          path: ["paystackReference"],
          equals: reference,
        },
      },
    });

    if (!paymentTx) {
      paystackLogger.warn(
        { reference },
        "Payment transaction not found for Paystack reference",
      );
      return;
    }

    // Already processed
    if (paymentTx.status !== PaymentStatus.PENDING) {
      paystackLogger.info(
        { paymentId: paymentTx.id, status: paymentTx.status },
        "Payment transaction already processed",
      );
      return;
    }

    await this.prisma.paymentTransaction.update({
      where: { id: paymentTx.id },
      data: {
        status: PaymentStatus.FAILED,
        failedAt: new Date(),
        failureReason: data.gateway_response || "Payment failed",
        providerResponse: data,
        webhookReceived: true,
      },
    });

    // Mark webhook as processed
    await this.prisma.webhookEvent.updateMany({
      where: {
        eventId: reference,
        provider: PaymentProvider.PAYSTACK,
      },
      data: {
        processed: true,
        processedAt: new Date(),
      },
    });

    paystackLogger.info(
      { paymentId: paymentTx.id, reason: data.gateway_response },
      "Paystack payment failed",
    );
  }

  /**
   * Save payment method (tokenized card)
   */
  private async savePaymentMethod(
    userId: string,
    authorization: any,
  ): Promise<void> {
    // Check if already saved
    const existing = await this.prisma.paymentMethodRecord.findFirst({
      where: {
        userId,
        provider: PaymentProvider.PAYSTACK,
        providerMethodId: authorization.authorization_code,
      },
    });

    if (existing) {
      return; // Already saved
    }

    await this.prisma.paymentMethodRecord.create({
      data: {
        userId,
        provider: PaymentProvider.PAYSTACK,
        providerMethodId: authorization.authorization_code,
        type: "CARD",
        lastFour: authorization.last4,
        expiryMonth: parseInt(authorization.exp_month),
        expiryYear: parseInt(authorization.exp_year),
        cardBrand: authorization.brand,
        cardBank: authorization.bank,
        isDefault: false, // User can set default later
        metadata: {
          bin: authorization.bin,
          cardType: authorization.card_type,
          countryCode: authorization.country_code,
        },
      },
    });

    paystackLogger.info(
      { userId, brand: authorization.brand, last4: authorization.last4 },
      "Saved payment method for user",
    );
  }

  /**
   * Initiate hosted payment
   */
  async initiatePayment(params: {
    userId: string;
    email: string;
    amount: number;
    currency: "NGN" | "GHS" | "ZAR" | "KES" | "USD";
    transactionId: string;
    description?: string;
    callbackUrl?: string;
  }): Promise<{
    paymentTransactionId: string;
    authorizationUrl: string;
    reference: string;
  }> {
    const {
      userId,
      email,
      amount,
      currency,
      transactionId,
      description,
      callbackUrl,
    } = params;

    // Initialize transaction
    const initResponse = await this.initializeTransaction({
      email,
      amount,
      currency,
      reference: transactionId,
      callbackUrl,
      metadata: {
        userId,
        description: description || "UBI Payment",
      },
      channels: ["card"], // Only cards for now
    });

    // Create payment transaction record
    const paymentTx = await this.prisma.paymentTransaction.create({
      data: {
        userId,
        provider: PaymentProvider.PAYSTACK,
        amount,
        currency,
        status: PaymentStatus.PENDING,
        metadata: {
          email,
          transactionId,
          paystackReference: initResponse.data.reference,
          paystackAccessCode: initResponse.data.access_code,
        },
      },
    });

    return {
      paymentTransactionId: paymentTx.id,
      authorizationUrl: initResponse.data.authorization_url,
      reference: initResponse.data.reference,
    };
  }

  /**
   * Charge saved card
   */
  async chargeSavedCard(params: {
    userId: string;
    paymentMethodId: string;
    amount: number;
    transactionId: string;
    description?: string;
  }): Promise<{
    paymentTransactionId: string;
    status: "success" | "pending" | "failed";
  }> {
    const { userId, paymentMethodId, amount, transactionId, description } =
      params;

    // Get payment method
    const paymentMethod = await this.prisma.paymentMethodRecord.findUnique({
      where: { id: paymentMethodId },
      include: { user: true },
    });

    if (!paymentMethod || paymentMethod.userId !== userId) {
      throw new Error("Payment method not found");
    }

    if (paymentMethod.provider !== PaymentProvider.PAYSTACK) {
      throw new Error("Invalid payment method provider");
    }

    // Get currency from authorization code or default to NGN
    const authCode = paymentMethod.providerMethodId;
    const currency = authCode.includes("_") ? authCode.split("_")[0] : "NGN";

    // Charge authorization
    const chargeResponse = await this.chargeAuthorization({
      email: paymentMethod.user.email,
      amount,
      authorizationCode: paymentMethod.providerMethodId,
      reference: transactionId,
      metadata: {
        userId,
        description: description || "UBI Payment",
        currency,
      },
    });

    // Create payment transaction record
    const paymentTx = await this.prisma.paymentTransaction.create({
      data: {
        userId,
        provider: PaymentProvider.PAYSTACK,
        amount,
        currency: chargeResponse.data.currency,
        status:
          chargeResponse.data.status === "success"
            ? PaymentStatus.COMPLETED
            : chargeResponse.data.status === "failed"
              ? PaymentStatus.FAILED
              : PaymentStatus.PENDING,
        confirmedAt:
          chargeResponse.data.status === "success" ? new Date() : null,
        failedAt: chargeResponse.data.status === "failed" ? new Date() : null,
        failureReason:
          chargeResponse.data.status === "failed"
            ? chargeResponse.data.gateway_response
            : null,
        providerReference: chargeResponse.data.reference,
        providerResponse: chargeResponse.data,
        metadata: {
          transactionId,
          paystackReference: chargeResponse.data.reference,
          paymentMethodId,
        },
      },
    });

    return {
      paymentTransactionId: paymentTx.id,
      status: chargeResponse.data.status,
    };
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
   * List saved payment methods for user
   */
  async listPaymentMethods(userId: string): Promise<
    Array<{
      id: string;
      type: string;
      lastFour: string;
      expiryMonth: number;
      expiryYear: number;
      cardBrand?: string;
      isDefault: boolean;
    }>
  > {
    const methods = await this.prisma.paymentMethodRecord.findMany({
      where: {
        userId,
        provider: PaymentProvider.PAYSTACK,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return methods.map((method) => ({
      id: method.id,
      type: method.type,
      lastFour: method.lastFour,
      expiryMonth: method.expiryMonth,
      expiryYear: method.expiryYear,
      cardBrand: method.cardBrand || undefined,
      isDefault: method.isDefault,
    }));
  }

  /**
   * Create transfer recipient
   * Must be done before initiating transfer
   */
  async createTransferRecipient(
    recipient: PaystackTransferRecipient,
  ): Promise<PaystackCreateRecipientResponse> {
    const response = await fetch(`${this.baseUrl}/transferrecipient`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(recipient),
    });

    const data = (await response.json()) as PaystackCreateRecipientResponse;

    if (!data.status) {
      throw new Error(
        `Failed to create Paystack transfer recipient: ${data.message}`,
      );
    }

    return data;
  }

  /**
   * Initiate transfer (payout)
   * Sends money from Paystack balance to recipient account
   */
  async initiateTransfer(
    request: PaystackInitiateTransferRequest,
  ): Promise<PaystackInitiateTransferResponse> {
    if (request.amount <= 0) {
      throw new Error("Transfer amount must be positive");
    }

    const response = await fetch(`${this.baseUrl}/transfer`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    const data = (await response.json()) as PaystackInitiateTransferResponse;

    if (!data.status) {
      throw new Error(`Failed to initiate Paystack transfer: ${data.message}`);
    }

    return data;
  }

  /**
   * Verify transfer status
   */
  async verifyTransfer(
    reference: string,
  ): Promise<PaystackVerifyTransferResponse> {
    const response = await fetch(
      `${this.baseUrl}/transfer/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${this.config.secretKey}`,
        },
      },
    );

    const data = (await response.json()) as PaystackVerifyTransferResponse;

    if (!data.status) {
      throw new Error(`Failed to verify Paystack transfer: ${data.message}`);
    }

    return data;
  }

  /**
   * Complete payout using Paystack transfer
   * Creates recipient and initiates transfer in one flow
   */
  async completePayout(
    payoutId: string,
    recipient: {
      name: string;
      accountNumber: string;
      bankCode: string;
      type: "nuban" | "mobile_money" | "basa";
    },
    amount: number,
    currency: "NGN" | "GHS" | "ZAR" | "KES",
    reason: string,
  ): Promise<{ transferCode: string; recipientCode: string }> {
    try {
      // Step 1: Create transfer recipient
      const recipientResponse = await this.createTransferRecipient({
        type: recipient.type,
        name: recipient.name,
        account_number: recipient.accountNumber,
        bank_code: recipient.bankCode,
        currency,
        metadata: {
          payoutId,
        },
      });

      const recipientCode = recipientResponse.data.recipient_code;

      // Step 2: Initiate transfer
      const transferResponse = await this.initiateTransfer({
        source: "balance",
        amount: Math.round(amount * 100), // Convert to kobo/pesewas
        recipient: recipientCode,
        reason,
        currency,
        reference: payoutId, // Use payoutId as reference
      });

      return {
        transferCode: transferResponse.data.transfer_code,
        recipientCode,
      };
    } catch (error) {
      paystackLogger.error(
        { err: error, payoutId },
        "Failed to complete Paystack payout",
      );
      throw error;
    }
  }

  /**
   * Handle transfer webhook
   * Called when transfer status changes
   */
  async handleTransferWebhook(
    payload: PaystackWebhookPayload,
    signature: string,
  ): Promise<void> {
    // Verify webhook signature
    if (!this.verifyWebhookSignature(JSON.stringify(payload), signature)) {
      throw new Error("Invalid webhook signature");
    }

    const { event, data } = payload;

    // Only handle transfer events
    if (!event.startsWith("transfer.")) {
      return;
    }

    const transferCode = data.transfer_code;
    const reference = data.reference; // This is our payoutId

    try {
      if (event === "transfer.success") {
        // Transfer completed successfully
        await this.prisma.payout.update({
          where: { id: reference },
          data: {
            status: "COMPLETED",
            providerReference: transferCode,
            completedAt: new Date(),
            providerMetadata: {
              transferCode,
              amount: data.amount,
              currency: data.currency,
              recipient: data.recipient,
              transferredAt: data.transferred_at,
            },
          },
        });

        paystackLogger.info(
          { reference },
          "Paystack transfer completed successfully",
        );
      } else if (event === "transfer.failed") {
        // Transfer failed
        await this.prisma.payout.update({
          where: { id: reference },
          data: {
            status: "FAILED",
            failedAt: new Date(),
            failureReason: data.reason || "Transfer failed",
            providerMetadata: {
              transferCode,
              failures: data.failures,
            },
          },
        });

        paystackLogger.error(
          { reference, reason: data.reason },
          "Paystack transfer failed",
        );
      } else if (event === "transfer.reversed") {
        // Transfer reversed (usually due to invalid account)
        await this.prisma.payout.update({
          where: { id: reference },
          data: {
            status: "FAILED",
            failedAt: new Date(),
            failureReason: "Transfer reversed",
            providerMetadata: {
              transferCode,
              reversed: true,
            },
          },
        });

        paystackLogger.warn({ reference }, "Paystack transfer reversed");
      }
    } catch (error) {
      paystackLogger.error(
        { err: error, reference },
        "Failed to process Paystack transfer webhook",
      );
      throw error;
    }
  }

  /**
   * Poll transfer status until completed
   * Use this if webhook is not received
   */
  async pollTransferStatus(
    transferCode: string,
    payoutId: string,
    maxAttempts: number = 20,
    intervalMs: number = 3000,
  ): Promise<void> {
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const result = await this.verifyTransfer(transferCode);
        const status = result.data.status;

        if (status === "success") {
          await this.prisma.payout.update({
            where: { id: payoutId },
            data: {
              status: "COMPLETED",
              providerReference: transferCode,
              completedAt: new Date(),
              providerMetadata: {
                transferCode,
                amount: result.data.amount,
                currency: result.data.currency,
                recipient: result.data.recipient,
                transferredAt: result.data.transferred_at,
              },
            },
          });

          paystackLogger.info(
            `Paystack transfer ${payoutId} completed successfully`,
          );
          return;
        }

        if (status === "failed" || status === "reversed") {
          await this.prisma.payout.update({
            where: { id: payoutId },
            data: {
              status: "FAILED",
              failedAt: new Date(),
              failureReason:
                status === "reversed" ? "Transfer reversed" : "Transfer failed",
              providerMetadata: {
                transferCode,
                failures: result.data.failures,
              },
            },
          });

          paystackLogger.error(`Paystack transfer ${payoutId} ${status}`);
          return;
        }

        // Still pending, wait and retry
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        attempts++;
      } catch (error) {
        paystackLogger.error(
          { err: error, attempt: attempts + 1 },
          "Error polling Paystack transfer status",
        );
        attempts++;

        if (attempts >= maxAttempts) {
          // Mark as failed after max attempts
          await this.prisma.payout.update({
            where: { id: payoutId },
            data: {
              status: "FAILED",
              failedAt: new Date(),
              failureReason: "Transfer status polling timeout",
            },
          });
          throw new Error("Paystack transfer polling timeout");
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
  }
}
