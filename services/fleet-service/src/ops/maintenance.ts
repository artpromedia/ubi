/**
 * Maintenance blocks and off-road reports (FL-2; handoff B5; decisions A1,
 * correction 3 and 4).
 *
 * PLANNED maintenance (planned_service | inspection | repair) is never
 * confirmed over a confirmed booking. The fleet previews first (contract A
 * route 1, plus the fleet-side facts: affected signed shifts and eligible
 * swap vehicles); confirming records the block in ride-service's single
 * occupancy ledger (route 2), which is atomic under the vehicle exclusion
 * constraint — so the refusal is the database's, not a check-then-act race.
 * A refused confirm leaves the block in `needs_resolution` with one critical
 * conflict per overlapped booking and answers 409 `needs_resolution`; it
 * becomes `scheduled` only once every overlap is resolved (moved, swapped,
 * withdrawn by the driver). Planned maintenance never cancels a booking.
 *
 * UNPLANNED OFF-ROAD (a breakdown) is the ONLY fleet action that affects a
 * confirmed booking: it takes effect immediately (created → active, route 4)
 * and moves overlapping bookings to `at_risk` with ride-service's decision
 * deadline — never cancelled. Every report is audited and visible to UBI ops,
 * and a sweep flags it if the vehicle is seen online or on a trip during the
 * claimed breakdown.
 *
 * The preview token binds a confirm to the exact window that was previewed
 * (vehicle, kind, start, end). It is a freshness check, not an authorization:
 * ride-service re-checks atomically on every confirm anyway.
 */
import { createHash } from "node:crypto";

import { ContractError } from "@ubi/contracts";

import { openConflict, resolveConflicts } from "./conflicts";
import {
  FleetError,
  exclusionConstraintOf,
  illegalTransition,
  notFound,
} from "./errors";
import { withOutbox, type OutboxInput } from "./outbox";
import { assertCapability, type FleetAccess } from "./roles";
import { shiftIntervals } from "./shifts";
import { arrangementsOn, fleetVehicleOf } from "./vehicles";
import {
  displayNames,
  documentStatuses,
  maintenanceView,
  nameOr,
  shiftOf,
  validToOf,
} from "./views";
import { deterministicId } from "../lib/ids";
import { workerLogger } from "../lib/logger";
import {
  DAY_MS,
  MINUTE_MS,
  dateColumnToLocalDate,
  iso,
  localDateOf,
  localDateToDateColumn,
  overlaps,
} from "../lib/time";

import type { FleetDeps } from "./context";
import type { Actor } from "./types";
import type { OccupiedBlock, PlannedMaintenanceKind } from "../contract";
import type { FleetMaintenanceBlock } from "@prisma/client/index";

const SYSTEM: Actor = { id: "fleet-service", role: "system" };

/** The longest planned block the portal can place in one go. */
const MAX_BLOCK_MS = 31 * DAY_MS;

export interface MaintenanceWindow {
  readonly vehicleId: string;
  readonly kind: PlannedMaintenanceKind;
  readonly startsAt: string;
  readonly endsAt: string;
}

function normaliseWindow(
  input: MaintenanceWindow,
  now: Date,
): { start: number; end: number } {
  const start = new Date(input.startsAt).getTime();
  const end = new Date(input.endsAt).getTime();
  if (!(end > start)) {
    throw new ContractError(
      "validation_failed",
      "a maintenance block must end after it starts",
    );
  }
  if (end - start > MAX_BLOCK_MS) {
    throw new ContractError(
      "validation_failed",
      "a maintenance block can span at most 31 days",
    );
  }
  if (end <= now.getTime()) {
    throw new ContractError(
      "validation_failed",
      "planned maintenance cannot be placed in the past",
    );
  }
  return { start, end };
}

export function previewTokenFor(
  fleetId: string,
  input: MaintenanceWindow,
): string {
  const canonical = JSON.stringify([
    fleetId,
    input.vehicleId,
    input.kind,
    new Date(input.startsAt).toISOString(),
    new Date(input.endsAt).toISOString(),
  ]);
  return `mpv_${createHash("sha256").update(canonical).digest("hex").slice(0, 40)}`;
}

function assertPreviewToken(
  fleetId: string,
  input: MaintenanceWindow,
  token: string,
): void {
  if (previewTokenFor(fleetId, input) !== token) {
    throw new FleetError(
      "preview_stale",
      "This block differs from the one you previewed. Check the impact again before confirming.",
    );
  }
}

async function localPlannedOverlap(
  deps: FleetDeps,
  vehicleId: string,
  window: { start: number; end: number },
  excludeId?: string,
): Promise<FleetMaintenanceBlock | null> {
  const found = await deps.db.fleetMaintenanceBlock.findFirst({
    where: {
      vehicleId,
      kind: { not: "unplanned_off_road" },
      status: { in: ["scheduled", "active"] },
      startsAt: { lt: new Date(window.end) },
      endsAt: { gt: new Date(window.start) },
      ...(excludeId === undefined ? {} : { id: { not: excludeId } }),
    },
  });
  return found;
}

// ── Preview ────────────────────────────────────────────────────────────────

