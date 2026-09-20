/**
 * Tests for marketplace outbox event fan-out.
 *
 * No network: the outbox subscription is exercised against a fake ioredis
 * connection (event-emitter based) and a stubbed connection manager.
 */

import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventEnvelope } from "@ubi/contracts";
import {
  MARKETPLACE_EVENT_PATTERN,
  handleMarketplaceEnvelope,
  resolveAudience,
  subscribeMarketplaceEvents,
  translateEnvelope,
} from "../marketplace-events.js";
import type { WebSocketMessage } from "../types/index.js";

// ===========================================
// Helpers
// ===========================================

function makeEnvelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    name: "mp.bid.submitted",
    version: 1,
    occurredAt: "2026-09-20T10:00:00.000+00:00",
    actor: { type: "driver", id: "drv_bidder" },
    subject: { type: "mp_bid", id: "bid_1" },
    idempotencyKey: "mp_bid:bid_1:submitted",
    fromVersion: 0,
    toVersion: 1,
    cityId: "lagos",
    sequence: 42,
    payload: {
      requestId: "req_1",
      requesterId: "usr_requester",
      driverId: "drv_bidder",
      amountMinor: 250000,
      currency: "NGN",
    },
    ...overrides,
  };
}

interface RecordedBroadcast {
  userId: string;
  message: WebSocketMessage;
}

function makeManager() {
  const broadcasts: RecordedBroadcast[] = [];
  return {
    broadcasts,
    manager: {
      broadcastToUser: vi.fn(async (userId: string, message: WebSocketMessage) => {
        broadcasts.push({ userId, message });
      }),
    },
  };
}

/**
 * Minimal fake of the two ioredis connections subscribeOutbox uses:
 * the subscriber (psubscribe + pmessage events) and its duplicate()d
 * command connection (SET NX for dedupe).
 */
class FakeRedis extends EventEmitter {
  public seen = new Set<string>();
  psubscribe = vi.fn(async (_pattern: string) => 1);
  punsubscribe = vi.fn(async (_pattern: string) => 1);
  quit = vi.fn(async () => "OK");
  duplicate = () => this;
  set = vi.fn(
    async (key: string, _value: string, _ex: string, _ttl: number, _nx: string) => {
      if (this.seen.has(key)) return null;
      this.seen.add(key);
      return "OK" as const;
    },
  );

  emitEvent(channel: string, raw: string) {
    this.emit("pmessage", MARKETPLACE_EVENT_PATTERN, channel, raw);
  }
}

