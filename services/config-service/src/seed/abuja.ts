/**
 * Abuja (ABV) launch configuration.
 *
 * Mirrors Lagos: NGN with 2 fraction digits, emergency 112, classes
 * go/comfort/xl, the same payment methods, PIN mandatory, 5:00 free wait, the
 * same TTLs and the same 20 % service fee. The airport block names Nnamdi
 * Azikiwe (ABV) with its doors; the door labels are PROVISIONAL from ops and
 * must be confirmed on site before launch.
 *
 * Every money figure below is PROVISIONAL pending ops/finance sign-off, under
 * the same sign-off as the Lagos values, and is seeded so the service is not
 * left with broken sentinels. Both launch cities carry status `launching`
 * until launch day; `setCityStatus` activates them together.
 */
import { type CityConfig, CityConfigSchema } from "@ubi/contracts";

import { ABUJA_CITY } from "./cities";
import { type SeedResult, seedCityConfig } from "./city-config";
import { type SeedEnv, assertSeedAllowed, lagosConfig } from "./lagos";

export { ABUJA_CITY };

/**
 * Flags on for Abuja before launch: none. Abuja's services are switched on
 * together with Lagos's in the launch change (one approved status change with
 * flags), never on their own.
 */
export const ABUJA_ENABLED_FLAGS = [] as const;

export function abujaConfig(version: number): CityConfig {
  const lagos = lagosConfig(version);
  return CityConfigSchema.parse({
    ...lagos,
    cityId: ABUJA_CITY.id,
    timezone: ABUJA_CITY.timezone,
    airport: {
      ...lagos.airport,
      codes: ["ABV"],
      // PROVISIONAL door labels for Nnamdi Azikiwe International Airport; ops
      // confirm on site before launch.
      doors: {
        international_arrivals: "International Arrivals Door 1",
        domestic_arrivals: "Domestic Arrivals Door 2",
        international_departures: "International Departures Door 3",
        domestic_departures: "Domestic Departures Door 1",
      },
    },
  });
}

export async function seedAbuja(
  env: SeedEnv = process.env,
): Promise<SeedResult> {
  assertSeedAllowed(env);
  const result = await seedCityConfig({
    city: ABUJA_CITY,
    config: abujaConfig,
    enabledFlags: ABUJA_ENABLED_FLAGS,
    reason: "initial abuja configuration",
  });
  return result;
}
