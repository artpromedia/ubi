/**
 * Campaigns, their versions and the campaign state machine
 * (contracts/openapi/growth-ops.yaml, contracts/state-machines.json).
 *
 * A campaign owns a chain of immutable versions. A version binds everything a
 * promise depends on — audience, market, window, timezone, value, caps,
 * qualification, stacking, funding, budget, experiment and copy — so a promise
 * made to a user can be pinned to the exact version that authorised it.
 *
 * The state machine (draft → simulated → awaiting_approval → scheduled → active
 * → paused → exhausted → ended) is enforced through `assertTransition`, and two
 * rules are non-negotiable:
 *
 *  - Activation and budget increases are two-person: the approver must not be
 *    the author (CLAUDE.md #22). This is checked against the gateway identity,
 *    never a body field, and mirrors the DB CHECK on `approved_by`.
 *  - The AI marketing assistant can only draft. It has no approve permission,
 *    so an AI-authored campaign stays in `draft` on the model's own authority
 *    (CLAUDE.md #19, #22).
 */
import {
  assertTransition,
  ContractError,
  initialState,
  money,
  scopedIdempotencyKey,
  type Money,
} from "@ubi/contracts";

import { auditedTransaction, type OutboxInput } from "./audit";
import { isUniqueViolation } from "./errors";
import { toJson } from "./json";
import { actorTypeFor, assertPermission, isAiActor } from "./roles";
import { deterministicId, generateId } from "../lib/ids";

import type { GrowthDeps } from "./context";
import type { Actor, JsonRecord, JsonValue } from "./types";

const MACHINE = "campaign" as const;

export const BENEFIT_TYPES = [
  "fare_discount",
  "fee_waiver",
  "credit",
  "driver_rebate",
  "driver_window",
  "referral",
] as const;
export type BenefitType = (typeof BENEFIT_TYPES)[number];

export const CAMPAIGN_ACTIONS = [
  "activate",
  "pause",
  "resume",
  "end",
  "raise_budget",
] as const;
export type CampaignAction = (typeof CAMPAIGN_ACTIONS)[number];

export interface VersionInput {
  readonly name: string;
  readonly benefitType: BenefitType;
  readonly audienceRule: string;
  readonly market: string;
  readonly window: {
    readonly start: string;
    readonly end: string;
    readonly timezone: string;
  };
  readonly value: Readonly<Record<string, unknown>>;
  readonly caps: {
    readonly perUser?: number;
    readonly minSpend?: Money;
    readonly perRideCap?: Money;
  };
  readonly qualificationEvent: string;
  readonly stacking: {
    readonly stacksWith?: readonly string[];
    readonly priority?: number;
  };
  readonly funding: { readonly party: string; readonly costCentre?: string };
  readonly budgetLimit: Money;
  readonly experiment?: Readonly<Record<string, unknown>>;
  readonly copy: string;
}

interface CampaignRow {
  id: string;
  name: string;
  benefitType: string;
  state: string;
  stateAt: Date;
  stateBy: string | null;
  authorId: string;
  createdAt: Date;
}

export interface CampaignView {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly stateAt: string;
  readonly stateBy: string | null;
  readonly authorId: string;
  readonly benefitType: string;
  readonly versions: readonly JsonRecord[];
  readonly budget: {
    readonly limit: Money;
    readonly reserved: Money;
    readonly spent: Money;
  } | null;
  readonly redemptions: number;
}

function jsonify(value: unknown): JsonValue {
  return value as JsonValue;
}

function toWindow(input: VersionInput): {
  windowStart: Date;
  windowEnd: Date;
} {
  const windowStart = new Date(input.window.start);
  const windowEnd = new Date(input.window.end);
  if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime())) {
    throw new ContractError("validation_failed", "the window is not a valid date range");
  }
  if (windowEnd.getTime() <= windowStart.getTime()) {
    throw new ContractError("validation_failed", "the window must end after it starts");
  }
  return { windowStart, windowEnd };
}

