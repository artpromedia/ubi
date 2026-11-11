/**
 * Consumer helper integration test (real Redis).
 *
 * The outbox is at-least-once: a row can be redelivered (relay retry, replica
 * restart, a duplicate publish). `subscribeOutbox` must hand each event id to
 * the handler exactly once, which it does with a Redis SET NX + TTL keyed on the
 * id (CLAUDE.md #2: consumers idempotent on id).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import type { EventEnvelope } from "@ubi/contracts";

import { subscribeOutbox } from "../src/consumer";
import {
  OUTBOX_DLQ_STREAM_KEY,
  OUTBOX_STREAM_KEY,
  subjectChannel,
} from "../src/channels";
import { publishOutboxEnvelope } from "../src/relay";
import { makeRedis, uid, until } from "./helpers";

let sub: Redis;
let pub: Redis;

beforeAll(async () => {
  sub = makeRedis();
  pub = makeRedis();
  await pub.del(OUTBOX_STREAM_KEY, OUTBOX_DLQ_STREAM_KEY);
});

afterEach(async () => {
  await pub.del(OUTBOX_STREAM_KEY, OUTBOX_DLQ_STREAM_KEY);
});

afterAll(async () => {
  await sub.quit();
  await pub.quit();
});

function envelope(id: string, rideId: string): EventEnvelope {
  return {
    id,
    name: "ride.completed",
    version: 1,
    occurredAt: new Date().toISOString(),
    actor: { type: "system", id: "matching" },
    subject: { type: "ride", id: rideId },
    idempotencyKey: id,
    fromVersion: 0,
    toVersion: 1,
    cityId: "LOS",
    payload: { rideId },
  };
}

describe("subscribeOutbox dedupe", () => {
  it("delivers a redelivered id to the handler only once, but new ids pass through", async () => {
    const seen: string[] = [];
    const subscription = await subscribeOutbox(
      sub,
      "ride.*",
      (env) => {
        seen.push(env.id);
      },
      { dedupeTtlSeconds: 60, dedupeKeyPrefix: `outbox:test:${uid("run")}:` },
    );

    try {
      const rideId = uid("ride");
      const first = envelope(uid("evt"), rideId);
      const channel = subjectChannel(first.subject);
      const message = JSON.stringify(first);

      // First delivery is handled.
      await pub.publish(channel, message);
      await until(() => seen.length === 1);
      expect(seen).toEqual([first.id]);

      // Redelivery of the SAME id is dropped.
      await pub.publish(channel, message);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(seen).toEqual([first.id]);

      // A genuinely new id still gets through.
      const second = envelope(uid("evt"), rideId);
      await pub.publish(channel, JSON.stringify(second));
      await until(() => seen.length === 2);
      expect(seen).toEqual([first.id, second.id]);
    } finally {
      await subscription.stop();
    }
  });

  it("ignores a malformed message without invoking the handler", async () => {
    const seen: string[] = [];
    const errors: unknown[] = [];
    const subscription = await subscribeOutbox(
      sub,
      "ride.*",
      (env) => {
        seen.push(env.id);
      },
      {
        dedupeKeyPrefix: `outbox:test:${uid("run")}:`,
        onError: (err) => {
          errors.push(err);
        },
      },
    );

    try {
      const rideId = uid("ride");
      await pub.publish(
        subjectChannel({ type: "ride", id: rideId }),
        "{not valid json",
      );
      await until(() => errors.length === 1);
      expect(seen).toEqual([]);
    } finally {
      await subscription.stop();
    }
  });
});

describe("subscribeOutbox durable Redis Streams", () => {
  it("delivers an event published BEFORE subscribeOutbox started (late-starting consumer)", async () => {
    const rideId = uid("ride");
    const lateEvent = envelope(uid("evt"), rideId);

    // Publish to durable stream BEFORE any consumer subscribes.
    await publishOutboxEnvelope(pub, lateEvent);

    const seen: string[] = [];
    const groupName = `outbox:test:cg:${uid("late")}`;
    const subscription = await subscribeOutbox(
      sub,
      "ride.*",
      (env) => {
        seen.push(env.id);
      },
      {
        dedupeTtlSeconds: 60,
        dedupeKeyPrefix: `outbox:test:${uid("run")}:`,
        groupName,
      },
    );

    try {
      await until(() => seen.length === 1);
      expect(seen).toEqual([lateEvent.id]);

      const pending = (await pub.xpending(
        OUTBOX_STREAM_KEY,
        groupName,
        "-",
        "+",
        10,
      )) as unknown[];
      expect(pending).toHaveLength(0);
    } finally {
      await subscription.stop();
    }
  });

  it("negative control: transport='pubsub' started after publish misses the event", async () => {
    const rideId = uid("ride");
    const missedEvent = envelope(uid("evt"), rideId);

    // Publish BEFORE the pubsub-only consumer subscribes.
    await publishOutboxEnvelope(pub, missedEvent);

    const seen: string[] = [];
    const subscription = await subscribeOutbox(
      sub,
      "ride.*",
      (env) => {
        seen.push(env.id);
      },
      {
        transport: "pubsub",
        dedupeTtlSeconds: 60,
        dedupeKeyPrefix: `outbox:test:${uid("run")}:`,
      },
    );

    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(seen).toEqual([]);
    } finally {
      await subscription.stop();
    }
  });

  it("retries a throwing handler with backoff and moves the entry to outbox:dlq after maxDeliveries", async () => {
    const rideId = uid("ride");
    const poisonEvent = envelope(uid("evt"), rideId);
    const streamKey = `outbox:stream:${uid("test")}`;
    const dlqStreamKey = `outbox:dlq:${uid("test")}`;
    const groupName = `outbox:test:cg:${uid("retry")}`;

    await publishOutboxEnvelope(pub, poisonEvent, { streamKey });

    let attempts = 0;
    const errors: unknown[] = [];
    const subscription = await subscribeOutbox(
      sub,
      "ride.*",
      () => {
        attempts += 1;
        throw new Error("downstream_boom");
      },
      {
        streamKey,
        dlqStreamKey,
        groupName,
        dedupeKeyPrefix: `outbox:test:${uid("run")}:`,
        maxDeliveries: 3,
        retryBackoffBaseMs: 20,
        retryBackoffMaxMs: 60,
        pollIntervalMs: 10,
        onError: (err) => {
          errors.push(err);
        },
      },
    );

    try {
      await until(async () => (await pub.xlen(dlqStreamKey)) === 1, 5_000);
      expect(attempts).toBe(3);
      expect(errors).toHaveLength(3);

      const pending = (await pub.xpending(
        streamKey,
        groupName,
        "-",
        "+",
        10,
      )) as unknown[];
      expect(pending).toHaveLength(0);

      const dlqRows = (await pub.xrange(dlqStreamKey, "-", "+")) as Array<
        [string, string[]]
      >;
      expect(dlqRows).toHaveLength(1);
      const fields = dlqRows[0]![1];
      const record: Record<string, string> = {};
      for (let i = 0; i + 1 < fields.length; i += 2) {
        record[fields[i]!] = fields[i + 1]!;
      }
      expect(record.id).toBe(poisonEvent.id);
      expect(record.attempts).toBe("3");
      expect(record.error).toBe("downstream_boom");
    } finally {
      await subscription.stop();
      await pub.del(streamKey, dlqStreamKey);
    }
  });
});
