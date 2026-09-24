/**
 * The two city facts an organization needs: that the city is live with a
 * valid active config (its wallet currency denominates every budget), and
 * whether `business_travel` (the registered FlagKey) is switched on there.
 *
 * Fail closed on both: no active valid config is `config_unavailable`, and a
 * flag that is absent, unreadable or has no rule for the city (with no global
 * default) reads OFF — the same resolution payment-service's flag provider
 * applies, so the two services can never disagree about a city.
 */
import { CityConfigSchema, ContractError } from "@ubi/contracts";

import { BUSINESS_TRAVEL_FLAG } from "./model";
import { logger } from "../lib/logger.js";

import type { Tx } from "../identity/audit";
import type { PrismaClient } from "@prisma/client";

type Db = PrismaClient | Tx;

export interface OrgCity {
  readonly cityId: string;
  readonly currency: string;
}

export async function loadOrgCity(db: Db, cityId: string): Promise<OrgCity> {
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
  const parsed =
    version === null ? null : CityConfigSchema.safeParse(version.config);
  if (parsed === null || !parsed.success) {
    throw new ContractError(
      "config_unavailable",
      "city configuration is unavailable; business travel is closed until it is restored",
      { cityId },
    );
  }
  return { cityId, currency: parsed.data.currency };
}

export async function businessTravelEnabled(
  db: Db,
  cityId: string,
): Promise<boolean> {
  try {
    const flag = await db.featureFlag.findUnique({
      where: { key: BUSINESS_TRAVEL_FLAG },
      include: { rules: { where: { cityId } } },
    });
    if (flag === null) {
      return false;
    }
    const rule = flag.rules[0];
    return rule === undefined ? flag.defaultOn : rule.enabled;
  } catch (error) {
    logger.error(
      { err: error, cityId },
      "business_travel flag lookup failed; treating it as off",
    );
    return false;
  }
}

/** Deep links to a disabled vertical 404 (CLAUDE.md #5, #8). */
export async function assertBusinessTravelEnabled(
  db: Db,
  cityId: string,
): Promise<void> {
  if (!(await businessTravelEnabled(db, cityId))) {
    throw new ContractError(
      "feature_disabled",
      "business travel is not available here",
      { feature: BUSINESS_TRAVEL_FLAG, cityId },
    );
  }
}
