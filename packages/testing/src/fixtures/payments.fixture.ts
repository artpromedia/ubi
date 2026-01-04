/**
 * Payment Fixtures
 *
 * Pre-defined test payment methods, transactions, and test tokens.
 */

import type { TestPaymentMethod, TestTransaction } from "../types";
import { TEST_RIDERS } from "./users.fixture";

/**
 * Test payment methods
 */
export const TEST_PAYMENT_METHODS: Record<string, TestPaymentMethod> = {
  // Nigerian Mobile Money
  OPAY_WALLET: {
    id: "pm_opay_001",
    type: "mobile_money",
    isDefault: true,
    createdAt: new Date("2024-01-15"),
    mobileMoney: {
      provider: "opay",
      providerName: "OPay",
      phoneNumber: "+2348066666666",
      accountName: "Adaobi Eze",
    },
  },

  // Kenyan M-Pesa
  MPESA_WALLET: {
    id: "pm_mpesa_001",
    type: "mobile_money",
    isDefault: true,
    createdAt: new Date("2024-02-10"),
    mobileMoney: {
      provider: "mpesa",
      providerName: "M-Pesa",
      phoneNumber: "+254722222222",
      accountName: "Njeri Wanjiru",
    },
  },

  // MTN Mobile Money (Ghana/Nigeria)
  MTN_MOMO: {
    id: "pm_mtn_001",
    type: "mobile_money",
    isDefault: false,
    createdAt: new Date("2024-03-01"),
    mobileMoney: {
      provider: "mtn_momo",
      providerName: "MTN Mobile Money",
      phoneNumber: "+233244123456",
      accountName: "Kofi Mensah",
    },
  },

  // Verve Card (Nigerian)
  VERVE_CARD: {
    id: "pm_card_verve_001",
    type: "card",
    isDefault: false,
    createdAt: new Date("2024-01-20"),
    card: {
      brand: "verve",
      last4: "1234",
      expiryMonth: 12,
      expiryYear: 2026,
      cardholderName: "ADAOBI EZE",
      fingerprint: "fp_verve_abc123",
      testCardNumber: "5061240000000000001", // Test card
    },
  },

  // Visa Card
  VISA_CARD: {
    id: "pm_card_visa_001",
    type: "card",
    isDefault: false,
    createdAt: new Date("2024-02-15"),
    card: {
      brand: "visa",
      last4: "4242",
      expiryMonth: 8,
      expiryYear: 2027,
      cardholderName: "CHUKWUEMEKA OKONKWO",
      fingerprint: "fp_visa_def456",
      testCardNumber: "4084084084084081", // Paystack test success card
    },
  },

  // Mastercard
  MASTERCARD: {
    id: "pm_card_mc_001",
    type: "card",
    isDefault: false,
    createdAt: new Date("2024-03-10"),
    card: {
      brand: "mastercard",
      last4: "5100",
      expiryMonth: 6,
      expiryYear: 2028,
      cardholderName: "WANJIKU KAMAU",
      fingerprint: "fp_mc_ghi789",
      testCardNumber: "5399838383838381", // Test card
    },
  },

  // Bank Account (for payouts)
  GTB_ACCOUNT: {
    id: "pm_bank_gtb_001",
    type: "bank_account",
    isDefault: false,
    createdAt: new Date("2024-01-01"),
    bankAccount: {
      bankName: "GTBank",
      accountNumber: "0123456789",
      accountName: "Emeka Nwosu",
      bankCode: "058",
    },
  },

  // Equity Bank (Kenya)
  EQUITY_ACCOUNT: {
    id: "pm_bank_equity_001",
    type: "bank_account",
    isDefault: false,
    createdAt: new Date("2024-02-01"),
    bankAccount: {
      bankName: "Equity Bank",
      accountNumber: "1234567890123",
      accountName: "Kamau Mwangi",
      bankCode: "68",
    },
  },
};

/**
 * Test transactions
 */
