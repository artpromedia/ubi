/**
 * Prisma client singleton.
 *
 * Every mutating action in this service goes through a transaction opened on
 * this client, so the audit row and the outbox row commit with the state change
 * — a reservation, a campaign transition, an incentive posting — or not at all.
 */
import { PrismaClient } from "@prisma/client";

import { dbLogger } from "./logger";

const globalForPrisma = globalThis as unknown as {
  growthPrisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: [
      { emit: "stdout", level: "error" },
      { emit: "stdout", level: "warn" },
    ],
  });
}

export const prisma: PrismaClient =
  globalForPrisma.growthPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.growthPrisma = prisma;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  dbLogger.info("prisma disconnected");
}

export async function checkPrismaConnection(): Promise<{
  healthy: boolean;
  latencyMs?: number;
}> {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { healthy: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    dbLogger.error({ err: error }, "prisma connection check failed");
    return { healthy: false };
  }
}
