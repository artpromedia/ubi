/**
 * Wallet Service - Double-Entry Ledger Implementation
 *
 * Implements double-entry bookkeeping for all wallet operations.
 * Every transaction creates balanced debit and credit entries.
 * All operations are atomic and ensure financial integrity.
 */

import {
  AccountType,
  type Currency,
  EntryType,
  type PrismaClient,
  TransactionStatus,
  TransactionType,
} from "@prisma/client";
import { nanoid } from "nanoid";

export interface TransferParams {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  currency: Currency;
  description?: string;
  metadata?: Record<string, any>;
  idempotencyKey?: string;
}

export interface TopUpParams {
  userId: string;
  amount: number;
  currency: Currency;
  paymentTransactionId: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface WithdrawParams {
  userId: string;
  amount: number;
  currency: Currency;
  payoutId?: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface HoldParams {
  accountId: string;
  amount: number;
  currency: Currency;
  reason: string;
  reference?: string;
  expiresInMinutes?: number;
  metadata?: Record<string, any>;
}

export interface LedgerSummary {
  accountId: string;
  totalDebits: number;
  totalCredits: number;
  calculatedBalance: number;
  storedBalance: number;
  isBalanced: boolean;
}

export interface TopupRequest {
  userId: string;
  amount: number;
  currency: Currency;
  paymentTransactionId: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface TransferRequest {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  currency: Currency;
  description?: string;
  metadata?: Record<string, any>;
  idempotencyKey?: string;
}

export interface WalletCreation {
  userId: string;
  accountType: AccountType;
  currency: Currency;
  initialBalance?: number;
}

export interface WithdrawalRequest {
  userId: string;
  amount: number;
  currency: Currency;
  payoutId?: string;
  description?: string;
  metadata?: Record<string, any>;
}

export class WalletService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get or create wallet account for user
   */
  async getOrCreateWalletAccount(
    userId: string,
    accountType: AccountType,
    currency: Currency,
  ) {
    // Try to find existing account
    let account = await this.prisma.walletAccount.findFirst({
      where: {
        userId,
        accountType,
        currency,
      },
    });

    if (!account) {
      // Create new account
      account = await this.prisma.walletAccount.create({
        data: {
          userId,
          accountType,
          currency,
          balance: 0,
          availableBalance: 0,
          heldBalance: 0,
        },
      });
    }

    return account;
  }

  /**
   * Get wallet account balance
   */
  async getBalance(
    userId: string,
    accountType: AccountType,
    currency: Currency,
  ) {
    const account = await this.prisma.walletAccount.findFirst({
      where: {
        userId,
        accountType,
        currency,
      },
    });

    if (!account) {
      return {
        balance: 0,
        availableBalance: 0,
        heldBalance: 0,
      };
    }

    return {
      balance: Number(account.balance),
      availableBalance: Number(account.availableBalance),
      heldBalance: Number(account.heldBalance),
    };
  }

  /**
   * Top up wallet from external payment
   * Debit: UBI_FLOAT
   * Credit: USER_WALLET
   */
  async topUp(params: TopUpParams) {
    const {
      userId,
      amount,
      currency,
      paymentTransactionId,
      description,
      metadata,
    } = params;

    if (amount <= 0) {
      throw new Error("Amount must be positive");
    }

    return await this.prisma.$transaction(async (tx) => {
      // Get or create user wallet
      const userAccount = await this.getOrCreateWalletAccount(
        userId,
        AccountType.USER_WALLET,
        currency,
      );

      // Get UBI float account
      const floatAccount = await tx.walletAccount.findFirst({
        where: {
          accountType: AccountType.UBI_FLOAT,
          currency,
          userId: null,
        },
      });

      if (!floatAccount) {
        throw new Error(`UBI_FLOAT account not found for ${currency}`);
      }

      // Create transaction
      const transaction = await tx.transaction.create({
        data: {
          idempotencyKey: `topup-${paymentTransactionId}`,
          transactionType: TransactionType.WALLET_TOPUP,
          status: TransactionStatus.COMPLETED,
          amount,
          currency,
          description: description || `Wallet top-up`,
          metadata: {
            ...metadata,
            paymentTransactionId,
            userId,
          },
          completedAt: new Date(),
        },
      });

      // Debit float account
      const floatNewBalance = Number(floatAccount.balance) - amount;
      await this.createLedgerEntry(tx, {
        transactionId: transaction.id,
        accountId: floatAccount.id,
        entryType: EntryType.DEBIT,
        amount,
        balanceAfter: floatNewBalance,
        description: `Wallet top-up for user ${userId}`,
      });

      await tx.walletAccount.update({
        where: { id: floatAccount.id },
        data: {
          balance: floatNewBalance,
          availableBalance: floatNewBalance,
        },
      });

      // Credit user wallet
      const userNewBalance = Number(userAccount.balance) + amount;
      await this.createLedgerEntry(tx, {
        transactionId: transaction.id,
        accountId: userAccount.id,
        entryType: EntryType.CREDIT,
        amount,
        balanceAfter: userNewBalance,
        description: description || `Wallet top-up`,
      });

      await tx.walletAccount.update({
        where: { id: userAccount.id },
        data: {
          balance: userNewBalance,
          availableBalance: userNewBalance,
        },
      });

      return {
        transaction,
        newBalance: userNewBalance,
      };
    });
  }

  /**
   * Withdraw from wallet to external account
   * Debit: USER_WALLET
   * Credit: UBI_FLOAT
   */
  async withdraw(params: WithdrawParams) {
    const { userId, amount, currency, payoutId, description, metadata } =
      params;

    if (amount <= 0) {
      throw new Error("Amount must be positive");
    }

    return await this.prisma.$transaction(async (tx) => {
      // Get user wallet
      const userAccount = await tx.walletAccount.findFirst({
        where: {
          userId,
          accountType: AccountType.USER_WALLET,
          currency,
        },
        select: {
          id: true,
          balance: true,
          availableBalance: true,
        },
      });

      if (!userAccount) {
        throw new Error("Wallet account not found");
      }

      if (Number(userAccount.availableBalance) < amount) {
        throw new Error("Insufficient balance");
      }

      // Get UBI float account
      const floatAccount = await tx.walletAccount.findFirst({
        where: {
          accountType: AccountType.UBI_FLOAT,
          currency,
          userId: null,
        },
      });

      if (!floatAccount) {
        throw new Error(`UBI_FLOAT account not found for ${currency}`);
      }

      // Create transaction
      const transaction = await tx.transaction.create({
        data: {
          idempotencyKey: payoutId || `withdrawal-${userId}-${nanoid()}`,
          transactionType: TransactionType.WALLET_WITHDRAWAL,
          status: TransactionStatus.COMPLETED,
          amount,
          currency,
          description: description || `Wallet withdrawal`,
          metadata: {
            ...metadata,
            payoutId,
            userId,
          },
          completedAt: new Date(),
        },
      });

      // Debit user wallet
      const userNewBalance = Number(userAccount.balance) - amount;
      await this.createLedgerEntry(tx, {
        transactionId: transaction.id,
        accountId: userAccount.id,
        entryType: EntryType.DEBIT,
        amount,
        balanceAfter: userNewBalance,
        description: description || `Wallet withdrawal`,
      });

      await tx.walletAccount.update({
        where: { id: userAccount.id },
        data: {
          balance: userNewBalance,
          availableBalance: userNewBalance,
        },
      });

      // Credit float account
      const floatNewBalance = Number(floatAccount.balance) + amount;
      await this.createLedgerEntry(tx, {
        transactionId: transaction.id,
        accountId: floatAccount.id,
        entryType: EntryType.CREDIT,
        amount,
        balanceAfter: floatNewBalance,
        description: `Withdrawal from user ${userId}`,
      });

      await tx.walletAccount.update({
        where: { id: floatAccount.id },
        data: {
          balance: floatNewBalance,
          availableBalance: floatNewBalance,
        },
      });

      return {
        transaction,
        newBalance: userNewBalance,
      };
    });
  }

  /**
   * Internal transfer between two accounts
   * Debit: From Account
   * Credit: To Account
   */
  async transfer(params: TransferParams) {
    const {
      fromAccountId,
      toAccountId,
      amount,
      currency,
      description,
      metadata,
      idempotencyKey,
    } = params;

    if (amount <= 0) {
      throw new Error("Amount must be positive");
    }

    if (fromAccountId === toAccountId) {
      throw new Error("Cannot transfer to same account");
    }

    return await this.prisma.$transaction(async (tx) => {
      // Get from account
      const fromAccount = await tx.walletAccount.findUnique({
        where: { id: fromAccountId },
      });

      if (!fromAccount) {
        throw new Error("From account not found");
      }

      if (fromAccount.currency !== currency) {
        throw new Error("Currency mismatch");
      }

      if (Number(fromAccount.availableBalance) < amount) {
        throw new Error("Insufficient balance");
      }

      // Get to account
      const toAccount = await tx.walletAccount.findUnique({
        where: { id: toAccountId },
      });

      if (!toAccount) {
        throw new Error("To account not found");
      }

      if (toAccount.currency !== currency) {
        throw new Error("Currency mismatch");
      }

      // Create transaction
      const transaction = await tx.transaction.create({
        data: {
          idempotencyKey: idempotencyKey || `transfer-${nanoid()}`,
          transactionType: TransactionType.INTERNAL_TRANSFER,
          status: TransactionStatus.COMPLETED,
          amount,
          currency,
          description: description || `Internal transfer`,
          metadata: {
            ...metadata,
            fromAccountId,
            toAccountId,
          },
          completedAt: new Date(),
        },
      });

      // Debit from account
      const fromNewBalance = Number(fromAccount.balance) - amount;
      await this.createLedgerEntry(tx, {
        transactionId: transaction.id,
        accountId: fromAccountId,
        entryType: EntryType.DEBIT,
        amount,
        balanceAfter: fromNewBalance,
        description: description || `Transfer to ${toAccount.accountType}`,
      });

      await tx.walletAccount.update({
        where: { id: fromAccountId },
        data: {
          balance: fromNewBalance,
          availableBalance: fromNewBalance,
        },
      });

      // Credit to account
      const toNewBalance = Number(toAccount.balance) + amount;
      await this.createLedgerEntry(tx, {
        transactionId: transaction.id,
        accountId: toAccountId,
        entryType: EntryType.CREDIT,
        amount,
        balanceAfter: toNewBalance,
        description: description || `Transfer from ${fromAccount.accountType}`,
      });

      await tx.walletAccount.update({
        where: { id: toAccountId },
        data: {
          balance: toNewBalance,
          availableBalance: toNewBalance,
        },
      });

      return {
        transaction,
        fromBalance: fromNewBalance,
        toBalance: toNewBalance,
      };
    });
  }

  /**
   * Place hold on funds (pre-authorization)
   * Used during ride matching to reserve funds
   */
  async holdFunds(params: HoldParams) {
    const {
      accountId,
      amount,
      currency,
      reason,
      reference,
      expiresInMinutes = 30,
      metadata,
    } = params;

    if (amount <= 0) {
      throw new Error("Amount must be positive");
    }

    return await this.prisma.$transaction(async (tx) => {
      // Get account
      const account = await tx.walletAccount.findUnique({
        where: { id: accountId },
      });

      if (!account) {
        throw new Error("Account not found");
      }

      if (account.currency !== currency) {
        throw new Error("Currency mismatch");
      }

      if (Number(account.availableBalance) < amount) {
        throw new Error("Insufficient available balance");
      }

      // Create hold
      const hold = await tx.balanceHold.create({
        data: {
          accountId,
          amount,
          currency,
          reason,
          reference,
          expiresAt: new Date(Date.now() + expiresInMinutes * 60 * 1000),
          metadata,
        },
      });

      // Update balances
      await tx.walletAccount.update({
        where: { id: accountId },
        data: {
          availableBalance: Number(account.availableBalance) - amount,
          heldBalance: Number(account.heldBalance) + amount,
        },
      });

      return hold;
    });
  }

  /**
   * Release held funds
   */
  async releaseFunds(holdId: string) {
    return await this.prisma.$transaction(async (tx) => {
      const hold = await tx.balanceHold.findUnique({
        where: { id: holdId },
        include: { account: true },
      });

      if (!hold) {
        throw new Error("Hold not found");
      }

      if (hold.isReleased) {
        throw new Error("Hold already released");
      }

      // Update hold
      await tx.balanceHold.update({
        where: { id: holdId },
        data: {
          isReleased: true,
          releasedAt: new Date(),
        },
      });

      // Update account balances
      await tx.walletAccount.update({
        where: { id: hold.accountId },
        data: {
          availableBalance:
            Number(hold.account.availableBalance) + Number(hold.amount),
          heldBalance: Number(hold.account.heldBalance) - Number(hold.amount),
        },
      });

      return hold;
    });
  }

  /**
   * Capture held funds (convert hold to actual debit)
   */
  async captureFunds(
    holdId: string,
    transactionParams: {
      transactionType: TransactionType;
      toAccountId: string;
      description?: string;
      metadata?: Record<string, any>;
    },
  ) {
    return await this.prisma.$transaction(async (tx) => {
      const hold = await tx.balanceHold.findUnique({
        where: { id: holdId },
        include: { account: true },
      });

      if (!hold) {
        throw new Error("Hold not found");
      }

      if (hold.isReleased) {
        throw new Error("Hold already released");
      }

      const { transactionType, toAccountId, description, metadata } =
        transactionParams;

      // Create transaction
      const transaction = await tx.transaction.create({
        data: {
          idempotencyKey: `capture-${holdId}`,
          transactionType,
          status: TransactionStatus.COMPLETED,
          amount: Number(hold.amount),
          currency: hold.currency,
          description: description || `Capture hold ${holdId}`,
          metadata: {
            ...metadata,
            holdId,
            fromAccountId: hold.accountId,
            toAccountId,
          },
          completedAt: new Date(),
        },
      });

      // Debit from account (reduce actual balance)
      const fromNewBalance = Number(hold.account.balance) - Number(hold.amount);
      await this.createLedgerEntry(tx, {
        transactionId: transaction.id,
        accountId: hold.accountId,
        entryType: EntryType.DEBIT,
        amount: Number(hold.amount),
        balanceAfter: fromNewBalance,
        description: description || `Capture hold ${holdId}`,
      });

      await tx.walletAccount.update({
        where: { id: hold.accountId },
        data: {
          balance: fromNewBalance,
          heldBalance: Number(hold.account.heldBalance) - Number(hold.amount),
        },
      });

      // Credit to account
      const toAccount = await tx.walletAccount.findUnique({
        where: { id: toAccountId },
      });

      if (!toAccount) {
        throw new Error("To account not found");
      }

      const toNewBalance = Number(toAccount.balance) + Number(hold.amount);
      await this.createLedgerEntry(tx, {
        transactionId: transaction.id,
        accountId: toAccountId,
        entryType: EntryType.CREDIT,
        amount: Number(hold.amount),
        balanceAfter: toNewBalance,
        description: description || `Capture hold ${holdId}`,
      });

      await tx.walletAccount.update({
        where: { id: toAccountId },
        data: {
          balance: toNewBalance,
          availableBalance:
            Number(toAccount.availableBalance) + Number(hold.amount),
        },
      });

      // Mark hold as released
      await tx.balanceHold.update({
        where: { id: holdId },
        data: {
          isReleased: true,
          releasedAt: new Date(),
        },
      });

      return {
        transaction,
        hold,
        fromBalance: fromNewBalance,
        toBalance: toNewBalance,
      };
    });
  }

  /**
   * Verify ledger balance integrity
   * Calculate balance from ledger entries and compare with stored balance
   */
  async verifyBalance(accountId: string): Promise<LedgerSummary> {
    const account = await this.prisma.walletAccount.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      throw new Error("Account not found");
    }

    // Calculate balance from ledger entries
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { accountId },
      orderBy: { createdAt: "asc" },
    });

