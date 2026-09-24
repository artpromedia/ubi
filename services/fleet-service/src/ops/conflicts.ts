/**
 * The conflict centre (handoff B6, conflict matrix).
 *
 * A conflict row is opened by the flow that discovers it (a maintenance
 * block refused over a booking, an off-road report, a document expiring, a
 * driver's time off over their own booking, a termination notice) inside
 * that flow's transaction, keyed by a `dedupe_key` so a replay or a second
 * sweep lands on the same row. Allowed actions are COMPUTED per caller role
 * at read time — never stored — and a driver-owned conflict reaches a fleet
 * only as `driver_resolving`, never labelled as the driver's time off.
 */
import { notFound } from "./errors";
import { auditInTx, type OutboxInput, type OutboxTx } from "./outbox";
import { roleCan, type FleetAccess } from "./roles";
import { generateId } from "../lib/ids";
import { iso } from "../lib/time";

import type { Actor, FleetTx, JsonRecord } from "./types";
import type {
  ConflictStatus,
  ConflictType,
  FleetConflictAction,
  FleetStaffRole,
} from "../contract";
import type { FleetConflict } from "@prisma/client/index";

export interface OpenConflictInput {
  readonly type: ConflictType;
  readonly severity: "critical" | "high" | "medium" | "blocked" | "status";
  readonly fleetId: string | null;
  readonly vehicleId?: string | null;
  readonly driverId?: string | null;
  readonly bookingBlockId?: string | null;
  readonly maintenanceBlockId?: string | null;
  readonly assignmentId?: string | null;
  readonly resolverRoles: readonly ("fleet" | "driver" | "rider" | "ubi")[];
  readonly deadlineAt?: Date | null;
  readonly status?: "open" | "resolving";
  readonly dedupeKey: string;
  readonly detail?: JsonRecord;
}

export interface OpenedConflict {
  readonly conflict: FleetConflict;
  readonly created: boolean;
  readonly events: OutboxInput[];
}

/** Opens (or finds) a conflict inside the caller's outbox transaction. */
export async function openConflict(
  tx: OutboxTx,
  input: OpenConflictInput,
  actor: Actor,
  cityId: string | null,
  now: Date,
): Promise<OpenedConflict> {
  const existing = await tx.fleetConflict.findUnique({
    where: { dedupeKey: input.dedupeKey },
  });
  if (existing !== null) {
    return { conflict: existing, created: false, events: [] };
  }
  const conflict = await tx.fleetConflict.create({
    data: {
      id: generateId("fcf"),
      fleetId: input.fleetId,
      type: input.type,
      severity: input.severity,
      vehicleId: input.vehicleId ?? null,
      driverId: input.driverId ?? null,
      bookingBlockId: input.bookingBlockId ?? null,
      maintenanceBlockId: input.maintenanceBlockId ?? null,
      assignmentId: input.assignmentId ?? null,
      resolverRoles: [...input.resolverRoles],
      deadlineAt: input.deadlineAt ?? null,
      status: input.status ?? "open",
      dedupeKey: input.dedupeKey,
      ...(input.detail === undefined ? {} : { detail: input.detail }),
    },
  });
  await auditInTx(tx, {
    actor,
    action: "fleet.conflict.opened",
    subjectType: "fleet_conflict",
    subjectId: conflict.id,
    after: {
      type: input.type,
      severity: input.severity,
      status: conflict.status,
      fleetId: input.fleetId,
      deadlineAt:
        input.deadlineAt === undefined || input.deadlineAt === null
          ? null
          : iso(input.deadlineAt.getTime()),
    },
  });
  return {
    conflict,
    created: true,
    events: [
      {
        name: "fleet.conflict.opened",
        aggregateType: "fleet_conflict",
        aggregateId: conflict.id,
        fromVersion: null,
        toVersion: 1,
        actor,
        cityId,
        occurredAt: now,
        payload: {
          conflictId: conflict.id,
          fleetId: input.fleetId,
          type: input.type,
          severity: input.severity,
          vehicleId: input.vehicleId ?? null,
          driverId: input.driverId ?? null,
          bookingBlockId: input.bookingBlockId ?? null,
          maintenanceBlockId: input.maintenanceBlockId ?? null,
          deadlineAt:
            input.deadlineAt === undefined || input.deadlineAt === null
              ? null
              : iso(input.deadlineAt.getTime()),
        },
      },
    ],
  };
}

