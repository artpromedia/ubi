/**
 * City configuration, the `fleet` flag and the fleet policy.
 *
 * The currency, the zone, the remittance cap and whether fleet tools exist in
 * a city at all come from the active city config version and the per-city
 * flag rules (CLAUDE.md #1, #5). There is no currency literal and no flag
 * default of `true` in this service. When the config cannot be read the
 * service fails closed: every flag reads as off.
 *
 * The fleet POLICY (proposal TTL, warning cadence, named shift hours, …) is a
 * per-market value: a `fleet` block on the city config version, validated
 * with FleetPolicySchema over the pilot defaults the handoff and decisions
 * doc name. CityConfigSchema does not declare `fleet` yet (the lead registers
 * it at integration), so it is read from the raw version here; an invalid
 * block fails closed with `config_unavailable`.
 */
import {
  CityConfigSchema,
  type CityConfig,
  ContractError,
  DENY_ALL,
  type FlagSet,
  featureDisabled,
  isEnabled,
} from "@ubi/contracts";

import {
  FLEET_FLAG,
  FLEET_POLICY_DEFAULTS,
  FleetPolicySchema,
  type FleetPolicy,
} from "../contract";
import { logger } from "../lib/logger";
import { isValidZone } from "../lib/time";

import type { FleetTx } from "./types";

export interface FleetCityConfig {
  readonly city: CityConfig;
  readonly flags: FlagSet;
  readonly policy: FleetPolicy;
}

export interface CityConfigProvider {
  /** Throws `city_unsupported` / `config_unavailable` when unusable. */
  load(cityId: string): Promise<FleetCityConfig>;
}

const configUnavailable = (cityId: string, reason: string): ContractError =>
  new ContractError(
    "config_unavailable",
    "city configuration is unavailable; fleet tools are closed until it is restored",
    { cityId, reason },
  );

export function createCityConfigProvider(db: FleetTx): CityConfigProvider {
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
      logger.error({ err: error, cityId }, "flag lookup failed; denying all");
      return DENY_ALL;
    }
  }

  return {
    async load(cityId: string): Promise<FleetCityConfig> {
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
        throw configUnavailable(
          cityId,
          "active config version failed validation",
        );
      }
      if (!isValidZone(parsed.data.timezone)) {
        throw configUnavailable(
          cityId,
          "the city timezone is not a known IANA zone",
        );
      }
      const raw = version.config as { fleet?: unknown } | null;
      const block =
        raw !== null && typeof raw === "object" && typeof raw.fleet === "object"
          ? (raw.fleet as Record<string, unknown>)
          : {};
      const policy = FleetPolicySchema.safeParse({
        ...FLEET_POLICY_DEFAULTS,
        ...block,
      });
      if (!policy.success) {
        throw configUnavailable(
          cityId,
          "the fleet policy block failed validation",
        );
      }
      const flags = await loadFlags(cityId);
      return { city: parsed.data, flags, policy: policy.data };
    },
  };
}

/**
 * The deny-by-default `fleet` flag: a disabled vertical answers 404
 * `feature_disabled`, never 403 (CLAUDE.md #5, #8). `fleet` is a declared
 * FlagKey (flags.ts).
 */
export async function requireFleetEnabled(
  config: CityConfigProvider,
  cityId: string,
): Promise<FleetCityConfig> {
  let loaded: FleetCityConfig;
  try {
    loaded = await config.load(cityId);
  } catch (error) {
    if (error instanceof ContractError && error.code === "city_unsupported") {
      throw featureDisabled(FLEET_FLAG);
    }
    throw error;
  }
  if (!isEnabled(loaded.flags, FLEET_FLAG)) {
    throw featureDisabled(FLEET_FLAG);
  }
  return loaded;
}