async function loadCampaign(
  deps: GrowthDeps,
  id: string,
): Promise<CampaignRow> {
  const row = await deps.db.campaign.findUnique({ where: { id } });
  if (row === null) {
    throw new ContractError("not_found", "no such campaign", { campaignId: id });
  }
  return row;
}

async function campaignView(
  deps: GrowthDeps,
  row: CampaignRow,
): Promise<CampaignView> {
  const versions = await deps.db.campaignVersion.findMany({
    where: { campaignId: row.id },
    orderBy: { version: "asc" },
    include: { budget: true },
  });
  const latest = versions[versions.length - 1];
  const budget =
    latest === undefined
      ? null
      : {
          limit: money(Number(latest.budgetLimitMinor), latest.currency),
          reserved: money(
            Number(latest.budget?.reservedMinor ?? 0n),
            latest.currency,
          ),
          spent: money(
            Number(latest.budget?.consumedMinor ?? 0n),
            latest.currency,
          ),
        };
  const versionIds = versions.map((v) => v.id);
  const redemptions =
    versionIds.length === 0
      ? 0
      : await deps.db.promotionReservation.count({
          where: { campaignVersionId: { in: versionIds }, state: "consumed" },
        });

  return {
    id: row.id,
    name: row.name,
    state: row.state,
    stateAt: row.stateAt.toISOString(),
    stateBy: row.stateBy,
    authorId: row.authorId,
    benefitType: row.benefitType,
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      market: v.market,
      audienceRule: v.audienceRule,
      windowStart: v.windowStart.toISOString(),
      windowEnd: v.windowEnd.toISOString(),
      timezone: v.timezone,
      qualificationEvent: v.qualificationEvent,
      value: jsonify(v.value),
      caps: jsonify(v.caps),
      stacking: jsonify(v.stacking),
      funding: jsonify(v.funding),
      experiment: jsonify(v.experiment ?? null),
      budgetLimitMinor: Number(v.budgetLimitMinor),
      currency: v.currency,
      copy: v.copy,
      approvalId: v.approvalId,
      approvedBy: v.approvedBy,
      approvedAt: v.approvedAt?.toISOString() ?? null,
    })),
    budget,
    redemptions,
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateCampaignInput {
  readonly actor: Actor;
  readonly cityId: string | null;
  readonly version: VersionInput;
  readonly idempotencyKey: string;
  readonly correlationId: string | null;
}

