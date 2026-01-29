/**
 * Test Setup
 * UBI Payment Service
 *
 * Global test configuration and mocks
 */

import { Currency, PaymentProvider, PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, vi } from "vitest";

// ===========================================
// MOCK PRISMA CLIENT
// ===========================================

export const mockPrismaClient = {
  walletAccount: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    aggregate: vi.fn(),
  },
  wallet: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  transaction: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
  },
  ledgerEntry: {
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
  },
  paymentTransaction: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
  },
  payout: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
  },
  balanceHold: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  riskAssessment: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  reconciliationReport: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  reconciliationDiscrepancy: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  settlement: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
  },
  user: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  restaurant: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  alert: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  providerHealth: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  $transaction: vi.fn((callback) => callback(mockPrismaClient)),
  $connect: vi.fn(),
  $disconnect: vi.fn(),
} as unknown as PrismaClient;

// ===========================================
// MOCK REDIS CLIENT
// ===========================================

export const mockRedisClient = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  setex: vi.fn(),
  incr: vi.fn(),
  decr: vi.fn(),
  expire: vi.fn(),
  ttl: vi.fn(),
  exists: vi.fn(),
  lpush: vi.fn(),
  lrange: vi.fn(),
  ltrim: vi.fn(),
  hget: vi.fn(),
  hset: vi.fn(),
  hdel: vi.fn(),
  hgetall: vi.fn(),
  zadd: vi.fn(),
  zrange: vi.fn(),
  zrem: vi.fn(),
  pipeline: vi.fn(() => ({
    get: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    incr: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  })),
  disconnect: vi.fn(),
  quit: vi.fn(),
} as unknown as Redis;

// ===========================================
// TEST FIXTURES
// ===========================================

export const testUser = {
  id: "user-123",
  email: "test@ubi.africa",
  phone: "+254712345678",
  role: "RIDER",
  status: "ACTIVE",
};

export const testWallet = {
  id: "wallet-123",
  userId: testUser.id,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const testWalletAccount = {
  id: "account-123",
  walletId: testWallet.id,
  type: "USER_WALLET",
  currency: Currency.KES,
  balance: "10000.0000",
  availableBalance: "10000.0000",
  holdBalance: "0.0000",
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const testTransaction = {
  id: "txn-123",
  userId: testUser.id,
  accountId: testWalletAccount.id,
  type: "WALLET_TOPUP",
  amount: "1000.0000",
  currency: Currency.KES,
  status: "COMPLETED",
  reference: "REF-123",
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const testPaymentTransaction = {
  id: "payment-123",
  userId: testUser.id,
  provider: PaymentProvider.MPESA,
  providerReference: "MPESA-123",
  amount: "1000.0000",
  currency: Currency.KES,
  status: "COMPLETED",
  initiatedAt: new Date(),
  confirmedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ===========================================
// HELPER FUNCTIONS
// ===========================================

export function resetMocks(): void {
  vi.clearAllMocks();
}

export function mockSuccessfulWalletLookup(): void {
  (
    mockPrismaClient.wallet.findFirst as ReturnType<typeof vi.fn>
  ).mockResolvedValue(testWallet);
  (
    mockPrismaClient.walletAccount.findFirst as ReturnType<typeof vi.fn>
  ).mockResolvedValue(testWalletAccount);
}

export function mockInsufficientBalance(): void {
  (
    mockPrismaClient.wallet.findFirst as ReturnType<typeof vi.fn>
  ).mockResolvedValue(testWallet);
  (
    mockPrismaClient.walletAccount.findFirst as ReturnType<typeof vi.fn>
  ).mockResolvedValue({
    ...testWalletAccount,
    balance: "0.0000",
    availableBalance: "0.0000",
  });
}

export function mockProviderSuccess(provider: string): void {
  // Implement provider-specific mocks
}

export function mockProviderFailure(provider: string, error: string): void {
  // Implement provider-specific error mocks
}

// ===========================================
// GLOBAL HOOKS
// ===========================================

beforeAll(() => {
  // Set test environment variables
  process.env.NODE_ENV = "test";
  process.env.MPESA_CONSUMER_KEY = "test-consumer-key";
  process.env.MPESA_CONSUMER_SECRET = "test-consumer-secret";
  process.env.MPESA_SHORTCODE = "174379";
  process.env.MPESA_PASSKEY = "test-passkey";
  process.env.MTN_MOMO_API_KEY = "test-api-key";
  process.env.MTN_MOMO_API_USER = "test-user";
  process.env.MTN_MOMO_SUBSCRIPTION_KEY = "test-sub-key";
  process.env.PAYSTACK_SECRET_KEY = "sk_test_xxx";
});

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  resetMocks();
});
