/**
 * The fleet portal API — `/v1/fleets…` (gateway: `/v1/fleets/*`).
 *
 * Every route: the gateway-signed identity (middleware/auth.ts), the
 * deny-by-default `fleet` flag for the caller's verified city (404
 * `feature_disabled` when off), ACTIVE staff of the fleet (a non-member gets
 * `not_found`), the role's capability, an Idempotency-Key on every
 * state-changing call, and a response parsed through its contract schema.
 */
import { Hono, type Context } from "hono";
import { z } from "zod";

import { ContractError } from "@ubi/contracts";

import {
  AddFleetVehicleSchema,
  ConfirmMaintenanceSchema,
  ConflictListSchema,
  CONFLICT_STATUSES,
  CreateFleetSchema,
  CreateMaintenanceSchema,
  FleetAssignmentsSchema,
  FleetCalendarSchema,
  FleetListSchema,
  FleetOverviewSchema,
  FleetStaffListSchema,
  FleetVehicleListSchema,
  FleetVehicleViewSchema,
  FleetViewSchema,
  MaintenanceBlockViewSchema,
  MaintenanceListSchema,
  MaintenancePreviewViewSchema,
  MaintenanceWindowSchema,
  NeedsResolutionDetailsSchema,
  OffRoadViewSchema,
  PatchMaintenanceSchema,
  ProposalViewSchema,
  ProposeAssignmentSchema,
  PutFleetStaffSchema,
  ReminderViewSchema,
  ReportOffRoadSchema,
  RequestVehicleSwapSchema,
  TerminationViewSchema,
  UtilisationSchema,
  VehicleSwapRequestViewSchema,
  VEHICLE_AVAILABILITY_STATES,
  type FleetCapability,
} from "../contract";
import { idempotentResponse, jsonBody, respond, route, shape } from "./respond";
import { actorOf, cityOf, gatewayAuth } from "../middleware/auth";
import { fleetFlagGate } from "../middleware/fleet-flag";
import {
  listFleetAssignments,
  proposeAssignment,
  terminateByFleet,
  withdrawProposal,
} from "../ops/assignments";
import {
  CALENDAR_LAYERS,
  fleetCalendar,
  overview,
  utilisation,
  type CalendarLayer,
} from "../ops/calendar";
import { listFleetConflicts } from "../ops/conflicts";
import { FleetError } from "../ops/errors";
import { createFleet, listMyFleets, listStaff, putStaff } from "../ops/fleets";
import {
  cancelMaintenance,
  completeMaintenance,
  confirmMaintenance,
  createMaintenance,
  listMaintenance,
  patchMaintenance,
  previewMaintenance,
  reportOffRoad,
  type MaintenanceOutcome,
} from "../ops/maintenance";
import { fleetAccess, type FleetAccess } from "../ops/roles";
import { remindDriver, requestVehicleSwap } from "../ops/swaps";
import { addVehicle, listVehicles, vehicleView } from "../ops/vehicles";
import { fleetView } from "../ops/views";

import type { FleetDeps } from "../ops/context";

const CalendarQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    zoom: z.enum(["day", "week"]).default("day"),
    rows: z.enum(["vehicles", "drivers"]).default("vehicles"),
    layers: z.string().optional(),
    class: z.string().optional(),
    status: z.enum(VEHICLE_AVAILABILITY_STATES).optional(),
    conflictsOnly: z.enum(["true", "false"]).optional(),
    q: z.string().max(40).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(40),
  })
  .strict();

const RangeQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

function layersOf(raw: string | undefined): CalendarLayer[] {
  if (raw === undefined || raw.trim().length === 0) {
    return [...CALENDAR_LAYERS];
  }
  const requested = raw.split(",").map((layer) => layer.trim());
  const unknown = requested.filter(
    (layer) => !(CALENDAR_LAYERS as readonly string[]).includes(layer),
  );
  if (unknown.length > 0) {
    throw new ContractError("validation_failed", "unknown calendar layer", {
      layers: unknown,
    });
  }
  return requested as CalendarLayer[];
}

