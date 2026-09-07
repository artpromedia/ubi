/**
 * Case status changes follow contracts/state-machines.json and nothing else.
 *
 * The legal moves are read out of the contract machine rather than restated
 * here, so a change to the contract shows up as a failing test instead of as a
 * service that quietly disagrees with it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { allowedTransitions, MACHINES } from "@ubi/contracts";


import {
  closeTestDb,
  headers,
  idemKey,
  makeDeps,
  seedCity,
  seedUser,
  seedWallet,
  testDb,
  type SeededCity,
  type SeededUser,
} from "./helpers";
import { createApp } from "../src/index";
import { openCase, postRemedy, transitionCase } from "../src/ops/cases";

import type { SupportDeps } from "../src/ops/context";
import type { SupportDb } from "../src/ops/types";
import type { Hono } from "hono";

describe("supportCase transitions", () => {
  let db: SupportDb;
  let deps: SupportDeps;
  let app: Hono;
  let city: SeededCity;
  let customer: SeededUser;

  const lead = { id: "lead_transitions", role: "support_lead" };

  beforeAll(async () => {
    db = testDb();
    deps = makeDeps(db);
    app = createApp(deps);
    city = await seedCity(db);
    customer = await seedUser(db);
    await seedWallet(db, customer.id, city.currency);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function newCase() {
    const opened = await openCase(deps, {
      actor: lead,
      cityId: city.cityId,
      category: "ride",
      description: "transition probe",
      subject: null,
      onBehalfOf: { userType: "rider", userId: customer.id },
      idempotencyKey: idemKey("open"),
      correlationId: null,
    });
    return opened;
  }

  it("starts a case in the machine's initial state", async () => {
    const opened = await newCase();
    expect(opened.status).toBe(MACHINES.supportCase.initial);
  });

  it("walks the whole contract path and refuses everything off it", async () => {
    const opened = await newCase();
    const path = ["investigating", "no_action", "resolved", "reopened", "investigating"];
    let current = opened.status;

    for (const next of path) {
      expect(allowedTransitions("supportCase", current)).toContain(next);
      const moved = await transitionCase(deps, {
        actor: lead,
        caseId: opened.id,
        to: next,
        reason: `moving to ${next}`,
        cityId: city.cityId,
        correlationId: null,
      });
      expect(moved.status).toBe(next);
      current = next;
    }

    // Every state the contract does NOT allow from here is refused.
    const legal = new Set(allowedTransitions("supportCase", current));
    const states = Object.keys(MACHINES.supportCase.transitions);
    for (const candidate of states) {
      if (legal.has(candidate)) {
        continue;
      }
      await expect(
        transitionCase(deps, {
          actor: lead,
          caseId: opened.id,
          to: candidate,
          reason: "should not be possible",
          cityId: city.cityId,
          correlationId: null,
        }),
      ).rejects.toMatchObject({ code: "illegal_transition" });
    }

    const stored = await db.supportCase.findUnique({ where: { id: opened.id } });
    expect(stored?.status).toBe(current);
  });

  it("stamps resolvedAt only when the case reaches resolved", async () => {
    const opened = await newCase();
    await transitionCase(deps, {
      actor: lead,
      caseId: opened.id,
      to: "investigating",
      reason: "picked up",
      cityId: city.cityId,
      correlationId: null,
    });
    const midway = await db.supportCase.findUnique({ where: { id: opened.id } });
    expect(midway?.resolvedAt).toBeNull();

    await transitionCase(deps, {
      actor: lead,
      caseId: opened.id,
      to: "no_action",
      reason: "nothing to fix",
      cityId: city.cityId,
      correlationId: null,
    });
    const resolved = await transitionCase(deps, {
      actor: lead,
      caseId: opened.id,
      to: "resolved",
      reason: "explained to the customer",
      cityId: city.cityId,
      correlationId: null,
    });
    expect(resolved.resolvedAt).not.toBeNull();

    const events = await db.outboxEvent.findMany({
      where: { aggregateId: opened.id, name: "case.resolved" },
    });
    expect(events).toHaveLength(1);
  });

  it("advances an open case to remedied along the contract path when a remedy is posted", async () => {
    const opened = await newCase();
    expect(opened.status).toBe("open");

    const result = await postRemedy(deps, {
      actor: lead,
      cityId: city.cityId,
      caseId: opened.id,
      type: "credit",
      amountMinor: 5_000,
      reason: "goodwill credit",
      idempotencyKey: idemKey("rm"),
      correlationId: null,
    });
    expect(result.case.status).toBe("remedied");

    // Both hops are on the timeline; the case did not teleport.
    const hops = await db.caseEvent.findMany({
      where: { caseId: opened.id, kind: "case.status_changed" },
      orderBy: { createdAt: "asc" },
    });
    const transitions = hops.map((hop) => {
      const payload = hop.payload as { from: string; to: string };
      return `${payload.from}->${payload.to}`;
    });
    expect(transitions).toEqual(["open->investigating", "investigating->remedied"]);
  });

  it("refuses a remedy on a resolved case and posts nothing", async () => {
    const opened = await newCase();
    for (const to of ["investigating", "no_action", "resolved"]) {
      await transitionCase(deps, {
        actor: lead,
        caseId: opened.id,
        to,
        reason: "closing out",
        cityId: city.cityId,
        correlationId: null,
      });
    }

    const response = await app.request(`/v1/support/cases/${opened.id}/remedies`, {
      method: "POST",
      headers: headers(lead, city.cityId, { "idempotency-key": idemKey("rm") }),
      body: JSON.stringify({
        type: "refund",
        amountMinor: 1_000,
        reason: "too late",
      }),
    });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("illegal_transition");
    expect(await db.remedy.count({ where: { caseId: opened.id } })).toBe(0);
    expect(await db.journalEntry.count({ where: { caseRef: opened.id } })).toBe(0);
  });

  it("refuses a message on a closed case", async () => {
    const opened = await newCase();
    for (const to of ["investigating", "no_action", "resolved", "closed"]) {
      await transitionCase(deps, {
        actor: lead,
        caseId: opened.id,
        to,
        reason: "closing out",
        cityId: city.cityId,
        correlationId: null,
      });
    }
    const response = await app.request(`/v1/support/cases/${opened.id}/messages`, {
      method: "POST",
      headers: headers(lead, city.cityId),
      body: JSON.stringify({ body: "one more thing" }),
    });
    expect(response.status).toBe(409);
  });
});
