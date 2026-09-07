/**
 * Consumer helper integration test (real Redis).
 *
 * The outbox is at-least-once: a row can be redelivered (relay retry, replica
 * restart, a duplicate publish). `subscribeOutbox` must hand each event id to
 * the handler exactly once, which it does with a Redis SET NX + TTL keyed on the
 * id (CLAUDE.md #2: consumers idempotent on id).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import type { EventEnvelope } from "@ubi/contracts";

import { subscribeOutbox } from "../src/consumer";
import { subjectChannel } from "../src/channels";
import { makeRedis, uid, until } from "./helpers";

let sub: Redis;
let pub: Redis;

beforeAll(() => {
  sub = makeRedis();
  pub = makeRedis();
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
      await pub.publish(subjectChannel({ type: "ride", id: rideId }), "{not valid json");
      await until(() => errors.length === 1);
      expect(seen).toEqual([]);
    } finally {
      await subscription.stop();
    }
  });
});
