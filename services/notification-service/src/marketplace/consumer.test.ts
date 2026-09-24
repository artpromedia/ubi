/**
 * Outbox push consumer against REAL Redis (db 5): real pattern subscriptions
 * (one connection per pattern) through @ubi/outbox, the Redis-backed dedupe,
 * dead-letter and pending ports. FCM, the SMS provider, preferences and the
 * party directory are fakes (Prisma-backed directory: parties.test.ts).
 */
/* eslint-disable require-await, @typescript-eslint/require-await -- async fakes intentionally have no awaits */
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NOTIFICATION_PATTERNS, subscribeMarketplacePush } from "./consumer.js";
import {
  TEST_REDIS_URL,
  deleteKeys,
  runPrefix,
  sleep,
  waitFor,
} from "../test-support/redis.js";

import type { PartyDirectory } from "./parties.js";
import type { PushNotification, PushSendResult } from "./push.js";
import type { EventEnvelope } from "@ubi/contracts";
import type { OutboxSubscription } from "@ubi/outbox";

const RUN = Math.random().toString(36).slice(2, 10);
const R = `aaaaaaaa-0000-4000-8000-${RUN.padEnd(12, "0")}`;
const D = `dddddddd-0000-4000-8000-${RUN.padEnd(12, "0")}`;
const T = `tttttttt-0000-4000-8000-${RUN.padEnd(12, "0")}`;
const S = `ssssssss-0000-4000-8000-${RUN.padEnd(12, "0")}`;
const AWARD = `11111111-0000-4000-8000-${RUN.padEnd(12, "0")}`;
const TRANSFER = `trf_${RUN}`;
const FAILING_USER = `ffffffff-0000-4000-8000-${RUN.padEnd(12, "0")}`;
const MINE = new Set([R, D, T, S, FAILING_USER]);

let seq = 0;
function envelope(
  name: string,
  subject: EventEnvelope["subject"],
  payload: Record<string, unknown>,
  actor: EventEnvelope["actor"] = { type: "system", id: "ride-service" },
): EventEnvelope {
  seq += 1;
  const id = `evt_${RUN}_${seq}`;
  return {
    id,
    name,
    version: 1,
    occurredAt: "2026-09-23T10:00:00.000Z",
    actor,
    subject,
    idempotencyKey: `${name}:${id}`.slice(0, 64),
    fromVersion: null,
    toVersion: 1,
    cityId: "lagos",
    payload,
  };
}

const sends: { userId: string; notification: PushNotification }[] = [];
const smsSent: { to: string; message: string }[] = [];
const prefix = runPrefix("push");
let commands: Redis;
let publisher: Redis;
let subscription: OutboxSubscription;

const parties: PartyDirectory = {
  award: async (awardId) =>
    awardId === AWARD ? { requesterId: R, driverId: D } : null,
  requester: async () => null,
  traveller: async (transferId) => (transferId === TRANSFER ? T : null),
};

async function publish(env: EventEnvelope): Promise<void> {
  await publisher.publish(`event:${env.name}`, JSON.stringify(env));
}

const mine = () => sends.filter((s) => MINE.has(s.userId));

beforeAll(async () => {
  commands = new Redis(TEST_REDIS_URL);
  publisher = new Redis(TEST_REDIS_URL);
  subscription = await subscribeMarketplacePush(
    () => new Redis(TEST_REDIS_URL),
    commands,
    {
      overrides: {
        keyPrefix: prefix,
        parties,
        devices: {
          activeTokens: async (userId) =>
            userId === S ? [] : [`tok_${userId}`],
          deactivate: async () => {},
        },
        prefs: { allows: async () => true },
        sender: {
          send: async (
            userId,
            _tokens,
            notification,
          ): Promise<PushSendResult> => {
            sends.push({ userId, notification });
            return userId === FAILING_USER
              ? { success: false, error: "fcm_unavailable" }
              : { success: true };
          },
        },
        sms: {
          phones: {
            verifiedPhone: async (userId) =>
              userId === S ? "+2348030000004" : null,
          },
          sender: {
            send: async (to, message) => {
              smsSent.push({ to, message });
              return { success: true, provider: "fake" };
            },
          },
          allows: async () => true,
        },
        maxAttempts: 2,
        delay: async () => {},
        logger: {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
        },
      },
    },
  );
});

afterAll(async () => {
  await subscription.stop();
  await deleteKeys(commands, prefix);
  await Promise.allSettled([commands.quit(), publisher.quit()]);
});

