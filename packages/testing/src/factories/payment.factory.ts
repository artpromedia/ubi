/**
 * Payment Factory
 *
 * Creates test payment methods, transactions, and wallet data.
 * Includes African mobile money providers.
 */

import { faker } from "@faker-js/faker";
import type { TestPaymentMethod, TestTransaction } from "../types";
import { CURRENCIES, PHONE_FORMATS, randomPick, uuid } from "../utils";

// African mobile money providers
const MOBILE_MONEY_PROVIDERS = [
  { id: "mpesa", name: "M-Pesa", countries: ["KE", "TZ", "GH", "ZA"] },
  {
    id: "mtn_momo",
    name: "MTN Mobile Money",
    countries: ["GH", "NG", "UG", "RW"],
  },
  {
    id: "airtel_money",
    name: "Airtel Money",
    countries: ["KE", "UG", "TZ", "NG"],
  },
  { id: "opay", name: "OPay", countries: ["NG"] },
  {
    id: "chipper_cash",
    name: "Chipper Cash",
    countries: ["NG", "GH", "KE", "UG", "TZ", "RW", "ZA"],
  },
  {
    id: "flutterwave",
    name: "Flutterwave",
    countries: ["NG", "GH", "KE", "ZA"],
  },
  { id: "tigopesa", name: "Tigo Pesa", countries: ["TZ", "GH"] },
  { id: "ecocash", name: "EcoCash", countries: ["ZW"] },
];

const CARD_BRANDS = ["visa", "mastercard", "verve"];

const TRANSACTION_TYPES = [
  "ride_payment",
  "food_payment",
  "delivery_payment",
  "wallet_topup",
  "wallet_withdrawal",
  "refund",
  "driver_payout",
  "restaurant_payout",
] as const;

type TransactionType = (typeof TRANSACTION_TYPES)[number];

interface PaymentMethodFactoryOptions {
  type?: "card" | "mobile_money" | "bank_account" | "wallet";
  country?: string;
  isDefault?: boolean;
}

interface TransactionFactoryOptions {
  type?: TransactionType;
  status?: "pending" | "completed" | "failed" | "refunded";
  currency?: string;
  amount?: number;
}

interface WalletFactoryOptions {
  currency?: string;
  balance?: number;
}

/**
 * Generate a phone number for mobile money
 */
function generateMobileMoneyPhone(country: string): string {
  const format = PHONE_FORMATS[country] || PHONE_FORMATS.NG;
  const number = format.format.replace(/X/g, () =>
    Math.floor(Math.random() * 10).toString()
  );
  return `${format.code}${number}`;
}

/**
 * Generate a card number (test card)
 */
function generateTestCardNumber(brand: string): string {
  const prefixes: Record<string, string> = {
    visa: "4",
    mastercard: "5",
    verve: "5061",
  };
  const prefix = prefixes[brand] || "4";
  const remaining = 16 - prefix.length;
  let number = prefix;
  for (let i = 0; i < remaining; i++) {
    number += Math.floor(Math.random() * 10).toString();
  }
  return number;
}

/**
 * Create a test payment method
 */
export function createPaymentMethod(
  options: PaymentMethodFactoryOptions = {}
): TestPaymentMethod {
  const {
    type = randomPick(["card", "mobile_money"]),
    country = "NG",
    isDefault = false,
  } = options;

  const baseMethod = {
    id: uuid(),
    type,
    isDefault,
    createdAt: faker.date.past(),
  };

  switch (type) {
    case "card": {
      const brand = randomPick(CARD_BRANDS);
      const cardNumber = generateTestCardNumber(brand);
      return {
        ...baseMethod,
        type: "card",
        card: {
          brand,
          last4: cardNumber.slice(-4),
          expiryMonth: faker.number.int({ min: 1, max: 12 }),
          expiryYear: faker.number.int({ min: 2025, max: 2030 }),
          cardholderName: faker.person.fullName().toUpperCase(),
          fingerprint: faker.string.alphanumeric({ length: 32 }),
          // Test card numbers for different scenarios
          testCardNumber: cardNumber,
        },
      };
    }

    case "mobile_money": {
      const availableProviders = MOBILE_MONEY_PROVIDERS.filter((p) =>
        p.countries.includes(country)
      );
      const provider = randomPick(
        availableProviders.length > 0
          ? availableProviders
          : MOBILE_MONEY_PROVIDERS
      );
      return {
        ...baseMethod,
        type: "mobile_money",
        mobileMoney: {
          provider: provider.id,
          providerName: provider.name,
          phoneNumber: generateMobileMoneyPhone(country),
          accountName: faker.person.fullName(),
        },
      };
    }

    case "bank_account": {
      const banks: Record<string, string[]> = {
        NG: ["GTBank", "First Bank", "Access Bank", "Zenith Bank", "UBA"],
        KE: ["Equity Bank", "KCB", "Cooperative Bank", "NCBA", "Stanbic"],
        GH: ["GCB Bank", "Ecobank", "Fidelity Bank", "Stanbic Ghana"],
      };
      const countryBanks = banks[country] || banks.NG;
      return {
        ...baseMethod,
        type: "bank_account",
        bankAccount: {
          bankName: randomPick(countryBanks),
          accountNumber: faker.finance.accountNumber(10),
          accountName: faker.person.fullName(),
          bankCode: faker.string.numeric({ length: 3 }),
        },
      };
    }

    case "wallet": {
      return {
        ...baseMethod,
        type: "wallet",
        wallet: {
          balance: faker.number.int({ min: 0, max: 100000 }),
          currency: country === "NG" ? "NGN" : country === "KE" ? "KES" : "GHS",
        },
      };
    }

    default:
      return baseMethod as TestPaymentMethod;
  }
}