/** Swap candidates for one booking block, with reasons in ride-service's vocabulary. */
async function swapCandidates(
  deps: FleetDeps,
  access: FleetAccess,
  fromVehicleId: string,
  block: OccupiedBlock,
) {
  const all = await deps.db.fleetVehicle.findMany({
    where: { fleetId: access.fleet.id, status: "active" },
    include: { vehicle: true },
  });
  const from = all.find((row) => row.vehicleId === fromVehicleId);
  const others = all.filter((row) => row.vehicleId !== fromVehicleId);
  if (from === undefined || others.length === 0) {
    return [];
  }
  const interval = {
    start: new Date(block.startsAt).getTime(),
    end: new Date(block.endsAt).getTime(),
  };
  const [occupied, maintenance] = await Promise.all([
    deps.rides.occupiedBlocks({
      vehicleIds: others.map((row) => row.vehicleId),
      driverIds: [],
      from: block.startsAt,
      to: block.endsAt,
    }),
    deps.db.fleetMaintenanceBlock.findMany({
      where: {
        vehicleId: { in: others.map((row) => row.vehicleId) },
        status: { in: ["scheduled", "active"] },
      },
    }),
  ]);
  const now = deps.now();
  return others.map((row) => {
    const reasons: string[] = [];
    if (!from.classes.every((cls) => row.classes.includes(cls))) {
      reasons.push("class_not_eligible");
    }
    if (row.capacity < from.capacity) {
      reasons.push("capacity_too_small");
    }
    const docs = documentStatuses(
      row.vehicle,
      new Date(Math.max(interval.end, now.getTime())),
      access.config.policy,
    );
    if (
      docs.some((doc) => doc.status === "expired" || doc.status === "missing")
    ) {
      reasons.push("documents_expired");
    }
    const inShop = maintenance.some(
      (m) =>
        m.vehicleId === row.vehicleId &&
        overlaps(interval, {
          start: m.startsAt.getTime(),
          end: m.endsAt?.getTime() ?? Number.MAX_SAFE_INTEGER,
        }),
    );
    if (inShop) {
      reasons.push(
        maintenance.some(
          (m) =>
            m.vehicleId === row.vehicleId && m.kind === "unplanned_off_road",
        )
          ? "vehicle_off_road"
          : "vehicle_occupied",
      );
    }
    if (
      !inShop &&
      occupied.some(
        (other) =>
          other.vehicleId === row.vehicleId &&
          overlaps(interval, {
            start: new Date(other.startsAt).getTime(),
            end: new Date(other.endsAt).getTime(),
          }),
      )
    ) {
      reasons.push("vehicle_occupied");
    }
    return {
      vehicleId: row.vehicleId,
      plate: row.vehicle.plateNumber,
      eligible: reasons.length === 0,
      reasons,
    };
  });
}

export async function previewMaintenance(
  deps: FleetDeps,
  access: FleetAccess,
  input: MaintenanceWindow,
) {
  assertCapability(access, "manage_maintenance");
  const now = deps.now();
  const window = normaliseWindow(input, now);
  await fleetVehicleOf(deps.db, access.fleet.id, input.vehicleId);
  const ride = await deps.rides.previewMaintenance({
    vehicleId: input.vehicleId,
    kind: input.kind,
    startsAt: iso(window.start),
    endsAt: iso(window.end),
  });
  const local = await localPlannedOverlap(deps, input.vehicleId, window);

  // Signed shifts that lose hours to the block.
  const startDate = localDateOf(window.start, access.fleet.zone);
  const arrangements = await deps.db.fleetAssignment.findMany({
    where: {
      vehicleId: input.vehicleId,
      fleetId: access.fleet.id,
      OR: [
        { validTo: null },
        { validTo: { gt: localDateToDateColumn(startDate) } },
      ],
    },
  });
  const names = await displayNames(
    deps.db,
    arrangements.map((row) => row.driverId),
  );
  const affectedAssignments = arrangements.flatMap((row) => {
    const lost = shiftIntervals(
      shiftOf(row),
      row.zone,
      dateColumnToLocalDate(row.validFrom),
      validToOf(row.validTo),
      window,
    );
    if (lost.length === 0) {
      return [];
    }
    return [
      {
        assignmentId: row.id,
        driverId: row.driverId,
        driverDisplayName: nameOr(names, row.driverId),
        lostInterval: {
          startsAt: iso(Math.min(...lost.map((piece) => piece.start))),
          endsAt: iso(Math.max(...lost.map((piece) => piece.end))),
        },
      },
    ];
  });

  const suggestions: unknown[] = [];
  if (ride.nextFeasibleWindow !== null) {
    suggestions.push({ kind: "move", ...ride.nextFeasibleWindow });
  }
  for (const block of ride.affectedBlocks) {
    suggestions.push({
      kind: "swap",
      bookingBlockId: block.blockId,
      candidates: await swapCandidates(deps, access, input.vehicleId, block),
    });
    suggestions.push({
      kind: "ask_driver",
      bookingBlockId: block.blockId,
      driverId: block.driverId,
    });
  }
  return {
    feasible: ride.feasible && local === null,
    affectedAssignments,
    affectedBlocks: ride.affectedBlocks,
    suggestions,
    previewToken: previewTokenFor(access.fleet.id, input),
    checkedAt: iso(now.getTime()),
  };
}

// ── Create / resume ────────────────────────────────────────────────────────

function statusEvent(
  block: FleetMaintenanceBlock,
  from: string | null,
  to: string,
  actor: Actor,
  cityId: string | null,
  now: Date,
): OutboxInput {
  return {
    name: "maintenance.status.changed",
    aggregateType: "maintenance_block",
    aggregateId: block.id,
    fromVersion: from === null ? null : block.version,
    toVersion: from === null ? block.version : block.version + 1,
    actor,
    cityId,
    occurredAt: now,
    payload: {
      blockId: block.id,
      fleetId: block.fleetId,
      vehicleId: block.vehicleId,
      kind: block.kind,
      from,
      to,
      startsAt: iso(block.startsAt.getTime()),
      endsAt: block.endsAt === null ? null : iso(block.endsAt.getTime()),
    },
  };
}