describe("outbox push consumer (real Redis)", () => {
  it("subscribes every notification pattern", () => {
    expect(NOTIFICATION_PATTERNS).toEqual([
      "event:mp.*",
      "event:trip_access.declined",
      "event:reservation.*",
      "event:shipment.return_proposed",
    ]);
  });

  it("routes each family to its audience with per-viewer copy, exactly once per recipient", async () => {
    await publish(
      envelope(
        "mp.amendment.committed",
        { type: "mp_amendment", id: `amd_${RUN}` },
        {
          amendmentId: `amd_${RUN}`,
          awardId: AWARD,
          requestId: "req",
          state: "committed",
          commissionDeltaMinor: 3150,
          riderFundingDeltaMinor: 31500,
        },
      ),
    );
    await publish(
      envelope(
        "reservation.assigned",
        { type: "reservation", id: TRANSFER },
        { transferId: TRANSFER, state: "awarded", driverSecured: true },
        { type: "system", id: "travel-service" },
      ),
    );
    await publish(
      envelope(
        "trip_access.declined",
        { type: "trip_access", id: `tac_${RUN}` },
        { tokenId: `tac_${RUN}`, requesterId: R, feeMinor: 0 },
        { type: "rider", id: `tac_${RUN}` },
      ),
    );

    await waitFor(() => mine().length === 4, 5_000, "four pushes");
    const label: Record<string, string> = { [R]: "R", [D]: "D", [T]: "T" };
    const titles = mine()
      .map((s) => `${label[s.userId] ?? "?"}:${s.notification.title}`)
      .sort();
    expect(titles).toEqual([
      "D:Trip updated",
      "R:Trip updated",
      "R:Your passenger declined the ride",
      "T:Driver secured for your airport ride",
    ]);
    // Per-viewer bodies differ for the same event.
    const rider = mine().find(
      (s) => s.userId === R && s.notification.title === "Trip updated",
    );
    const driver = mine().find((s) => s.userId === D);
    expect(rider?.notification.body).toContain("fare");
    expect(driver?.notification.body).toContain("earnings");
    expect(JSON.stringify(mine())).not.toMatch(/3150|31500/);
  });

  it("dedupes a redelivered event", async () => {
    const before = mine().length;
    const env = envelope(
      "mp.stop.excessive_waiting",
      { type: "mp_award", id: AWARD },
      { awardId: AWARD, requestId: "req", stopId: "stp", state: "arrived" },
    );
    await publish(env);
    await publish(env);
    await waitFor(() => mine().length === before + 2, 5_000, "two pushes");
    await sleep(250);
    expect(mine().length).toBe(before + 2);
  });

  it("ignores events outside the table (trip_access.issued is never pushed)", async () => {
    const before = mine().length;
    await publish(
      envelope(
        "trip_access.issued",
        { type: "trip_access", id: `tac_i_${RUN}` },
        { tokenId: `tac_i_${RUN}`, requesterId: R },
      ),
    );
    await sleep(300);
    expect(mine().length).toBe(before);
  });

  it("falls back to ONE SMS for a time-critical event with no device", async () => {
    await publish(
      envelope(
        "shipment.return_proposed",
        { type: "shipment", id: `dlv_${RUN}` },
        {
          deliveryId: `dlv_${RUN}`,
          senderId: S,
          chargeStatus: "authorization_required",
        },
        { type: "driver", id: D },
      ),
    );
    await waitFor(
      () => smsSent.some((m) => m.to === "+2348030000004"),
      5_000,
      "the SMS fallback",
    );
    expect(smsSent.filter((m) => m.to === "+2348030000004")).toEqual([
      {
        to: "+2348030000004",
        message:
          "UBI: Approve a return fee. Your delivery couldn't be completed. Open UBI to approve the return fee or choose another option before the deadline.",
      },
    ]);
    const pending = (await commands.lrange(`${prefix}pending`, 0, -1)).map(
      (raw) => JSON.parse(raw) as Record<string, unknown>,
    );
    expect(
      pending.some((p) => p.userId === S && p.reason === "no_active_device"),
    ).toBe(true);
  });

  it("dead-letters exhausted pushes and unresolved audiences into the Redis DLQ", async () => {
    const failing = envelope(
      "mp.scheduled_request.published",
      { type: "mp_scheduled_request", id: `sch_${RUN}` },
      { scheduledRequestId: `sch_${RUN}`, requesterId: FAILING_USER },
    );
    const orphan = envelope(
      "mp.amendment.expired",
      { type: "mp_amendment", id: `amd_orphan_${RUN}` },
      { amendmentId: `amd_orphan_${RUN}`, awardId: "not-a-known-award" },
    );
    await publish(failing);
    await publish(orphan);

    const dlq = async () =>
      (await commands.lrange(`${prefix}dlq`, 0, -1)).map(
        (raw) => JSON.parse(raw) as Record<string, unknown>,
      );
    await waitFor(
      async () =>
        (await dlq()).filter(
          (e) => e.eventId === failing.id || e.eventId === orphan.id,
        ).length === 3,
      5_000,
      "three DLQ entries",
    );
    const entries = (await dlq()).filter(
      (e) => e.eventId === failing.id || e.eventId === orphan.id,
    );
    expect(
      entries
        .map(
          (e) => `${String(e.eventName)}|${String(e.role)}|${String(e.reason)}`,
        )
        .sort(),
    ).toEqual([
      "mp.amendment.expired|driver|audience_unresolved: driver_not_found",
      "mp.amendment.expired|requester|audience_unresolved: requester_not_found",
      "mp.scheduled_request.published|requester|fcm_unavailable",
    ]);
    // The failing user got exactly maxAttempts sends, then the DLQ.
    expect(sends.filter((s) => s.userId === FAILING_USER)).toHaveLength(2);
  });
});
