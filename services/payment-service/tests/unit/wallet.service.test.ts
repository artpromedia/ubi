/**
 * Wallet Service Unit Tests
 * UBI Payment Service
 */

import { Currency } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockPrismaClient,
  mockRedisClient,
  resetMocks,
  testUser,
  testWallet,
  testWalletAccount,
} from "../setup";

// Mock the actual service with our test dependencies
vi.mock("../../src/lib/prisma", () => ({
  prisma: mockPrismaClient,
}));

vi.mock("../../src/lib/redis", () => ({
  redis: mockRedisClient,
}));

// Import after mocking
import { WalletService } from "../../src/services/wallet.service";

describe("WalletService", () => {
  let walletService: WalletService;

  beforeEach(() => {
    resetMocks();
    walletService = new WalletService(mockPrismaClient, mockRedisClient);
  });

  // ===========================================
  // CREATE WALLET TESTS
  // ===========================================

  describe("createWallet", () => {
    it("should create a wallet with default accounts for all currencies", async () => {
      const mockWallet = { ...testWallet };
      const mockAccounts = [
        { ...testWalletAccount, currency: Currency.NGN },
        { ...testWalletAccount, currency: Currency.KES },
        { ...testWalletAccount, currency: Currency.GHS },
      ];

      (
        mockPrismaClient.wallet.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(null);
      (
        mockPrismaClient.$transaction as ReturnType<typeof vi.fn>
      ).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            wallet: {
              create: vi.fn().mockResolvedValue(mockWallet),
            },
            walletAccount: {
              createMany: vi.fn().mockResolvedValue({ count: 3 }),
              findMany: vi.fn().mockResolvedValue(mockAccounts),
            },
          };
          return callback(mockTx);
        },
      );

      const result = await walletService.createWallet(
        testUser.id,
        "USER_WALLET",
      );

      expect(result).toBeDefined();
      expect(result.userId).toBe(testUser.id);
    });

    it("should throw error if wallet already exists", async () => {
      (
        mockPrismaClient.wallet.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(testWallet);

      await expect(
        walletService.createWallet(testUser.id, "USER_WALLET"),
      ).rejects.toThrow("Wallet already exists");
    });
  });

  // ===========================================
  // GET BALANCE TESTS
  // ===========================================

  describe("getBalance", () => {
    it("should return correct balance for existing account", async () => {
      (
        mockPrismaClient.walletAccount.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(testWalletAccount);
      (mockRedisClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await walletService.getBalance(testUser.id, Currency.KES);

      expect(result).toBeDefined();
      expect(result.balance).toBe("10000.0000");
      expect(result.availableBalance).toBe("10000.0000");
      expect(result.currency).toBe(Currency.KES);
    });

    it("should use cached balance if available", async () => {
      const cachedBalance = {
        balance: "5000.0000",
        availableBalance: "5000.0000",
        holdBalance: "0.0000",
        currency: Currency.KES,
      };

      (mockRedisClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify(cachedBalance),
      );

      const result = await walletService.getBalance(testUser.id, Currency.KES);

      expect(result).toEqual(cachedBalance);
      expect(mockPrismaClient.walletAccount.findFirst).not.toHaveBeenCalled();
    });

    it("should throw error for non-existent account", async () => {
      (
        mockPrismaClient.walletAccount.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(null);
      (mockRedisClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        walletService.getBalance(testUser.id, Currency.KES),
      ).rejects.toThrow("Account not found");
    });
  });

  // ===========================================
  // CREDIT TESTS
  // ===========================================

  describe("credit", () => {
    it("should credit account and create ledger entry", async () => {
      const creditAmount = 5000;
      const updatedAccount = {
        ...testWalletAccount,
        balance: "15000.0000",
        availableBalance: "15000.0000",
      };

      (
        mockPrismaClient.$transaction as ReturnType<typeof vi.fn>
      ).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            walletAccount: {
              findFirst: vi.fn().mockResolvedValue(testWalletAccount),
              update: vi.fn().mockResolvedValue(updatedAccount),
            },
            transaction: {
              create: vi.fn().mockResolvedValue({
                id: "txn-new",
                amount: creditAmount.toString(),
              }),
            },
            ledgerEntry: {
              create: vi.fn().mockResolvedValue({}),
            },
          };
          return callback(mockTx);
        },
      );

      const result = await walletService.credit({
        userId: testUser.id,
        amount: creditAmount,
        currency: Currency.KES,
        type: "WALLET_TOPUP",
        reference: "REF-CREDIT",
        description: "Test credit",
      });

      expect(result).toBeDefined();
      expect(result.newBalance).toBe("15000.0000");
    });

    it("should reject zero or negative amounts", async () => {
      await expect(
        walletService.credit({
          userId: testUser.id,
          amount: 0,
          currency: Currency.KES,
          type: "WALLET_TOPUP",
          reference: "REF-CREDIT",
          description: "Test credit",
        }),
      ).rejects.toThrow("Amount must be positive");

      await expect(
        walletService.credit({
          userId: testUser.id,
          amount: -100,
          currency: Currency.KES,
          type: "WALLET_TOPUP",
          reference: "REF-CREDIT",
          description: "Test credit",
        }),
      ).rejects.toThrow("Amount must be positive");
    });
  });

  // ===========================================
  // DEBIT TESTS
  // ===========================================

  describe("debit", () => {
    it("should debit account when sufficient balance exists", async () => {
      const debitAmount = 3000;
      const updatedAccount = {
        ...testWalletAccount,
        balance: "7000.0000",
        availableBalance: "7000.0000",
      };

      (
        mockPrismaClient.$transaction as ReturnType<typeof vi.fn>
      ).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            walletAccount: {
              findFirst: vi.fn().mockResolvedValue(testWalletAccount),
              update: vi.fn().mockResolvedValue(updatedAccount),
            },
            transaction: {
              create: vi.fn().mockResolvedValue({
                id: "txn-debit",
                amount: debitAmount.toString(),
              }),
            },
            ledgerEntry: {
              create: vi.fn().mockResolvedValue({}),
            },
          };
          return callback(mockTx);
        },
      );

      const result = await walletService.debit({
        userId: testUser.id,
        amount: debitAmount,
        currency: Currency.KES,
        type: "RIDE_PAYMENT",
        reference: "REF-DEBIT",
        description: "Test debit",
      });

      expect(result).toBeDefined();
      expect(result.newBalance).toBe("7000.0000");
    });

    it("should reject debit when insufficient balance", async () => {
      const insufficientAccount = {
        ...testWalletAccount,
        balance: "500.0000",
        availableBalance: "500.0000",
      };

      (
        mockPrismaClient.$transaction as ReturnType<typeof vi.fn>
      ).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            walletAccount: {
              findFirst: vi.fn().mockResolvedValue(insufficientAccount),
            },
          };
          return callback(mockTx);
        },
      );

      await expect(
        walletService.debit({
          userId: testUser.id,
          amount: 1000,
          currency: Currency.KES,
          type: "RIDE_PAYMENT",
          reference: "REF-DEBIT",
          description: "Test debit",
        }),
      ).rejects.toThrow("Insufficient balance");
    });
  });

  // ===========================================
  // HOLD/RELEASE TESTS
  // ===========================================

  describe("createHold", () => {
    it("should create hold and reduce available balance", async () => {
      const holdAmount = 2000;

      (
        mockPrismaClient.$transaction as ReturnType<typeof vi.fn>
      ).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            walletAccount: {
              findFirst: vi.fn().mockResolvedValue(testWalletAccount),
              update: vi.fn().mockResolvedValue({
                ...testWalletAccount,
                availableBalance: "8000.0000",
                holdBalance: "2000.0000",
              }),
            },
            balanceHold: {
              create: vi.fn().mockResolvedValue({
                id: "hold-123",
                accountId: testWalletAccount.id,
                amount: holdAmount.toString(),
              }),
            },
          };
          return callback(mockTx);
        },
      );

      const result = await walletService.createHold({
        userId: testUser.id,
        amount: holdAmount,
        currency: Currency.KES,
        reason: "Ride payment hold",
        expiresAt: new Date(Date.now() + 3600000),
      });

      expect(result).toBeDefined();
      expect(result.id).toBe("hold-123");
    });

    it("should reject hold when insufficient available balance", async () => {
      const lowBalanceAccount = {
        ...testWalletAccount,
        availableBalance: "100.0000",
      };

      (
        mockPrismaClient.$transaction as ReturnType<typeof vi.fn>
      ).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            walletAccount: {
              findFirst: vi.fn().mockResolvedValue(lowBalanceAccount),
            },
          };
          return callback(mockTx);
        },
      );

      await expect(
        walletService.createHold({
          userId: testUser.id,
          amount: 500,
          currency: Currency.KES,
          reason: "Test hold",
          expiresAt: new Date(Date.now() + 3600000),
        }),
      ).rejects.toThrow("Insufficient available balance");
    });
  });

  describe("releaseHold", () => {
    it("should release hold and restore available balance", async () => {
      const mockHold = {
        id: "hold-123",
        accountId: testWalletAccount.id,
        amount: "2000.0000",
        isReleased: false,
      };

      const accountWithHold = {
        ...testWalletAccount,
        availableBalance: "8000.0000",
        holdBalance: "2000.0000",
      };

      (
        mockPrismaClient.$transaction as ReturnType<typeof vi.fn>
      ).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            balanceHold: {
              findFirst: vi.fn().mockResolvedValue(mockHold),
              update: vi
                .fn()
                .mockResolvedValue({ ...mockHold, isReleased: true }),
            },
            walletAccount: {
              findFirst: vi.fn().mockResolvedValue(accountWithHold),
              update: vi.fn().mockResolvedValue({
                ...testWalletAccount,
                availableBalance: "10000.0000",
                holdBalance: "0.0000",
              }),
            },
          };
          return callback(mockTx);
        },
      );

      const result = await walletService.releaseHold("hold-123");

      expect(result).toBeDefined();
      expect(result.isReleased).toBe(true);
    });
  });

  // ===========================================
  // TRANSFER TESTS
  // ===========================================

  describe("transfer", () => {
    it("should transfer between two accounts", async () => {
      const fromAccount = { ...testWalletAccount, id: "from-account" };
      const toAccount = {
        ...testWalletAccount,
        id: "to-account",
        userId: "user-456",
      };

      (
        mockPrismaClient.$transaction as ReturnType<typeof vi.fn>
      ).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            walletAccount: {
              findFirst: vi
                .fn()
                .mockResolvedValueOnce(fromAccount)
                .mockResolvedValueOnce(toAccount),
              update: vi.fn().mockResolvedValue({}),
            },
            transaction: {
              create: vi.fn().mockResolvedValue({ id: "txn-transfer" }),
            },
            ledgerEntry: {
              createMany: vi.fn().mockResolvedValue({ count: 2 }),
            },
          };
          return callback(mockTx);
        },
      );

      const result = await walletService.transfer({
        fromUserId: testUser.id,
        toUserId: "user-456",
        amount: 1000,
        currency: Currency.KES,
        reference: "REF-TRANSFER",
        description: "Test transfer",
      });

      expect(result).toBeDefined();
    });

    it("should reject transfer to same account", async () => {
      await expect(
        walletService.transfer({
          fromUserId: testUser.id,
          toUserId: testUser.id,
          amount: 1000,
          currency: Currency.KES,
          reference: "REF-TRANSFER",
          description: "Test transfer",
        }),
      ).rejects.toThrow("Cannot transfer to same account");
    });
  });

  // ===========================================
  // IDEMPOTENCY TESTS
  // ===========================================

  describe("idempotency", () => {
    it("should return cached result for duplicate request", async () => {
      const cachedResult = {
        transactionId: "txn-cached",
        newBalance: "15000.0000",
      };

      (mockRedisClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify(cachedResult),
      );

      const result = await walletService.credit({
        userId: testUser.id,
        amount: 5000,
        currency: Currency.KES,
        type: "WALLET_TOPUP",
        reference: "REF-IDEMPOTENT",
        description: "Test idempotent credit",
        idempotencyKey: "idem-123",
      });

      expect(result).toEqual(cachedResult);
      expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
    });
  });
});