export const TEST_TRANSACTIONS: Record<string, TestTransaction> = {
  // Successful ride payment
  RIDE_PAYMENT_SUCCESS: {
    id: "txn_ride_001",
    reference: "TXN-RIDE001ABC",
    type: "ride_payment",
    status: "completed",
    amount: 2500,
    currency: "NGN",
    currencySymbol: "₦",
    description: "Ride payment - Victoria Island to Ikeja",
    orderId: "ride_completed_001",
    userId: TEST_RIDERS.ADAOBI_RIDER.id,
    paymentMethod: TEST_PAYMENT_METHODS.OPAY_WALLET,
    completedAt: new Date("2024-06-01T11:02:30Z"),
    gatewayReference: "PAY_abcdef123456",
    createdAt: new Date("2024-06-01T11:02:00Z"),
    updatedAt: new Date("2024-06-01T11:02:30Z"),
  },

  // Failed card payment
  CARD_PAYMENT_FAILED: {
    id: "txn_failed_001",
    reference: "TXN-FAIL001XYZ",
    type: "ride_payment",
    status: "failed",
    amount: 3500,
    currency: "NGN",
    currencySymbol: "₦",
    description: "Ride payment - Lekki to Airport",
    orderId: "ride_failed_001",
    userId: TEST_RIDERS.ADAOBI_RIDER.id,
    paymentMethod: TEST_PAYMENT_METHODS.VERVE_CARD,
    failedAt: new Date("2024-06-01T15:30:00Z"),
    failureReason: "Insufficient funds",
    createdAt: new Date("2024-06-01T15:29:30Z"),
    updatedAt: new Date("2024-06-01T15:30:00Z"),
  },

  // Wallet top-up
  WALLET_TOPUP: {
    id: "txn_topup_001",
    reference: "TXN-TOPUP001DEF",
    type: "wallet_topup",
    status: "completed",
    amount: 10000,
    currency: "NGN",
    currencySymbol: "₦",
    description: "Wallet top-up",
    userId: TEST_RIDERS.ADAOBI_RIDER.id,
    paymentMethod: TEST_PAYMENT_METHODS.VISA_CARD,
    completedAt: new Date("2024-06-01T09:00:30Z"),
    gatewayReference: "PAY_topup_xyz789",
    createdAt: new Date("2024-06-01T09:00:00Z"),
    updatedAt: new Date("2024-06-01T09:00:30Z"),
  },

  // Food order payment (M-Pesa)
  FOOD_PAYMENT_MPESA: {
    id: "txn_food_001",
    reference: "TXN-FOOD001GHI",
    type: "food_payment",
    status: "completed",
    amount: 883,
    currency: "KES",
    currencySymbol: "KSh",
    description: "Food order - Java House",
    orderId: "order_001",
    userId: TEST_RIDERS.NJERI_RIDER.id,
    paymentMethod: TEST_PAYMENT_METHODS.MPESA_WALLET,
    completedAt: new Date("2024-06-01T12:01:00Z"),
    gatewayReference: "MPESA_ABC123XYZ",
    createdAt: new Date("2024-06-01T12:00:30Z"),
    updatedAt: new Date("2024-06-01T12:01:00Z"),
  },

  // Refund transaction
  REFUND: {
    id: "txn_refund_001",
    reference: "TXN-REFUND001JKL",
    type: "refund",
    status: "completed",
    amount: 1500,
    currency: "NGN",
    currencySymbol: "₦",
    description: "Order refund - Cancelled order",
    userId: TEST_RIDERS.ADAOBI_RIDER.id,
    originalTransactionId: "txn_original_001",
    reason: "Order cancelled by restaurant",
    completedAt: new Date("2024-06-01T14:30:00Z"),
    createdAt: new Date("2024-06-01T14:29:00Z"),
    updatedAt: new Date("2024-06-01T14:30:00Z"),
  },

  // Driver payout
  DRIVER_PAYOUT: {
    id: "txn_payout_001",
    reference: "TXN-PAYOUT001MNO",
    type: "driver_payout",
    status: "completed",
    amount: 45000,
    currency: "NGN",
    currencySymbol: "₦",
    description: "Weekly driver earnings payout",
    recipientId: "driver_ng_001",
    paymentMethod: TEST_PAYMENT_METHODS.GTB_ACCOUNT,
    completedAt: new Date("2024-06-03T10:00:00Z"),
    gatewayReference: "PAYOUT_weekly_001",
    createdAt: new Date("2024-06-03T09:55:00Z"),
    updatedAt: new Date("2024-06-03T10:00:00Z"),
  },
};

/**
 * Test payment gateway credentials (sandbox/test mode)
 */
export const TEST_GATEWAY_CREDENTIALS = {
  // Paystack (Nigeria, Ghana, South Africa, Kenya)
  paystack: {
    publicKey: "pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    secretKey: "sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    webhookSecret: "whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    testCards: {
      success: "4084084084084081",
      declined: "4084080000000409",
      insufficientFunds: "5060666666666666664",
      expiredCard: "4084084084084000",
    },
    testBanks: {
      gtbank: { code: "058", testAccount: "0000000000" },
      firstBank: { code: "011", testAccount: "0000000001" },
    },
  },

  // Flutterwave (Pan-African)
  flutterwave: {
    publicKey: "FLWPUBK_TEST-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-X",
    secretKey: "FLWSECK_TEST-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-X",
    encryptionKey: "FLWSECK_TESTxxxxxxxxx",
    testCards: {
      success: "5531886652142950", // CVV: 564, Expiry: 09/32, PIN: 3310, OTP: 12345
      noAuth: "5438898014560229",
      declined: "5143010522339965",
    },
  },

  // M-Pesa (Kenya, Tanzania, Ghana)
  mpesa: {
    consumerKey: "test_consumer_key_xxxxxxxxxxxxxxxx",
    consumerSecret: "test_consumer_secret_xxxxxxxxxxxx",
    passKey: "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919",
    shortCode: "174379",
    callbackUrl: "https://api.test.ubi.com/webhooks/mpesa",
    testPhones: {
      success: "254708374149",
      failed: "254708374140",
    },
  },

  // MTN Mobile Money
  mtnMomo: {
    subscriptionKey: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    apiUser: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    apiKey: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    environment: "sandbox",
    callbackUrl: "https://api.test.ubi.com/webhooks/mtn-momo",
  },
};

/**
 * Test wallets
 */
export const TEST_WALLETS = {
  ADAOBI_WALLET: {
    id: "wallet_001",
    userId: TEST_RIDERS.ADAOBI_RIDER.id,
    balance: 15000,
    currency: "NGN",
    currencySymbol: "₦",
    isActive: true,
    lastTopUpAt: new Date("2024-06-01T09:00:30Z"),
    createdAt: new Date("2024-01-15"),
  },

  NJERI_WALLET: {
    id: "wallet_002",
    userId: TEST_RIDERS.NJERI_RIDER.id,
    balance: 5000,
    currency: "KES",
    currencySymbol: "KSh",
    isActive: true,
    lastTopUpAt: new Date("2024-05-28T14:00:00Z"),
    createdAt: new Date("2024-02-10"),
  },

  EMPTY_WALLET: {
    id: "wallet_empty",
    userId: TEST_RIDERS.NEW_RIDER.id,
    balance: 0,
    currency: "NGN",
    currencySymbol: "₦",
    isActive: true,
    createdAt: new Date("2024-06-01"),
  },
};
