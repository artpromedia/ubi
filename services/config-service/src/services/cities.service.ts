/**
 * City rows and their launch status.
 *
 * `status` is the only thing the marketing site renders from: active ⇒
 * services from flags, launching ⇒ "coming, no date", planned ⇒ intent,
 * paused ⇒ nothing live. `active` is a derived mirror kept for older readers.
 *
 * The launch-pair guard: a city may move to `active` only if every other city
 * in its launch group is active after the change, so two launch cities can
 * only go live in one request. Leaving `active` (pausing) is never blocked.
 * The status rows, their audit rows, the `city.status_changed` outbox rows and
 * any flags switched in the same change are one transaction.
 */
import { Prisma } from "@prisma/client";

import {
  type CitySummary,
  type CityStatus,
  CITY_STATUSES,
  ContractError,
  cityIsActive,
  scopedIdempotencyKey,
} from "@ubi/contracts";

import { type Tx, auditRevision, writeAudit } from "./audit";
import { applyFlagChange } from "./flags.service";
import { findOutboxByIdempotencyKey, writeOutboxEvent } from "./outbox";
import { GLOBAL_SCOPE, configCache } from "../lib/cache";
import { deterministicId } from "../lib/ids";
import { configLogger } from "../lib/logger";
import { prisma } from "../lib/prisma";

import type { Actor } from "../middleware/actor";

function toSummary(row: {
  id: string;
  name: string;
  country: string;
  region: string | null;
  timezone: string;
  status: string;
  launchGroup: string | null;
}): CitySummary {
  const status = CITY_STATUSES.includes(row.status as CityStatus)
    ? (row.status as CityStatus)
    : "planned";
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    region: row.region,
    timezone: row.timezone,
    status,
    active: cityIsActive(status),
    launchGroup: row.launchGroup,
  };
}

/** Every city row, launch cities first, then by name. Never cached: it is one indexed read. */
export async function listCities(): Promise<CitySummary[]> {
  const rows = await prisma.city.findMany({ orderBy: [{ name: "asc" }] });
  const order: Record<CityStatus, number> = {
    active: 0,
    launching: 1,
    paused: 2,
    planned: 3,
  };
  return rows
    .map(toSummary)
    .sort(
      (a, b) =>
        order[a.status] - order[b.status] || a.name.localeCompare(b.name),
    );
}

export interface LaunchGroupMember {
  readonly id: string;
  readonly status: CityStatus;
  readonly launchGroup: string | null;
}

/**
 * Pure guard. `after` is every city in the affected launch groups with the
 * status it would have once the change applies; `activating` names the cities
 * this change moves to `active`. Throws `launch_pair_incomplete` when an
 * activating city's launch group would still hold a city that is not active.
 * Leaving `active` (pausing one launch city for an incident) is never blocked.
 */
export function assertLaunchGroupsComplete(
  after: readonly LaunchGroupMember[],
  activating: readonly string[],
): void {
  const groups = new Map<string, LaunchGroupMember[]>();
  for (const city of after) {
    if (city.launchGroup === null) {
      continue;
    }
    const members = groups.get(city.launchGroup) ?? [];
    members.push(city);
    groups.set(city.launchGroup, members);
  }
  for (const [launchGroup, members] of groups) {
    if (!members.some((m) => activating.includes(m.id))) {
      continue;
    }
    const missing = members
      .filter((m) => m.status !== "active")
      .map((m) => m.id)
      .sort();
    if (missing.length === 0) {
      continue;
    }
    throw new ContractError(
      "launch_pair_incomplete",
      "launch cities go live together; activate every city in the launch group in one change",
      {
        launchGroup,
        activating: members
          .filter((m) => activating.includes(m.id))
          .map((m) => m.id)
          .sort(),
        missing,
      },
    );
  }
}

export interface SetCityStatusInput {
  readonly cityIds: readonly string[];
  readonly status: CityStatus;
  /** Flags to switch for each city in the same transaction (the launch change). */
  readonly flags?: readonly { key: string; enabled: boolean }[] | undefined;
  readonly reason: string;
  readonly actor: Actor;
  readonly idempotencyKey: string;
}

export interface CityStatusChange {
  readonly cityId: string;
  readonly from: CityStatus;
  readonly to: CityStatus;
}

export interface FlagStatusChange {
  readonly key: string;
  readonly cityId: string;
  readonly from: boolean;
  readonly to: boolean;
}

export interface SetCityStatusResult {
  readonly cities: readonly CityStatusChange[];
  readonly flags: readonly FlagStatusChange[];
  readonly by: string;
  readonly replayed: boolean;
}

async function loadAffected(
  tx: Tx,
  cityIds: readonly string[],
): Promise<LaunchGroupMember[]> {
  const targets = await tx.city.findMany({
    where: { id: { in: [...cityIds] } },
    select: { id: true, status: true, launchGroup: true },
  });
  const groupIds = [
    ...new Set(
      targets.map((c) => c.launchGroup).filter((g): g is string => g !== null),
    ),
  ];
  const members =
    groupIds.length === 0
      ? []
      : await tx.city.findMany({
          where: { launchGroup: { in: groupIds } },
          select: { id: true, status: true, launchGroup: true },
        });
  const byId = new Map<string, LaunchGroupMember>();
  for (const row of [...targets, ...members]) {
    byId.set(row.id, {
      id: row.id,
      status: row.status as CityStatus,
      launchGroup: row.launchGroup,
    });
  }
  return [...byId.values()];
}

