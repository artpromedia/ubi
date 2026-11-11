/**
 * UBI Ops review routes for Fleet KYB and Vehicle Documents — `/v1/admin/…`
 * (gateway: `/v1/admin/fleets*`, `/v1/admin/fleet-documents*`, CC-C02 / P1-05).
 */
import { Hono, type Context } from "hono";
import { z } from "zod";

import { ContractError } from "@ubi/contracts";

import {
  DocumentDownloadUrlViewSchema,
  FLEET_KYB_STATUSES,
  FleetAdminDocumentListSchema,
  FleetAdminKybListSchema,
  FleetKybApplicationViewSchema,
  ReviewFleetKybSchema,
  ReviewVehicleDocumentSchema,
  VEHICLE_DOCUMENT_REVIEW_STATUSES,
  VehicleDocumentViewSchema,
} from "../contract";
import { idempotentResponse, jsonBody, respond, route, shape } from "./respond";
import { actorOf, cityOf, gatewayAuth } from "../middleware/auth";
import { fleetFlagGate } from "../middleware/fleet-flag";
import {
  getAdminKybDocumentUrl,
  listAdminKybApplications,
  reviewFleetKyb,
} from "../ops/kyb";
import {
  getAdminVehicleDocumentUrl,
  listAdminVehicleDocuments,
  reviewVehicleDocument,
} from "../ops/vehicle-documents";

import type { FleetDeps } from "../ops/context";

const ADMIN_READ_ROLES: ReadonlySet<string> = new Set([
  "ops",
  "ops_admin",
  "support_ops",
  "finance_ops",
  "admin",
  "super_admin",
]);

const ADMIN_WRITE_ROLES: ReadonlySet<string> = new Set([
  "ops",
  "ops_admin",
  "admin",
  "super_admin",
]);

function requireOpsRole(c: Context, write: boolean): void {
  const actor = actorOf(c);
  const allowed = write ? ADMIN_WRITE_ROLES : ADMIN_READ_ROLES;
  if (!allowed.has(actor.role)) {
    throw new ContractError(
      "forbidden",
      "UBI operations access is required for this route",
      { role: actor.role },
    );
  }
}

const KybQuerySchema = z
  .object({
    status: z.enum(FLEET_KYB_STATUSES).optional(),
    cityId: z.string().min(1).optional(),
  })
  .strict();

const DocumentQuerySchema = z
  .object({
    status: z.enum(VEHICLE_DOCUMENT_REVIEW_STATUSES).optional(),
    cityId: z.string().min(1).optional(),
  })
  .strict();

export function createFleetAdminRoutes(deps: FleetDeps): Hono {
  const routes = new Hono();
  routes.use("*", gatewayAuth);
  routes.use("*", fleetFlagGate(deps));

  routes.get(
    "/fleets/kyb",
    route(async (c) => {
      requireOpsRole(c, false);
      const query = KybQuerySchema.parse(c.req.query());
      return respond(
        c,
        FleetAdminKybListSchema,
        await listAdminKybApplications(
          deps,
          query.cityId ?? cityOf(c),
          query.status,
        ),
      );
    }),
  );

  routes.get(
    "/fleets/:id/kyb/documents/:docId/url",
    route(async (c) => {
      requireOpsRole(c, false);
      return respond(
        c,
        DocumentDownloadUrlViewSchema,
        await getAdminKybDocumentUrl(
          deps,
          actorOf(c),
          cityOf(c),
          c.req.param("id"),
          c.req.param("docId"),
        ),
      );
    }),
  );

  routes.post(
    "/fleets/:id/kyb/review",
    route(async (c) => {
      requireOpsRole(c, true);
      const fleetId = c.req.param("id");
      const actor = actorOf(c);
      const cityId = cityOf(c);
      const body = ReviewFleetKybSchema.parse(await jsonBody(c));
      return idempotentResponse(
        c,
        deps,
        `fleet.kyb.review:${fleetId}`,
        body,
        async () => ({
          status: 200,
          body: shape(
            FleetKybApplicationViewSchema,
            await reviewFleetKyb(deps, actor, cityId, fleetId, body),
          ),
        }),
      );
    }),
  );

  routes.get(
    "/fleet-documents",
    route(async (c) => {
      requireOpsRole(c, false);
      const query = DocumentQuerySchema.parse(c.req.query());
      return respond(
        c,
        FleetAdminDocumentListSchema,
        await listAdminVehicleDocuments(
          deps,
          query.cityId ?? cityOf(c),
          query.status,
        ),
      );
    }),
  );

  routes.get(
    "/fleet-documents/:id/url",
    route(async (c) => {
      requireOpsRole(c, false);
      return respond(
        c,
        DocumentDownloadUrlViewSchema,
        await getAdminVehicleDocumentUrl(
          deps,
          actorOf(c),
          cityOf(c),
          c.req.param("id"),
        ),
      );
    }),
  );

  routes.post(
    "/fleet-documents/:id/review",
    route(async (c) => {
      requireOpsRole(c, true);
      const documentId = c.req.param("id");
      const actor = actorOf(c);
      const cityId = cityOf(c);
      const body = ReviewVehicleDocumentSchema.parse(await jsonBody(c));
      return idempotentResponse(
        c,
        deps,
        `fleet.vehicle.doc.review:${documentId}`,
        body,
        async () => ({
          status: 200,
          body: shape(
            VehicleDocumentViewSchema,
            await reviewVehicleDocument(deps, actor, cityId, documentId, body),
          ),
        }),
      );
    }),
  );

  return routes;
}
