/**
 * Outbox relay integration tests (real Postgres + real Redis).
 *
 * Covers the four guarantees the handoff asks for: a written row is published
 * and marked; per-aggregate order is preserved when a later version is inserted
 * before an earlier one is published; two concurrent passes never double-publish
 * a row (SELECT ... FOR UPDATE SKIP LOCKED); and a row with a bad envelope is
 * quarantined without blocking the rest or crashing the loop.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

import { createOutboxRelay } from "../src/relay";
import {
  collect,
  insertRow,
  makePrisma,
  makeRedis,
  readRow,
  truncateOutbox,
  uid,
} from "./helpers";

let prisma: PrismaClient;
let pub: Redis;

beforeAll(() => {
  prisma = makePrisma();
  pub = makeRedis();
});

afterEach(async () => {
  await truncateOutbox(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
  await pub.quit();
});

describe("relay: publish and mark", () => {
  it("publishes an unpublished row to both channels and stamps published_at", async () => {
    const rideId = uid("ride");
    const eventId = await insertRow(prisma, {
      aggregateId: rideId,
      toVersion: 1,
      name: "ride.completed",
      payload: { rideId, fareMinor: 250000 },
    });

    const onSubject = await collect(`ride.${rideId}`);
    const onType = await collect("event:ride.completed");

    const relay = createOutboxRelay({ prisma, redis: pub });
    const result = await relay.tick();

    expect(result.published).toBe(1);
    expect(result.claimed).toBe(1);

    await onSubject.waitFor((m) => m.some((x) => x.id === eventId));
    await onType.waitFor((m) => m.some((x) => x.id === eventId));

    // Full envelope carried on the subject channel.
    const captured = onSubject.messages.find((x) => x.id === eventId);
    expect(captured).toBeDefined();
    const envelope = JSON.parse(captured!.raw) as Record<string, unknown>;
    expect(envelope.name).toBe("ride.completed");
    expect(envelope.subject).toEqual({ type: "ride", id: rideId });
    expect(envelope.toVersion).toBe(1);
    expect(envelope.payload).toEqual({ rideId, fareMinor: 250000 });

    const row = await readRow(prisma, eventId);
    expect(row.publishedAt).not.toBeNull();
    expect(row.attempts).toBe(0);
    expect(row.lastError).toBeNull();

    // A second pass finds nothing to do and does not republish.
    const again = await relay.tick();
    expect(again.claimed).toBe(0);

    await onSubject.stop();
    await onType.stop();
  });
});

describe("relay: per-aggregate ordering", () => {
  it("does not let v2 overtake an unpublished v1 of the same aggregate", async () => {
    const rideId = uid("ride");
    const base = new Date("2026-09-07T10:00:00.000Z");
    const v1 = await insertRow(prisma, {
      aggregateId: rideId,
      toVersion: 1,
      name: "ride.started",
      occurredAt: base,
    });
    // v2 inserted before v1 has been published.
    const v2 = await insertRow(prisma, {
      aggregateId: rideId,
      toVersion: 2,
      name: "ride.completed",
      occurredAt: new Date(base.getTime() + 1000),
    });

    const onSubject = await collect(`ride.${rideId}`);
    const relay = createOutboxRelay({ prisma, redis: pub });

    // First pass: only the head (v1) is eligible.
    const first = await relay.tick();
    expect(first.published).toBe(1);
    await onSubject.waitFor((m) => m.length >= 1);
    expect(readRowPublished(await readRow(prisma, v1))).toBe(true);
    expect(readRowPublished(await readRow(prisma, v2))).toBe(false);

    // Second pass: v1 is done, so v2 becomes eligible.
    const second = await relay.tick();
    expect(second.published).toBe(1);
    await onSubject.waitFor((m) => m.length >= 2);
    expect(readRowPublished(await readRow(prisma, v2))).toBe(true);

    // Delivery order on the subject channel is v1 then v2.
    expect(onSubject.messages.map((x) => x.id)).toEqual([v1, v2]);

    await onSubject.stop();
  });
});

describe("relay: SKIP LOCKED", () => {
  it("two concurrent passes never double-publish the same row", async () => {
    // Many aggregates so both relays can make progress at once.
    const ids: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const rideId = uid("ride");
      ids.push(
        await insertRow(prisma, {
          aggregateId: rideId,
          toVersion: 1,
          name: "ride.completed",
          occurredAt: new Date(Date.now() + i),
        }),
      );
    }

    const onSubject = await collect("ride.*");

    // Two clients / two relays = two DB sessions, like two replicas.
    const prismaB = makePrisma();
    try {
      const relayA = createOutboxRelay({ prisma, redis: pub, batchSize: 100 });
      const relayB = createOutboxRelay({ prisma: prismaB, redis: pub, batchSize: 100 });

      const [a, b] = await Promise.all([relayA.tick(), relayB.tick()]);
      const totalPublished = a.published + b.published;
      expect(totalPublished).toBe(ids.length);

      await onSubject.waitFor((m) => m.filter((x) => ids.includes(x.id)).length >= ids.length);

      // Every id was delivered exactly once — no row published twice.
      for (const id of ids) {
        const count = onSubject.messages.filter((x) => x.id === id).length;
        expect(count, `event ${id} published ${count} times`).toBe(1);
      }

      // All rows marked.
      for (const id of ids) {
        expect(readRowPublished(await readRow(prisma, id))).toBe(true);
      }
    } finally {
      await prismaB.$disconnect();
      await onSubject.stop();
    }
  });

  it("a single contended row is published exactly once by concurrent passes", async () => {
    const rideId = uid("ride");
    const eventId = await insertRow(prisma, { aggregateId: rideId, toVersion: 1 });
    const onSubject = await collect(`ride.${rideId}`);

    const prismaB = makePrisma();
    try {
      const relayA = createOutboxRelay({ prisma, redis: pub });
      const relayB = createOutboxRelay({ prisma: prismaB, redis: pub });
      const [a, b] = await Promise.all([relayA.tick(), relayB.tick()]);
      expect(a.published + b.published).toBe(1);

      await onSubject.waitFor((m) => m.some((x) => x.id === eventId));
      expect(onSubject.messages.filter((x) => x.id === eventId).length).toBe(1);
      expect(readRowPublished(await readRow(prisma, eventId))).toBe(true);
    } finally {
      await prismaB.$disconnect();
      await onSubject.stop();
    }
  });
});

describe("relay: quarantine", () => {
  it("quarantines a bad-envelope row and still publishes the rest", async () => {
    const maxAttempts = 3;
    // Poison: aggregate_type is not a valid subject type, so the envelope fails.
    const poison = await insertRow(prisma, {
      aggregateType: "not_a_subject",
      aggregateId: uid("weird"),
      toVersion: 1,
      occurredAt: new Date(Date.now() - 1000),
    });
    const goodRideId = uid("ride");
    const good = await insertRow(prisma, {
      aggregateId: goodRideId,
      toVersion: 1,
      occurredAt: new Date(),
    });

    const onGood = await collect(`ride.${goodRideId}`);
    const relay = createOutboxRelay({ prisma, redis: pub, maxAttempts });

    const result = await relay.tick();
    expect(result.quarantined).toBe(1);
    expect(result.published).toBe(1);

    await onGood.waitFor((m) => m.some((x) => x.id === good));

    const poisonRow = await readRow(prisma, poison);
    expect(poisonRow.publishedAt).toBeNull();
    expect(poisonRow.attempts).toBe(maxAttempts); // pinned so it is never re-claimed
    expect(poisonRow.lastError).toMatch(/^QUARANTINE:/);

    const goodRow = await readRow(prisma, good);
    expect(goodRow.publishedAt).not.toBeNull();

    // A second pass never re-touches the quarantined row (no hot loop).
    const again = await relay.tick();
    expect(again.claimed).toBe(0);
    expect((await readRow(prisma, poison)).attempts).toBe(maxAttempts);

    await onGood.stop();
  });

  it("a quarantined head does not permanently block a later version", async () => {
    const rideId = uid("ride");
    const base = new Date("2026-09-07T11:00:00.000Z");
    // Same aggregate: v1 is poison (payload is an array, not an object), v2 is fine.
    const v1 = await insertRow(prisma, {
      aggregateId: rideId,
      toVersion: 1,
      payload: [1, 2, 3],
      occurredAt: base,
    });
    const v2 = await insertRow(prisma, {
      aggregateId: rideId,
      toVersion: 2,
      occurredAt: new Date(base.getTime() + 1000),
    });

    const onSubject = await collect(`ride.${rideId}`);
    const relay = createOutboxRelay({ prisma, redis: pub, maxAttempts: 3 });

    // First pass claims only the head v1 and quarantines it.
    const first = await relay.tick();
    expect(first.quarantined).toBe(1);
    expect(first.published).toBe(0);
    expect((await readRow(prisma, v1)).lastError).toMatch(/^QUARANTINE:/);

    // Second pass: v1 no longer blocks (it is exhausted), so v2 publishes.
    const second = await relay.tick();
    expect(second.published).toBe(1);
    await onSubject.waitFor((m) => m.some((x) => x.id === v2));
    expect(readRowPublished(await readRow(prisma, v2))).toBe(true);
    expect(readRowPublished(await readRow(prisma, v1))).toBe(false);

    await onSubject.stop();
  });
});

function readRowPublished(row: { publishedAt: Date | null }): boolean {
  return row.publishedAt !== null;
}
