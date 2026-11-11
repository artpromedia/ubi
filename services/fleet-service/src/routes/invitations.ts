/**
 * Signed-in invitee routes — `/v1/fleet-invitations…` (gateway:
 * `/v1/fleet-invitations*`, CC-C02 / P1-05).
 */
import { Hono } from "hono";

import {
  FleetInvitationListSchema,
  FleetInvitationViewSchema,
} from "../contract";
import { idempotentResponse, respond, route, shape } from "./respond";
import { actorOf, cityOf, gatewayAuth } from "../middleware/auth";
import { fleetFlagGate } from "../middleware/fleet-flag";
import { listMyInvitations, respondToInvitation } from "../ops/invitations";

import type { FleetDeps } from "../ops/context";

export function createFleetInvitationRoutes(deps: FleetDeps): Hono {
  const routes = new Hono();
  routes.use("*", gatewayAuth);
  routes.use("*", fleetFlagGate(deps));

  routes.get(
    "/",
    route(async (c) =>
      respond(
        c,
        FleetInvitationListSchema,
        await listMyInvitations(deps, actorOf(c), cityOf(c)),
      ),
    ),
  );

  routes.post(
    "/:id/accept",
    route(async (c) => {
      const invitationId = c.req.param("id");
      const actor = actorOf(c);
      const cityId = cityOf(c);
      return idempotentResponse(
        c,
        deps,
        `fleet.invitation.accept:${invitationId}`,
        { invitationId, decision: "accepted" },
        async () => ({
          status: 200,
          body: shape(
            FleetInvitationViewSchema,
            await respondToInvitation(
              deps,
              actor,
              cityId,
              invitationId,
              "accepted",
            ),
          ),
        }),
      );
    }),
  );

  routes.post(
    "/:id/decline",
    route(async (c) => {
      const invitationId = c.req.param("id");
      const actor = actorOf(c);
      const cityId = cityOf(c);
      return idempotentResponse(
        c,
        deps,
        `fleet.invitation.decline:${invitationId}`,
        { invitationId, decision: "declined" },
        async () => ({
          status: 200,
          body: shape(
            FleetInvitationViewSchema,
            await respondToInvitation(
              deps,
              actor,
              cityId,
              invitationId,
              "declined",
            ),
          ),
        }),
      );
    }),
  );

  return routes;
}
