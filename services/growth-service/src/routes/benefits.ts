/**
 * `/v1/benefits` — rider benefits (contracts/openapi/promotions.yaml).
 * Gated by the `rider_promotions` flag: when it is off, the deep link 404s.
 */
import { Hono } from "hono";

import { getBenefits, getBenefitChange } from "../ops/benefits";
import { assertFlagEnabled } from "../ops/config";
import { actorOf, cityOf, failure, gatewayAuth } from "../middleware";

import type { GrowthDeps } from "../ops/context";

export function createBenefitsRoutes(deps: GrowthDeps): Hono {
  const routes = new Hono();
  routes.use("*", gatewayAuth);

  routes.get("/", async (c) => {
    try {
      assertFlagEnabled(await deps.flags.flagsFor(cityOf(c)), "rider_promotions");
      return c.json(await getBenefits(deps, actorOf(c)), 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/changes/:changeId", async (c) => {
    try {
      assertFlagEnabled(await deps.flags.flagsFor(cityOf(c)), "rider_promotions");
      return c.json(
        await getBenefitChange(deps, actorOf(c), c.req.param("changeId")),
        200,
      );
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
