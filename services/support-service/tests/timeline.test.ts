/**
 * The unified timeline, and what happens when city config cannot be read.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";


import {
  closeTestDb,
  headers,
  idemKey,
  makeDeps,
  seedCity,
  seedRideEntry,
  seedUser,
  seedWallet,
  testDb,
  uid,
  type SeededCity,
  type SeededUser,
} from "./helpers";
import { createApp } from "../src/index";
import { getCase, openCase, postRemedy } from "../src/ops/cases";

import type { SupportDeps } from "../src/ops/context";
import type { SupportDb } from "../src/ops/types";
import type { Hono } from "hono";

describe("unified case timeline", () => {
  let db: SupportDb;
  let deps: SupportDeps;
  let app: Hono;
  let city: SeededCity;
  let customer: SeededUser;
  let walletId: string;

  const lead = { id: "lead_timeline", role: "support_lead" };

  beforeAll(async () => {
    db = testDb();
    deps = makeDeps(db);
    app = createApp(deps);
    city = await seedCity(db);
    customer = await seedUser(db);
    walletId = await seedWallet(db, customer.id, city.currency);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("spans the ride, the wallet and the messages, most recent first", async () => {
    const rideId = uid("rd");
    await db.outboxEvent.create({
      data: {
        id: uid("evt"),
        name: "ride.completed",
        aggregateType: "ride",
        aggregateId: rideId,
        fromVersion: 4,
        toVersion: 5,
        cityId: city.cityId,
        actorType: "system",
        actorId: "ride-service",
        idempotencyKey: uid("idem"),
        payload: { rideId, fareMinor: 180_000, currency: city.currency },
        occurredAt: new Date(Date.now() - 60_000),
      },
    });
    await seedRideEntry(db, walletId, city.currency, 180_000);

    const opened = await openCase(deps, {
      actor: lead,
      cityId: city.cityId,
      category: "ride",
      description: "charged twice for one ride",
      subject: { type: "ride", id: rideId },
      onBehalfOf: { userType: "rider", userId: customer.id },
      idempotencyKey: idemKey("open"),
      correlationId: null,
    });

    await app.request(`/v1/support/cases/${opened.id}/messages`, {
      method: "POST",
      headers: headers(lead, city.cityId),
      body: JSON.stringify({ body: "checking the journal now" }),
    });
    await postRemedy(deps, {
      actor: lead,
      cityId: city.cityId,
      caseId: opened.id,
      type: "refund",
      amountMinor: 180_000,
      reason: "duplicate charge",
      idempotencyKey: idemKey("rm"),
      correlationId: null,
    });

    const detail = await getCase(deps, lead, opened.id);
    const sources = new Set(detail.timeline.map((item) => item.source));
    expect(sources.has("case")).toBe(true);
    expect(sources.has("ride")).toBe(true);
    expect(sources.has("wallet")).toBe(true);

    const kinds = detail.timeline.map((item) => item.kind);
    expect(kinds).toContain("case.opened");
    expect(kinds).toContain("case.message");
    expect(kinds).toContain("case.remedy_posted");
    expect(kinds).toContain("ride.completed");
    expect(kinds.some((kind) => kind.startsWith("wallet."))).toBe(true);

    // Newest first.
    const times = detail.timeline.map((item) => Date.parse(item.at));
    const sorted = [...times].sort((a, b) => b - a);
    expect(times).toEqual(sorted);

    // The remedy's counter-lines are on the wallet half of the timeline, tagged
    // with the case they answer to.
    const remedyLine = detail.timeline.find(
      (item) => item.source === "wallet" && item.detail.caseRef === opened.id,
    );
    expect(remedyLine).toBeDefined();
    expect(remedyLine?.detail.amountMinor).toBe(180_000);
  });

  it("has no timeline to leak for a case with no subject and no wallet", async () => {
    const stranger = await seedUser(db);
    const opened = await openCase(deps, {
      actor: lead,
      cityId: city.cityId,
      category: "account",
      description: "cannot log in",
      subject: null,
      onBehalfOf: { userType: "rider", userId: stranger.id },
      idempotencyKey: idemKey("open"),
      correlationId: null,
    });
    const detail = await getCase(deps, lead, opened.id);
    expect(detail.timeline.every((item) => item.source === "case")).toBe(true);
  });
});

describe("city config is the only source of policy", () => {
  let db: SupportDb;
  let deps: SupportDeps;
  let customer: SeededUser;

  const lead = { id: "lead_config", role: "support_lead" };

  beforeAll(async () => {
    db = testDb();
    deps = makeDeps(db);
    customer = await seedUser(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("refuses to open a case when the city has no support policy", async () => {
    const broken = await seedCity(db, { omitSupportPolicy: true });
    await expect(
      openCase(deps, {
        actor: lead,
        cityId: broken.cityId,
        category: "ride",
        description: "anything",
        subject: null,
        onBehalfOf: { userType: "rider", userId: customer.id },
        idempotencyKey: idemKey("open"),
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "config_unavailable" });
  });

  it("refuses to open a case in a category the city has set no SLA for", async () => {
    const partial = await seedCity(db, {
      policy: { slaMinutesByCategory: { ride: 240 } },
    });
    const ok = await openCase(deps, {
      actor: lead,
      cityId: partial.cityId,
      category: "ride",
      description: "in an agreed category",
      subject: null,
      onBehalfOf: { userType: "rider", userId: customer.id },
      idempotencyKey: idemKey("open"),
      correlationId: null,
    });
    expect(ok.slaDueAt).not.toBeNull();

    await expect(
      openCase(deps, {
        actor: lead,
        cityId: partial.cityId,
        category: "stays",
        description: "in a category with no agreed SLA",
        subject: null,
        onBehalfOf: { userType: "rider", userId: customer.id },
        idempotencyKey: idemKey("open"),
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "config_unavailable" });
  });

  it("refuses a city that is not live", async () => {
    const dormant = await seedCity(db, { active: false });
    await expect(
      openCase(deps, {
        actor: lead,
        cityId: dormant.cityId,
        category: "ride",
        description: "anything",
        subject: null,
        onBehalfOf: { userType: "rider", userId: customer.id },
        idempotencyKey: idemKey("open"),
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "city_unsupported" });
  });

  it("sets the SLA clock from the city's own number", async () => {
    const fast = await seedCity(db, {
      policy: { slaMinutesByCategory: { wallet: 30 } },
    });
    const at = new Date("2026-03-01T09:00:00.000Z");
    const fixed = makeDeps(db, { now: () => at });
    const opened = await openCase(fixed, {
      actor: lead,
      cityId: fast.cityId,
      category: "wallet",
      description: "money missing",
      subject: null,
      onBehalfOf: { userType: "rider", userId: customer.id },
      idempotencyKey: idemKey("open"),
      correlationId: null,
    });
    expect(opened.slaDueAt).toBe(new Date(at.getTime() + 30 * 60_000).toISOString());
  });
});
