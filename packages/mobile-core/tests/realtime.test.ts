import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeRealtimeMessage } from "../src/realtime-protocol.ts";

describe("@ubi/mobile-core normalizeRealtimeMessage (P2-16 / CC-A11)", () => {
  it("normalizes a realtime-gateway marketplace_event message into an Envelope", () => {
    const raw = {
      type: "marketplace_event",
      seq: 17,
      occurredAt: "2026-09-20T10:00:00.000+00:00",
      payload: {
        name: "mp.bid.submitted",
        subject: { type: "mp_bid", id: "bid_1" },
        requestId: "req_1",
        seq: 17,
        occurredAt: "2026-09-20T10:00:00.000+00:00",
        data: { bidId: "bid_1", amountMinor: 250000, currency: "NGN" },
      },
    };

    const res = normalizeRealtimeMessage(raw);
    assert.equal(res.kind, "event");
    if (res.kind !== "event") return;
    assert.equal(res.envelope.seq, 17);
    assert.equal(res.envelope.type, "marketplace_event");
    assert.equal(res.envelope.occurredAt, "2026-09-20T10:00:00.000+00:00");
    assert.deepEqual(res.envelope.payload, raw.payload);
  });

  it("extracts seq and occurredAt from inner payload when omitted at top level", () => {
    const raw = {
      type: "marketplace_event",
      payload: {
        name: "mp.award.confirmed",
        subject: { type: "mp_award", id: "awd_1" },
        seq: 23,
        occurredAt: "2026-09-20T10:01:00.000+00:00",
        data: { awardId: "awd_1", fareMinor: 300000 },
      },
    };

    const res = normalizeRealtimeMessage(raw);
    assert.equal(res.kind, "event");
    if (res.kind !== "event") return;
    assert.equal(res.envelope.seq, 23);
    assert.equal(res.envelope.occurredAt, "2026-09-20T10:01:00.000+00:00");
  });

  it("recognizes replay_overflow and heartbeat control frames", () => {
    assert.deepEqual(
      normalizeRealtimeMessage({
        type: "replay_overflow",
        payload: { reason: "gap_exceeds_buffer", currentSeq: 60 },
      }),
      { kind: "replay_overflow" },
    );

    assert.deepEqual(
      normalizeRealtimeMessage({
        type: "heartbeat",
        payload: { timestamp: 1700000000000 },
      }),
      { kind: "heartbeat" },
    );
  });
});