export async function createCampaign(
  deps: GrowthDeps,
  input: CreateCampaignInput,
): Promise<CampaignView> {
  assertPermission(input.actor.role, "campaign.create");
  const { windowStart, windowEnd } = toWindow(input.version);

  const scoped = scopedIdempotencyKey(
    "growth.campaign.create",
    input.actor.id,
    input.idempotencyKey,
  );
  const campaignId = deterministicId("cmp", scoped);
  const versionId = deterministicId("cver", `${scoped}:v1`);

  const replay = await deps.db.campaign.findUnique({ where: { id: campaignId } });
  if (replay !== null) {
    return campaignView(deps, replay);
  }

  const state = initialState(MACHINE); // "draft"
  const now = deps.now();

  try {
    return await auditedTransaction(deps.db, async (tx) => {
      const created = await tx.campaign.create({
        data: {
          id: campaignId,
          name: input.version.name,
          benefitType: input.version.benefitType,
          state,
          stateAt: now,
          stateBy: input.actor.id,
          authorId: input.actor.id,
        },
      });
      await tx.campaignVersion.create({
        data: {
          id: versionId,
          campaignId,
          version: 1,
          audienceRule: input.version.audienceRule,
          market: input.version.market,
          windowStart,
          windowEnd,
          timezone: input.version.window.timezone,
          value: toJson(input.version.value),
          caps: toJson(input.version.caps),
          qualificationEvent: input.version.qualificationEvent,
          stacking: toJson(input.version.stacking),
          funding: toJson(input.version.funding),
          budgetLimitMinor: BigInt(input.version.budgetLimit.amountMinor),
          currency: input.version.budgetLimit.currency,
          experiment:
            input.version.experiment === undefined
              ? undefined
              : toJson(input.version.experiment),
          copy: input.version.copy,
        },
      });
      await tx.campaignBudget.create({
        data: { campaignVersionId: versionId },
      });

      const event: OutboxInput = {
        name: "campaign.version.created",
        aggregateType: "campaign",
        aggregateId: campaignId,
        fromVersion: null,
        toVersion: 1,
        actor: input.actor,
        actorType: actorTypeFor(input.actor.role),
        cityId: input.cityId,
        idempotencyKey: `campaign.version.created:${versionId}`,
        correlationId: input.correlationId,
        occurredAt: now,
        payload: {
          campaignId,
          version: 1,
          benefitType: input.version.benefitType,
          aiAuthored: isAiActor(input.actor.role),
        },
      };

      return {
        result: created,
        audit: {
          actor: input.actor,
          action: "growth.campaign.created",
          subjectType: "campaign",
          subjectId: campaignId,
          reason: `campaign drafted (${input.version.benefitType})`,
          before: null,
          after: {
            state,
            benefitType: input.version.benefitType,
            aiAuthored: isAiActor(input.actor.role),
          },
          correlationId: input.correlationId,
        },
        events: [event],
      };
    }).then((row) => campaignView(deps, row));
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await deps.db.campaign.findUnique({
        where: { id: campaignId },
      });
      if (existing !== null) {
        return campaignView(deps, existing);
      }
    }
    throw error;
  }
}

export async function getCampaign(
  deps: GrowthDeps,
  actor: Actor,
  id: string,
): Promise<CampaignView> {
  assertPermission(actor.role, "campaign.read");
  return campaignView(deps, await loadCampaign(deps, id));
}

