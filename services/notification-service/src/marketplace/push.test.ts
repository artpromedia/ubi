/**
 * Durable marketplace push (G10) — unit tests.
 *
 * No network, no Redis, no Prisma, no FCM: the deliverer is exercised through
 * in-memory fakes, exactly as the rest of this service's tests validate logic
 * without infrastructure.
 */
/* eslint-disable require-await, @typescript-eslint/require-await -- async port fakes intentionally have no awaits */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MarketplacePushDeliverer,
  type DeadLetterEntry,
  type MarketplacePushPorts,
  type PendingEntry,
  type PushNotification,
  type PushSendResult,
} from "./push.js";

import type { EventEnvelope } from "@ubi/contracts";

function makeEnvelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    name: "mp.bid.won",
    version: 1,
    occurredAt: "2026-09-21T10:00:00.000+00:00",
    actor: { type: "system", id: "ride-service" },
    subject: { type: "mp_bid", id: "bid_1" },
    idempotencyKey: "mp_bid:bid_1:won",
    fromVersion: 0,
    toVersion: 1,
    cityId: "lagos",
    sequence: 10,
    payload: {
      requestId: "req_1",
      requesterId: "usr_requester",
      driverId: "drv_winner",
      awardId: "awd_1",
      // Money that MUST NEVER reach a push payload:
      amountMinor: 280000,
      currency: "NGN",
    },
    ...overrides,
  };
}

interface Recorded {
  sends: { userId: string; tokens: string[]; notification: PushNotification }[];
  deactivated: string[][];
  deadLetters: DeadLetterEntry[];
  pending: PendingEntry[];
}

interface FakeConfig {
  tokensByUser?: Record<string, string[]>;
  prefAllows?: (userId: string, category: string) => boolean;
  sendResults?: PushSendResult[]; // consumed in order; last one repeats
  maxAttempts?: number;
}

