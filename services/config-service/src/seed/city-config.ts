/**
 * Shared seeding of a city's first activated config version. Idempotent: a
 * second run activates nothing. The activation is written with its audit and
 * outbox rows in one transaction, exactly like a real approval.
 */
import { type CityConfig, type FlagKey, FLAG_KEYS } from "@ubi/contracts";

import { type SeedCity, upsertCityRow } from "./cities";
import { deterministicId, newId } from "../lib/ids";
import { seedLogger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { writeAudit } from "../services/audit";
import { writeOutboxEvent } from "../services/outbox";

import type { Prisma } from "@prisma/client";

/** Actor recorded for seeded rows; not a person and never a login. */
export const SEED_ACTOR = "system:seed";

export interface SeedResult {
  readonly cityId: string;
  readonly configVersion: number;
  readonly createdVersion: boolean;
  readonly flagsRegistered: number;
}

export interface SeedCityConfigInput {
  readonly city: SeedCity;
  readonly config: (version: number) => CityConfig;
  readonly enabledFlags: readonly FlagKey[];
  readonly reason: string;
}

export async function registerFlagKeys(): Promise<void> {
  for (const key of FLAG_KEYS) {
    await prisma.featureFlag.upsert({
      where: { key },
      create: { key, defaultOn: false, description: `${key} vertical` },
      update: {},
    });
  }
}

export async function seedCityConfig(
  input: SeedCityConfigInput,
): Promise<SeedResult> {
  const { city } = input;
  await prisma.$transaction(async (tx) => {
    await upsertCityRow(tx, city);
  });
  await registerFlagKeys();

  for (const key of input.enabledFlags) {
    const id = deterministicId("flr", key, city.id);
    await prisma.flagRule.upsert({
      where: { id },
      create: {
        id,
        flagKey: key,
        cityId: city.id,
        enabled: true,
        updatedBy: SEED_ACTOR,
      },
      update: {},
    });
  }

  const existing = await prisma.cityConfigVersion.findFirst({
    where: { cityId: city.id, activatedAt: { not: null } },
    orderBy: { version: "desc" },
  });
  if (existing !== null) {
    seedLogger.info(
      { cityId: city.id, version: existing.version },
      "config already activated; nothing to seed",
    );
    return {
      cityId: city.id,
      configVersion: existing.version,
      createdVersion: false,
      flagsRegistered: FLAG_KEYS.length,
    };
  }

  const version = 1;
  const config = input.config(version);
  const activatedAt = new Date();

  await prisma.$transaction(async (tx) => {
    const created = await tx.cityConfigVersion.create({
      data: {
        id: newId("ccv"),
        cityId: city.id,
        version,
        config: config as unknown as Prisma.InputJsonValue,
        activatedAt,
        createdBy: SEED_ACTOR,
        approvedBy: SEED_ACTOR,
      },
    });
    await writeAudit(tx, {
      actorId: SEED_ACTOR,
      actorRole: "system",
      action: "config.version_activated",
      subjectType: "config",
      subjectId: created.id,
      after: {
        version,
        config,
        approvers: [SEED_ACTOR],
      } as unknown as Prisma.InputJsonValue,
      reason: input.reason,
    });
    await writeOutboxEvent(tx, {
      name: "config.version_activated",
      subjectType: "config",
      subjectId: city.id,
      actorType: "system",
      actorId: SEED_ACTOR,
      idempotencyKey: `config.version_activated:seed:${city.id}:${version}`,
      fromVersion: null,
      toVersion: version,
      cityId: city.id,
      payload: { cityId: city.id, version, diff: [], by: [SEED_ACTOR] },
      occurredAt: activatedAt,
    });
  });

  seedLogger.info({ cityId: city.id, version }, "seeded city config");

  return {
    cityId: city.id,
    configVersion: version,
    createdVersion: true,
    flagsRegistered: FLAG_KEYS.length,
  };
}
