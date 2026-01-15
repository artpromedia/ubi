/**
 * Flutterwave Payment Provider Client
 *
 * Pan-African payment provider supporting multiple countries
 * https://flutterwave.com
 */

import { Currency } from "../types";

interface FlutterwaveConfig {
  secretKey: string;
  publicKey: string;
  encryptionKey: string;
  baseUrl: string;
}

interface FlutterwaveResponse<T = any> {
  status: "success" | "error";
  message: string;
  data: T;
}

interface InitiatePaymentParams {
  tx_ref: string;
  amount: number;
  currency: string;
  redirect_url: string;
  payment_options?: string; // e.g., 'card,mobilemoney,ussd,banktransfer'
  customer: {
    email: string;
    phone_number?: string;
    name?: string;
  };
  customizations?: {
    title?: string;
    description?: string;
    logo?: string;
  };
  meta?: Record<string, any>;
}

interface ChargeCardParams {
  card_number: string;
  cvv: string;
  expiry_month: string;
  expiry_year: string;
  currency: string;
  amount: number;
  email: string;
  fullname: string;
  phone_number?: string;
  tx_ref: string;
  authorization?: {
    mode: "pin" | "avs_noauth" | "redirect";
    pin?: string;
    city?: string;
    address?: string;
    state?: string;
    country?: string;
    zipcode?: string;
  };
}

interface MobileMoneyParams {
  tx_ref: string;
  amount: number;
  currency: string;
  email: string;
  phone_number: string;
  fullname: string;
  network?: string; // MTN, VODAFONE, etc.
  country?: string; // GH, KE, UG, etc.
}

interface TransferParams {
  account_bank: string;
  account_number: string;
  amount: number;
  narration: string;
  currency: string;
  reference?: string;
  callback_url?: string;
  debit_currency?: string;
  beneficiary_name?: string;
}

interface MobileMoneyTransferParams {
  account_bank: string;
  account_number: string; // phone number
  amount: number;
  narration: string;
  currency: string;
  reference?: string;
  beneficiary_name: string;
}

export class FlutterwaveClient {
  private config: FlutterwaveConfig;

  constructor() {
    this.config = {
      secretKey: process.env.FLUTTERWAVE_SECRET_KEY || "",
      publicKey: process.env.FLUTTERWAVE_PUBLIC_KEY || "",
      encryptionKey: process.env.FLUTTERWAVE_ENCRYPTION_KEY || "",
      baseUrl: "https://api.flutterwave.com/v3",
    };
  }

  private async request<T>(
    endpoint: string,
    method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
    body?: any,
  ): Promise<FlutterwaveResponse<T>> {
    const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = (await response.json()) as FlutterwaveResponse<T>;

    if (!response.ok || data.status === "error") {
      throw new Error(data.message || "Flutterwave API error");
    }

    return data;
  }

  /**
   * Create a payment link (Standard payment)
   */
  async initiatePayment(params: InitiatePaymentParams): Promise<
    FlutterwaveResponse<{
      link: string;
    }>
  > {
    return this.request("/payments", "POST", params);
  }

  /**
   * Charge a card directly
   */
  async chargeCard(params: ChargeCardParams): Promise<
    FlutterwaveResponse<{
      id: number;
      tx_ref: string;
      flw_ref: string;
      device_fingerprint: string;
      amount: number;
      charged_amount: number;
      app_fee: number;
      merchant_fee: number;
      processor_response: string;
      auth_model: string;
      currency: string;
      ip: string;
      narration: string;
      status: string;
      auth_url: string;
      payment_type: string;
      fraud_status: string;
      charge_type: string;
      created_at: string;
      account_id: number;
      customer: {
        id: number;
        email: string;
        phone_number: string;
        name: string;
      };
    }>
  > {
    // Encrypt card data
    const encryptedData = this.encryptCardData(params);
    return this.request("/charges?type=card", "POST", {
      client: encryptedData,
    });
  }

  /**
   * Validate card charge (OTP/PIN)
   */
  async validateCharge(
    flwRef: string,
    otp: string,
  ): Promise<FlutterwaveResponse<any>> {
    return this.request("/validate-charge", "POST", {
      otp,
      flw_ref: flwRef,
    });
  }

  /**
   * Charge mobile money (Ghana, Kenya, Uganda, etc.)
   */
  async chargeMobileMoney(params: MobileMoneyParams): Promise<
    FlutterwaveResponse<{
      id: number;
      tx_ref: string;
      flw_ref: string;
      order_ref: string;
      amount: number;
      currency: string;
      status: string;
      payment_type: string;
      fraud_status: string;
      customer: {
        id: number;
        email: string;
        phone_number: string;
        name: string;
      };
      processor_response: string;
    }>
  > {
    let endpoint = "/charges?type=mobile_money_";

    // Determine mobile money type based on currency/country
    if (params.currency === "GHS") {
      endpoint += "ghana";
    } else if (params.currency === "KES") {
      endpoint += "kenya";
    } else if (params.currency === "UGX") {
      endpoint += "uganda";
    } else if (params.currency === "TZS") {
      endpoint += "tanzania";
    } else if (params.currency === "RWF") {
      endpoint += "rwanda";
    } else if (params.currency === "XOF") {
      endpoint += "franco";
    } else {
      throw new Error(
        `Mobile money not supported for currency: ${params.currency}`,
      );
    }

    return this.request(endpoint, "POST", params);
  }

