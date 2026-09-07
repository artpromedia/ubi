import { describe, expect, it } from "vitest";

import {
  EventEnvelopeSchema,
  MAX_REPLAY_EVENTS,
  assertKnownEventName,
  decideResume,
  isKnownEventName,
  topicFor,
} from "../src/events";

const envelope = {
  id: "evt_01H",
  name: "ride.assigned",
  version: 1,
  occurredAt: "2026-09-05T14:01:00.000Z",
  actor: { type: "system" as const, id: "matching" },
  subject: { type: "ride" as const, id: "rd_314" },
  idempotencyKey: "ride-assign-rd_314-1",
  fromVersion: 2,
  toVersion: 3,
  cityId: "LOS",
  payload: { driverId: "drv_9" },
};

describe("event envelope", () => {
  it("accepts the canonical envelope", () => {
    expect(EventEnvelopeSchema.parse(envelope).name).toBe("ride.assigned");
  });

  it("requires an idempotency key within the contract length", () => {
    expect(
      EventEnvelopeSchema.safeParse({ ...envelope, idempotencyKey: "" })
        .success,
    ).toBe(false);
    expect(
      EventEnvelopeSchema.safeParse({
        ...envelope,
        idempotencyKey: "x".repeat(65),
      }).success,
    ).toBe(false);
  });

  it("requires an offset-qualified timestamp so ordering is unambiguous", () => {
    expect(
      EventEnvelopeSchema.safeParse({
        ...envelope,
        occurredAt: "2026-09-05 14:01",
      }).success,
    ).toBe(false);
  });

  it("allows a null fromVersion for aggregate-creating events but never a null toVersion", () => {
    expect(
      EventEnvelopeSchema.safeParse({ ...envelope, fromVersion: null }).success,
    ).toBe(true);
    expect(
      EventEnvelopeSchema.safeParse({ ...envelope, toVersion: null }).success,
    ).toBe(false);
  });

  it("closes the event-name set", () => {
    expect(isKnownEventName("ride.assigned")).toBe(true);
    expect(isKnownEventName("ride.teleported")).toBe(false);
    expect(() => assertKnownEventName("ride.teleported")).toThrow(
      /unknown event name/,
    );
  });

  it("mirrors the subject in the realtime topic", () => {
    expect(topicFor({ type: "ride", id: "rd_314" })).toBe("ride.rd_314");
  });
});

describe("resume after disconnect", () => {
  it("is a no-op when the client is already current", () => {
    expect(decideResume(10, 10)).toEqual({
      action: "up_to_date",
      fromSequence: 10,
      count: 0,
    });
    expect(decideResume(11, 10).action).toBe("up_to_date");
  });

  it("replays a bounded gap", () => {
    expect(decideResume(10, 15)).toEqual({
      action: "replay",
      fromSequence: 11,
      count: 5,
    });
    expect(decideResume(0, MAX_REPLAY_EVENTS)).toEqual({
      action: "replay",
      fromSequence: 1,
      count: MAX_REPLAY_EVENTS,
    });
  });

  it("falls back to a REST snapshot once the gap exceeds the replay bound", () => {
    const decision = decideResume(0, MAX_REPLAY_EVENTS + 1);
    expect(decision.action).toBe("snapshot");
    expect(decision.count).toBe(0);
  });
});
