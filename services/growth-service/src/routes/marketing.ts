/**
 * `/v1/ai/marketing` — the marketing assistant (contracts/openapi/growth-ops.yaml).
 * The assistant returns DRAFT proposals only; activation, sending and budget
 * changes are not reachable from here (CLAUDE.md #22).
 */
import { Hono } from "hono";
import { z } from "zod";

import { proposeMessage } from "../ops/marketing";
import {
  actorOf,
  correlationIdOf,
  failure,
  gatewayAuth,
  optionalCityOf,
} from "../middleware";
import { parseBody } from "./parse";

import type { GrowthDeps } from "../ops/context";

const MessageBody = z.object({ text: z.string().min(1).max(4000) });

export function createMarketingRoutes(deps: GrowthDeps): Hono {
  const routes = new Hono();
  routes.use("*", gatewayAuth);

  routes.post("/threads/:threadId/messages", async (c) => {
    try {
      const body = await parseBody(c, MessageBody);
      const result = await proposeMessage(deps, {
        actor: actorOf(c),
        cityId: optionalCityOf(c),
        threadId: c.req.param("threadId"),
        text: body.text,
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
