/**
 * Database Types
 *
 * Common database-related types used across the monorepo.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Transaction client type for Prisma transactions
 */
export type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Database operation result with pagination
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/**
 * Common pagination input
 */
export interface PaginationInput {
  page?: number;
  limit?: number;
}

/**
 * Sort order type
 */
export type SortOrder = "asc" | "desc";

/**
 * Common sort input
 */
export interface SortInput {
  field: string;
  order: SortOrder;
}

// Re-export useful Prisma types
export type { Prisma };
