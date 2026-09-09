/**
 * Feature flags for the assistant, evaluated server-side, per city
 * (CLAUDE.md #5 — deny by default).
 *
 *  - `ai_assistant`     gates opening threads and sending messages.
 *  - `ai_transactions`  gates minting an action grant and starting an execution.
 *
 * A disabled vertical is invisible: the guard raises `feature_disabled`, which
 * the contract maps to 404, never 403 — a deep link to a flag-off feature must
 * not reveal that the feature exists (CLAUDE.md #8, rule #21 render-from-server).
 */
import {
  DENY_ALL,
  type FlagKey,
  type FlagSet,
  featureDisabled,
  isEnabled,
} from "@ubi/contracts";

import { logger } from "../lib/logger";

import type { AskTx } from "./types";

export interface FlagProvider {
  flagsFor(cityId: string): Promise<FlagSet>;
}

export function createFlagProvider(db: AskTx): FlagProvider {
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

export function assertFlagEnabled(flags: FlagSet, key: FlagKey): void {
  if (!isEnabled(flags, key)) {
    throw featureDisabled(key);
  }
}
