/**
 * A driver reports a vehicle problem from the app (handoff C5
 * ReportVehicleIssue, FL-11; docs/design/FLEET_CALENDAR_DECISIONS.md Q5, Q8
 * and correction 4).
 *
 * Only the driver a SIGNED arrangement assigns to the vehicle today may
 * report it — the same validity test every other fleet read uses
 * (`arrangementsOn`). Anyone else, and any vehicle id that is not theirs or
 * does not exist, gets the same 403, so the answer never discloses a fleet's
 * vehicles.
 *
 *  - `cannot_drive`: an ACTIVE unplanned_off_road block, created by the very
 *    path an owner's or manager's off-road report takes (`recordOffRoad` →
 *    `completeOffRoad`: ride-service contract A route 4, overlapping bookings
 *    go `at_risk` with their decision deadline and are never cancelled, one
 *    critical conflict per booking). It is audited, visible to UBI ops and
 *    swept by the same abuse control (`checkOffRoadIntegrity` flags it if the
 *    vehicle is seen on a trip, or its drivers online, during the claimed
 *    breakdown). Remittance is NOT pro-rated (Q8): contract B hands the hours
 *    to payment-service as off-road hours under the signed terms' shortfall
 *    rule, never as planned maintenance.
 *  - `service_soon`: no block and no booking effect. The fleet is alerted to
 *    plan the service through its own maintenance editor (B5).
 *
 * Both raise `fleet.alert` (the slice-10 fleet alert, subject `vehicle`) in
 * the report's own transaction, with ids and codes only — the driver's note
 * is never put in an event: on `cannot_drive` it rides the block the fleet
 * reads, on `service_soon` it is kept in the audit row for UBI ops.
 *
 * "Only while stationary" is the app's gate (lib/motion in the driver app):
 * fleet-service has no motion signal, and a breakdown report never commits
 * the driver to anything a moving driver could regret.
 */
import { ContractError } from "@ubi/contracts";

import { requireFleetEnabled } from "./config";
import { FleetError, isUniqueViolation } from "./errors";
import {
  completeOffRoad,
  recordOffRoad,
  type OffRoadExtras,
  type OffRoadReporter,
} from "./maintenance";
import { outboxKey, withOutbox, type OutboxInput } from "./outbox";
import { arrangementsOn, fleetVehicleOf } from "./vehicles";
import { deterministicId, isUuid } from "../lib/ids";
import { iso, localDateOf } from "../lib/time";

import type { FleetDeps } from "./context";
import type { Actor } from "./types";
import type {
  ReportVehicleIssue,
  VehicleIssueSeverity,
  VehicleIssueView,
} from "../vehicle-issue-contract";
import type { Fleet, FleetMaintenanceBlock } from "@prisma/client/index";

function notAssigned(): ContractError {
  return new ContractError(
    "forbidden",
    "You can only report the vehicle you're assigned to right now.",
    { reason: "not_assigned_to_vehicle" },
  );
}

/** The fleet whose signed arrangement puts this driver on this vehicle today. */
async function assignedFleet(
  deps: FleetDeps,
  driverId: string,
  vehicleId: string,
  cityId: string,
  zone: string,
): Promise<Fleet> {
  if (!isUuid(vehicleId)) {
    throw notAssigned();
  }
  const today = localDateOf(deps.now().getTime(), zone);
  const rows = await arrangementsOn(
    deps.db,
    { vehicleIds: [vehicleId], driverId },
    today,
  );
  const row = rows.at(-1);
  if (row === undefined) {
    throw notAssigned();
  }
  const fleet = await deps.db.fleet.findUnique({ where: { id: row.fleetId } });
  if (fleet === null || fleet.cityId !== cityId) {
    throw notAssigned();
  }
  return fleet;
}

function keyReused(): ContractError {
  return new ContractError(
    "idempotency_key_reuse",
    "this Idempotency-Key was already used with a different request",
  );
}

/**
 * `recordOffRoad` for one scoped key. Two concurrent requests with the same
 * key race to insert the same block id: the loser answers with the winner's
 * block instead of a raw constraint error, so both converge on one report.
 */
async function recordOffRoadOnce(
  deps: FleetDeps,
  actor: Actor,
  reporter: OffRoadReporter,
  input: Parameters<typeof recordOffRoad>[2],
  extras: OffRoadExtras,
): Promise<FleetMaintenanceBlock> {
  try {
    return await recordOffRoad(deps, reporter, input, extras);
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const winner = await deps.db.fleetMaintenanceBlock.findUnique({
      where: { id: input.blockId },
    });
    if (
      winner === null ||
      winner.createdBy !== actor.id ||
      winner.vehicleId !== input.vehicleId
    ) {
      throw error;
    }
    return winner;
  }
}

