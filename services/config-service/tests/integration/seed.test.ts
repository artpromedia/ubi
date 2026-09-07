/**
 * The seed writes a real activated version with its audit and outbox rows, and
 * running it twice changes nothing.
 */
import { FLAG_KEYS } from "@ubi/contracts";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { LAGOS_ENABLED_FLAGS, LAGOS_CITY, seedLagos } from "@/seed/lagos";
import { SEED_ENV, closeConnections, resetAll } from "@tests/helpers/db";

describe("lagos seed", () => {
  beforeEach(async () => {
    await resetAll();
  });

  afterAll(async () => {
    await closeConnections();
  });

  it("activates version 1 with an audit row and an outbox row", async () => {
    const result = await seedLagos(SEED_ENV);

    expect(result).toMatchObject({ cityId: "LOS", configVersion: 1, createdVersion: true });

    const version = await prisma.cityConfigVersion.findFirstOrThrow({
      where: { cityId: LAGOS_CITY.id },
    });
    expect(version.version).toBe(1);
    expect(version.activatedAt).not.toBeNull();

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "config.version_activated", subjectId: version.id },
    });
    expect(audit.actorRole).toBe("system");

    const outbox = await prisma.outboxEvent.findFirstOrThrow({
      where: { name: "config.version_activated" },
    });
    expect(outbox.toVersion).toBe(1);
    expect(outbox.fromVersion).toBeNull();
    expect(outbox.actorType).toBe("system");
  });

  it("registers every known flag off by default and only turns on the launch set", async () => {
    await seedLagos(SEED_ENV);

    const flags = await prisma.featureFlag.findMany();
    expect(flags).toHaveLength(FLAG_KEYS.length);
    expect(flags.every((flag) => !flag.defaultOn)).toBe(true);

    const rules = await prisma.flagRule.findMany({ where: { enabled: true } });
    expect(rules.map((rule) => rule.flagKey).sort()).toEqual([...LAGOS_ENABLED_FLAGS].sort());
  });

  it("is idempotent: a second run activates nothing new", async () => {
    await seedLagos(SEED_ENV);
    const second = await seedLagos(SEED_ENV);

    expect(second.createdVersion).toBe(false);
    expect(await prisma.cityConfigVersion.count()).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { name: "config.version_activated" } })).toBe(1);
    expect(await prisma.flagRule.count()).toBe(LAGOS_ENABLED_FLAGS.length);
  });
});
