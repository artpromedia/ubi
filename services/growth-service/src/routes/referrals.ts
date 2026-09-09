/**
 * `/v1/referrals` and `/v1/attribution` — rider referral programme and the
 * deferred-deep-link / web-handoff attribution claim
 * (contracts/openapi/promotions.yaml). Referrals are gated by the `referrals`
 * flag; the attribution claim always answers (it records organic when nothing
 * matched) so a fresh install is never left unattributed.
 */
import { Hono } from "hono";
import { z } from "zod";

import { assertFlagEnabled } from "../ops/config";
import {
  claimAttribution,
  getProgram,
  getReferral,
  share,
} from "../ops/referrals";
import {
  actorOf,
  cityOf,
  correlationIdOf,
  failure,
  gatewayAuth,
  idempotencyKeyOf,
  optionalCityOf,
} from "../middleware";
import { parseBody } from "./parse";

import type { GrowthDeps } from "../ops/context";

const ClaimBody = z.object({
  code: z.string().max(64).optional(),
  token: z.string().max(256).optional(),
  campaign: z.string().max(64).optional(),
  source: z.enum(["deferred_link", "web_handoff", "manual"]),
});

export function createReferralRoutes(deps: GrowthDeps): Hono {
  const routes = new Hono();
  routes.use("*", gatewayAuth);

  routes.get("/", async (c) => {
    try {
      assertFlagEnabled(await deps.flags.flagsFor(cityOf(c)), "referrals");
      return c.json(await getProgram(deps, actorOf(c)), 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/share", async (c) => {
    try {
      assertFlagEnabled(await deps.flags.flagsFor(cityOf(c)), "referrals");
      return c.json(await share(deps, actorOf(c)), 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/:id", async (c) => {
    try {
      assertFlagEnabled(await deps.flags.flagsFor(cityOf(c)), "referrals");
      return c.json(await getReferral(deps, actorOf(c), c.req.param("id")), 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}

export function createAttributionRoutes(deps: GrowthDeps): Hono {
  const routes = new Hono();
  routes.use("*", gatewayAuth);

  routes.post("/claim", async (c) => {
    try {
      const body = await parseBody(c, ClaimBody);
      // The idempotency key is required by the contract; the claim is also
      // first-touch immutable, so a replay returns the original attribution.
      idempotencyKeyOf(c);
      const result = await claimAttribution(deps, {
        actor: actorOf(c),
        cityId: optionalCityOf(c),
        ...(body.code === undefined ? {} : { code: body.code }),
        ...(body.token === undefined ? {} : { token: body.token }),
        ...(body.campaign === undefined ? {} : { campaign: body.campaign }),
        source: body.source,
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
