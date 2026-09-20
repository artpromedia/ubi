/**
 * Payment Service API
 *
 * API client for payment operations.
 */

import { type ApiClient, getApiClient } from "../client";

import type {
  PaginatedResponse,
  PaginationParams,
  ApiResponse,
  Timestamps,
  Money,
} from "../types";

// Payment types
export type PaymentStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "refunded"
  | "cancelled";

export type PaymentType =
  | "ride"
  | "food_order"
  | "delivery"
  | "wallet_topup"
  | "subscription";

export type PaymentMethodType =
  | "card"
  | "mobile_money"
  | "bank_transfer"
  | "wallet"
  | "cash";

export interface Payment extends Timestamps {
  id: string;
  userId: string;
  type: PaymentType;
  referenceId: string; // ride_id, order_id, etc.
  status: PaymentStatus;
  amount: Money;
  fee?: Money;
  netAmount?: Money;
  paymentMethod: {
    type: PaymentMethodType;
    provider?: string;
    last4?: string;
  };
  description?: string;
  metadata?: Record<string, unknown>;
  failureReason?: string;
  refundedAt?: string;
  refundReason?: string;
}

export interface PaymentMethodDetails extends Timestamps {
  id: string;
  type: PaymentMethodType;
  provider?: string;
  last4?: string;
  brand?: string; // visa, mastercard, etc.
  expiryMonth?: number;
  expiryYear?: number;
  holderName?: string;
  isDefault: boolean;
  isExpired?: boolean;
}

export interface Wallet extends Timestamps {
  id: string;
  userId: string;
  balance: Money;
  pendingBalance: Money;
  isActive: boolean;
  lastTransactionAt?: string;
}

export interface WalletTransaction extends Timestamps {
  id: string;
  walletId: string;
  type: "credit" | "debit";
  amount: Money;
  balance: Money; // balance after transaction
  reference?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

// Request/Response types
export interface InitiatePaymentRequest {
  type: PaymentType;
  referenceId: string;
  amount: number;
  currency: string;
  paymentMethodId?: string;
  paymentMethodType?: PaymentMethodType;
  returnUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface InitiatePaymentResponse {
  paymentId: string;
  status: PaymentStatus;
  requiresAction: boolean;
  actionUrl?: string;
  clientSecret?: string;
}

export interface AddPaymentMethodRequest {
  type: PaymentMethodType;
  provider?: string;
  token?: string; // from payment provider
  setDefault?: boolean;
}

export interface TopUpWalletRequest {
  amount: number;
  currency: string;
  paymentMethodId?: string;
}

export interface TransferRequest {
  recipientId: string;
  amount: number;
  currency: string;
  description?: string;
}

export interface PaymentFilters extends PaginationParams {
  type?: PaymentType;
  status?: PaymentStatus;
  dateFrom?: string;
  dateTo?: string;
}

export interface WalletTransactionFilters extends PaginationParams {
  type?: "credit" | "debit";
  dateFrom?: string;
  dateTo?: string;
}

// Payment Service API
export class PaymentServiceApi {
  private client: ApiClient;
  private basePath = "payments";

  constructor(client?: ApiClient) {
    this.client = client ?? getApiClient();
  }

  // Payments
  async initiatePayment(
    data: InitiatePaymentRequest,
  ): Promise<ApiResponse<InitiatePaymentResponse>> {
    return this.client.post(this.basePath, data);
  }

  async getPayment(id: string): Promise<ApiResponse<Payment>> {
    return this.client.get(`${this.basePath}/${id}`);
  }

  async getPaymentHistory(
    filters?: PaymentFilters,
  ): Promise<PaginatedResponse<Payment>> {
    return this.client.get(this.basePath, { searchParams: filters as any });
  }

  async confirmPayment(id: string): Promise<ApiResponse<Payment>> {
    return this.client.post(`${this.basePath}/${id}/confirm`);
  }

  async cancelPayment(id: string): Promise<ApiResponse<Payment>> {
    return this.client.post(`${this.basePath}/${id}/cancel`);
  }

