/**
 * Tests for marketplace outbox event fan-out and per-recipient leak prevention.
 *
 * No network: the outbox subscription is exercised against a fake ioredis
 * connection (event-emitter based) and a stubbed connection manager.
 */

import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVENT_NAMES,
  MpBidSubmittedPayloadSchema,
  type EventEnvelope,
} from "@ubi/contracts";
import {
  FORBIDDEN_DRIVER_KEYS,
  FORBIDDEN_REQUESTER_KEYS,
  MARKETPLACE_EVENT_PATTERN,
  MARKETPLACE_EVENT_SPECS,
  handleMarketplaceEnvelope,
  resolveAudience,
  resolveAudienceByRole,
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
      bidId: "bid_1",
      requestId: "req_1",
      requesterId: "usr_requester",
      requestRevision: 1,
      driverId: "drv_bidder",
      amountMinor: 250000,
      commissionMinor: 25000,
      slot: "current",
      reservationId: "res_1",
      expiresAt: "2026-09-20T10:05:00.000+00:00",
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
      broadcastToUser: vi.fn(
        async (userId: string, message: WebSocketMessage) => {
          broadcasts.push({ userId, message });
        },
      ),
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
    async (
      key: string,
      _value: string,
      _ex: string,
      _ttl: number,
      _nx: string,
    ) => {
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
    const message = translateEnvelope(envelope, "requester");

    expect(message.type).toBe("marketplace_event");
    if (message.type !== "marketplace_event") return;

    expect(message.seq).toBe(42);
    expect(message.occurredAt).toBe("2026-09-20T10:00:00.000+00:00");
    expect(message.payload.name).toBe("mp.bid.submitted");
    expect(message.payload.subject).toEqual({ type: "mp_bid", id: "bid_1" });
    expect(message.payload.requestId).toBe("req_1");
    expect(message.payload.seq).toBe(42);
    expect(message.payload.occurredAt).toBe("2026-09-20T10:00:00.000+00:00");
    expect(message.payload.data.amountMinor).toBe(250000);
    expect(message.payload.data.currency).toBe("NGN");
    // Requester copy NEVER carries driver commission or reservationId
    expect(message.payload.data.commissionMinor).toBeUndefined();
    expect(message.payload.data.reservationId).toBeUndefined();
  });

  it("includes commissionMinor and reservationId on the driver copy of mp.bid.submitted", () => {
    const envelope = makeEnvelope();
    const message = translateEnvelope(envelope, "driver");
    if (message.type !== "marketplace_event") throw new Error("wrong type");
    expect(message.payload.data.commissionMinor).toBe(25000);
    expect(message.payload.data.reservationId).toBe("res_1");
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
// Per-recipient allowlist & leak prevention (CC-A11 / P2-09)
// ===========================================

describe("MARKETPLACE_EVENT_SPECS coverage and leak prevention (P2-09)", () => {
  const allMpEventNames = EVENT_NAMES.filter((name) => name.startsWith("mp."));

  it("registers every mp.* event name in EVENT_NAMES", () => {
    expect(allMpEventNames.length).toBeGreaterThan(80);
    const missing = allMpEventNames.filter(
      (name) => !(name in MARKETPLACE_EVENT_SPECS),
    );
    expect(missing).toEqual([]);
  });

  it("strips all forbidden and unallowlisted keys for every mp.* event across requester and driver roles", () => {
    const toxicPayload: Record<string, unknown> = {
      requestId: "req_1",
      requesterId: "usr_requester",
      driverId: "drv_driver",
      awardId: "awd_1",
      bidId: "bid_1",
      bookingId: "bkg_1",
      fareMinor: 400000,
      amountMinor: 400000,
      currency: "NGN",
      // Forbidden requester keys (driver-private)
      commissionMinor: 40000,
      netMinor: 360000,
      driverNetMinor: 360000,
      commissionBps: 1000,
      reservationId: "res_secret",
      holdId: "hld_secret",
      driverPayoutMinor: 360000,
      fleetRemittanceMinor: 50000,
      splitRule: "percent_of_net",
      driverPhone: "+2348000000001",
      driverEmail: "driver@example.com",
      // Forbidden driver keys (requester/passenger/business-private)
      riderName: "Ada Lovelace",
      riderFirstName: "Ada",
      riderLastName: "Lovelace",
      riderPhone: "+2348000000002",
      riderEmail: "ada@example.com",
      passengerPhone: "+2348000000003",
      passengerFirstName: "Grace",
      sealed: "aes-gcm-ciphertext",
      sealedToken: "tok_secret",
      organizationId: "org_secret",
      costCentreId: "cc_secret",
      paymentMethod: "business",
      paymentMethodId: "pm_secret",
      fundingSource: "org_budget",
      recipientDriverIds: ["drv_1", "drv_2"],
      audienceDriverIds: ["drv_1", "drv_2"],
      driverIds: ["drv_1", "drv_2"],
      // Unallowlisted internal key
      unallowlistedInternalSecret: "never_forward",
    };

    for (const eventName of allMpEventNames) {
      const env = makeEnvelope({
        name: eventName,
        payload: toxicPayload,
      });

      const requesterMsg = translateEnvelope(env, "requester");
      const driverMsg = translateEnvelope(env, "driver");
      if (
        requesterMsg.type !== "marketplace_event" ||
        driverMsg.type !== "marketplace_event"
      ) {
        throw new Error("Expected marketplace_event");
      }

      for (const forbiddenKey of FORBIDDEN_REQUESTER_KEYS) {
        expect(
          requesterMsg.payload.data[forbiddenKey],
          `${eventName} leaked ${forbiddenKey} to requester`,
        ).toBeUndefined();
      }
      expect(
        requesterMsg.payload.data.unallowlistedInternalSecret,
      ).toBeUndefined();

      for (const forbiddenKey of FORBIDDEN_DRIVER_KEYS) {
        expect(
          driverMsg.payload.data[forbiddenKey],
          `${eventName} leaked ${forbiddenKey} to driver`,
        ).toBeUndefined();
      }
      expect(
        driverMsg.payload.data.unallowlistedInternalSecret,
      ).toBeUndefined();
    }
  });

  it("validates MpBidSubmittedPayloadSchema requiring requesterId", () => {
    const valid = MpBidSubmittedPayloadSchema.safeParse({
      bidId: "bid_1",
      requestId: "req_1",
      requesterId: "usr_requester",
      requestRevision: 1,
      driverId: "drv_bidder",
      amountMinor: 250000,
      commissionMinor: 25000,
      slot: "current",
      reservationId: "res_1",
      expiresAt: "2026-09-20T10:05:00Z",
    });
    expect(valid.success).toBe(true);

    const missingRequester = MpBidSubmittedPayloadSchema.safeParse({
      bidId: "bid_1",
      requestId: "req_1",
      requestRevision: 1,
      driverId: "drv_bidder",
      amountMinor: 250000,
      commissionMinor: 25000,
      slot: "current",
      reservationId: "res_1",
      expiresAt: "2026-09-20T10:05:00Z",
    });
    expect(missingRequester.success).toBe(false);
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

  it("tags requester and driver recipients with their respective roles", () => {
    const recipients = resolveAudienceByRole(makeEnvelope());
    expect(recipients).toEqual([
      { userId: "usr_requester", role: "requester" },
      { userId: "drv_bidder", role: "driver" },
    ]);
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

  it("routes mp.advance_booking.choice_offered only to the requester (CC-A05)", () => {
    const audience = resolveAudience(
      makeEnvelope({
        name: "mp.advance_booking.choice_offered",
        subject: { type: "mp_advance_booking", id: "bkg_1" },
        payload: {
          bookingId: "bkg_1",
          awardId: "awd_1",
          requestId: "req_1",
          requesterId: "usr_requester",
          reason: "risk_unresolved",
          options: ["rematch", "refund"],
          rematchAvailable: true,
          sameFareMinor: { amountMinor: 250000, currency: "NGN" },
          rematchBy: "2026-09-20T12:00:00Z",
          refund: { riderCharged: false, riderFundingReleased: true },
          audience: ["rider"],
        },
      }),
    );
    expect(audience).toEqual(["usr_requester"]);
  });
});

describe("handleMarketplaceEnvelope", () => {
  let ctx: ReturnType<typeof makeManager>;

  beforeEach(() => {
    ctx = makeManager();
  });

  it("delivers bid.submitted to requester (without commissionMinor) and driver (with commissionMinor)", async () => {
    await handleMarketplaceEnvelope(ctx.manager, makeEnvelope());

    const recipients = ctx.broadcasts.map((b) => b.userId);
    expect(recipients).toContain("usr_requester");
    expect(recipients).toContain("drv_bidder");
    expect(recipients).not.toContain("drv_rival");

    const requesterCopy = ctx.broadcasts.find(
      (b) => b.userId === "usr_requester",
    )?.message;
    const driverCopy = ctx.broadcasts.find(
      (b) => b.userId === "drv_bidder",
    )?.message;
    expect(requesterCopy?.type).toBe("marketplace_event");
    expect(driverCopy?.type).toBe("marketplace_event");
    if (
      requesterCopy?.type === "marketplace_event" &&
      driverCopy?.type === "marketplace_event"
    ) {
      expect(requesterCopy.payload.data.amountMinor).toBe(250000);
      expect(requesterCopy.payload.data.commissionMinor).toBeUndefined();
      expect(requesterCopy.payload.data.reservationId).toBeUndefined();
      expect(driverCopy.payload.data.commissionMinor).toBe(25000);
      expect(driverCopy.payload.data.reservationId).toBe("res_1");
    }
  });

  it("delivers mp.award.confirmed without commissionMinor to requester and with commissionMinor to driver", async () => {
    await handleMarketplaceEnvelope(
      ctx.manager,
      makeEnvelope({
        name: "mp.award.confirmed",
        subject: { type: "mp_award", id: "awd_1" },
        payload: {
          awardId: "awd_1",
          requestId: "req_1",
          bidId: "bid_1",
          requesterId: "usr_requester",
          driverId: "drv_winner",
          fareMinor: 300000,
          commissionMinor: 30000,
          slot: "current",
        },
      }),
    );

    const requesterCopy = ctx.broadcasts.find(
      (b) => b.userId === "usr_requester",
    )?.message;
    const driverCopy = ctx.broadcasts.find(
      (b) => b.userId === "drv_winner",
    )?.message;
    if (
      requesterCopy?.type !== "marketplace_event" ||
      driverCopy?.type !== "marketplace_event"
    ) {
      throw new Error("Expected marketplace_event");
    }
    expect(requesterCopy.payload.data.fareMinor).toBe(300000);
    expect(requesterCopy.payload.data.commissionMinor).toBeUndefined();
    expect(driverCopy.payload.data.fareMinor).toBe(300000);
    expect(driverCopy.payload.data.commissionMinor).toBe(30000);
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

  it("recognizes the dedicated settlement event (G15) and fans it out to the parties", async () => {
    await handleMarketplaceEnvelope(
      ctx.manager,
      makeEnvelope({
        name: "mp.settlement.posted",
        subject: { type: "mp_award", id: "awd_1" },
        payload: {
          requestId: "req_1",
          requesterId: "usr_requester",
          driverId: "drv_winner",
          settlementId: "stl_1",
          method: "wallet",
          commissionMinor: 25000,
        },
      }),
    );
    const recipients = ctx.broadcasts.map((b) => b.userId).sort();
    expect(recipients).toEqual(["drv_winner", "usr_requester"]);
    const requesterCopy = ctx.broadcasts.find(
      (b) => b.userId === "usr_requester",
    )?.message;
    const driverCopy = ctx.broadcasts.find(
      (b) => b.userId === "drv_winner",
    )?.message;
    if (
      requesterCopy?.type === "marketplace_event" &&
      driverCopy?.type === "marketplace_event"
    ) {
      expect(requesterCopy.payload.name).toBe("mp.settlement.posted");
      expect(requesterCopy.payload.data.commissionMinor).toBeUndefined();
      expect(driverCopy.payload.data.commissionMinor).toBe(25000);
    }
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