/** Resolves every open conflict matching `where`, returning their events. */
export async function resolveConflicts(
  tx: OutboxTx,
  where: { maintenanceBlockId?: string; ids?: readonly string[] },
  resolution: string,
  actor: Actor,
  cityId: string | null,
  now: Date,
): Promise<OutboxInput[]> {
  const rows = await tx.fleetConflict.findMany({
    where: {
      status: { in: ["open", "resolving"] },
      ...(where.maintenanceBlockId === undefined
        ? {}
        : { maintenanceBlockId: where.maintenanceBlockId }),
      ...(where.ids === undefined ? {} : { id: { in: [...where.ids] } }),
    },
  });
  const events: OutboxInput[] = [];
  for (const row of rows) {
    await tx.fleetConflict.update({
      where: { id: row.id },
      data: {
        status: "resolved",
        resolution,
        resolvedAt: now,
        version: { increment: 1 },
      },
    });
    await auditInTx(tx, {
      actor,
      action: "fleet.conflict.resolved",
      subjectType: "fleet_conflict",
      subjectId: row.id,
      before: row.status,
      after: "resolved",
      reason: resolution,
    });
    events.push({
      name: "fleet.conflict.resolved",
      aggregateType: "fleet_conflict",
      aggregateId: row.id,
      fromVersion: row.version,
      toVersion: row.version + 1,
      actor,
      cityId,
      occurredAt: now,
      payload: { conflictId: row.id, type: row.type, resolution },
    });
  }
  return events;
}

const FLEET_ACTIONS: Readonly<
  Record<ConflictType, readonly FleetConflictAction[]>
> = {
  maintenance_overlaps_booking: [
    "move_block",
    "cancel_block",
    "propose_vehicle_swap",
    "ask_driver",
  ],
  unplanned_off_road: ["propose_vehicle_swap", "ask_driver", "complete_block"],
  document_expiring: ["renew_document"],
  document_expires_in_booking: [
    "renew_document",
    "propose_vehicle_swap",
    "ask_driver",
  ],
  time_off_overlaps_booking: ["remind"],
  termination_bookings: ["propose_vehicle_swap", "ask_driver"],
};

/** What a caller with `role` may do about a conflict right now. */
export function allowedActionsFor(
  type: ConflictType,
  status: ConflictStatus,
  role: FleetStaffRole,
): FleetConflictAction[] {
  if (status === "resolved" || status === "lapsed") {
    return [];
  }
  // Every fleet-side action is owner/manager; read-only staff only look.
  if (!roleCan(role, "manage_maintenance")) {
    return [];
  }
  return [...FLEET_ACTIONS[type]];
}

/** A conflict as a FLEET sees it. */
export function fleetConflictView(row: FleetConflict, role: FleetStaffRole) {
  const type = row.type as ConflictType;
  const status = row.status as ConflictStatus;
  const driverOwned = type === "time_off_overlaps_booking";
  return {
    conflictId: row.id,
    type: driverOwned ? ("driver_resolving" as const) : type,
    severity: row.severity as
      | "critical"
      | "high"
      | "medium"
      | "blocked"
      | "status",
    subjects: [
      {
        vehicleId: driverOwned ? null : row.vehicleId,
        driverId: row.driverId,
        blockId:
          row.bookingBlockId ?? (driverOwned ? null : row.maintenanceBlockId),
      },
    ],
    resolverRoles: row.resolverRoles as (
      | "fleet"
      | "driver"
      | "rider"
      | "ubi"
    )[],
    allowedActions: allowedActionsFor(type, status, role),
    deadlineAt: row.deadlineAt === null ? null : iso(row.deadlineAt.getTime()),
    status,
    openedAt: iso(row.createdAt.getTime()),
    resolvedAt: row.resolvedAt === null ? null : iso(row.resolvedAt.getTime()),
  };
}

export async function listFleetConflicts(
  db: FleetTx,
  access: FleetAccess,
  status: ConflictStatus | undefined,
) {
  const rows = await db.fleetConflict.findMany({
    where: {
      fleetId: access.fleet.id,
      ...(status === undefined ? {} : { status }),
    },
    orderBy: [{ deadlineAt: "asc" }, { createdAt: "asc" }],
    take: 500,
  });
  return { conflicts: rows.map((row) => fleetConflictView(row, access.role)) };
}

export async function fleetConflictOf(
  db: FleetTx,
  access: FleetAccess,
  conflictId: string,
): Promise<FleetConflict> {
  const row = await db.fleetConflict.findUnique({ where: { id: conflictId } });
  if (row === null || row.fleetId !== access.fleet.id) {
    throw notFound("conflict");
  }
  return row;
}