function alertEvent(input: {
  readonly issueId: string;
  readonly severity: VehicleIssueSeverity;
  readonly fleet: Fleet;
  readonly vehicleId: string;
  readonly vehicleVersion: number;
  readonly block: FleetMaintenanceBlock | null;
  readonly hasNote: boolean;
  readonly actor: Actor;
  readonly cityId: string;
  readonly now: Date;
}): OutboxInput {
  return {
    name: "fleet.alert",
    aggregateType: "vehicle",
    aggregateId: input.vehicleId,
    fromVersion: null,
    toVersion: input.vehicleVersion,
    idempotencyKey: `fleet.alert:${input.issueId}`,
    actor: input.actor,
    cityId: input.cityId,
    occurredAt: input.now,
    payload: {
      alertType: "vehicle_issue_reported",
      issueId: input.issueId,
      severity: input.severity,
      fleetId: input.fleet.id,
      vehicleId: input.vehicleId,
      driverId: input.actor.id,
      blockId: input.block?.id ?? null,
      // cannot_drive: plan cover (the bookings follow the conflict path);
      // service_soon: schedule planned maintenance (B5).
      fleetAction:
        input.severity === "cannot_drive"
          ? "vehicle_off_road"
          : "schedule_planned_maintenance",
      hasNote: input.hasNote,
      reportedAt: iso(input.now.getTime()),
    },
  };
}

export async function reportVehicleIssue(
  deps: FleetDeps,
  actor: Actor,
  cityId: string,
  input: ReportVehicleIssue,
  scopedKey: string,
): Promise<VehicleIssueView> {
  const config = await requireFleetEnabled(deps.config, cityId);
  const issueId = deterministicId("vis", scopedKey);
  const fleet = await assignedFleet(
    deps,
    actor.id,
    input.vehicleId,
    cityId,
    config.city.timezone,
  );
  // A vehicle the fleet has since removed is answered like any other vehicle
  // that is not the driver's (the same 403, never a 404 that tells them apart).
  const fleetVehicle = await fleetVehicleOf(
    deps.db,
    fleet.id,
    input.vehicleId,
  ).catch((error: unknown) => {
    if (error instanceof ContractError && error.code === "not_found") {
      throw notAssigned();
    }
    throw error;
  });
  const note =
    input.note === undefined || input.note === "" ? null : input.note;
  if (input.severity === "cannot_drive") {
    return reportBreakdown(deps, actor, cityId, {
      issueId,
      fleet,
      vehicleId: input.vehicleId,
      vehicleVersion: fleetVehicle.version,
      note,
      scopedKey,
    });
  }
  return requestService(deps, actor, cityId, {
    issueId,
    fleet,
    vehicleId: input.vehicleId,
    vehicleVersion: fleetVehicle.version,
    note,
  });
}