export type MaintenanceOutcome =
  | {
      readonly kind: "scheduled";
      readonly view: ReturnType<typeof maintenanceView>;
    }
  | {
      readonly kind: "needs_resolution";
      readonly view: ReturnType<typeof maintenanceView>;
      readonly affectedBlocks: readonly OccupiedBlock[];
      readonly conflictIds: readonly string[];
    };

export async function createMaintenance(
  deps: FleetDeps,
  access: FleetAccess,
  input: MaintenanceWindow & {
    readonly note?: string | undefined;
    readonly previewToken: string;
  },
  scopedKey: string,
): Promise<MaintenanceOutcome> {
  assertCapability(access, "manage_maintenance");
  const blockId = deterministicId("mnt", scopedKey);
  const existing = await deps.db.fleetMaintenanceBlock.findUnique({
    where: { id: blockId },
  });
  if (existing !== null) {
    return resume(deps, access, existing);
  }
  const now = deps.now();
  const window = normaliseWindow(input, now);
  assertPreviewToken(access.fleet.id, input, input.previewToken);
  await fleetVehicleOf(deps.db, access.fleet.id, input.vehicleId);
  const local = await localPlannedOverlap(deps, input.vehicleId, window);
  if (local !== null) {
    throw new FleetError(
      "maintenance_overlap",
      "This overlaps another maintenance block on the vehicle.",
      {
        blockId: local.id,
      },
    );
  }
  const block = await withOutbox(deps.db, async (tx) => {
    const row = await tx.fleetMaintenanceBlock.create({
      data: {
        id: blockId,
        fleetId: access.fleet.id,
        vehicleId: input.vehicleId,
        kind: input.kind,
        startsAt: new Date(window.start),
        endsAt: new Date(window.end),
        zone: access.fleet.zone,
        note: input.note ?? null,
        // draft → checking: the server now checks it against the bookings.
        status: "checking",
        createdBy: access.actor.id,
        createdByRole: access.role,
        idempotencyKey: scopedKey,
      },
    });
    return {
      result: row,
      events: [
        statusEvent(row, null, "checking", access.actor, access.cityId, now),
      ],
      audits: [
        {
          actor: access.actor,
          action: "fleet.maintenance.created",
          subjectType: "fleet_maintenance_block",
          subjectId: row.id,
          after: {
            vehicleId: row.vehicleId,
            kind: row.kind,
            startsAt: iso(window.start),
            endsAt: iso(window.end),
          },
        },
      ],
    };
  });
  return resume(deps, access, block);
}