function maintenanceAnswer(
  outcome: MaintenanceOutcome,
  created: boolean,
): { status: number; body: unknown } {
  if (outcome.kind === "needs_resolution") {
    throw new FleetError(
      "needs_resolution",
      "This block overlaps a confirmed booking. Resolve every overlap before confirming.",
      shape(NeedsResolutionDetailsSchema, {
        block: outcome.view,
        affectedBlocks: outcome.affectedBlocks,
        conflictIds: outcome.conflictIds,
      }),
    );
  }
  return {
    status: created ? 201 : 200,
    body: shape(MaintenanceBlockViewSchema, outcome.view),
  };
}

export function createFleetRoutes(deps: FleetDeps): Hono {
  const routes = new Hono();
  routes.use("*", gatewayAuth);
  routes.use("*", fleetFlagGate(deps));

  async function access(
    c: Context,
    capability: FleetCapability,
  ): Promise<FleetAccess> {
    const granted = await fleetAccess(
      deps,
      actorOf(c),
      cityOf(c),
      c.req.param("id") ?? "",
      capability,
    );
    return granted;
  }

  routes.post(
    "/",
    route(async (c) => {
      const body = CreateFleetSchema.parse(await jsonBody(c));
      const actor = actorOf(c);
      const cityId = cityOf(c);
      return idempotentResponse(
        c,
        deps,
        "fleet.create",
        body,
        async (scopedKey) => ({
          status: 201,
          body: shape(
            FleetViewSchema,
            await createFleet(deps, actor, cityId, body, scopedKey),
          ),
        }),
      );
    }),
  );

  routes.get(
    "/",
    route(async (c) =>
      respond(
        c,
        FleetListSchema,
        await listMyFleets(deps, actorOf(c), cityOf(c)),
      ),
    ),
  );

  routes.get(
    "/:id",
    route(async (c) => {
      const granted = await access(c, "view_calendar");
      return respond(
        c,
        FleetViewSchema,
        fleetView(granted.fleet, granted.role),
      );
    }),
  );

  routes.get(
    "/:id/overview",
    route(async (c) =>
      respond(
        c,
        FleetOverviewSchema,
        await overview(deps, await access(c, "view_calendar")),
      ),
    ),
  );

  routes.get(
    "/:id/staff",
    route(async (c) =>
      respond(
        c,
        FleetStaffListSchema,
        await listStaff(deps, await access(c, "view_calendar")),
      ),
    ),
  );

  routes.put(
    "/:id/staff",
    route(async (c) => {
      const granted = await access(c, "manage_staff");
      const body = PutFleetStaffSchema.parse(await jsonBody(c));
      return idempotentResponse(
        c,
        deps,
        `fleet.staff:${granted.fleet.id}`,
        body,
        async () => ({
          status: 200,
          body: shape(
            FleetStaffListSchema,
            await putStaff(deps, granted, body),
          ),
        }),
      );
    }),
  );

  routes.get(
    "/:id/vehicles",
    route(async (c) =>
      respond(
        c,
        FleetVehicleListSchema,
        await listVehicles(deps, await access(c, "view_calendar")),
      ),
    ),
  );

  routes.post(
    "/:id/vehicles",
    route(async (c) => {
      const granted = await access(c, "manage_vehicles");
      const body = AddFleetVehicleSchema.parse(await jsonBody(c));
      return idempotentResponse(
        c,
        deps,
        `fleet.vehicle.add:${granted.fleet.id}`,
        body,
        async (scopedKey) => ({
          status: 201,
          body: shape(
            FleetVehicleViewSchema,
            await addVehicle(deps, granted, body, scopedKey),
          ),
        }),
      );
    }),
  );

  routes.get(
    "/:id/vehicles/:vehicleId",
    route(async (c) => {
      const granted = await access(c, "view_calendar");
      return respond(
        c,
        FleetVehicleViewSchema,
        await vehicleView(deps, granted, c.req.param("vehicleId")),
      );
    }),
  );

  routes.get(
    "/:id/vehicles/:vehicleId/availability",
    route(async (c) => {
      const granted = await access(c, "view_calendar");
      const query = RangeQuerySchema.parse(c.req.query());
      await vehicleView(deps, granted, c.req.param("vehicleId"));
      const calendar = await fleetCalendar(deps, granted, {
        ...query,
        zoom: "week",
        rows: "vehicles",
        layers: [...CALENDAR_LAYERS],
        conflictsOnly: false,
        limit: 1,
        vehicleId: c.req.param("vehicleId"),
      });
      return respond(c, FleetCalendarSchema, calendar);
    }),
  );

  routes.get(
    "/:id/calendar",
    route(async (c) => {
      const granted = await access(c, "view_calendar");
      const query = CalendarQuerySchema.parse(c.req.query());
      const calendar = await fleetCalendar(deps, granted, {
        from: query.from,
        to: query.to,
        zoom: query.zoom,
        rows: query.rows,
        layers: layersOf(query.layers),
        vehicleClass: query.class,
        status: query.status,
        conflictsOnly: query.conflictsOnly === "true",
        q: query.q,
        cursor: query.cursor,
        limit: query.limit,
      });
      return respond(c, FleetCalendarSchema, calendar);
    }),
  );

  routes.get(
    "/:id/utilisation",
    route(async (c) => {
      const granted = await access(c, "view_calendar");
      const query = RangeQuerySchema.parse(c.req.query());
      return respond(
        c,
        UtilisationSchema,
        await utilisation(deps, granted, query),
      );
    }),
  );

  // ── Maintenance ──────────────────────────────────────────────────────────

  routes.post(
    "/:id/maintenance:preview",
    route(async (c) => {
      const granted = await access(c, "manage_maintenance");
      const body = MaintenanceWindowSchema.parse(await jsonBody(c));
      return respond(
        c,
        MaintenancePreviewViewSchema,
        await previewMaintenance(deps, granted, body),
      );
    }),
  );

  routes.get(
    "/:id/maintenance",
    route(async (c) => {
      const granted = await access(c, "view_calendar");
      const query = z
        .object({
          vehicleId: z.string().optional(),
          status: z.string().optional(),
        })
        .strict()
        .parse(c.req.query());
      return respond(
        c,
        MaintenanceListSchema,
        await listMaintenance(deps, granted, query),
      );
    }),
  );

  routes.post(
    "/:id/maintenance",
    route(async (c) => {
      const granted = await access(c, "manage_maintenance");
      const body = CreateMaintenanceSchema.parse(await jsonBody(c));
      return idempotentResponse(
        c,
        deps,
        `fleet.maintenance.create:${granted.fleet.id}`,
        body,
        async (scopedKey) =>
          maintenanceAnswer(
            await createMaintenance(deps, granted, body, scopedKey),
            true,
          ),
      );
    }),
  );

  routes.patch(
    "/:id/maintenance/:blockId",
    route(async (c) => {
      const granted = await access(c, "manage_maintenance");
      const body = PatchMaintenanceSchema.parse(await jsonBody(c));
      const blockId = c.req.param("blockId");
      return idempotentResponse(
        c,
        deps,
        `fleet.maintenance.patch:${blockId}`,
        body,
        async () =>
          maintenanceAnswer(
            await patchMaintenance(deps, granted, blockId, body),
            false,
          ),
      );
    }),
  );

  routes.post(
    "/:id/maintenance/:blockId/confirm",
    route(async (c) => {
      const granted = await access(c, "manage_maintenance");
      const body = ConfirmMaintenanceSchema.parse(await jsonBody(c));
      const blockId = c.req.param("blockId");
      return idempotentResponse(
        c,
        deps,
        `fleet.maintenance.confirm:${blockId}`,
        body,
        async () =>
          maintenanceAnswer(
            await confirmMaintenance(deps, granted, blockId, body.previewToken),
            false,
          ),
      );
    }),
  );

  routes.post(
    "/:id/maintenance/:blockId/cancel",
    route(async (c) => {
      const granted = await access(c, "manage_maintenance");
      const blockId = c.req.param("blockId");
      return idempotentResponse(
        c,
        deps,
        `fleet.maintenance.cancel:${blockId}`,
        { blockId },
        async () => ({
          status: 200,
          body: shape(
            MaintenanceBlockViewSchema,
            await cancelMaintenance(deps, granted, blockId),
          ),
        }),
      );
    }),
  );

  routes.post(
    "/:id/maintenance/:blockId/complete",
    route(async (c) => {
      const granted = await access(c, "manage_maintenance");
      const blockId = c.req.param("blockId");
      return idempotentResponse(
        c,
        deps,
        `fleet.maintenance.complete:${blockId}`,
        { blockId },
        async () => ({
          status: 200,
          body: shape(
            MaintenanceBlockViewSchema,
            await completeMaintenance(deps, granted, blockId),
          ),
        }),
      );
    }),
  );

  routes.post(
    "/:id/off-road",
    route(async (c) => {
      const granted = await access(c, "report_off_road");
      const body = ReportOffRoadSchema.parse(await jsonBody(c));
      return idempotentResponse(
        c,
        deps,
        `fleet.off_road:${granted.fleet.id}`,
        body,
        async (scopedKey) => ({
          status: 201,
          body: shape(
            OffRoadViewSchema,
            await reportOffRoad(deps, granted, body, scopedKey),
          ),
        }),
      );
    }),
  );

  // ── Conflicts ────────────────────────────────────────────────────────────

  routes.get(
    "/:id/conflicts",
    route(async (c) => {
      const granted = await access(c, "view_calendar");
      const query = z
        .object({ status: z.enum(CONFLICT_STATUSES).optional() })
        .strict()
        .parse(c.req.query());
      return respond(
        c,
        ConflictListSchema,
        await listFleetConflicts(deps.db, granted, query.status),
      );
    }),
  );

  routes.post(
    "/:id/conflicts/:conflictId/remind",
    route(async (c) => {
      const granted = await access(c, "remind_driver");
      const conflictId = c.req.param("conflictId");
      return idempotentResponse(
        c,
        deps,
        `fleet.conflict.remind:${conflictId}`,
        { conflictId },
        async () => ({
          status: 200,
          body: shape(
            ReminderViewSchema,
            await remindDriver(deps, granted, conflictId),
          ),
        }),
      );
    }),
  );

  // ── Assignments ──────────────────────────────────────────────────────────

  routes.get(
    "/:id/assignments",
    route(async (c) =>
      respond(
        c,
        FleetAssignmentsSchema,
        await listFleetAssignments(deps, await access(c, "view_calendar")),
      ),
    ),
  );

  routes.post(
    "/:id/assignments/propose",
    route(async (c) => {
      const granted = await access(c, "propose_assignment");
      const body = ProposeAssignmentSchema.parse(await jsonBody(c));
      return idempotentResponse(
        c,
        deps,
        `fleet.assignment.propose:${granted.fleet.id}`,
        body,
        async (scopedKey) => ({
          status: 201,
          body: shape(
            ProposalViewSchema,
            await proposeAssignment(deps, granted, body, scopedKey),
          ),
        }),
      );
    }),
  );

  routes.post(
    "/:id/assignments/proposals/:proposalId/withdraw",
    route(async (c) => {
      const granted = await access(c, "propose_assignment");
      const proposalId = c.req.param("proposalId");
      return idempotentResponse(
        c,
        deps,
        `fleet.proposal.withdraw:${proposalId}`,
        { proposalId },
        async () => ({
          status: 200,
          body: shape(
            ProposalViewSchema,
            await withdrawProposal(deps, granted, proposalId),
          ),
        }),
      );
    }),
  );

  routes.post(
    "/:id/assignments/:assignmentId/terminate",
    route(async (c) => {
      const granted = await access(c, "terminate_arrangement");
      const assignmentId = c.req.param("assignmentId");
      return idempotentResponse(
        c,
        deps,
        `fleet.assignment.terminate:${assignmentId}`,
        { assignmentId },
        async () => ({
          status: 200,
          body: shape(
            TerminationViewSchema,
            await terminateByFleet(deps, granted, assignmentId),
          ),
        }),
      );
    }),
  );

  // ── Vehicle swaps (contract A route 7) ───────────────────────────────────

  routes.post(
    "/:id/bookings/:blockId/vehicle-swaps",
    route(async (c) => {
      const granted = await access(c, "request_vehicle_swap");
      const body = RequestVehicleSwapSchema.parse(await jsonBody(c));
      const blockId = c.req.param("blockId");
      return idempotentResponse(
        c,
        deps,
        `fleet.vehicle_swap:${blockId}`,
        body,
        async (scopedKey) => ({
          status: 201,
          body: shape(
            VehicleSwapRequestViewSchema,
            await requestVehicleSwap(deps, granted, blockId, body, scopedKey),
          ),
        }),
      );
    }),
  );

  return routes;
}
