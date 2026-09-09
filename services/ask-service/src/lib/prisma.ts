/**
 * Prisma client singleton.
 *
 * Every mutating action in this service runs inside a transaction opened on this
 * client, so the domain row, the ai_actions log row and the outbox row commit
 * together or not at all (CLAUDE.md #2, #3).
 */
import { PrismaClient } from "@prisma/client";

import { dbLogger } from "./logger";

const globalForPrisma = globalThis as unknown as {
  askPrisma: PrismaClient | undefined;
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
  globalForPrisma.askPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.askPrisma = prisma;
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