export async function listCampaigns(
  deps: GrowthDeps,
  actor: Actor,
): Promise<readonly CampaignView[]> {
  assertPermission(actor.role, "campaign.read");
  const rows = await deps.db.campaign.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return Promise.all(rows.map((row) => campaignView(deps, row)));
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

async function loadVersion(
  deps: GrowthDeps,
  campaignId: string,
  version: number,
): Promise<{
  id: string;
  budgetLimitMinor: bigint;
  currency: string;
  windowStart: Date;
  windowEnd: Date;
  approvedBy: string | null;
  approvalId: string | null;
}> {
  const row = await deps.db.campaignVersion.findUnique({
    where: { campaignId_version: { campaignId, version } },
  });
  if (row === null) {
    throw new ContractError("not_found", "no such campaign version", {
      campaignId,
      version,
    });
  }
  return row;
}

// ---------------------------------------------------------------------------
// Simulate — liability estimate (server-computed, honest about assumptions)
// ---------------------------------------------------------------------------

export interface Liability {
  readonly eligibleUsers: number;
  readonly expectedRedemptionPct: number;
  readonly redemptionRange: readonly [number, number];
  readonly maxLiability: Money;
  readonly expectedSpend: Money;
  readonly warnings: readonly string[];
  readonly overlaps: readonly string[];
}

/**
 * Counts users this version could reach. The audience rule is a small
 * server-evaluated expression; `all` and `country:XX` are understood, anything
 * else falls back to the whole user base with a warning rather than inventing a
 * number (CLAUDE.md #8, #12 — no fabricated personas).
 */
async function eligibleUserCount(
  deps: GrowthDeps,
  audienceRule: string,
  warnings: string[],
): Promise<number> {
  const rule = audienceRule.trim().toLowerCase();
  if (rule === "" || rule === "all") {
    return deps.db.user.count();
  }
  const country = /^country:([a-z]{2})$/.exec(rule);
  if (country !== null) {
    return deps.db.user.count({ where: { country: country[1]?.toUpperCase() } });
  }
  warnings.push(
    "audience rule not recognised by the simulator; counting the whole user base as an upper bound",
  );
  return deps.db.user.count();
}

export async function simulateVersion(
  deps: GrowthDeps,
  input: {
    actor: Actor;
    cityId: string | null;
    campaignId: string;
    version: number;
    correlationId: string | null;
  },
): Promise<Liability> {
  assertPermission(input.actor.role, "campaign.simulate");
  const campaign = await loadCampaign(deps, input.campaignId);
  const version = await deps.db.campaignVersion.findUnique({
    where: { campaignId_version: { campaignId: input.campaignId, version: input.version } },
  });
  if (version === null) {
    throw new ContractError("not_found", "no such campaign version", {
      campaignId: input.campaignId,
      version: input.version,
    });
  }

  const warnings: string[] = [];
  const eligibleUsers = await eligibleUserCount(
    deps,
    version.audienceRule,
    warnings,
  );

  const caps = version.caps as {
    perUser?: number;
    perRideCap?: { amountMinor?: number };
  } | null;
  const perUser = caps?.perUser ?? 1;
  const perRideCapMinor = caps?.perRideCap?.amountMinor ?? null;
  const currency = version.currency;
  const budgetLimit = Number(version.budgetLimitMinor);

  // The most a single user could ever cost, from the caps that exist.
  const perUserMax =
    perRideCapMinor === null ? budgetLimit : perRideCapMinor * perUser;
  const uncapped = eligibleUsers * perUserMax;
  const maxLiabilityMinor = Math.min(budgetLimit, uncapped);

  // Expected redemption is derived from this campaign's own history, never a
  // hard-coded rate. With no history we show the max-liability case and say so.
  const versionIds = (
    await deps.db.campaignVersion.findMany({
      where: { campaignId: input.campaignId },
      select: { id: true },
    })
  ).map((v) => v.id);
  const [reserved, consumed] = await Promise.all([
    deps.db.promotionReservation.count({
      where: { campaignVersionId: { in: versionIds } },
    }),
    deps.db.promotionReservation.count({
      where: { campaignVersionId: { in: versionIds }, state: "consumed" },
    }),
  ]);
  let expectedRedemptionPct: number;
  if (reserved === 0) {
    expectedRedemptionPct = 1;
    warnings.push("no redemption history; showing maximum liability");
  } else {
    expectedRedemptionPct = consumed / reserved;
  }
  const low = Math.max(0, expectedRedemptionPct * 0.5);
  const high = Math.min(1, expectedRedemptionPct * 1.5);
  const expectedSpendMinor = Math.round(maxLiabilityMinor * expectedRedemptionPct);

  // Overlapping active campaigns in the same market are flagged, not merged.
  const overlaps = (
    await deps.db.campaignVersion.findMany({
      where: {
        market: version.market,
        campaignId: { not: input.campaignId },
        campaign: { state: "active" },
      },
      select: { campaignId: true },
      take: 20,
    })
  ).map((v) => v.campaignId);

  // Move draft → simulated the first time; re-simulation from `simulated` is a
  // no-op transition and leaves the state alone.
  if (campaign.state === "draft") {
    const now = deps.now();
    await auditedTransaction(deps.db, async (tx) => {
      assertTransition(MACHINE, "draft", "simulated");
      await tx.campaign.update({
        where: { id: input.campaignId },
        data: { state: "simulated", stateAt: now, stateBy: input.actor.id },
      });
      const event: OutboxInput = {
        name: "campaign.version.simulated",
        aggregateType: "campaign",
        aggregateId: input.campaignId,
        fromVersion: input.version,
        toVersion: input.version,
        actor: input.actor,
        actorType: actorTypeFor(input.actor.role),
        cityId: input.cityId,
        idempotencyKey: `campaign.version.simulated:${version.id}:${now.getTime()}`,
        correlationId: input.correlationId,
        occurredAt: now,
        payload: {
          campaignId: input.campaignId,
          version: input.version,
          eligibleUsers,
          maxLiabilityMinor,
        },
      };
      return {
        result: null,
        audit: {
          actor: input.actor,
          action: "growth.campaign.simulated",
          subjectType: "campaign",
          subjectId: input.campaignId,
          reason: "liability simulated",
          before: { state: "draft" },
          after: { state: "simulated", eligibleUsers, maxLiabilityMinor },
          correlationId: input.correlationId,
        },
        events: [event],
      };
    });
  }

  return {
    eligibleUsers,
    expectedRedemptionPct,
    redemptionRange: [low, high],
    maxLiability: money(maxLiabilityMinor, currency),
    expectedSpend: money(expectedSpendMinor, currency),
    warnings,
    overlaps,
  };
}

// ---------------------------------------------------------------------------
// Submit for approval
// ---------------------------------------------------------------------------

export async function submitVersion(
  deps: GrowthDeps,
  input: {
    actor: Actor;
    cityId: string | null;
    campaignId: string;
    version: number;
    correlationId: string | null;
  },
): Promise<{ approvalId: string; state: string }> {
  assertPermission(input.actor.role, "campaign.submit");
  const campaign = await loadCampaign(deps, input.campaignId);
  const version = await loadVersion(deps, input.campaignId, input.version);
  assertTransition(MACHINE, campaign.state, "awaiting_approval");

  const now = deps.now();
  const approvalId = generateId("appr");

  return auditedTransaction(deps.db, async (tx) => {
    await tx.campaign.update({
      where: { id: input.campaignId },
      data: { state: "awaiting_approval", stateAt: now, stateBy: input.actor.id },
    });
    await tx.campaignVersion.update({
      where: { id: version.id },
      data: { approvalId },
    });
    const event: OutboxInput = {
      name: "campaign.version.submitted",
      aggregateType: "campaign",
      aggregateId: input.campaignId,
      fromVersion: input.version,
      toVersion: input.version,
      actor: input.actor,
      actorType: actorTypeFor(input.actor.role),
      cityId: input.cityId,
      idempotencyKey: `campaign.version.submitted:${version.id}`,
      correlationId: input.correlationId,
      occurredAt: now,
      payload: { campaignId: input.campaignId, version: input.version, approvalId },
    };
    return {
      result: { approvalId, state: "awaiting_approval" },
      audit: {
        actor: input.actor,
        action: "growth.campaign.submitted",
        subjectType: "campaign",
        subjectId: input.campaignId,
        reason: "submitted for two-person approval",
        before: { state: campaign.state },
        after: { state: "awaiting_approval", approvalId },
        correlationId: input.correlationId,
      },
      events: [event],
    };
  });
}

// ---------------------------------------------------------------------------
// Approved actions — activate / pause / resume / end / raise_budget
// ---------------------------------------------------------------------------

/** The approver may not be the author (CLAUDE.md #22; mirrors the DB CHECK). */
function assertTwoPerson(campaign: CampaignRow, actor: Actor): void {
  if (campaign.authorId === actor.id) {
    throw new ContractError(
      "approver_is_author",
      "the person who authored a campaign cannot approve it; a second person must",
      { campaignId: campaign.id },
    );
  }
}

export interface ActionInput {
  readonly actor: Actor;
  readonly cityId: string | null;
  readonly campaignId: string;
  readonly action: CampaignAction;
  readonly approvalId?: string | null;
  readonly newBudget?: Money | null;
  readonly reason?: string | null;
  readonly idempotencyKey: string;
  readonly correlationId: string | null;
}

export async function performAction(
  deps: GrowthDeps,
  input: ActionInput,
): Promise<CampaignView> {
  assertPermission(input.actor.role, "campaign.approve");
  const campaign = await loadCampaign(deps, input.campaignId);
  const latest = await deps.db.campaignVersion.findFirst({
    where: { campaignId: input.campaignId },
    orderBy: { version: "desc" },
  });
  if (latest === null) {
    throw new ContractError("not_found", "campaign has no version", {
      campaignId: input.campaignId,
    });
  }
  const now = deps.now();

  // Plan the hops and the effects for the requested action. Every hop is
  // asserted against the machine before anything is written.
  const hops: string[] = [];
  const events: OutboxInput[] = [];
  let approvedBy: string | null = null;
  let newBudgetMinor: bigint | null = null;

  const pushEvent = (name: string, extra: JsonRecord): void => {
    events.push({
      name,
      aggregateType: "campaign",
      aggregateId: input.campaignId,
      fromVersion: latest.version,
      toVersion: latest.version,
      actor: input.actor,
      actorType: actorTypeFor(input.actor.role),
      cityId: input.cityId,
      idempotencyKey: `${name}:${latest.id}:${input.idempotencyKey}`,
      correlationId: input.correlationId,
      occurredAt: now,
      payload: { campaignId: input.campaignId, version: latest.version, ...extra },
    });
  };

  switch (input.action) {
    case "activate": {
      // Approval step. Only a second person may take a campaign past approval.
      assertTwoPerson(campaign, input.actor);
      if (input.approvalId != null && latest.approvalId !== input.approvalId) {
        throw new ContractError("validation_failed", "approval id does not match the submitted version");
      }
      if (campaign.state === "awaiting_approval") {
        if (latest.approvedBy !== null) {
          throw new ContractError("already_approved", "this version is already approved");
        }
        assertTransition(MACHINE, "awaiting_approval", "scheduled");
        hops.push("scheduled");
        approvedBy = input.actor.id;
        pushEvent("campaign.version.approved", { approvalId: latest.approvalId });
      }
      // Go live now if we are inside the window; otherwise it stays scheduled.
      const from = hops[hops.length - 1] ?? campaign.state;
      const inWindow =
        now.getTime() >= latest.windowStart.getTime() &&
        now.getTime() < latest.windowEnd.getTime();
      if (inWindow) {
        assertTransition(MACHINE, from, "active");
        hops.push("active");
        pushEvent("campaign.version.activated", {});
      } else if (from !== "scheduled") {
        // Nothing changed and we are not moving to scheduled: illegal request.
        assertTransition(MACHINE, campaign.state, "scheduled");
        hops.push("scheduled");
      }
      break;
    }
    case "pause": {
      assertTransition(MACHINE, campaign.state, "paused");
      hops.push("paused");
      pushEvent("campaign.version.paused", {});
      break;
    }
    case "resume": {
      assertTransition(MACHINE, campaign.state, "active");
      hops.push("active");
      pushEvent("campaign.version.resumed", {});
      break;
    }
    case "end": {
      assertTransition(MACHINE, campaign.state, "ended");
      hops.push("ended");
      pushEvent("campaign.version.ended", {});
      break;
    }
    case "raise_budget": {
      // A budget increase moves money and is therefore two-person as well.
      assertTwoPerson(campaign, input.actor);
      if (input.newBudget == null) {
        throw new ContractError("validation_failed", "raise_budget needs a newBudget");
      }
      if (input.newBudget.currency !== latest.currency) {
        throw new ContractError("validation_failed", "budget currency must match the version currency");
      }
      const proposed = BigInt(input.newBudget.amountMinor);
      if (proposed <= latest.budgetLimitMinor) {
        throw new ContractError(
          "validation_failed",
          "a budget change may only raise the limit",
          { currentMinor: Number(latest.budgetLimitMinor) },
        );
      }
      newBudgetMinor = proposed;
      approvedBy = input.actor.id;
      pushEvent("campaign.version.approved", {
        change: "raise_budget",
        newBudgetMinor: Number(proposed),
      });
      break;
    }
    default: {
      throw new ContractError("validation_failed", "unknown action");
    }
  }

  const finalState = hops[hops.length - 1] ?? campaign.state;

  await auditedTransaction(deps.db, async (tx) => {
    if (finalState !== campaign.state) {
      await tx.campaign.update({
        where: { id: input.campaignId },
        data: { state: finalState, stateAt: now, stateBy: input.actor.id },
      });
    }
    if (approvedBy !== null && input.action === "activate") {
      await tx.campaignVersion.update({
        where: { id: latest.id },
        data: { approvedBy, approvedAt: now },
      });
    }
    if (newBudgetMinor !== null) {
      await tx.campaignVersion.update({
        where: { id: latest.id },
        data: { budgetLimitMinor: newBudgetMinor },
      });
    }
    return {
      result: null,
      audit: {
        actor: input.actor,
        action: `growth.campaign.${input.action}`,
        subjectType: "campaign",
        subjectId: input.campaignId,
        reason: input.reason ?? input.action,
        before: { state: campaign.state, budgetMinor: Number(latest.budgetLimitMinor) },
        after: {
          state: finalState,
          approvedBy,
          budgetMinor:
            newBudgetMinor === null
              ? Number(latest.budgetLimitMinor)
              : Number(newBudgetMinor),
        },
        correlationId: input.correlationId,
      },
      events,
    };
  });

  return campaignView(deps, await loadCampaign(deps, input.campaignId));
}

// ---------------------------------------------------------------------------
// Outcome — measured, with denominators, never a bare number (growth-ops.yaml)
// ---------------------------------------------------------------------------

export async function getOutcome(
  deps: GrowthDeps,
  actor: Actor,
  campaignId: string,
  version: number,
): Promise<JsonRecord> {
  assertPermission(actor.role, "campaign.read");
  const v = await loadVersion(deps, campaignId, version);

  const [reserved, consumed, reversed, spend] = await Promise.all([
    deps.db.promotionReservation.count({ where: { campaignVersionId: v.id } }),
    deps.db.promotionReservation.count({
      where: { campaignVersionId: v.id, state: "consumed" },
    }),
    deps.db.promotionReservation.count({
      where: { campaignVersionId: v.id, state: "reversed" },
    }),
    deps.db.promotionReservation.aggregate({
      where: { campaignVersionId: v.id, state: "consumed" },
      _sum: { amountMinor: true },
    }),
  ]);

  const claims = await deps.db.attributionClaim.groupBy({
    by: ["kind"],
    where: { campaign: campaignId },
    _count: true,
  });
  const claimTotal = claims.reduce((sum, c) => sum + c._count, 0);
  const pct = (kind: string): number => {
    if (claimTotal === 0) return 0;
    const found = claims.find((c) => c.kind === kind);
    return found === undefined ? 0 : found._count / claimTotal;
  };

  const metrics: JsonRecord[] = [
    {
      key: "redemptions",
      value: consumed,
      denominator: "reservations_made",
      window: `${v.windowStart.toISOString()}..${v.windowEnd.toISOString()}`,
      sampleSize: reserved,
      method: "count",
    },
    {
      key: "spend_minor",
      value: Number(spend._sum.amountMinor ?? 0n),
      unit: v.currency,
      denominator: "consumed_reservations",
      window: `${v.windowStart.toISOString()}..${v.windowEnd.toISOString()}`,
      sampleSize: consumed,
      method: "transaction_confirmed",
    },
    {
      key: "reversals",
      value: reversed,
      denominator: "consumed_reservations",
      window: `${v.windowStart.toISOString()}..${v.windowEnd.toISOString()}`,
      sampleSize: consumed,
      method: "count",
    },
  ];

  const caveats: string[] = [];
  if (reserved < 50) {
    caveats.push("sample below 50; treat redemption rate as indicative only");
  }

  return {
    metrics,
    attribution: {
      taggedPct: pct("referral") + pct("campaign"),
      organicPct: pct("organic"),
      unknownPct: pct("unknown"),
    },
    caveats,
  };
}
