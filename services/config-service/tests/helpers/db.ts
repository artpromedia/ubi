/**
 * Integration-test helpers. These talk to the same Postgres and Redis the
 * service uses; nothing here is mocked.
 */
import { configCache } from "@/lib/cache";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { seedLagos } from "@/seed/lagos";

export const SEED_ENV = {
  NODE_ENV: "test",
  CONFIG_SEED_ENABLED: "true",
} as const;

/** Tables this service owns, in an order Postgres accepts. */
const TABLES = [
  "config_approvals",
  "config_change_requests",
  "city_config_versions",
  "flag_rules",
  "feature_flags",
  "audit_log",
  "outbox_events",
  "cities",
];

export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

export async function resetCache(): Promise<void> {
  const keys = [
    ...(await redis.keys("ubi:config:*")),
    ...(await redis.keys("ubi:flags:*")),
  ];
  if (keys.length > 0) await redis.del(...keys);
}

export async function resetAll(): Promise<void> {
  await resetDatabase();
  await resetCache();
}

export async function seedLagosForTest(): Promise<void> {
  await seedLagos(SEED_ENV);
  await configCache.invalidate(
    { kind: "config", scopeId: "LOS" },
    { kind: "config", scopeId: "LOS" },
  );
  await configCache.invalidate(
    { kind: "flags", scopeId: "LOS" },
    { kind: "flags", scopeId: "LOS" },
  );
}

export async function closeConnections(): Promise<void> {
  await prisma.$disconnect();
  await redis.quit();
}

export function adminHeaders(
  userId: string,
  idempotencyKey?: string,
): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-user-id": userId,
    "x-user-role": "config_admin",
    ...(idempotencyKey === undefined
      ? {}
      : { "idempotency-key": idempotencyKey }),
  };
}
