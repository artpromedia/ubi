/**
 * `/v1/ops/ai` — the AI action log and model metrics for operators
 * (contracts/openapi/growth-ops.yaml). Admin-only; every read is audited into
 * `ai_action_access_log` by the ops functions.
 */
import { Hono } from "hono";

import { actorOf, adminAuth, failure } from "../middleware";
import { getMetrics, listActions } from "../ops/ai-log";

import type { AskDeps } from "../ops/context";

function parseSince(raw: string | undefined): Date | null {
  if (raw === undefined || raw.length === 0) {
    return null;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function createOpsAiRoutes(deps: AskDeps): Hono {
  const routes = new Hono();
  routes.use("*", adminAuth);

  routes.get("/actions", async (c) => {
    try {
      const since = parseSince(c.req.query("since"));
      const limitRaw = Number.parseInt(c.req.query("limit") ?? "100", 10);
      const limit =
        Number.isInteger(limitRaw) && limitRaw > 0
          ? Math.min(limitRaw, 500)
          : 100;
      const actions = await listActions(deps, actorOf(c), { since, limit });
      return c.json({ actions }, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/metrics", async (c) => {
    try {
      const sinceDay = parseSince(c.req.query("since"));
      const metrics = await getMetrics(deps, actorOf(c), { sinceDay });
      return c.json(metrics, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
