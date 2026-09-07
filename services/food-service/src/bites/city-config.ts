/**
 * City configuration for Bites.
 *
 * Every number Bites promises a customer — the delivery fee, the service fee,
 * the ETA it quotes, and how long a merchant has to answer an issue before it is
 * auto-accepted — comes from the active, two-person-approved city config version
 * (CLAUDE.md #1, #5). There is not a single currency, fee or window literal in
 * this module.
 *
 * When the config cannot be read the module fails closed: reads and writes are
 * refused with `config_unavailable` and every feature flag reads as off. A
 * disabled `bites` flag is a 404, so a deep link to a city where Bites is off is
 * invisible rather than forbidden (CLAUDE.md #5, #8).
 */
import { z } from "zod";

import {
  CityConfigSchema,
  type CityConfig,
  ContractError,
  DENY_ALL,
  type FlagKey,
  type FlagSet,
  isEnabled,
  featureDisabled,
} from "@ubi/contracts";

import { logger } from "./lib/logger.js";

import type { BitesTx } from "./lib/types.js";

const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();

/**
 * The Bites policy block of the city config document. It sits beside the ride
 * fares and the wallet policy under the same versioned, approved document, so
 * changing the delivery fee or the issue window is a config change request with
 * two approvers — not a deploy.
 */
export const BitesPolicySchema = z.object({
  /** The courier delivery fee quoted on every merchant in this city, minor units. */
  deliveryFeeMinor: nonNegativeInt,
  /** Base kitchen preparation time, minutes; part of the quoted ETA. */
  prepEtaMinutes: positiveInt,
  /** Base courier travel time, minutes; the rest of the quoted ETA. */
  courierEtaMinutes: positiveInt,
  /** How long a merchant has to answer an issue before UBI auto-accepts it. */
  issueResponseWindowMinutes: positiveInt,
});

export type BitesPolicy = z.infer<typeof BitesPolicySchema>;

export interface BaseCityConfig {
  readonly city: CityConfig;
  readonly flags: FlagSet;
}

export interface BitesCityConfig extends BaseCityConfig {
  readonly policy: BitesPolicy;
}

export interface CityConfigProvider {
  /** Throws `config_unavailable` when there is no active, valid version. */
  load(cityId: string): Promise<BaseCityConfig>;
  /** Additionally requires the `bitesPolicy` block. */
  loadForBites(cityId: string): Promise<BitesCityConfig>;
}

const configUnavailable = (cityId: string, reason: string): ContractError =>
  new ContractError(
    "config_unavailable",
    "city configuration is unavailable; Bites is closed until it is restored",
    { cityId, reason },
  );

export function createCityConfigProvider(db: BitesTx): CityConfigProvider {
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

  async function loadRaw(
    cityId: string,
  ): Promise<{ base: BaseCityConfig; raw: unknown }> {
    const city = await db.city.findUnique({ where: { id: cityId } });
    if (city === null || !city.active) {
      throw new ContractError(
        "city_unsupported",
        "UBI is not live in that city",
        {
          cityId,
        },
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
        {
          cityId,
          version: version.version,
          issues: parsed.error.issues.length,
        },
        "active city config failed validation",
      );
      throw configUnavailable(
        cityId,
        "active config version failed validation",
      );
    }

    const flags = await loadFlags(cityId);
    return { base: { city: parsed.data, flags }, raw: version.config };
  }

  return {
    async load(cityId: string): Promise<BaseCityConfig> {
      const { base } = await loadRaw(cityId);
      return base;
    },

    async loadForBites(cityId: string): Promise<BitesCityConfig> {
      const { base, raw } = await loadRaw(cityId);
      const container = z.object({ bitesPolicy: z.unknown() }).safeParse(raw);
      const policy = BitesPolicySchema.safeParse(
        container.success ? container.data.bitesPolicy : undefined,
      );
      if (!policy.success) {
        logger.error({ cityId }, "city config has no valid bitesPolicy block");
        throw configUnavailable(
          cityId,
          "config has no valid bitesPolicy block",
        );
      }
      return { city: base.city, flags: base.flags, policy: policy.data };
    },
  };
}

/** Deep links to a disabled vertical must 404, never 403 (CLAUDE.md #5, #8). */
export function assertFlagEnabled(flags: FlagSet, key: FlagKey): void {
  if (!isEnabled(flags, key)) {
    throw featureDisabled(key);
  }
}

/** Minutes a customer is quoted for a merchant, from config only. */
export function quotedEtaMinutes(policy: BitesPolicy): number {
  return policy.prepEtaMinutes + policy.courierEtaMinutes;
}
