/**
 * Feature flags — deny by default (CLAUDE.md #5, #12).
 *
 * Resolution order for one flag, first match wins:
 *   1. a rule for this city whose segment matches the user,
 *   2. a global rule (no city) whose segment matches the user,
 *   3. the flag's own `default_on`.
 *
 * A flag that was never registered has no default and therefore resolves to
 * false; there is no path in this file that can produce `true` without a rule
 * or a default behind it. Nothing here is probabilistic: the same inputs always
 * evaluate to the same answer.
 */
import { Prisma } from "@prisma/client";
import { FLAG_KEYS, ContractError, scopedIdempotencyKey } from "@ubi/contracts";
import { z } from "zod";

import { GLOBAL_SCOPE, configCache } from "../lib/cache";
import { deterministicId } from "../lib/ids";
import { flagLogger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import type { Actor } from "../middleware/actor";
import { auditRevision, writeAudit } from "./audit";
import { findOutboxByIdempotencyKey, writeOutboxEvent } from "./outbox";

/**
 * The only segment shape this service understands. Anything else is treated as
 * "does not match" rather than guessed at — an unreadable segment must not open
 * a feature.
 */
const SegmentSchema = z
  .object({ userIds: z.array(z.string().min(1)).min(1) })
  .strict();

export type FlagMap = Record<string, boolean>;

interface RuleSnapshot {
  readonly flagKey: string;
  readonly cityScoped: boolean;
  readonly enabled: boolean;
  readonly segment: unknown;
}

interface FlagSnapshot {
  readonly defaults: ReadonlyArray<{ key: string; defaultOn: boolean }>;
  readonly rules: readonly RuleSnapshot[];
}

const flagScope = (cityId: string | undefined) => ({
  kind: "flags" as const,
  scopeId: cityId ?? GLOBAL_SCOPE,
});

async function loadSnapshot(cityId: string | undefined): Promise<FlagSnapshot> {
  const [flags, rules] = await Promise.all([
    prisma.featureFlag.findMany({ select: { key: true, defaultOn: true } }),
    prisma.flagRule.findMany({
      where: cityId === undefined ? { cityId: null } : { OR: [{ cityId }, { cityId: null }] },
      select: { flagKey: true, cityId: true, enabled: true, segment: true },
    }),
  ]);
  return {
    defaults: flags.map((flag) => ({ key: flag.key, defaultOn: flag.defaultOn })),
    rules: rules.map((rule) => ({
      flagKey: rule.flagKey,
      cityScoped: rule.cityId !== null,
      enabled: rule.enabled,
      segment: rule.segment,
    })),
  };
}

function reviveSnapshot(raw: unknown): FlagSnapshot | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const candidate = raw as Partial<FlagSnapshot>;
  if (!Array.isArray(candidate.defaults) || !Array.isArray(candidate.rules)) return undefined;
  return { defaults: candidate.defaults, rules: candidate.rules };
}

function segmentMatches(segment: unknown, userId: string | undefined): boolean {
  if (segment === null || segment === undefined) return true;
  const parsed = SegmentSchema.safeParse(segment);
  if (!parsed.success) {
    flagLogger.warn("flag rule carries an unreadable segment; treating it as no match");
    return false;
  }
  if (userId === undefined) return false;
  return parsed.data.userIds.includes(userId);
}

function evaluate(snapshot: FlagSnapshot, userId: string | undefined): FlagMap {
  const flags: FlagMap = {};
  // Every key the platform knows about is reported, so a client can tell
  // "off" from "never heard of it" only by asking; both render as off.
  for (const key of FLAG_KEYS) flags[key] = false;
  for (const { key, defaultOn } of snapshot.defaults) flags[key] = defaultOn;

  const cityRules = snapshot.rules.filter((rule) => rule.cityScoped);
  const globalRules = snapshot.rules.filter((rule) => !rule.cityScoped);

  for (const { key } of snapshot.defaults) {
    const cityRule = cityRules.find(
      (rule) => rule.flagKey === key && segmentMatches(rule.segment, userId),
    );
    if (cityRule !== undefined) {
      flags[key] = cityRule.enabled;
      continue;
    }
    const globalRule = globalRules.find(
      (rule) => rule.flagKey === key && segmentMatches(rule.segment, userId),
    );
    if (globalRule !== undefined) flags[key] = globalRule.enabled;
  }

  return flags;
}