async function flush() {
  // Let the async pmessage handler chain settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// ===========================================
// Envelope -> message translation
// ===========================================

describe("translateEnvelope", () => {
  it("maps envelope fields onto the marketplace_event message", () => {
    const envelope = makeEnvelope();
    const message = translateEnvelope(envelope);

    expect(message.type).toBe("marketplace_event");
    if (message.type !== "marketplace_event") return;

    expect(message.payload.name).toBe("mp.bid.submitted");
    expect(message.payload.subject).toEqual({ type: "mp_bid", id: "bid_1" });
    expect(message.payload.requestId).toBe("req_1");
    expect(message.payload.seq).toBe(42);
    expect(message.payload.occurredAt).toBe("2026-09-20T10:00:00.000+00:00");
    expect(message.payload.data.amountMinor).toBe(250000);
    expect(message.payload.data.currency).toBe("NGN");
  });

  it("derives requestId from an mp_request subject when payload omits it", () => {
    const envelope = makeEnvelope({
      name: "mp.request.closed",
      subject: { type: "mp_request", id: "req_9" },
      payload: { requesterId: "usr_r" },
    });
    const message = translateEnvelope(envelope);
    if (message.type !== "marketplace_event") throw new Error("wrong type");
    expect(message.payload.requestId).toBe("req_9");
  });

  it("carries revision when present and strips recipient lists from data", () => {
    const envelope = makeEnvelope({
      name: "mp.request.published",
      subject: { type: "mp_request", id: "req_2" },
      payload: {
        requesterId: "usr_r",
        audienceDriverIds: ["drv_a", "drv_b"],
        driverIds: ["drv_a"],
        revision: 3,
        fareMinor: 500000,
      },
    });
    const message = translateEnvelope(envelope);
    if (message.type !== "marketplace_event") throw new Error("wrong type");
    expect(message.payload.revision).toBe(3);
    expect(message.payload.data.audienceDriverIds).toBeUndefined();
    expect(message.payload.data.driverIds).toBeUndefined();
    expect(message.payload.data.fareMinor).toBe(500000);
  });
});

// ===========================================
// Audience routing
// ===========================================

describe("resolveAudience", () => {
  it("routes bid events only to the requester and the bidding driver", () => {
    const audience = resolveAudience(makeEnvelope());
    expect(audience.sort()).toEqual(["drv_bidder", "usr_requester"]);
  });

  it("never includes rival bidders on bid events, even if lists are present", () => {
    const audience = resolveAudience(
      makeEnvelope({
        payload: {
          requesterId: "usr_requester",
          driverId: "drv_bidder",
          driverIds: ["drv_rival_1", "drv_rival_2"],
          audienceDriverIds: ["drv_rival_1"],
        },
      }),
    );
    expect(audience.sort()).toEqual(["drv_bidder", "usr_requester"]);
  });

  it("routes request.published to audienceDriverIds computed by the engine", () => {
    const audience = resolveAudience(
      makeEnvelope({
        name: "mp.request.published",
        subject: { type: "mp_request", id: "req_2" },
        payload: {
          requesterId: "usr_requester",
          audienceDriverIds: ["drv_a", "drv_b"],
        },
      }),
    );
    expect(audience.sort()).toEqual(["drv_a", "drv_b", "usr_requester"]);
  });

  it("routes request.published only to the requester without audienceDriverIds", () => {
    const audience = resolveAudience(
      makeEnvelope({
        name: "mp.request.published",
        subject: { type: "mp_request", id: "req_2" },
        payload: { requesterId: "usr_requester" },
      }),
    );
    expect(audience).toEqual(["usr_requester"]);
  });

  it("returns an empty audience when no recipient keys resolve", () => {
    const audience = resolveAudience(
      makeEnvelope({
        name: "mp.award.confirmed",
        subject: { type: "mp_award", id: "awd_1" },
        payload: { somethingElse: true },
      }),
    );
    expect(audience).toEqual([]);
  });
});

describe("handleMarketplaceEnvelope", () => {
  let ctx: ReturnType<typeof makeManager>;

  beforeEach(() => {
    ctx = makeManager();
  });

  it("delivers bid.submitted to the requester but not a rival driver", async () => {
    await handleMarketplaceEnvelope(ctx.manager, makeEnvelope());

    const recipients = ctx.broadcasts.map((b) => b.userId);
    expect(recipients).toContain("usr_requester");
    expect(recipients).toContain("drv_bidder");
    expect(recipients).not.toContain("drv_rival");
    for (const b of ctx.broadcasts) {
      expect(b.message.type).toBe("marketplace_event");
    }
  });

  it("delivers bid.lost to the losing driver", async () => {
    await handleMarketplaceEnvelope(
      ctx.manager,
      makeEnvelope({
        name: "mp.bid.lost",
        subject: { type: "mp_bid", id: "bid_7" },
        payload: {
          requestId: "req_1",
          driverId: "drv_loser",
        },
      }),
    );

    const recipients = ctx.broadcasts.map((b) => b.userId);
    expect(recipients).toEqual(["drv_loser"]);
  });

  it("drops events with no resolvable audience instead of broadcasting", async () => {
    await handleMarketplaceEnvelope(
      ctx.manager,
      makeEnvelope({
        name: "mp.queue.eta_updated",
        subject: { type: "mp_claim", id: "clm_1" },
        payload: { etaSeconds: 300 },
      }),
    );

    expect(ctx.manager.broadcastToUser).not.toHaveBeenCalled();
  });

  it("ignores non-mp events defensively", async () => {
    await handleMarketplaceEnvelope(
      ctx.manager,
      makeEnvelope({
        name: "ride.completed",
        subject: { type: "ride", id: "rd_1" },
        payload: { requesterId: "usr_requester" },
      }),
    );
    expect(ctx.manager.broadcastToUser).not.toHaveBeenCalled();
  });
});

// ===========================================
// Wire-level subscription (fake ioredis, no network)
// ===========================================

describe("subscribeMarketplaceEvents", () => {
  it("psubscribes to event:mp.* and fans out valid envelopes", async () => {
    const redis = new FakeRedis();
    const { manager, broadcasts } = makeManager();

    await subscribeMarketplaceEvents(redis as never, manager);
    expect(redis.psubscribe).toHaveBeenCalledWith(MARKETPLACE_EVENT_PATTERN);

    redis.emitEvent("event:mp.bid.submitted", JSON.stringify(makeEnvelope()));
    await flush();

    expect(broadcasts.map((b) => b.userId).sort()).toEqual([
      "drv_bidder",
      "usr_requester",
    ]);
  });

  it("drops malformed envelopes without broadcasting", async () => {
    const redis = new FakeRedis();
    const { manager } = makeManager();

    await subscribeMarketplaceEvents(redis as never, manager);

    redis.emitEvent("event:mp.bid.submitted", "{not json");
    redis.emitEvent(
      "event:mp.bid.submitted",
      JSON.stringify({ name: "mp.bid.submitted", payload: {} }),
    );
    await flush();

    expect(manager.broadcastToUser).not.toHaveBeenCalled();
  });

  it("dedupes redelivery of the same envelope id", async () => {
    const redis = new FakeRedis();
    const { manager } = makeManager();

    await subscribeMarketplaceEvents(redis as never, manager);

    const envelope = makeEnvelope({ id: "evt_fixed" });
    redis.emitEvent("event:mp.bid.submitted", JSON.stringify(envelope));
    redis.emitEvent("event:mp.bid.submitted", JSON.stringify(envelope));
    await flush();

    // 2 recipients from the first delivery only.
    expect(manager.broadcastToUser).toHaveBeenCalledTimes(2);
  });
});
