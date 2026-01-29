/**
 * Payment Service Types
 */

// ============================================
// Enums
// ============================================

export enum Currency {
  NGN = "NGN", // Nigerian Naira
  KES = "KES", // Kenyan Shilling
  GHS = "GHS", // Ghanaian Cedi
  UGX = "UGX", // Ugandan Shilling
  TZS = "TZS", // Tanzanian Shilling
  ZAR = "ZAR", // South African Rand
  XOF = "XOF", // West African CFA Franc
  RWF = "RWF", // Rwandan Franc
  ETB = "ETB", // Ethiopian Birr
  USD = "USD", // US Dollar (for international)
}

export enum PaymentMethod {
  CARD = "CARD",
  WALLET = "WALLET",
  BANK_TRANSFER = "BANK_TRANSFER",
  MOBILE_MONEY = "MOBILE_MONEY",
  USSD = "USSD",
  QR = "QR",
  CASH = "CASH",
}

export enum PaymentStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
  REFUNDED = "REFUNDED",
  PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED",
  EXPIRED = "EXPIRED",
}

export enum PaymentProvider {
  PAYSTACK = "PAYSTACK",
  FLUTTERWAVE = "FLUTTERWAVE",
  MPESA = "MPESA",
  MTN_MOMO_GH = "MTN_MOMO_GH",
  MTN_MOMO_UG = "MTN_MOMO_UG",
  MTN_MOMO_RW = "MTN_MOMO_RW",
  AIRTEL_MONEY_KE = "AIRTEL_MONEY_KE",
  AIRTEL_MONEY_UG = "AIRTEL_MONEY_UG",
  AIRTEL_MONEY_TZ = "AIRTEL_MONEY_TZ",
  TELEBIRR = "TELEBIRR", // Ethiopia - Ethio Telecom
  ORANGE_MONEY_CI = "ORANGE_MONEY_CI", // Côte d'Ivoire
  ORANGE_MONEY_SN = "ORANGE_MONEY_SN", // Senegal
  ORANGE_MONEY_CM = "ORANGE_MONEY_CM", // Cameroon
  ORANGE_MONEY_ML = "ORANGE_MONEY_ML", // Mali
}

export enum PaymentType {
  RIDE_PAYMENT = "RIDE_PAYMENT",
  FOOD_ORDER = "FOOD_ORDER",
  DELIVERY_PAYMENT = "DELIVERY_PAYMENT",
  WALLET_TOPUP = "WALLET_TOPUP",
  SUBSCRIPTION = "SUBSCRIPTION",
  TIP = "TIP",
  PENALTY = "PENALTY",
}

export enum TransactionType {
  CREDIT = "CREDIT",
  DEBIT = "DEBIT",
  LOCK = "LOCK",
  UNLOCK = "UNLOCK",
}

export enum TransactionStatus {
  PENDING = "PENDING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  REVERSED = "REVERSED",
}

export enum WalletType {
  MAIN = "MAIN",
  EARNINGS = "EARNINGS",
  BONUS = "BONUS",
  SAVINGS = "SAVINGS",
}

// ============================================
// Interfaces
// ============================================