/** Drives a block in `checking` to `scheduled` or `needs_resolution`. */
async function resume(
  deps: FleetDeps,
  access: FleetAccess,
  block: FleetMaintenanceBlock,
): Promise<MaintenanceOutcome> {
  if (block.fleetId !== access.fleet.id) {
    throw notFound("maintenance block");
  }
  if (block.status === "needs_resolution") {
    const conflicts = await deps.db.fleetConflict.findMany({
      where: {
        maintenanceBlockId: block.id,
        status: { in: ["open", "resolving"] },
      },
    });
    return {
      kind: "needs_resolution",
      view: maintenanceView(block),
      affectedBlocks: conflicts.map((conflict) => blockFromConflict(conflict)),
      conflictIds: conflicts.map((conflict) => conflict.id),
    };
  }
  if (block.status !== "checking") {
    return { kind: "scheduled", view: maintenanceView(block) };
  }
  const now = deps.now();
  const outcome = await deps.rides.createMaintenanceOccupancy(
    {
      blockId: block.id,
      vehicleId: block.vehicleId,
      kind: block.kind as PlannedMaintenanceKind,
      startsAt: iso(block.startsAt.getTime()),
      endsAt: iso((block.endsAt ?? block.startsAt).getTime()),
    },
    `fleet-maint-${block.id}-v${block.version}`,
  );
  if (outcome.kind === "created") {
    try {
      const updated = await withOutbox(deps.db, async (tx) => {
        const row = await tx.fleetMaintenanceBlock.update({
          where: { id: block.id },
          data: {
            status: "scheduled",
            occupancyId: outcome.occupancyId,
            version: { increment: 1 },
          },
        });
        const resolved = await resolveConflicts(
          tx,
          { maintenanceBlockId: block.id },
          "every_overlap_resolved",
          access.actor,
          access.cityId,
          now,
        );
        return {
          result: row,
          events: [
            statusEvent(
              block,
              "checking",
              "scheduled",
              access.actor,
              access.cityId,
              now,
            ),
            ...resolved,
          ],
          audits: [
            {
              actor: access.actor,
              action: "fleet.maintenance.scheduled",
              subjectType: "fleet_maintenance_block",
              subjectId: block.id,
              before: "checking",
              after: { status: "scheduled", occupancyId: outcome.occupancyId },
            },
          ],
        };
      });
      return { kind: "scheduled", view: maintenanceView(updated) };
    } catch (error) {
      if (exclusionConstraintOf(error) === null) {
        throw error;
      }
      // Another planned block on this vehicle got there first: give the
      // occupancy back and refuse, rather than hold two overlapping blocks.
      await deps.rides.releaseOccupancy(block.id, `fleet-release-${block.id}`);
      throw new FleetError(
        "maintenance_overlap",
        "This overlaps another maintenance block on the vehicle.",
      );
    }
  }

  const affected = outcome.affectedBlocks;
  const conflictIds: string[] = [];
  const updated = await withOutbox(deps.db, async (tx) => {
    const row = await tx.fleetMaintenanceBlock.update({
      where: { id: block.id },
      data: { status: "needs_resolution", version: { increment: 1 } },
    });
    const events: OutboxInput[] = [
      statusEvent(
        block,
        "checking",
        "needs_resolution",
        access.actor,
        access.cityId,
        now,
      ),
    ];
    // One OPEN conflict per booking the block overlaps at THIS window. A
    // re-check at the same window keeps the conflicts already open; a move
    // (which settled the old ones as `block_moved`) opens fresh ones for the
    // bookings the new window still overlaps — keyed by the block version,
    // because a settled conflict is terminal and is never reopened.
    const stillOpen = await tx.fleetConflict.findMany({
      where: {
        maintenanceBlockId: block.id,
        type: "maintenance_overlaps_booking",
        status: { in: ["open", "resolving"] },
      },
    });
    const overlapped = new Set(affected.map((booking) => booking.blockId));
    const cleared = stillOpen.filter(
      (conflict) =>
        conflict.bookingBlockId === null ||
        !overlapped.has(conflict.bookingBlockId),
    );
    if (cleared.length > 0) {
      events.push(
        ...(await resolveConflicts(
          tx,
          { ids: cleared.map((conflict) => conflict.id) },
          "overlap_cleared",
          access.actor,
          access.cityId,
          now,
        )),
      );
    }
    for (const booking of affected) {
      const kept = stillOpen.find(
        (conflict) => conflict.bookingBlockId === booking.blockId,
      );
      if (kept !== undefined) {
        conflictIds.push(kept.id);
        continue;
      }
      const opened = await openConflict(
        tx,
        {
          type: "maintenance_overlaps_booking",
          severity: "critical",
          fleetId: block.fleetId,
          vehicleId: block.vehicleId,
          driverId: booking.driverId,
          bookingBlockId: booking.blockId,
          maintenanceBlockId: block.id,
          resolverRoles: ["fleet", "driver", "rider"],
          deadlineAt:
            booking.decisionDeadline === null
              ? null
              : new Date(booking.decisionDeadline),
          dedupeKey: `maint:${block.id}:v${row.version}:${booking.blockId}`,
          detail: {
            blockStartsAt: booking.startsAt,
            blockEndsAt: booking.endsAt,
            kind: booking.kind,
            risk: booking.risk,
          },
        },
        access.actor,
        access.cityId,
        now,
      );
      conflictIds.push(opened.conflict.id);
      events.push(...opened.events);
    }
    return {
      result: row,
      events,
      audits: [
        {
          actor: access.actor,
          action: "fleet.maintenance.needs_resolution",
          subjectType: "fleet_maintenance_block",
          subjectId: block.id,
          before: "checking",
          after: {
            status: "needs_resolution",
            affectedBookings: affected.length,
          },
        },
      ],
    };
  });
  return {
    kind: "needs_resolution",
    view: maintenanceView(updated),
    affectedBlocks: affected,
    conflictIds,
  };
}

function blockFromConflict(conflict: {
  bookingBlockId: string | null;
  driverId: string | null;
  vehicleId: string | null;
  deadlineAt: Date | null;
  detail: unknown;
}): OccupiedBlock {
  const detail = (conflict.detail ?? {}) as {
    blockStartsAt?: string;
    blockEndsAt?: string;
    kind?: "booked" | "on_trip";
    risk?: "ok" | "at_risk";
  };
  return {
    blockId: conflict.bookingBlockId ?? "",
    driverId: conflict.driverId ?? "",
    vehicleId: conflict.vehicleId,
    startsAt: detail.blockStartsAt ?? new Date(0).toISOString(),
    endsAt: detail.blockEndsAt ?? new Date(0).toISOString(),
    kind: detail.kind ?? "booked",
    risk: detail.risk ?? "ok",
    decisionDeadline:
      conflict.deadlineAt === null ? null : iso(conflict.deadlineAt.getTime()),
  };
}

async function blockOf(
  deps: FleetDeps,
  access: FleetAccess,
  blockId: string,
): Promise<FleetMaintenanceBlock> {
  const block = await deps.db.fleetMaintenanceBlock.findUnique({
    where: { id: blockId },
  });
  if (block === null || block.fleetId !== access.fleet.id) {
    throw notFound("maintenance block");
  }
  return block;
}

/**
 * Move or shorten a block that does not hold the vehicle yet (draft or
 * needs_resolution): → checking → re-checked atomically. A scheduled block is
 * moved by cancelling it and creating a new one (each block is one occupancy
 * on ride-service's ledger).
 */
