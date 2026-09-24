/**
 * Prisma client singleton.
 *
 * Every mutating flow opens a transaction on this client, so the state change,
 * its audit row and its outbox rows commit together or not at all
 * (CLAUDE.md #2; ops/outbox.ts).
 */
import { PrismaClient } from "@prisma/client";

import { dbLogger } from "./logger";

const globalForPrisma = globalThis as unknown as {
  fleetPrisma: PrismaClient | undefined;
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
  globalForPrisma.fleetPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.fleetPrisma = prisma;
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