  async requestRefund(
    id: string,
    reason?: string,
  ): Promise<ApiResponse<Payment>> {
    return this.client.post(`${this.basePath}/${id}/refund`, { reason });
  }

  // Payment methods
  async getPaymentMethods(): Promise<ApiResponse<PaymentMethodDetails[]>> {
    return this.client.get(`${this.basePath}/methods`);
  }

  async addPaymentMethod(
    data: AddPaymentMethodRequest,
  ): Promise<ApiResponse<PaymentMethodDetails>> {
    return this.client.post(`${this.basePath}/methods`, data);
  }

  async removePaymentMethod(id: string): Promise<ApiResponse<void>> {
    return this.client.delete(`${this.basePath}/methods/${id}`);
  }

  async setDefaultPaymentMethod(
    id: string,
  ): Promise<ApiResponse<PaymentMethodDetails>> {
    return this.client.post(`${this.basePath}/methods/${id}/default`);
  }

  async verifyPaymentMethod(
    id: string,
    amounts: number[],
  ): Promise<ApiResponse<boolean>> {
    return this.client.post(`${this.basePath}/methods/${id}/verify`, {
      amounts,
    });
  }

  // Wallet
  async getWallet(): Promise<ApiResponse<Wallet>> {
    return this.client.get(`${this.basePath}/wallet`);
  }

  async topUpWallet(
    data: TopUpWalletRequest,
  ): Promise<ApiResponse<InitiatePaymentResponse>> {
    return this.client.post(`${this.basePath}/wallet/topup`, data);
  }

  async getWalletTransactions(
    filters?: WalletTransactionFilters,
  ): Promise<PaginatedResponse<WalletTransaction>> {
    return this.client.get(`${this.basePath}/wallet/transactions`, {
      searchParams: filters as any,
    });
  }

  async transferFromWallet(
    data: TransferRequest,
  ): Promise<ApiResponse<WalletTransaction>> {
    return this.client.post(`${this.basePath}/wallet/transfer`, data);
  }

  // Promo codes
  async validatePromoCode(
    code: string,
    context: { type: PaymentType; amount: number },
  ): Promise<
    ApiResponse<{ valid: boolean; discount?: Money; message?: string }>
  > {
    return this.client.post(`${this.basePath}/promo/validate`, {
      code,
      ...context,
    });
  }

  // Mobile money specific
  async initiateMobileMoneyPayment(data: {
    provider: string;
    phone: string;
    amount: number;
    currency: string;
    referenceId: string;
    type: PaymentType;
  }): Promise<
    ApiResponse<{ paymentId: string; ussdCode?: string; promptSent: boolean }>
  > {
    return this.client.post(`${this.basePath}/mobile-money`, data);
  }

  async checkMobileMoneyStatus(
    paymentId: string,
  ): Promise<ApiResponse<Payment>> {
    return this.client.get(`${this.basePath}/mobile-money/${paymentId}/status`);
  }

  // Payment providers (for setup/config)
  async getAvailableProviders(): Promise<
    ApiResponse<
      {
        type: PaymentMethodType;
        providers: { id: string; name: string; logoUrl?: string }[];
      }[]
    >
  > {
    return this.client.get(`${this.basePath}/providers`);
  }

  // Admin/Reporting
  async getPaymentStats(
    dateFrom: string,
    dateTo: string,
  ): Promise<ApiResponse<PaymentStats>> {
    return this.client.get(`${this.basePath}/stats`, {
      searchParams: { dateFrom, dateTo },
    });
  }
}

export interface PaymentStats {
  totalTransactions: number;
  totalVolume: Money;
  completedTransactions: number;
  failedTransactions: number;
  refundedAmount: Money;
  averageTransactionValue: Money;
  byPaymentMethod: Record<PaymentMethodType, { count: number; volume: Money }>;
  byPaymentType: Record<PaymentType, { count: number; volume: Money }>;
}

// Export singleton instance
let paymentServiceApi: PaymentServiceApi | null = null;

export function getPaymentServiceApi(): PaymentServiceApi {
  if (!paymentServiceApi) {
    paymentServiceApi = new PaymentServiceApi();
  }
  return paymentServiceApi;
}
