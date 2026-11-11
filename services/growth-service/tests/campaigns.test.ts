/**
 * Campaigns and two-person approval (CLAUDE.md #19, #22).
 *
 * The author of a campaign can never approve it — activation and budget
 * increases require a second person. An AI-authored campaign stays a draft
 * because the AI role has no submit or approve permission.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeTestDb,
  FakeLedger,
  headers,
  idemKey,
  makeDeps,
  seedCity,
  seedIncentiveRule,
  seedCampaign,
  testDb,
  TEST_IDENTITY_SECRET,
  uid,
} from "./helpers";
import { createApp } from "../src/index";
import {
  assertIdentityConfigured,
  IDENTITY_HEADER,
  signIdentityContext,
} from "../src/lib/identity-context";
import {
  createCampaign,
  performAction,
  simulateVersion,
  submitVersion,
  type VersionInput,
} from "../src/ops/campaigns";
import { claimAttribution, share } from "../src/ops/referrals";
import { handleRideCompletedEnvelope } from "../src/ops/ride-completion";

import type { GrowthDeps } from "../src/ops/context";
import type { GrowthDb } from "../src/ops/types";
import type { Hono } from "hono";

const AUTHOR = { id: "author_a", role: "growth_editor" };
const APPROVER = { id: "approver_b", role: "growth_admin" };
const CITY = "city_growth";

function versionInput(overrides: Partial<VersionInput> = {}): VersionInput {
  const now = Date.now();
  return {
    name: "Weekend 10%",
    benefitType: "fare_discount",
    audienceRule: "all",
    market: "Lagos",
    window: {
      start: new Date(now - 3_600_000).toISOString(),
      end: new Date(now + 7 * 24 * 3_600_000).toISOString(),
      timezone: "Africa/Lagos",
    },
    value: { pct: 10 },
    caps: { perUser: 1, perRideCap: { amountMinor: 50_000, currency: "NGN" } },
    qualificationEvent: "ride.completed_and_paid",
    stacking: { priority: 1 },
    funding: { party: "ubi_marketing" },
    budgetLimit: { amountMinor: 1_000_000, currency: "NGN" },
    copy: "Save 10% this weekend",
    ...overrides,
  };
}

describe("campaign lifecycle + two-person approval", () => {
  let db: GrowthDb;
  let deps: GrowthDeps;
  let app: Hono;

  beforeAll(() => {
    db = testDb();
    deps = makeDeps(db);
    app = createApp(deps);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function draftAndSubmit(): Promise<string> {
    const created = await createCampaign(deps, {
      actor: AUTHOR,
      cityId: CITY,
      version: versionInput(),
      idempotencyKey: idemKey("create"),
      correlationId: null,
    });
    await simulateVersion(deps, {
      actor: AUTHOR,
      cityId: CITY,
      campaignId: created.id,
      version: 1,
      correlationId: null,
    });
    await submitVersion(deps, {
      actor: AUTHOR,
      cityId: CITY,
      campaignId: created.id,
      version: 1,
      correlationId: null,
    });
    return created.id;
  }

  it("creates a campaign in draft", async () => {
    const created = await createCampaign(deps, {
      actor: AUTHOR,
      cityId: CITY,
      version: versionInput(),
      idempotencyKey: idemKey("create"),
      correlationId: null,
    });
    expect(created.state).toBe("draft");
    expect(created.authorId).toBe(AUTHOR.id);
  });

  it("refuses to let the author approve their own campaign", async () => {
    const campaignId = await draftAndSubmit();
    await expect(
      performAction(deps, {
        actor: AUTHOR,
        cityId: CITY,
        campaignId,
        action: "activate",
        idempotencyKey: idemKey("act"),
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "approver_is_author" });

    // And over HTTP the same request is a 409.
    const response = await app.request(
      `/v1/growth/campaigns/${campaignId}/actions`,
      {
        method: "POST",
        headers: headers(AUTHOR, CITY, { "idempotency-key": idemKey("act") }),
        body: JSON.stringify({ action: "activate" }),
      },
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("approver_is_author");
  });

  it("refuses a forged X-User-ID header when the signed x-ubi-identity belongs to the author (CC-A12)", async () => {
    const campaignId = await draftAndSubmit();
    // Author signs x-ubi-identity as AUTHOR (`author_a`), but forges plain
    // `X-User-ID: approver_b` and `X-User-Role: growth_admin`. The verified
    // identity context wins, so the two-person check still sees `author_a` and
    // refuses with 409 `approver_is_author`.
    const forgedHeaders = headers(AUTHOR, CITY, {
      "idempotency-key": idemKey("forged"),
      "X-User-ID": APPROVER.id,
      "X-User-Role": APPROVER.role,
    });
    const response = await app.request(
      `/v1/growth/campaigns/${campaignId}/actions`,
      {
        method: "POST",
        headers: forgedHeaders,
        body: JSON.stringify({ action: "activate" }),
      },
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("approver_is_author");
  });

  it("negative control: refuses a request with only plain X-User-ID / X-User-Role headers and no signed x-ubi-identity (CC-A12)", async () => {
    const response = await app.request("/v1/growth/campaigns", {
      method: "GET",
      headers: {
        "content-type": "application/json",
        "X-User-ID": APPROVER.id,
        "X-User-Role": APPROVER.role,
        "X-City-ID": CITY,
      },
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("unauthorized");
  });

  it("refuses a city mismatch and missing growth:admin scope on /v1/growth/* (CC-A12)", async () => {
    const mismatchRes = await app.request("/v1/growth/campaigns", {
      method: "GET",
      headers: headers(APPROVER, CITY, { "X-City-ID": "city_other" }),
    });
    expect(mismatchRes.status).toBe(403);
    const mismatchBody = (await mismatchRes.json()) as {
      code: string;
      details?: { reason?: string };
    };
    expect(mismatchBody.code).toBe("forbidden");
    expect(mismatchBody.details?.reason).toBe("city_mismatch");

    const noAdminScopeToken = signIdentityContext({
      userId: APPROVER.id,
      role: APPROVER.role,
      cityId: CITY,
      scopes: ["profile:read"],
      secret: TEST_IDENTITY_SECRET,
    });
    const scopeRes = await app.request("/v1/growth/campaigns", {
      method: "GET",
      headers: {
        "content-type": "application/json",
        [IDENTITY_HEADER]: noAdminScopeToken,
        "x-auth-city-id": CITY,
      },
    });
    expect(scopeRes.status).toBe(403);
    const scopeBody = (await scopeRes.json()) as {
      code: string;
      details?: { reason?: string };
    };
    expect(scopeBody.details?.reason).toBe("missing_scope");

    expect(() =>
      assertIdentityConfigured({
        NODE_ENV: "production",
        UBI_IDENTITY_SECRET: "",
      }),
    ).toThrow(/UBI_IDENTITY_SECRET/);
  });

  it("activates when a second person approves", async () => {
    const campaignId = await draftAndSubmit();
    const result = await performAction(deps, {
      actor: APPROVER,
      cityId: CITY,
      campaignId,
      action: "activate",
      idempotencyKey: idemKey("act"),
      correlationId: null,
    });
    expect(result.state).toBe("active");

    const version = await db.campaignVersion.findFirst({
      where: { campaignId, version: 1 },
    });
    expect(version?.approvedBy).toBe(APPROVER.id);

    const approved = await db.outboxEvent.findFirst({
      where: { name: "campaign.version.approved", aggregateId: campaignId },
    });
    expect(approved).not.toBeNull();
  });

  it("keeps an AI-authored campaign in draft: the AI cannot submit", async () => {
    const created = await createCampaign(deps, {
      actor: { id: "ai_marketer", role: "marketing_ai" },
      cityId: CITY,
      version: versionInput({ name: "AI idea" }),
      idempotencyKey: idemKey("create"),
      correlationId: null,
    });
    expect(created.state).toBe("draft");

    await expect(
      submitVersion(deps, {
        actor: { id: "ai_marketer", role: "marketing_ai" },
        cityId: CITY,
        campaignId: created.id,
        version: 1,
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("raising a budget is also two-person", async () => {
    const campaignId = await draftAndSubmit();
    await performAction(deps, {
      actor: APPROVER,
      cityId: CITY,
      campaignId,
      action: "activate",
      idempotencyKey: idemKey("act"),
      correlationId: null,
    });
    await expect(
      performAction(deps, {
        actor: AUTHOR,
        cityId: CITY,
        campaignId,
        action: "raise_budget",
        newBudget: { amountMinor: 2_000_000, currency: "NGN" },
        idempotencyKey: idemKey("raise"),
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "approver_is_author" });

    const raised = await performAction(deps, {
      actor: APPROVER,
      cityId: CITY,
      campaignId,
      action: "raise_budget",
      newBudget: { amountMinor: 2_000_000, currency: "NGN" },
      idempotencyKey: idemKey("raise"),
      correlationId: null,
    });
    expect(raised.budget?.limit.amountMinor).toBe(2_000_000);
  });

  it("qualifies referrals and posts driver rebates + milestone bonuses on ride.completed (P2-10)", async () => {
    const ledger = new FakeLedger(db);
    const localDeps = makeDeps(db, { ledger });
    const { cityId } = await seedCity(db, {
      referrals: true,
      driver_commission_rebates: true,
    });

    await seedCampaign(db, {
      benefitType: "referral",
      budgetLimitMinor: 10_000_000,
      currency: "NGN",
      value: {
        reward: { amountMinor: 200_000, currency: "NGN" },
        refereeBenefit: { amountMinor: 100_000, currency: "NGN" },
        monthlyCap: 10,
      },
    });
    const referrer = { id: uid("rider"), role: "rider" };
    const { code } = await share(localDeps, referrer);
    const referee = { id: uid("rider"), role: "rider" };
    await claimAttribution(localDeps, {
      actor: referee,
      cityId,
      code,
      source: "deferred_link",
      correlationId: null,
    });

    const rule = await seedIncentiveRule(db, {
      kind: "percentage_points",
      baseBps: 2000,
      reductionBps: 500,
      currency: "NGN",
    });
    await db.campaignVersion.update({
      where: { id: rule.versionId },
      data: {
        value: {
          milestoneTrips: 1,
          milestoneBonus: { amountMinor: 50_000, currency: "NGN" },
        } as never,
      },
    });

    const driverId = uid("driver");
    const rideId = uid("ride");
    const outcome = await handleRideCompletedEnvelope(localDeps, {
      id: uid("evt"),
      name: "ride.completed",
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      cityId,
      actor: { type: "driver", id: driverId },
      subject: { type: "ride", id: rideId, version: 3 },
      idempotencyKey: `ride.completed:${rideId}`,
      correlationId: `corr_${rideId}`,
      payload: {
        rideId,
        riderId: referee.id,
        driverId,
        fareMinor: 100_000,
        totalMinor: 100_000,
        currency: "NGN",
        paymentMethodId: "wallet",
      },
    });

    expect(outcome).not.toBeNull();
    expect(outcome?.referral?.outcome).toBe("rewarded");
    expect(outcome?.incentives.some((i) => i.posted)).toBe(true);
    expect(outcome?.milestones.some((m) => m.posted)).toBe(true);
  });
});
