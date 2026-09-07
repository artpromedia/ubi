/**
 * `/v1/reviews/{queue}` — the review queues
 * (contracts/openapi/support-config.yaml, reviews section).
 *
 * The queue name is validated against the closed set in the contract, so an
 * unknown queue is a 404 rather than an empty list that looks like "nothing to
 * review".
 */
import { Hono } from "hono";
import { z } from "zod";

import { ContractError } from "@ubi/contracts";

import {
  actorOf,
  cityOf,
  correlationIdOf,
  failure,
  gatewayAuth,
  idempotencyKeyOf,
} from "../middleware";
import { parseBody, parseLimit } from "./parse";
import {
  decide,
  isReviewQueue,
  listQueue,
  REVIEW_DECISIONS,
  type ReviewQueue,
} from "../ops/reviews";

import type { SupportDeps } from "../ops/context";

const DecisionBody = z.object({
  subjectType: z.string().min(1).max(40),
  subjectId: z.string().min(1).max(64),
  decision: z.enum(REVIEW_DECISIONS),
  note: z.string().min(1).max(1000),
});

function queueOf(raw: string): ReviewQueue {
  if (!isReviewQueue(raw)) {
    throw new ContractError("not_found", "no such review queue", { queue: raw });
  }
  return raw;
}

export function createReviewRoutes(deps: SupportDeps): Hono {
  const routes = new Hono();
  routes.use("*", gatewayAuth);

  routes.get("/:queue", async (c) => {
    try {
      const result = await listQueue(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        queue: queueOf(c.req.param("queue")),
        limit: parseLimit(c.req.query("limit"), 50, 200),
      });
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/:queue/decisions", async (c) => {
    try {
      const body = await parseBody(c, DecisionBody);
      const result = await decide(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        queue: queueOf(c.req.param("queue")),
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        decision: body.decision,
        note: body.note,
        idempotencyKey: idempotencyKeyOf(c),
        correlationId: correlationIdOf(c),
      });
      // A decision waiting on its second reviewer is accepted, not created.
      return c.json(result, result.status === "complete" ? 201 : 202);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
