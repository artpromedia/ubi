/**
 * City configuration and feature flags for the wallet.
 *
 * Currency, KYC tiers, service fee, PIN attempt policy and the wallet's risk /
 * cooling / dispute windows all come from the active city config version
 * (CLAUDE.md #1 and #6) — never from a constant in this file. If no active,
 * valid version exists the wallet answers `config_unavailable` rather than
 * falling back to a default, and every feature flag reads as off (CLAUDE.md #5).
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

import { walletLogger } from "../lib/logger";

import type { LedgerTx } from "./types";

/**
 * Wallet policy numbers the wallet needs and the canonical `CityConfig` does
 * not yet carry. They are read from the same city config document under
 * `walletPolicy`, so they stay versioned and two-person approved like every
 * other city number. A city whose config omits the block cannot run
 * risk-bearing wallet operations at all — that is the fail-closed behaviour,
 * not a default.
 */
export const WalletPolicySchema = z.object({
  /** Rolling velocity window used for the risk check. */
  velocityWindowMinutes: z.number().int().positive(),
  /** Transfers allowed inside the window before a transfer is held for review. */
  velocityMaxTransfers: z.number().int().nonnegative(),
  /** Value allowed inside the window before a transfer is held for review. */
  velocityMaxAmountMinor: z.number().int().nonnegative(),
  /** A first transfer to this recipient above this amount is held for review. */
  newRecipientHoldAboveMinor: z.number().int().nonnegative(),
  /** How long the PIN stays locked after the city's attempt ceiling is hit. */
  pinLockMinutes: z.number().int().positive(),
  /** Cooling window applied after a PIN reset. */
  pinResetCoolingMinutes: z.number().int().nonnegative(),
  /** During cooling, transfers to a new recipient above this amount are refused. */
  pinResetCoolingCapMinor: z.number().int().nonnegative(),
  /** How long after posting the sender may ask the recipient to return funds. */
  returnRequestWindowHours: z.number().int().positive(),
  /** How long after a decline the sender may raise a dispute. */
  disputeWindowHours: z.number().int().positive(),
  /** How long a bank may reverse a confirmed NIP payout. */
  nipReversalWindowHours: z.number().int().positive(),
  /** SLA on a risk-hold review queue item. */
  riskReviewSlaMinutes: z.number().int().positive(),
  /** SLA on a reconciliation break. */
  reconBreakSlaHours: z.number().int().positive(),
});

export type WalletPolicy = z.infer<typeof WalletPolicySchema>;

export interface WalletCityConfig {
  readonly city: CityConfig;
  readonly policy: WalletPolicy;
  readonly flags: FlagSet;
}

/** City config without the wallet policy block — enough for a balance read. */
export interface BaseCityConfig {
  readonly city: CityConfig;
  readonly flags: FlagSet;
}

export interface CityConfigProvider {
  /** Throws `config_unavailable` when there is no active, valid version. */
  load(cityId: string): Promise<BaseCityConfig>;
  /** Additionally requires the `walletPolicy` block. */
  loadForWallet(cityId: string): Promise<WalletCityConfig>;
}

const configUnavailable = (cityId: string, reason: string): ContractError =>
  new ContractError(
    "config_unavailable",
    "city configuration is unavailable; wallet operations are closed until it is restored",
    { cityId, reason },
  );

/**
 * Reads the active city config version and the flag rules straight from the
 * config tables. A read failure is not swallowed into a default: the caller
 * gets `config_unavailable`, and flags collapse to `DENY_ALL`.
 */
export function createCityConfigProvider(db: LedgerTx): CityConfigProvider {
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
      walletLogger.error(
        { err: error, cityId },
        "flag lookup failed; denying all flags",
      );
      return DENY_ALL;
    }
  }

  async function loadBase(cityId: string): Promise<{
    base: BaseCityConfig;
    raw: unknown;
  }> {
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
      walletLogger.error(
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
      const { base } = await loadBase(cityId);
      return base;
    },

    async loadForWallet(cityId: string): Promise<WalletCityConfig> {
      const { base, raw } = await loadBase(cityId);
      const container = z.object({ walletPolicy: z.unknown() }).safeParse(raw);
      const policy = WalletPolicySchema.safeParse(
        container.success ? container.data.walletPolicy : undefined,
      );
      if (!policy.success) {
        walletLogger.error(
          { cityId },
          "city config has no valid walletPolicy block",
        );
        throw configUnavailable(
          cityId,
          "config has no valid walletPolicy block",
        );
      }
      return { city: base.city, policy: policy.data, flags: base.flags };
    },
  };
}

/** Deep links to a disabled vertical must 404, never 403 (CLAUDE.md #5, #8). */
export function assertFlagEnabled(flags: FlagSet, key: FlagKey): void {
  if (!isEnabled(flags, key)) {
    throw featureDisabled(key);
  }
}
