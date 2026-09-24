/**
 * Vehicle swaps on advance bookings (FL-8, fleet side) and driver reminders.
 *
 * A fleet may REQUEST that one of its bookings move to another of its
 * vehicles (contract A route 7). The swap itself is ride-service's: the
 * driver accepts, the server revalidates, and the RIDER always confirms
 * (decisions Q3 — riders check the plate at pickup), at an unchanged fare
 * with the commission never charged again. Nothing changes unless both
 * consent. fleet-service pre-checks what it knows (same vehicle, same-or-
 * higher class set, at-least-equal capacity, documents valid through the
 * booking, no maintenance in the way) with ride-service's own reason
 * vocabulary, and records every accepted request for audit.
 */
import { createHash } from "node:crypto";

import { ContractError } from "@ubi/contracts";

import { fleetConflictOf } from "./conflicts";
import { FleetError, notFound } from "./errors";
import { withOutbox } from "./outbox";
import { assertCapability, type FleetAccess } from "./roles";
import { shiftIntervals } from "./shifts";
import { documentStatuses, shiftOf, validToOf } from "./views";
import { generateId, isUuid } from "../lib/ids";
import {
  DAY_MS,
  HOUR_MS,
  dateColumnToLocalDate,
  iso,
  overlaps,
} from "../lib/time";

import type { FleetDeps } from "./context";
import type { OccupiedBlock } from "../contract";
import type {
  FleetAssignment,
  FleetVehicleSwapRequest,
} from "@prisma/client/index";

function swapView(row: FleetVehicleSwapRequest) {
  return {
    swapRequestId: row.id,
    bookingBlockId: row.bookingBlockId,
    fromVehicleId: row.fromVehicleId,
    toVehicleId: row.toVehicleId,
    swapId: row.swapId,
    status: row.status as "proposed" | "ineligible",
    reasons: [...row.reasons],
  };
}

export async function requestVehicleSwap(
  deps: FleetDeps,
  access: FleetAccess,
  bookingBlockId: string,
  input: { readonly toVehicleId: string },
  scopedKey: string,
) {
  assertCapability(access, "request_vehicle_swap");
  const replay = await deps.db.fleetVehicleSwapRequest.findUnique({
    where: { idempotencyKey: scopedKey },
  });
  if (replay !== null) {
    return swapView(replay);
  }
  const now = deps.now();
  const vehicles = await deps.db.fleetVehicle.findMany({
    where: { fleetId: access.fleet.id, status: "active" },
    include: { vehicle: true },
  });
  const to = isUuid(input.toVehicleId)
    ? vehicles.find((row) => row.vehicleId === input.toVehicleId)
    : undefined;
  if (to === undefined) {
    throw notFound("vehicle");
  }
  // The booking must be one of THIS fleet's: found only through the
  // fleet-safe projection of its own vehicles and drivers.
  const arrangements = await deps.db.fleetAssignment.findMany({
    where: { fleetId: access.fleet.id, status: { in: ["active", "notice"] } },
  });
  const window = {
    start: now.getTime() - DAY_MS,
    end: now.getTime() + 120 * DAY_MS,
  };
  const blocks = await deps.rides.occupiedBlocks({
    vehicleIds: vehicles.map((row) => row.vehicleId),
    driverIds: [...new Set(arrangements.map((row) => row.driverId))],
    from: iso(window.start),
    to: iso(window.end),
  });
  const block = blocks.find(
    (candidate) => candidate.blockId === bookingBlockId,
  );
  if (block === undefined) {
    throw notFound("booking");
  }
  const fromVehicleId = block.vehicleId ?? vehicleCovering(arrangements, block);
  const reasons: string[] = [];
  const from = vehicles.find((row) => row.vehicleId === fromVehicleId);
  if (fromVehicleId === null || from === undefined) {
    reasons.push(
      fromVehicleId === null ? "vehicle_unknown" : "different_fleet",
    );
  } else {
    if (from.vehicleId === to.vehicleId) {
      reasons.push("same_vehicle");
    }
    if (!from.classes.every((cls) => to.classes.includes(cls))) {
      reasons.push("class_not_eligible");
    }
    if (to.capacity < from.capacity) {
      reasons.push("capacity_too_small");
    }
  }
  const blockEnd = new Date(block.endsAt);
  if (
    documentStatuses(to.vehicle, blockEnd, access.config.policy).some(
      (doc) => doc.status === "expired" || doc.status === "missing",
    )
  ) {
    reasons.push("documents_expired");
  }
  const interval = {
    start: new Date(block.startsAt).getTime(),
    end: blockEnd.getTime(),
  };
  const maintenance = await deps.db.fleetMaintenanceBlock.findMany({
    where: { vehicleId: to.vehicleId, status: { in: ["scheduled", "active"] } },
  });
  const blocking = maintenance.find((m) =>
    overlaps(interval, {
      start: m.startsAt.getTime(),
      end: m.endsAt?.getTime() ?? Number.MAX_SAFE_INTEGER,
    }),
  );
  if (blocking !== undefined) {
    reasons.push(
      blocking.kind === "unplanned_off_road"
        ? "vehicle_off_road"
        : "vehicle_occupied",
    );
  }
  if (reasons.length > 0) {
    throw new FleetError(
      "swap_ineligible",
      "That vehicle can't take this booking.",
      { reasons },
    );
  }
  const result = await deps.rides.requestVehicleSwap(
    bookingBlockId,
    { toVehicleId: to.vehicleId, requestedByStaffId: access.actor.id },
    // Derived from the client's scoped key: a replay re-sends the same key.
    `fleet-swap-${createHash("sha256").update(scopedKey).digest("hex").slice(0, 40)}`,
  );
  if (result.kind === "ineligible") {
    throw new FleetError(
      "swap_ineligible",
      "That vehicle can't take this booking.",
      { reasons: [...result.reasons] },
    );
  }
  const created = await withOutbox(deps.db, async (tx) => {
    const row = await tx.fleetVehicleSwapRequest.create({
      data: {
        id: generateId("fsw"),
        fleetId: access.fleet.id,
        bookingBlockId,
        fromVehicleId: fromVehicleId ?? "",
        toVehicleId: to.vehicleId,
        requestedBy: access.actor.id,
        swapId: result.swapId,
        status: "proposed",
        idempotencyKey: scopedKey,
      },
    });
    return {
      result: row,
      events: [
        {
          name: "fleet.vehicle_swap.requested",
          aggregateType: "fleet",
          aggregateId: row.id,
          fromVersion: null,
          toVersion: 1,
          actor: access.actor,
          cityId: access.cityId,
          occurredAt: now,
          payload: {
            swapRequestId: row.id,
            swapId: result.swapId,
            fleetId: access.fleet.id,
            bookingBlockId,
            fromVehicleId,
            toVehicleId: to.vehicleId,
          },
        },
      ],
      audits: [
        {
          actor: access.actor,
          action: "fleet.vehicle_swap.requested",
          subjectType: "fleet_vehicle_swap_request",
          subjectId: row.id,
          after: {
            bookingBlockId,
            fromVehicleId,
            toVehicleId: to.vehicleId,
            swapId: result.swapId,
          },
        },
      ],
    };
  });
  return swapView(created);
}

