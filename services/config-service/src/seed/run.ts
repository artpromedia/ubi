/**
 * Entry point for `pnpm --filter @ubi/config-service seed`.
 *
 * Seeds the two launch cities (Lagos, Abuja) with their provisional configs
 * and the eight planned rows. Refuses to run in production and without
 * CONFIG_SEED_ENABLED=true; see ./lagos.ts.
 */
import { seedAbuja } from "./abuja";
import { seedLagos } from "./lagos";
import { seedPlannedCities } from "./planned";
import { GLOBAL_SCOPE, configCache } from "../lib/cache";
import { seedLogger } from "../lib/logger";
import { disconnectPrisma } from "../lib/prisma";
import { disconnectRedis } from "../lib/redis";

async function main(): Promise<void> {
  const lagos = await seedLagos();
  const abuja = await seedAbuja();
  const planned = await seedPlannedCities();
  for (const scopeId of [lagos.cityId, abuja.cityId, GLOBAL_SCOPE]) {
    await configCache.invalidate(
      { kind: "config", scopeId },
      { kind: "config", scopeId },
    );
    await configCache.invalidate(
      { kind: "flags", scopeId },
      { kind: "flags", scopeId },
    );
  }
  seedLogger.info({ lagos, abuja, planned }, "seed complete");
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
