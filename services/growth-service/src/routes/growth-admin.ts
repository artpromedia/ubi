/**
 * `/v1/growth` — admin campaigns, referral review, commission board, recon
 * (contracts/openapi/growth-ops.yaml). Approvals are two-person; the author of
 * a campaign can never approve their own (enforced in the campaigns module).
 */
import { Hono } from "hono";
import { z } from "zod";

import {
  actorOf,
  correlationIdOf,
  failure,
  gatewayAuth,
  idempotencyKeyOf,
  optionalCityOf,
} from "../middleware";
import { parseBody } from "./parse";
import {
  BENEFIT_TYPES,
  CAMPAIGN_ACTIONS,
  createCampaign,
  getCampaign,
  getOutcome,
  listCampaigns,
  performAction,
  simulateVersion,
  submitVersion,
} from "../ops/campaigns";
import { commissionIncentivesLive } from "../ops/incentives";
import { reconForDate } from "../ops/recon";
import { decideReview, listReviewQueue } from "../ops/referrals";

import type { GrowthDeps } from "../ops/context";

const MoneySchema = z.object({
  amountMinor: z.number().int(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

const VersionInputSchema = z.object({
  name: z.string().min(1).max(200),
  benefitType: z.enum(BENEFIT_TYPES),
  audienceRule: z.string().max(2000),
  market: z.string().min(1).max(80),
  window: z.object({
    start: z.string(),
    end: z.string(),
    timezone: z.string().min(1),
  }),
  value: z.record(z.unknown()),
  caps: z.object({
    perUser: z.number().int().positive().optional(),
    minSpend: MoneySchema.optional(),
    perRideCap: MoneySchema.optional(),
  }),
  qualificationEvent: z.string().max(200),
  stacking: z.object({
    stacksWith: z.array(z.string()).optional(),
    priority: z.number().int().optional(),
  }),
  funding: z.object({ party: z.string().min(1), costCentre: z.string().optional() }),
  budgetLimit: MoneySchema,
  experiment: z.record(z.unknown()).optional(),
  copy: z.string().max(4000),
});

const ActionBody = z.object({
  action: z.enum(CAMPAIGN_ACTIONS),
  approvalId: z.string().optional(),
  newBudget: MoneySchema.optional(),
  reason: z.string().max(280).optional(),
});

const DecisionBody = z.object({
  decision: z.enum(["qualify", "hold", "deny"]),
  reasonCode: z.string().min(1).max(80),
  holdHours: z.number().int().positive().optional(),
});

export function createGrowthAdminRoutes(deps: GrowthDeps): Hono {
  const routes = new Hono();
  routes.use("*", gatewayAuth);

  routes.get("/campaigns", async (c) => {
    try {
      return c.json(await listCampaigns(deps, actorOf(c)), 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/campaigns", async (c) => {
    try {
      const body = await parseBody(c, VersionInputSchema);
      const result = await createCampaign(deps, {
        actor: actorOf(c),
        cityId: optionalCityOf(c),
        version: {
          name: body.name,
          benefitType: body.benefitType,
          audienceRule: body.audienceRule,
          market: body.market,
          window: body.window,
          value: body.value,
          caps: body.caps,
          qualificationEvent: body.qualificationEvent,
          stacking: body.stacking,
          funding: body.funding,
          budgetLimit: body.budgetLimit,
          ...(body.experiment === undefined ? {} : { experiment: body.experiment }),
          copy: body.copy,
        },
        idempotencyKey: idempotencyKeyOf(c),
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/campaigns/:id", async (c) => {
    try {
      return c.json(await getCampaign(deps, actorOf(c), c.req.param("id")), 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/campaigns/:id/versions/:v/simulate", async (c) => {
    try {
      const result = await simulateVersion(deps, {
        actor: actorOf(c),
        cityId: optionalCityOf(c),
        campaignId: c.req.param("id"),
        version: Number.parseInt(c.req.param("v"), 10),
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/campaigns/:id/versions/:v/submit", async (c) => {
    try {
      const result = await submitVersion(deps, {
        actor: actorOf(c),
        cityId: optionalCityOf(c),
        campaignId: c.req.param("id"),
        version: Number.parseInt(c.req.param("v"), 10),
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 202);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/campaigns/:id/actions", async (c) => {
    try {
      const body = await parseBody(c, ActionBody);
      const result = await performAction(deps, {
        actor: actorOf(c),
        cityId: optionalCityOf(c),
        campaignId: c.req.param("id"),
        action: body.action,
        approvalId: body.approvalId ?? null,
        newBudget: body.newBudget ?? null,
        reason: body.reason ?? null,
        idempotencyKey: idempotencyKeyOf(c),
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/campaigns/:id/versions/:v/outcome", async (c) => {
    try {
      const result = await getOutcome(
        deps,
        actorOf(c),
        c.req.param("id"),
        Number.parseInt(c.req.param("v"), 10),
      );
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/commission-incentives/live", async (c) => {
    try {
      return c.json(await commissionIncentivesLive(deps, actorOf(c)), 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/referrals/review-queue", async (c) => {
    try {
      return c.json(await listReviewQueue(deps, actorOf(c)), 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/referrals/review-queue/:caseId/decision", async (c) => {
    try {
      const body = await parseBody(c, DecisionBody);
      const result = await decideReview(deps, {
        actor: actorOf(c),
        cityId: optionalCityOf(c),
        caseId: c.req.param("caseId"),
        decision: body.decision,
        reasonCode: body.reasonCode,
        ...(body.holdHours === undefined ? {} : { holdHours: body.holdHours }),
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/recon/:date", async (c) => {
    try {
      return c.json(
        await reconForDate(deps, actorOf(c), c.req.param("date")),
        200,
      );
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