export async function setCityStatus(
  input: SetCityStatusInput,
): Promise<SetCityStatusResult> {
  const { status, reason, actor } = input;
  const cityIds = [...new Set(input.cityIds.map((id) => id.trim()))];
  if (cityIds.length === 0) {
    throw new ContractError("validation_failed", "cityIds must name a city");
  }
  if (!CITY_STATUSES.includes(status)) {
    throw new ContractError("validation_failed", "unknown city status", {
      status,
    });
  }

  const known = await prisma.city.findMany({
    where: { id: { in: cityIds } },
    select: { id: true },
  });
  const unknown = cityIds.filter((id) => !known.some((row) => row.id === id));
  if (unknown.length > 0) {
    throw new ContractError("city_unsupported", "city is not configured", {
      cityIds: unknown,
    });
  }

  const flagInputs = input.flags ?? [];
  const flagRows = await prisma.featureFlag.findMany({
    where: { key: { in: flagInputs.map((f) => f.key) } },
    select: { key: true, defaultOn: true },
  });
  const unregistered = flagInputs
    .map((f) => f.key)
    .filter((key) => !flagRows.some((row) => row.key === key));
  if (unregistered.length > 0) {
    throw new ContractError("not_found", "unknown feature flag", {
      keys: unregistered,
    });
  }

  const scopedKey = scopedIdempotencyKey(
    "city.status_changed",
    actor.id,
    input.idempotencyKey,
  );
  // One event per city and per flag, each with its own key derived from the
  // request's key by digest (the envelope caps keys at 64 characters).
  const cityEventKey = (cityId: string): string =>
    deterministicId("cse", scopedKey, cityId);
  const flagEventKey = (key: string, cityId: string): string =>
    deterministicId("csf", scopedKey, key, cityId);

  const replay = await findOutboxByIdempotencyKey(
    prisma,
    cityEventKey(cityIds[0] as string),
  );
  if (replay !== undefined) {
    const stored = replay["change"] as SetCityStatusResult | undefined;
    if (stored !== undefined) {
      return { ...stored, replayed: true };
    }
  }

  const result = await prisma
    .$transaction(
      async (tx) => {
        const affected = await loadAffected(tx, cityIds);
        const after = affected.map((city) =>
          cityIds.includes(city.id) ? { ...city, status } : city,
        );
        assertLaunchGroupsComplete(after, status === "active" ? cityIds : []);

        const cities: CityStatusChange[] = [];
        for (const cityId of cityIds) {
          const current = affected.find((c) => c.id === cityId);
          if (current === undefined) {
            throw new ContractError(
              "city_unsupported",
              "city is not configured",
              {
                cityId,
              },
            );
          }
          const from = current.status;
          if (from !== status) {
            await tx.city.update({
              where: { id: cityId },
              data: { status, active: cityIsActive(status) },
            });
          }
          const subjectId = `city:${cityId}`;
          await writeAudit(tx, {
            actorId: actor.id,
            actorRole: actor.role,
            action: "city.status_changed",
            subjectType: "config",
            subjectId,
            before: { status: from },
            after: { status, launchGroup: current.launchGroup },
            reason,
          });
          cities.push({ cityId, from, to: status });
        }

        const flags: FlagStatusChange[] = [];
        for (const cityId of cityIds) {
          for (const change of flagInputs) {
            const flag = flagRows.find((row) => row.key === change.key);
            if (flag === undefined) {
              continue;
            }
            const { from } = await applyFlagChange(tx, flag, {
              key: change.key,
              cityId,
              enabled: change.enabled,
              reason,
              actor,
              idempotencyKey: flagEventKey(change.key, cityId),
            });
            flags.push({ key: change.key, cityId, from, to: change.enabled });
          }
        }

        const change: SetCityStatusResult = {
          cities,
          flags,
          by: actor.id,
          replayed: false,
        };
        // One event per city (consumers key on the city); every payload carries
        // the whole change so a replay can return it.
        for (const city of cities) {
          const subjectId = `city:${city.cityId}`;
          const revision = await auditRevision(tx, "config", subjectId);
          await writeOutboxEvent(tx, {
            name: "city.status_changed",
            subjectType: "config",
            subjectId,
            actorType: "agent",
            actorId: actor.id,
            idempotencyKey: cityEventKey(city.cityId),
            fromVersion: revision > 1 ? revision - 1 : null,
            toVersion: revision,
            cityId: city.cityId,
            payload: {
              cityId: city.cityId,
              from: city.from,
              to: city.to,
              by: actor.id,
              change,
            },
          });
        }
        return change;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    .catch((err: unknown) => {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === "P2002" || err.code === "P2034")
      ) {
        throw new ContractError("conflict", "concurrent city change; retry", {
          cityIds,
        });
      }
      throw err;
    });

  for (const scopeId of [...cityIds, GLOBAL_SCOPE]) {
    await configCache.invalidate(
      { kind: "flags", scopeId },
      { kind: "flags", scopeId },
    );
  }
  configLogger.info(
    { cityIds, status, flags: result.flags.length },
    "city status changed",
  );
  return result;
}
