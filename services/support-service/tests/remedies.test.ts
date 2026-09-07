/**
 * Typed remedies, and the promise that a remedy never rewrites history.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ContractError } from "@ubi/contracts";

import {
  closeTestDb,
  FakeLedger,
  headers,
  idemKey,
  makeDeps,
  seedCity,
  seedRideEntry,
  seedUser,
  seedWallet,
  testDb,
  type SeededCity,
  type SeededUser,
} from "./helpers";
import { createApp } from "../src/index";
import { openCase, postRemedy } from "../src/ops/cases";


import type { SupportDeps } from "../src/ops/context";
import type { SupportDb } from "../src/ops/types";

describe("typed remedies", () => {
  let db: SupportDb;
  let deps: SupportDeps;
  let ledger: FakeLedger;
  let city: SeededCity;
  let customer: SeededUser;
  let walletId: string;

  const agent = { id: "agent_remedies", role: "support_agent" };
  const lead = { id: "lead_remedies", role: "support_lead" };

  beforeAll(async () => {
    db = testDb();
    ledger = new FakeLedger(db);
    deps = makeDeps(db, { ledger });
    city = await seedCity(db);
    customer = await seedUser(db);
    walletId = await seedWallet(db, customer.id, city.currency);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function newCase(subjectId = `rd_${Math.random().toString(36).slice(2)}`) {
    const opened = await openCase(deps, {
      actor: agent,
      cityId: city.cityId,
      category: "ride",
      description: "the wait fee looks wrong",
      subject: { type: "ride", id: subjectId },
      onBehalfOf: { userType: "rider", userId: customer.id },
      idempotencyKey: idemKey("open"),
      correlationId: "corr-remedy",
    });
    return opened;
  }

  it("accepts each of the five contract remedy types and nothing else", async () => {
    const app = createApp(deps);

    const opened = await newCase();
    const response = await app.request(
      `/v1/support/cases/${opened.id}/remedies`,
      {
        method: "POST",
        headers: headers(agent, city.cityId, { "idempotency-key": idemKey("rm") }),
        body: JSON.stringify({
          type: "goodwill_gesture",
          amountMinor: 1000,
          reason: "made up",
        }),
      },
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("validation_failed");

    const remedies = await db.remedy.findMany({ where: { caseId: opened.id } });
    expect(remedies).toHaveLength(0);
  });

  it("posts counter-lines that reference the case and leaves the prior entry untouched", async () => {
    const opened = await newCase();
    const priorEntryId = await seedRideEntry(db, walletId, city.currency, 180_000);
    const priorLinesBefore = await db.journalLine.findMany({
      where: { entryId: priorEntryId },
      orderBy: { id: "asc" },
    });
    const priorEntryBefore = await db.journalEntry.findUnique({
      where: { id: priorEntryId },
    });

    const result = await postRemedy(deps, {
      actor: agent,
      cityId: city.cityId,
      caseId: opened.id,
      type: "fee_reversal",
      amountMinor: 30_000,
      reason: "wait fee charged during a driver-side delay",
      idempotencyKey: idemKey("rm"),
      correlationId: "corr-remedy",
    });

    expect(result.remedy.entryId).not.toBeNull();
    expect(result.remedy.amount).toEqual({
      amountMinor: 30_000,
      currency: city.currency,
    });

    // The new entry references the case ...
    const entry = await db.journalEntry.findUnique({
      where: { id: result.remedy.entryId ?? "" },
      include: { lines: true },
    });
    expect(entry?.caseRef).toBe(opened.id);
    expect(entry?.id).not.toBe(priorEntryId);

    // ... its lines are counter-lines that sum to zero (the deferred database
    // trigger would have refused the COMMIT otherwise) ...
    const sum = (entry?.lines ?? []).reduce(
      (total, line) => total + Number(line.amountMinor),
      0,
    );
    expect(sum).toBe(0);
    expect(entry?.lines.map((line) => line.counterpartRef)).toEqual([
      `case:${opened.id}`,
      `case:${opened.id}`,
    ]);

    // ... and the entry the fare was posted on is byte-for-byte what it was.
    const priorLinesAfter = await db.journalLine.findMany({
      where: { entryId: priorEntryId },
      orderBy: { id: "asc" },
    });
    const priorEntryAfter = await db.journalEntry.findUnique({
      where: { id: priorEntryId },
    });
    expect(priorLinesAfter).toEqual(priorLinesBefore);
    expect(priorEntryAfter).toEqual(priorEntryBefore);
    expect(priorEntryAfter?.caseRef).toBeNull();
  });

  it("returns the original result on replay instead of posting a second entry", async () => {
    const opened = await newCase();
    const key = idemKey("rm");
    const first = await postRemedy(deps, {
      actor: agent,
      cityId: city.cityId,
      caseId: opened.id,
      type: "refund",
      amountMinor: 45_000,
      reason: "order never arrived",
      idempotencyKey: key,
      correlationId: null,
    });
    const second = await postRemedy(deps, {
      actor: agent,
      cityId: city.cityId,
      caseId: opened.id,
      type: "refund",
      amountMinor: 45_000,
      reason: "order never arrived",
      idempotencyKey: key,
      correlationId: null,
    });

    expect(second.replayed).toBe(true);
    expect(second.remedy.id).toBe(first.remedy.id);
    expect(second.remedy.entryId).toBe(first.remedy.entryId);

    const rows = await db.remedy.findMany({ where: { caseId: opened.id } });
    expect(rows).toHaveLength(1);
    const entries = await db.journalEntry.findMany({ where: { caseRef: opened.id } });
    expect(entries).toHaveLength(1);
  });

  it("refuses a key reused for a different remedy", async () => {
    const opened = await newCase();
    const key = idemKey("rm");
    await postRemedy(deps, {
      actor: agent,
      cityId: city.cityId,
      caseId: opened.id,
      type: "credit",
      amountMinor: 10_000,
      reason: "apology credit",
      idempotencyKey: key,
      correlationId: null,
    });

    await expect(
      postRemedy(deps, {
        actor: agent,
        cityId: city.cityId,
        caseId: opened.id,
        type: "credit",
        amountMinor: 99_000,
        reason: "apology credit",
        idempotencyKey: key,
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "idempotency_key_reuse" });
  });

  it("takes the currency and the ceiling from city config, never from the request", async () => {
    const opened = await newCase();
    await expect(
      postRemedy(deps, {
        actor: lead,
        cityId: city.cityId,
        caseId: opened.id,
        type: "fee_reversal",
        // The city caps fee reversals at 500_000 minor units.
        amountMinor: 600_000,
        reason: "too large",
        idempotencyKey: idemKey("rm"),
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "limit_exceeded" });

    const ok = await postRemedy(deps, {
      actor: lead,
      cityId: city.cityId,
      caseId: opened.id,
      type: "fee_reversal",
      amountMinor: 400_000,
      reason: "within the city ceiling",
      idempotencyKey: idemKey("rm"),
      correlationId: null,
    });
    expect(ok.remedy.amount?.currency).toBe(city.currency);
  });

  it("will not let one agent post a high-value remedy on their own", async () => {
    const opened = await newCase();
    const error = await postRemedy(deps, {
      actor: agent,
      cityId: city.cityId,
      caseId: opened.id,
      type: "refund",
      // Above the city's remedyHighValueAboveMinor of 200_000.
      amountMinor: 300_000,
      reason: "large refund",
      idempotencyKey: idemKey("rm"),
      correlationId: null,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ContractError);
    expect((error as ContractError).code).toBe("remedy_not_permitted");
    expect(await db.remedy.count({ where: { caseId: opened.id } })).toBe(0);

    // A lead may.
    const posted = await postRemedy(deps, {
      actor: lead,
      cityId: city.cityId,
      caseId: opened.id,
      type: "refund",
      amountMinor: 300_000,
      reason: "large refund approved by a lead",
      idempotencyKey: idemKey("rm"),
      correlationId: null,
    });
    expect(posted.remedy.postedBy).toBe(lead.id);
  });

  it("records a re-delivery with no money as a remedy with no ledger entry", async () => {
    const opened = await newCase();
    const result = await postRemedy(deps, {
      actor: agent,
      cityId: city.cityId,
      caseId: opened.id,
      type: "redelivery",
      amountMinor: null,
      reason: "courier will run it again at no cost",
      idempotencyKey: idemKey("rm"),
      correlationId: null,
    });
    expect(result.remedy.entryId).toBeNull();
    expect(result.remedy.amount).toBeNull();
    expect(result.case.outcome.remedies.some((r) => r.type === "redelivery")).toBe(true);
  });

  it("shows the outcome on the case, so the customer sees it on the item it touched", async () => {
    const rideId = `rd_${Math.random().toString(36).slice(2)}`;
    const opened = await newCase(rideId);
    await postRemedy(deps, {
      actor: agent,
      cityId: city.cityId,
      caseId: opened.id,
      type: "fee_reversal",
      amountMinor: 20_000,
      reason: "wait fee reversed",
      idempotencyKey: idemKey("rm"),
      correlationId: null,
    });

    const app = createApp(deps);
    const response = await app.request(
      `/v1/support/cases?subjectType=ride&subjectId=${rideId}`,
      { headers: headers(agent, city.cityId) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      cases: { id: string; outcome: { status: string; remedies: { type: string }[] } }[];
    };
    const found = body.cases.find((entry) => entry.id === opened.id);
    expect(found?.outcome.status).toBe("remedied");
    expect(found?.outcome.remedies.map((r) => r.type)).toContain("fee_reversal");
  });
});
