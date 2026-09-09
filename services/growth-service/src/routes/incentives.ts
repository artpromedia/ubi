/**
 * `/v1/driver` — driver commission incentives and statements
 * (contracts/openapi/incentives.yaml). Gated by `driver_commission_rebates`.
 * All amounts are ledger-derived; nothing is computed on the client.
 */
import { Hono } from "hono";

import { assertFlagEnabled } from "../ops/config";
import {
  getIncentivesOverview,
  getRebateDetail,
  getStatement,
} from "../ops/incentives";
import { actorOf, cityOf, failure, gatewayAuth } from "../middleware";

import type { GrowthDeps } from "../ops/context";

export function createIncentiveRoutes(deps: GrowthDeps): Hono {
  const routes = new Hono();
  routes.use("*", gatewayAuth);

  routes.get("/incentives", async (c) => {
    try {
      assertFlagEnabled(
        await deps.flags.flagsFor(cityOf(c)),
        "driver_commission_rebates",
      );
      return c.json(await getIncentivesOverview(deps, actorOf(c)), 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/incentives/:id", async (c) => {
    try {
      assertFlagEnabled(
        await deps.flags.flagsFor(cityOf(c)),
        "driver_commission_rebates",
      );
      return c.json(
        await getRebateDetail(deps, actorOf(c), c.req.param("id")),
        200,
      );
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/statements/:periodId", async (c) => {
    try {
      assertFlagEnabled(
        await deps.flags.flagsFor(cityOf(c)),
        "driver_commission_rebates",
      );
      return c.json(
        await getStatement(deps, actorOf(c), c.req.param("periodId")),
        200,
      );
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
