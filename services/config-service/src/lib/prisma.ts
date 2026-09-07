/**
 * Prisma client singleton. Postgres is the source of truth for config and
 * flags; Redis is only ever a cache in front of it.
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  ubiConfigPrisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.ubiConfigPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.ubiConfigPrisma = prisma;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

export async function checkPrismaConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
