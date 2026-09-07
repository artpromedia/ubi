/**
 * SOS durability (CLAUDE.md #9).
 *
 * The incident is committed before any channel is tried, the SMS fallback runs
 * when push fails, a total delivery failure leaves the incident queued for retry
 * rather than losing it, and the emergency number comes from city config.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeTestDb,
  FakeNotifier,
  headers,
  idemKey,
  makeDeps,
  seedCity,
  seedUser,
  testDb,
  uid,
  type SeededCity,
  type SeededUser,
} from "./helpers";
import { createApp } from "../src/index";
import {
  attemptDelivery,
  listSafetyCases,
  raiseSos,
  respond,
  sweepPendingDeliveries,
} from "../src/ops/safety";

import type { SupportDb } from "../src/ops/types";

describe("durable SOS", () => {
  let db: SupportDb;
  let city: SeededCity;
  let rider: SeededUser;

  const responder = { id: "responder_1", role: "safety_responder" };

  beforeAll(async () => {
    db = testDb();
    city = await seedCity(db, { emergencyNumber: "112" });
    rider = await seedUser(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  function riderActor() {
    return { id: rider.id, role: "rider" };
  }

  it("persists the incident, holds the ride and queues it with an SLA before notifying", async () => {
    const notifier = new FakeNotifier();
    const deps = makeDeps(db, { notifier });
    const rideId = uid("rd");

    const result = await raiseSos(deps, {
      actor: riderActor(),
      cityId: city.cityId,
      trigger: "sos_button",
      rideId,
      location: { lat: 6.4531, lng: 3.3958, accuracyMeters: 12, at: null },
      note: null,
      idempotencyKey: idemKey("sos"),
      correlationId: null,
    });

    expect(result.status).toBe("open");
    expect(result.severity).toBe("critical");
    expect(result.slaDueAt).not.toBeNull();
    // The number is the city's, not a constant in the service.
    expect(result.emergencyNumber).toBe(city.emergencyNumber);
    expect(result.rideHoldRequested).toBe(true);

    const stored = await db.safetyCase.findUnique({ where: { id: result.id } });
    expect(stored?.rideId).toBe(rideId);

    const events = await db.outboxEvent.findMany({
      where: { correlationId: null, aggregateId: { in: [result.id, rideId] } },
    });
    const names = events.map((event) => event.name).sort();
    expect(names).toEqual([
      "incident.created",
      "ride.safety_hold",
      "safety.sos_raised",
    ]);
    const hold = events.find((event) => event.name === "ride.safety_hold");
    expect(hold?.aggregateType).toBe("ride");
    expect(hold?.aggregateId).toBe(rideId);

    expect(notifier.attempts.map((attempt) => attempt.channel)).toEqual([
      "push",
    ]);
    expect(result.delivery.status).toBe("delivered");
    expect(result.delivery.deliveredChannel).toBe("push");
  });

  it("falls back to SMS when push fails", async () => {
    const notifier = new FakeNotifier(["push"]);
    const deps = makeDeps(db, { notifier });

    const result = await raiseSos(deps, {
      actor: riderActor(),
      cityId: city.cityId,
      trigger: "crash_detected",
      rideId: uid("rd"),
      location: null,
      note: null,
      idempotencyKey: idemKey("sos"),
      correlationId: null,
    });

    expect(notifier.attempts.map((attempt) => attempt.channel)).toEqual([
      "push",
      "sms",
    ]);
    expect(result.delivery.status).toBe("delivered");
    expect(result.delivery.deliveredChannel).toBe("sms");
  });

  it("keeps the incident and queues a retry when every channel fails", async () => {
    const notifier = new FakeNotifier(["push", "sms"]);
    const deps = makeDeps(db, { notifier });

    const result = await raiseSos(deps, {
      actor: riderActor(),
      cityId: city.cityId,
      trigger: "sos_button",
      rideId: uid("rd"),
      location: { lat: 6.6, lng: 3.35, accuracyMeters: null, at: null },
      note: null,
      idempotencyKey: idemKey("sos"),
      correlationId: null,
    });

    // The incident exists whatever the notification channels did.
    const stored = await db.safetyCase.findUnique({ where: { id: result.id } });
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe("open");
    expect(result.delivery.status).toBe("pending");
    expect(result.delivery.attempts).toBe(1);
    expect(result.delivery.nextAttemptAt).not.toBeNull();

    // It is still in the queue with its SLA.
    const queue = await listSafetyCases(deps, responder, { limit: 100 });
    expect(queue.some((entry) => entry.id === result.id)).toBe(true);

    // Nothing is due yet, so the sweep leaves it alone ...
    expect(await sweepPendingDeliveries(deps)).toBe(0);

    // ... and once the backoff has elapsed and a channel recovers, the retry
    // delivers it.
    notifier.recover();
    const later = makeDeps(db, {
      notifier,
      now: () => new Date(Date.now() + 10 * 60_000),
    });
    const swept = await sweepPendingDeliveries(later);
    expect(swept).toBeGreaterThanOrEqual(1);

    const after = await db.safetyCase.findUnique({ where: { id: result.id } });
    const delivery = (after?.timeline as { delivery: { status: string } })
      .delivery;
    expect(delivery.status).toBe("delivered");
  });

  it("escalates an SOS nobody could be told about once the attempts run out", async () => {
    const notifier = new FakeNotifier(["push", "sms"]);
    const oneAttemptCity = await seedCity(db, {
      policy: { sosMaxDeliveryAttempts: 1 },
    });
    const deps = makeDeps(db, { notifier });

    const result = await raiseSos(deps, {
      actor: riderActor(),
      cityId: oneAttemptCity.cityId,
      trigger: "sos_button",
      rideId: null,
      location: null,
      note: null,
      idempotencyKey: idemKey("sos"),
      correlationId: null,
    });

    expect(result.delivery.status).toBe("exhausted");
    const stored = await db.safetyCase.findUnique({ where: { id: result.id } });
    expect(stored?.status).toBe("escalated");
  });

  it("records the incident even when the city config cannot be read", async () => {
    const brokenCity = await seedCity(db, { omitSupportPolicy: true });
    const notifier = new FakeNotifier();
    const deps = makeDeps(db, { notifier });

    const result = await raiseSos(deps, {
      actor: riderActor(),
      cityId: brokenCity.cityId,
      trigger: "route_deviation",
      rideId: uid("rd"),
      location: null,
      note: null,
      idempotencyKey: idemKey("sos"),
      correlationId: null,
    });

    // Fail closed on safety means assume the worst, not drop the incident.
    expect(result.severity).toBe("critical");
    expect(result.slaDueAt).toBeNull();
    // No emergency number is invented from a code constant.
    expect(result.emergencyNumber).toBeNull();
    const stored = await db.safetyCase.findUnique({ where: { id: result.id } });
    expect(stored).not.toBeNull();
  });

  it("answers 202 and replays the same incident for a repeated key", async () => {
    const deps = makeDeps(db, { notifier: new FakeNotifier() });
    const app = createApp(deps);
    const key = idemKey("sos");
    const body = JSON.stringify({ trigger: "sos_button", rideId: uid("rd") });

    const first = await app.request("/v1/safety/sos", {
      method: "POST",
      headers: headers(riderActor(), city.cityId, { "idempotency-key": key }),
      body,
    });
    const second = await app.request("/v1/safety/sos", {
      method: "POST",
      headers: headers(riderActor(), city.cityId, { "idempotency-key": key }),
      body,
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    const a = (await first.json()) as { id: string };
    const b = (await second.json()) as { id: string };
    expect(b.id).toBe(a.id);
    expect(await db.safetyCase.count({ where: { id: a.id } })).toBe(1);
  });

  it("moves a case through the responder actions it offers, and no others", async () => {
    const deps = makeDeps(db, { notifier: new FakeNotifier() });
    const raised = await raiseSos(deps, {
      actor: riderActor(),
      cityId: city.cityId,
      trigger: "audio_alarm",
      rideId: null,
      location: null,
      note: null,
      idempotencyKey: idemKey("sos"),
      correlationId: null,
    });
    expect(raised.availableActions).toContain("acknowledge");
    expect(raised.availableActions).not.toContain("resolve");

    await expect(
      respond(deps, {
        actor: responder,
        caseId: raised.id,
        action: "resolve",
        note: "too early",
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "illegal_transition" });

    const acknowledged = await respond(deps, {
      actor: responder,
      caseId: raised.id,
      action: "acknowledge",
      note: "responder on it",
      correlationId: null,
    });
    expect(acknowledged.status).toBe("acknowledged");
    expect(acknowledged.responder).toBe(responder.id);

    const resolved = await respond(deps, {
      actor: responder,
      caseId: raised.id,
      action: "resolve",
      note: "rider is safe",
      correlationId: null,
    });
    expect(resolved.status).toBe("resolved");
    expect(resolved.availableActions).toEqual([]);
  });

  it("never drags a resolved case back out by a late delivery retry", async () => {
    const notifier = new FakeNotifier(["push", "sms"]);
    const oneAttemptCity = await seedCity(db, {
      policy: { sosMaxDeliveryAttempts: 1 },
    });
    const deps = makeDeps(db, { notifier });
    const raised = await raiseSos(deps, {
      actor: riderActor(),
      cityId: oneAttemptCity.cityId,
      trigger: "sos_button",
      rideId: null,
      location: null,
      note: null,
      idempotencyKey: idemKey("sos"),
      correlationId: null,
    });

    await respond(deps, {
      actor: responder,
      caseId: raised.id,
      action: "resolve",
      note: "responder reached the rider by phone",
      correlationId: null,
    });

    const attemptsBefore = notifier.attempts.length;
    await attemptDelivery(deps, raised.id);
    expect(notifier.attempts.length).toBe(attemptsBefore);
    const after = await db.safetyCase.findUnique({ where: { id: raised.id } });
    expect(after?.status).toBe("resolved");
  });

  it("does not attempt delivery again once a case is delivered", async () => {
    const notifier = new FakeNotifier();
    const deps = makeDeps(db, { notifier });
    const raised = await raiseSos(deps, {
      actor: riderActor(),
      cityId: city.cityId,
      trigger: "sos_button",
      rideId: null,
      location: null,
      note: null,
      idempotencyKey: idemKey("sos"),
      correlationId: null,
    });
    const attemptsAfterRaise = notifier.attempts.length;
    await attemptDelivery(deps, raised.id);
    expect(notifier.attempts.length).toBe(attemptsAfterRaise);
  });
});