export async function patchMaintenance(
  deps: FleetDeps,
  access: FleetAccess,
  blockId: string,
  input: {
    startsAt?: string | undefined;
    endsAt?: string | undefined;
    note?: string | undefined;
    previewToken: string;
  },
): Promise<MaintenanceOutcome> {
  assertCapability(access, "manage_maintenance");
  const block = await blockOf(deps, access, blockId);
  if (block.status !== "needs_resolution" && block.status !== "draft") {
    throw new ContractError(
      "illegal_transition",
      "Only a block that doesn't hold the vehicle yet can be moved. Cancel it and create a new one.",
      { machine: "maintenanceBlock", from: block.status, to: "checking" },
    );
  }
  const now = deps.now();
  const next: MaintenanceWindow = {
    vehicleId: block.vehicleId,
    kind: block.kind as PlannedMaintenanceKind,
    startsAt: input.startsAt ?? iso(block.startsAt.getTime()),
    endsAt: input.endsAt ?? iso((block.endsAt ?? block.startsAt).getTime()),
  };
  const window = normaliseWindow(next, now);
  assertPreviewToken(access.fleet.id, next, input.previewToken);
  if (
    block.status === "needs_resolution" &&
    window.start === block.startsAt.getTime() &&
    window.end === block.endsAt?.getTime() &&
    (input.note === undefined || input.note === block.note)
  ) {
    // Nothing moves (a replayed move lands here too): answer the block as it
    // stands, with its open conflicts. A re-check at the same window is
    // `confirm`.
    return resume(deps, access, block);
  }
  const local = await localPlannedOverlap(
    deps,
    block.vehicleId,
    window,
    block.id,
  );
  if (local !== null) {
    throw new FleetError(
      "maintenance_overlap",
      "This overlaps another maintenance block on the vehicle.",
      {
        blockId: local.id,
      },
    );
  }
  const moved = await withOutbox(deps.db, async (tx) => {
    const row = await tx.fleetMaintenanceBlock.update({
      where: { id: block.id },
      data: {
        startsAt: new Date(window.start),
        endsAt: new Date(window.end),
        ...(input.note === undefined ? {} : { note: input.note }),
        status: "checking",
        version: { increment: 1 },
      },
    });
    const resolved = await resolveConflicts(
      tx,
      { maintenanceBlockId: block.id },
      "block_moved",
      access.actor,
      access.cityId,
      now,
    );
    return {
      result: row,
      events: [
        statusEvent(
          block,
          block.status,
          "checking",
          access.actor,
          access.cityId,
          now,
        ),
        ...resolved,
      ],
      audits: [
        {
          actor: access.actor,
          action: "fleet.maintenance.moved",
          subjectType: "fleet_maintenance_block",
          subjectId: block.id,
          before: {
            startsAt: iso(block.startsAt.getTime()),
            endsAt: block.endsAt === null ? null : iso(block.endsAt.getTime()),
          },
          after: { startsAt: iso(window.start), endsAt: iso(window.end) },
        },
      ],
    };
  });
  return resume(deps, access, moved);
}

/** Re-check a needs_resolution block at the same window (every overlap resolved?). */
export async function confirmMaintenance(
  deps: FleetDeps,
  access: FleetAccess,
  blockId: string,
  previewToken: string,
): Promise<MaintenanceOutcome> {
  assertCapability(access, "manage_maintenance");
  const block = await blockOf(deps, access, blockId);
  if (block.status === "scheduled" || block.status === "active") {
    return { kind: "scheduled", view: maintenanceView(block) };
  }
  if (block.status === "checking") {
    return resume(deps, access, block);
  }
  if (block.status !== "needs_resolution") {
    throw illegalTransition("maintenanceBlock", block.status, "checking");
  }
  assertPreviewToken(
    access.fleet.id,
    {
      vehicleId: block.vehicleId,
      kind: block.kind as PlannedMaintenanceKind,
      startsAt: iso(block.startsAt.getTime()),
      endsAt: iso((block.endsAt ?? block.startsAt).getTime()),
    },
    previewToken,
  );
  const now = deps.now();
  const checking = await withOutbox(deps.db, async (tx) => {
    const row = await tx.fleetMaintenanceBlock.update({
      where: { id: block.id },
      data: { status: "checking", version: { increment: 1 } },
    });
    return {
      result: row,
      events: [
        statusEvent(
          block,
          "needs_resolution",
          "checking",
          access.actor,
          access.cityId,
          now,
        ),
      ],
      audits: [
        {
          actor: access.actor,
          action: "fleet.maintenance.rechecked",
          subjectType: "fleet_maintenance_block",
          subjectId: block.id,
          before: "needs_resolution",
          after: "checking",
        },
      ],
    };
  });
  return resume(deps, access, checking);
}

const CANCELLABLE: ReadonlySet<string> = new Set([
  "draft",
  "checking",
  "needs_resolution",
  "scheduled",
]);

export async function cancelMaintenance(
  deps: FleetDeps,
  access: FleetAccess,
  blockId: string,
) {
  assertCapability(access, "manage_maintenance");
  const block = await blockOf(deps, access, blockId);
  if (block.status === "cancelled") {
    return maintenanceView(block);
  }
  if (!CANCELLABLE.has(block.status) || block.kind === "unplanned_off_road") {
    throw illegalTransition("maintenanceBlock", block.status, "cancelled");
  }
  if (block.status === "checking" || block.status === "scheduled") {
    // Give the vehicle back on the ledger first (idempotent; a block never
    // recorded answers the same). A failure leaves the block untouched.
    await deps.rides.releaseOccupancy(block.id, `fleet-release-${block.id}`);
  }
  const now = deps.now();
  const updated = await withOutbox(deps.db, async (tx) => {
    const row = await tx.fleetMaintenanceBlock.update({
      where: { id: block.id },
      data: {
        status: "cancelled",
        cancelledAt: now,
        version: { increment: 1 },
      },
    });
    const resolved = await resolveConflicts(
      tx,
      { maintenanceBlockId: block.id },
      "block_cancelled",
      access.actor,
      access.cityId,
      now,
    );
    return {
      result: row,
      events: [
        statusEvent(
          block,
          block.status,
          "cancelled",
          access.actor,
          access.cityId,
          now,
        ),
        ...resolved,
      ],
      audits: [
        {
          actor: access.actor,
          action: "fleet.maintenance.cancelled",
          subjectType: "fleet_maintenance_block",
          subjectId: block.id,
          before: block.status,
          after: "cancelled",
        },
      ],
    };
  });
  return maintenanceView(updated);
}

