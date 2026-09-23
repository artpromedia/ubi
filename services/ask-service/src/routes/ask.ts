/**
 * `/v1/ask` — threads, the streamed message turn, reviews, confirmations,
 * executions and handoff (contracts/openapi/ask.yaml), and the AI marketplace
 * stages (`/v1/ask/mp/*`, ops/mp-lifecycle.ts):
 *
 *   POST /mp/quotes                        quote (read, non-binding)
 *   POST /mp/reviews                       a structured publish / select review
 *   POST /reviews/:id/confirm              the explicit approval (PIN) → execute
 *   GET  /executions/:id                   per-order status + persisted intent
 *   POST /executions/:id/reconcile         settle an ambiguous outcome
 *   POST /mp/requests/:id/cancel           cancel a request the assistant published
 *
 * Reached through the API gateway's `/v1/ask/*` proxy, which verifies the
 * caller and signs the identity context this service verifies
 * (middleware/auth.ts). The marketplace routes additionally require the
 * gateway's marketplace scope, which limited mode strips.
 *
 * The message endpoint streams `AskEvent`s as server-sent events. The turn is
 * computed and persisted first (one audited transaction), then replayed onto the
 * stream, so a failure surfaces as a normal typed error before any event is sent
 * rather than as a half-written stream.
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import { CurrencySchema } from "@ubi/contracts";

import {
  actorOf,
  assertMarketplaceAllowed,
  cityOf,
  correlationIdOf,
  failure,
  gatewayAuth,
  idempotencyKeyOf,
  marketplaceAllowed,
} from "../middleware";
import { parseBody, parseOptionalBody } from "./parse";
import { redis } from "../lib/redis";
import { getExecution } from "../ops/executions";
import {
  cancelMarketplaceRequest,
  createMarketplaceReview,
  quoteForAsk,
  reconcileMarketplaceExecution,
} from "../ops/mp-lifecycle";
import {
  confirmReview,
  getReview,
  ReviewExpiredError,
  TermsChangedError,
} from "../ops/reviews";
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

const AssuranceBody = z
  .object({
    method: z.enum(["pin", "biometric"]),
    proof: z.string().min(1).max(4000),
  })
  .strict();

const ConfirmBody = z
  .object({
    termsVersion: z.string().min(1).max(200),
    assurance: z
      .object({
        method: z.enum(["pin", "biometric", "none_read_only"]),
        proof: z.string().min(1).max(4000),
      })
      .strict(),
    /** Marketplace: the persisted scope/revision the client rendered. */
    expect: z
      .object({
        scopeFingerprint: z.string().min(1).max(80).optional(),
        requestRevision: z.number().int().min(0).optional(),
        bidId: z.string().min(1).max(64).optional(),
      })
      .strict()
      .optional(),
  })
  .strip();

const Coordinate = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .strict();

const QuoteBody = z
  .object({
    service: z.enum(["ride", "delivery"]),
    vehicleClass: z.string().min(1).max(40),
    pickup: Coordinate,
    dropoff: Coordinate,
    weightKg: z.number().positive().max(1000).optional(),
  })
  .strict();

const MarketplaceReviewBody = z.discriminatedUnion("stage", [
  z
    .object({
      stage: z.literal("select"),
      threadId: z.string().min(1).max(64),
      requestId: z.string().min(1).max(64),
      bidId: z.string().min(1).max(64),
    })
    .strict(),
  z
    .object({
      stage: z.literal("publish"),
      threadId: z.string().min(1).max(64),
      quote: QuoteBody,
      // The user's fare, as Money; absent means the server's suggested fare.
      requestedFare: z
        .object({
          amountMinor: z.number().int().positive().safe(),
          currency: CurrencySchema,
        })
        .strict()
        .optional(),
      paymentMethodId: z.string().min(1).max(64),
    })
    .strict(),
]);

const CancelBody = z.object({ assurance: AssuranceBody }).strict();

function quoteInput(body: z.infer<typeof QuoteBody>) {
  return {
    service: body.service,
    vehicleClass: body.vehicleClass,
    pickupLat: body.pickup.lat,
    pickupLng: body.pickup.lng,
    dropoffLat: body.dropoff.lat,
    dropoffLng: body.dropoff.lng,
    ...(body.weightKg === undefined ? {} : { weightKg: body.weightKg }),
  };
}

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

    if (
      !(await withinRateLimit(actor.id, deps.limits.perUserMessagesPerMinute))
    ) {
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
        marketplaceAllowed: marketplaceAllowed(c),
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
        expect: body.expect,
        assurance: body.assurance,
        idempotencyKey: idempotencyKeyOf(c),
        correlationId: correlationIdOf(c),
        marketplaceAllowed: marketplaceAllowed(c),
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

  // Settles an ambiguous marketplace outcome under the SAME grant and intent;
  // a settled (or travel) execution is returned unchanged. Idempotent.
  routes.post("/executions/:executionId/reconcile", async (c) => {
    try {
      idempotencyKeyOf(c);
      const actor = actorOf(c);
      const executionId = c.req.param("executionId");
      await reconcileMarketplaceExecution(deps, {
        actor,
        cityId: cityOf(c),
        executionId,
        correlationId: correlationIdOf(c),
        marketplaceAllowed: marketplaceAllowed(c),
      });
      return c.json(await getExecution(deps, actor, executionId), 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  // ---- AI marketplace stages (flag- and scope-gated, deny by default) ----

  routes.post("/mp/quotes", async (c) => {
    try {
      assertMarketplaceAllowed(c);
      const body = await parseBody(c, QuoteBody);
      const quote = await quoteForAsk(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        input: quoteInput(body),
      });
      return c.json(quote, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/mp/reviews", async (c) => {
    try {
      assertMarketplaceAllowed(c);
      const body = await parseBody(c, MarketplaceReviewBody);
      const review = await createMarketplaceReview(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        threadId: body.threadId,
        request:
          body.stage === "select"
            ? {
                stage: "select",
                requestId: body.requestId,
                bidId: body.bidId,
              }
            : {
                stage: "publish",
                quote: quoteInput(body.quote),
                requestedFare: body.requestedFare ?? null,
                paymentMethodId: body.paymentMethodId,
              },
        idempotencyKey: idempotencyKeyOf(c),
        correlationId: correlationIdOf(c),
      });
      return c.json(review, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/mp/requests/:requestId/cancel", async (c) => {
    try {
      assertMarketplaceAllowed(c);
      const body = await parseBody(c, CancelBody);
      const result = await cancelMarketplaceRequest(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        requestId: c.req.param("requestId"),
        assurance: body.assurance,
        idempotencyKey: idempotencyKeyOf(c),
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 200);
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
