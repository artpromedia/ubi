/**
 * Prisma Client Instance
 *
 * Singleton pattern for database connection across the monorepo.
 */

import { PrismaClient } from "@prisma/client";

// Extend global type for singleton
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

/**
 * Shared Prisma client instance.
 * Uses singleton pattern to prevent multiple database connections.
 */
export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
export { PrismaClient };

/**
 * Graceful database disconnect
 */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