  /**
   * Charge via USSD (Nigeria)
   */
  async chargeUSSD(params: {
    tx_ref: string;
    account_bank: string; // e.g., '058' for GTBank
    amount: number;
    currency: string;
    email: string;
    phone_number: string;
    fullname: string;
  }): Promise<
    FlutterwaveResponse<{
      payment_code: string;
      note: string;
    }>
  > {
    return this.request("/charges?type=ussd", "POST", params);
  }

  /**
   * Verify a transaction
   */
  async verifyTransaction(transactionId: number): Promise<
    FlutterwaveResponse<{
      id: number;
      tx_ref: string;
      flw_ref: string;
      amount: number;
      currency: string;
      charged_amount: number;
      app_fee: number;
      merchant_fee: number;
      processor_response: string;
      status: string;
      payment_type: string;
      created_at: string;
      customer: {
        id: number;
        email: string;
        phone_number: string;
        name: string;
      };
    }>
  > {
    return this.request(`/transactions/${transactionId}/verify`);
  }

  /**
   * Verify transaction by reference
   */
  async verifyByReference(txRef: string): Promise<FlutterwaveResponse<any>> {
    return this.request(`/transactions/verify_by_reference?tx_ref=${txRef}`);
  }

  /**
   * Get list of banks
   */
  async getBanks(country: string = "NG"): Promise<
    FlutterwaveResponse<
      {
        id: number;
        code: string;
        name: string;
      }[]
    >
  > {
    return this.request(`/banks/${country}`);
  }

  /**
   * Resolve account details
   */
  async resolveAccount(
    accountNumber: string,
    accountBank: string,
  ): Promise<
    FlutterwaveResponse<{
      account_number: string;
      account_name: string;
    }>
  > {
    return this.request("/accounts/resolve", "POST", {
      account_number: accountNumber,
      account_bank: accountBank,
    });
  }

  /**
   * Create a transfer (payout to bank)
   */
  async createTransfer(params: TransferParams): Promise<
    FlutterwaveResponse<{
      id: number;
      account_number: string;
      bank_code: string;
      full_name: string;
      created_at: string;
      currency: string;
      amount: number;
      fee: number;
      status: string;
      reference: string;
      narration: string;
      complete_message: string;
      bank_name: string;
    }>
  > {
    return this.request("/transfers", "POST", params);
  }

  /**
   * Create mobile money transfer (payout)
   */
  async createMobileMoneyTransfer(params: MobileMoneyTransferParams): Promise<
    FlutterwaveResponse<{
      id: number;
      status: string;
      reference: string;
      amount: number;
      fee: number;
      currency: string;
    }>
  > {
    return this.request("/transfers", "POST", {
      ...params,
      account_bank: "MPS", // Mobile Money code
    });
  }

  /**
   * Get transfer by ID
   */
  async getTransfer(transferId: number): Promise<FlutterwaveResponse<any>> {
    return this.request(`/transfers/${transferId}`);
  }

  /**
   * Get transfer fee
   */
  async getTransferFee(
    amount: number,
    currency: string,
  ): Promise<
    FlutterwaveResponse<
      {
        currency: string;
        fee_type: string;
        fee: number;
      }[]
    >
  > {
    return this.request(`/transfers/fee?amount=${amount}&currency=${currency}`);
  }

  /**
   * Create a refund
   */
  async createRefund(
    transactionId: number,
    amount?: number,
  ): Promise<
    FlutterwaveResponse<{
      id: number;
      account_id: number;
      tx_id: number;
      flw_ref: string;
      wallet_id: number;
      amount_refunded: number;
      status: string;
      destination: string;
      meta: any;
      created_at: string;
    }>
  > {
    const body: any = { id: transactionId };
    if (amount) {
      body.amount = amount;
    }

    return this.request("/transactions/refund", "POST", body);
  }

  /**
   * Encrypt card data for secure transmission
   */
  private encryptCardData(data: any): string {
    // In production, use proper 3DES encryption
    // This is a placeholder - actual implementation would use crypto
    const crypto = require("crypto");

    const cipher = crypto.createCipheriv(
      "des-ede3",
      this.config.encryptionKey.slice(0, 24),
      "",
    );

    let encrypted = cipher.update(JSON.stringify(data), "utf8", "base64");
    encrypted += cipher.final("base64");

    return encrypted;
  }

  /**
   * Get supported currencies
   */
  static getSupportedCurrencies(): Currency[] {
    return [
      Currency.NGN,
      Currency.GHS,
      Currency.KES,
      Currency.UGX,
      Currency.TZS,
      Currency.ZAR,
      Currency.XOF,
      Currency.USD,
    ];
  }

  /**
   * Get mobile money network codes by country
   */
  static getMobileMoneyNetworks(
    country: string,
  ): { code: string; name: string }[] {
    const networks: Record<string, { code: string; name: string }[]> = {
      GH: [
        { code: "MTN", name: "MTN Mobile Money" },
        { code: "VODAFONE", name: "Vodafone Cash" },
        { code: "TIGO", name: "AirtelTigo Money" },
      ],
      KE: [{ code: "MPESA", name: "M-Pesa" }],
      UG: [
        { code: "MTN", name: "MTN Mobile Money" },
        { code: "AIRTEL", name: "Airtel Money" },
      ],
      TZ: [
        { code: "MPESA", name: "M-Pesa" },
        { code: "TIGOPESA", name: "Tigo Pesa" },
        { code: "AIRTELMONEY", name: "Airtel Money" },
      ],
      RW: [
        { code: "MTN", name: "MTN Mobile Money" },
        { code: "AIRTEL", name: "Airtel Money" },
      ],
    };

    return networks[country] || [];
  }
}
