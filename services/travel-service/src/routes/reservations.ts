/**
 * `/v1/reservations` — linked airport rides (contracts/openapi/travel-v2.yaml).
 *
 * The ride is a separate order from the flight, so this lives on its own path
 * and returns its own status and compensation policy.
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
import { parseBody } from "./parse";
import { createReservation } from "../ops/reservations";

import type { TravelDeps } from "../ops/context";

const ReservationBody = z.object({
  linkedOrderId: z.string().min(1),
  pickupAt: z.string(),
  classId: z.string().min(1),
  direction: z.enum(["to_airport", "from_airport"]).optional(),
});

export function createReservationRoutes(deps: TravelDeps): Hono {
  const routes = new Hono();
  routes.use("*", gatewayAuth);

  routes.post("/", async (c) => {
    try {
      const body = await parseBody(c, ReservationBody);
      const result = await createReservation(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        linkedOrderId: body.linkedOrderId,
        pickupAt: body.pickupAt,
        classId: body.classId,
        direction: body.direction ?? "to_airport",
        idempotencyKey: idempotencyKeyOf(c),
        correlationId: correlationIdOf(c),
      });
      return c.json(result, result.status === "reserved" ? 201 : 202);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