/** The vehicle is back: an active block (planned early, or an off-road) completes. */
export async function completeMaintenance(
  deps: FleetDeps,
  access: FleetAccess,
  blockId: string,
) {
  assertCapability(access, "manage_maintenance");
  const block = await blockOf(deps, access, blockId);
  if (block.status === "completed") {
    return maintenanceView(block);
  }
  const now = deps.now();
  if (
    block.status !== "active" &&
    !(block.status === "scheduled" && block.startsAt <= now)
  ) {
    throw illegalTransition("maintenanceBlock", block.status, "completed");
  }
  await deps.rides.releaseOccupancy(block.id, `fleet-release-${block.id}`);
  const endsAt =
    block.endsAt === null || block.endsAt > now ? now : block.endsAt;
  const updated = await withOutbox(deps.db, async (tx) => {
    const row = await tx.fleetMaintenanceBlock.update({
      where: { id: block.id },
      data: {
        status: "completed",
        completedAt: now,
        endsAt,
        version: { increment: 1 },
      },
    });
    const resolved = await resolveConflicts(
      tx,
      { maintenanceBlockId: block.id },
      "vehicle_back_in_service",
      access.actor,
      access.cityId,
      now,
    );
    return {
      result: row,
      events: [
        statusEvent(
          block,
          block.status,
          "completed",
          access.actor,
          access.cityId,
          now,
        ),
        ...resolved,
      ],
      audits: [
        {
          actor: access.actor,
          action: "fleet.maintenance.completed",
          subjectType: "fleet_maintenance_block",
          subjectId: block.id,
          before: block.status,
          after: { status: "completed", endsAt: iso(endsAt.getTime()) },
        },
      ],
    };
  });
  return maintenanceView(updated);
}

export async function listMaintenance(
  deps: FleetDeps,
  access: FleetAccess,
  filter: { vehicleId?: string | undefined; status?: string | undefined },
) {
  const rows = await deps.db.fleetMaintenanceBlock.findMany({
    where: {
      fleetId: access.fleet.id,
      ...(filter.vehicleId === undefined
        ? {}
        : { vehicleId: filter.vehicleId }),
      ...(filter.status === undefined ? {} : { status: filter.status }),
    },
    orderBy: { startsAt: "asc" },
    take: 500,
  });
  return { blocks: rows.map((row) => maintenanceView(row)) };
}

// ── Off-road ───────────────────────────────────────────────────────────────

export async function reportOffRoad(
  deps: FleetDeps,
  access: FleetAccess,
  input: {
    readonly vehicleId: string;
    readonly startsAt?: string | undefined;
    readonly expectedEndsAt?: string | undefined;
    readonly note?: string | undefined;
  },
  scopedKey: string,
) {
  assertCapability(access, "report_off_road");
  const blockId = deterministicId("mnt", scopedKey);
  const existing = await deps.db.fleetMaintenanceBlock.findUnique({
    where: { id: blockId },
  });
  if (existing !== null) {
    if (existing.fleetId !== access.fleet.id) {
      throw notFound("maintenance block");
    }
    return completeOffRoad(deps, access, existing);
  }
  const now = deps.now();
  const startsAt =
    input.startsAt === undefined
      ? now.getTime()
      : new Date(input.startsAt).getTime();
  if (
    startsAt > now.getTime() + 5 * MINUTE_MS ||
    startsAt < now.getTime() - DAY_MS
  ) {
    throw new ContractError(
      "validation_failed",
      "an off-road report covers a breakdown now (or within the last day); plan future work as maintenance",
    );
  }
  const expected =
    input.expectedEndsAt === undefined
      ? null
      : new Date(input.expectedEndsAt).getTime();
  if (expected !== null && expected <= startsAt) {
    throw new ContractError(
      "validation_failed",
      "the expected end must be after the start",
    );
  }
  await fleetVehicleOf(deps.db, access.fleet.id, input.vehicleId);
  let block: FleetMaintenanceBlock;
  try {
    block = await withOutbox(deps.db, async (tx) => {
      const row = await tx.fleetMaintenanceBlock.create({
        data: {
          id: blockId,
          fleetId: access.fleet.id,
          vehicleId: input.vehicleId,
          kind: "unplanned_off_road",
          startsAt: new Date(startsAt),
          endsAt: expected === null ? null : new Date(expected),
          zone: access.fleet.zone,
          note: input.note ?? null,
          // created → active: a breakdown takes effect immediately (safety).
          status: "active",
          createdBy: access.actor.id,
          createdByRole: access.role,
          idempotencyKey: scopedKey,
        },
      });
      return {
        result: row,
        events: [
          statusEvent(row, null, "active", access.actor, access.cityId, now),
          {
            name: "fleet.offroad.reported",
            aggregateType: "maintenance_block",
            aggregateId: row.id,
            fromVersion: null,
            toVersion: row.version,
            idempotencyKey: `fleet.offroad.reported:${row.id}`,
            actor: access.actor,
            cityId: access.cityId,
            occurredAt: now,
            payload: {
              blockId: row.id,
              fleetId: row.fleetId,
              vehicleId: row.vehicleId,
              reportedBy: access.actor.id,
              reportedByRole: access.role,
              startsAt: iso(startsAt),
              expectedEndsAt: expected === null ? null : iso(expected),
            },
          },
        ],
        // Visible to UBI ops (decisions correction 4).
        audits: [
          {
            actor: access.actor,
            action: "fleet.off_road.reported",
            subjectType: "fleet_maintenance_block",
            subjectId: row.id,
            after: {
              vehicleId: row.vehicleId,
              startsAt: iso(startsAt),
              expectedEndsAt: expected === null ? null : iso(expected),
              role: access.role,
            },
            reason: "off_road_reported",
          },
        ],
      };
    });
  } catch (error) {
    if (exclusionConstraintOf(error) !== null) {
      throw new FleetError(
        "maintenance_overlap",
        "This vehicle is already reported off-road for that time.",
      );
    }
    throw error;
  }
  return completeOffRoad(deps, access, block);
}

