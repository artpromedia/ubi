/**
 * Batch Operations Service
 *
 * Provides efficient batch processing for high-volume operations:
 * - Batch wallet balance lookups
 * - Batch payment status checks
 * - Batch transaction processing
 */

import {
  type AccountType,
  type Currency,
  type TransactionStatus,
} from "@prisma/client";

import { perfLogger } from "../lib/logger.js";
import {
  BatchProcessor,
  performanceMonitor,
  walletCache,
} from "../lib/performance.js";
import { prisma } from "../lib/prisma.js";

// =============================================================================
// BATCH WALLET BALANCE LOOKUP
// =============================================================================

interface WalletBalanceRequest {
  userId: string;
  accountType: AccountType;
  currency: Currency;
}

interface WalletBalanceResult {
  userId: string;
  balance: number;
  availableBalance: number;
  heldBalance: number;
}

/**
 * Batch processor for wallet balance lookups
 */
const walletBalanceBatch = new BatchProcessor<
  WalletBalanceRequest,
  WalletBalanceResult
>(
  async (items) => {
    const startTime = Date.now();
    const results = new Map<string, WalletBalanceResult>();

    // Group by account type and currency for efficient queries
    const groups = new Map<string, string[]>();
    for (const item of items) {
      const groupKey = `${item.data.accountType}:${item.data.currency}`;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(item.data.userId);
    }

    // Query each group
    for (const [groupKey, userIds] of groups) {
      const [accountType, currency] = groupKey.split(":") as [
        AccountType,
        Currency,
      ];

      const accounts = await prisma.walletAccount.findMany({
        where: {
          userId: { in: userIds },
          accountType,
          currency,
        },
        select: {
          userId: true,
          balance: true,
          availableBalance: true,
          heldBalance: true,
        },
      });

      // Map results
      for (const account of accounts) {
        const result: WalletBalanceResult = {
          userId: account.userId!,
          balance: Number(account.balance),
          availableBalance: Number(account.availableBalance),
          heldBalance: Number(account.heldBalance),
        };

        // Find the item ID for this result
        const item = items.find(
          (i) =>
            i.data.userId === account.userId &&
            i.data.accountType === accountType &&
            i.data.currency === currency,
        );

        if (item) {
          results.set(item.id, result);

          // Update cache
          const cacheKey = `${account.userId}:${accountType}`;
          await walletCache.setBalance(cacheKey, currency, {
            balance: result.balance,
            availableBalance: result.availableBalance,
            heldBalance: result.heldBalance,
          });
        }
      }

      // Handle missing accounts (return zero balances)
      for (const userId of userIds) {
        const item = items.find(
          (i) =>
            i.data.userId === userId &&
            i.data.accountType === accountType &&
            i.data.currency === currency,
        );

        if (item && !results.has(item.id)) {
          results.set(item.id, {
            userId,
            balance: 0,
            availableBalance: 0,
            heldBalance: 0,
          });
        }
      }
    }

    await performanceMonitor.recordTiming(
      "batch.walletBalance",
      Date.now() - startTime,
      { batchSize: items.length.toString() },
    );

    perfLogger.debug(
      { batchSize: items.length, duration: Date.now() - startTime },
      "Batch wallet balance lookup completed",
    );

    return results;
  },
  {
    maxBatchSize: 100,
    maxWaitMs: 10,
    onError: (error, items) => {
      perfLogger.error(
        { err: error, itemCount: items.length },
        "Batch wallet balance lookup failed",
      );
    },
  },
);

/**
 * Get wallet balance with batching
 */
export async function getBatchedWalletBalance(
  userId: string,
  accountType: AccountType,
  currency: Currency,
): Promise<WalletBalanceResult> {
  return walletBalanceBatch.add({
    id: `${userId}:${accountType}:${currency}`,
    data: { userId, accountType, currency },
  });
}

// =============================================================================
// BATCH TRANSACTION STATUS LOOKUP
// =============================================================================

interface TransactionStatusRequest {
  transactionId: string;
}

interface TransactionStatusResult {
  transactionId: string;
  status: TransactionStatus;
  amount: number;
  currency: Currency;
  completedAt: Date | null;
}

/**
 * Batch processor for transaction status lookups
 */
const transactionStatusBatch = new BatchProcessor<
  TransactionStatusRequest,
  TransactionStatusResult
