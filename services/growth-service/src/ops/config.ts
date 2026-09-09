/**
 * Feature flags for the growth verticals (CLAUDE.md #5).
 *
 * Flags are deny-by-default and evaluated server-side per city. A rider offer,
 * a referral programme and a driver rebate each render only when their flag is
 * on, and a deep link to a disabled vertical 404s rather than 403s so a
 * half-built feature stays invisible (CLAUDE.md #5, #8). When the flag lookup
 * fails, every flag reads as off.
 */
import {
  DENY_ALL,
  featureDisabled,
  type FlagKey,
  type FlagSet,
  isEnabled,
} from "@ubi/contracts";

import { logger } from "../lib/logger";

import type { GrowthTx } from "./types";

export interface FlagProvider {
  flagsFor(cityId: string): Promise<FlagSet>;
}

export function createFlagProvider(db: GrowthTx): FlagProvider {
  return {
    async flagsFor(cityId: string): Promise<FlagSet> {
      try {
        const flags = await db.featureFlag.findMany({
          include: { rules: { where: { cityId } } },
        });
        const resolved: Record<string, boolean> = { ...DENY_ALL };
        for (const flag of flags) {
          const rule = flag.rules[0];
          resolved[flag.key] =
            rule === undefined ? flag.defaultOn : rule.enabled;
        }
        return resolved as FlagSet;
      } catch (error) {
        logger.error(
          { err: error, cityId },
          "flag lookup failed; denying all flags",
        );
        return DENY_ALL;
      }
    },
  };
}

/** Deep links to a disabled vertical must 404, never 403 (CLAUDE.md #5, #8). */
export function assertFlagEnabled(flags: FlagSet, key: FlagKey): void {
  if (!isEnabled(flags, key)) {
    throw featureDisabled(key);
  }
}
