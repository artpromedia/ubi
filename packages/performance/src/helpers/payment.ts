/**
 * Payment Service Helpers
 *
 * API helpers for payment functionality
 */

import { check } from "k6";
import http from "k6/http";
import { getBaseUrl } from "../config";
import { ApiResponse, createHeaders, paymentRequests } from "./http";

export interface PaymentMethod {
  id: string;
  type: "card" | "mobile_money" | "wallet" | "bank_transfer";
  provider?: string;
  lastFour?: string;
  isDefault: boolean;
}

export interface Transaction {
  id: string;
  type: "credit" | "debit";
  amount: number;
  currency: string;
  status: "pending" | "completed" | "failed";
  createdAt: string;
}

export interface Wallet {
  id: string;
  balance: number;
  currency: string;
}

// Get payment methods
export function getPaymentMethods(accessToken: string): PaymentMethod[] | null {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/users/me/payment-methods`;

  const response = http.get(url, {
    headers: createHeaders(accessToken),
  });

  const passed = check(response, {
    "Get payment methods - status is 200": (r) => r.status === 200,
  });

  if (!passed) return null;

  try {
    const body = JSON.parse(response.body as string) as ApiResponse<{
      paymentMethods: PaymentMethod[];
    }>;
    return body.data?.paymentMethods || [];
  } catch {
    return null;
  }
}

// Add payment method
export function addPaymentMethod(
  accessToken: string,
  type: string,
  details: Record<string, string>
): PaymentMethod | null {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/users/me/payment-methods`;

  const response = http.post(url, JSON.stringify({ type, ...details }), {
    headers: createHeaders(accessToken),
  });

  paymentRequests.add(1);

  const passed = check(response, {
    "Add payment method - status is 201": (r) => r.status === 201,
  });

  if (!passed) return null;

  try {
    const body = JSON.parse(response.body as string) as ApiResponse<{
      paymentMethod: PaymentMethod;
    }>;
    return body.data?.paymentMethod || null;
  } catch {
    return null;
  }
}

// Get wallet balance
export function getWalletBalance(accessToken: string): Wallet | null {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/wallets/me`;

  const response = http.get(url, {
    headers: createHeaders(accessToken),
  });

  const passed = check(response, {
    "Get wallet - status is 200": (r) => r.status === 200,
  });

  if (!passed) return null;

  try {
    const body = JSON.parse(response.body as string) as ApiResponse<{
      wallet: Wallet;
    }>;
    return body.data?.wallet || null;
  } catch {
    return null;
  }
}

// Top up wallet
export function topUpWallet(
  accessToken: string,
  amount: number,
  paymentMethodId: string
): Transaction | null {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/wallets/topup`;

  const response = http.post(url, JSON.stringify({ amount, paymentMethodId }), {
    headers: createHeaders(accessToken),
  });

  paymentRequests.add(1);

  const passed = check(response, {
    "Wallet topup - status is 200 or 201": (r) =>
      r.status === 200 || r.status === 201,
  });

  if (!passed) return null;

  try {
    const body = JSON.parse(response.body as string) as ApiResponse<{
      transaction: Transaction;
    }>;
    return body.data?.transaction || null;
  } catch {
    return null;
  }
}

// Initiate payment
export function initiatePayment(
  accessToken: string,
  amount: number,
  currency: string,
  paymentMethodId: string,
  reference: string
): { transactionId: string; status: string } | null {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/payments/initiate`;

  const response = http.post(
    url,
    JSON.stringify({
      amount,
      currency,
      paymentMethodId,
      reference,
    }),
    { headers: createHeaders(accessToken) }
  );

  paymentRequests.add(1);

  const passed = check(response, {
    "Initiate payment - status is 200 or 201": (r) =>
      r.status === 200 || r.status === 201,
  });

  if (!passed) return null;

  try {
    const body = JSON.parse(response.body as string) as ApiResponse<{
      transactionId: string;
      status: string;
    }>;
    return body.data || null;
  } catch {
    return null;
  }
}

// Get transaction history
export function getTransactionHistory(
  accessToken: string,
  page: number = 1,
  limit: number = 20
): Transaction[] | null {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/wallets/me/transactions?page=${page}&limit=${limit}`;

  const response = http.get(url, {
    headers: createHeaders(accessToken),
  });

  const passed = check(response, {
    "Get transactions - status is 200": (r) => r.status === 200,
  });

  if (!passed) return null;

  try {
    const body = JSON.parse(response.body as string) as ApiResponse<{
      transactions: Transaction[];
    }>;
    return body.data?.transactions || [];
  } catch {
    return null;
  }
}

// Verify payment
export function verifyPayment(
  accessToken: string,
  transactionId: string
): { status: string; amount: number } | null {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/payments/${transactionId}/verify`;

  const response = http.get(url, {
    headers: createHeaders(accessToken),
  });

  paymentRequests.add(1);

  const passed = check(response, {
    "Verify payment - status is 200": (r) => r.status === 200,
  });

  if (!passed) return null;

  try {
    const body = JSON.parse(response.body as string) as ApiResponse<{
      status: string;
      amount: number;
    }>;
    return body.data || null;
  } catch {
    return null;
  }
}