export interface Wallet {
  id: string;
  userId: string;
  currency: Currency;
  balance: number;
  lockedBalance: number;
  type: WalletType;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletTransaction {
  id: string;
  walletId: string;
  type: TransactionType;
  amount: number;
  currency: Currency;
  status: TransactionStatus;
  reference: string;
  description: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  completedAt?: Date;
}

export interface Payment {
  id: string;
  userId: string;
  referenceId: string; // Ride ID, Order ID, etc.
  type: PaymentType;
  amount: number;
  currency: Currency;
  method: PaymentMethod;
  status: PaymentStatus;
  providerReference?: string;
  failureReason?: string;
  refundedAmount?: number;
  metadata?: Record<string, any>;
  createdAt: Date;
  completedAt?: Date;
}

export interface Payout {
  id: string;
  userId: string;
  walletId: string;
  amount: number;
  currency: Currency;
  method: string;
  status: string;
  fees: number;
  netAmount: number;
  destination: Record<string, any>;
  providerReference?: string;
  failureReason?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  completedAt?: Date;
}

export interface Card {
  id: string;
  userId: string;
  last4: string;
  brand: string;
  expiryMonth: string;
  expiryYear: string;
  bankName?: string;
  countryCode: string;
  authorizationCode: string;
  signature: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
}

export interface BankAccount {
  id: string;
  userId: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  currency: Currency;
  isVerified: boolean;
  isDefault: boolean;
  createdAt: Date;
}

export interface MobileMoneyAccount {
  id: string;
  userId: string;
  provider: string;
  phoneNumber: string;
  accountName: string;
  currency: Currency;
  isVerified: boolean;
  isDefault: boolean;
  createdAt: Date;
}

// ============================================
// API Types
// ============================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

// ============================================
// Event Types
// ============================================

export interface PaymentEvent {
  type:
    | "payment.created"
    | "payment.completed"
    | "payment.failed"
    | "payment.refunded";
  paymentId: string;
  userId: string;
  amount: number;
  currency: Currency;
  referenceId: string;
  timestamp: Date;
}

export interface WalletEvent {
  type:
    | "wallet.credited"
    | "wallet.debited"
    | "wallet.locked"
    | "wallet.unlocked";
  walletId: string;
  userId: string;
  amount: number;
  currency: Currency;
  balance: number;
  timestamp: Date;
}

export interface PayoutEvent {
  type:
    | "payout.requested"
    | "payout.processing"
    | "payout.completed"
    | "payout.failed";
  payoutId: string;
  userId: string;
  amount: number;
  currency: Currency;
  timestamp: Date;
}

// ============================================
// Currency Configuration
// ============================================

export interface CurrencyConfig {
  code: Currency;
  name: string;
  symbol: string;
  decimals: number;
  country: string;
  minAmount: number;
  maxAmount: number;
}

export const CURRENCY_CONFIGS: Record<Currency, CurrencyConfig> = {
  [Currency.NGN]: {
    code: Currency.NGN,
    name: "Nigerian Naira",
    symbol: "₦",
    decimals: 0,
    country: "NG",
    minAmount: 100,
    maxAmount: 10000000,
  },
  [Currency.KES]: {
    code: Currency.KES,
    name: "Kenyan Shilling",
    symbol: "KSh",
    decimals: 0,
    country: "KE",
    minAmount: 10,
    maxAmount: 500000,
  },
  [Currency.GHS]: {
    code: Currency.GHS,
    name: "Ghanaian Cedi",
    symbol: "GH₵",
    decimals: 2,
    country: "GH",
    minAmount: 1,
    maxAmount: 100000,
  },
  [Currency.UGX]: {
    code: Currency.UGX,
    name: "Ugandan Shilling",
    symbol: "USh",
    decimals: 0,
    country: "UG",
    minAmount: 500,
    maxAmount: 20000000,
  },
  [Currency.TZS]: {
    code: Currency.TZS,
    name: "Tanzanian Shilling",
    symbol: "TSh",
    decimals: 0,
    country: "TZ",
    minAmount: 1000,
    maxAmount: 50000000,
  },
  [Currency.ZAR]: {
    code: Currency.ZAR,
    name: "South African Rand",
    symbol: "R",
    decimals: 2,
    country: "ZA",
    minAmount: 10,
    maxAmount: 500000,
  },
  [Currency.XOF]: {
    code: Currency.XOF,
    name: "West African CFA Franc",
    symbol: "CFA",
    decimals: 0,
    country: "CI", // Côte d'Ivoire (primary)
    minAmount: 100,
    maxAmount: 10000000,
  },
  [Currency.RWF]: {
    code: Currency.RWF,
    name: "Rwandan Franc",
    symbol: "FRw",
    decimals: 0,
    country: "RW",
    minAmount: 100,
    maxAmount: 10000000,
  },
  [Currency.ETB]: {
    code: Currency.ETB,
    name: "Ethiopian Birr",
    symbol: "Br",
    decimals: 2,
    country: "ET",
    minAmount: 10,
    maxAmount: 1000000,
  },
  [Currency.USD]: {
    code: Currency.USD,
    name: "US Dollar",
    symbol: "$",
    decimals: 2,
    country: "US",
    minAmount: 1,
    maxAmount: 100000,
  },
};
