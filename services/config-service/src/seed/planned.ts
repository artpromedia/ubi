/**
 * The planned-expansion rows: named as intent on the marketing site, no
 * config, no flags, no dates.
 */
import { PLANNED_CITIES, upsertCityRow } from "./cities";
import { type SeedEnv, assertSeedAllowed } from "./lagos";
import { prisma } from "../lib/prisma";

export async function seedPlannedCities(
  env: SeedEnv = process.env,
): Promise<readonly string[]> {
  assertSeedAllowed(env);
  await prisma.$transaction(async (tx) => {
    for (const city of PLANNED_CITIES) {
      await upsertCityRow(tx, city);
    }
  });
  return PLANNED_CITIES.map((city) => city.id);
}
