/**
 * City configuration for support, safety and review queues.
 *
 * Every number this service promises a customer — how long an SLA is, how large
 * a remedy an agent may post, which decisions need a second reviewer, and the
 * emergency number a responder is told to call — comes from the active,
 * two-person-approved city config version (CLAUDE.md #1 and #6). There is not a
 * single fare, fee, currency or emergency number literal in this service.
 *
 * When the config cannot be read the service fails closed: cases and remedies
 * are refused with `config_unavailable` and every feature flag reads as off
 * (CLAUDE.md #5). SOS is the one deliberate exception, and it is not an
 * exception to fail-closed so much as an application of it: see
 * `tryLoadForSupport` below.
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

import { logger } from "../lib/logger";

import type { SupportTx } from "./types";

/** Case categories the product supports. Closed so an SLA can never be missing by typo. */
export const SUPPORT_CATEGORIES = [
  "ride",
  "wallet",
  "bites",
  "send",
  "travel",
  "stays",
  "fleet",
  "safety",
  "account",
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SAFETY_SEVERITIES = ["critical", "high", "standard"] as const;
export type SafetySeverity = (typeof SAFETY_SEVERITIES)[number];

/** What raised the SOS. The severity each maps to is a city decision. */
export const SOS_TRIGGERS = [
  "sos_button",
  "crash_detected",
  "route_deviation",
  "audio_alarm",
  "third_party_report",
] as const;
export type SosTrigger = (typeof SOS_TRIGGERS)[number];

export const REMEDY_TYPES = [
  "fee_reversal",
  "refund",
  "credit",
  "redelivery",
  "cash_dispute_resolution",
] as const;
export type RemedyType = (typeof REMEDY_TYPES)[number];

const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();

/**
 * The support policy block of the city config document. It sits beside
 * `walletPolicy` (slice 04) under the same versioned, approved document, so
 * changing an SLA or a remedy ceiling is a config change request with two
 * approvers — not a deploy.
 */
export const SupportPolicySchema = z.object({
  /** SLA clock for a new case, by category. A category with no entry cannot be opened. */
  slaMinutesByCategory: z.record(z.enum(SUPPORT_CATEGORIES), positiveInt),
  /** SLA clock for a safety case, by severity. All three severities are required. */
  safetySlaMinutesBySeverity: z.object({
    critical: positiveInt,
    high: positiveInt,
    standard: positiveInt,
  }),
  /** Which severity each SOS trigger carries in this city. */
  sosSeverityByTrigger: z.record(
    z.enum(SOS_TRIGGERS),
    z.enum(SAFETY_SEVERITIES),
  ),
  /** How many times an SOS notification is retried before it is escalated by hand. */
  sosMaxDeliveryAttempts: positiveInt,
  /** Backoff between SOS notification attempts. The last entry repeats. */
  sosRetryBackoffSeconds: z.array(nonNegativeInt).min(1),
  /** The largest remedy of each type an agent may post at all. */
  remedyCapMinorByType: z.record(z.enum(REMEDY_TYPES), nonNegativeInt),
  /** Above this, posting a remedy needs the `remedy.post.high_value` permission. */
  remedyHighValueAboveMinor: nonNegativeInt,
  /** Review decisions that always need two different reviewers, e.g. deactivation. */
  reviewDualControlDecisions: z.array(z.string().min(1)),
  /** A review decision worth more than this needs two different reviewers. */
  reviewDualControlAboveMinor: nonNegativeInt,
});

export type SupportPolicy = z.infer<typeof SupportPolicySchema>;

export interface BaseCityConfig {
  readonly city: CityConfig;
  readonly flags: FlagSet;
}

export interface SupportCityConfig extends BaseCityConfig {
  readonly policy: SupportPolicy;
}

export interface CityConfigProvider {
  /** Throws `config_unavailable` when there is no active, valid version. */
  load(cityId: string): Promise<BaseCityConfig>;
  /** Additionally requires the `supportPolicy` block. */
  loadForSupport(cityId: string): Promise<SupportCityConfig>;
  /**
   * Never throws. Used only by the SOS path, which must record the incident
   * even when the config service is down.
   */
  tryLoadForSupport(cityId: string): Promise<ConfigAttempt>;
}

export type ConfigAttempt =
  | { readonly ok: true; readonly config: SupportCityConfig }
  | { readonly ok: false; readonly reason: string };

const configUnavailable = (cityId: string, reason: string): ContractError =>
  new ContractError(
    "config_unavailable",
    "city configuration is unavailable; support operations are closed until it is restored",
    { cityId, reason },
  );

export function createCityConfigProvider(db: SupportTx): CityConfigProvider {
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

  async function loadForSupport(cityId: string): Promise<SupportCityConfig> {
    const { base, raw } = await loadRaw(cityId);
    const container = z.object({ supportPolicy: z.unknown() }).safeParse(raw);
    const policy = SupportPolicySchema.safeParse(
      container.success ? container.data.supportPolicy : undefined,
    );
    if (!policy.success) {
      logger.error({ cityId }, "city config has no valid supportPolicy block");
      throw configUnavailable(
        cityId,
        "config has no valid supportPolicy block",
      );
    }
    return { city: base.city, flags: base.flags, policy: policy.data };
  }

  return {
    async load(cityId: string): Promise<BaseCityConfig> {
      const { base } = await loadRaw(cityId);
      return base;
    },

    loadForSupport,

    async tryLoadForSupport(cityId: string): Promise<ConfigAttempt> {
      try {
        return { ok: true, config: await loadForSupport(cityId) };
      } catch (error) {
        const reason =
          error instanceof ContractError ? error.code : "config lookup failed";
        logger.error({ err: error, cityId }, "support config unavailable");
        return { ok: false, reason };
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

export function slaMinutesForCategory(
  policy: SupportPolicy,
  category: SupportCategory,
): number {
  const minutes = policy.slaMinutesByCategory[category];
  if (minutes === undefined) {
    // Refusing is the honest answer: we will not open a case under an SLA the
    // city has not agreed to (CLAUDE.md #8).
    throw new ContractError(
      "config_unavailable",
      "this city has not set an SLA for that case category",
      { category },
    );
  }
  return minutes;
}

export function remedyCapMinor(
  policy: SupportPolicy,
  type: RemedyType,
): number {
  const cap = policy.remedyCapMinorByType[type];
  if (cap === undefined) {
    throw new ContractError(
      "config_unavailable",
      "this city has not set a ceiling for that remedy type",
      { type },
    );
  }
  return cap;
}

/**
 * The severity an SOS carries. When the city has not mapped the trigger, the
 * incident is treated as critical: for safety, "fail closed" means assuming the
 * worst, never dropping the incident.
 */
export function severityForTrigger(
  policy: SupportPolicy | null,
  trigger: SosTrigger,
): SafetySeverity {
  if (policy === null) {
    return "critical";
  }
  return policy.sosSeverityByTrigger[trigger] ?? "critical";
}

export function safetySlaMinutes(
  policy: SupportPolicy,
  severity: SafetySeverity,
): number {
  return policy.safetySlaMinutesBySeverity[severity];
}

/** Backoff for attempt number `attempt` (1-based); the final entry repeats. */
export function sosBackoffSeconds(
  policy: SupportPolicy,
  attempt: number,
): number {
  const schedule = policy.sosRetryBackoffSeconds;
  const index = Math.min(Math.max(attempt, 1), schedule.length) - 1;
  return schedule[index] ?? 60;
}
