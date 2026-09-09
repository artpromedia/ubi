/**
 * Prisma client singleton.
 *
 * Every mutating flow in this service opens a transaction on this client, so the
 * travel_order_events row, the state change and the outbox row commit together
 * or not at all (CLAUDE.md #2).
 */
import { PrismaClient } from "@prisma/client";

import { dbLogger } from "./logger";

const globalForPrisma = globalThis as unknown as {
  travelPrisma: PrismaClient | undefined;
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
  globalForPrisma.travelPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.travelPrisma = prisma;
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