/**
 * Create a test transaction
 */
export function createTransaction(
  options: TransactionFactoryOptions = {}
): TestTransaction {
  const {
    type = randomPick([...TRANSACTION_TYPES]),
    status = "completed",
    currency = "NGN",
    amount = faker.number.int({ min: 500, max: 50000 }),
  } = options;

  const currencyData = CURRENCIES[currency] || CURRENCIES.NGN;

  const transaction: TestTransaction = {
    id: uuid(),
    reference: `TXN-${faker.string.alphanumeric({ length: 12 }).toUpperCase()}`,
    type,
    status,
    amount,
    currency,
    currencySymbol: currencyData.symbol,
    description: getTransactionDescription(type),
    createdAt: faker.date.past(),
    updatedAt: new Date(),
  };

  // Add type-specific fields
  switch (type) {
    case "ride_payment":
    case "food_payment":
    case "delivery_payment":
      transaction.orderId = uuid();
      transaction.userId = uuid();
      transaction.paymentMethod = createPaymentMethod();
      break;

    case "wallet_topup":
      transaction.userId = uuid();
      transaction.paymentMethod = createPaymentMethod({ type: "card" });
      break;

    case "wallet_withdrawal":
      transaction.userId = uuid();
      transaction.paymentMethod = createPaymentMethod({ type: "bank_account" });
      break;

    case "refund":
      transaction.originalTransactionId = uuid();
      transaction.userId = uuid();
      transaction.reason = randomPick([
        "Order cancelled",
        "Item unavailable",
        "Customer complaint",
        "Duplicate charge",
      ]);
      break;

    case "driver_payout":
    case "restaurant_payout":
      transaction.recipientId = uuid();
      transaction.paymentMethod = createPaymentMethod({ type: "bank_account" });
      break;
  }

  // Add status-specific fields
  if (status === "completed") {
    transaction.completedAt = new Date();
    transaction.gatewayReference = faker.string.alphanumeric({ length: 24 });
  } else if (status === "failed") {
    transaction.failedAt = new Date();
    transaction.failureReason = randomPick([
      "Insufficient funds",
      "Card declined",
      "Network error",
      "Invalid OTP",
      "Transaction timeout",
    ]);
  }

  return transaction;
}

/**
 * Get transaction description based on type
 */
function getTransactionDescription(type: TransactionType): string {
  const descriptions: Record<TransactionType, string[]> = {
    ride_payment: ["Ride payment", "Trip fare", "Ride booking"],
    food_payment: ["Food order payment", "Restaurant order", "Meal delivery"],
    delivery_payment: ["Package delivery", "Delivery fee", "Shipping payment"],
    wallet_topup: ["Wallet top-up", "Add funds", "Balance recharge"],
    wallet_withdrawal: ["Withdrawal to bank", "Cash out", "Transfer to bank"],
    refund: ["Order refund", "Trip refund", "Cancellation refund"],
    driver_payout: ["Driver earnings", "Weekly payout", "Trip earnings"],
    restaurant_payout: [
      "Restaurant settlement",
      "Order settlement",
      "Weekly payout",
    ],
  };
  return randomPick(descriptions[type]);
}

/**
 * Create a user wallet
 */
export function createWallet(options: WalletFactoryOptions = {}) {
  const {
    currency = "NGN",
    balance = faker.number.int({ min: 0, max: 100000 }),
  } = options;
  const currencyData = CURRENCIES[currency] || CURRENCIES.NGN;

  return {
    id: uuid(),
    userId: uuid(),
    balance,
    currency,
    currencySymbol: currencyData.symbol,
    isActive: true,
    lastTopUpAt: faker.date.recent(),
    createdAt: faker.date.past(),
  };
}

/**
 * Create multiple payment methods
 */
export function createPaymentMethods(
  count: number,
  options?: PaymentMethodFactoryOptions
): TestPaymentMethod[] {
  return Array.from({ length: count }, (_, i) =>
    createPaymentMethod({ ...options, isDefault: i === 0 })
  );
}

/**
 * Create multiple transactions
 */
export function createTransactions(
  count: number,
  options?: TransactionFactoryOptions
): TestTransaction[] {
  return Array.from({ length: count }, () => createTransaction(options));
}

/**
 * Create a transaction history for a user
 */
export function createTransactionHistory(
  userId: string,
  count: number = 20
): TestTransaction[] {
  return Array.from({ length: count }, (_, i) => {
    const transaction = createTransaction({
      type: randomPick(["ride_payment", "food_payment", "wallet_topup"]),
      status: randomPick(["completed", "completed", "completed", "failed"]), // 75% success rate
    });
    transaction.userId = userId;
    transaction.createdAt = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    return transaction;
  });
}

/**
 * Create test payment provider tokens
 */
export const TEST_PAYMENT_TOKENS = {
  // Paystack test tokens
  paystack: {
    publicKey: "pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    secretKey: "sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    successCard: "4084084084084081",
    failureCard: "4084080000000409",
    webhookSecret: "whsec_test_xxxxxxxxxxxxx",
  },

  // Flutterwave test tokens
  flutterwave: {
    publicKey: "FLWPUBK_TEST-xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    secretKey: "FLWSECK_TEST-xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    encryptionKey: "FLWSECK_TESTxxxxxxxxxxxx",
    successCard: "4187427415564246",
    failureCard: "4000000000000002",
  },

  // M-Pesa test tokens
  mpesa: {
    consumerKey: "test_consumer_key",
    consumerSecret: "test_consumer_secret",
    passKey: "test_pass_key",
    shortCode: "174379",
    testPhone: "+254708374149",
  },
};
