/**
 * Entry point for `pnpm --filter @ubi/config-service seed`.
 *
 * Refuses to run in production and without CONFIG_SEED_ENABLED=true; see
 * ./lagos.ts.
 */
import { configCache } from "../lib/cache";
import { seedLogger } from "../lib/logger";
import { disconnectPrisma } from "../lib/prisma";
import { disconnectRedis } from "../lib/redis";
import { SEED_CACHE_SCOPES, seedLagos } from "./lagos";

async function main(): Promise<void> {
  const result = await seedLagos();
  for (const scopeId of SEED_CACHE_SCOPES) {
    await configCache.invalidate(
      { kind: "config", scopeId },
      { kind: "config", scopeId },
    );
    await configCache.invalidate(
      { kind: "flags", scopeId },
      { kind: "flags", scopeId },
    );
  }
  seedLogger.info(result, "seed complete");
}

main()
  .catch((err: unknown) => {
    seedLogger.error({ err }, "seed failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
    await disconnectRedis();
  });