/** Records the off-road block on ride-service's ledger (route 4) and opens the at-risk conflicts. */
async function completeOffRoad(
  deps: FleetDeps,
  access: FleetAccess,
  block: FleetMaintenanceBlock,
) {
  if (block.occupancyId !== null) {
    const conflicts = await deps.db.fleetConflict.findMany({
      where: { maintenanceBlockId: block.id },
    });
    return {
      block: maintenanceView(block),
      atRiskBookings: conflicts
        .filter((conflict) => conflict.bookingBlockId !== null)
        .map((conflict) => ({
          blockId: conflict.bookingBlockId as string,
          decisionDeadline: iso(
            (conflict.deadlineAt ?? block.startsAt).getTime(),
          ),
        })),
      conflictIds: conflicts.map((conflict) => conflict.id),
    };
  }
  const recorded = await deps.rides.reportOffRoad(
    {
      blockId: block.id,
      vehicleId: block.vehicleId,
      startsAt: iso(block.startsAt.getTime()),
      expectedEndsAt:
        block.endsAt === null ? null : iso(block.endsAt.getTime()),
    },
    `fleet-offroad-${block.id}`,
  );
  // Which driver each at-risk booking belongs to (best effort: the
  // projection is the only booking fact a fleet may read).
  let blocks: OccupiedBlock[] = [];
  if (recorded.atRiskBookings.length > 0) {
    try {
      blocks = await deps.rides.occupiedBlocks({
        vehicleIds: [block.vehicleId],
        driverIds: [],
        from: iso(block.startsAt.getTime()),
        to: iso(
          (block.endsAt?.getTime() ?? block.startsAt.getTime()) + 30 * DAY_MS,
        ),
      });
    } catch (error) {
      workerLogger.warn(
        { err: error, blockId: block.id },
        "could not map at-risk bookings to drivers",
      );
    }
  }
  const byId = new Map(blocks.map((entry) => [entry.blockId, entry]));
  const now = deps.now();
  const conflictIds: string[] = [];
  const updated = await withOutbox(deps.db, async (tx) => {
    const row = await tx.fleetMaintenanceBlock.update({
      where: { id: block.id },
      data: { occupancyId: recorded.occupancyId, version: { increment: 1 } },
    });
    const events: OutboxInput[] = [];
    for (const atRisk of recorded.atRiskBookings) {
      const known = byId.get(atRisk.blockId);
      const opened = await openConflict(
        tx,
        {
          type: "unplanned_off_road",
          severity: "critical",
          fleetId: block.fleetId,
          vehicleId: block.vehicleId,
          driverId: known?.driverId ?? null,
          bookingBlockId: atRisk.blockId,
          maintenanceBlockId: block.id,
          resolverRoles: ["fleet", "driver", "rider"],
          deadlineAt: new Date(atRisk.decisionDeadline),
          dedupeKey: `offroad:${block.id}:${atRisk.blockId}`,
          ...(known === undefined
            ? {}
            : {
                detail: {
                  blockStartsAt: known.startsAt,
                  blockEndsAt: known.endsAt,
                  kind: known.kind,
                  risk: "at_risk",
                },
              }),
        },
        access.actor,
        access.cityId,
        now,
      );
      conflictIds.push(opened.conflict.id);
      events.push(...opened.events);
    }
    return {
      result: row,
      events,
      audits: [
        {
          actor: access.actor,
          action: "fleet.off_road.recorded",
          subjectType: "fleet_maintenance_block",
          subjectId: block.id,
          after: {
            occupancyId: recorded.occupancyId,
            atRiskBookings: recorded.atRiskBookings.length,
          },
        },
      ],
    };
  });
  return {
    block: maintenanceView(updated),
    atRiskBookings: recorded.atRiskBookings.map((entry) => ({ ...entry })),
    conflictIds,
  };
}

// ── Sweeps ─────────────────────────────────────────────────────────────────