    let calculatedBalance = 0;
    let totalDebits = 0;
    let totalCredits = 0;

    for (const entry of entries) {
      const amount = Number(entry.amount);
      if (entry.entryType === EntryType.DEBIT) {
        calculatedBalance -= amount;
        totalDebits += amount;
      } else {
        calculatedBalance += amount;
        totalCredits += amount;
      }
    }

    const storedBalance = Number(account.balance);
    const isBalanced = Math.abs(calculatedBalance - storedBalance) < 0.01; // Allow 1 cent tolerance

    return {
      accountId,
      totalDebits,
      totalCredits,
      calculatedBalance,
      storedBalance,
      isBalanced,
    };
  }

  /**
   * Helper: Create ledger entry
   */
  private async createLedgerEntry(
    tx: any,
    params: {
      transactionId: string;
      accountId: string;
      entryType: EntryType;
      amount: number;
      balanceAfter: number;
      description?: string;
      metadata?: Record<string, any>;
    },
  ) {
    return await tx.ledgerEntry.create({
      data: {
        transactionId: params.transactionId,
        accountId: params.accountId,
        entryType: params.entryType,
        amount: params.amount,
        balanceAfter: params.balanceAfter,
        description: params.description,
        metadata: params.metadata,
      },
    });
  }

  /**
   * Get transaction history for account
   */
  async getTransactionHistory(
    accountId: string,
    options?: {
      limit?: number;
      offset?: number;
      startDate?: Date;
      endDate?: Date;
    },
  ) {
    const { limit = 50, offset = 0, startDate, endDate } = options || {};

    const where: any = { accountId };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = startDate;
      }
      if (endDate) {
        where.createdAt.lte = endDate;
      }
    }

    const entries = await this.prisma.ledgerEntry.findMany({
      where,
      include: {
        transaction: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });

    return entries;
  }

  /**
   * Cleanup expired holds
   */
  async cleanupExpiredHolds() {
    const expiredHolds = await this.prisma.balanceHold.findMany({
      where: {
        isReleased: false,
        expiresAt: {
          lt: new Date(),
        },
      },
      include: { account: true },
    });

    for (const hold of expiredHolds) {
      try {
        await this.releaseFunds(hold.id);
      } catch (error) {
        console.error(`Failed to release expired hold ${hold.id}:`, error);
      }
    }

    return { released: expiredHolds.length };
  }
}

// Singleton instance
let walletServiceInstance: WalletService | null = null;

// Create new instance
export function createWalletService(prisma: PrismaClient): WalletService {
  return new WalletService(prisma);
}

// Get singleton instance
export function getWalletService(prisma: PrismaClient): WalletService {
  if (!walletServiceInstance) {
    walletServiceInstance = createWalletService(prisma);
  }
  return walletServiceInstance;
}
