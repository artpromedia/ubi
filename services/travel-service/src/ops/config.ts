/**
 * City configuration and feature flags for travel.
 *
 * The currency a traveller is charged in, and whether flights or stays are even
 * bookable in this city, come from the active two-person-approved city config
 * version and the per-city flag rules (CLAUDE.md #1, #5). There is not a single
 * currency literal or a flag default of `true` in this service.
 *
 * When the config cannot be read the service fails closed: bookings are refused
 * with `config_unavailable` and every flag reads as off.
 */
import {
  CityConfigSchema,
  type CityConfig,
  ContractError,
  DENY_ALL,
  type FlagKey,
  type FlagSet,
  featureDisabled,
  isEnabled,
} from "@ubi/contracts";

import { logger } from "../lib/logger";

import type { TravelTx } from "./types";

export interface BaseCityConfig {
  readonly city: CityConfig;
  readonly flags: FlagSet;
}

export interface CityConfigProvider {
  /** Throws `city_unsupported` / `config_unavailable` when there is no active, valid version. */
  load(cityId: string): Promise<BaseCityConfig>;
}

const configUnavailable = (cityId: string, reason: string): ContractError =>
  new ContractError(
    "config_unavailable",
    "city configuration is unavailable; travel booking is closed until it is restored",
    { cityId, reason },
  );

export function createCityConfigProvider(db: TravelTx): CityConfigProvider {
  async function loadFlags(cityId: string): Promise<FlagSet> {
    try {
      const flags = await db.featureFlag.findMany({
        include: { rules: { where: { cityId } } },
      });
      const resolved: Record<string, boolean> = { ...DENY_ALL };
      for (const flag of flags) {
        const rule = flag.rules[0];
        resolved[flag.key] = rule === undefined ? flag.defaultOn : rule.enabled;
      }
      return resolved as FlagSet;
    } catch (error) {
      logger.error(
        { err: error, cityId },
        "flag lookup failed; denying all flags",
      );
      return DENY_ALL;
    }
  }

  return {
    async load(cityId: string): Promise<BaseCityConfig> {
      const city = await db.city.findUnique({ where: { id: cityId } });
      if (city === null || !city.active) {
        throw new ContractError(
          "city_unsupported",
          "UBI is not live in that city",
          { cityId },
        );
      }

      const version = await db.cityConfigVersion.findFirst({
        where: { cityId, activatedAt: { not: null } },
        orderBy: [{ activatedAt: "desc" }, { version: "desc" }],
      });
      if (version === null) {
        throw configUnavailable(cityId, "no activated config version");
      }

      const parsed = CityConfigSchema.safeParse(version.config);
      if (!parsed.success) {
        logger.error(
          { cityId, version: version.version, issues: parsed.error.issues.length },
          "active city config failed validation",
        );
        throw configUnavailable(cityId, "active config version failed validation");
      }

      const flags = await loadFlags(cityId);
      return { city: parsed.data, flags };
    },
  };
}

/** Deep links to a disabled vertical must 404, never 403 (CLAUDE.md #5, #8). */
export function assertFlagEnabled(flags: FlagSet, key: FlagKey): void {
  if (!isEnabled(flags, key)) {
    throw featureDisabled(key);
  }
}
