/**
 * Campaigns and two-person approval (CLAUDE.md #19, #22).
 *
 * The author of a campaign can never approve it — activation and budget
 * increases require a second person. An AI-authored campaign stays a draft
 * because the AI role has no submit or approve permission.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeTestDb, headers, idemKey, makeDeps, testDb } from "./helpers";
import { createApp } from "../src/index";
import {
  createCampaign,
  performAction,
  simulateVersion,
  submitVersion,
  type VersionInput,
} from "../src/ops/campaigns";

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
});
