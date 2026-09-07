/**
 * `/v1/safety` — SOS and the 24/7 responder queue
 * (contracts/openapi/support-config.yaml, /v1/safety/sos).
 *
 * SOS answers 202: the incident is committed before the response is written, and
 * notification delivery continues behind it with retries and an SMS fallback.
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
import { SOS_TRIGGERS } from "../ops/city-config";
import {
  listSafetyCases,
  raiseSos,
  respond,
  RESPONDER_ACTIONS,
} from "../ops/safety";

import type { SupportDeps } from "../ops/context";

const SosBody = z.object({
  trigger: z.enum(SOS_TRIGGERS),
  rideId: z.string().min(1).max(64).optional(),
  location: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracyMeters: z.number().nonnegative().optional(),
      at: z.string().datetime({ offset: true }).optional(),
    })
    .optional(),
  note: z.string().max(500).optional(),
});

const ActionBody = z.object({
  action: z.enum(RESPONDER_ACTIONS),
  note: z.string().max(500).optional(),
});

export function createSafetyRoutes(deps: SupportDeps): Hono {
  const routes = new Hono();
  routes.use("*", gatewayAuth);

  routes.post("/sos", async (c) => {
    try {
      const body = await parseBody(c, SosBody);
      const result = await raiseSos(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        trigger: body.trigger,
        rideId: body.rideId ?? null,
        location:
          body.location === undefined
            ? null
            : {
                lat: body.location.lat,
                lng: body.location.lng,
                accuracyMeters: body.location.accuracyMeters ?? null,
                at: body.location.at ?? null,
              },
        note: body.note ?? null,
        idempotencyKey: idempotencyKeyOf(c),
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 202);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/cases", async (c) => {
    try {
      const result = await listSafetyCases(deps, actorOf(c), {
        status: c.req.query("status"),
        severity: c.req.query("severity"),
        limit: parseLimit(c.req.query("limit"), 50, 200),
      });
      return c.json({ cases: result }, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/cases/:id/actions", async (c) => {
    try {
      const body = await parseBody(c, ActionBody);
      const result = await respond(deps, {
        actor: actorOf(c),
        caseId: c.req.param("id"),
        action: body.action,
        note: body.note ?? null,
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
