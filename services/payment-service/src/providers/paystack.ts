/**
 * Paystack Payment Provider Client
 *
 * Handles payments in Nigeria and other African countries
 * https://paystack.com
 */

import { Currency } from "../types";

interface PaystackConfig {
  secretKey: string;
  publicKey: string;
  baseUrl: string;
}

interface PaystackResponse<T = any> {
  status: boolean;
  message: string;
  data: T;
}

interface InitializeTransactionParams {
  email: string;
  amount: number; // in kobo (NGN smallest unit)
  reference?: string;
  callback_url?: string;
  metadata?: Record<string, any>;
  currency?: string;
  channels?: (
    | "card"
    | "bank"
    | "ussd"
    | "qr"
    | "mobile_money"
    | "bank_transfer"
  )[];
}

interface VerifyTransactionResponse {
  id: number;
  domain: string;
  status: "success" | "failed" | "abandoned";
  reference: string;
  amount: number;
  gateway_response: string;
  paid_at: string;
  channel: string;
  currency: string;
  ip_address: string;
  metadata: Record<string, any>;
  authorization: {
    authorization_code: string;
    bin: string;
    last4: string;
    exp_month: string;
    exp_year: string;
    channel: string;
    card_type: string;
    bank: string;
    country_code: string;
    brand: string;
    reusable: boolean;
    signature: string;
  };
  customer: {
    id: number;
    email: string;
    customer_code: string;
    first_name: string;
    last_name: string;
    phone: string;
  };
}

interface CreateTransferRecipientParams {
  type: "nuban" | "mobile_money" | "basa" | "authorization";
  name: string;
  account_number: string;
  bank_code: string;
  currency?: string;
  description?: string;
  metadata?: Record<string, any>;
}

interface InitiateTransferParams {
  source: string;
  amount: number;
  recipient: string;
  reason?: string;
  reference?: string;
}

export class PaystackClient {
  private config: PaystackConfig;

  constructor() {
    this.config = {
      secretKey: process.env.PAYSTACK_SECRET_KEY || "",
      publicKey: process.env.PAYSTACK_PUBLIC_KEY || "",
      baseUrl: "https://api.paystack.co",
    };
  }

  private async request<T>(
    endpoint: string,
    method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
    body?: any,
  ): Promise<PaystackResponse<T>> {
    const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = (await response.json()) as PaystackResponse<T>;

    if (!response.ok) {
      throw new Error(data.message || "Paystack API error");
    }

    return data;
  }

  /**
   * Initialize a transaction
   */
  async initializeTransaction(params: InitializeTransactionParams): Promise<
    PaystackResponse<{
      authorization_url: string;
      access_code: string;
      reference: string;
    }>
  > {
    return this.request("/transaction/initialize", "POST", params);
  }

  /**
   * Verify a transaction
   */
  async verifyTransaction(
    reference: string,
  ): Promise<PaystackResponse<VerifyTransactionResponse>> {
    return this.request(`/transaction/verify/${reference}`);
  }

  /**
   * Charge an authorization (recurring payment)
   */
  async chargeAuthorization(params: {
    email: string;
    amount: number;
    authorization_code: string;
    reference?: string;
    metadata?: Record<string, any>;
  }): Promise<PaystackResponse<VerifyTransactionResponse>> {
    return this.request("/transaction/charge_authorization", "POST", params);
  }

  /**
   * Submit OTP for card payment
   */
  async submitOtp(
    reference: string,
    otp: string,
  ): Promise<PaystackResponse<any>> {
    return this.request("/transaction/submit_otp", "POST", {
      reference,
      otp,
    });
  }

  /**
   * Submit PIN for card payment
   */
  async submitPin(
    reference: string,
    pin: string,
  ): Promise<PaystackResponse<any>> {
    return this.request("/transaction/submit_pin", "POST", {
      reference,
      pin,
    });
  }

  /**
   * Get list of banks
   */
  async listBanks(country: string = "nigeria"): Promise<
    PaystackResponse<
      {
        name: string;
        slug: string;
        code: string;
        longcode: string;
        country: string;
        currency: string;
        type: string;
      }[]
    >
  > {
    return this.request(`/bank?country=${country}`);
  }

  /**
   * Resolve account number
   */
  async resolveAccount(
    accountNumber: string,
    bankCode: string,
  ): Promise<
    PaystackResponse<{
      account_number: string;
      account_name: string;
      bank_id: number;
    }>
  > {
    return this.request(
      `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
    );
  }

  /**
   * Create a transfer recipient
   */
  async createTransferRecipient(params: CreateTransferRecipientParams): Promise<
    PaystackResponse<{
      active: boolean;
      createdAt: string;
      currency: string;
      domain: string;
      id: number;
      integration: number;
      name: string;
      recipient_code: string;
      type: string;
      updatedAt: string;
      is_deleted: boolean;
      details: {
        authorization_code: string | null;
        account_number: string;
        account_name: string;
        bank_code: string;
        bank_name: string;
      };
    }>
  > {
    return this.request("/transferrecipient", "POST", params);
  }

  /**
   * Initiate a transfer (payout)
   */
  async initiateTransfer(params: InitiateTransferParams): Promise<
    PaystackResponse<{
      reference: string;
      integration: number;
      domain: string;
      amount: number;
      currency: string;
      source: string;
      reason: string;
      recipient: number;
      status: string;
      transfer_code: string;
      id: number;
      createdAt: string;
      updatedAt: string;
    }>
  > {
    return this.request("/transfer", "POST", params);
  }

  /**
   * Finalize a transfer (for OTP-enabled accounts)
   */
  async finalizeTransfer(
    transferCode: string,
    otp: string,
  ): Promise<PaystackResponse<any>> {
    return this.request("/transfer/finalize_transfer", "POST", {
      transfer_code: transferCode,
      otp,
    });
  }

  /**
   * Verify a transfer
   */
  async verifyTransfer(reference: string): Promise<PaystackResponse<any>> {
    return this.request(`/transfer/verify/${reference}`);
  }

  /**
   * Initiate a refund
   */
  async initiateRefund(
    reference: string,
    amount?: number,
  ): Promise<
    PaystackResponse<{
      transaction: number;
      amount: number;
      currency: string;
      status: string;
      refund_reason: string;
      customer_note: string;
      merchant_note: string;
      integration: number;
      domain: string;
      deducted_amount: number;
      id: number;
      createdAt: string;
    }>
  > {
    const body: any = { transaction: reference };
    if (amount) {
      body.amount = amount;
    }

    return this.request("/refund", "POST", body);
  }

  /**
   * Get supported currencies
   */
  static getSupportedCurrencies(): Currency[] {
    return [Currency.NGN, Currency.GHS, Currency.ZAR, Currency.KES];
  }

  /**
   * Convert amount to smallest unit (kobo, pesewas, cents)
   */
  static toSmallestUnit(amount: number, _currency: Currency): number {
    // All supported currencies use 100 subunits
    return Math.round(amount * 100);
  }

  /**
   * Convert from smallest unit to main unit
   */
  static fromSmallestUnit(amount: number, _currency: Currency): number {
    return amount / 100;
  }
}
