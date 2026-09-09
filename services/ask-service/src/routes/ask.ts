/**
 * `/v1/ask` — threads, the streamed message turn, reviews, confirmations,
 * executions and handoff (contracts/openapi/ask.yaml).
 *
 * The message endpoint streams `AskEvent`s as server-sent events. The turn is
 * computed and persisted first (one audited transaction), then replayed onto the
 * stream, so a failure surfaces as a normal typed error before any event is sent
 * rather than as a half-written stream.
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import {
  actorOf,
  cityOf,
  correlationIdOf,
  failure,
  gatewayAuth,
  idempotencyKeyOf,
} from "../middleware";
import { parseBody, parseOptionalBody } from "./parse";
import { redis } from "../lib/redis";
import {
  confirmReview,
  getReview,
  ReviewExpiredError,
  TermsChangedError,
} from "../ops/reviews";
import { getExecution } from "../ops/executions";
import { handleMessage, handoff, openThread } from "../ops/threads";

import type { AskDeps } from "../ops/context";

const OpenThreadBody = z
  .object({
    source: z
      .enum(["home", "web", "deeplink", "driver_account"])
      .default("home"),
    context: z
      .object({
        tripId: z.string().max(64).optional(),
        orderId: z.string().max(64).optional(),
      })
      .optional(),
  })
  .strip();

const MessageBody = z
  .object({
    text: z.string().min(1).max(2000),
    clarifications: z.record(z.unknown()).optional(),
  })
  .strip();

const ConfirmBody = z
  .object({
    termsVersion: z.string().min(1).max(200),
    assurance: z
      .object({
        method: z.enum(["pin", "biometric", "none_read_only"]),
        proof: z.string().min(1).max(4000),
      })
      .strict(),
  })
  .strip();

const HandoffBody = z
  .object({ includeTranscript: z.boolean().default(true) })
  .strip();

async function withinRateLimit(
  userId: string,
  perMinute: number,
): Promise<boolean> {
  try {
    const bucket = Math.floor(Date.now() / 60_000);
    const key = `ask:rate:${userId}:${bucket}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, 60);
    }
    return count <= perMinute;
  } catch {
    // Best-effort: a Redis outage must not take the assistant down.
    return true;
  }
}

export function createAskRoutes(deps: AskDeps): Hono {
  const routes = new Hono();
  routes.use("*", gatewayAuth);

  routes.post("/threads", async (c) => {
    try {
      const body = await parseOptionalBody(c, OpenThreadBody);
      const thread = await openThread(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        source: body.source,
        correlationId: correlationIdOf(c),
      });
      return c.json(thread, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/threads/:threadId/messages", async (c) => {
    const actor = actorOf(c);
    let cityId: string;
    let body: z.infer<typeof MessageBody>;
    try {
      cityId = cityOf(c);
      body = await parseBody(c, MessageBody);
    } catch (error) {
      return failure(c, error);
    }

    if (!(await withinRateLimit(actor.id, deps.limits.perUserMessagesPerMinute))) {
      return c.json(
        { code: "rate_limited", message: "too many messages; slow down" },
        429,
      );
    }

    let result;
    try {
      result = await handleMessage(deps, {
        actor,
        cityId,
        threadId: c.req.param("threadId"),
        text: body.text,
        clarifications: body.clarifications ?? null,
        correlationId: correlationIdOf(c),
      });
    } catch (error) {
      return failure(c, error);
    }

    return streamSSE(c, async (stream) => {
      for (const event of result.events) {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        });
      }
    });
  });

  routes.get("/reviews/:reviewId", async (c) => {
    try {
      const review = await getReview(deps, actorOf(c), c.req.param("reviewId"));
      return c.json(review, 200);
    } catch (error) {
      if (error instanceof ReviewExpiredError) {
        return c.json(error.toBody(), 410);
      }
      return failure(c, error);
    }
  });

  routes.post("/reviews/:reviewId/confirm", async (c) => {
    try {
      const body = await parseBody(c, ConfirmBody);
      const result = await confirmReview(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        reviewId: c.req.param("reviewId"),
        termsVersion: body.termsVersion,
        assurance: body.assurance,
        idempotencyKey: idempotencyKeyOf(c),
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 202);
    } catch (error) {
      if (error instanceof TermsChangedError) {
        // A fresh review to confirm — the stale terms are never charged.
        return c.json(error.review, 409);
      }
      if (error instanceof ReviewExpiredError) {
        return c.json(error.toBody(), 410);
      }
      return failure(c, error);
    }
  });

  routes.get("/executions/:executionId", async (c) => {
    try {
      const execution = await getExecution(
        deps,
        actorOf(c),
        c.req.param("executionId"),
      );
      return c.json(execution, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/threads/:threadId/handoff", async (c) => {
    try {
      const body = await parseOptionalBody(c, HandoffBody);
      const result = await handoff(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        threadId: c.req.param("threadId"),
        includeTranscript: body.includeTranscript,
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
