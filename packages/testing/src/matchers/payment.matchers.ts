/**
 * Payment & Transaction Matchers
 *
 * Custom matchers for validating payments, transactions, and currencies.
 */

import type { TestPaymentMethod, TestTransaction } from "../types";
import { CURRENCIES } from "../utils";

export interface PaymentMatchers<R = unknown> {
  toBeValidPaymentMethod(): R;
  toBeValidTransaction(): R;
  toBeValidCurrency(expectedCurrency?: string): R;
  toBePositiveAmount(): R;
  toBeValidCardNumber(): R;
  toHaveSuccessfulPaymentStatus(): R;
}

const VALID_PAYMENT_TYPES = ["card", "mobile_money", "bank_account", "wallet"];

/**
 * Validate type-specific payment method details
 */
function validatePaymentMethodDetails(pm: TestPaymentMethod): {
  valid: boolean;
  failureDetail: string;
} {
  switch (pm.type) {
    case "card":
      if (
        !(
          pm.card &&
          typeof pm.card.brand === "string" &&
          typeof pm.card.last4 === "string" &&
          pm.card.last4.length === 4
        )
      ) {
        return { valid: false, failureDetail: "Invalid card details" };
      }
      break;
    case "mobile_money":
      if (
        !(
          pm.mobileMoney &&
          typeof pm.mobileMoney.provider === "string" &&
          typeof pm.mobileMoney.phoneNumber === "string"
        )
      ) {
        return { valid: false, failureDetail: "Invalid mobile money details" };
      }
      break;
    case "bank_account":
      if (
        !(
          pm.bankAccount &&
          typeof pm.bankAccount.bankName === "string" &&
          typeof pm.bankAccount.accountNumber === "string"
        )
      ) {
        return { valid: false, failureDetail: "Invalid bank account details" };
      }
      break;
  }
  return { valid: true, failureDetail: "" };
}

/**
 * Check if object is a valid payment method
 */
export function toBeValidPaymentMethod(received: unknown) {
  const pm = received as TestPaymentMethod;

  const isValidBase =
    pm &&
    typeof pm === "object" &&
    typeof pm.id === "string" &&
    pm.id.length > 0 &&
    VALID_PAYMENT_TYPES.includes(pm.type) &&
    typeof pm.isDefault === "boolean";

  const { valid: detailsValid, failureDetail } = isValidBase
    ? validatePaymentMethodDetails(pm)
    : { valid: true, failureDetail: "" };

  const pass = isValidBase && detailsValid;

  return {
    pass,
    message: () => {
      if (pass) {
        return `Expected ${JSON.stringify(received)} not to be a valid payment method`;
      }
      const baseMsg = `Expected valid payment method with { id, type: ${VALID_PAYMENT_TYPES.join("|")}, isDefault }`;
      return failureDetail ? `${baseMsg}. ${failureDetail}` : baseMsg;
    },
  };
}

/**
 * Check if object is a valid transaction
 */
export function toBeValidTransaction(received: unknown) {
  const txn = received as TestTransaction;

  const validTypes = [
    "ride_payment",
    "food_payment",
    "delivery_payment",
    "wallet_topup",
    "wallet_withdrawal",
    "refund",
    "driver_payout",
    "restaurant_payout",
  ];

  const validStatuses = ["pending", "completed", "failed", "refunded"];

  const pass = !!(
    txn &&
    typeof txn === "object" &&
    typeof txn.id === "string" &&
    typeof txn.referenceId === "string" &&
    validTypes.includes(txn.type) &&
    validStatuses.includes(txn.status) &&
    typeof txn.amount === "number" &&
    typeof txn.currency === "string" &&
    txn.createdAt instanceof Date
  );

  return {
    pass,
    message: () =>
      pass
        ? `Expected ${JSON.stringify(received)} not to be a valid transaction`
        : `Expected valid transaction with { id, referenceId, type, status, amount, currency, createdAt }`,
  };
}

/**
 * Check if value is a valid currency
 */
export function toBeValidCurrency(
  received: unknown,
  expectedCurrency?: string
) {
  const currency = received as string;
  const validCurrencies = Object.keys(CURRENCIES);

  let pass = typeof currency === "string" && validCurrencies.includes(currency);

  if (pass && expectedCurrency) {
    pass = currency === expectedCurrency;
  }

  return {
    pass,
    message: () => {
      if (pass) {
        return `Expected ${currency} not to be a valid currency`;
      }
      if (expectedCurrency) {
        return `Expected currency to be ${expectedCurrency}, but got ${currency}`;
      }
      return `Expected valid currency (${validCurrencies.join(", ")}), but got ${currency}`;
    },
  };
}

/**
 * Check if amount is positive
 */
export function toBePositiveAmount(received: unknown) {
  const amount = received as number;

  const pass =
    typeof amount === "number" &&
    amount > 0 &&
    !Number.isNaN(amount) &&
    Number.isFinite(amount);

  return {
    pass,
    message: () =>
      pass
        ? `Expected ${amount} not to be a positive amount`
        : `Expected positive number, but got ${amount}`,
  };
}

/**
 * Check if string is a valid test card number
 */
export function toBeValidCardNumber(received: unknown) {
  const cardNumber = received as string;

  if (typeof cardNumber !== "string") {
    return {
      pass: false,
      message: () => `Expected string, got ${typeof cardNumber}`,
    };
  }

  // Remove spaces and dashes
  const cleaned = cardNumber.replaceAll(/[\s-]/g, "");

  // Check length (13-19 digits for most cards)
  if (!/^\d{13,19}$/.test(cleaned)) {
    return {
      pass: false,
      message: () =>
        `Expected card number to be 13-19 digits, got ${cleaned.length} digits`,
    };
  }

  // Luhn algorithm validation
  let sum = 0;
  let isEven = false;

  for (let i = cleaned.length - 1; i >= 0; i--) {
    const char = cleaned[i];
    if (!char) continue;
    let digit = Number.parseInt(char, 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    isEven = !isEven;
  }

  const pass = sum % 10 === 0;

  return {
    pass,
    message: () =>
      pass
        ? `Expected ${cardNumber} not to be a valid card number`
        : `Expected valid card number (Luhn check failed)`,
  };
}

/**
 * Check if transaction has successful payment status
 */
export function toHaveSuccessfulPaymentStatus(received: unknown) {
  const txn = received as TestTransaction;

  const pass =
    txn &&
    typeof txn === "object" &&
    txn.status === "completed" &&
    txn.completedAt instanceof Date;

  return {
    pass,
    message: () =>
      pass
        ? `Expected transaction not to have successful status`
        : `Expected transaction to have status 'completed' with completedAt date, but got status '${txn?.status}'`,
  };
}

/**
 * Payment matchers object for extending expect
 */
export const paymentMatchers = {
  toBeValidPaymentMethod,
  toBeValidTransaction,
  toBeValidCurrency,
  toBePositiveAmount,
  toBeValidCardNumber,
  toHaveSuccessfulPaymentStatus,
};