/** The server clock: scheduled → active at the start, planned active → completed at the end. */
export async function advanceMaintenanceClock(
  deps: FleetDeps,
): Promise<number> {
  const now = deps.now();
  const due = await deps.db.fleetMaintenanceBlock.findMany({
    where: {
      OR: [
        { status: "scheduled", startsAt: { lte: now } },
        {
          status: "active",
          kind: { not: "unplanned_off_road" },
          endsAt: { lte: now },
        },
      ],
    },
    include: { fleet: { select: { cityId: true } } },
    take: 500,
  });
  let moved = 0;
  for (const block of due) {
    const ended = block.endsAt !== null && block.endsAt <= now;
    const to = block.status === "scheduled" && !ended ? "active" : "completed";
    const path =
      block.status === "scheduled" && ended ? ["active", "completed"] : [to];
    await withOutbox(deps.db, async (tx) => {
      const updated = await tx.fleetMaintenanceBlock.updateMany({
        where: { id: block.id, version: block.version },
        data: {
          status: to,
          version: { increment: 1 },
          ...(to === "completed" ? { completedAt: now } : {}),
        },
      });
      if (updated.count === 0) {
        return { result: null };
      }
      moved += 1;
      const event = statusEvent(
        block,
        block.status,
        to,
        SYSTEM,
        block.fleet.cityId,
        now,
      );
      return {
        result: null,
        events: [{ ...event, payload: { ...event.payload, path } }],
        audits: [
          {
            actor: SYSTEM,
            action: `fleet.maintenance.${to}`,
            subjectType: "fleet_maintenance_block",
            subjectId: block.id,
            before: block.status,
            after: { status: to, path },
            reason: "server_clock",
          },
        ],
      };
    });
  }
  return moved;
}

/**
 * Off-road abuse control (decisions correction 4): an active breakdown whose
 * vehicle is seen on a trip, or whose assigned driver is online on it, is
 * flagged once — audited and published for UBI ops. The only sources are
 * real: ride-service's `on_trip` projection and the driver's online state.
 */
export async function checkOffRoadIntegrity(deps: FleetDeps): Promise<number> {
  const now = deps.now();
  const active = await deps.db.fleetMaintenanceBlock.findMany({
    where: {
      kind: "unplanned_off_road",
      status: "active",
      offRoadFlaggedAt: null,
    },
    include: { fleet: { select: { cityId: true, zone: true } } },
    take: 200,
  });
  let flagged = 0;
  for (const block of active) {
    const window = { start: block.startsAt.getTime(), end: now.getTime() };
    if (window.end <= window.start) {
      continue;
    }
    let reason: string | null = null;
    try {
      const blocks = await deps.rides.occupiedBlocks({
        vehicleIds: [block.vehicleId],
        driverIds: [],
        from: iso(window.start),
        to: iso(window.end),
      });
      if (
        blocks.some(
          (entry) =>
            entry.kind === "on_trip" &&
            entry.vehicleId === block.vehicleId &&
            overlaps(window, {
              start: new Date(entry.startsAt).getTime(),
              end: new Date(entry.endsAt).getTime(),
            }),
        )
      ) {
        reason = "vehicle_on_trip_during_off_road";
      }
    } catch (error) {
      workerLogger.warn(
        { err: error, blockId: block.id },
        "off-road integrity: bookings unavailable",
      );
    }
    if (reason === null) {
      const today = localDateOf(now.getTime(), block.fleet.zone);
      const assigned = await arrangementsOn(
        deps.db,
        { vehicleIds: [block.vehicleId] },
        today,
      );
      const driverUserIds = assigned.map((row) => row.driverId);
      const online = await deps.db.driver.findFirst({
        where: {
          isOnline: true,
          OR: [
            { vehicleId: block.vehicleId },
            ...(driverUserIds.length === 0
              ? []
              : [{ userId: { in: driverUserIds } }]),
          ],
        },
        select: { id: true },
      });
      if (online !== null) {
        reason = "driver_online_on_vehicle_during_off_road";
      }
    }
    if (reason === null) {
      continue;
    }
    const flagReason = reason;
    await withOutbox(deps.db, async (tx) => {
      const updated = await tx.fleetMaintenanceBlock.updateMany({
        where: { id: block.id, offRoadFlaggedAt: null },
        data: {
          offRoadFlaggedAt: now,
          offRoadFlagReason: flagReason,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        return { result: null };
      }
      flagged += 1;
      return {
        result: null,
        events: [
          {
            name: "fleet.offroad.flagged",
            aggregateType: "maintenance_block",
            aggregateId: block.id,
            fromVersion: block.version,
            toVersion: block.version + 1,
            actor: SYSTEM,
            cityId: block.fleet.cityId,
            occurredAt: now,
            payload: {
              blockId: block.id,
              fleetId: block.fleetId,
              vehicleId: block.vehicleId,
              reportedBy: block.createdBy,
              reason: flagReason,
            },
          },
        ],
        audits: [
          {
            actor: SYSTEM,
            action: "fleet.off_road.flagged",
            subjectType: "fleet_maintenance_block",
            subjectId: block.id,
            after: { reason: flagReason },
            reason: flagReason,
          },
        ],
      };
    });
  }
  return flagged;
}

/** An off-road block whose ledger write failed is retried (route 4 is idempotent). */
export async function retryUnrecordedOffRoad(deps: FleetDeps): Promise<number> {
  const pending = await deps.db.fleetMaintenanceBlock.findMany({
    where: { kind: "unplanned_off_road", status: "active", occupancyId: null },
    include: { fleet: true },
    take: 100,
  });
  let recorded = 0;
  for (const block of pending) {
    try {
      const config = await deps.config.load(block.fleet.cityId);
      await completeOffRoad(
        deps,
        {
          fleet: block.fleet,
          role: "owner",
          config,
          actor: { id: block.createdBy, role: block.createdByRole },
          cityId: block.fleet.cityId,
        },
        block,
      );
      recorded += 1;
    } catch (error) {
      workerLogger.warn(
        { err: error, blockId: block.id },
        "off-road ledger retry failed",
      );
    }
  }
  return recorded;
}
