/**
 * The driver's side of the fleet — `/v1/fleet-offers/…` and
 * `/v1/drivers/me/{fleet-offers, fleet, schedule, availability, conflicts}`.
 *
 * The caller is always the driver the gateway signed for: an offer, an
 * arrangement or a conflict that is not theirs is `not_found`. Signing
 * relays the driver's own verified context to user-service's PIN check
 * (ports/pin-port.ts); the PIN is never stored, logged, hashed into the
 * idempotency record or echoed. Declining takes no reason at all.
 */
import { Hono, type Context } from "hono";
import { z } from "zod";

import {
  AvailabilityPreviewSchema,
  AvailabilityPreviewViewSchema,
  AvailabilitySavedViewSchema,
  DeclineOfferViewSchema,
  DriverArrangementListSchema,
  DriverConflictViewSchema,
  DriverOfferListSchema,
  DriverScheduleSchema,
  DriverTerminationViewSchema,
  PutAvailabilitySchema,
  SignOfferSchema,
  SignOfferViewSchema,
} from "../contract";
import { idempotentResponse, jsonBody, respond, route, shape } from "./respond";
import { actorOf, cityOf, gatewayAuth } from "../middleware/auth";
import { fleetFlagGate } from "../middleware/fleet-flag";
import {
  declineOffer,
  driverArrangements,
  driverOffers,
  signOffer,
  terminateByDriver,
} from "../ops/assignments";
import { previewAvailability, putAvailability } from "../ops/availability";
import { driverConflict, driverSchedule } from "../ops/driver";

import type { FleetDeps } from "../ops/context";
import type { Actor } from "../ops/types";

/** The caller, acting as a driver (the envelope records `driver`). */
function driverOf(c: Context): Actor {
  return { ...actorOf(c), as: "driver" };
}

const RangeQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export function createFleetOfferRoutes(deps: FleetDeps): Hono {
  const routes = new Hono();
  routes.use("*", gatewayAuth);
  routes.use("*", fleetFlagGate(deps));

  routes.post(
    "/:offerId/sign",
    route(async (c) => {
      const { pin } = SignOfferSchema.parse(await jsonBody(c));
      const offerId = c.req.param("offerId");
      const actor = driverOf(c);
      const cityId = cityOf(c);
      // The replay payload is the offer id ONLY — never the PIN.
      return idempotentResponse(
        c,
        deps,
        `fleet.offer.sign:${offerId}`,
        { offerId },
        async () => ({
          status: 200,
          body: shape(
            SignOfferViewSchema,
            await signOffer(deps, actor, cityId, offerId, pin),
          ),
        }),
      );
    }),
  );

  routes.post(
    "/:offerId/decline",
    route(async (c) => {
      const offerId = c.req.param("offerId");
      const actor = driverOf(c);
      const cityId = cityOf(c);
      const response = await idempotentResponse(
        c,
        deps,
        `fleet.offer.decline:${offerId}`,
        { offerId },
        async () => ({
          status: 200,
          body: shape(
            DeclineOfferViewSchema,
            await declineOffer(deps, actor, cityId, offerId),
          ),
        }),
      );
      return response;
    }),
  );

  return routes;
}

export function createDriverFleetRoutes(deps: FleetDeps): Hono {
  const routes = new Hono();
  routes.use("*", gatewayAuth);
  routes.use("*", fleetFlagGate(deps));

  routes.get(
    "/fleet-offers",
    route(async (c) =>
      respond(
        c,
        DriverOfferListSchema,
        await driverOffers(deps, driverOf(c), cityOf(c)),
      ),
    ),
  );

  routes.get(
    "/fleet",
    route(async (c) =>
      respond(
        c,
        DriverArrangementListSchema,
        await driverArrangements(deps, driverOf(c), cityOf(c)),
      ),
    ),
  );

  routes.post(
    "/fleet/terminate",
    route(async (c) => {
      const body = z
        .object({ assignmentId: z.string().min(1) })
        .strict()
        .parse(await jsonBody(c));
      const actor = driverOf(c);
      const cityId = cityOf(c);
      return idempotentResponse(
        c,
        deps,
        "fleet.driver.terminate",
        body,
        async () => ({
          status: 200,
          body: shape(
            DriverTerminationViewSchema,
            await terminateByDriver(deps, actor, cityId, body.assignmentId),
          ),
        }),
      );
    }),
  );

  routes.get(
    "/schedule",
    route(async (c) => {
      const query = RangeQuerySchema.parse(c.req.query());
      return respond(
        c,
        DriverScheduleSchema,
        await driverSchedule(deps, driverOf(c), cityOf(c), query),
      );
    }),
  );

  // A read: what the change WOULD do. No state changes, so no key.
  routes.post(
    "/availability:preview",
    route(async (c) => {
      const body = AvailabilityPreviewSchema.parse(await jsonBody(c));
      return respond(
        c,
        AvailabilityPreviewViewSchema,
        await previewAvailability(deps, driverOf(c), cityOf(c), body.windows),
      );
    }),
  );

  routes.put(
    "/availability",
    route(async (c) => {
      const body = PutAvailabilitySchema.parse(await jsonBody(c));
      const actor = driverOf(c);
      const cityId = cityOf(c);
      return idempotentResponse(
        c,
        deps,
        "fleet.availability.put",
        body,
        async () => ({
          status: 200,
          body: shape(
            AvailabilitySavedViewSchema,
            await putAvailability(deps, actor, cityId, body),
          ),
        }),
      );
    }),
  );

  routes.get(
    "/conflicts/:conflictId",
    route(async (c) =>
      respond(
        c,
        DriverConflictViewSchema,
        await driverConflict(
          deps,
          driverOf(c),
          cityOf(c),
          c.req.param("conflictId"),
        ),
      ),
    ),
  );

  return routes;
}
