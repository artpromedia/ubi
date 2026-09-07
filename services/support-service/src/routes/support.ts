/**
 * `/v1/support` — support cases and typed remedies
 * (contracts/openapi/support-config.yaml, support section).
 *
 * The remedy body's `type` is a zod enum over the five remedies the contract
 * names, so an arbitrary type never reaches the handler: it is refused with 422
 * and the failing path.
 */
import { Hono } from "hono";
import { z } from "zod";

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
  addMessage,
  getCase,
  listCases,
  openCase,
  postRemedy,
  transitionCase,
} from "../ops/cases";
import { REMEDY_TYPES, SUPPORT_CATEGORIES } from "../ops/city-config";

import type { SupportDeps } from "../ops/context";

const SubjectSchema = z.object({
  type: z.string().min(1).max(40),
  id: z.string().min(1).max(64),
});

const OpenCaseBody = z.object({
  category: z.enum(SUPPORT_CATEGORIES),
  description: z.string().min(1).max(2000),
  subject: SubjectSchema.optional(),
  /** Ops opening a case for a customer; refused unless the role allows it. */
  onBehalfOf: z
    .object({
      userType: z.string().min(1).max(20),
      userId: z.string().min(1).max(64),
    })
    .optional(),
});

const MessageBody = z.object({ body: z.string().min(1).max(4000) });

const StatusBody = z.object({
  to: z.string().min(1).max(40),
  reason: z.string().min(1).max(280),
});

const RemedyBody = z.object({
  // The closed set from the contract. Nothing else is a remedy.
  type: z.enum(REMEDY_TYPES),
  amountMinor: z.number().int().optional(),
  reason: z.string().min(1).max(280),
});

export function createSupportRoutes(deps: SupportDeps): Hono {
  const routes = new Hono();
  routes.use("*", gatewayAuth);

  routes.post("/cases", async (c) => {
    try {
      const body = await parseBody(c, OpenCaseBody);
      const result = await openCase(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        category: body.category,
        description: body.description,
        subject: body.subject ?? null,
        onBehalfOf: body.onBehalfOf ?? null,
        idempotencyKey: idempotencyKeyOf(c),
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/cases", async (c) => {
    try {
      const subjectType = c.req.query("subjectType");
      const subjectId = c.req.query("subjectId");
      const result = await listCases(deps, actorOf(c), {
        status: c.req.query("status"),
        subject:
          subjectType === undefined || subjectId === undefined
            ? undefined
            : { type: subjectType, id: subjectId },
        overdueOnly: c.req.query("overdue") === "true",
        limit: parseLimit(c.req.query("limit"), 50, 200),
      });
      return c.json({ cases: result }, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/cases/:id", async (c) => {
    try {
      return c.json(await getCase(deps, actorOf(c), c.req.param("id")), 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/cases/:id/messages", async (c) => {
    try {
      const body = await parseBody(c, MessageBody);
      const result = await addMessage(deps, {
        actor: actorOf(c),
        caseId: c.req.param("id"),
        body: body.body,
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/cases/:id/status", async (c) => {
    try {
      const body = await parseBody(c, StatusBody);
      const result = await transitionCase(deps, {
        actor: actorOf(c),
        caseId: c.req.param("id"),
        to: body.to,
        reason: body.reason,
        cityId: cityOf(c),
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/cases/:id/remedies", async (c) => {
    try {
      const body = await parseBody(c, RemedyBody);
      const result = await postRemedy(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        caseId: c.req.param("id"),
        type: body.type,
        amountMinor: body.amountMinor ?? null,
        reason: body.reason,
        idempotencyKey: idempotencyKeyOf(c),
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