async function reportBreakdown(
  deps: FleetDeps,
  actor: Actor,
  cityId: string,
  input: {
    readonly issueId: string;
    readonly fleet: Fleet;
    readonly vehicleId: string;
    readonly vehicleVersion: number;
    readonly note: string | null;
    readonly scopedKey: string;
  },
): Promise<VehicleIssueView> {
  const context = { actor, cityId };
  const blockId = deterministicId("mnt", input.scopedKey);
  let block = await deps.db.fleetMaintenanceBlock.findUnique({
    where: { id: blockId },
  });
  if (block !== null && block.createdBy !== actor.id) {
    throw notAssigned();
  }
  // A retry after a crash (no idempotency record yet) must name the same
  // vehicle as the report its key already started.
  if (block !== null && block.vehicleId !== input.vehicleId) {
    throw keyReused();
  }
  if (block === null) {
    const now = deps.now();
    // A breakdown the fleet (or this driver) already reported is still
    // running: say so plainly instead of the constraint's generic refusal.
    const running = await deps.db.fleetMaintenanceBlock.findFirst({
      where: {
        vehicleId: input.vehicleId,
        kind: "unplanned_off_road",
        status: "active",
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      select: { id: true },
    });
    if (running !== null) {
      throw new FleetError(
        "maintenance_overlap",
        "This vehicle is already reported off-road, and your fleet has been told. Check your schedule for any booking that needs a decision.",
      );
    }
    block = await recordOffRoadOnce(
      deps,
      actor,
      { fleet: input.fleet, actor, role: "driver", cityId },
      {
        blockId,
        vehicleId: input.vehicleId,
        startsAt: now.getTime(),
        // Open-ended: the fleet marks the vehicle back on the road.
        expectedEndsAt: null,
        note: input.note,
        scopedKey: input.scopedKey,
      },
      {
        events: (row) => [
          alertEvent({
            issueId: input.issueId,
            severity: "cannot_drive",
            fleet: input.fleet,
            vehicleId: input.vehicleId,
            vehicleVersion: input.vehicleVersion,
            block: row,
            hasNote: input.note !== null,
            actor,
            cityId,
            now,
          }),
        ],
        audits: (row) => [
          {
            actor,
            action: "fleet.vehicle_issue.reported",
            subjectType: "fleet_maintenance_block",
            subjectId: row.id,
            after: {
              issueId: input.issueId,
              severity: "cannot_drive",
              vehicleId: input.vehicleId,
              fleetId: input.fleet.id,
            },
            reason: "driver_reported_breakdown",
          },
        ],
      },
    );
  }
  const recorded = await completeOffRoad(deps, context, block);
  const mine = await deps.db.fleetConflict.findMany({
    where: {
      maintenanceBlockId: block.id,
      driverId: actor.id,
      id: { in: recorded.conflictIds },
    },
    orderBy: { deadlineAt: "asc" },
  });
  return {
    issueId: input.issueId,
    severity: "cannot_drive",
    vehicleId: input.vehicleId,
    // The driver's report starts the block at the server's own clock.
    reportedAt: iso(block.startsAt.getTime()),
    fleetAlerted: true,
    block: {
      blockId: recorded.block.blockId,
      kind: "unplanned_off_road",
      status: recorded.block.status === "completed" ? "completed" : "active",
      startsAt: recorded.block.startsAt,
      endsAt: recorded.block.endsAt,
    },
    decisions: mine.map((conflict) => ({
      conflictId: conflict.id,
      deadlineAt:
        conflict.deadlineAt === null
          ? null
          : iso(conflict.deadlineAt.getTime()),
    })),
    remittanceEffect: "signed_terms_shortfall_rule",
  };
}

async function requestService(
  deps: FleetDeps,
  actor: Actor,
  cityId: string,
  input: {
    readonly issueId: string;
    readonly fleet: Fleet;
    readonly vehicleId: string;
    readonly vehicleVersion: number;
    readonly note: string | null;
  },
): Promise<VehicleIssueView> {
  const now = deps.now();
  const view = (reportedAt: Date): VehicleIssueView => ({
    issueId: input.issueId,
    severity: "service_soon",
    vehicleId: input.vehicleId,
    reportedAt: iso(reportedAt.getTime()),
    fleetAlerted: true,
    block: null,
    decisions: [],
    remittanceEffect: "none",
  });
  const alert = alertEvent({
    issueId: input.issueId,
    severity: "service_soon",
    fleet: input.fleet,
    vehicleId: input.vehicleId,
    vehicleVersion: input.vehicleVersion,
    block: null,
    hasNote: input.note !== null,
    actor,
    cityId,
    now,
  });
  try {
    // No row of its own: the alert and its audit are the whole unit of
    // work, written only while the vehicle is still the fleet's.
    await withOutbox(deps.db, async (tx) => {
      const stillThere = await tx.fleetVehicle.count({
        where: {
          fleetId: input.fleet.id,
          vehicleId: input.vehicleId,
          status: "active",
        },
      });
      if (stillThere === 0) {
        throw notAssigned();
      }
      return {
        result: null,
        events: [alert],
        audits: [
          {
            actor,
            action: "fleet.vehicle_issue.reported",
            subjectType: "vehicle",
            subjectId: input.vehicleId,
            after: {
              issueId: input.issueId,
              severity: "service_soon",
              fleetId: input.fleet.id,
              note: input.note,
            },
            reason: "driver_requested_service",
          },
        ],
      };
    });
  } catch (error) {
    // A retry after a crash between the alert and the idempotency record
    // lands on the alert's unique event key: answer what was recorded.
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const recorded = await deps.db.outboxEvent.findUnique({
      where: { idempotencyKey: outboxKey(alert.idempotencyKey ?? "") },
    });
    if (recorded === null || recorded.actorId !== actor.id) {
      throw error;
    }
    return view(recorded.occurredAt);
  }
  return view(now);
}
