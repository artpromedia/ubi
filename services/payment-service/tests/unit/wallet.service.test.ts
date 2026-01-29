/**
 * Wallet Service Unit Tests
 * UBI Payment Service
 *
 * Tests the double-entry ledger wallet service implementation
 */

import { AccountType, Currency, TransactionStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WalletService } from "../../src/services/wallet.service";
import { mockPrismaClient, resetMocks, testUser } from "../setup";

// Import after mocking

// Mock the actual service with our test dependencies
vi.mock("../../src/lib/prisma", () => ({
  prisma: mockPrismaClient,
}));

describe("WalletService", () => {
  let walletService: WalletService;

  beforeEach(() => {
    resetMocks();
    walletService = new WalletService(mockPrismaClient);
  });

  // ===========================================
  // GET OR CREATE WALLET ACCOUNT TESTS
  // ===========================================

  describe("getOrCreateWalletAccount", () => {
    it("should return existing account if found", async () => {
      const existingAccount = {
        id: "account-123",
        userId: testUser.id,
        accountType: AccountType.USER_WALLET,
        currency: Currency.KES,
        balance: 10000,
        availableBalance: 10000,
        heldBalance: 0,
      };

      (
        mockPrismaClient.walletAccount.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(existingAccount);

      const result = await walletService.getOrCreateWalletAccount(
        testUser.id,
        AccountType.USER_WALLET,
        Currency.KES,
      );

      expect(result).toEqual(existingAccount);
      expect(mockPrismaClient.walletAccount.findFirst).toHaveBeenCalledWith({
        where: {
          userId: testUser.id,
          accountType: AccountType.USER_WALLET,
          currency: Currency.KES,
        },
      });
    });

    it("should create new account if not found", async () => {
      const newAccount = {
        id: "new-account-123",
        userId: testUser.id,
        accountType: AccountType.USER_WALLET,
        currency: Currency.KES,
        balance: 0,
        availableBalance: 0,
        heldBalance: 0,
      };

      (
        mockPrismaClient.walletAccount.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(null);
      (
        mockPrismaClient.walletAccount.create as ReturnType<typeof vi.fn>
      ).mockResolvedValue(newAccount);

      const result = await walletService.getOrCreateWalletAccount(
        testUser.id,
        AccountType.USER_WALLET,
        Currency.KES,
      );

      expect(result).toEqual(newAccount);
      expect(mockPrismaClient.walletAccount.create).toHaveBeenCalledWith({
        data: {
          userId: testUser.id,
          accountType: AccountType.USER_WALLET,
          currency: Currency.KES,
          balance: 0,
          availableBalance: 0,
          heldBalance: 0,
        },
      });
    });
  });

  // ===========================================
  // GET BALANCE TESTS
  // ===========================================

  describe("getBalance", () => {
    it("should return correct balance for existing account", async () => {
      const account = {
        id: "account-123",
        balance: "10000.0000",
        availableBalance: "8000.0000",
        heldBalance: "2000.0000",
      };

      (
        mockPrismaClient.walletAccount.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(account);

      const result = await walletService.getBalance(
        testUser.id,
        AccountType.USER_WALLET,
        Currency.KES,
      );

      expect(result).toEqual({
        balance: 10000,
        availableBalance: 8000,
        heldBalance: 2000,
      });
    });

    it("should return zero balances for non-existent account", async () => {
      (
        mockPrismaClient.walletAccount.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(null);

      const result = await walletService.getBalance(
        testUser.id,
        AccountType.USER_WALLET,
        Currency.KES,
      );

      expect(result).toEqual({
        balance: 0,
        availableBalance: 0,
        heldBalance: 0,
      });
    });
  });

  // ===========================================
  // TOP UP TESTS
  // ===========================================

  describe("topUp", () => {
    it("should top up wallet and create ledger entries", async () => {
      const topUpAmount = 5000;
      const userAccount = {
        id: "user-account-123",
        userId: testUser.id,
        accountType: AccountType.USER_WALLET,
        currency: Currency.KES,
        balance: "10000",
        availableBalance: "10000",
      };
      const floatAccount = {
        id: "float-account",
        accountType: AccountType.UBI_FLOAT,
        currency: Currency.KES,
        balance: "1000000",
        availableBalance: "1000000",
      };

      // Mock the transaction callback
      (
        mockPrismaClient.$transaction as ReturnType<typeof vi.fn>
      ).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            walletAccount: {
              findFirst: vi.fn().mockResolvedValueOnce(floatAccount),
              update: vi.fn().mockResolvedValue({}),
            },
            transaction: {
              create: vi.fn().mockResolvedValue({
                id: "txn-topup",
                amount: topUpAmount,
                status: TransactionStatus.COMPLETED,
              }),
            },
            ledgerEntry: {
              create: vi.fn().mockResolvedValue({}),
            },
          };
          return await callback(mockTx);
        },
      );

      // Mock getOrCreateWalletAccount
      vi.spyOn(walletService, "getOrCreateWalletAccount").mockResolvedValue(
        userAccount as never,
      );

      const result = await walletService.topUp({
        userId: testUser.id,
        amount: topUpAmount,
        currency: Currency.KES,
        paymentTransactionId: "payment-123",
        description: "Test top-up",
      });

      expect(result).toBeDefined();
      expect(result.transaction).toBeDefined();
      expect(result.newBalance).toBe(15000);
    });

    it("should reject zero or negative amounts", async () => {
      await expect(
        walletService.topUp({
          userId: testUser.id,
          amount: 0,
          currency: Currency.KES,
          paymentTransactionId: "payment-123",
        }),
      ).rejects.toThrow("Amount must be positive");

      await expect(
        walletService.topUp({
          userId: testUser.id,
          amount: -100,
          currency: Currency.KES,
          paymentTransactionId: "payment-123",
        }),
      ).rejects.toThrow("Amount must be positive");
    });
  });

  // ===========================================
  // WITHDRAW TESTS
  // ===========================================

  describe("withdraw", () => {
    it("should withdraw from wallet when sufficient balance exists", async () => {
      const withdrawAmount = 3000;
      const userAccount = {
        id: "user-account-123",
        userId: testUser.id,
        accountType: AccountType.USER_WALLET,
        currency: Currency.KES,
        balance: "10000",
        availableBalance: "10000",
      };
      const floatAccount = {
        id: "float-account",
        accountType: AccountType.UBI_FLOAT,
        currency: Currency.KES,
        balance: "1000000",
        availableBalance: "1000000",
      };

      (
        mockPrismaClient.$transaction as ReturnType<typeof vi.fn>
      ).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            walletAccount: {
              findFirst: vi
                .fn()
                .mockResolvedValueOnce(userAccount)
                .mockResolvedValueOnce(floatAccount),
              update: vi.fn().mockResolvedValue({}),
            },
            transaction: {
              create: vi.fn().mockResolvedValue({
                id: "txn-withdraw",
                amount: withdrawAmount,
                status: TransactionStatus.COMPLETED,
              }),
            },
            ledgerEntry: {
              create: vi.fn().mockResolvedValue({}),
            },
          };
          return callback(mockTx);
        },
      );

      const result = await walletService.withdraw({
        userId: testUser.id,
        amount: withdrawAmount,
        currency: Currency.KES,
        description: "Test withdrawal",
      });

      expect(result).toBeDefined();
      expect(result.transaction).toBeDefined();
      expect(result.newBalance).toBe(7000);
    });

    it("should reject withdrawal when insufficient balance", async () => {
      const insufficientAccount = {
        id: "user-account-123",
        balance: "500",
        availableBalance: "500",
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
          const result = await callback(mockTx);
          return result;
        },
      );

      await expect(
        walletService.withdraw({
          userId: testUser.id,
          amount: 1000,
          currency: Currency.KES,
        }),
      ).rejects.toThrow("Insufficient balance");
    });

    it("should reject zero or negative amounts", async () => {
      await expect(
        walletService.withdraw({
          userId: testUser.id,
          amount: 0,
          currency: Currency.KES,
        }),
      ).rejects.toThrow("Amount must be positive");
    });
  });

  // ===========================================
  // HOLD FUNDS TESTS
  // ===========================================

  describe("holdFunds", () => {
    it("should create hold and reduce available balance", async () => {
      const holdAmount = 2000;
      const account = {
        id: "account-123",
        currency: Currency.KES,
        balance: "10000",
        availableBalance: "10000",
        heldBalance: "0",
      };

      (
        mockPrismaClient.$transaction as ReturnType<typeof vi.fn>
      ).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            walletAccount: {
              findUnique: vi.fn().mockResolvedValue(account),
              update: vi.fn().mockResolvedValue({
                ...account,
                availableBalance: "8000",
                heldBalance: "2000",
              }),
            },
            balanceHold: {
              create: vi.fn().mockResolvedValue({
                id: "hold-123",
                accountId: account.id,
                amount: holdAmount,
                currency: Currency.KES,
                reason: "Ride payment hold",
              }),
            },
          };
          const result = await callback(mockTx);
          return result;
        },
      );

      const holdResult = await walletService.holdFunds({
        accountId: account.id,
        amount: holdAmount,
        currency: Currency.KES,
        reason: "Ride payment hold",
      });

      expect(holdResult).toBeDefined();
      expect(holdResult.id).toBe("hold-123");
    });

    it("should reject hold when insufficient available balance", async () => {
      const lowBalanceAccount = {
        id: "account-123",
        currency: Currency.KES,
        availableBalance: "100",
      };

      (
        mockPrismaClient.$transaction as ReturnType<typeof vi.fn>
      ).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            walletAccount: {
              findUnique: vi.fn().mockResolvedValue(lowBalanceAccount),
            },
          };
          const result = await callback(mockTx);
          return result;
        },
      );

      await expect(
        walletService.holdFunds({
          accountId: "account-123",
          amount: 500,
          currency: Currency.KES,
          reason: "Test hold",
        }),
      ).rejects.toThrow("Insufficient available balance");
    });

    it("should reject hold with currency mismatch", async () => {
      const account = {
        id: "account-123",
        currency: Currency.NGN,
        availableBalance: "10000",
      };

      (
        mockPrismaClient.$transaction as ReturnType<typeof vi.fn>
      ).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            walletAccount: {
              findUnique: vi.fn().mockResolvedValue(account),
            },
          };
          const result = await callback(mockTx);
          return result;
        },
      );

      await expect(
        walletService.holdFunds({
          accountId: "account-123",
          amount: 500,
          currency: Currency.KES,
          reason: "Test hold",
        }),
      ).rejects.toThrow("Currency mismatch");
    });
  });

  // ===========================================
  // RELEASE FUNDS TESTS
  // ===========================================

  describe("releaseFunds", () => {
    it("should release hold and restore available balance", async () => {
      const mockHold = {
        id: "hold-123",
        accountId: "account-123",
        amount: "2000",
        isReleased: false,
        account: {
          id: "account-123",
          availableBalance: "8000",
          heldBalance: "2000",
        },
      };

      (
        mockPrismaClient.$transaction as ReturnType<typeof vi.fn>
      ).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            balanceHold: {
              findUnique: vi.fn().mockResolvedValue(mockHold),
              update: vi
                .fn()
                .mockResolvedValue({ ...mockHold, isReleased: true }),
            },
            walletAccount: {
              update: vi.fn().mockResolvedValue({
                availableBalance: "10000",
                heldBalance: "0",
              }),
            },
          };
          const result = await callback(mockTx);
          return result;
        },
      );

      const releaseResult = await walletService.releaseFunds("hold-123");

      expect(releaseResult).toBeDefined();
    });

    it("should throw error for non-existent hold", async () => {
      (
        mockPrismaClient.$transaction as ReturnType<typeof vi.fn>
      ).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            balanceHold: {
              findUnique: vi.fn().mockResolvedValue(null),
            },
          };
          const result = await callback(mockTx);
          return result;
        },
      );

      await expect(walletService.releaseFunds("invalid-hold")).rejects.toThrow(
        "Hold not found",
      );
    });

    it("should throw error for already released hold", async () => {
      const releasedHold = {
        id: "hold-123",
        isReleased: true,
      };

      (
        mockPrismaClient.$transaction as ReturnType<typeof vi.fn>
      ).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            balanceHold: {
              findUnique: vi.fn().mockResolvedValue(releasedHold),
            },
          };
          const result = await callback(mockTx);
          return result;
        },
      );

      await expect(walletService.releaseFunds("hold-123")).rejects.toThrow(
        "Hold already released",
      );
    });
  });

  // ===========================================
  // TRANSFER TESTS
  // ===========================================

  describe("transfer", () => {
    it("should transfer between two accounts", async () => {
      const fromAccount = {
        id: "from-account",
        currency: Currency.KES,
        balance: "10000",
        availableBalance: "10000",
        accountType: AccountType.USER_WALLET,
      };
      const toAccount = {
        id: "to-account",
        currency: Currency.KES,
        balance: "5000",
        availableBalance: "5000",
        accountType: AccountType.USER_WALLET,
      };

      (
        mockPrismaClient.$transaction as ReturnType<typeof vi.fn>
      ).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            walletAccount: {
              findUnique: vi
                .fn()
                .mockResolvedValueOnce(fromAccount)
                .mockResolvedValueOnce(toAccount),
              update: vi.fn().mockResolvedValue({}),
            },
            transaction: {
              create: vi.fn().mockResolvedValue({
                id: "txn-transfer",
                status: TransactionStatus.COMPLETED,
              }),
            },
            ledgerEntry: {
              create: vi.fn().mockResolvedValue({}),
            },
          };
          const result = await callback(mockTx);
          return result;
        },
      );

      const transferResult = await walletService.transfer({
        fromAccountId: "from-account",
        toAccountId: "to-account",
        amount: 1000,
        currency: Currency.KES,
        description: "Test transfer",
      });

      expect(transferResult).toBeDefined();
      expect(transferResult.fromBalance).toBe(9000);
      expect(transferResult.toBalance).toBe(6000);
    });

    it("should reject transfer to same account", async () => {
      await expect(
        walletService.transfer({
          fromAccountId: "same-account",
          toAccountId: "same-account",
          amount: 1000,
          currency: Currency.KES,
        }),
      ).rejects.toThrow("Cannot transfer to same account");
    });

    it("should reject transfer with insufficient balance", async () => {
      const fromAccount = {
        id: "from-account",
        currency: Currency.KES,
        balance: "500",
        availableBalance: "500",
      };

      (
        mockPrismaClient.$transaction as ReturnType<typeof vi.fn>
      ).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            walletAccount: {
              findUnique: vi.fn().mockResolvedValue(fromAccount),
            },
          };
          const result = await callback(mockTx);
          return result;
        },
      );

      await expect(
        walletService.transfer({
          fromAccountId: "from-account",
          toAccountId: "to-account",
          amount: 1000,
          currency: Currency.KES,
        }),
      ).rejects.toThrow("Insufficient balance");
    });

    it("should reject zero or negative amounts", async () => {
      await expect(
        walletService.transfer({
          fromAccountId: "from-account",
          toAccountId: "to-account",
          amount: 0,
          currency: Currency.KES,
        }),
      ).rejects.toThrow("Amount must be positive");
    });
  });
});
