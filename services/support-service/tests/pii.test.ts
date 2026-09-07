/**
 * Privacy by role (CLAUDE.md #6).
 *
 * A support agent can work a case without being handed the customer's phone
 * number, the driver's name or a precise location, and cannot open the safety
 * queue at all — safety evidence stays with Trust & Safety.
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
import { openCase } from "../src/ops/cases";

import type { SupportDeps } from "../src/ops/context";
import type { SupportDb } from "../src/ops/types";
import type { Hono } from "hono";

interface CaseBody {
  readonly customer: {
    readonly phone: string | null;
    readonly email: string | null;
    readonly contactMasked: boolean;
  } | null;
  readonly timeline: {
    readonly source: string;
    readonly kind: string;
    readonly detail: Record<string, unknown>;
  }[];
}

describe("PII visibility by role", () => {
  let db: SupportDb;
  let deps: SupportDeps;
  let app: Hono;
  let city: SeededCity;
  let customer: SeededUser;
  let caseId: string;

  const agent = { id: "agent_pii", role: "support_agent" };
  const lead = { id: "lead_pii", role: "support_lead" };
  const responder = { id: "responder_pii", role: "safety_responder" };

  beforeAll(async () => {
    db = testDb();
    deps = makeDeps(db, { notifier: new FakeNotifier() });
    app = createApp(deps);
    city = await seedCity(db);
    customer = await seedUser(db, "Chiamaka");

    const rideId = uid("rd");
    // A ride event on the outbox, exactly as ride-service publishes it: the
    // catalog says ride.assigned carries the driver's display name and plate.
    await db.outboxEvent.create({
      data: {
        id: uid("evt"),
        name: "ride.assigned",
        aggregateType: "ride",
        aggregateId: rideId,
        fromVersion: 1,
        toVersion: 2,
        cityId: city.cityId,
        actorType: "system",
        actorId: "matching",
        idempotencyKey: uid("idem"),
        payload: {
          rideId,
          driver: { displayName: "Tunde Bello", plate: "LAG-221-XY" },
          pickup: { lat: 6.453172, lng: 3.395812 },
        },
        occurredAt: new Date(),
      },
    });

    const opened = await openCase(deps, {
      actor: lead,
      cityId: city.cityId,
      category: "ride",
      description: "the driver took a strange route",
      subject: { type: "ride", id: rideId },
      onBehalfOf: { userType: "rider", userId: customer.id },
      idempotencyKey: idemKey("open"),
      correlationId: null,
    });
    caseId = opened.id;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("masks the customer's contact details for a support agent", async () => {
    const response = await app.request(`/v1/support/cases/${caseId}`, {
      headers: headers(agent, city.cityId),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as CaseBody;

    expect(body.customer?.contactMasked).toBe(true);
    expect(body.customer?.phone).not.toBe(customer.phone);
    expect(body.customer?.phone).toContain("•");
    expect(body.customer?.email).not.toBe(customer.email);
    // Enough of the number survives to confirm the right person.
    expect(body.customer?.phone?.endsWith(customer.phone.slice(-2))).toBe(true);
  });

  it("gives a support lead the raw contact details their role allows", async () => {
    const response = await app.request(`/v1/support/cases/${caseId}`, {
      headers: headers(lead, city.cityId),
    });
    const body = (await response.json()) as CaseBody;
    expect(body.customer?.contactMasked).toBe(false);
    expect(body.customer?.phone).toBe(customer.phone);
    expect(body.customer?.email).toBe(customer.email);
  });

  it("withholds names and blurs locations inside the ride timeline for an agent", async () => {
    const agentView = await app.request(`/v1/support/cases/${caseId}`, {
      headers: headers(agent, city.cityId),
    });
    const agentBody = (await agentView.json()) as CaseBody;
    const agentRide = agentBody.timeline.find(
      (item) => item.kind === "ride.assigned",
    );
    expect(agentRide).toBeDefined();
    const agentDriver = agentRide?.detail.driver as Record<string, unknown>;
    expect(agentDriver.displayName).toBe("[withheld]");
    expect(agentDriver.plate).toBe("[withheld]");
    const agentPickup = agentRide?.detail.pickup as Record<string, number>;
    // 1 km of resolution, not an address.
    expect(agentPickup.lat).toBe(6.45);
    expect(agentPickup.lng).toBe(3.4);

    const responderView = await app.request(`/v1/support/cases/${caseId}`, {
      headers: headers(responder, city.cityId),
    });
    const responderBody = (await responderView.json()) as CaseBody;
    const responderRide = responderBody.timeline.find(
      (item) => item.kind === "ride.assigned",
    );
    const responderDriver = responderRide?.detail.driver as Record<
      string,
      unknown
    >;
    expect(responderDriver.displayName).toBe("Tunde Bello");
    const responderPickup = responderRide?.detail.pickup as Record<
      string,
      number
    >;
    expect(responderPickup.lat).toBe(6.453172);
  });

  it("keeps the safety queue out of a support agent's reach entirely", async () => {
    const denied = await app.request("/v1/safety/cases", {
      headers: headers(agent, city.cityId),
    });
    expect(denied.status).toBe(403);
    const body = (await denied.json()) as { code: string };
    expect(body.code).toBe("forbidden");

    const allowed = await app.request("/v1/safety/cases", {
      headers: headers(responder, city.cityId),
    });
    expect(allowed.status).toBe(200);
  });

  it("does not let one customer read another customer's case", async () => {
    const stranger = await seedUser(db, "Femi");
    const response = await app.request(`/v1/support/cases/${caseId}`, {
      headers: headers({ id: stranger.id, role: "rider" }, city.cityId),
    });
    // Not 403: a case you may not read must not be discoverable either.
    expect(response.status).toBe(404);

    const own = await app.request(`/v1/support/cases/${caseId}`, {
      headers: headers({ id: customer.id, role: "rider" }, city.cityId),
    });
    expect(own.status).toBe(200);
  });

  it("refuses an unknown role outright", async () => {
    const response = await app.request(`/v1/support/cases/${caseId}`, {
      headers: headers({ id: "someone", role: "marketing" }, city.cityId),
    });
    expect(response.status).toBe(403);
  });

  it("will not let a rider open a case in someone else's name", async () => {
    const response = await app.request("/v1/support/cases", {
      method: "POST",
      headers: headers({ id: customer.id, role: "rider" }, city.cityId, {
        "idempotency-key": idemKey("open"),
      }),
      body: JSON.stringify({
        category: "ride",
        description: "not mine",
        onBehalfOf: { userType: "rider", userId: "someone-else" },
      }),
    });
    expect(response.status).toBe(403);
  });
});