export async function evaluateFlags(params: {
  readonly cityId?: string | undefined;
  readonly userId?: string | undefined;
}): Promise<FlagMap> {
  const snapshot = await configCache.read<FlagSnapshot>(
    flagScope(params.cityId),
    () => loadSnapshot(params.cityId),
    reviveSnapshot,
  );
  return evaluate(snapshot, params.userId);
}

export interface SetFlagInput {
  readonly key: string;
  readonly cityId: string | null;
  readonly enabled: boolean;
  readonly reason: string;
  readonly segment?: Record<string, unknown> | undefined;
  readonly actor: Actor;
  readonly idempotencyKey: string;
}

export interface SetFlagResult {
  readonly key: string;
  readonly cityId: string | null;
  readonly from: boolean;
  readonly to: boolean;
  readonly by: string;
  readonly replayed: boolean;
}

/**
 * The audited single-actor path for flipping a flag. The rule row, the audit
 * row and the `flag.changed` outbox row are one transaction; the caches for
 * every affected city are invalidated only after it commits.
 */
export async function setFlag(input: SetFlagInput): Promise<SetFlagResult> {
  const { key, cityId, enabled, reason, actor } = input;

  const flag = await prisma.featureFlag.findUnique({ where: { key } });
  if (flag === null) {
    throw new ContractError("not_found", "unknown feature flag", { key });
  }
  if (cityId !== null && (await prisma.city.count({ where: { id: cityId } })) === 0) {
    throw new ContractError("city_unsupported", "city is not configured", { cityId });
  }
  if (input.segment !== undefined && !SegmentSchema.safeParse(input.segment).success) {
    throw new ContractError("validation_failed", "segment must be { userIds: string[] }", {
      key,
    });
  }

  const idempotencyKey = scopedIdempotencyKey("flag.changed", actor.id, input.idempotencyKey);

  const replay = await findOutboxByIdempotencyKey(prisma, idempotencyKey);
  if (replay !== undefined) {
    return {
      key: String(replay["key"] ?? key),
      cityId: typeof replay["cityId"] === "string" ? replay["cityId"] : null,
      from: replay["from"] === true,
      to: replay["to"] === true,
      by: String(replay["by"] ?? actor.id),
      replayed: true,
    };
  }

  const ruleId = deterministicId("flr", key, cityId ?? GLOBAL_SCOPE);
  const subjectId = `flag:${key}:${cityId ?? GLOBAL_SCOPE}`;

  const result = await prisma.$transaction(async (tx) => {
    // Looked up by (flag, city) rather than by unique key: Postgres does not
    // enforce a unique index across NULL city ids, so the deterministic row id
    // is what keeps a global rule single.
    const existing = await tx.flagRule.findFirst({ where: { flagKey: key, cityId } });
    const from = existing?.enabled ?? flag.defaultOn;

    await tx.flagRule.upsert({
      where: { id: ruleId },
      create: {
        id: ruleId,
        flagKey: key,
        cityId,
        enabled,
        updatedBy: actor.id,
        ...(input.segment === undefined
          ? {}
          : { segment: input.segment as Prisma.InputJsonValue }),
      },
      update: {
        enabled,
        updatedBy: actor.id,
        ...(input.segment === undefined
          ? {}
          : { segment: input.segment as Prisma.InputJsonValue }),
      },
    });

    await writeAudit(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      action: "flag.changed",
      subjectType: "config",
      subjectId,
      before: { enabled: from },
      after: {
        enabled,
        ...(input.segment === undefined ? {} : { segment: input.segment }),
      } as Prisma.InputJsonValue,
      reason,
    });

    // A flag rule has no version column; its revision is how many times it has
    // been audited, which is monotonic and derived inside the same transaction.
    const revision = await auditRevision(tx, "config", subjectId);

    await writeOutboxEvent(tx, {
      name: "flag.changed",
      subjectType: "config",
      subjectId,
      actorType: "agent",
      actorId: actor.id,
      idempotencyKey,
      fromVersion: revision > 1 ? revision - 1 : null,
      toVersion: revision,
      cityId,
      payload: { key, cityId, from, to: enabled, by: actor.id },
    });

    return { from };
  });

  const affectedCities =
    cityId === null
      ? (await prisma.city.findMany({ select: { id: true } })).map((city) => city.id)
      : [cityId];
  for (const scopeId of [...affectedCities, GLOBAL_SCOPE]) {
    await configCache.invalidate({ kind: "flags", scopeId }, { kind: "flags", scopeId });
  }

  flagLogger.info({ key, cityId, from: result.from, to: enabled }, "feature flag changed");

  return { key, cityId, from: result.from, to: enabled, by: actor.id, replayed: false };
}