/** The vehicle whose signed shift covered the driver at the booking's start. */
function vehicleCovering(
  arrangements: readonly FleetAssignment[],
  block: OccupiedBlock,
): string | null {
  const at = new Date(block.startsAt).getTime();
  for (const row of arrangements) {
    if (row.driverId !== block.driverId) {
      continue;
    }
    const covering = shiftIntervals(
      shiftOf(row),
      row.zone,
      dateColumnToLocalDate(row.validFrom),
      validToOf(row.validTo),
      { start: at, end: at + 1 },
    );
    if (covering.length > 0) {
      return row.vehicleId;
    }
  }
  return null;
}

/** "Ask {driver} to review the booking": a reminder, at most hourly. */
export async function remindDriver(
  deps: FleetDeps,
  access: FleetAccess,
  conflictId: string,
) {
  assertCapability(access, "remind_driver");
  const conflict = await fleetConflictOf(deps.db, access, conflictId);
  if (conflict.driverId === null) {
    throw new ContractError(
      "conflict",
      "this conflict has no driver to remind",
      { reason: "no_driver" },
    );
  }
  if (conflict.status !== "open" && conflict.status !== "resolving") {
    throw new ContractError("conflict", "this conflict is already settled", {
      status: conflict.status,
    });
  }
  const now = deps.now();
  if (
    conflict.lastRemindedAt !== null &&
    now.getTime() - conflict.lastRemindedAt.getTime() < HOUR_MS
  ) {
    return {
      conflictId: conflict.id,
      remindedAt: iso(conflict.lastRemindedAt.getTime()),
    };
  }
  await withOutbox(deps.db, async (tx) => {
    await tx.fleetConflict.update({
      where: { id: conflict.id },
      data: { lastRemindedAt: now, version: { increment: 1 } },
    });
    return {
      result: null,
      events: [
        {
          name: "fleet.conflict.reminder_sent",
          aggregateType: "fleet_conflict",
          aggregateId: conflict.id,
          fromVersion: conflict.version,
          toVersion: conflict.version + 1,
          actor: access.actor,
          cityId: access.cityId,
          occurredAt: now,
          payload: {
            conflictId: conflict.id,
            driverId: conflict.driverId,
            type: conflict.type,
          },
        },
      ],
      audits: [
        {
          actor: access.actor,
          action: "fleet.conflict.reminder_sent",
          subjectType: "fleet_conflict",
          subjectId: conflict.id,
          after: { driverId: conflict.driverId },
        },
      ],
    };
  });
  return { conflictId: conflict.id, remindedAt: iso(now.getTime()) };
}