>(
  async (items) => {
    const startTime = Date.now();
    const results = new Map<string, TransactionStatusResult>();

    const transactionIds = items.map((item) => item.data.transactionId);

    const transactions = await prisma.transaction.findMany({
      where: {
        id: { in: transactionIds },
      },
      select: {
        id: true,
        status: true,
        amount: true,
        currency: true,
        completedAt: true,
      },
    });

    for (const tx of transactions) {
      const item = items.find((i) => i.data.transactionId === tx.id);
      if (item) {
        results.set(item.id, {
          transactionId: tx.id,
          status: tx.status,
          amount: Number(tx.amount),
          currency: tx.currency,
          completedAt: tx.completedAt,
        });
      }
    }

    await performanceMonitor.recordTiming(
      "batch.transactionStatus",
      Date.now() - startTime,
      { batchSize: items.length.toString() },
    );

    return results;
  },
  {
    maxBatchSize: 200,
    maxWaitMs: 5,
    onError: (error, items) => {
      perfLogger.error(
        { err: error, itemCount: items.length },
        "Batch transaction status lookup failed",
      );
    },
  },
);

/**
 * Get transaction status with batching
 */
export async function getBatchedTransactionStatus(
  transactionId: string,
): Promise<TransactionStatusResult | null> {
  try {
    return await transactionStatusBatch.add({
      id: transactionId,
      data: { transactionId },
    });
  } catch {
    return null;
  }
}

// =============================================================================
// BULK OPERATIONS
// =============================================================================

/**
 * Bulk get wallet balances (direct, non-batched)
 * Use when you have many requests at once
 */
export async function bulkGetWalletBalances(
  requests: WalletBalanceRequest[],
): Promise<Map<string, WalletBalanceResult>> {
  const startTime = Date.now();
  const results = new Map<string, WalletBalanceResult>();

  if (requests.length === 0) {
    return results;
  }

  // Group by account type and currency
  const groups = new Map<
    string,
    { userIds: string[]; requests: WalletBalanceRequest[] }
  >();

  for (const req of requests) {
    const groupKey = `${req.accountType}:${req.currency}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { userIds: [], requests: [] });
    }
    const group = groups.get(groupKey)!;
    group.userIds.push(req.userId);
    group.requests.push(req);
  }

  // Query each group in parallel
  await Promise.all(
    Array.from(groups.entries()).map(async ([groupKey, group]) => {
      const [accountType, currency] = groupKey.split(":") as [
        AccountType,
        Currency,
      ];

      const accounts = await prisma.walletAccount.findMany({
        where: {
          userId: { in: group.userIds },
          accountType,
          currency,
        },
        select: {
          userId: true,
          balance: true,
          availableBalance: true,
          heldBalance: true,
        },
      });

      const accountMap = new Map(accounts.map((a) => [a.userId, a]));

      for (const req of group.requests) {
        const key = `${req.userId}:${req.accountType}:${req.currency}`;
        const account = accountMap.get(req.userId);

        results.set(key, {
          userId: req.userId,
          balance: account ? Number(account.balance) : 0,
          availableBalance: account ? Number(account.availableBalance) : 0,
          heldBalance: account ? Number(account.heldBalance) : 0,
        });
      }
    }),
  );

  await performanceMonitor.recordTiming(
    "bulk.walletBalances",
    Date.now() - startTime,
    { count: requests.length.toString() },
  );

  return results;
}

/**
 * Bulk get transaction statuses
 */
export async function bulkGetTransactionStatuses(
  transactionIds: string[],
): Promise<Map<string, TransactionStatusResult>> {
  const startTime = Date.now();
  const results = new Map<string, TransactionStatusResult>();

  if (transactionIds.length === 0) {
    return results;
  }

  const transactions = await prisma.transaction.findMany({
    where: {
      id: { in: transactionIds },
    },
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      completedAt: true,
    },
  });

  for (const tx of transactions) {
    results.set(tx.id, {
      transactionId: tx.id,
      status: tx.status,
      amount: Number(tx.amount),
      currency: tx.currency,
      completedAt: tx.completedAt,
    });
  }

  await performanceMonitor.recordTiming(
    "bulk.transactionStatuses",
    Date.now() - startTime,
    { count: transactionIds.length.toString() },
  );

  return results;
}

/**
 * Process transactions in batches
 */
export async function processInBatches<T, R>(
  items: T[],
  processor: (batch: T[]) => Promise<R[]>,
  options: {
    batchSize?: number;
    concurrency?: number;
    onBatchComplete?: (results: R[], batchIndex: number) => void;
    onError?: (error: Error, batch: T[], batchIndex: number) => void;
  } = {},
): Promise<R[]> {
  const { batchSize = 50, concurrency = 3, onBatchComplete, onError } = options;

  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  const allResults: R[] = [];

  // Process batches with limited concurrency
  for (let i = 0; i < batches.length; i += concurrency) {
    const currentBatches = batches.slice(i, i + concurrency);

    const batchResults = await Promise.allSettled(
      currentBatches.map(async (batch, localIndex) => {
        const globalIndex = i + localIndex;
        try {
          const results = await processor(batch);
          onBatchComplete?.(results, globalIndex);
          return results;
        } catch (error) {
          onError?.(error as Error, batch, globalIndex);
          throw error;
        }
      }),
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        allResults.push(...result.value);
      }
    }
  }

  return allResults;
}
