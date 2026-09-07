/**
 * Audit completeness.
 *
 * The slice guard is "every ops action typed + audited (who, what, why,
 * before/after)". These tests hold both halves of that: a mutation that commits
 * always leaves exactly one audit row, and a mutation that fails leaves none —
 * because the audit row is written inside the same transaction as the change.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeTestDb,
  FakeLedger,
  headers,
  idemKey,
  makeDeps,
  seedCity,
  seedUser,
  seedWallet,
  testDb,
  uid,
  type SeededCity,
  type SeededUser,
} from "./helpers";
import { createApp } from "../src/index";
import { generateId } from "../src/lib/ids";
import { auditedTransaction } from "../src/ops/audit";
import { openCase } from "../src/ops/cases";


import type { SupportDeps } from "../src/ops/context";
import type { SupportDb } from "../src/ops/types";
import type { Hono } from "hono";

describe("audit completeness", () => {
  let db: SupportDb;
  let deps: SupportDeps;
  let app: Hono;
  let city: SeededCity;
  let customer: SeededUser;

  const lead = { id: "lead_audit", role: "support_lead" };
  const rider = { id: "", role: "rider" };

  beforeAll(async () => {
    db = testDb();
    deps = makeDeps(db);
    app = createApp(deps);
    city = await seedCity(db);
    customer = await seedUser(db);
    await seedWallet(db, customer.id, city.currency);
    rider.id = customer.id;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function auditCount(subjectId: string): Promise<number> {
    const count = await db.auditLog.count({ where: { subjectId } });
    return count;
  }

  it("writes exactly one audit row for every mutating endpoint", async () => {
    // 1. open a case
    const openResponse = await app.request("/v1/support/cases", {
      method: "POST",
      headers: headers(lead, city.cityId, { "idempotency-key": idemKey("open") }),
      body: JSON.stringify({
        category: "wallet",
        description: "money left my wallet twice",
        subject: { type: "ride", id: uid("rd") },
        onBehalfOf: { userType: "rider", userId: customer.id },
      }),
    });
    expect(openResponse.status).toBe(201);
    const opened = (await openResponse.json()) as { id: string };
    expect(await auditCount(opened.id)).toBe(1);

    // 2. add a message
    const messageResponse = await app.request(
      `/v1/support/cases/${opened.id}/messages`,
      {
        method: "POST",
        headers: headers(lead, city.cityId),
        body: JSON.stringify({ body: "asked the customer for the transaction ids" }),
      },
    );
    expect(messageResponse.status).toBe(201);
    expect(await auditCount(opened.id)).toBe(2);

    // 3. move the case along the contract machine
    const statusResponse = await app.request(
      `/v1/support/cases/${opened.id}/status`,
      {
        method: "POST",
        headers: headers(lead, city.cityId),
        body: JSON.stringify({ to: "investigating", reason: "picked it up" }),
      },
    );
    expect(statusResponse.status).toBe(200);
    expect(await auditCount(opened.id)).toBe(3);

    // 4. post a remedy
    const remedyResponse = await app.request(
      `/v1/support/cases/${opened.id}/remedies`,
      {
        method: "POST",
        headers: headers(lead, city.cityId, { "idempotency-key": idemKey("rm") }),
        body: JSON.stringify({
          type: "refund",
          amountMinor: 15_000,
          reason: "duplicate charge refunded",
        }),
      },
    );
    expect(remedyResponse.status).toBe(201);
    expect(await auditCount(opened.id)).toBe(4);

    // 5. resolve
    const resolveResponse = await app.request(
      `/v1/support/cases/${opened.id}/status`,
      {
        method: "POST",
        headers: headers(lead, city.cityId),
        body: JSON.stringify({ to: "resolved", reason: "customer made whole" }),
      },
    );
    expect(resolveResponse.status).toBe(200);
    expect(await auditCount(opened.id)).toBe(5);

    const rows = await db.auditLog.findMany({
      where: { subjectId: opened.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((row) => row.action)).toEqual([
      "support.case.opened",
      "support.case.message_added",
      "support.case.investigating",
      "support.remedy.posted",
      "support.case.resolved",
    ]);
    // who, what, why, before/after are all on the row.
    for (const row of rows) {
      expect(row.actorId).toBe(lead.id);
      expect(row.actorRole).toBe("support_lead");
      expect(row.reason).not.toBeNull();
      expect(row.subjectType).toBe("support_case");
    }
    const remedyRow = rows.find((row) => row.action === "support.remedy.posted");
    expect(remedyRow?.before).toMatchObject({ status: "investigating" });
    expect(remedyRow?.after).toMatchObject({ status: "remedied", type: "refund" });
  });

  it("audits an SOS exactly once, and a review decision exactly once", async () => {
    const sosResponse = await app.request("/v1/safety/sos", {
      method: "POST",
      headers: headers(rider, city.cityId, { "idempotency-key": idemKey("sos") }),
      body: JSON.stringify({ trigger: "sos_button", rideId: uid("rd") }),
    });
    expect(sosResponse.status).toBe(202);
    const sos = (await sosResponse.json()) as { id: string };
    expect(await auditCount(sos.id)).toBe(1);

    const document = await db.identityDocument.create({
      data: {
        id: uid("doc"),
        ownerType: "driver",
        ownerId: uid("drv"),
        type: "drivers_licence",
        fileRef: "s3://evidence/one",
        status: "pending",
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60_000),
      },
    });
    const decisionResponse = await app.request("/v1/reviews/kyc/decisions", {
      method: "POST",
      headers: headers(lead, city.cityId, { "idempotency-key": idemKey("rvd") }),
      body: JSON.stringify({
        subjectType: "document",
        subjectId: document.id,
        decision: "approve",
        note: "licence matches the NIN on file",
      }),
    });
    expect(decisionResponse.status).toBe(201);
    expect(await auditCount(document.id)).toBe(1);
    const decisions = await db.reviewDecision.findMany({
      where: { subjectId: document.id },
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.reviewers).toEqual([lead.id]);
  });

  it("leaves no audit row and no remedy when the ledger refuses", async () => {
    const failingDeps = makeDeps(db, { ledger: new FakeLedger(db, true) });
    const opened = await openCase(failingDeps, {
      actor: lead,
      cityId: city.cityId,
      category: "ride",
      description: "fare disputed",
      subject: null,
      onBehalfOf: { userType: "rider", userId: customer.id },
      idempotencyKey: idemKey("open"),
      correlationId: null,
    });
    const auditsBefore = await auditCount(opened.id);

    const failingApp = createApp(failingDeps);
    const response = await failingApp.request(
      `/v1/support/cases/${opened.id}/remedies`,
      {
        method: "POST",
        headers: headers(lead, city.cityId, { "idempotency-key": idemKey("rm") }),
        body: JSON.stringify({
          type: "fee_reversal",
          amountMinor: 12_000,
          reason: "wait fee",
        }),
      },
    );

    expect(response.status).toBe(503);
    expect(await db.remedy.count({ where: { caseId: opened.id } })).toBe(0);
    expect(await db.journalEntry.count({ where: { caseRef: opened.id } })).toBe(0);
    expect(await auditCount(opened.id)).toBe(auditsBefore);
    const stillOpen = await db.supportCase.findUnique({ where: { id: opened.id } });
    expect(stillOpen?.status).toBe("open");
  });

  it("rolls the audit row back with the work when the work throws", async () => {
    const opened = await openCase(deps, {
      actor: lead,
      cityId: city.cityId,
      category: "ride",
      description: "rollback probe",
      subject: null,
      onBehalfOf: { userType: "rider", userId: customer.id },
      idempotencyKey: idemKey("open"),
      correlationId: null,
    });
    const eventsBefore = await db.caseEvent.count({ where: { caseId: opened.id } });
    const auditsBefore = await auditCount(opened.id);
    const marker = generateId("cev");

    await expect(
      auditedTransaction(db, async (tx) => {
        await tx.caseEvent.create({
          data: {
            id: marker,
            caseId: opened.id,
            kind: "case.note",
            actor: lead.id,
            payload: { probe: true },
          },
        });
        throw new Error("the work failed after writing");
      }),
    ).rejects.toThrow("the work failed after writing");

    expect(await db.caseEvent.count({ where: { caseId: opened.id } })).toBe(eventsBefore);
    expect(await db.caseEvent.findUnique({ where: { id: marker } })).toBeNull();
    expect(await auditCount(opened.id)).toBe(auditsBefore);
  });

  it("carries the correlation id from the request onto the audit row", async () => {
    const correlationId = uid("req");
    const response = await app.request("/v1/support/cases", {
      method: "POST",
      headers: headers(lead, city.cityId, {
        "idempotency-key": idemKey("open"),
        "X-Request-ID": correlationId,
      }),
      body: JSON.stringify({
        category: "ride",
        description: "driver took a long route",
        onBehalfOf: { userType: "rider", userId: customer.id },
      }),
    });
    const opened = (await response.json()) as { id: string };
    const row = await db.auditLog.findFirst({ where: { subjectId: opened.id } });
    expect(row?.after).toMatchObject({ correlationId });
  });
});