function makePorts(cfg: FakeConfig = {}): {
  ports: MarketplacePushPorts;
  rec: Recorded;
  seen: Set<string>;
  seqBySubject: Map<string, number>;
} {
  const rec: Recorded = {
    sends: [],
    deactivated: [],
    deadLetters: [],
    pending: [],
  };
  const seen = new Set<string>();
  const seqBySubject = new Map<string, number>();
  let sendIdx = 0;

  const ports: MarketplacePushPorts = {
    devices: {
      activeTokens: async (userId) =>
        cfg.tokensByUser?.[userId] ?? ["tok_" + userId],
      deactivate: async (tokens) => {
        rec.deactivated.push(tokens);
      },
    },
    prefs: {
      allows: async (userId, category) =>
        cfg.prefAllows ? cfg.prefAllows(userId, category) : true,
    },
    sender: {
      send: async (userId, tokens, notification) => {
        rec.sends.push({ userId, tokens, notification });
        const results = cfg.sendResults ?? [{ success: true }];
        const r = results[Math.min(sendIdx, results.length - 1)];
        sendIdx += 1;
        return r ?? { success: true };
      },
    },
    state: {
      firstSightOfEvent: async (eventId) => {
        if (seen.has(eventId)) {
          return false;
        }
        seen.add(eventId);
        return true;
      },
      advanceSubjectSequence: async (subjectKey, sequence) => {
        const cur = seqBySubject.get(subjectKey) ?? -1;
        if (sequence > cur) {
          seqBySubject.set(subjectKey, sequence);
          return true;
        }
        return false;
      },
    },
    deadLetters: {
      record: async (entry) => {
        rec.deadLetters.push(entry);
      },
    },
    pending: {
      record: async (entry) => {
        rec.pending.push(entry);
      },
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    maxAttempts: cfg.maxAttempts ?? 3,
    backoff: { baseMs: 1, maxMs: 2 },
    delay: async () => {}, // no real waiting in tests
  };
  return { ports, rec, seen, seqBySubject };
}

describe("MarketplacePushDeliverer", () => {
  let ctx: ReturnType<typeof makePorts>;
  beforeEach(() => {
    ctx = makePorts();
  });

  it("delivers the winner push and NEVER carries the bid amount or a PIN", async () => {
    const deliverer = new MarketplacePushDeliverer(ctx.ports);
    const res = await deliverer.handle(makeEnvelope());

    expect(res.outcome).toBe("processed");
    const winner = res.perUser.find((u) => u.userId === "drv_winner");
    expect(winner?.outcome).toBe("delivered");

    // Every send's data payload is a hint: ids and type only.
    for (const send of ctx.rec.sends) {
      const data = send.notification.data;
      expect(data.amountMinor).toBeUndefined();
      expect(data.currency).toBeUndefined();
      expect(data.pin).toBeUndefined();
      expect(data.fareMinor).toBeUndefined();
      // Title/body carry no numbers either.
      expect(JSON.stringify(send.notification)).not.toContain("280000");
      expect(JSON.stringify(send.notification)).not.toContain("2800");
      expect(data.requestId).toBe("req_1");
      expect(data.kind).toBe("marketplace");
    }
  });

  it("notifies the losing bidder only, never a rival, and with no amount", async () => {
    const deliverer = new MarketplacePushDeliverer(ctx.ports);
    const res = await deliverer.handle(
      makeEnvelope({
        id: "evt_lost",
        name: "mp.bid.lost",
        subject: { type: "mp_bid", id: "bid_7" },
        payload: {
          requestId: "req_1",
          driverId: "drv_loser",
          // rival lists that must be ignored for bid events
          driverIds: ["drv_rival_1", "drv_rival_2"],
          audienceDriverIds: ["drv_rival_1"],
          amountMinor: 310000,
        },
      }),
    );

    const recipients = res.perUser.map((u) => u.userId);
    expect(recipients).toEqual(["drv_loser"]);
    expect(recipients).not.toContain("drv_rival_1");
    for (const send of ctx.rec.sends) {
      expect(JSON.stringify(send.notification)).not.toContain("310000");
    }
  });

  it("keeps bid.submitted private: the requester is told, never a rival (nor the bidder, who sent it)", async () => {
    // Per-viewer copy: "New offer on your request" is the REQUESTER's copy.
    // (Before per-viewer copy the bidding driver received it too.)
    const deliverer = new MarketplacePushDeliverer(ctx.ports);
    const res = await deliverer.handle(
      makeEnvelope({
        id: "evt_sub",
        name: "mp.bid.submitted",
        actor: { type: "driver", id: "drv_bidder" },
        subject: { type: "mp_bid", id: "bid_9" },
        payload: {
          requestId: "req_1",
          requesterId: "usr_requester",
          driverId: "drv_bidder",
          driverIds: ["drv_rival"],
          amountMinor: 250000,
        },
      }),
    );
    const recipients = res.perUser.map((u) => u.userId).sort();
    expect(recipients).toEqual(["usr_requester"]);
    expect(ctx.rec.sends[0]?.notification.title).toBe(
      "New offer on your request",
    );
    expect(JSON.stringify(ctx.rec.sends)).not.toContain("250000");
  });

  it("records an offline recipient for retry instead of dropping it", async () => {
    ctx = makePorts({ tokensByUser: { drv_winner: [], usr_requester: [] } });
    const deliverer = new MarketplacePushDeliverer(ctx.ports);
    const res = await deliverer.handle(makeEnvelope());

    const winner = res.perUser.find((u) => u.userId === "drv_winner");
    expect(winner?.outcome).toBe("deferred_no_device");
    expect(ctx.rec.pending.some((p) => p.userId === "drv_winner")).toBe(true);
    expect(ctx.rec.sends).toHaveLength(0);
  });

  it("converges a promotion that arrived while the rider was disconnected", async () => {
    // First: rider offline → deferred + recorded for retry.
    const offline = makePorts({ tokensByUser: { usr_requester: [] } });
    const d1 = new MarketplacePushDeliverer(offline.ports);
    const promo = makeEnvelope({
      id: "evt_promo",
      name: "mp.claim.promoted",
      subject: { type: "mp_claim", id: "clm_1" },
      payload: {
        requestId: "req_1",
        requesterId: "usr_requester",
        driverId: "drv_winner",
      },
    });
    const first = await d1.handle(promo);
    expect(
      first.perUser.find((u) => u.userId === "usr_requester")?.outcome,
    ).toBe("deferred_no_device");
    expect(offline.rec.pending).toHaveLength(1);

    // Later: the rider reconnects (a device registers) and the retry delivers.
    const online = makePorts({ tokensByUser: { usr_requester: ["tok_new"] } });
    const d2 = new MarketplacePushDeliverer(online.ports);
    const second = await d2.handle(promo);
    expect(
      second.perUser.find((u) => u.userId === "usr_requester")?.outcome,
    ).toBe("delivered");
  });

  it("dedupes a redelivered event id", async () => {
    const deliverer = new MarketplacePushDeliverer(ctx.ports);
    const env = makeEnvelope({ id: "evt_fixed" });
    const first = await deliverer.handle(env);
    const second = await deliverer.handle(env);
    expect(first.outcome).toBe("processed");
    expect(second.outcome).toBe("deduped");
    // Winner delivered exactly once across both deliveries.
    expect(ctx.rec.sends.filter((s) => s.userId === "drv_winner")).toHaveLength(
      1,
    );
  });

  it("tolerates out-of-order delivery: an older sequence is dropped as stale", async () => {
    const deliverer = new MarketplacePushDeliverer(ctx.ports);
    const subject = { type: "mp_claim" as const, id: "clm_seq" };
    const newer = await deliverer.handle(
      makeEnvelope({
        id: "evt_seq5",
        name: "mp.queue.eta_updated",
        subject,
        sequence: 5,
        payload: { requestId: "req_1", requesterId: "usr_requester" },
      }),
    );
    const older = await deliverer.handle(
      makeEnvelope({
        id: "evt_seq3",
        name: "mp.queue.eta_updated",
        subject,
        sequence: 3,
        payload: { requestId: "req_1", requesterId: "usr_requester" },
      }),
    );
    expect(newer.outcome).toBe("processed");
    expect(older.outcome).toBe("stale");
    expect(
      ctx.rec.sends.filter((s) => s.userId === "usr_requester"),
    ).toHaveLength(1);
  });

  it("suppresses an expired offer (unmapped event) without sending", async () => {
    const deliverer = new MarketplacePushDeliverer(ctx.ports);
    const res = await deliverer.handle(
      makeEnvelope({
        id: "evt_exp",
        name: "mp.bid.expired",
        subject: { type: "mp_bid", id: "bid_exp" },
        payload: {
          requestId: "req_1",
          driverId: "drv_bidder",
          amountMinor: 200000,
        },
      }),
    );
    expect(res.outcome).toBe("skipped_event");
    expect(ctx.rec.sends).toHaveLength(0);
  });

  it("retries with backoff and dead-letters after exhausted attempts", async () => {
    ctx = makePorts({
      tokensByUser: { drv_winner: ["tok_a"], usr_requester: ["tok_b"] },
      sendResults: [{ success: false, error: "fcm_unavailable" }], // always fails
      maxAttempts: 3,
    });
    const deliverer = new MarketplacePushDeliverer(ctx.ports);
    const res = await deliverer.handle(makeEnvelope());

    const winner = res.perUser.find((u) => u.userId === "drv_winner");
    expect(winner?.outcome).toBe("dead_lettered");
    expect(winner?.attempts).toBe(3);
    expect(ctx.rec.deadLetters.some((d) => d.userId === "drv_winner")).toBe(
      true,
    );
    // 3 attempts per user.
    expect(ctx.rec.sends.filter((s) => s.userId === "drv_winner")).toHaveLength(
      3,
    );
  });

  it("deactivates invalid tokens (rotation) and still delivers via a valid one", async () => {
    ctx = makePorts({
      tokensByUser: {
        drv_winner: ["tok_dead", "tok_live"],
        usr_requester: ["tok_r"],
      },
      // First send: invalid token reported but overall delivered to the live one.
      sendResults: [{ success: true, invalidTokens: ["tok_dead"] }],
    });
    const deliverer = new MarketplacePushDeliverer(ctx.ports);
    const res = await deliverer.handle(makeEnvelope());

    const winner = res.perUser.find((u) => u.userId === "drv_winner");
    expect(winner?.outcome).toBe("delivered");
    expect(ctx.rec.deactivated.flat()).toContain("tok_dead");
  });

  it("honors a per-user push opt-out", async () => {
    ctx = makePorts({ prefAllows: (userId) => userId !== "drv_winner" });
    const deliverer = new MarketplacePushDeliverer(ctx.ports);
    const res = await deliverer.handle(makeEnvelope());
    expect(res.perUser.find((u) => u.userId === "drv_winner")?.outcome).toBe(
      "suppressed_prefs",
    );
    expect(ctx.rec.sends.some((s) => s.userId === "drv_winner")).toBe(false);
  });

  it("recognizes the dedicated settlement event (G15) and notifies via the payment category", async () => {
    const seen: string[] = [];
    ctx = makePorts({
      prefAllows: (userId, category) => {
        seen.push(category);
        return true;
      },
    });
    const deliverer = new MarketplacePushDeliverer(ctx.ports);
    const res = await deliverer.handle(
      makeEnvelope({
        id: "evt_settle",
        name: "mp.settlement.posted",
        subject: { type: "mp_award", id: "awd_1" },
        payload: {
          requestId: "req_1",
          requesterId: "usr_requester",
          driverId: "drv_winner",
          settlementId: "stl_1",
          amountMinor: 280000,
        },
      }),
    );
    expect(res.outcome).toBe("processed");
    expect(res.perUser.some((u) => u.outcome === "delivered")).toBe(true);
    expect(seen).toContain("payment");
    for (const send of ctx.rec.sends) {
      expect(JSON.stringify(send.notification)).not.toContain("280000");
    }
  });
});
