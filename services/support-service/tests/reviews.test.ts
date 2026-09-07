/**
 * Review queues: advisory checks, human decisions, and dual control.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeTestDb,
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
import { openCase, postRemedy } from "../src/ops/cases";
import { decide, listQueue, requiresDualControl, subjectValueMinor } from "../src/ops/reviews";


import type { SupportDeps } from "../src/ops/context";
import type { SupportDb } from "../src/ops/types";
import type { Hono } from "hono";

describe("review queues", () => {
  let db: SupportDb;
  let deps: SupportDeps;
  let app: Hono;
  let city: SeededCity;
  let customer: SeededUser;

  const reviewerA = { id: "reviewer_a", role: "reviewer" };
  const reviewerB = { id: "reviewer_b", role: "reviewer" };
  const lead = { id: "lead_reviews", role: "support_lead" };
  const agent = { id: "agent_reviews", role: "support_agent" };

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

  it("returns advisory checks that describe the item but do not decide it", async () => {
    const expired = await db.identityDocument.create({
      data: {
        id: uid("doc"),
        ownerType: "driver",
        ownerId: uid("drv"),
        type: "roadworthiness",
        fileRef: "s3://evidence/expired",
        status: "pending",
        expiresAt: new Date(Date.now() - 24 * 60 * 60_000),
      },
    });

    const queue = await listQueue(deps, {
      actor: reviewerA,
      cityId: city.cityId,
      queue: "kyc",
      limit: 200,
    });
    const item = queue.items.find((entry) => entry.subjectId === expired.id);
    expect(item).toBeDefined();
    expect(item?.checks.map((check) => check.code)).toContain("document.not_expired");
    expect(item?.checks.find((check) => check.code === "document.not_expired")?.level).toBe(
      "fail",
    );

    // A failing check does not block the human: they can still approve, and the
    // checks they saw are recorded with the decision.
    const decision = await decide(deps, {
      actor: reviewerA,
      cityId: city.cityId,
      queue: "kyc",
      subjectType: "document",
      subjectId: expired.id,
      decision: "approve",
      note: "driver produced the renewed certificate at the hub",
      idempotencyKey: idemKey("rvd"),
      correlationId: null,
    });
    expect(decision.status).toBe("complete");

    const stored = await db.reviewDecision.findUnique({ where: { id: decision.id } });
    const checks = stored?.checks as { advisory: { code: string }[] };
    expect(checks.advisory.map((check) => check.code)).toContain("document.not_expired");

    // The decision actually changed the record it was about.
    const document = await db.identityDocument.findUnique({ where: { id: expired.id } });
    expect(document?.status).toBe("approved");
    expect(document?.reviewedBy).toBe(reviewerA.id);
    expect(document?.reviewedAt).not.toBeNull();
  });

  it("says honestly when a queue has no source behind it", async () => {
    const response = await app.request("/v1/reviews/hotels", {
      headers: headers(reviewerA, city.cityId),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      available: boolean;
      unavailableReason: string | null;
      items: unknown[];
    };
    expect(body.available).toBe(false);
    expect(body.unavailableReason).toContain("slice 09");
    expect(body.items).toEqual([]);
  });

  it("404s a queue whose vertical is switched off in this city, and an unknown queue", async () => {
    const offCity = await seedCity(db, { flags: { bites: false } });
    const off = await app.request("/v1/reviews/merchants", {
      headers: headers(reviewerA, offCity.cityId),
    });
    expect(off.status).toBe(404);
    const body = (await off.json()) as { code: string };
    expect(body.code).toBe("feature_disabled");

    const unknown = await app.request("/v1/reviews/vehicles", {
      headers: headers(reviewerA, city.cityId),
    });
    expect(unknown.status).toBe(404);
  });

  it("will not let one reviewer complete a deactivation on their own", async () => {
    const identityCase = await db.identityCase.create({
      data: {
        id: uid("idc"),
        driverId: uid("drv"),
        signals: { faceCheckFailures: 3 },
        status: "open",
      },
    });

    const first = await app.request("/v1/reviews/identity/decisions", {
      method: "POST",
      headers: headers(reviewerA, city.cityId, { "idempotency-key": idemKey("rvd") }),
      body: JSON.stringify({
        subjectType: "identity_case",
        subjectId: identityCase.id,
        decision: "deactivate",
        note: "three consecutive face-check failures",
      }),
    });
    expect(first.status).toBe(202);
    const proposal = (await first.json()) as { id: string; reviewers: string[] };
    expect(proposal.reviewers).toEqual([reviewerA.id]);

    // Nothing has happened to the driver yet.
    const untouched = await db.identityCase.findUnique({ where: { id: identityCase.id } });
    expect(untouched?.decision).toBeNull();
    expect(untouched?.status).toBe("open");

    // The same reviewer cannot sign twice.
    const again = await app.request("/v1/reviews/identity/decisions", {
      method: "POST",
      headers: headers(reviewerA, city.cityId, { "idempotency-key": idemKey("rvd") }),
      body: JSON.stringify({
        subjectType: "identity_case",
        subjectId: identityCase.id,
        decision: "deactivate",
        note: "still me",
      }),
    });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { code: string }).code).toBe("already_approved");

    // A different reviewer completes it.
    const second = await app.request("/v1/reviews/identity/decisions", {
      method: "POST",
      headers: headers(reviewerB, city.cityId, { "idempotency-key": idemKey("rvd") }),
      body: JSON.stringify({
        subjectType: "identity_case",
        subjectId: identityCase.id,
        decision: "deactivate",
        note: "agreed, deactivate",
      }),
    });
    expect(second.status).toBe(201);
    const completed = (await second.json()) as { id: string; reviewers: string[] };
    expect(completed.id).toBe(proposal.id);
    expect(completed.reviewers).toEqual([reviewerA.id, reviewerB.id]);

    const decided = await db.identityCase.findUnique({ where: { id: identityCase.id } });
    expect(decided?.decision).toBe("deactivate");
    expect(decided?.decidedBy).toEqual([reviewerA.id, reviewerB.id]);

    // One decision row, two reviewers, two audit rows — the proposal and the
    // completion are both ops actions and both are on the record.
    const rows = await db.reviewDecision.findMany({
      where: { subjectId: identityCase.id },
    });
    expect(rows).toHaveLength(1);
    const audits = await db.auditLog.findMany({
      where: { subjectId: identityCase.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((row) => row.action)).toEqual([
      "review.identity.proposed",
      "review.identity.decided",
    ]);
    expect(audits.map((row) => row.actorId)).toEqual([reviewerA.id, reviewerB.id]);

    const events = await db.outboxEvent.findMany({
      where: { aggregateId: identityCase.id },
    });
    expect(events.map((event) => event.name)).toEqual(["identity.case_decided"]);
  });

  it("requires two reviewers once the subject's value passes the city threshold", async () => {
    const opened = await openCase(deps, {
      actor: lead,
      cityId: city.cityId,
      category: "send",
      description: "parcel lost in transit",
      subject: { type: "shipment", id: uid("shp") },
      onBehalfOf: { userType: "rider", userId: customer.id },
      idempotencyKey: idemKey("open"),
      correlationId: null,
    });
    await postRemedy(deps, {
      actor: lead,
      cityId: city.cityId,
      caseId: opened.id,
      // The city's reviewDualControlAboveMinor is 1_000_000.
      type: "refund",
      amountMinor: 1_500_000,
      reason: "declared value of the parcel",
      idempotencyKey: idemKey("rm"),
      correlationId: null,
    });

    const value = await subjectValueMinor(db, "support_case", opened.id);
    expect(value).toBe(1_500_000);

    const config = await deps.config.loadForSupport(city.cityId);
    expect(requiresDualControl(config, "approve", value)).toBe(true);
    expect(requiresDualControl(config, "approve", 10_000)).toBe(false);

    const first = await decide(deps, {
      actor: reviewerA,
      cityId: city.cityId,
      queue: "claims",
      subjectType: "support_case",
      subjectId: opened.id,
      decision: "approve",
      note: "claim is genuine",
      idempotencyKey: idemKey("rvd"),
      correlationId: null,
    });
    expect(first.status).toBe("pending_second_reviewer");
    expect(first.valueMinor).toBe(1_500_000);

    const second = await decide(deps, {
      actor: reviewerB,
      cityId: city.cityId,
      queue: "claims",
      subjectType: "support_case",
      subjectId: opened.id,
      decision: "approve",
      note: "second signature",
      idempotencyKey: idemKey("rvd"),
      correlationId: null,
    });
    expect(second.status).toBe("complete");
    expect(second.reviewers).toEqual([reviewerA.id, reviewerB.id]);

    const events = await db.outboxEvent.findMany({
      where: { aggregateId: opened.id, name: "claim.decided" },
    });
    expect(events).toHaveLength(1);
  });

  it("replays a single-reviewer decision instead of writing a second one", async () => {
    const merchantUser = await seedUser(db, "Store");
    const merchant = await db.merchant.create({
      data: {
        userId: merchantUser.id,
        businessName: "Mama Nkechi Kitchen",
        address: "12 Awolowo Road, Ikoyi",
        latitude: 6.45,
        longitude: 3.43,
      },
    });

    const key = idemKey("rvd");
    const first = await decide(deps, {
      actor: reviewerA,
      cityId: city.cityId,
      queue: "merchants",
      subjectType: "merchant",
      subjectId: merchant.id,
      decision: "approve",
      note: "documents check out",
      idempotencyKey: key,
      correlationId: null,
    });
    const second = await decide(deps, {
      actor: reviewerA,
      cityId: city.cityId,
      queue: "merchants",
      subjectType: "merchant",
      subjectId: merchant.id,
      decision: "approve",
      note: "documents check out",
      idempotencyKey: key,
      correlationId: null,
    });

    expect(second.replayed).toBe(true);
    expect(second.id).toBe(first.id);
    expect(
      await db.reviewDecision.count({ where: { subjectId: merchant.id } }),
    ).toBe(1);
    const verified = await db.merchant.findUnique({ where: { id: merchant.id } });
    expect(verified?.verifiedAt).not.toBeNull();
  });

  it("replays a pending dual-control proposal for the reviewer who made it", async () => {
    const identityCase = await db.identityCase.create({
      data: {
        id: uid("idc"),
        driverId: uid("drv"),
        signals: { riderReports: 2 },
        status: "open",
      },
    });
    const key = idemKey("rvd");
    const first = await decide(deps, {
      actor: reviewerA,
      cityId: city.cityId,
      queue: "identity",
      subjectType: "identity_case",
      subjectId: identityCase.id,
      decision: "deactivate",
      note: "pattern of rider reports",
      idempotencyKey: key,
      correlationId: null,
    });
    expect(first.status).toBe("pending_second_reviewer");

    // The same reviewer retrying the same request gets their own proposal back,
    // not an "already approved" error.
    const retry = await decide(deps, {
      actor: reviewerA,
      cityId: city.cityId,
      queue: "identity",
      subjectType: "identity_case",
      subjectId: identityCase.id,
      decision: "deactivate",
      note: "pattern of rider reports",
      idempotencyKey: key,
      correlationId: null,
    });
    expect(retry.replayed).toBe(true);
    expect(retry.id).toBe(first.id);
    expect(retry.status).toBe("pending_second_reviewer");
    expect(
      await db.reviewDecision.count({ where: { subjectId: identityCase.id } }),
    ).toBe(1);
    // The replay is not a second ops action, so it wrote no second audit row.
    expect(await db.auditLog.count({ where: { subjectId: identityCase.id } })).toBe(1);
  });

  it("keeps the queues away from roles that may not review", async () => {
    const response = await app.request("/v1/reviews/kyc", {
      headers: headers(agent, city.cityId),
    });
    expect(response.status).toBe(403);
  });
});
